import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useStore, extractWikilinks } from '../store/useStore';
import { X, Send, Bot, Loader, AlertCircle, Sparkles, CheckCircle, FileText, Link2, AlignLeft, RotateCcw } from 'lucide-react';
import { AIService } from '../workers/AIService';
import { invoke } from '@tauri-apps/api/core';
import { readTextFile } from '@tauri-apps/plugin-fs';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface NoteBlock {
  name: string;
  path: string;
  text: string;
  isActive?: boolean;
  isLinked?: boolean;
}

const OLLAMA_URL = 'http://localhost:11434/api/chat';
const OLLAMA_MODEL = 'llama3.2:1b';

type OllamaStatus = 'checking' | 'ready' | 'pulling' | 'error';

// ── Resolve a wikilink name to a file path ────────────────────────────────────
function resolveWikilink(name: string, allFiles: { path: string; name: string }[]): string | null {
  const lower = name.toLowerCase();
  const found = allFiles.find(f =>
    f.name.replace(/\.md$/, '').toLowerCase() === lower ||
    f.name.toLowerCase() === lower
  );
  return found?.path ?? null;
}

// ── Load a note's text (cache-first) ─────────────────────────────────────────
async function loadNote(path: string, tabContents: Record<string, string>): Promise<string> {
  if (tabContents[path] !== undefined) return tabContents[path];
  try { return await readTextFile(path); } catch { return ''; }
}

// ── Build rich multi-note context ─────────────────────────────────────────────
async function buildContext(
  query: string,
  activeTab: string | null,
  tabContents: Record<string, string>,
  aiIndex: { path: string; label: string; vec: Float32Array }[],
  allFiles: { path: string; name: string; is_dir: boolean }[]
): Promise<{ contextStr: string; loadedNotes: NoteBlock[] }> {
  const loadedNotes: NoteBlock[] = [];
  const seenPaths = new Set<string>();

  // 1. Always include the currently open note (primary context)
  if (activeTab) {
    const text = await loadNote(activeTab, tabContents);
    const name = activeTab.split('/').pop()?.replace(/\.md$/, '') ?? 'Note';
    if (text) {
      loadedNotes.push({ name, path: activeTab, text, isActive: true });
      seenPaths.add(activeTab);

      // 2. Resolve all [[WikiLinks]] from the active note (1-level deep)
      const links = extractWikilinks(text);
      for (const linkName of links) {
        const linkedPath = resolveWikilink(linkName, allFiles);
        if (linkedPath && !seenPaths.has(linkedPath)) {
          const linkedText = await loadNote(linkedPath, tabContents);
          if (linkedText) {
            loadedNotes.push({
              name: linkName,
              path: linkedPath,
              text: linkedText,
              isLinked: true,
            });
            seenPaths.add(linkedPath);
          }
        }
      }
    }
  }

  // 3. Semantic search for additional relevant notes (not already included)
  if (aiIndex.length > 0) {
    try {
      const qVec = await AIService.embedQuery(query);
      const hits = await AIService.search(qVec, aiIndex, 6);
      for (const h of hits) {
        if (h.score > 0.15 && !seenPaths.has(h.path)) {
          const text = await loadNote(h.path, tabContents);
          if (text) {
            loadedNotes.push({ name: h.label, path: h.path, text });
            seenPaths.add(h.path);
          }
        }
      }
    } catch { /* semantic search is best-effort */ }
  }

  // 4. Build prompt string with clear sections
  const lines: string[] = [];
  for (const n of loadedNotes) {
    const badge = n.isActive ? ' [CURRENT NOTE]' : n.isLinked ? ' [LINKED NOTE]' : ' [RELATED NOTE]';
    lines.push(`### ${n.name}${badge}\n${n.text.slice(0, 1200)}`);
    lines.push('---');
  }

  return { contextStr: lines.join('\n\n'), loadedNotes };
}

