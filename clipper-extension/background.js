/* NoPes Web Clipper — sends clips to the local NoPes app (127.0.0.1 only).
   Classic (non-module) service worker: capture code is injected as FILES
   (capture.js + run-capture.js), so no function serialization and no module
   machinery is involved anywhere. */

const ENDPOINT = 'http://127.0.0.1:21787/clip';
const VERSION = chrome.runtime.getManifest().version;

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'clip-selection', title: 'Clip selection to NoPes', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'clip-page', title: 'Clip page to NoPes', contexts: ['page'] });
  });
});

/* Runs capture.js inside the page. Returns captureBlocked: true on pages the
   browser refuses to inject into (chrome://, Web Store, PDF viewer, …). */
async function capture(tabId) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      files: ['capture.js', 'run-capture.js'],
    });
    const r = result?.result;
    if (r && typeof r.html === 'string') {
      return { html: r.html, text: r.text || '', truncated: !!r.truncated, captureBlocked: false };
    }
    return { html: '', text: '', truncated: false, captureBlocked: true };
  } catch {
    return { html: '', text: '', truncated: false, captureBlocked: true };
  }
}

async function sendClip(payload) {
  const { token } = await chrome.storage.sync.get('token');
  if (!token) {
    chrome.runtime.openOptionsPage();
    return;
  }
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-NoPes-Token': token },
      body: JSON.stringify(payload),
    });
    const ok = res.ok;
    chrome.action.setBadgeText({ text: ok ? '✓' : '✗' });
    chrome.action.setBadgeBackgroundColor({ color: ok ? '#34d399' : '#f87171' });
  } catch {
    chrome.action.setBadgeText({ text: '✗' });
    chrome.action.setBadgeBackgroundColor({ color: '#f87171' });
  }
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 2500);
}

async function clipTab(tab, selectionText) {
  if (!tab?.id) return;
  const captured = await capture(tab.id);
  await sendClip({
    title: tab.title,
    url: tab.url,
    // captured.text keeps real line structure; menu selectionText flattens it.
    selection: captured.text || selectionText || '',
    html: captured.html,
    truncated: captured.truncated,
    captureBlocked: captured.captureBlocked,
    clipperVersion: VERSION,
  });
}

chrome.contextMenus.onClicked.addListener((info, tab) => clipTab(tab, info.selectionText));
chrome.action.onClicked.addListener((tab) => clipTab(tab, ''));
