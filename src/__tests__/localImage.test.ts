import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { localImageUrl, imageMimeFor, clearLocalImageCache } from '../localImage';

const createObjectURL = vi.fn((blob: Blob) => `blob:mock-${createObjectURL.mock.calls.length}-${blob.type}`);
const revokeObjectURL = vi.fn();

beforeEach(() => {
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  vi.stubGlobal('URL', Object.assign(Object.create(URL), { createObjectURL, revokeObjectURL }));
});

afterEach(() => {
  clearLocalImageCache();
  vi.unstubAllGlobals();
});

describe('imageMimeFor', () => {
  it('maps common raster and vector extensions', () => {
    expect(imageMimeFor('/v/assets/clip-1.jpg')).toBe('image/jpeg');
    expect(imageMimeFor('/v/assets/clip-2.png')).toBe('image/png');
    expect(imageMimeFor('/v/assets/icon.svg')).toBe('image/svg+xml'); // svg renders only with correct type
    expect(imageMimeFor('/v/assets/unknown.xyz')).toBe('application/octet-stream');
  });
});

describe('localImageUrl', () => {
  it('reads bytes once and serves repeat requests from the cache', async () => {
    const reader = vi.fn(async () => new Uint8Array([1, 2, 3]));
    const url1 = await localImageUrl('/v/assets/a.png', reader);
    const url2 = await localImageUrl('/v/assets/a.png', reader);
    expect(url1).toBe(url2);
    expect(reader).toHaveBeenCalledTimes(1);
    expect(url1).toContain('image/png');
  });

  it('retries a failed read once', async () => {
    const reader = vi.fn()
      .mockRejectedValueOnce(new Error('EBUSY'))
      .mockResolvedValueOnce(new Uint8Array([7]));
    await expect(localImageUrl('/v/assets/b.jpg', reader)).resolves.toBeTruthy();
    expect(reader).toHaveBeenCalledTimes(2);
  });

  it('rejects when the file stays unreadable', async () => {
    const reader = vi.fn().mockRejectedValue(new Error('ENOENT'));
    await expect(localImageUrl('/v/assets/gone.png', reader)).rejects.toThrow('ENOENT');
  });

  it('evicts (and revokes) the least recently used entry beyond the cap', async () => {
    const reader = vi.fn(async () => new Uint8Array([0]));
    const first = await localImageUrl('/v/assets/first.png', reader);
    for (let i = 0; i < 60; i++) {
      await localImageUrl(`/v/assets/img-${i}.png`, reader);
    }
    expect(revokeObjectURL).toHaveBeenCalledWith(first);
    // Evicted entry is re-read on next use, not served stale.
    await localImageUrl('/v/assets/first.png', reader);
    expect(reader).toHaveBeenCalledTimes(62);
  });
});
