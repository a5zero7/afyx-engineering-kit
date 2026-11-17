import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { AfyxBrowserSession, findChromeBinary } from '../afyx-browser-devtools.mjs';

test('host policy denies external attach, private/metadata/file origins and ungated evaluation before CDP', async () => {
  for (const options of [{ port: 9222 }, { wsUrl: 'ws://127.0.0.1:9222' }, { userDataDir: tmpdir() }]) {
    assert.throws(() => new AfyxBrowserSession(options), /EXTERNAL_ATTACH_DENIED/);
  }
  const session = new AfyxBrowserSession();
  for (const url of ['http://127.0.0.1:8000/', 'http://localhost/', 'http://10.0.0.1/', 'http://169.254.169.254/latest/meta-data/', 'https://example.com/']) {
    await assert.rejects(session.navigate(url), /ORIGIN_DENIED/);
  }
  await assert.rejects(session.navigate('file:///C:/private.txt'), /URL_DENIED/);
  await assert.rejects(session.evaluate('document.cookie'), /HOST_AUTHORIZATION_REQUIRED/);
  await assert.rejects(session.send('Runtime.evaluate'), /CDP_DISCONNECTED/);
  assert.throws(() => new AfyxBrowserSession({ allowedOrigins: ['http://localhost/path'] }), /EXACT_ORIGIN/);
  assert.throws(() => new AfyxBrowserSession({ allowedOrigins: ['http://user:secret@localhost/'] }), /EXACT_ORIGIN/);
});

test('diagnostic event buffers are bounded and redact credentials rather than returning headers or objects', () => {
  const session = new AfyxBrowserSession();
  for (let i = 0; i < 300; i++) {
    session._handleMessage({ method: 'Runtime.consoleAPICalled', params: { type: 'log', args: [{ type: 'string', value: 'Bearer secret token=abc password=xyz' }, { type: 'object', description: 'raw secret object' }] } });
    session._handleMessage({ method: 'Network.requestWillBeSent', sessionId: 'page', params: { requestId: String(i), request: { url: `https://user:pass@example.com/api?token=${i}#secret`, method: 'GET', headers: { authorization: 'Bearer sensitive' } } } });
  }
  assert.equal(session.consoleLogs.length, 256);
  assert.equal(session.networkRequests.length, 256);
  const logs = JSON.stringify(session.getConsoleMessages());
  assert.ok(!logs.includes('abc') && !logs.includes('xyz') && !logs.includes('raw secret object'));
  const network = JSON.stringify(session.getNetworkRequests());
  assert.ok(!network.includes('token=') && !network.includes('user:pass') && !network.includes('authorization'));
  assert.throws(() => session.getConsoleMessages({ limit: -1 }), /INVALID_LIMIT/);
  assert.throws(() => session.getNetworkRequests({ limit: 999 }), /INVALID_LIMIT/);
});

test('native command and trace budgets fail truthfully without silently expanding limits', async () => {
  const session = new AfyxBrowserSession({ maxCommands: 1, maxTraceBytes: 128 });
  session.ws = { readyState: 1 };
  session.commandCount = 1;
  await assert.rejects(session.send('Page.enable'), /COMMAND_BUDGET_EXHAUSTED/);
  session.trace = { active: true, events: [], bytes: 0, truncated: false };
  session._handleMessage({ method: 'Tracing.dataCollected', params: { value: [{ name: 'x'.repeat(500), args: { password: 'secret' } }] } });
  assert.equal(session.trace.truncated, true);
  assert.equal(session.trace.events.length, 0);
  await assert.rejects(session.clickAt(-1, 10), /INVALID_COORDINATES/);
  await assert.rejects(session.fillForm([{ selector: '#one', value: 3 }]), /INVALID_FORM/);
});

