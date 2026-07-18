import { describe, it, expect, beforeEach } from 'vitest';
import {
  createLockConfig, verifyPassword, loadLockConfig, saveLockConfig, isLockEnabled,
  deriveHash, PBKDF2_ITERATIONS,
} from '../vaultLock';

beforeEach(() => localStorage.clear());

describe('vault lock crypto', () => {
  it('accepts the correct password', async () => {
    const cfg = await createLockConfig('hunter2!');
    expect(await verifyPassword('hunter2!', cfg)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const cfg = await createLockConfig('hunter2!');
    expect(await verifyPassword('hunter3!', cfg)).toBe(false);
    expect(await verifyPassword('', cfg)).toBe(false);
  });

  it('uses a fresh random salt per config', async () => {
    const a = await createLockConfig('same');
    const b = await createLockConfig('same');
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });

  it('derives deterministically for a fixed salt', async () => {
    const salt = new Uint8Array(16).fill(7);
    const h1 = await deriveHash('pw', salt, 1000);
    const h2 = await deriveHash('pw', salt, 1000);
    expect(h1).toBe(h2);
  });

  it('records the iteration count for future upgrades', async () => {
    const cfg = await createLockConfig('x');
    expect(cfg.iterations).toBe(PBKDF2_ITERATIONS);
  });
});

describe('lock config storage', () => {
  it('round-trips through localStorage', async () => {
    const cfg = await createLockConfig('pw');
    saveLockConfig(cfg);
    expect(isLockEnabled()).toBe(true);
    const loaded = loadLockConfig();
    expect(loaded).toEqual(cfg);
    expect(await verifyPassword('pw', loaded!)).toBe(true);
  });

  it('clears on disable', async () => {
    saveLockConfig(await createLockConfig('pw'));
    saveLockConfig(null);
    expect(isLockEnabled()).toBe(false);
    expect(loadLockConfig()).toBeNull();
  });

  it('rejects corrupted payloads', () => {
    localStorage.setItem('nopes_vault_lock', '{"garbage":true}');
    expect(loadLockConfig()).toBeNull();
    localStorage.setItem('nopes_vault_lock', 'not json');
    expect(loadLockConfig()).toBeNull();
  });
});
