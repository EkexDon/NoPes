# 📖 The Complete NoPes Tutorial

Everything NoPes can do and exactly how to use it — from your first note to a vault that captures your thoughts, manages your tasks, and quizzes you back. Fifteen minutes to read, a lifetime of second brain.

> **The one idea behind everything:** your vault is just a folder of markdown files on your machine. Every feature below reads and writes those plain files. No cloud, no account — close NoPes and open the same files in any editor, and nothing is locked away.

---

## 1. First Steps

### Open a vault
Launch NoPes and click **Open Vault** — pick any folder (empty or full of existing `.md` files). That folder is now your vault. NoPes remembers it.

### The layout
- **Left rail** — icons for every view: Home, Editor, Canvas, Graph, Split view, Journal, Kanban, Tasks, Review, Search, Chat, Sidebar toggle. Settings lives at the bottom.
- **Sidebar** (`⌘B`) — your file tree. Create notes and folders, rename inline, drag files into folders, star favorites. Nopi, your vault pet, lives at the bottom and levels up as you write.
- **Main area** — whatever view you're in. Open notes appear as tabs.
- **Breadcrumbs** — Home → Vault → Folder → Note, always clickable.

### Your first note
`⌘N` creates a note. Just start typing — everything autosaves (400 ms after you stop). The "Saved" indicator sits top-right of the editor.

### The command palette — learn this one first
`⌘K` opens the palette. Type to fuzzy-find any note, run any action ("New Note", "Theme: Midnight", "Open Graph View"), full-text search note contents, or — with AI on — search by *meaning*. When in doubt, `⌘K`.

---

## 2. Writing

The editor is rich but writes pure markdown underneath.

### Formatting
Type markdown and it renders live: `# headings`, `**bold**`, `*italic*`, `- lists`, `> quotes`, tables, code blocks. A bubble toolbar appears when you select text. Click the `▶` next to any heading to **fold** the whole section.

### Slash commands
Type `/` on an empty line for the insert menu:
- **Headings, lists, quotes, code, dividers, tables**
- **Task List** — interactive checkboxes
- **Flashcard** — inserts a `Question ?? Answer` template
- **Query Block** — a live vault query (see §6)
- **Mermaid Diagram** — flowcharts as code
- **Templates** — Daily Note, Meeting Minutes, Bug Report, Code Review, Weekly Review

### Wikilinks — the connective tissue
Type `[[` and pick a note. `[[Project X]]` links there; hover for a preview, click to jump. Link to a note that doesn't exist yet and clicking it creates it. These links power the Graph, backlinks, and Vault Chat context.

### Tags & properties
- `#tag` anywhere in a note tags it — tags drive the Graph filter, task grouping, query blocks, and flashcard decks.
- Start a note with frontmatter and it renders as property chips above the text:
  ```
  ---
  status: active
  project: thesis
  ---
  ```

### Media
Drag images, videos, or PDFs into a note — they're copied to `assets/` and embedded (PDFs get a full scrollable viewer). Drag a `.docx` in and it converts to markdown. **Hover any image → click 🔍 OCR** and the text inside it is extracted below the image, 100% locally (English + German).

### Diagrams & math
- ` ```mermaid ` code block → rendered diagram, with an "Edit Source" toggle.
- `$E = mc^2$` inline or `$$...$$` for display math (KaTeX).

### Voice memos 🎙️
One-time setup: `brew install whisper-cpp`, then **Settings → General → Voice → Download model** (142 MB, once).
Then: click the **mic** in the editor toolbar, speak (German or English — auto-detected), click stop. The transcript appears as a quote in your note plus a link to the audio file. Everything happens on your Mac.

### Zen mode
`⇧⌘Z` — distraction-free, with typewriter scrolling (your cursor stays vertically centered) and particles as you type. Combos reward flow: 10 words = Spark, 50 = Flame, 100 = Supernova.

---

## 3. Never Lose Anything

### Quick Capture — `⌥Space` from anywhere
The single most important habit: press `⌥Space` in *any* app — browser, Slack, a game. A small window pops up; type the thought; Enter. It lands under `## 📥 Captures` in today's daily note, and the window vanishes. `Esc` dismisses, `⇧Enter` makes a new line. There's also a menu-bar icon (Open NoPes / Quick Capture / Quit), and **Settings → Launch at Login** makes capture available from the moment you log in.

