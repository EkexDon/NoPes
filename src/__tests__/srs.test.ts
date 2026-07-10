import { describe, it, expect } from 'vitest';
import {
  extractCards, cardKeyFor, schedule, initialCardState, buildQueue,
  applyReview, emptySrsStore, reviveSrsStore, CardState, Quality,
} from '../srs';

const TODAY = new Date(2026, 6, 9); // 2026-07-09
const TODAY_ISO = '2026-07-09';

describe('extractCards', () => {
  it('parses "front ?? back" lines with line numbers', () => {
    const cards = extractCards('/v/n.md', 'intro\nWhat is 2+2 ?? 4\n- Capital of France ?? Paris');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({ line: 1, front: 'What is 2+2', back: '4' });
    expect(cards[1].front).toBe('Capital of France'); // list marker stripped
  });

  it('ignores cards inside code fences and incomplete lines', () => {
    const md = '```\nA ?? B\n```\nonly front ?? \n ?? only back';
    expect(extractCards('/v/n.md', md)).toHaveLength(0);
  });

  it('keys are stable across reformatting of the back', () => {
    const a = extractCards('/v/n.md', 'Q ?? old answer')[0];
    const b = extractCards('/v/n.md', 'Q ?? brand new answer')[0];
    expect(a.key).toBe(b.key);
    expect(cardKeyFor('/v/other.md', 'Q')).not.toBe(a.key);
  });
});

describe('SM-2 schedule', () => {
  const fresh = initialCardState(TODAY_ISO);

  it('first Good → 1 day, second Good → 6 days', () => {
    const s1 = schedule(fresh, 4, TODAY);
    expect(s1.intervalDays).toBe(1);
    expect(s1.dueISO).toBe('2026-07-10');
    const s2 = schedule(s1, 4, TODAY);
    expect(s2.intervalDays).toBe(6);
  });

  it('third Good multiplies by ease', () => {
    let s: CardState = fresh;
    s = schedule(s, 4, TODAY);
    s = schedule(s, 4, TODAY);
    const s3 = schedule(s, 4, TODAY);
    expect(s3.intervalDays).toBeGreaterThanOrEqual(Math.floor(6 * 2.4));
  });

  it('Again resets reps, counts a lapse, drops ease, stays due today', () => {
    let s: CardState = schedule(schedule(fresh, 4, TODAY), 4, TODAY);
    const lapsed = schedule(s, 0, TODAY);
    expect(lapsed.reps).toBe(0);
    expect(lapsed.lapses).toBe(1);
    expect(lapsed.dueISO).toBe(TODAY_ISO);
    expect(lapsed.ease).toBeLessThan(s.ease);
  });

  it('Easy grows faster than Good; Hard slower', () => {
    const base = schedule(schedule(fresh, 4, TODAY), 4, TODAY); // interval 6
    expect(schedule(base, 5, TODAY).intervalDays).toBeGreaterThan(schedule(base, 4, TODAY).intervalDays);
    expect(schedule(base, 3, TODAY).intervalDays).toBeLessThan(schedule(base, 4, TODAY).intervalDays);
  });

  it('ease never drops below 1.3', () => {
    let s: CardState = { ...fresh, ease: 1.31 };
    for (let i = 0; i < 5; i++) s = schedule(s, 0, TODAY);
    expect(s.ease).toBeGreaterThanOrEqual(1.3);
  });
});

describe('buildQueue', () => {
  const cards = extractCards('/v/n.md', 'A ?? 1\nB ?? 2\nC ?? 3');

  it('due cards come before new cards, oldest due first', () => {
    const states: Record<string, CardState> = {
      [cards[0].key]: { ...initialCardState('2026-07-01'), dueISO: '2026-07-05' },
      [cards[1].key]: { ...initialCardState('2026-07-01'), dueISO: '2026-07-01' },
    };
    const q = buildQueue(cards, states, TODAY_ISO);
    expect(q.map(c => c.front)).toEqual(['B', 'A', 'C']); // C is new
  });

  it('excludes cards due in the future and caps new cards', () => {
    const states: Record<string, CardState> = {
      [cards[0].key]: { ...initialCardState(TODAY_ISO), dueISO: '2026-08-01' },
    };
    const q = buildQueue(cards, states, TODAY_ISO, 1);
    expect(q.map(c => c.front)).toEqual(['B']); // A future, B new (cap 1), C cut
  });
});

