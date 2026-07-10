/* NoPes Web Clipper — sends clips to the local NoPes app (127.0.0.1 only). */

const ENDPOINT = 'http://127.0.0.1:21787/clip';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'clip-selection', title: 'Clip selection to NoPes', contexts: ['selection'] });
  chrome.contextMenus.create({ id: 'clip-page', title: 'Clip page to NoPes', contexts: ['page'] });
});

async function getSelectionText(tabId) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => window.getSelection()?.toString() ?? '',
    });
    return result?.result ?? '';
  } catch { return ''; }
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

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab) return;
  const payload = { title: tab.title, url: tab.url, selection: '' };
  if (info.menuItemId === 'clip-selection') {
    payload.selection = info.selectionText || (tab.id ? await getSelectionText(tab.id) : '');
  }
  sendClip(payload);
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab) return;
  const selection = tab.id ? await getSelectionText(tab.id) : '';
  sendClip({ title: tab.title, url: tab.url, selection });
});
