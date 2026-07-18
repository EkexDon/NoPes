/**
 * vaultLock.ts — app-level privacy lock.
 *
 * PBKDF2-SHA256 (210k iterations, random 16-byte salt) via WebCrypto; the
 * verifier lives in localStorage. This is a PRIVACY lock — it keeps someone
 * at your keyboard out of the UI. It is not encryption: the vault files on
 * disk stay plain markdown (per-note encryption is a separate feature that
 * ships only after Version History has soak time, per the decision log).
 * Touch ID as a keychain wrap is the documented follow-up.
 */

export interface LockConfig {
  salt: string;        // base64
  hash: string;        // base64
  iterations: number;
  version: 1;
}

const STORAGE_KEY = 'nopes_vault_lock';
export const PBKDF2_ITERATIONS = 210_000;

const toB64 = (buf: ArrayBuffer | Uint8Array): string => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  bytes.forEach(b => { s += String.fromCharCode(b); });
  return btoa(s);
};

const fromB64 = (s: string): Uint8Array =>
  Uint8Array.from(atob(s), c => c.charCodeAt(0));

export async function deriveHash(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    keyMaterial,
    256,
  );
  return toB64(bits);
}

export async function createLockConfig(password: string): Promise<LockConfig> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await deriveHash(password, salt, PBKDF2_ITERATIONS);
  return { salt: toB64(salt), hash, iterations: PBKDF2_ITERATIONS, version: 1 };
}

export async function verifyPassword(password: string, config: LockConfig): Promise<boolean> {
  const hash = await deriveHash(password, fromB64(config.salt), config.iterations);
  // constant-time-ish compare (both sides are fixed-length base64 digests)
  if (hash.length !== config.hash.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= hash.charCodeAt(i) ^ config.hash.charCodeAt(i);
  return diff === 0;
}

export function loadLockConfig(): LockConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const cfg = JSON.parse(raw);
    if (cfg?.version === 1 && cfg.salt && cfg.hash && cfg.iterations) return cfg;
    return null;
  } catch { return null; }
}

export function saveLockConfig(config: LockConfig | null): void {
  if (config) localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  else localStorage.removeItem(STORAGE_KEY);
}

export function isLockEnabled(): boolean {
  return loadLockConfig() !== null;
}
