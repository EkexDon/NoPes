/**
 * srs.ts — Spaced Repetition (SM-2).
 *
 * Card syntax in any note:   What is the capital of France ?? Paris
 * (a line containing " ?? " — front left, back right).
 *
 * Scheduling state + full review log live in `.nopes/srs.json`. We persist
 * the LOG, not just intervals, so a future FSRS upgrade is a pure recompute
 * (decision log #9). Card identity is a hash of note path + front text, so
 * reformatting the back or moving the line keeps your progress.
 */

import { readTextFile, writeTextFile, mkdir, exists } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import { hashString } from './history';

/* ────────────────────────────────────────────────────────────
   Types
──────────────────────────────────────────────────────────── */

export interface SrsCard {
  /** stable identity: hash(notePath + front) */
  key: string;
  notePath: string;
  line: number;
  front: string;
  back: string;
  type: 'basic' | 'cloze';
  /** tags of the source note — decks are built from these */
  tags?: string[];
}

export interface CardState {
  ease: number;        // SM-2 ease factor, min 1.3
  intervalDays: number;
  reps: number;        // consecutive successful reviews
  lapses: number;
  dueISO: string;      // YYYY-MM-DD
}

export interface ReviewLogEntry {
  ts: number;
  quality: Quality;
  intervalDays: number;
}

/** Again / Hard / Good / Easy */
export type Quality = 0 | 3 | 4 | 5;

export interface SrsMeta {
  /** last day (YYYY-MM-DD) with at least one review */
  lastReviewDay: string | null;
  /** consecutive days with reviews */
  streak: number;
  /** day the new-card counter refers to */
  newSeenDay: string | null;
  /** new cards introduced on that day — enforces the daily allowance
      across sessions/remounts (not just within one queue) */
  newSeenCount: number;
}

/** A user-curated deck ("playlist") of cards. */
export interface SrsDeck {
  id: string;
  name: string;
  cardKeys: string[];
  createdAt: number;
}

export interface SrsStore {
  version: 2;
  states: Record<string, CardState>;
  log: Record<string, ReviewLogEntry[]>;
  /** card keys the user has suspended (excluded from queues) */
  suspended: string[];
  meta: SrsMeta;
  /** user-curated decks (playlists) */
  decks: SrsDeck[];
  /** Daily Deck: cards answered today (each card once per day) */
  daily: { day: string | null; done: string[] };
}

export const NEW_CARDS_PER_DAY = 20;

const isoOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/* ────────────────────────────────────────────────────────────
   Card extraction
──────────────────────────────────────────────────────────── */

const CARD_SEP = ' ?? ';
const CARD_SEP_REV = ' ??? ';
const BLOCK_SEP = '??';
const clozeRe = /\{\{([^{}]+)\}\}/g;

export function cardKeyFor(notePath: string, front: string): string {
  return hashString(`${notePath}::${front}`);
}

const stripMarker = (line: string) => line.replace(/^[-*+>]\s+/, '').trim();

/**
 * Card grammar (all skipped inside code fences):
 *   A ?? B                    → basic card A→B
 *   A ??? B                   → two cards: A→B and B→A
 *   text {{hidden}} text      → one cloze card per {{...}} (others revealed)
 *   <paragraph>\n??\n<paragraph> → multi-line block card
 */
