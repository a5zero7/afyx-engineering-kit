/**
 * Node.js version compatibility check.
 *
 * Kept side-effect-free so it is safe to import from tests without triggering
 * CLI bootstrap.
 */

/**
 * Lowest supported Node.js version. Matches the `engines` floor in package.json.
 * Below this, Afyx Graph relies on language features / native APIs
 * that aren't present, and the combination is untested. `engines` alone only
 * *warns* on install (unless the user set `engine-strict`), so the CLI bootstrap
 * also hard-blocks here to actually enforce the floor.
 */
export const MIN_NODE_VERSION = '22.5.0';

const MINIMUM = [22, 5, 0] as const;

/** Return whether a Node version provides the built-in `node:sqlite` backend. */
export function isSupportedNodeVersion(nodeVersion: string): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(nodeVersion);
  if (!match) return false;
  const current = match.slice(1).map(Number);
  for (let index = 0; index < MINIMUM.length; index++) {
    if (current[index]! > MINIMUM[index]!) return true;
    if (current[index]! < MINIMUM[index]!) return false;
  }
  return true;
}

/**
 * Build the bordered banner shown when Afyx Graph detects a Node.js version below
 * {@link MIN_NODE_VERSION}. Pinned via unit test so the recovery commands and the
 * override env var can't be silently stripped by future edits.
 *
 * Uses ASCII glyphs to stay readable on Windows OEM-codepage consoles
 * (see ../ui/glyphs.ts for the rationale).
 */
export function buildNodeTooOldBanner(nodeVersion: string): string {
  const sep = '-'.repeat(72);
  return [
    sep,
    `[Afyx Graph] Unsupported Node.js version: ${nodeVersion}`,
    sep,
    `Afyx Graph requires Node.js ${MIN_NODE_VERSION} or newer. Older versions lack`,
    'language features and native APIs Afyx Graph depends on, and are not',
    'tested or supported.',
    '',
    'Fix: install Node.js 22 LTS:',
    '  nvm install 22 && nvm use 22                          # nvm',
    '  brew install node@22 && brew link --overwrite --force node@22  # Homebrew',
    '',
    'To override (NOT recommended - unsupported):',
    '  AFYX_GRAPH_ALLOW_UNSAFE_NODE=1 afyx-graph ...',
    sep,
  ].join('\n');
}
