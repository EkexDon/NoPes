const input = document.getElementById('token');
const status = document.getElementById('status');
chrome.storage.sync.get('token').then(({ token }) => { if (token) input.value = token; });
document.getElementById('save').addEventListener('click', async () => {
  await chrome.storage.sync.set({ token: input.value.trim() });
  status.textContent = 'Saved ✓';
  setTimeout(() => (status.textContent = ''), 2000);
});
