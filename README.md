# NoPes — The High-Performance Second Brain

![NoPes Logo](src-tauri/icons/128x128@2x.png)

**NoPes** is a professional-grade, local-first knowledge management tool designed for speed, privacy, and visual thinking. Built with **Tauri 2.0** and **React**, it combines the power of structured markdown with the freedom of infinite-canvas whiteboarding and local AI.

---

## 🔥 Pro Features

### 🎨 Infinite Canvas (Whiteboard)
Think visually. **NoPes Canvas** integrates [Excalidraw](https://excalidraw.com/) directly into your vault.
- **Link to Notes**: Connect canvas elements to your markdown notes using `[[WikiLinks]]`. Clicking a linked shape instantly opens the relevant note.
- **Auto-Save**: Seamless, debounced persistence to `.excalidraw` files within your vault.
- **Visual Mapping**: Use it for mind maps, architecture diagrams, or freehand brainstorming.

### 🧜‍♂️ Mermaid.js Diagrams
Native rendering for professional diagrams right inside your markdown.
- **Flowcharts, Sequence Diagrams, Gantt Charts**: Just use ```mermaid code blocks.
- **Live Preview + Source Edit**: Toggle between the rendered SVG and the source code for instant adjustments.

### 🤖 Local AI Assistant (Ollama)
Your knowledge base, now with a brain. Powered by local **Ollama** integration.
- **100% Offline**: No API keys, no tracking. All AI operations run on your local hardware.
- **Context Aware**: Chat with your vault, summarize long notes, or brainstorm with an AI that knows your world.

### 📋 Slash Command Templates
Stop staring at a blank page. Typed `/template` to choose from curated professional layouts:
- **Daily Notes** & **Weekly Reviews**
- **Meeting Minutes**
- **Bug Reports** & **Code Reviews**

### 🧊 Advanced Table Editor
A professional table experience that doesn't suck.
- **Custom Toolbar**: Floating controls for adding/deleting rows and columns.
- **Header Toggling**: Quickly switch between standard and header cells.
- **Excel-like Snappiness**: Built on the official TipTap table suite.

### 🔗 Deep Interconnectivity
- **Interactive WikiLinks**: Seamlessly connect thoughts with `[[WikiLinks]]` with instant hover previews.
- **Live Graph View**: Visualize your entire network or a focused "local graph" for the current note.
- **Unlinked Mentions**: Discover hidden connections where you've mentioned a note title but Haven't linked it yet.

---

## 🚀 Speed & Private by Design

- **Local-First**: Your data never leaves your machine. NoPes works directly with `.md` files.
- **Multi-Tab Interface**: Edit multiple notes simultaneously with a familiar, persistent tab bar.
- **Command Bar (Cmd+K)**: Blazing fast navigation via a keyboard-driven command palette.
- **Word to Markdown**: Drag-and-drop `.docx` files for instant, high-fidelity conversion.
- **Rich Media**: Native inline support for PDFs (full scrollable iframe), Videos, and Images.

---

## 📦 Installation (macOS)

1. Download the latest **`.dmg`** from the [Releases](https://github.com/EkexDon/NoPes/releases) page.
2. Drag **NoPes** to your **Applications** folder.
3. Open a folder to serve as your "Vault" and start thinking.

*(Windows and Linux support coming soon)*

---

## 🏗️ Technology Stack

- **Core**: [Tauri 2.0](https://tauri.app/) (Rust Backend)
- **Frontend**: React 19 + TypeScript
- **Visuals**: [Excalidraw](https://excalidraw.com/), [Mermaid.js](https://mermaid.js.org/)
- **Editor**: [TipTap](https://tiptap.dev/) / ProseMirror
- **AI Engine**: [Ollama](https://ollama.com/) (Local Llama 3.2)
- **State**: [Zustand](https://github.com/pmndrs/zustand)
- **Styling**: Vanilla CSS (Premium Dark Mode)

---

## 🛠️ Development

```bash
# Clone & Install
git clone https://github.com/EkexDon/NoPes.git
npm install

# Run Dev Mode
npm run tauri dev

# Build Production
npm run tauri build
```

---

*Local-first. Privacy-first. Thought-first.*