export function extractCards(notePath: string, content: string): SrsCard[] {
  const out: SrsCard[] = [];
  const lines = content.split('\n');
  const usedLines = new Set<number>(); // lines consumed by block cards
  let inFence = false;
  const fenceAt: boolean[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith('```')) inFence = !inFence;
    fenceAt[i] = inFence;
  }

  // Pass 1: block cards ("??" alone on a line)
  for (let i = 0; i < lines.length; i++) {
    if (fenceAt[i] || lines[i].trim() !== BLOCK_SEP) continue;
    // front: contiguous non-empty lines above
    const frontLines: string[] = [];
    for (let j = i - 1; j >= 0 && lines[j].trim() && !fenceAt[j]; j--) frontLines.unshift(lines[j].trim());
    // back: contiguous non-empty lines below
    const backLines: string[] = [];
    for (let j = i + 1; j < lines.length && lines[j].trim() && !fenceAt[j]; j++) backLines.push(lines[j].trim());
    if (frontLines.length === 0 || backLines.length === 0) continue;
    const front = frontLines.join('\n');
    const back = backLines.join('\n');
    out.push({ key: cardKeyFor(notePath, front), notePath, line: i, front, back, type: 'basic' });
    for (let j = i - frontLines.length; j <= i + backLines.length; j++) usedLines.add(j);
  }

  // Pass 2: single-line cards
  for (let i = 0; i < lines.length; i++) {
    if (fenceAt[i] || usedLines.has(i)) continue;
    const trimmed = stripMarker(lines[i]);
    if (!trimmed || trimmed === BLOCK_SEP) continue;

    if (trimmed.includes(CARD_SEP_REV)) {
      const idx = trimmed.indexOf(CARD_SEP_REV);
      const a = trimmed.slice(0, idx).trim();
      const b = trimmed.slice(idx + CARD_SEP_REV.length).trim();
      if (!a || !b) continue;
      out.push({ key: cardKeyFor(notePath, a), notePath, line: i, front: a, back: b, type: 'basic' });
      out.push({ key: cardKeyFor(notePath, `rev::${b}`), notePath, line: i, front: b, back: a, type: 'basic' });
      continue;
    }

    if (trimmed.includes(CARD_SEP)) {
      const idx = trimmed.indexOf(CARD_SEP);
      const front = trimmed.slice(0, idx).trim();
      const back = trimmed.slice(idx + CARD_SEP.length).trim();
      if (!front || !back) continue;
      out.push({ key: cardKeyFor(notePath, front), notePath, line: i, front, back, type: 'basic' });
      continue;
    }

    // Cloze: every {{...}} becomes its own card, other clozes revealed
    const clozes = [...trimmed.matchAll(clozeRe)];
    if (clozes.length > 0) {
      clozes.forEach((m, idx) => {
        const hidden = m[1].trim();
        if (!hidden) return;
        let n = -1;
        const front = trimmed.replace(clozeRe, (_full, inner) => {
          n++;
          return n === idx ? '[...]' : inner.trim();
        });
        out.push({ key: cardKeyFor(notePath, front), notePath, line: i, front, back: hidden, type: 'cloze' });
      });
    }
  }

  return out.sort((a, b) => a.line - b.line);
}

/* ────────────────────────────────────────────────────────────
   SM-2 scheduling
──────────────────────────────────────────────────────────── */

export function initialCardState(todayISO: string): CardState {
  return { ease: 2.5, intervalDays: 0, reps: 0, lapses: 0, dueISO: todayISO };
}

/**
 * SM-2 with the standard Anki-style quality mapping:
 *   0 = Again (lapse), 3 = Hard, 4 = Good, 5 = Easy
 */
