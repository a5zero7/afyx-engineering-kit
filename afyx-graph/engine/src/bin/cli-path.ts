import * as path from 'path';
import { isInitialized } from '../directory';

/** Resolve an explicit/cwd path, preferring the nearest initialized ancestor. */
export function resolveCliProjectPath(pathArg?: string): string {
  const absolutePath = path.resolve(pathArg || process.cwd());
  if (isInitialized(absolutePath)) return absolutePath;

  let current = absolutePath;
  const root = path.parse(current).root;
  while (current !== root) {
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
    if (isInitialized(current)) return current;
  }
  return absolutePath;
}
