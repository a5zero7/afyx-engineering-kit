import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = new URL('../../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const version = JSON.parse(read('package.json')).version;
const cases = [
  [root, 'afyx-engineering-kit', /\[G6 package\] verified Graph archives/],
  [new URL('afyx-graph/engine/', root), '@a5zero7/afyx-graph', /\[release-ready\] PASS/],
];

for (const [cwd, name, diagnostic] of cases) {
  for (const dryRun of [true, false]) {
    test(`${name} pack${dryRun ? ' --dry-run' : ''} keeps diagnostics off stdout`, t => {
      const destination = mkdtempSync(join(tmpdir(), 'afyx-pack-json-'));
      t.after(() => rmSync(destination, { recursive: true, force: true }));
      const args = [process.env.npm_execpath, 'pack', '--json', '--pack-destination', destination];
      if (dryRun) args.push('--dry-run');
      const result = spawnSync(process.execPath, args, {
        cwd: fileURLToPath(cwd), encoding: 'utf8', timeout: 120_000, windowsHide: true,
      });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
      const packages = JSON.parse(result.stdout);
      assert.equal(packages.length, 1);
      const [pkg] = packages;
      assert.equal(pkg.name, name);
      assert.equal(pkg.version, version);
      assert.equal(pkg.filename, `${name.replace(/^@/, '').replace('/', '-')}-${version}.tgz`);
      assert.ok(pkg.files.some(file => file.path === 'LICENSE'));
      assert.match(result.stderr, diagnostic);
      assert.doesNotMatch(result.stdout, diagnostic);
      assert.throws(() => JSON.parse(`${result.stderr}\n${result.stdout}`), SyntaxError);
      if (!dryRun) assert.equal(statSync(join(destination, pkg.filename)).size, pkg.size);
    });
  }
}

test('Kit, Graph, lockfiles, and eight lifecycle entrypoints agree on the release version', () => {
  assert.equal(JSON.parse(read('afyx-graph/afyx-graph.json')).product_version, version);
  assert.equal(JSON.parse(read('afyx-graph/engine/ui/package.json')).version, version);
  for (const prefix of ['', 'afyx-graph/engine/']) {
    assert.equal(JSON.parse(read(prefix + 'package.json')).version, version);
    const lock = JSON.parse(read(prefix + 'package-lock.json'));
    assert.equal(lock.version, version);
    assert.equal(lock.packages[''].version, version);
    if (prefix) assert.equal(lock.packages.ui.version, version);
  }
  for (const command of ['install', 'update', 'verify', 'uninstall']) {
    for (const extension of ['ps1', 'sh']) {
      const path = `${command}.${extension}`;
      assert.ok(read(path).split(/\r?\n/).some(line => !line.trimStart().startsWith('#') &&
        line.includes(`v${version}`)), path);
    }
  }
});
