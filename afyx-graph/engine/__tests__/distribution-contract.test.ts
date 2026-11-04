import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
// The production helper is intentionally plain ESM so release shells can invoke it directly.
// @ts-expect-error JavaScript module has no declaration file.
import {
  artifactManifest,
  artifactPlan,
  DISTRIBUTION_PRODUCT,
  distributionTargets,
  verifyBundle,
} from '../scripts/distribution-contract.mjs';

const roots: string[] = [];

function file(root: string, relative: string, content = 'fixture'): void {
  const target = join(root, ...relative.split('/'));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function bundle(): string {
  const root = mkdtempSync(join(tmpdir(), 'afyx-distribution-'));
  roots.push(root);
  file(root, 'lib/dist/viewer/index.html', `${'<html>'.padEnd(210, ' ')}<div id="app"></div><script src="./assets/app.js"></script>`);
  file(root, 'lib/dist/viewer/assets/app.js');
  file(root, 'lib/dist/bin/afyx-graph.js');
  file(root, 'lib/dist/index.js');
  file(root, 'lib/dist/index.js.map');
  file(root, 'lib/dist/ui/shimmer-progress.js');
  file(root, 'lib/package.json', JSON.stringify({ name: '@a5zero7/afyx-graph', bin: { 'afyx-graph': './dist/bin/afyx-graph.js' } }));
  file(root, 'metadata.json', JSON.stringify({ product_name: 'Afyx Graph', cli: 'afyx-graph', release_channel: 'technical-alpha' }));
  file(root, 'LICENSE', 'MIT License\n\nCopyright (c) 2026 Afyx\n');
  file(root, 'bin/afyx-graph.cmd', 'where node\nNode.js was not found on PATH\nnode --disable-warning lib\\dist\\bin\\afyx-graph.js');
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('Afyx distribution contract', () => {
  it('owns the supported targets, identity and platform artifact plan', () => {
    expect(distributionTargets()).toEqual([
      'darwin-arm64', 'darwin-x64', 'linux-arm64',
      'linux-x64', 'win32-arm64', 'win32-x64',
    ]);
    expect(DISTRIBUTION_PRODUCT).toMatchObject({
      productName: 'Afyx Graph',
      releaseChannel: 'technical-alpha',
      packageName: '@a5zero7/afyx-graph',
      cli: 'afyx-graph',
      runtime: {
        name: 'Node.js',
        ownership: 'external_platform',
        executable: 'node',
        minimumVersion: '22.5.0',
      },
    });
    expect(artifactPlan('linux-x64')).toMatchObject({
      family: 'linux',
      arch: 'x64',
      bundleName: 'afyx-graph-linux-x64',
      archiveName: 'afyx-graph-linux-x64.tar.gz',
      launcherPath: 'bin/afyx-graph',
    });
    expect(artifactPlan('win32-arm64')).toMatchObject({
      family: 'win32',
      arch: 'arm64',
      archiveName: 'afyx-graph-win32-arm64.zip',
      runtime: { ownership: 'external_platform', minimumVersion: '22.5.0' },
      launcherPath: 'bin/afyx-graph.cmd',
    });
    expect(() => artifactPlan('unsupported-x64')).toThrow(/unsupported target/);
  });

  it('accepts a complete staged bundle and emits a stable sorted manifest', () => {
    const root = bundle();
    expect(verifyBundle(root, 'win32-x64')).toMatchObject({ legalFiles: 1, target: 'win32-x64' });
    const first = artifactManifest(root);
    expect(first).toEqual(artifactManifest(root));
    expect(first.map((entry: { path: string }) => entry.path)).toEqual(first.map((entry: { path: string }) => entry.path).sort());
  });

  it.each([
    ['viewer asset', 'lib/dist/viewer/assets/app.js'],
    ['current product license', 'LICENSE'],
    ['launcher', 'bin/afyx-graph.cmd'],
  ])('rejects a missing %s', (_label, relative) => {
    const root = bundle();
    unlinkSync(join(root, ...relative.split('/')));
    expect(() => verifyBundle(root, 'win32-x64')).toThrow();
  });

  it('rejects development-only content', () => {
    const root = bundle();
    file(root, 'lib/src/stale.ts');
    expect(() => verifyBundle(root, 'win32-x64')).toThrow(/development-only/);
  });

  it.each(['node.exe', 'node'])('rejects bundled Node runtime %s', (runtime) => {
    const root = bundle();
    file(root, runtime);
    expect(() => verifyBundle(root, 'win32-x64')).toThrow(/bundled Node runtime/);
  });

  it('rejects any shipped node_modules tree', () => {
    const root = bundle();
    file(root, 'lib/node_modules/example/index.js');
    expect(() => verifyBundle(root, 'win32-x64')).toThrow(/node_modules/);
  });

  it('rejects a launcher without an actionable external-runtime diagnostic', () => {
    const root = bundle();
    file(root, 'bin/afyx-graph.cmd', 'node lib\\dist\\bin\\afyx-graph.js');
    expect(() => verifyBundle(root, 'win32-x64')).toThrow(/external Node.js runtime contract/);
  });

  it('rejects a staged third-party parser runtime', () => {
    const root = bundle();
    file(root, 'lib/node_modules/web-tree-sitter/tree-sitter.wasm');
    expect(() => verifyBundle(root, 'win32-x64')).toThrow(/parser runtime/);
  });

  it('rejects staged native kernel source or runtime', () => {
    const root = bundle();
    file(root, 'lib/kernel/afyx-graph-kernel.node');
    expect(() => verifyBundle(root, 'win32-x64')).toThrow(/native kernel/);
  });

  it('rejects wrong CLI metadata', () => {
    const root = bundle();
    file(root, 'lib/package.json', JSON.stringify({ name: '@a5zero7/afyx-graph', bin: { 'afyx-graph': './wrong.js' } }));
    expect(() => verifyBundle(root, 'win32-x64')).toThrow(/entrypoint/);
  });
});