describe('applyReview + store revive', () => {
  it('records state and appends to the review log', () => {
    const card = extractCards('/v/n.md', 'Q ?? A')[0];
    let store = emptySrsStore();
    store = applyReview(store, card, 4 as Quality, TODAY);
    store = applyReview(store, card, 5 as Quality, TODAY);
    expect(store.states[card.key].reps).toBe(2);
    expect(store.log[card.key]).toHaveLength(2);
    expect(store.log[card.key][1].quality).toBe(5);
  });

  it('revives valid payloads and rejects garbage', () => {
    const good = reviveSrsStore(JSON.parse(JSON.stringify(emptySrsStore())));
    expect(good.version).toBe(2);
    expect(reviveSrsStore(null).states).toEqual({});
    expect(reviveSrsStore({ version: 99 }).states).toEqual({});
  });
});

/* ── v2 engine: cloze, block, reversed, suspend, streak, forecast ── */
import {
  forecast, updateStreak, toggleSuspended, SrsStore,
} from '../srs';

describe('extractCards v2 — cloze', () => {
  it('creates one card per {{cloze}}, others revealed', () => {
    const cards = extractCards('/v/n.md', 'Die {{Hauptstadt}} von Frankreich ist {{Paris}}');
    expect(cards).toHaveLength(2);
    expect(cards[0].front).toBe('Die [...] von Frankreich ist Paris');
    expect(cards[0].back).toBe('Hauptstadt');
    expect(cards[1].front).toBe('Die Hauptstadt von Frankreich ist [...]');
    expect(cards[1].back).toBe('Paris');
    expect(cards[0].type).toBe('cloze');
    expect(cards[0].key).not.toBe(cards[1].key);
  });

  it('does not treat a "??" line as cloze even with braces', () => {
    const cards = extractCards('/v/n.md', 'What is {{x}} ?? the unknown');
    expect(cards).toHaveLength(1);
    expect(cards[0].type).toBe('basic');
  });
});

describe('extractCards v2 — reversed (???)', () => {
  it('produces both directions with distinct keys', () => {
    const cards = extractCards('/v/n.md', 'Haus ??? house');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({ front: 'Haus', back: 'house' });
    expect(cards[1]).toMatchObject({ front: 'house', back: 'Haus' });
    expect(cards[0].key).not.toBe(cards[1].key);
  });
});

describe('extractCards v2 — block cards', () => {
  it('joins paragraphs above and below a lone "??"', () => {
    const md = ['What is the powerhouse', 'of the cell?', '??', 'The mitochondria.', 'It produces ATP.', '', 'unrelated'].join('\n');
    const cards = extractCards('/v/n.md', md);
    expect(cards).toHaveLength(1);
    expect(cards[0].front).toBe('What is the powerhouse\nof the cell?');
    expect(cards[0].back).toBe('The mitochondria.\nIt produces ATP.');
  });

  it('block lines are not double-parsed as single-line cards', () => {
    const md = 'A {{x}} question\n??\nanswer';
    const cards = extractCards('/v/n.md', md);
    expect(cards).toHaveLength(1); // block only, no cloze from the front line
  });

  it('requires both sides', () => {
    expect(extractCards('/v/n.md', '??\nanswer only')).toHaveLength(0);
    expect(extractCards('/v/n.md', 'question only\n??')).toHaveLength(0);
  });
});