test('only exact stale Fetch lifecycle responses spare the browser; interception failures remain fail-closed', () => {
  const session = new AfyxBrowserSession(); let closed = 0;
  session._close = async () => { closed++; };
  session.pages.set('old-page', { sessionId: 'gone' });
  session.pages.set('healthy-page', { sessionId: 'alive' }); session.selectedPage = 'old-page';
  session._interceptionFailure({ cdpCode: -32602, cdpMessage: 'Invalid InterceptionId.' }, 'alive');
  session._interceptionFailure({ cdpCode: -32001, cdpMessage: 'Session with given id not found.' }, 'gone');
  assert.equal(closed, 0); assert.equal(session.selectedPage, 'healthy-page');
  assert.equal(session.pages.has('old-page'), false); assert.equal(session.pages.has('healthy-page'), true);
  for (const error of [
    { cdpCode: -32602, cdpMessage: 'Invalid parameters' },
    { cdpCode: -32000, cdpMessage: 'Interception is not enabled' },
    { cdpCode: -32601, cdpMessage: 'Method not found' },
    { cdpCode: -32001, cdpMessage: 'Other session failure' },
    new Error('BROWSER_COMMAND_BUDGET_EXHAUSTED'), new Error('BROWSER_CDP_TIMEOUT:Fetch.failRequest'),
  ]) session._interceptionFailure(error, 'alive');
  assert.equal(closed, 6); assert.equal(session.interceptionDiagnostics.fatalErrors, 6);
});

test('real canceled and closed-page Fetch requests preserve a healthy owned page without widening origin policy', { timeout: 20000 }, async (t) => {
  const chromePath = findChromeBinary(); if (!chromePath) { t.skip('NOT TESTED: compatible Chrome unavailable'); return; }
  const server = createServer((_request, response) => response.end('AFYX lifecycle fixture'));
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const session = new AfyxBrowserSession({ chromePath, allowedOrigins: [origin] });
  try {
    await session.launch(); const healthyPage = session.selectedPage;
    const nativeSend = session.send.bind(session);
    for (const action of ['cancel-request', 'close-page']) {
      let release; let paused;
      const gate = new Promise((done) => { release = done; });
      const seen = new Promise((done) => { paused = done; });
      await session.newPage(); let held = false;
      session.send = async (method, params, sessionId) => {
        if (method === 'Fetch.continueRequest' && !held) { held = true; paused(); await gate; }
        return nativeSend(method, params, sessionId);
      };
      const navigation = session.navigate(origin, { waitUntil: 'none' }).catch((error) => error.message);
      try {
        await seen;
        if (action === 'cancel-request') await nativeSend('Page.stopLoading', {}, session.pages.get(session.selectedPage).sessionId);
        else await nativeSend('Target.closeTarget', { targetId: session.selectedPage });
      } finally { release(); }
      await navigation;
      const expected = action === 'cancel-request' ? 'staleRequests' : 'closedPageSessions';
      const deadline = Date.now() + 2000;
      while (session.interceptionDiagnostics[expected] === 0 && Date.now() < deadline) await new Promise((done) => setTimeout(done, 20));
      assert.ok(session.interceptionDiagnostics[expected] > 0, `must observe reproduced ${action} protocol response`);
      assert.equal(session.interceptionDiagnostics.fatalErrors, 0);
      assert.equal(session.isAttached, true);
      session.send = nativeSend;
      await session.selectPage(healthyPage);
      await session.navigate(origin);
      assert.equal((await session.inspectPage()).url, `${origin}/`);
      await assert.rejects(session.navigate('http://169.254.169.254/latest/meta-data/'), /ORIGIN_DENIED/);
    }
  } finally {
    try { await session.close(); }
    finally { server.closeAllConnections(); await new Promise((done) => server.close(done)); }
  }
});

