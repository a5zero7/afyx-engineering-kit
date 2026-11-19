import * as fs from 'fs';
import * as path from 'path';
import { isInitialized } from '../directory';

/** Resolve the closest index without crossing a Git boundary for an explicit path. */
export function resolveCliProjectPath(pathArg?: string): string {
  const absolutePath = path.resolve(pathArg || process.cwd());
  let current = absolutePath;
  if (pathArg) {
    // Follow aliases before deciding which checkout owns the requested path.
    try {
      current = fs.realpathSync.native(absolutePath);
    } catch {
      return absolutePath;
    }
  }

  while (true) {
    if (isInitialized(current)) return current;
    // Git directories and gitfiles (including linked worktrees) both mark a boundary.
    if (pathArg && fs.existsSync(path.join(current, '.git'))) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return absolutePath;
}
