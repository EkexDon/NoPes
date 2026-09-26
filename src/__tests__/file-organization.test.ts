import { describe, expect, it } from 'vitest';
import { canMoveInto, isDirectChild, normalizeTag, parentPath } from '../fileOrganization';

describe('Finder file organization rules', () => {
  it('calculates parents and direct children for vault paths', () => {
    expect(parentPath('/vault/Projects/Idea.md')).toBe('/vault/Projects');
    expect(isDirectChild('/vault/Projects/Idea.md', '/vault/Projects')).toBe(true);
    expect(isDirectChild('/vault/Projects/Deep/Idea.md', '/vault/Projects')).toBe(false);
  });

  it('normalizes tags consistently before writing them into notes', () => {
    expect(normalizeTag(' #Project Planning! ')).toBe('project-planning');
    expect(normalizeTag('#Ärger')).toBe('ärger');
    expect(normalizeTag('###')).toBe('');
  });

  it('prevents moving a folder into itself or its descendants', () => {
    expect(canMoveInto('/vault/Projects', '/vault/Archive')).toBe(true);
    expect(canMoveInto('/vault/Projects', '/vault/Projects')).toBe(false);
    expect(canMoveInto('/vault/Projects', '/vault/Projects/Done')).toBe(false);
  });
});
