import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  GraduationCap, Eye, FileText, RotateCcw, Undo2, PauseCircle, PlayCircle,
  Flame, Layers, BookOpenCheck, FolderOpen, Plus, Trash2, Zap, Hash, ListPlus, Check, CalendarCheck,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useStore, getVaultIndex } from '../store/useStore';
import {
  SrsCard, SrsStore, Quality, CardState, buildQueue, buildQuizQueue, applyReview,
  getSrsStore, commitSrsStore, emptySrsStore, schedule, initialCardState,
  toggleSuspended, forecast, remainingNewAllowance, createDeck, deleteDeck,
  toggleCardInDeck, folderOf, buildDailyQueue, markDailyDone, dailyDoneSet,
} from '../srs';
import { CardMarkdown } from './CardMarkdown';
import { fireConfetti } from '../confetti';

const localISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const intervalLabel = (state: CardState | undefined, q: Quality, todayISO: string): string => {
  if (q === 0) return 'today';
  const next = schedule(state ?? initialCardState(todayISO), q, new Date(todayISO + 'T12:00:00'));
  const days = next.intervalDays;
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}y`;
};

const GRADES: { q: Quality; label: string; hint: string; cls: string }[] = [
  { q: 0, label: 'Again', hint: '1', cls: 'again' },
  { q: 3, label: 'Hard',  hint: '2', cls: 'hard' },
  { q: 4, label: 'Good',  hint: '3', cls: 'good' },
  { q: 5, label: 'Easy',  hint: '4', cls: 'easy' },
];

const STREAK_MILESTONES = [7, 30, 100];

type Tab = 'study' | 'browse';
type Mode = 'due' | 'daily' | 'quiz';
/** 'all' | 'deck:<id>' | 'folder:<name>' | '#<tag>' */
type DeckKey = string;

export const ReviewView: React.FC = () => {
  const { indexVersion, vaultPath, openFile, unlockAchievement } = useStore();
  const [tab, setTab] = useState<Tab>('study');
  const [mode, setMode] = useState<Mode>('due');
  const [store, setStore] = useState<SrsStore | null>(null);
  const [deck, setDeck] = useState<DeckKey>('all');
  const [queue, setQueue] = useState<SrsCard[]>([]);
  const [sessionTotal, setSessionTotal] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const [againCount, setAgainCount] = useState(0);
  const [newDeckName, setNewDeckName] = useState('');
  const [showNewDeck, setShowNewDeck] = useState(false);
  const [assignFor, setAssignFor] = useState<string | null>(null); // card key with open deck-menu
  const sessionStartRef = useRef<number>(Date.now());
  const storeRef = useRef<SrsStore>(emptySrsStore());
  const undoRef = useRef<{ store: SrsStore; queue: SrsCard[]; reviewed: number; again: number } | null>(null);

  const todayISO = localISO(new Date());

  const allCards = useMemo(() => {
    void indexVersion;
    return getVaultIndex().allCards();
  }, [indexVersion]);

  /* Deck sources: custom playlists, vault folders, tags */
  const folders = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of allCards) {
      const f = folderOf(c.notePath);
      counts.set(f, (counts.get(f) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [allCards]);

  const tagDecks = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of allCards) (c.tags ?? []).forEach(t => counts.set(t, (counts.get(t) ?? 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [allCards]);

  const deckCards = useMemo(() => {
    if (deck === 'all') return allCards;
    if (deck.startsWith('deck:')) {
      const d = storeRef.current.decks.find(x => x.id === deck.slice(5));
      const keys = new Set(d?.cardKeys ?? []);
      return allCards.filter(c => keys.has(c.key));
    }
    if (deck.startsWith('folder:')) return allCards.filter(c => folderOf(c.notePath) === deck.slice(7));
    if (deck.startsWith('#')) return allCards.filter(c => (c.tags ?? []).includes(deck.slice(1)));
    return allCards;
  }, [allCards, deck, store]);

  const suspendedSet = useMemo(() => new Set(store?.suspended ?? []), [store]);

  const resetSession = (q: SrsCard[]) => {
    setQueue(q);
    setSessionTotal(q.length);
    setReviewed(0);
    setAgainCount(0);
    setRevealed(false);
    sessionStartRef.current = Date.now();
    undoRef.current = null;
  };

  const rebuildQueue = (s: SrsStore, cards: SrsCard[], m: Mode) => {
    if (m === 'quiz') {
      resetSession(buildQuizQueue(cards, Date.now() & 0xffffffff, new Set(s.suspended)));
    } else if (m === 'daily') {
      // Every card once per day; done-set persists across restarts.
      resetSession(buildDailyQueue(cards, s, todayISO, Date.now() & 0xffffffff, new Set(s.suspended)));
    } else {
      // New-card allowance is persistent (meta), not per-queue — otherwise
      // every remount would introduce the NEXT 20 unseen cards.
      resetSession(buildQueue(cards, s.states, todayISO, remainingNewAllowance(s.meta, todayISO), new Set(s.suspended)));
    }
  };

  useEffect(() => {
    let active = true;
    if (!vaultPath) return;
    // In-memory cache: after the first load, remounts are synchronous and
    // always see the latest grades — no disk race, no repeated cards.
    getSrsStore(vaultPath).then(s => {
      if (!active) return;
      storeRef.current = s;
      setStore(s);
      rebuildQueue(s, deckCards, mode);
    });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultPath, deck, mode]);

  // Startup population: the Vault Index loads asynchronously after launch.
  // When cards arrive late, fill the (untouched) session — but never reset
  // a session the user is mid-way through.
  useEffect(() => {
    if (!store) return;
    if (queue.length === 0 && reviewed === 0 && deckCards.length > 0) {
      rebuildQueue(storeRef.current, deckCards, mode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allCards.length, store]);

  const current = queue[0] ?? null;
  const currentState = current ? storeRef.current.states[current.key] : undefined;

  const persist = (s: SrsStore) => {
    storeRef.current = s;
    setStore(s);
    if (vaultPath) commitSrsStore(vaultPath, s);
  };

  const grade = (q: Quality) => {
    if (!current) return;
    undoRef.current = { store: storeRef.current, queue, reviewed, again: againCount };

    if (mode === 'due') {
      const prevStreak = storeRef.current.meta.streak;
      const next = applyReview(storeRef.current, current, q, new Date());
      persist(next);
      if (next.meta.streak > prevStreak && STREAK_MILESTONES.includes(next.meta.streak)) {
        fireConfetti();
        toast(`🔥 ${next.meta.streak}-day review streak!`, { duration: 5000, icon: '🎉' });
      }
    } else if (mode === 'daily' && q !== 0) {
      // answered (not "Again") → done for today; persists across restarts
      persist(markDailyDone(storeRef.current, current.key, todayISO));
    }
    // quiz mode: pure practice — SRS state untouched

    setRevealed(false);
    setReviewed(c => c + 1);
    if (q === 0) setAgainCount(c => c + 1);
    setQueue(prev => (q === 0 ? [...prev.slice(1), current] : prev.slice(1)));
    unlockAchievement('first-review', 'First Review');
    if (reviewed + 1 >= 25) unlockAchievement('scholar-25', 'Scholar');
  };

  const undo = () => {
    const snap = undoRef.current;
    if (!snap) return;
    if (mode !== 'quiz') persist(snap.store);
    setQueue(snap.queue);
    setReviewed(snap.reviewed);
    setAgainCount(snap.again);
    setRevealed(false);
    undoRef.current = null;
    toast('Undid last review', { icon: '↩️' });
  };

  const suspendCurrent = () => {
    if (!current) return;
    persist(toggleSuspended(storeRef.current, current.key));
    setQueue(prev => prev.slice(1));
    setRevealed(false);
    toast('Card suspended — resume it in Browse', { icon: '⏸️' });
  };

  const addDeck = () => {
    const name = newDeckName.trim();
    if (!name) return;
    const next = createDeck(storeRef.current, name, Date.now());
    if (next === storeRef.current) { toast.error('A deck with that name exists'); return; }
    persist(next);
    setNewDeckName('');
    setShowNewDeck(false);
    const created = next.decks[next.decks.length - 1];
    setDeck(`deck:${created.id}`);
    setTab('browse');
    toast.success(`Deck "${name}" created — assign cards in Browse`, { duration: 4500 });
  };

  const removeDeck = (id: string, name: string) => {
    persist(deleteDeck(storeRef.current, id));
    if (deck === `deck:${id}`) setDeck('all');
    toast(`Deck "${name}" deleted (cards are untouched)`, { icon: '🗑️' });
  };

  /* Keyboard: space reveals, 1-4 grades, u undoes */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (tab !== 'study') return;
      if (e.key === 'u') { undo(); return; }
      if (!current) return;
      if (e.key === ' ' && !revealed) { e.preventDefault(); setRevealed(true); return; }
      if (revealed) {
        const idx = ['1', '2', '3', '4'].indexOf(e.key);
        if (idx >= 0) { e.preventDefault(); grade(GRADES[idx].q); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, revealed, tab, mode, reviewed, againCount]);

  const fc = useMemo(
    () => (store ? forecast(deckCards, store.states, todayISO, 7, suspendedSet) : []),
    [deckCards, store, todayISO, suspendedSet],
  );

  if (!store) return <div className="review-shell"><div className="review-empty">Loading…</div></div>;

  const minutes = Math.max(1, Math.round((Date.now() - sessionStartRef.current) / 60000));
  const accuracy = reviewed > 0 ? Math.round(((reviewed - againCount) / reviewed) * 100) : 100;
  const progress = sessionTotal > 0 ? Math.min(100, Math.round((reviewed / sessionTotal) * 100)) : 0;
  const quizable = deckCards.filter(c => !suspendedSet.has(c.key)).length;
  const dueCount = mode === 'due' ? queue.length : buildQueue(deckCards, store.states, todayISO, remainingNewAllowance(store.meta, todayISO), suspendedSet).length;
  const dailyRemaining = mode === 'daily' ? queue.length : (() => {
    const done = dailyDoneSet(store, todayISO);
    return deckCards.filter(c => !done.has(c.key) && !suspendedSet.has(c.key)).length;
  })();
  void quizable;

  return (
    <div className="review-shell">
      <div className="review-topbar">
        <div className="tasks-topbar-left">
          <GraduationCap size={16} style={{ color: 'var(--accent)' }} />
          <span className="tasks-title">Review</span>
          {store.meta.streak > 0 && (
            <span className="review-streak" title={`${store.meta.streak} days of reviews in a row`}>
              <Flame size={13} /> {store.meta.streak}
            </span>
          )}
          {mode === 'quiz' && <span className="quiz-badge" title="Practice session — your SRS schedule is untouched"><Zap size={11} /> quiz — scheduling unaffected</span>}
          {mode === 'daily' && <span className="quiz-badge daily" title="Every card once per day — answered cards return tomorrow"><CalendarCheck size={11} /> daily deck</span>}
          <span className="tasks-counts">{queue.length} left · {allCards.length} cards</span>
        </div>
        <div className="tasks-topbar-right">
          {tab === 'study' && (
            <div className="tasks-groupby mode-switch">
              <button className={`tasks-groupby-btn ${mode === 'due' ? 'active' : ''}`} onClick={() => setMode('due')} title="Scheduled review — SM-2 decides what's due">
                <BookOpenCheck size={13} /> due{dueCount > 0 ? ` ${dueCount}` : ''}
              </button>
              <button className={`tasks-groupby-btn ${mode === 'daily' ? 'active' : ''}`} onClick={() => setMode('daily')} title="Daily Deck — every card once per day; finished cards return tomorrow">
                <CalendarCheck size={13} /> daily{dailyRemaining > 0 ? ` ${dailyRemaining}` : ''}
              </button>
              <button className={`tasks-groupby-btn ${mode === 'quiz' ? 'active' : ''}`} onClick={() => setMode('quiz')} title="Quiz — unlimited shuffled practice, schedule untouched">
                <Zap size={13} /> quiz
              </button>
            </div>
          )}
          <div className="tasks-groupby">
            <button className={`tasks-groupby-btn ${tab === 'study' ? 'active' : ''}`} onClick={() => setTab('study')}>
              <BookOpenCheck size={13} /> study
            </button>
            <button className={`tasks-groupby-btn ${tab === 'browse' ? 'active' : ''}`} onClick={() => setTab('browse')}>
              <Layers size={13} /> browse
            </button>
          </div>
        </div>
      </div>

      {/* Deck chips: All · custom playlists · folders · tags */}
      <div className="review-decks">
        <button className={`deck-chip ${deck === 'all' ? 'active' : ''}`} onClick={() => setDeck('all')}>
          All <span>{allCards.length}</span>
        </button>

        {store.decks.map(d => {
          const count = allCards.filter(c => d.cardKeys.includes(c.key)).length;
          return (
            <span key={d.id} className={`deck-chip custom ${deck === `deck:${d.id}` ? 'active' : ''}`}>
              <button className="deck-chip-main" onClick={() => setDeck(`deck:${d.id}`)}>
                <Layers size={11} /> {d.name} <span>{count}</span>
              </button>
              <button className="deck-chip-delete" title={`Delete deck "${d.name}" (cards stay)`} onClick={() => removeDeck(d.id, d.name)}>
                <Trash2 size={10} />
              </button>
            </span>
          );
        })}

        {showNewDeck ? (
          <input
            className="deck-new-input"
            autoFocus
            placeholder="Deck name…"
            value={newDeckName}
            onChange={e => setNewDeckName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') addDeck();
              if (e.key === 'Escape') { setShowNewDeck(false); setNewDeckName(''); }
            }}
            onBlur={() => { if (!newDeckName.trim()) setShowNewDeck(false); }}
          />
        ) : (
          <button className="deck-chip deck-new" onClick={() => setShowNewDeck(true)} title="Create a deck (playlist) and assign cards to it in Browse">
            <Plus size={11} /> New deck
          </button>
        )}

        {folders.length > 1 && <span className="deck-sep" />}
        {folders.length > 1 && folders.map(([f, count]) => (
          <button key={f} className={`deck-chip ${deck === `folder:${f}` ? 'active' : ''}`} onClick={() => setDeck(`folder:${f}`)}>
            <FolderOpen size={11} /> {f} <span>{count}</span>
          </button>
        ))}

        {tagDecks.length > 0 && <span className="deck-sep" />}
        {tagDecks.map(([tag, count]) => (
          <button key={tag} className={`deck-chip ${deck === `#${tag}` ? 'active' : ''}`} onClick={() => setDeck(`#${tag}`)}>
            <Hash size={11} /> {tag} <span>{count}</span>
          </button>
        ))}
      </div>

      {tab === 'study' && sessionTotal > 0 && (
        <div className={`review-progress ${mode === 'quiz' ? 'quiz' : ''} ${mode === 'daily' ? 'daily' : ''}`}><div className="review-progress-fill" style={{ width: `${progress}%` }} /></div>
      )}

      {tab === 'browse' ? (
        <div className="review-browse">
          {deckCards.length === 0 && (
            <div className="review-empty" style={{ padding: 40 }}>
              {deck.startsWith('deck:')
                ? 'This deck is empty — switch to another deck source and use the + button on cards to add them here.'
                : 'No cards in this deck.'}
            </div>
          )}
          {deckCards.map(card => {
            const st = store.states[card.key];
            const suspended = suspendedSet.has(card.key);
            const memberOf = store.decks.filter(d => d.cardKeys.includes(card.key));
            return (
              <div key={card.key} className={`browse-row ${suspended ? 'suspended' : ''}`}>
                <span className="browse-front" title={card.front}>{card.front.split('\n')[0]}</span>
                {memberOf.length > 0 && (
                  <span className="browse-decks" title={memberOf.map(d => d.name).join(', ')}>
                    <Layers size={10} /> {memberOf.length}
                  </span>
                )}
                <span className="browse-state">
                  {suspended ? 'suspended' : !st ? 'new' : st.dueISO <= todayISO ? 'due' : `due ${st.dueISO}`}
                </span>
                {st && <span className="browse-ease">ease {st.ease.toFixed(2)} · {st.reps}✓ {st.lapses}✗</span>}
                <button className="browse-note" onClick={() => openFile(card.notePath)} title="Open source note">
                  <FileText size={11} /> {card.notePath.split(/[/\\]/).pop()?.replace(/\.md$/, '')}
                </button>
                <span className="browse-assign-wrap">
                  <button
                    className="browse-assign"
                    title={store.decks.length ? 'Add/remove this card in your decks' : 'Create a deck first (+ New deck above)'}
                    onClick={() => setAssignFor(assignFor === card.key ? null : card.key)}
                  >
                    <ListPlus size={14} />
                  </button>
                  {assignFor === card.key && (
                    <div className="deck-assign-menu" onMouseLeave={() => setAssignFor(null)}>
                      {store.decks.length === 0 && <div className="deck-assign-empty">No decks yet — use “+ New deck” above.</div>}
                      {store.decks.map(d => {
                        const member = d.cardKeys.includes(card.key);
                        return (
                          <button
                            key={d.id}
                            className={`deck-assign-item ${member ? 'member' : ''}`}
                            onClick={() => persist(toggleCardInDeck(storeRef.current, d.id, card.key))}
                          >
                            <span className="deck-assign-check">{member && <Check size={11} />}</span>
                            {d.name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </span>
                <button
                  className="browse-suspend"
                  title={suspended ? 'Resume card' : 'Suspend card'}
                  onClick={() => {
                    persist(toggleSuspended(storeRef.current, card.key));
                    rebuildQueue(storeRef.current, deckCards, mode);
                  }}
                >
                  {suspended ? <PlayCircle size={14} /> : <PauseCircle size={14} />}
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="review-body">
          {!current ? (
            <div className="review-empty">
              {deckCards.length === 0 ? (
                <>
                  <GraduationCap size={42} style={{ opacity: 0.15, marginBottom: 10 }} />
                  <div className="empty-state-title">No flashcards {deck !== 'all' ? 'in this deck' : 'yet'}</div>
                  <div className="empty-state-hint" style={{ maxWidth: 380, lineHeight: 1.7 }}>
                    Write cards in any note:<br />
                    <code>Question ?? Answer</code> — basic card<br />
                    <code>Wort ??? word</code> — both directions<br />
                    <code>{'The capital is {{Paris}}'}</code> — cloze<br />
                    A paragraph, then <code>??</code> on its own line, then the answer — multi-line card
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: '2.2rem', marginBottom: 8 }}>🎉</div>
                  <div className="empty-state-title">
                    {mode === 'quiz' ? 'Quiz complete!' : mode === 'daily' ? 'Daily deck complete! 🌙' : 'All caught up!'}
                  </div>
                  <div className="empty-state-hint">
                    {reviewed > 0
                      ? `${reviewed} ${mode !== 'due' ? 'answers' : 'reviews'} · ${accuracy}% correct · ${minutes} min`
                      : mode === 'daily' ? 'Every card answered today. They return tomorrow.' : 'Nothing due in this deck.'}
                  </div>
                  {mode === 'daily' && (
                    <div className="daily-done-note">
                      Deliberately no repeat — spacing is what makes it stick.<br />
                      Want more right now? <button className="daily-quiz-link" onClick={() => setMode('quiz')}><Zap size={11} /> Quiz mode</button> never touches your schedule.
                    </div>
                  )}
                  {mode === 'quiz' ? (
                    <button className="quiz-btn" style={{ marginTop: 16 }} onClick={() => rebuildQueue(storeRef.current, deckCards, 'quiz')}>
                      <Zap size={13} /> Quiz again
                    </button>
                  ) : mode === 'due' && fc.some(n => n > 0) && (
                    <div className="review-forecast">
                      {fc.map((n, i) => (
                        <div key={i} className="forecast-day" title={i === 0 ? 'today' : `+${i}d`}>
                          <div className="forecast-bar" style={{ height: `${Math.min(40, n * 6 + (n > 0 ? 4 : 0))}px` }} />
                          <span>{i === 0 ? 'now' : `+${i}`}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="review-card">
              {current.type === 'cloze' && <span className="review-cloze-badge">cloze</span>}
              <CardMarkdown className="review-front" text={current.front} />
              {revealed ? (
                <>
                  <div className="review-divider" />
                  <CardMarkdown className="review-back" text={current.back} />
                  <div className="review-grades">
                    {GRADES.map(g => (
                      <button key={g.q} className={`review-grade ${g.cls}`} onClick={() => grade(g.q)}>
                        <span>{g.label}</span>
                        {mode === 'due' && <span className="grade-interval">{intervalLabel(currentState, g.q, todayISO)}</span>}
                        <kbd>{g.hint}</kbd>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <button className="review-reveal" onClick={() => setRevealed(true)}>
                  <Eye size={14} /> Show answer <kbd>space</kbd>
                </button>
              )}
              <button className="review-source" onClick={() => openFile(current.notePath)} title="Open source note">
                <FileText size={11} /> {current.notePath.split(/[/\\]/).pop()?.replace(/\.md$/, '')}
              </button>
              <div className="review-card-actions">
                {undoRef.current && (
                  <button onClick={undo} title="Undo last review (u)"><Undo2 size={11} /> undo</button>
                )}
                <button onClick={suspendCurrent} title="Suspend this card"><PauseCircle size={11} /> suspend</button>
                {queue.length > 1 && (
                  <button onClick={() => { setQueue(p => [...p.slice(1), p[0]]); setRevealed(false); }} title="Skip to end of queue">
                    <RotateCcw size={11} /> skip
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