describe('suspend + queue', () => {
  it('suspended cards never enter the queue', () => {
    const cards = extractCards('/v/n.md', 'A ?? 1\nB ?? 2');
    const q = buildQueue(cards, {}, TODAY_ISO, 20, new Set([cards[0].key]));
    expect(q.map(c => c.front)).toEqual(['B']);
  });

  it('toggleSuspended round-trips', () => {
    let store: SrsStore = emptySrsStore();
    store = toggleSuspended(store, 'k1');
    expect(store.suspended).toEqual(['k1']);
    store = toggleSuspended(store, 'k1');
    expect(store.suspended).toEqual([]);
  });
});

describe('updateStreak', () => {
  it('starts at 1, increments across consecutive days, resets after a gap', () => {
    let meta = { lastReviewDay: null as string | null, streak: 0 };
    meta = updateStreak(meta, '2026-07-08');
    expect(meta.streak).toBe(1);
    meta = updateStreak(meta, '2026-07-09');
    expect(meta.streak).toBe(2);
    meta = updateStreak(meta, '2026-07-09'); // same day: no change
    expect(meta.streak).toBe(2);
    meta = updateStreak(meta, '2026-07-20'); // gap: reset
    expect(meta.streak).toBe(1);
  });
});

describe('forecast', () => {
  it('buckets due dates over the horizon, overdue counts as today', () => {
    const cards = extractCards('/v/n.md', 'A ?? 1\nB ?? 2\nC ?? 3\nD ?? 4');
    const states = {
      [cards[0].key]: { ...initialCardState(TODAY_ISO), dueISO: '2026-07-01' },  // overdue → today
      [cards[1].key]: { ...initialCardState(TODAY_ISO), dueISO: '2026-07-10' },  // tomorrow
      [cards[2].key]: { ...initialCardState(TODAY_ISO), dueISO: '2026-07-15' },  // day 6
      // D is new — not forecast
    };
    const f = forecast(cards, states, TODAY_ISO, 7);
    expect(f[0]).toBe(1);
    expect(f[1]).toBe(1);
    expect(f[6]).toBe(1);
    expect(f.reduce((a, b) => a + b, 0)).toBe(3);
  });
});

describe('v1 → v2 store migration', () => {
  it('preserves states and log, adds suspended + meta', () => {
    const v1 = { version: 1, states: { k: initialCardState(TODAY_ISO) }, log: { k: [] } };
    const revived = reviveSrsStore(v1);
    expect(revived.version).toBe(2);
    expect(revived.states.k).toBeDefined();
    expect(revived.suspended).toEqual([]);
    expect(revived.meta.streak).toBe(0);
  });
});

/* ── regression: "answered card returns after view switch" ── */
import { remainingNewAllowance, commitSrsStore, getSrsStore } from '../srs';

describe('daily new-card allowance (persistent across sessions)', () => {
  it('a graded card never reappears in a rebuilt queue the same day', () => {
    const cards = extractCards('/v/n.md', 'A ?? 1\nB ?? 2');
    let store = emptySrsStore();
    // user answers A with "Good", then leaves and comes back (queue rebuilt)
    store = applyReview(store, cards[0], 4 as Quality, TODAY);
    const q = buildQueue(cards, store.states, TODAY_ISO, remainingNewAllowance(store.meta, TODAY_ISO), new Set(store.suspended));
    expect(q.map(c => c.front)).not.toContain('A');
  });

  it('reviewing new cards consumes the daily allowance across rebuilds', () => {
    const md = Array.from({ length: 30 }, (_, i) => `Q${i} ?? A${i}`).join('\n');
    const cards = extractCards('/v/n.md', md);
    let store = emptySrsStore();

    // Session 1: allowance lets 20 in; user reviews 5 new cards
    expect(remainingNewAllowance(store.meta, TODAY_ISO)).toBe(20);
    for (let i = 0; i < 5; i++) store = applyReview(store, cards[i], 4 as Quality, TODAY);

    // Session 2 (remount): only 15 more new cards may enter today
    expect(remainingNewAllowance(store.meta, TODAY_ISO)).toBe(15);
    const q2 = buildQueue(cards, store.states, TODAY_ISO, remainingNewAllowance(store.meta, TODAY_ISO), new Set());
    expect(q2).toHaveLength(15);
    expect(q2.map(c => c.front)).not.toContain('Q0');
  });

  it('the allowance resets on a new day', () => {
    let store = emptySrsStore();
    const card = extractCards('/v/n.md', 'Q ?? A')[0];
    store = applyReview(store, card, 4 as Quality, TODAY);
    expect(remainingNewAllowance(store.meta, TODAY_ISO)).toBe(19);
    expect(remainingNewAllowance(store.meta, '2026-07-10')).toBe(20);
  });

  it('"Again" reviews of an already-seen card do not eat the allowance', () => {
    let store = emptySrsStore();
    const card = extractCards('/v/n.md', 'Q ?? A')[0];
    store = applyReview(store, card, 4 as Quality, TODAY); // introduces (−1)
    store = applyReview(store, card, 0 as Quality, TODAY); // relearn — no cost
    store = applyReview(store, card, 4 as Quality, TODAY);
    expect(remainingNewAllowance(store.meta, TODAY_ISO)).toBe(19);
  });
});

