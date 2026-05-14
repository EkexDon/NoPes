import { describe, expect, it, vi } from 'vitest';
import { disposeEditorInstance } from '@/components/editorLifecycle';

describe('noteeditor-destroy', () => {
  it('should clear folding then destroy editor instance', () => {
    const clearFolding = vi.fn();
    const destroy = vi.fn();

    const editor = {
      isDestroyed: false,
      commands: { clearFolding },
      destroy,
    };

    const result = disposeEditorInstance(editor);
    expect(clearFolding).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(result).toBeNull();
  });

  it('should still destroy editor when clearFolding throws', () => {
    const clearFolding = vi.fn(() => {
      throw new Error('boom');
    });
    const destroy = vi.fn();

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const editor = {
      isDestroyed: false,
      commands: { clearFolding },
      destroy,
    };

    disposeEditorInstance(editor);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('should NOT call destroy on an already-destroyed editor (double-destroy guard)', () => {
    const destroy = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const editor = {
      isDestroyed: true,
      commands: { clearFolding: vi.fn() },
      destroy,
    };

    const result = disposeEditorInstance(editor);
    expect(destroy).not.toHaveBeenCalled();
    expect(result).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('already destroyed')
    );
    warn.mockRestore();
  });

  it('should handle null/undefined inputs gracefully', () => {
    expect(disposeEditorInstance(null)).toBeNull();
    expect(disposeEditorInstance(undefined)).toBeNull();
  });

  it('should handle missing commands object', () => {
    const destroy = vi.fn();
    const editor = { isDestroyed: false, destroy };
    const result = disposeEditorInstance(editor);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(result).toBeNull();
  });

  it('should handle destroy() throwing an error', () => {
    const destroy = vi.fn(() => {
      throw new Error('destroy failed');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const editor = {
      isDestroyed: false,
      commands: { clearFolding: vi.fn() },
      destroy,
    };

    // Should not throw
    const result = disposeEditorInstance(editor);
    expect(result).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Error during editor.destroy()'),
      expect.any(Error)
    );
    warn.mockRestore();
  });
});