export function schedule(state: CardState, quality: Quality, today: Date): CardState {
  const next = { ...state };

  if (quality === 0) {
    next.reps = 0;
    next.lapses = state.lapses + 1;
    next.intervalDays = 0; // relearn today
    next.ease = Math.max(1.3, state.ease - 0.2);
  } else {
    if (next.reps === 0) next.intervalDays = 1;
    else if (next.reps === 1) next.intervalDays = 6;
    else next.intervalDays = Math.round(state.intervalDays * state.ease);
    if (quality === 3) next.intervalDays = Math.max(1, Math.round(next.intervalDays * 0.8));
    if (quality === 5) next.intervalDays = Math.round(next.intervalDays * 1.3);
    next.reps = state.reps + 1;
    // classic SM-2 ease update
    next.ease = Math.max(1.3, state.ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
  }

  const due = new Date(today);
  due.setDate(due.getDate() + next.intervalDays);
  next.dueISO = isoOf(due);
  return next;
}

/**
 * Build today's review queue: all due cards first (oldest due first),
 * then up to `newLimit` never-seen cards.
 */
export function buildQueue(
  cards: SrsCard[],
  states: Record<string, CardState>,
  todayISO: string,
  newLimit = NEW_CARDS_PER_DAY,
  suspended: Set<string> = new Set(),
): SrsCard[] {
  const due: SrsCard[] = [];
  const fresh: SrsCard[] = [];
  for (const card of cards) {
    if (suspended.has(card.key)) continue;
    const st = states[card.key];
    if (!st) fresh.push(card);
    else if (st.dueISO <= todayISO) due.push(card);
  }
  due.sort((a, b) => (states[a.key].dueISO).localeCompare(states[b.key].dueISO));
  return [...due, ...fresh.slice(0, newLimit)];
}

/**
 * Due-count forecast for the next `days` days (index 0 = today, includes
 * overdue). Suspended cards excluded. New cards are not forecast — they
 * enter via the daily new-card allowance.
 */
export function forecast(
  cards: SrsCard[],
  states: Record<string, CardState>,
  todayISO: string,
  days = 7,
  suspended: Set<string> = new Set(),
): number[] {
  const counts = new Array(days).fill(0);
  const base = new Date(todayISO + 'T12:00:00');
  const dayISO = (offset: number) => {
    const d = new Date(base);
    d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const dayISOs = Array.from({ length: days }, (_, i) => dayISO(i));
  for (const card of cards) {
    if (suspended.has(card.key)) continue;
    const st = states[card.key];
    if (!st) continue;
    if (st.dueISO <= todayISO) { counts[0]++; continue; }
    const idx = dayISOs.indexOf(st.dueISO);
    if (idx > 0) counts[idx]++;
  }
  return counts;
}

/** Streak bookkeeping — call once per review; only the first review of a day moves it. */
export function updateStreak(meta: SrsMeta, todayISO: string): SrsMeta {
  if (meta.lastReviewDay === todayISO) return meta;
  const yesterday = (() => {
    const d = new Date(todayISO + 'T12:00:00');
    d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  return {
    ...meta,
    lastReviewDay: todayISO,
    streak: meta.lastReviewDay === yesterday ? meta.streak + 1 : 1,
  };
}

/** How many NEW cards may still be introduced today. */
export function remainingNewAllowance(meta: SrsMeta, todayISO: string, perDay = NEW_CARDS_PER_DAY): number {
  const seenToday = meta.newSeenDay === todayISO ? meta.newSeenCount : 0;
  return Math.max(0, perDay - seenToday);
}

/* ────────────────────────────────────────────────────────────
   Persistence
──────────────────────────────────────────────────────────── */

export function emptySrsStore(): SrsStore {
  return { version: 2, states: {}, log: {}, suspended: [], decks: [], daily: { day: null, done: [] }, meta: { lastReviewDay: null, streak: 0, newSeenDay: null, newSeenCount: 0 } };
}

/** Accepts v1 (pre-suspend/streak) and v2 payloads; anything else → fresh. */
export function reviveSrsStore(data: unknown): SrsStore {
  const parsed = data as any;
  if (!parsed || typeof parsed.states !== 'object') return emptySrsStore();
  if (parsed.version !== 1 && parsed.version !== 2) return emptySrsStore();
  return {
    version: 2,
    states: parsed.states ?? {},
    log: parsed.log ?? {},
    suspended: Array.isArray(parsed.suspended) ? parsed.suspended : [],
    decks: Array.isArray(parsed.decks)
      ? parsed.decks.filter((d: any) => d && typeof d.id === 'string' && typeof d.name === 'string' && Array.isArray(d.cardKeys))
      : [],
    daily: parsed.daily && typeof parsed.daily.day !== 'undefined' && Array.isArray(parsed.daily.done)
      ? { day: parsed.daily.day, done: parsed.daily.done }
      : { day: null, done: [] },
    meta: parsed.meta?.lastReviewDay !== undefined
      ? {
          lastReviewDay: parsed.meta.lastReviewDay,
          streak: parsed.meta.streak ?? 0,
          newSeenDay: parsed.meta.newSeenDay ?? null,
          newSeenCount: parsed.meta.newSeenCount ?? 0,
        }
      : { lastReviewDay: null, streak: 0, newSeenDay: null, newSeenCount: 0 },
  };
}

export function toggleSuspended(store: SrsStore, cardKey: string): SrsStore {
  const suspended = store.suspended.includes(cardKey)
    ? store.suspended.filter(k => k !== cardKey)
    : [...store.suspended, cardKey];
  return { ...store, suspended };
}

export function applyReview(store: SrsStore, card: SrsCard, quality: Quality, today: Date): SrsStore {
  const todayISO = isoOf(today);
  const wasNew = store.states[card.key] === undefined;
  const prev = store.states[card.key] ?? initialCardState(todayISO);
  const nextState = schedule(prev, quality, today);
  return {
    ...store,
    states: { ...store.states, [card.key]: nextState },
    log: {
      ...store.log,
      [card.key]: [...(store.log[card.key] ?? []), { ts: today.getTime(), quality, intervalDays: nextState.intervalDays }],
    },
    meta: (() => {
      let meta = updateStreak(store.meta, todayISO);
      if (wasNew) {
        meta = {
          ...meta,
          newSeenDay: todayISO,
          newSeenCount: (meta.newSeenDay === todayISO ? meta.newSeenCount : 0) + 1,
        };
      }
      return meta;
    })(),
  };
}

async function srsFilePath(vaultPath: string): Promise<string> {
  return await join(vaultPath, '.nopes', 'srs.json');
}

/* ────────────────────────────────────────────────────────────
   Decks (playlists) & quiz mode
──────────────────────────────────────────────────────────── */

export function createDeck(store: SrsStore, name: string, createdAt: number): SrsStore {
  const trimmed = name.trim().slice(0, 60);
  if (!trimmed) return store;
  if (store.decks.some(d => d.name.toLowerCase() === trimmed.toLowerCase())) return store;
  const deck: SrsDeck = {
    id: `deck-${hashString(`${trimmed}::${createdAt}`)}`,
    name: trimmed,
    cardKeys: [],
    createdAt,
  };
  return { ...store, decks: [...store.decks, deck] };
}

export function deleteDeck(store: SrsStore, deckId: string): SrsStore {
  return { ...store, decks: store.decks.filter(d => d.id !== deckId) };
}

export function toggleCardInDeck(store: SrsStore, deckId: string, cardKey: string): SrsStore {
  return {
    ...store,
    decks: store.decks.map(d => {
      if (d.id !== deckId) return d;
      const has = d.cardKeys.includes(cardKey);
      return { ...d, cardKeys: has ? d.cardKeys.filter(k => k !== cardKey) : [...d.cardKeys, cardKey] };
    }),
  };
}

/** Vault folder a note lives in — 'Vault' for root-level notes. */
export function folderOf(notePath: string): string {
  const parts = notePath.split(/[/\\]/).filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 2] : 'Vault';
}

/** Deterministic Fisher-Yates (mulberry32) — testable quiz shuffling. */
export function seededShuffle<T>(arr: T[], seed: number): T[] {
  let a = seed >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Quiz ("cram") queue: EVERY card in the deck, shuffled — due dates and
 * the new-card allowance don't apply. Suspended cards stay excluded.
 */
export function buildQuizQueue(cards: SrsCard[], seed: number, suspended: Set<string> = new Set()): SrsCard[] {
  return seededShuffle(cards.filter(c => !suspended.has(c.key)), seed);
}

/* ────────────────────────────────────────────────────────────
   Daily Deck — every card once per day.
   Completion persists (interruptions/restarts resume where you left
   off), rolls over at midnight, and deliberately has NO instant
   requeue: when today's cards are done, they're done. Quiz mode is
   the intentional escape hatch for "I want them again anyway".
──────────────────────────────────────────────────────────── */

/** Today's done-set, respecting day rollover. */
export function dailyDoneSet(store: SrsStore, todayISO: string): Set<string> {
  return new Set(store.daily.day === todayISO ? store.daily.done : []);
}

/** Mark a card answered for today (idempotent; rolls the day over). */
export function markDailyDone(store: SrsStore, cardKey: string, todayISO: string): SrsStore {
  const done = store.daily.day === todayISO ? store.daily.done : [];
  if (done.includes(cardKey)) return store;
  return { ...store, daily: { day: todayISO, done: [...done, cardKey] } };
}

/** Cards still to answer today: everything minus done-today minus suspended, shuffled. */
export function buildDailyQueue(
  cards: SrsCard[],
  store: SrsStore,
  todayISO: string,
  seed: number,
  suspended: Set<string> = new Set(),
): SrsCard[] {
  const done = dailyDoneSet(store, todayISO);
  return seededShuffle(cards.filter(c => !done.has(c.key) && !suspended.has(c.key)), seed);
}

/* In-memory source of truth. The component layer reads/commits through
   this cache; the JSON file is only durability. Without it, a grade
   followed by a quick view-switch could re-read a not-yet-flushed file
   and resurrect the just-answered card. */
let cachedStore: SrsStore | null = null;
let cachedFor: string | null = null;

export async function getSrsStore(vaultPath: string): Promise<SrsStore> {
  if (cachedFor === vaultPath && cachedStore) return cachedStore;
  const loaded = await loadSrsStoreFromDisk(vaultPath);
  // A commit may have landed while we were reading — never clobber it.
  if (cachedFor === vaultPath && cachedStore) return cachedStore;
  cachedStore = loaded;
  cachedFor = vaultPath;
  return loaded;
}

/** Update the cache synchronously; flush to disk in the background. */
export function commitSrsStore(vaultPath: string, store: SrsStore): void {
  cachedStore = store;
  cachedFor = vaultPath;
  void saveSrsStore(vaultPath, store);
}

export async function loadSrsStoreFromDisk(vaultPath: string): Promise<SrsStore> {
  try {
    const p = await srsFilePath(vaultPath);
    if (await exists(p)) return reviveSrsStore(JSON.parse(await readTextFile(p)));
  } catch (e) {
    console.warn('[NoPes:srs] Could not load srs.json:', e);
  }
  return emptySrsStore();
}

/** @deprecated prefer getSrsStore (cached). Kept for direct-disk readers. */
export const loadSrsStore = loadSrsStoreFromDisk;

export async function saveSrsStore(vaultPath: string, store: SrsStore): Promise<void> {
  try {
    const dir = await join(vaultPath, '.nopes');
    await mkdir(dir, { recursive: true });
    await writeTextFile(await srsFilePath(vaultPath), JSON.stringify(store));
  } catch (e) {
    console.warn('[NoPes:srs] Could not save srs.json:', e);
  }
}