describe('in-memory store cache', () => {
  it('a committed store is what the next get returns (no disk race)', async () => {
    const card = extractCards('/v/n.md', 'Q ?? A')[0];
    let store = emptySrsStore();
    store = applyReview(store, card, 4 as Quality, TODAY);
    commitSrsStore('/fake-vault', store); // save-to-disk fails silently in tests — cache is the point
    const got = await getSrsStore('/fake-vault');
    expect(got.states[card.key]).toBeDefined();
    expect(got.states[card.key].dueISO > TODAY_ISO).toBe(true);
  });
});

/* ── decks (playlists) + quiz mode ── */
import {
  createDeck, deleteDeck, toggleCardInDeck, folderOf, seededShuffle, buildQuizQueue,
} from '../srs';

describe('decks', () => {
  it('creates, prevents duplicates/empty names, deletes', () => {
    let store = emptySrsStore();
    store = createDeck(store, '  Spanish  ', 1000);
    expect(store.decks).toHaveLength(1);
    expect(store.decks[0].name).toBe('Spanish');
    store = createDeck(store, 'spanish', 2000); // case-insensitive dupe
    expect(store.decks).toHaveLength(1);
    store = createDeck(store, '   ', 3000);
    expect(store.decks).toHaveLength(1);
    store = deleteDeck(store, store.decks[0].id);
    expect(store.decks).toHaveLength(0);
  });

  it('toggles card membership', () => {
    let store = createDeck(emptySrsStore(), 'Bio', 1);
    const id = store.decks[0].id;
    store = toggleCardInDeck(store, id, 'k1');
    store = toggleCardInDeck(store, id, 'k2');
    expect(store.decks[0].cardKeys).toEqual(['k1', 'k2']);
    store = toggleCardInDeck(store, id, 'k1');
    expect(store.decks[0].cardKeys).toEqual(['k2']);
  });

  it('revives decks from persisted payloads and drops malformed ones', () => {
    const store = createDeck(emptySrsStore(), 'X', 1);
    const revived = reviveSrsStore(JSON.parse(JSON.stringify(store)));
    expect(revived.decks).toHaveLength(1);
    const bad = reviveSrsStore({ version: 2, states: {}, decks: [{ nope: true }, null] });
    expect(bad.decks).toHaveLength(0);
  });
});

describe('folderOf', () => {
  it('returns the parent folder, or Vault for root notes', () => {
    expect(folderOf('/v/Uni/Anatomy.md')).toBe('Uni');
    expect(folderOf('/v/Note.md')).toBe('v'); // absolute path: vault dir itself
    expect(folderOf('Note.md')).toBe('Vault');
  });
});

