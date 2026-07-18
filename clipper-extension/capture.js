/* capture.js — the in-page capture logic, shared by two consumers:
 *
 * 1. The extension injects this file (chrome.scripting.executeScript with
 *    `files`), followed by run-capture.js which calls capturePayload().
 *    File injection avoids function-serialization entirely — content
 *    scripts are classic scripts, so this file must NOT use `export`.
 * 2. The app's test suite side-effect-imports it and picks the function
 *    up from globalThis (see src/__tests__/clipCapture.test.ts).
 */
function capturePayload() {
  const MAX_HTML = 1_500_000; // the app's intake caps request bodies at 2 MB

  /** Strip page chrome, resolve URLs, and shed every attribute Markdown
      doesn't need — GitHub-style markup shrinks by an order of magnitude. */
  function clean(root) {
    for (const junk of root.querySelectorAll(
      'script, style, noscript, iframe, svg, canvas, form, nav, header, footer, aside, button, input, select, textarea, dialog, [hidden], [aria-hidden="true"]'
    )) junk.remove();

    for (const img of root.querySelectorAll('img')) {
      // Lazy-loaded images keep the real URL in data-src variants.
      const src = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || '';
      const alt = img.getAttribute('alt') || '';
      const title = img.getAttribute('title') || '';
      if (!src || src.startsWith('data:')) { img.remove(); continue; }
      let abs = '';
      try { abs = new URL(src, document.baseURI).href; } catch { img.remove(); continue; }
      for (const attr of [...img.attributes]) img.removeAttribute(attr.name);
      img.setAttribute('src', abs);
      if (alt) img.setAttribute('alt', alt);
      if (title) img.setAttribute('title', title);
    }

    for (const a of root.querySelectorAll('a')) {
      // Heading permalinks (e.g. GitHub's anchor icons) carry no content —
      // they would render as [](#…) garbage in Markdown.
      if (!(a.textContent || '').trim() && !a.querySelector('img')) { a.remove(); continue; }
      const href = a.getAttribute('href');
      if (!href) continue;
      try { a.setAttribute('href', new URL(href, document.baseURI).href); }
      catch { a.removeAttribute('href'); }
    }

    const KEEP = {
      a: ['href', 'title'],
      img: ['src', 'alt', 'title'],
      th: ['colspan', 'rowspan'],
      td: ['colspan', 'rowspan'],
    };
    for (const el of root.querySelectorAll('*')) {
      const keep = KEEP[el.tagName.toLowerCase()] || [];
      for (const attr of [...el.attributes]) {
        if (!keep.includes(attr.name)) el.removeAttribute(attr.name);
      }
    }
    return root;
  }

  const selection = window.getSelection();
  const holder = document.createElement('div');
  let text = '';

  if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
    text = selection.toString();
    for (let i = 0; i < selection.rangeCount; i++) {
      holder.appendChild(selection.getRangeAt(i).cloneContents());
    }
  } else {
    // Whole-page clip: prefer the semantic main content over raw <body>.
    const main = document.querySelector('article') || document.querySelector('main') || document.body;
    holder.appendChild(main.cloneNode(true));
  }

  clean(holder);
  if (!text) text = (holder.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200_000);

  let html = holder.innerHTML;
  let truncated = false;
  if (html.length > MAX_HTML) {
    // HTML parsers recover from a cut-off tag; better a truncated clip than none.
    html = html.slice(0, MAX_HTML);
    truncated = true;
  }
  return { html, text, truncated };
}

// Classic-script consumers (extension injection) call it via run-capture.js;
// module consumers (tests) pick it up from globalThis after importing.
globalThis.capturePayload = capturePayload;