### Version History 🕰️
NoPes silently snapshots every note as you edit (about once a minute). Click the **clock icon** in the editor toolbar:
- Left: every saved version with its age.
- Right: a color-coded diff between that version and now (green = added since, red = removed).
- **Restore this version** rolls back — and snapshots your current state first, so restoring is itself undoable.

Deleting a note takes a snapshot first, so even deletes are recoverable. Snapshots live in `.nopes/history/` and are pruned sensibly (hourly for a day, daily for a month, weekly forever).

### Web Clipper 🌐
Send the web into your vault:
1. **Settings → General → Web Clipper** → toggle on → click the token to copy it.
2. In Chrome/Brave/Edge: `chrome://extensions` → Developer mode → **Load unpacked** → pick the `clipper-extension/` folder from the NoPes repo.
3. Open the extension's Options, paste the token, Save.

Now: select text on any page → right-click → **Clip selection to NoPes** (or clip the whole page, or click the toolbar icon). Clips land in `Clips/` with the source URL and a `#clipped` tag. Everything travels via `127.0.0.1` only — your machine, never the internet.

---

## 4. Tasks

Write tasks anywhere, in any note:
```
- [ ] Call the dentist @due(2026-07-15) #errand
- [ ] Finish thesis chapter @due(2026-07-20) #uni
- [x] Done things look like this
```

**`⌘T` opens the Task Dashboard** — every open task from your whole vault:
- Grouped by **due date** (Overdue in red, Today in amber, This week, Later, No date), by **note**, or by **#tag**.
- Click the checkbox to complete a task — the source note is updated (safely: if the note changed since indexing, NoPes refuses rather than corrupting it, refreshes, and you click again).
- Click the note name to jump to the task in context.
- "show done" reveals completed tasks.

Once a day, NoPes sends a notification: *"2 tasks due today · 1 overdue · 12 flashcards to review."*

### Kanban (⌘M)
For project-shaped work, make a board: **Home → New → Kanban** (or add `<!-- KANBAN -->` to a note). `##` headings are columns; `- [ ]` items are cards. Drag cards between columns, add cards inline, toggle them done — the markdown file updates in place, and any prose you write between columns is preserved. Editor and board stay in two-way sync.

---

## 5. Flashcards — Study What You Write 🎓

The headline feature for students. Cards live *inside your notes*:

| Syntax | What you get |
|---|---|
| `What is the powerhouse of the cell ?? The mitochondria` | basic card |
| `das Haus ??? the house` | **two** cards, one per direction — perfect for vocabulary |
| `Die Hauptstadt von Frankreich ist {{Paris}}` | cloze — the `{{...}}` is hidden; every `{{...}}` on a line becomes its own card |
| A question paragraph, then `??` alone on a line, then the answer paragraph | multi-line card for real explanations |

Write them anywhere — lecture notes, book summaries, journal entries. The vault index finds them automatically.

### Studying (⌘R)
Three modes, switchable at the top:

- **due** — real spaced repetition (SM-2, the Anki algorithm). Only cards the algorithm says are due, plus at most 20 new cards per day (the allowance is persistent — restarting doesn't smuggle in 20 more). Each grade button shows *when you'll see the card next* ("Good 6d · Easy 8d"). This is the mode that builds long-term memory: trust it, do it daily.
- **daily** — every card exactly once per day, shuffled. Great for "I just want to go through everything." Finished cards are gone until tomorrow — deliberately, with no repeat button: spacing is what makes memory stick. Progress survives restarts, and cards you write later today still join in.
- **⚡ quiz** — everything, shuffled, unlimited, whenever you want. Never touches your schedule (the amber badge reminds you). *This* is the exam-cram mode; "Again" keeps a card in the session until you actually answer it.

**Controls:** `space` reveals · `1/2/3/4` = Again/Hard/Good/Easy · `u` undoes a misclick · suspend/skip at the card's corners · click the note name to jump to the source.

### Decks (playlists & folders)
The chip bar at the top:
- **All** — everything.
- **Your decks** — click **+ New deck**, name it (e.g. "Bio Klausur"), then in the **Browse** tab use the ➕ button on any card to assign it. A card can be in many decks; deleting a deck never deletes cards.
- **Folder decks** — every vault folder with cards, automatically.
- **#tag decks** — every tag with cards, automatically.

Pick a deck, then study it in any of the three modes — "quiz the whole Uni folder before the exam" is: folder chip → ⚡ quiz.

### Browse tab
Every card with its state (new / due / due-date), ease factor, success/lapse counts, deck memberships, suspend toggle, and a jump to the source note.

### The habit loop
Daily reviews build a 🔥 **streak** (confetti at 7/30/100 days), reviews feed achievements and Nopi's XP, the end-of-session summary shows accuracy and time, and a 7-day forecast shows tomorrow's workload.

---

## 6. Find & Connect

### Search
- `⌘K` — notes by name, full-text content, templates, and (with AI) semantic matches.
- `⌘F` — find within the current note, with match navigation.

### Backlinks panel
At the bottom of every note:
- **Linked Mentions** — notes that `[[link]]` here.
- **Unlinked Mentions** — notes that say this note's *name* in plain text, with a context snippet and a **Link** button that converts every mention into a real wikilink (original casing preserved via alias links).

### Query blocks — saved searches inside notes
Type `/Query Block` and enter filters:
```
tag=#project status=active has=tasks sort=modified limit=10
```
- `tag=#x` — notes with that tag · `key=value` — frontmatter match
- `has=tasks|cards|links` — structural filters · `name=substring`
- `sort=modified|name|words` · `limit=N`

The block renders a live list (name, word count, open tasks, modified date) that updates as your vault changes — a self-maintaining dashboard. Try a "Project Hub" note with one query block per status.

### The Graph (⌘G)
Your vault as a living network. Nodes are notes (colored by first tag), edges are wikilinks. Filter by tag chips, drag nodes, click to open, **double-click empty space to create a note**. Creating a new link while the graph is open fires a particle pulse along the edge.

---

## 7. The Local AI 🧠

Install [Ollama](https://ollama.com) once; NoPes starts and stops it for you (Settings → Enable AI Features). Everything below runs on your hardware — nothing is ever sent anywhere.

- **Vault Chat** (robot icon) — chat with an AI that has read your current note, its backlinks, and everything it links to. Ask "summarize this", "what did I decide about X?", "give me counterarguments".
- **Semantic search** — `⌘K`, then type a *concept*; matching notes appear even if they never use your exact words.
- **AI auto-linking** — as you write, related notes appear as `[[link]]` chips under the note. One click inserts the link; the ✕ dismisses that suggestion for good.
- **AI tag suggestions** — tags from semantically similar notes, one click to add.
- **Weekly Digest** 🗞️ — Sunday evening (or your first launch of the new week), a "Your Week" note appears: what you focused on, patterns between topics, suggestions for next week, plus stats and links to every note you touched. Toggle in Settings.

---

## 8. Views & Visual Thinking

- **Home (⌘H)** — card dashboard of everything: favorites, recents, filters (Notes/Canvas/Kanban/Folders), custom icons (emoji or icon set — click a card's icon), quick create, right-click context menus.
- **Canvas (⌘D)** — an infinite Excalidraw whiteboard stored in your vault. Draw, diagram, mind-map. Put `[[Note Name]]` in a shape's link and clicking it opens the note.
- **Journal (⌘J)** — daily notes (`2026-07-09.md`) with a GitHub-style heatmap of your writing activity. Click any day to open/create that day's note; streaks tracked (and celebrated).
- **Split view** — the ⫿ icon splits the workspace. The right pane has its own view switcher (editor with its own note picker, Home, Canvas, Graph, Journal, Kanban, Tasks, Review) and a draggable divider. Editor left + Kanban right of the same note is a great combo.
- **Themes** — Settings → Appearance, or `⌘K → "Theme"`. Four dark (Obsidian, Midnight, Forest, Rosewood), two light (Paper, Snow). Everything follows: graph, canvas, diagrams, even flashcards.

---

## 9. Privacy & Safety 🔒

- **Vault Lock** — Settings → Security: set a password and NoPes locks on launch and instantly via `⌘L` (works even mid-sentence — it's a panic key). This is a privacy lock for whoever is at your keyboard; the files on disk remain plain markdown. Change or disable it anytime with your current password.
- **PDF export** — the printer icon renders the note (tables, math, diagrams) to a clean PDF with a native save dialog, in print-friendly colors regardless of theme.
- **Your data, inspectable** — everything NoPes knows lives in your vault: notes as `.md`, app state as plain JSON in `.nopes/` (version history, the search/task/card index, flashcard scheduling). Copy the folder = full backup.
- **Resource monitor** — Settings → General shows live memory for the app, the WebView, and Ollama, with switches to turn AI off entirely.

---

## 10. A Day with NoPes

**8:00** — Mac starts, NoPes is in the tray. A notification: *"3 tasks due today · 14 flashcards to review."*
**8:05** — Coffee + `⌘R`. The **due** deck: 14 cards, five minutes, streak day 12 🔥.
**9:30** — Deep work. `⌥Space`: *"idea: cache the index by mtime"* — captured without switching apps.
**11:00** — Meeting. `/Meeting Minutes` template, `- [ ] send follow-up @due(2026-07-10) #work` inline.
**14:00** — Reading. The clipper sends two articles to `Clips/`. On a screenshot of a slide: 🔍 OCR → the text is now searchable.
**16:00** — Writing up: AI suggests `[[Vault Index]]` is related — click, linked. A voice memo dictates a paragraph draft.
**18:00** — `⌘T`: two tasks checked off, one rescheduled.
**Sunday** — *"Your Week is ready 🗞️"*: 23 notes, one theme you didn't notice you had, and three suggestions for Monday.

Everything above happened on one machine, offline.

---

## Appendix A — All Shortcuts

| Keys | Action | | Keys | Action |
|---|---|---|---|---|
| `⌥Space` | Quick Capture (system-wide) | | `⌘F` | Find in note |
| `⌘K` | Command palette | | `⌘L` | Lock vault |
| `⌘H` / `⌘E` / `⌘G` / `⌘D` | Home / Editor / Graph / Canvas | | `⇧⌘Z` | Zen mode |
| `⌘J` / `⌘M` / `⌘T` / `⌘R` | Journal / Kanban / Tasks / Review | | `/` | Slash menu |
| `⌘N` / `⌘W` | New note / Close tab | | `[[` | Wikilink |
| `⌘B` | Toggle sidebar | | `space`, `1–4`, `u` | Review: flip, grade, undo |

## Appendix B — All Inline Syntax

| Syntax | Meaning |
|---|---|
| `[[Note]]`, `[[Note\|shown text]]` | wikilink (with alias) |
| `#tag` | tag |
| `- [ ] task @due(2026-12-31) #tag` | task with due date |
| `Q ?? A` / `Q ??? A` / `{{cloze}}` / `??` on its own line | flashcards |
| `---` frontmatter block | properties |
| ` ```mermaid ` / ` ```nopes-query ` | diagram / live query |
| `$math$`, `$$math$$` | inline / block LaTeX |
| `<!-- CANVAS -->`, `<!-- KANBAN -->` | file opens as canvas / board |

## Appendix C — One-time Setup Checklist

- [ ] Open a vault folder
- [ ] Pick your theme (Settings → Appearance)
- [ ] Try `⌥Space` — enable **Launch at Login** if you love it
- [ ] `brew install ollama` → toggle **AI Features** (chat, semantic search, auto-links, digest)
- [ ] `brew install whisper-cpp` → download the voice model (Settings → General)
- [ ] Load `clipper-extension/` in your browser + paste the token
- [ ] Set a Vault Lock password if others use your machine
- [ ] Write `Anki is obsolete ?? Because my notes ARE the cards` and press `⌘R` 😉