describe('quiz mode', () => {
  const cards = extractCards('/v/n.md', Array.from({ length: 10 }, (_, i) => `Q${i} ?? A${i}`).join('\n'));

  it('includes EVERY card regardless of due dates, shuffled deterministically', () => {
    const q1 = buildQuizQueue(cards, 42);
    const q2 = buildQuizQueue(cards, 42);
    expect(q1).toHaveLength(10);
    expect(q1.map(c => c.key)).toEqual(q2.map(c => c.key));           // same seed → same order
    expect(new Set(q1.map(c => c.key)).size).toBe(10);                 // no dupes/losses
    const q3 = buildQuizQueue(cards, 43);
    expect(q3.map(c => c.key)).not.toEqual(q1.map(c => c.key));        // different seed → different order
  });

  it('still excludes suspended cards', () => {
    const q = buildQuizQueue(cards, 7, new Set([cards[0].key]));
    expect(q).toHaveLength(9);
    expect(q.map(c => c.key)).not.toContain(cards[0].key);
  });
});

/* ── Daily Deck: every card once per day, no instant requeue ── */
import { buildDailyQueue, markDailyDone, dailyDoneSet } from '../srs';

describe('daily deck', () => {
  const cards = extractCards('/v/n.md', 'A ?? 1\nB ?? 2\nC ?? 3');

  it('includes every card once, minus done-today and suspended', () => {
    let store = emptySrsStore();
    store = markDailyDone(store, cards[0].key, TODAY_ISO);
    const q = buildDailyQueue(cards, store, TODAY_ISO, 1, new Set([cards[1].key]));
    expect(q.map(c => c.front)).toEqual(['C']);
  });

  it('an answered card is gone for the rest of the day — even after a rebuild (restart)', () => {
    let store = emptySrsStore();
    store = markDailyDone(store, cards[0].key, TODAY_ISO);
    // simulate app restart: same store revived from JSON
    const revived = reviveSrsStore(JSON.parse(JSON.stringify(store)));
    const q = buildDailyQueue(cards, revived, TODAY_ISO, 5);
    expect(q.map(c => c.key)).not.toContain(cards[0].key);
    expect(q).toHaveLength(2);
  });

  it('interrupted sessions resume with only the remaining cards', () => {
    let store = emptySrsStore();
    store = markDailyDone(store, cards[0].key, TODAY_ISO);
    store = markDailyDone(store, cards[1].key, TODAY_ISO);
    expect(buildDailyQueue(cards, store, TODAY_ISO, 9).map(c => c.front)).toEqual(['C']);
  });

  it('resets on a new day', () => {
    let store = emptySrsStore();
    for (const c of cards) store = markDailyDone(store, c.key, TODAY_ISO);
    expect(buildDailyQueue(cards, store, TODAY_ISO, 1)).toHaveLength(0);
    expect(buildDailyQueue(cards, store, '2026-07-10', 1)).toHaveLength(3);
  });

  it('cards written AFTER finishing today still appear (new content never waits)', () => {
    let store = emptySrsStore();
    for (const c of cards) store = markDailyDone(store, c.key, TODAY_ISO);
    const withNew = [...cards, ...extractCards('/v/n.md', '\n\n\nD ?? 4').map(c => ({ ...c, line: 99 }))];
    const q = buildDailyQueue(withNew, store, TODAY_ISO, 1);
    expect(q.map(c => c.front)).toEqual(['D']);
  });

  it('markDailyDone is idempotent and rolls the day', () => {
    let store = emptySrsStore();
    store = markDailyDone(store, 'k', '2026-07-08');
    store = markDailyDone(store, 'k', '2026-07-08');
    expect(store.daily.done).toEqual(['k']);
    store = markDailyDone(store, 'k2', TODAY_ISO); // new day → old done cleared
    expect(store.daily).toEqual({ day: TODAY_ISO, done: ['k2'] });
    expect(dailyDoneSet(store, TODAY_ISO).has('k')).toBe(false);
  });
});
