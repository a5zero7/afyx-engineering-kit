import { realpathSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PRODUCT_NAME } from '../product';
import { VIEWER_PATH_ENV } from './constants';

export { VIEWER_PATH_ENV };

export class ViewerMissingError extends Error {
  constructor(searched: readonly string[]) {
    const locations = searched.map((dir) => `  ${dir}`).join('\n');
    super(
      `${PRODUCT_NAME} viewer assets were not found.\nChecked:\n${locations}\n\n` +
        `Reinstall ${PRODUCT_NAME} or run "npm run build" in a source checkout.`,
    );
    this.name = 'ViewerMissingError';
  }
}

export function viewerDirCandidates(): string[] {
  const explicit = process.env[VIEWER_PATH_ENV]?.trim();
  const defaults = [
    join(__dirname, '..', 'viewer'),
    join(__dirname, '..', '..', 'dist', 'viewer'),
  ];
  return explicit ? [resolve(explicit), ...defaults] : defaults;
}

export function resolveViewerDir(): string {
  const candidates = viewerDirCandidates();
  for (const dir of candidates) {
    try {
      if (statSync(join(dir, 'index.html')).isFile()) {
        return realpathSync(dir);
      }
    } catch {
      continue;
    }
  }
  throw new ViewerMissingError(candidates);
}
