import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { expect, it } from 'vitest';
import { discoverPeers } from '../src/impact/peer-discovery';

it('discovers only bounded static workspace declarations and direct siblings', () => {
  const scope = mkdtempSync(join(realpathSync(tmpdir()), 'afyx-peers-fixture-'));
  const project = (name: string, marker = 'package.json') => {
    const path = join(scope, name);
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, marker), '{}');
    return path;
  };
  try {
    const root = project('producer');
    project('node/group');
    project('pnpm/group', 'openapi.yaml');
    project('go/group', 'go.mod');
    project('rust/group', 'Cargo.toml');
    project('sibling', 'api.proto');
    project('testing/foreign');
    project('others/unlisted');
    symlinkSync(join(scope, 'others/unlisted'), join(scope, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
    writeFileSync(join(scope, 'package.json'), JSON.stringify({ workspaces: ['node/*', '**/unbounded'] }));
    writeFileSync(join(scope, 'pnpm-workspace.yaml'), 'packages:\n  - "pnpm/*"\n');
    writeFileSync(join(scope, 'go.work'), 'go 1.23\nuse (\n ./go/group\n)\n');
    writeFileSync(join(scope, 'Cargo.toml'), '[workspace]\nmembers = ["rust/*"]\n');
    const reasons: string[] = [];
    const discover = () => discoverPeers(root, scope, reason => reasons.push(reason));
    expect(discover().paths.map(path => relative(scope, path).replaceAll('\\', '/'))).toEqual([
      'go/group', 'node/group', 'pnpm/group', 'rust/group', 'sibling',
    ]);
    expect(reasons).toContain('PEER_WORKSPACE_PATTERN_UNSUPPORTED');
    for (let i = 0; i < 20; i++) project('sibling-' + i.toString().padStart(2, '0'));
    expect(discover()).toMatchObject({ truncated: true });
    expect(discover().paths).toHaveLength(16);
    expect(discoverPeers(root, tmpdir(), () => {}).paths).toEqual([]);
  } finally { rmSync(scope, { recursive: true, force: true }); }
});
