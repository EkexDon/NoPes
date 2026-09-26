/** Pure rules shared by the Finder-style Home workspace and its tests. */
export function parentPath(path: string): string {
  return path.split(/[\\/]/).slice(0, -1).join('/') || '/';
}

export function isDirectChild(path: string, parent: string): boolean {
  return parentPath(path) === parent.replace(/[\\/]$/, '');
}

export function normalizeTag(input: string): string {
  return input.trim()
    .replace(/^#/, '')
    .replace(/[^\p{L}\p{N}_/-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

export function canMoveInto(sourcePath: string, targetPath: string): boolean {
  const source = sourcePath.replace(/\\/g, '/').replace(/\/$/, '');
  const target = targetPath.replace(/\\/g, '/').replace(/\/$/, '');
  return source !== target && !target.startsWith(`${source}/`);
}
