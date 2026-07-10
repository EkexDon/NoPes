import { describe, it, expect } from 'vitest';
import { toMono, resampleLinear, encodeWav, cleanTranscript, WHISPER_SAMPLE_RATE } from '../audio';

describe('toMono', () => {
  it('passes mono through untouched', () => {
    const ch = new Float32Array([0.5, -0.5]);
    expect(toMono([ch])).toBe(ch);
  });

  it('averages stereo channels', () => {
    const l = new Float32Array([1, 0]);
    const r = new Float32Array([0, 1]);
    expect([...toMono([l, r])]).toEqual([0.5, 0.5]);
  });
});

describe('resampleLinear', () => {
  it('is identity at equal rates', () => {
    const input = new Float32Array([1, 2, 3]);
    expect(resampleLinear(input, 16000, 16000)).toBe(input);
  });

  it('halves the sample count when downsampling 2:1', () => {
    const input = new Float32Array(1000).fill(0.3);
    const out = resampleLinear(input, 32000, 16000);
    expect(out.length).toBe(500);
    expect(out[250]).toBeCloseTo(0.3, 5);
  });

  it('interpolates between samples', () => {
    const input = new Float32Array([0, 1]);
    const out = resampleLinear(input, 4, 8); // upsample 2x
    expect(out.length).toBe(4);
    expect(out[1]).toBeCloseTo(0.5, 5);
  });
});

describe('encodeWav', () => {
  const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
  const wav = encodeWav(samples, WHISPER_SAMPLE_RATE);
  const view = new DataView(wav.buffer);
  const str = (off: number, len: number) =>
    String.fromCharCode(...wav.slice(off, off + len));

  it('writes a valid RIFF/WAVE header', () => {
    expect(str(0, 4)).toBe('RIFF');
    expect(str(8, 4)).toBe('WAVE');
    expect(str(12, 4)).toBe('fmt ');
    expect(str(36, 4)).toBe('data');
  });

  it('declares 16 kHz mono 16-bit PCM', () => {
    expect(view.getUint16(20, true)).toBe(1);      // PCM
    expect(view.getUint16(22, true)).toBe(1);      // mono
    expect(view.getUint32(24, true)).toBe(16000);  // sample rate
    expect(view.getUint16(34, true)).toBe(16);     // bit depth
  });

  it('has the right sizes and clamps out-of-range samples', () => {
    expect(view.getUint32(40, true)).toBe(samples.length * 2);
    expect(wav.length).toBe(44 + samples.length * 2);
    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(44 + 6, true)).toBe(0x7fff);   // 1.0 → max
    expect(view.getInt16(44 + 8, true)).toBe(-0x8000);  // -1.0 → min
    const loud = encodeWav(new Float32Array([2, -2]), 16000);
    const lv = new DataView(loud.buffer);
    expect(lv.getInt16(44, true)).toBe(0x7fff);
    expect(lv.getInt16(46, true)).toBe(-0x8000);
  });
});

describe('cleanTranscript', () => {
  it('drops bracketed cues and collapses whitespace', () => {
    expect(cleanTranscript(' [Music]  Hello   world (applause) ')).toBe('Hello world');
  });
  it('keeps normal text intact', () => {
    expect(cleanTranscript('Buy milk tomorrow.')).toBe('Buy milk tomorrow.');
  });
});

// OCR text cleanup lives in the same "media" family of pure utilities
import { cleanOcrText } from '../ocr';

describe('cleanOcrText', () => {
  it('collapses whitespace and drops noise-only lines', () => {
    const raw = '  Hello   world \n ~~~ --- ~~~ \n Second  line ';
    expect(cleanOcrText(raw)).toBe('Hello world\nSecond line');
  });

  it('keeps numbers and umlauts', () => {
    expect(cleanOcrText('Straße 42\nMore text')).toBe('Straße 42\nMore text');
  });

  it('returns empty string for pure noise', () => {
    expect(cleanOcrText('.,;: \n |||')).toBe('');
  });
});
