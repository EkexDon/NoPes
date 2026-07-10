import { describe, it, expect } from 'vitest';
import { mimeFor, bytesToDataUrl, prepareCloneForPdf, mediaPlaceholderText } from '../exportUtils';

describe('mimeFor', () => {
  it('maps common image extensions', () => {
    expect(mimeFor('a.png')).toBe('image/png');
    expect(mimeFor('B.JPG')).toBe('image/jpeg');
    expect(mimeFor('x.webp')).toBe('image/webp');
    expect(mimeFor('weird.xyz')).toBe('application/octet-stream');
  });
});

describe('bytesToDataUrl', () => {
  it('produces a decodable data URL', () => {
    const bytes = new Uint8Array([72, 105, 33]); // "Hi!"
    const url = bytesToDataUrl(bytes, 'x.png');
    expect(url).toBe(`data:image/png;base64,${btoa('Hi!')}`);
  });

  it('handles large payloads without stack overflow (chunked)', () => {
    const big = new Uint8Array(300_000).fill(65);
    const url = bytesToDataUrl(big, 'big.jpg');
    expect(url.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(atob(url.split(',')[1])).toHaveLength(300_000);
  });
});

describe('prepareCloneForPdf', () => {
  const makeDoc = (html: string): Document => {
    const doc = document.implementation.createHTMLDocument('t');
    doc.body.innerHTML = html;
    return doc;
  };

  it('swaps vault image srcs for data URLs', () => {
    const doc = makeDoc('<img data-rel-path="assets/a.png" src="asset://localhost/x">');
    prepareCloneForPdf(doc, new Map([['assets/a.png', 'data:image/png;base64,AAA=']]));
    expect(doc.querySelector('img')!.src).toBe('data:image/png;base64,AAA=');
  });

  it('replaces unresolvable non-data images with a placeholder', () => {
    const doc = makeDoc('<img data-rel-path="assets/missing.png" src="asset://localhost/x">');
    prepareCloneForPdf(doc, new Map());
    expect(doc.querySelector('img')).toBeNull();
    expect(doc.body.textContent).toContain('assets/missing.png');
  });

  it('keeps data: images untouched', () => {
    const doc = makeDoc('<img src="data:image/png;base64,BBB=">');
    prepareCloneForPdf(doc, new Map());
    expect(doc.querySelector('img')!.src).toBe('data:image/png;base64,BBB=');
  });

  it('replaces videos (and their wrappers) with labeled placeholders', () => {
    const doc = makeDoc('<div><video data-rel-path="assets/clip.mp4" src="asset://v"></video></div>');
    prepareCloneForPdf(doc, new Map());
    expect(doc.querySelector('video')).toBeNull();
    expect(doc.body.textContent).toContain(mediaPlaceholderText('video', 'clip.mp4'));
  });

  it('replaces embedded-PDF iframes with labeled placeholders', () => {
    const doc = makeDoc('<div><div>loader</div><iframe data-rel-path="assets/doc.pdf" src="asset://p" title="doc.pdf"></iframe></div>');
    prepareCloneForPdf(doc, new Map());
    expect(doc.querySelector('iframe')).toBeNull();
    expect(doc.body.textContent).toContain(mediaPlaceholderText('pdf', 'doc.pdf'));
  });

  it('leaves surrounding text intact', () => {
    const doc = makeDoc('<p>before</p><video src="x"></video><p>after</p>');
    prepareCloneForPdf(doc, new Map());
    expect(doc.body.textContent).toContain('before');
    expect(doc.body.textContent).toContain('after');
  });
});
