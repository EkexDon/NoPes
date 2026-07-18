/**
 * digest.ts — the weekly "Your Week" note, generated locally by Ollama.
 *
 * Scheduling philosophy (decision log #10): no background daemon. The digest
 * fires while the app runs — Sunday evening for the current week, or as a
 * catch-up on the first launch of a new week for the week that just ended.
 */

import { writeTextFile, exists } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';

/* ────────────────────────────────────────────────────────────
   Pure core
──────────────────────────────────────────────────────────── */

export interface DigestStats {
  weekStartISO: string; // Monday
  weekEndISO: string;   // Sunday
  notes: { name: string; wordCount: number; tags: string[] }[];
  totalWords: number;   // journal words in the week
  activeDays: number;
  openTasks: number;
  topTags: string[];
}

const isoOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Monday 00:00 (local) of the week containing d. */
export function weekStartOf(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  const day = out.getDay(); // 0 = Sunday
  out.setDate(out.getDate() - ((day + 6) % 7));
  return out;
}

export function digestNoteName(weekStart: Date): string {
  return `Your Week — ${isoOf(weekStart)}.md`;
}

/**
 * Which week should we digest right now?
 * - Sunday from 18:00 → the CURRENT week (it's effectively over).
 * - Any other day → the PREVIOUS week, as catch-up.
 * Returns the week's Monday, or null if that week was already digested.
 */
export function digestWeekFor(now: Date, lastDigestedWeekISO: string | null): Date | null {
  const currentWeekStart = weekStartOf(now);
  let target: Date;
  if (now.getDay() === 0 && now.getHours() >= 18) {
    target = currentWeekStart;
  } else {
    target = new Date(currentWeekStart);
    target.setDate(target.getDate() - 7);
  }
  if (lastDigestedWeekISO && isoOf(target) <= lastDigestedWeekISO) return null;
  return target;
}

export function buildDigestPrompt(stats: DigestStats): string {
  const noteList = stats.notes
    .slice(0, 30)
    .map(n => `- "${n.name}" (${n.wordCount} words${n.tags.length ? `, tags: ${n.tags.slice(0, 4).join(', ')}` : ''})`)
    .join('\n');

  return [
    `You are the reflective writing assistant inside a private, local-first note app.`,
    `Write a short, warm weekly review (~150-220 words) of the user's week of writing, in markdown.`,
    `Structure: one paragraph on what they focused on, one on connections or patterns you notice between topics, and 2-3 bullet points suggesting what to pick up next week. No preamble, no sign-off.`,
    ``,
    `Week: ${stats.weekStartISO} to ${stats.weekEndISO}`,
    `Journal: ${stats.totalWords} words across ${stats.activeDays} active day(s). Open tasks: ${stats.openTasks}.`,
    stats.topTags.length ? `Recurring topics: ${stats.topTags.join(', ')}` : '',
    ``,
    `Notes touched this week:`,
    noteList || '- (no notes were edited this week)',
  ].filter(Boolean).join('\n');
}

export function buildDigestNote(aiText: string, stats: DigestStats): string {
  const noteLinks = stats.notes.slice(0, 12).map(n => `[[${n.name}]]`).join(' · ');
  return [
    `# Your Week — ${stats.weekStartISO}`,
    ``,
    `> 🤖 Written locally by your vault's AI. ${stats.weekStartISO} → ${stats.weekEndISO}`,
    ``,
    aiText.trim(),
    ``,
    `---`,
    ``,
    `**Stats:** ${stats.notes.length} notes touched · ${stats.totalWords} journal words · ${stats.activeDays} active days · ${stats.openTasks} open tasks`,
    stats.topTags.length ? `**Topics:** ${stats.topTags.map(t => `#${t}`).join(' ')}` : '',
    noteLinks ? `**Notes:** ${noteLinks}` : '',
    ``,
  ].filter(l => l !== null).join('\n');
}

/* ────────────────────────────────────────────────────────────
   Runtime (I/O)
──────────────────────────────────────────────────────────── */

const LAST_DIGEST_KEY = 'nopes_last_digest_week';

export interface DigestSources {
  vaultPath: string;
  notesModifiedBetween: (fromMs: number, toMs: number) => { name: string; wordCount: number; tags: string[] }[];
  journalStats: Record<string, number>;
  openTasks: number;
}

async function askOllama(prompt: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  try {
    const res = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama3.2:1b',
        stream: false,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = await res.json();
    const text = json?.message?.content;
    return typeof text === 'string' && text.trim() ? text : null;
  } catch {
    return null; // Ollama not running — retry on a future launch
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Generate the weekly digest if one is due. Silent no-op when not due,
 * AI is off, or Ollama is unreachable (a later launch retries).
 * Returns the created note's path, or null.
 */
export async function maybeGenerateDigest(sources: DigestSources): Promise<string | null> {
  const weekStart = digestWeekFor(new Date(), localStorage.getItem(LAST_DIGEST_KEY));
  if (!weekStart) return null;

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);

  const notePath = await join(sources.vaultPath, digestNoteName(weekStart));
  if (await exists(notePath)) {
    // Already written (other machine / previous run) — just record it.
    localStorage.setItem(LAST_DIGEST_KEY, isoOf(weekStart));
    return null;
  }

  const weekStartISO = isoOf(weekStart);
  const weekEndISO = isoOf(weekEnd);
  const notes = sources.notesModifiedBetween(weekStart.getTime(), weekEnd.getTime());

  const journalDays = Object.entries(sources.journalStats)
    .filter(([day]) => day >= weekStartISO && day <= weekEndISO);
  const totalWords = journalDays.reduce((s, [, w]) => s + w, 0);
  const activeDays = journalDays.filter(([, w]) => w > 0).length;

  // Nothing happened → nothing to digest; mark done so we don't nag.
  if (notes.length === 0 && totalWords === 0) {
    localStorage.setItem(LAST_DIGEST_KEY, weekStartISO);
    return null;
  }

  const tagCounts = new Map<string, number>();
  notes.forEach(n => n.tags.forEach(t => tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1)));
  const topTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t]) => t);

  const stats: DigestStats = {
    weekStartISO, weekEndISO, notes, totalWords, activeDays,
    openTasks: sources.openTasks, topTags,
  };

  const aiText = await askOllama(buildDigestPrompt(stats));
  if (!aiText) return null; // Ollama unavailable — retry next launch

  await writeTextFile(notePath, buildDigestNote(aiText, stats));
  localStorage.setItem(LAST_DIGEST_KEY, weekStartISO);
  return notePath;
}
