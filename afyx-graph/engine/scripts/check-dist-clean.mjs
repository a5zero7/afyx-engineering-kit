#!/usr/bin/env node
/**
 * Stale-artifact gate. A test must never pass because an old build artifact
 * happened to be left in dist/ (for example an old CLI entry left behind after
 * the CLI was renamed). Fails when:
 *   - dist/bin/afyx-graph.js is missing (nothing was built), or
 *   - any dist/**\/*.js has no matching src/**\/*.ts (a stale artifact).
 * Run automatically before `npm test`; use `npm run build:clean` to fix.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const dist = path.join(root, 'dist');
const src = path.join(root, 'src');

if (!fs.existsSync(path.join(dist, 'bin', 'afyx-graph.js'))) {
  console.error('dist/bin/afyx-graph.js is missing. Run `npm run build:clean` first.');
  process.exit(1);
}

const stale = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    const relative = path.relative(dist, full).split(path.sep).join('/');
    if (entry.isDirectory()) {
      if (relative === 'viewer') continue; // built UI bundle, not compiled from src/**/*.ts
      walk(full);
    } else if (entry.name.endsWith('.js') && !entry.name.endsWith('.d.js')) {
      const source = path.join(src, relative.replace(/\.js$/, '.ts'));
      if (!fs.existsSync(source)) stale.push(relative);
    }
  }
}
walk(dist);

if (stale.length > 0) {
  console.error(`Stale build artifacts in dist/ (no matching source):\n  ${stale.join('\n  ')}\nRun \`npm run build:clean\`.`);
  process.exit(1);
}
console.log('dist/ is clean: every compiled file has a source and dist/bin/afyx-graph.js exists.');
