export interface DisposableEditor {
  destroy: () => void;
  isDestroyed?: boolean;
  commands?: {
    clearFolding?: () => void;
  };
}

/**
 * Safely tear down a TipTap editor instance.
 * 
 * Guards against:
 * - Double-destroy (React Strict Mode, fast tab switching)
 * - Missing clearFolding command
 * - Exceptions during cleanup
 * 
 * Returns null so callers can clear their ref in one line:
 *   editorRef.current = disposeEditorInstance(editorRef.current);
 */
export function disposeEditorInstance(editor: DisposableEditor | null | undefined): null {
  if (!editor) return null;

  // Guard: already destroyed (React StrictMode can fire cleanup twice)
  if (editor.isDestroyed) {
    console.warn('[editorLifecycle] Skipped destroy — editor already destroyed.');
    return null;
  }

  try {
    editor.commands?.clearFolding?.();
  } catch (e) {
    console.warn('[editorLifecycle] Failed to clear folding before destroy:', e);
  }

  try {
    editor.destroy();
  } catch (e) {
    console.warn('[editorLifecycle] Error during editor.destroy():', e);
  }

  return null;
}
