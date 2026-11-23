import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  RELEASE_STAMP,
  releaseStamp,
  sourceDigest,
  verifyReleaseReady,
} from '../scripts/release-readiness.mjs';

const roots: string[] = [];

function write(root: string, path: string, contents = 'x'): void {
  const destination = join(root, ...path.split('/'));
  mkdirSync(join(destination, '..'), { recursive: true });
  writeFileSync(destination, contents);
}

function releaseFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'afyx-release-ready-'));
  roots.push(root);
  for (const path of [
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'src/index.ts',
    'ui/index.html',
    'ui/package.json',
    'ui/src/index.ts',
    'ui/tsconfig.json',
    'ui/vite.config.ts',
  ]) write(root, path);

  write(root, 'dist/bin/afyx-graph.js');
  write(root, 'dist/index.js');
  write(root, 'dist/index.js.map');
  write(root, 'dist/db/schema.sql');
  write(root, 'dist/ui/shimmer-progress.js');
  write(root, 'dist/viewer/assets/app.js');
  write(
    root,
    'dist/viewer/index.html',
    `<html><body><div id="app">${'complete'.repeat(30)}</div><script src="assets/app.js"></script></body></html>`,
  );
  write(root, `dist/${RELEASE_STAMP}`, JSON.stringify(releaseStamp(sourceDigest(root))));
  return root;
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('release readiness gate', () => {
  it('accepts a complete distribution bound to its exact source inputs', () => {
    expect(verifyReleaseReady(releaseFixture()).sourceDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects incomplete output and source changes after a successful build', () => {
    const incomplete = releaseFixture();
    rmSync(join(incomplete, 'dist', 'db'), { recursive: true, force: true });
    expect(() => verifyReleaseReady(incomplete)).toThrow(/missing dist\/db\/schema\.sql/);

    const stale = releaseFixture();
    write(stale, 'src/index.ts', 'changed');
    expect(() => verifyReleaseReady(stale)).toThrow(/not built from the current release inputs/);
  });
});
