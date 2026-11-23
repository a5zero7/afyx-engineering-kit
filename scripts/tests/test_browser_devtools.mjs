import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { findChromeBinary, AfyxBrowserSession } from '../afyx-browser-devtools.mjs';

test('findChromeBinary detects local Chromium or Edge binary on host', () => {
  const binary = findChromeBinary();
  // On Windows build host, Edge or Chrome is installed
  if (process.platform === 'win32') {
    assert.ok(binary !== null, 'Browser binary should be found on Windows test host');
    assert.ok(existsSync(binary), 'Detected binary path must exist on disk');
  }
});

test('AfyxBrowserSession enforces safe URL scheme validation', async () => {
  const session = new AfyxBrowserSession({ headless: true });
  await assert.rejects(
    async () => {
      await session.navigate('javascript:alert(1)');
    },
    /Invalid URL scheme/
  );
  await assert.rejects(
    async () => {
      await session.navigate('data:text/html,<b>hi</b>');
    },
    /Invalid URL scheme/
  );
});

test('AfyxBrowserSession lifecycle: launch, evaluate, inspect, and clean teardown', async (t) => {
  const binary = findChromeBinary();
  if (!binary) {
    // Skip live execution if no browser is present in container/environment
    t.skip('NOT TESTED: Chrome/Chromium executable unavailable'); return;
  }

  const session = new AfyxBrowserSession({ headless: true, chromePath: binary, allowEvaluation: true });
  let dir = null;

  try {
    const info = await session.launch();
    assert.ok(info.port > 0, 'Port must be a positive integer');
    assert.ok(info.wsUrl, 'WebSocket URL must be present');
    assert.ok(session.userDataDir, 'Temporary user data dir must be populated');
    dir = session.userDataDir;
    assert.ok(existsSync(dir), 'User data directory must exist while running');

    // Test Navigation to about:blank
    await session.navigate('about:blank');

    // Test JavaScript evaluation
    const sum = await session.evaluate('2 + 3');
    assert.equal(sum, 5);

    const docTitle = await session.evaluate('document.title = "AFYX Test"; document.title');
    assert.equal(docTitle, 'AFYX Test');

    // Test page inspection
    const inspection = await session.inspectPage();
    assert.equal(inspection.url, 'about:blank');
    assert.equal(inspection.title, 'AFYX Test');
    assert.ok(inspection.summary);
  } finally {
    await session.close();
  }

  // Verify that ephemeral profile directory is cleaned up deterministically
  if (dir) {
    assert.equal(existsSync(dir), false, 'User data directory must be deleted after close()');
  }
});
