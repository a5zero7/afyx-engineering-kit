import * as fs from 'fs';
import * as path from 'path';
import { isInitialized } from '../directory';

/** Resolve the closest index without crossing a Git boundary for an explicit path. */
export function resolveCliProjectPath(pathArg?: string): string {
  const absolutePath = path.resolve(pathArg || process.cwd());
  if (isInitialized(absolutePath)) return absolutePath;

  let current = absolutePath;
  if (pathArg) {
    // Use physical ancestry for the boundary, including through directory aliases.
    try {
      current = fs.realpathSync.native(absolutePath);
    } catch {
      return absolutePath;
    }
  }

  let requestedPath = absolutePath;
  while (true) {
    if (isInitialized(current)) {
      // Preserve the caller's spelling when it identifies this same directory.
      if (requestedPath !== current && fs.existsSync(requestedPath)
        && fs.realpathSync.native(requestedPath) === current) return requestedPath;
      return current;
    }
    // A .git directory or gitfile marks the boundary of this checkout.
    if (pathArg && fs.existsSync(path.join(current, '.git'))) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
    requestedPath = path.dirname(requestedPath);
  }
  return absolutePath;
}
