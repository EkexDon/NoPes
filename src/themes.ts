/* Theme registry — ids map to [data-theme] selectors in theme.css.
   'obsidian' is the default (:root, no attribute). */

export type ThemeId = 'obsidian' | 'midnight' | 'forest' | 'rosewood' | 'paper' | 'snow';

export interface ThemeMeta {
  id: ThemeId;
  label: string;
  dark: boolean;
  /* preview swatches for the settings picker: [bg, surface, accent, text] */
  preview: [string, string, string, string];
}

export const THEMES: ThemeMeta[] = [
  { id: 'obsidian', label: 'Obsidian', dark: true,  preview: ['#161616', '#252525', '#7c6dff', '#e8e8e8'] },
  { id: 'midnight', label: 'Midnight', dark: true,  preview: ['#0d1420', '#182335', '#4d9fff', '#dde6f2'] },
  { id: 'forest',   label: 'Forest',   dark: true,  preview: ['#121712', '#1d261d', '#93b878', '#e3e8dd'] },
  { id: 'rosewood', label: 'Rosewood', dark: true,  preview: ['#191210', '#281d19', '#e07856', '#eee2da'] },
  { id: 'paper',    label: 'Paper',    dark: false, preview: ['#f7f3ec', '#eae4d7', '#b05730', '#2c2620'] },
  { id: 'snow',     label: 'Snow',     dark: false, preview: ['#fafbfc', '#eaedf2', '#4666e5', '#1f2430'] },
];

export const DEFAULT_THEME: ThemeId = 'obsidian';

export function isValidTheme(id: string | null): id is ThemeId {
  return !!id && THEMES.some(t => t.id === id);
}

export function isDarkTheme(id: ThemeId): boolean {
  return THEMES.find(t => t.id === id)?.dark ?? true;
}

export function applyThemeToDom(id: ThemeId) {
  if (id === 'obsidian') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', id);
  }
}

/* Read a resolved CSS token off <html> — for canvas/JS consumers
   (GraphView, mermaid) that can't use var() directly. */
export function cssToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
