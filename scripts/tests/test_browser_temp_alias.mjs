import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AfyxBrowserSession, findChromeBinary } from '../afyx-browser-devtools.mjs';

test('owned browser profile uses the canonical temporary parent when system temp is an alias', { timeout: 20000 }, async (t) => {
  const chromePath = findChromeBinary();
  if (!chromePath) { t.skip('NOT TESTED: compatible browser unavailable for temp-alias lifecycle'); return; }
  const parent = realpathSync(tmpdir());
  const fixture = mkdtempSync(join(parent, 'afyx-browser-alias-fixture-'));
  const actual = join(fixture, 'actual'); const alias = join(fixture, 'alias');
  mkdirSync(actual); symlinkSync(actual, alias, process.platform === 'win32' ? 'junction' : 'dir');
  const saved = Object.fromEntries(['TEMP', 'TMP', 'TMPDIR'].map((name) => [name, process.env[name]]));
  const session = new AfyxBrowserSession({ chromePath }); let profile;
  try {
    for (const name of Object.keys(saved)) process.env[name] = alias;
    assert.notEqual(tmpdir(), realpathSync(tmpdir()), 'fixture must exercise a real system-temp alias');
    await session.launch(); profile = session.userDataDir;
    assert.equal(dirname(profile), realpathSync(actual));
    assert.equal(lstatSync(profile).isSymbolicLink(), false);
    assert.equal((await session.inspectPage()).url, 'about:blank');
    assert.deepEqual(await session.close(), { closed: true, processExited: true, profileRemoved: true });
    assert.equal(existsSync(profile), false);
  } finally {
    try { await session.close(); }
    finally {
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name]; else process.env[name] = value;
      }
      assert.equal(dirname(fixture), parent); assert.equal(lstatSync(fixture).isSymbolicLink(), false);
      rmSync(fixture, { recursive: true, force: true });
    }
  }
});

test('profile cleanup still rejects a symlink instead of following it into another directory', async () => {
  const parent = realpathSync(tmpdir());
  const foreign = mkdtempSync(join(parent, 'afyx-browser-preserve-fixture-'));
  const marker = join(foreign, 'owner-marker.txt'); writeFileSync(marker, 'preserve');
  const link = join(parent, `afyx-browser-session-${randomUUID()}`);
  symlinkSync(foreign, link, process.platform === 'win32' ? 'junction' : 'dir');
  const session = new AfyxBrowserSession(); session.userDataDir = link;
  try {
    await assert.rejects(session.close(), /BROWSER_PROFILE_OWNERSHIP_FAILED/);
    assert.equal(readFileSync(marker, 'utf8'), 'preserve');
    assert.equal(lstatSync(link).isSymbolicLink(), true);
  } finally {
    session.userDataDir = null;
    assert.equal(dirname(link), parent); unlinkSync(link);
    assert.equal(dirname(foreign), parent); assert.equal(lstatSync(foreign).isSymbolicLink(), false);
    rmSync(foreign, { recursive: true, force: true });
  }
});