test('real owned Chrome: pages, DOM, interaction, diagnostics, trace, export and network-denial lifecycle', { timeout: 45000 }, async (t) => {
  const chromePath = findChromeBinary();
  if (!chromePath) { t.skip('NOT TESTED: compatible Chrome unavailable'); return; }
  const directory = mkdtempSync(join(tmpdir(), 'afyx-browser-engineering-'));
  let forbiddenHits = 0;
  const forbidden = createServer((_request, response) => { forbiddenHits++; response.end('should never be fetched'); });
  await new Promise((done) => forbidden.listen(0, '127.0.0.1', done));
  const forbiddenOrigin = `http://127.0.0.1:${forbidden.address().port}`;
  const server = createServer((request, response) => {
    if (request.url.startsWith('/redirect')) { response.writeHead(302, { location: `${forbiddenOrigin}/private` }); response.end(); return; }
    if (request.url.startsWith('/data')) { response.setHeader('content-type', 'application/json'); response.end('{"ok":true}'); return; }
    response.setHeader('content-type', 'text/html');
    response.end(`<!doctype html><title>AFYX MB18 fixture</title><style>button{color:rgb(255,0,0)}</style><h1>Browser acceptance</h1>
      <input id="name"><input id="secret" type="password" value="private-password"><input id="upload" type="file">
      <button id="submit" onclick="document.querySelector('#result').textContent=document.querySelector('#name').value">Apply</button>
      <button id="dialog" onclick="alert('fixture dialog')">Dialog</button>
      <p id="result"></p><a href="/data">Data</a><script>console.log('fixture-ready token=secret');fetch('/data?token=secret');
      fetch('${forbiddenOrigin}/private').catch(()=>console.log('blocked'));setTimeout(()=>console.error('fixture-error'),10);</script>`);
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const session = new AfyxBrowserSession({ chromePath, allowedOrigins: [origin], allowEvaluation: true, exportRoot: directory, uploadRoot: directory });
  let profile;
  try {
    const info = await session.launch(); profile = session.userDataDir;
    assert.ok(info.port > 0 && info.wsUrl.startsWith(`ws://127.0.0.1:${info.port}/devtools/browser/`));
    assert.equal((await session.listPages()).length, 1);
    await session.navigate(origin);
    await session.waitFor('#submit');
    assert.equal((await session.inspectPage()).title, 'AFYX MB18 fixture');
    assert.equal((await session.findElements('#submit'))[0].text, 'Apply');
    await session.hover('#submit');
    await session.fillForm([{ selector: '#name', value: 'native AFYX' }]);
    await session.pressKey('Tab');
    await session.click('#submit');
    assert.equal(await session.evaluate('document.querySelector("#result").textContent'), 'native AFYX');
    const snapshot = await session.snapshot();
    assert.ok(snapshot.nodes.some((node) => node.name === 'Browser acceptance'));
    assert.ok(!JSON.stringify(snapshot).includes('private-password'));
    assert.equal((await session.getComputedStyles('#submit')).color, 'rgb(255, 0, 0)');
    await session.click('#dialog');
    const dialogDeadline = Date.now() + 2000;
    while (!session.dialog && Date.now() < dialogDeadline) await new Promise((done) => setTimeout(done, 20));
    assert.equal(session.dialog.type, 'alert');
    await session.handleDialog({ accept: false });
    const image = await session.takeScreenshot(); assert.ok(Buffer.from(image, 'base64').length > 100);
    const upload = join(directory, 'upload.txt'); writeFileSync(upload, 'AFYX fixture');
    await session.uploadFile('#upload', upload);
    assert.equal(await session.evaluate('document.querySelector("#upload").files[0].name'), 'upload.txt');
    await assert.rejects(session.uploadFile('#upload', join(dirname(directory), 'outside.txt')), /OUTSIDE_SCOPE/);
    await session.traceStart();
    await session.evaluate('(()=>{let n=0;for(let i=0;i<100000;i++)n+=i;return n;})()');
    await assert.rejects(session.traceStart(), /ALREADY_ACTIVE/);
    const trace = await session.traceStop(); assert.ok(trace.eventCount > 0); assert.equal(trace.events, undefined);
    assert.ok(trace.bytes <= 2000000);
    const exported = join(directory, 'trace.json'); await session.exportTrace(exported);
    const traceEvents = JSON.parse(readFileSync(exported, 'utf8')).traceEvents;
    assert.ok(traceEvents.length > 0); assert.ok(traceEvents.every((event) => !('args' in event)));
    await assert.rejects(session.exportTrace(exported), /EEXIST/);
    assert.ok((await session.performanceMetrics()).some((metric) => metric.name === 'Nodes'));
    assert.ok((await session.resourceTiming()).some((entry) => entry.name.endsWith('/data')));
    await session.emulate({ width: 640, height: 480 });
    assert.ok(session.getNetworkRequests().some((entry) => entry.status === 200));
    assert.equal(session.getNetworkRequest(session.getNetworkRequests()[0].requestId).method, 'GET');
    assert.ok(session.getNetworkRequests({ failedOnly: true }).length > 0);
    assert.ok(session.getConsoleMessages().some((entry) => entry.text.includes('fixture-ready')));
    assert.ok(!JSON.stringify(session.getConsoleMessages()).includes('token=secret'));
    const first = session.selectedPage;
    const second = await session.newPage(origin);
    assert.equal((await session.listPages()).length, 2);
    await session.selectPage(first); await session.closePage(second.pageId);
    assert.equal((await session.listPages()).length, 1);
    await assert.rejects(session.click('#missing'), /MISSING_OR_DETACHED/);
    await assert.rejects(session.waitFor('#missing', { timeoutMs: 50 }), /ELEMENT_TIMEOUT/);
    await assert.rejects(session.navigate(`${origin}/redirect`), /NAVIGATION_FAILED|ORIGIN_DENIED/);
    await new Promise((done) => setTimeout(done, 100));
    assert.equal(forbiddenHits, 0, 'subresource and redirect requests must fail before reaching untrusted origin');
  } finally {
    try { await session.close(); }
    finally {
      server.closeAllConnections(); forbidden.closeAllConnections();
      await Promise.all([new Promise((done) => server.close(done)), new Promise((done) => forbidden.close(done))]);
      assert.equal(dirname(directory), resolve(tmpdir())); assert.equal(lstatSync(directory).isSymbolicLink(), false);
      rmSync(directory, { recursive: true, force: true });
    }
  }
  assert.equal(existsSync(profile), false);
  assert.equal(session.process, null);
  assert.equal(session.pendingCallbacks.size, 0);
});

test('real isolated sessions can run concurrently without page/profile ownership overlap', { timeout: 20000 }, async (t) => {
  const chromePath = findChromeBinary(); if (!chromePath) { t.skip('NOT TESTED: compatible Chrome unavailable'); return; }
  const a = new AfyxBrowserSession({ chromePath }); const b = new AfyxBrowserSession({ chromePath });
  try {
    const [one, two] = await Promise.all([a.launch(), b.launch()]);
    assert.notEqual(one.port, two.port); assert.notEqual(a.userDataDir, b.userDataDir);
    await assert.rejects(a.selectPage(b.selectedPage), /PAGE_NOT_AVAILABLE/);
    await Promise.all([a.inspectPage(), b.inspectPage()]);
  } finally { await Promise.all([a.close(), b.close()]); }
});

test('real browser crash rejects subsequent commands and cleans its owned profile', { timeout: 15000 }, async (t) => {
  const chromePath = findChromeBinary(); if (!chromePath) { t.skip('NOT TESTED: compatible Chrome unavailable'); return; }
  const session = new AfyxBrowserSession({ chromePath }); let profile;
  try {
    await session.launch(); profile = session.userDataDir; session.process.kill();
    const deadline = Date.now() + 6000;
    while (existsSync(profile) && Date.now() < deadline) await new Promise((done) => setTimeout(done, 50));
    assert.equal(existsSync(profile), false);
    await assert.rejects(session.inspectPage(), /DISCONNECTED|PAGE_NOT_AVAILABLE/);
  } finally { await session.close(); }
});