export const VaultChat: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { tabContents, aiIndex, activeTab, allFiles } = useStore();
  const [messages, setMessages]         = useState<Message[]>([]);
  const [input, setInput]               = useState('');
  const [loading, setLoading]           = useState(false);
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus>('checking');
  const [aiStatus, setAiStatus]         = useState('idle');
  const [contextNotes, setContextNotes] = useState<NoteBlock[]>([]);
  const scrollRef                       = useRef<HTMLDivElement>(null);
  const abortRef                        = useRef<AbortController | null>(null);

  const activeNoteName = activeTab?.split('/').pop()?.replace(/\.md$/, '') ?? null;

  // On mount: ensure ollama + model
  useEffect(() => {
    const unsub = AIService.onStatus(setAiStatus);
    AIService.init().catch(console.error);

    setOllamaStatus('checking');
    (invoke('ensure_model') as Promise<string>)
      .then(() => setOllamaStatus('ready'))
      .catch(err => {
        console.error('[VaultChat] ensure_model failed:', err);
        setOllamaStatus('error');
      });

    return unsub;
  }, []);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const sendMessage = useCallback(async (q: string) => {
    if (!q.trim() || loading || ollamaStatus !== 'ready') return;
    setInput('');
    const userMsg: Message = { role: 'user', content: q };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setLoading(true);

    try {
      const { contextStr, loadedNotes } = await buildContext(q, activeTab, tabContents, aiIndex, allFiles);
      setContextNotes(loadedNotes);

      const systemPrompt = contextStr
        ? `You are a smart assistant embedded in the Nopes knowledge base app. Your job is to help the user understand, summarize, and link ideas across their notes.

Rules:
- Answer ONLY based on the provided notes context below.
- Always respond in the SAME LANGUAGE the user writes in.
- When summarizing, be structured: use bullet points and headers.
- Cite the note name when referencing specific information.
- If a note is linked [[like this]], treat it as closely related.
- If the user asks to summarize: structure it as: Key Topics, Main Points, Linked Concepts.

VAULT CONTEXT:
${contextStr}`
        : `You are a helpful assistant for the Nopes note-taking app. No notes are loaded yet — respond generally.`;

      setMessages(prev => [...prev, { role: 'assistant', content: '' }]);
      abortRef.current = new AbortController();

      const res = await fetch(OLLAMA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          stream: true,
          messages: [
            { role: 'system', content: systemPrompt },
            ...nextMessages.map(m => ({ role: m.role, content: m.content })),
          ],
        }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split('\n').filter(Boolean)) {
          try {
            const json = JSON.parse(line);
            const token = json.message?.content ?? '';
            accumulated += token;
            setMessages(prev => {
              const copy = [...prev];
              copy[copy.length - 1] = { role: 'assistant', content: accumulated };
              return copy;
            });
          } catch { /* skip */ }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `⚠️ ${err.message ?? 'Something went wrong.'}`,
        }]);
      }
    } finally {
      setLoading(false);
    }
  }, [messages, loading, ollamaStatus, activeTab, tabContents, aiIndex, allFiles]);

  // Quick action chips
  const quickActions = activeNoteName ? [
    { icon: <AlignLeft size={12} />, label: `Summarize "${activeNoteName}"`, prompt: `Please write a structured summary of the note "${activeNoteName}". Include: Key Topics, Main Points, and any Linked Concepts mentioned.` },
    { icon: <Link2 size={12} />, label: 'What are the linked notes about?', prompt: `What are the linked notes in "${activeNoteName}" about? Give me a brief overview of each linked note and how they relate to each other.` },
    { icon: <FileText size={12} />, label: 'Key takeaways', prompt: `What are the most important key takeaways from the note "${activeNoteName}"? List them as bullet points.` },
    { icon: <Sparkles size={12} />, label: 'Find connections', prompt: `Based on the note "${activeNoteName}" and related notes, what interesting connections or patterns can you find between these notes?` },
  ] : [];

  const statusBadge = () => {
    if (ollamaStatus === 'checking') return (
      <div className="vault-chat-status"><Loader size={12} className="spinning" />Starting local AI (llama3.2:1b)…</div>
    );
    if (ollamaStatus === 'error') return (
      <div className="vault-chat-warning">
        <AlertCircle size={13} />
        <span>
          Local AI engine (Ollama) not found. 
          Please <a href="https://ollama.com" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>download Ollama</a> or install via <code>brew install ollama</code>.
        </span>
      </div>
    );
    if (ollamaStatus === 'ready' && aiStatus === 'loading') return (
      <div className="vault-chat-status"><Loader size={12} className="spinning" />Loading embedding model…</div>
    );
    return null;
  };

  return (
    <div className="vault-chat">
      {/* Header */}
      <div className="vault-chat-header">
        <div className="vault-chat-title">
          <Sparkles size={14} style={{ color: 'var(--accent)' }} />
          Ask your Vault
          {ollamaStatus === 'ready' && (
            <span style={{ fontSize: '0.65rem', color: '#34d399', display: 'flex', alignItems: 'center', gap: 3 }}>
              <CheckCircle size={10} /> llama3.2:1b
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {messages.length > 0 && (
            <button className="vault-chat-close" title="Clear conversation" onClick={() => { setMessages([]); setContextNotes([]); }}>
              <RotateCcw size={13} />
            </button>
          )}
          <button className="vault-chat-close" onClick={() => { abortRef.current?.abort(); onClose(); }}>
            <X size={15} />
          </button>
        </div>
      </div>

      {statusBadge()}

      {/* Context pills — shows which notes are loaded */}
      {contextNotes.length > 0 && (
        <div className="vault-chat-context-bar">
          {contextNotes.map(n => (
            <span key={n.path} className={`context-pill ${n.isActive ? 'active' : n.isLinked ? 'linked' : 'related'}`}>
              {n.isLinked ? <Link2 size={9} /> : <FileText size={9} />} {n.name}
            </span>
          ))}
        </div>
      )}

      {/* Messages */}
      <div className="vault-chat-messages" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="vault-chat-empty">
            <Bot size={32} style={{ opacity: 0.2, marginBottom: 10 }} />
            <div style={{ marginBottom: 12 }}>
              {activeNoteName
                ? <>Chatting in context of <strong>{activeNoteName}</strong> + linked notes</>
                : 'Open a note to start chatting about it'
              }
            </div>
            {quickActions.length > 0 && (
              <div className="quick-actions-grid">
                {quickActions.map(a => (
                  <button key={a.label} className="quick-action-btn" onClick={() => sendMessage(a.prompt)}>
                    {a.icon} {a.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`chat-message ${m.role}`}>
            <div className="chat-bubble">{m.content || <Loader size={13} className="spinning" />}</div>
          </div>
        ))}
      </div>

      {/* Quick actions strip (when conversation started) */}
      {messages.length > 0 && quickActions.length > 0 && !loading && (
        <div className="vault-chat-quick-strip">
          {quickActions.slice(0, 2).map(a => (
            <button key={a.label} className="quick-strip-btn" onClick={() => sendMessage(a.prompt)}>
              {a.icon} {a.label}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="vault-chat-input-row">
        <textarea
          className="vault-chat-input"
          value={input}
          placeholder={ollamaStatus === 'ready' ? 'Ask about your notes…' : 'Starting AI…'}
          rows={1}
          disabled={loading || ollamaStatus !== 'ready'}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); }
          }}
        />
        <button
          className="vault-chat-send"
          disabled={!input.trim() || loading || ollamaStatus !== 'ready'}
          onClick={() => sendMessage(input)}
        >
          {loading ? <Loader size={14} className="spinning" /> : <Send size={14} />}
        </button>
      </div>
    </div>
  );
};
