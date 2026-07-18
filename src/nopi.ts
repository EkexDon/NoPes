/**
 * nopi.ts — shared brain for Nopi, the vault companion.
 * The sidebar computes the real level (from vault activity) and persists
 * it; lightweight windows (Quick Capture) read the persisted level so
 * they can show the right evolution without loading the store.
 */

// Sprite picks: only fully-intact creatures from the re-sliced sheet
// (some sheet cells contain creatures that straddle grid boundaries —
// those indices are unusable and were swapped for whole neighbors).
import nopi00 from './assets/nopi/pet_00.png';
import nopi06 from './assets/nopi/pet_06.png';
import nopi09 from './assets/nopi/pet_09.png';
import nopi14 from './assets/nopi/pet_14.png';
import nopi30 from './assets/nopi/pet_30.png';
import nopi32 from './assets/nopi/pet_32.png';
import nopi41 from './assets/nopi/pet_41.png';
import nopi46 from './assets/nopi/pet_46.png';

export interface NopiLook {
  face: string;
  status: string;
}

export function nopiForLevel(level: number): NopiLook {
  if (level < 5)  return { face: nopi00, status: 'Curious' };
  if (level < 10) return { face: nopi06, status: 'Playful' };
  if (level < 15) return { face: nopi09, status: 'Sneaky' };
  if (level < 20) return { face: nopi14, status: 'Armored' };
  if (level < 25) return { face: nopi30, status: 'Golden' };
  if (level < 35) return { face: nopi32, status: 'Elemental' };
  if (level < 43) return { face: nopi41, status: 'Ethereal' };
  return { face: nopi46, status: 'Majestic' };
}

const LEVEL_KEY = 'nopes_pet_level';

export function saveNopiLevel(level: number): void {
  try { localStorage.setItem(LEVEL_KEY, String(level)); } catch { /* ignore */ }
}

export function loadNopiLevel(): number {
  const n = parseInt(localStorage.getItem(LEVEL_KEY) ?? '1', 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/* Quick Capture chatter */
export const NOPI_CAPTURE_GREETINGS = [
  "Psst — what's on your mind?",
  'Quick, before you forget it!',
  "I'll keep it safe in today's note 📝",
  'Thought delivery service, at your command!',
  "Type it out, I'm listening!",
];

export const NOPI_CAPTURE_SAVED = [
  'Got it! Safe and sound ✅',
  'Filed under today! 🗂️',
  'Thought saved — nice one!',
  '+1 thought for the vault!',
];

export function randomOf(list: string[]): string {
  return list[Math.floor(Math.random() * list.length)];
}
