import React, { useEffect, useRef, useState } from 'react';
import { Zap, CornerDownLeft } from 'lucide-react';
import { readTextFile, writeTextFile, exists } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { emit } from '@tauri-apps/api/event';
import { appendCapture, dailyNoteName } from '../captures';
import { nopiForLevel, loadNopiLevel, randomOf, NOPI_CAPTURE_GREETINGS, NOPI_CAPTURE_SAVED } from '../nopi';

/**
 * The Quick Capture window (label "capture") — a tiny always-on-top input
 * summoned by ⌥Space or the tray. It writes directly to today's daily note
 * via the filesystem and notifies the main window with an event; the two
 * webviews never share store state.
 */
export const QuickCapture: React.FC = () => {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState('');
  const [nopiSays, setNopiSays] = useState<string>(() => randomOf(NOPI_CAPTURE_GREETINGS));
  const nopi = nopiForLevel(loadNopiLevel());
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Re-focus every time the window is shown
  useEffect(() => {
    inputRef.current?.focus();
    const win = getCurrentWindow();
    const unlisten = win.onFocusChanged(({ payload: focused }) => {
      if (focused) {
        setStatus('idle');
        setNopiSays(randomOf(NOPI_CAPTURE_GREETINGS));
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    });
    return () => { unlisten.then(fn => fn()); };
  }, []);

  const hide = () => {
    setText('');
    setStatus('idle');
    getCurrentWindow().hide().catch(() => {});
  };

  const save = async () => {
    const trimmed = text.trim();
    if (!trimmed || status === 'saving') return;

    const vaultPath = localStorage.getItem('nopes_vault_path');
    if (!vaultPath) {
      setStatus('error');
      setError('Open a vault in NoPes first.');
      return;
    }

    setStatus('saving');
    try {
      const notePath = await join(vaultPath, dailyNoteName(new Date()));
      const existing = (await exists(notePath)) ? await readTextFile(notePath) : null;
      await writeTextFile(notePath, appendCapture(existing, trimmed, new Date()));
      await emit('nopes:capture-saved', { path: notePath });
      setStatus('saved');
      setNopiSays(randomOf(NOPI_CAPTURE_SAVED));
      setText('');
      setTimeout(hide, 950); // let Nopi's "got it!" land, then vanish
    } catch (e: any) {
      setStatus('error');
      setNopiSays('Uh oh… something went wrong 😿');
      setError(e?.message ?? String(e));
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      save();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      hide();
    }
  };

  return (
    <div className="quick-capture-shell">
      <div className="quick-capture-card">
        <div className="quick-capture-header">
          <Zap size={13} />
          <span>Quick Capture → today's note</span>
          <span className="quick-capture-status">
            {status === 'saving' && 'Saving…'}
            {status === 'error' && <span className="quick-capture-error">{error}</span>}
          </span>
          <span className={`nopi-capture-bubble ${status === 'saved' ? 'celebrate' : ''}`}>{nopiSays}</span>
          <img
            src={nopi.face}
            alt={`Nopi (${nopi.status})`}
            title={`Nopi — ${nopi.status}`}
            className={`nopi-capture-img ${status === 'saved' ? 'celebrate' : ''}`}
          />
        </div>
        <textarea
          ref={inputRef}
          className="quick-capture-input"
          placeholder="Type a thought… Enter saves, Esc dismisses"
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={onKeyDown}
          rows={3}
          autoFocus
        />
        <div className="quick-capture-footer">
          <span><kbd>⏎</kbd> save</span>
          <span><kbd>⇧⏎</kbd> new line</span>
          <span><kbd>esc</kbd> dismiss</span>
          <button className="quick-capture-save" onClick={save} disabled={!text.trim() || status === 'saving'}>
            <CornerDownLeft size={12} /> Capture
          </button>
        </div>
      </div>
    </div>
  );
};
