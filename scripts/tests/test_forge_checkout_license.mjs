import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { PACKAGE_ROOT } from '../afyx-npm-installer.mjs';

const canonicalHash = '2b6d9feeccd4b2fe06c3530972b136d0448b3be163b62fc7bf22355419fdd881';
const hash = data => createHash('sha256').update(data).digest('hex');
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'afyx-forge-checkout-'));
  t.after(() => {
    assert.equal(dirname(root), tmpdir());
    assert.ok(root.startsWith(join(tmpdir(), 'afyx-forge-checkout-')));
    rmSync(root, { recursive: true, force: true });
  });
  const empty = join(root, 'empty-attributes');
  writeFileSync(empty, '');
  const checkout = join(root, 'checkout');
  mkdirSync(checkout);
  const git = spawnSync('git', ['-c', `core.attributesFile=${empty}`, '-c', 'core.eol=crlf',
    '-c', 'core.autocrlf=true', 'checkout-index', `--prefix=${checkout.replaceAll('\\', '/')}/`,
    '--', 'afyx-forge/LICENSE'], { cwd: PACKAGE_ROOT,
    env: { ...process.env, GIT_ATTR_NOSYSTEM: '1' }, encoding: 'utf8', timeout: 30000 });
  assert.ifError(git.error);
  assert.equal(git.status, 0, git.stderr);
  const source = join(checkout, 'afyx-forge');
  for (const name of ['package.json', 'afyx-forge.json', 'src', 'bin', 'contracts']) {
    cpSync(join(PACKAGE_ROOT, 'afyx-forge', name), join(source, name), { recursive: true });
  }
  return { root, source, license: join(source, 'LICENSE') };
}
function stage(root, source) {
  return spawnSync(process.execPath, [join(PACKAGE_ROOT, 'scripts/afyx-forge-artifact.mjs'),
    '--source-root', source, '--stage-dir', join(root, 'staged')],
  { encoding: 'utf8', timeout: 30000 });
}

test('Windows-style checkout preserves the canonical Forge license and stages it unchanged', t => {
  const { root, source, license } = fixture(t);
  const bytes = readFileSync(license);
  assert.equal(hash(bytes), canonicalHash);
  assert.equal(bytes.includes(Buffer.from('\r\n')), false);
  const result = stage(root, source);
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readFileSync(join(root, 'staged/current/LICENSE')), bytes);
});

test('Forge still rejects modified license bytes after checkout', t => {
  const { root, source, license } = fixture(t);
  writeFileSync(license, readFileSync(license, 'utf8').replaceAll('\n', '\r\n'));
  assert.notEqual(hash(readFileSync(license)), canonicalHash);
  const result = stage(root, source);
  assert.ifError(result.error);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /complete Apache-2\.0 license/);
});
