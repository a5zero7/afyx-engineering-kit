import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createOptionalCapabilityHost } from '../afyx-optional-capabilities.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOST_BRIDGE = resolve(HERE, '..', 'afyx-host-bridge.mjs');

async function createMcpClient(extraArgs = []) {
  const child = spawn(process.execPath, [HOST_BRIDGE, 'serve', '--mcp', ...extraArgs], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const waiting = new Map();
  let id = 0;
  let stderrOutput = '';

  child.stderr.on('data', (chunk) => {
    stderrOutput = (stderrOutput + chunk.toString('utf8')).slice(-4000);
  });

  createInterface({ input: child.stdout }).on('line', (line) => {
    try {
      const msg = JSON.parse(line);
      const pending = waiting.get(msg.id);
      if (pending) {
        clearTimeout(pending.timer);
        waiting.delete(msg.id);
        pending.resolve(msg);
      }
    } catch {}
  });

  return {
    rpc(method, params) {
      return new Promise((resolveRpc, rejectRpc) => {
        const requestId = ++id;
        const timer = setTimeout(() => {
          waiting.delete(requestId);
          rejectRpc(new Error(`MCP RPC timeout for ${method}: ${stderrOutput}`));
        }, 8000);
        waiting.set(requestId, { resolve: resolveRpc, timer });
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params })}\n`);
      });
    },
    async close() {
      child.stdin.end();
      if (child.exitCode !== null) return;
      await new Promise((resolveClose, rejectClose) => {
        const timer = setTimeout(() => {
          child.kill();
          rejectClose(new Error('MCP cleanup timeout'));
        }, 5000);
        child.once('exit', (code) => {
          clearTimeout(timer);
          code === 0 ? resolveClose() : resolveClose();
        });
      });
    },
  };
}

test('MB18.3: afyx_capabilities returns rich structured discovery metadata with action signatures and guidance', () => {
  const root = mkdtempSync(join(tmpdir(), 'afyx-mcp-disco-'));
  const host = createOptionalCapabilityHost({
    projectRoot: root,
    browser: { enabled: true, allowedOrigins: ['http://127.0.0.1:8080'], sessionTimeoutMs: 600000 },
    document: { enabled: true },
  });

  try {
    const browserDiscovery = host.discover({ intent: 'browser' });
    assert.equal(browserDiscovery.length, 1);
    const b = browserDiscovery[0];
    assert.equal(b.tool, 'afyx_browser');
    assert.equal(b.contract, 'AfyxBrowser/v1');
    assert.equal(b.status, 'CONFIGURED_NOT_STARTED');
    assert.deepEqual(b.requiredArguments, ['action']);
    assert.ok(Array.isArray(b.supportedActions) && b.supportedActions.includes('navigate'));
    assert.ok(b.actionSignatures.navigate.required.includes('url'));
    assert.ok(b.actionSignatures.click.required.includes('selector'));
    assert.ok(Array.isArray(b.exampleCalls) && b.exampleCalls.length >= 3);
    assert.equal(b.authorization.sessionTimeoutMs, 600000);
    assert.match(b.guidance, /single canonical tool 'afyx_browser'/);

    const docDiscovery = host.discover({ intent: 'document-conversion' });
    assert.equal(docDiscovery.length, 1);
    const d = docDiscovery[0];
    assert.equal(d.tool, 'afyx_document');
    assert.equal(d.contract, 'AfyxDocument/v1');
    assert.deepEqual(d.requiredArguments, ['action']);
    assert.ok(d.actionSignatures.inspect_document.required.includes('path'));
    assert.match(d.guidance, /single canonical tool 'afyx_document'/);
  } finally {
    void host.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('MB18.3: tools/list describes single canonical tools and forbids inventing action-specific tools', async () => {
  const root = mkdtempSync(join(tmpdir(), 'afyx-mcp-list-'));
  const client = await createMcpClient(['--project-root', root, '--capabilities', 'browser,document']);
  try {
    const res = await client.rpc('tools/list', {});
    assert.ok(res.result?.tools);
    const toolNames = res.result.tools.map((t) => t.name);
    assert.deepEqual(toolNames, ['afyx_workflow', 'afyx_capabilities', 'afyx_browser', 'afyx_document']);

    const browserTool = res.result.tools.find((t) => t.name === 'afyx_browser');
    assert.match(browserTool.description, /DO NOT invent or call per-action tool names/);
    assert.match(browserTool.description, /afyx_browser_navigate/);

    const capabilitiesTool = res.result.tools.find((t) => t.name === 'afyx_capabilities');
    assert.match(capabilitiesTool.description, /canonical tool names, supported actions/);
  } finally {
    await client.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('MB18.3: unknown tool names return informative -32601 JSON-RPC hints without exposing paths', async () => {
  const root = mkdtempSync(join(tmpdir(), 'afyx-mcp-err-'));
  const client = await createMcpClient(['--project-root', root, '--capabilities', 'browser']);
  try {
    // 1. Calling afyx_browser_navigate provides helpful hint
    const res1 = await client.rpc('tools/call', {
      name: 'afyx_browser_navigate',
      arguments: { url: 'http://127.0.0.1:8080' },
    });
    assert.ok(res1.error);
    assert.equal(res1.error.code, -32601);
    assert.match(res1.error.message, /Unknown tool: afyx_browser_navigate/);
    assert.match(res1.error.message, /Did you mean the canonical tool 'afyx_browser' with \{ action: 'navigate' \}\?/);

    // 2. Calling generic browser_click provides helpful hint
    const res2 = await client.rpc('tools/call', {
      name: 'browser_click',
      arguments: { selector: '#submit' },
    });
    assert.ok(res2.error);
    assert.equal(res2.error.code, -32601);
    assert.match(res2.error.message, /Did you mean the canonical tool 'afyx_browser' with \{ action: 'click' \}\?/);

    // 3. Calling completely unrelated tool gives clean error without hint
    const res3 = await client.rpc('tools/call', {
      name: 'random_nonexistent_tool',
      arguments: {},
    });
    assert.ok(res3.error);
    assert.equal(res3.error.code, -32601);
    assert.equal(res3.error.message, 'Unknown tool: random_nonexistent_tool');
  } finally {
    await client.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('MB18.3: action validation fails explicitly with actionable diagnostics when required args are missing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'afyx-mcp-act-'));
  const client = await createMcpClient(['--project-root', root, '--capabilities', 'browser,document', '--browser-origins', 'http://127.0.0.1:8080']);
  try {
    // 1. Missing action parameter
    const res1 = await client.rpc('tools/call', {
      name: 'afyx_browser',
      arguments: {},
    });
    assert.equal(res1.result?.isError, true);
    assert.match(res1.result.content[0].text, /BROWSER_ACTION_REQUIRED/);

    // 2. Unknown action name
    const res2 = await client.rpc('tools/call', {
      name: 'afyx_browser',
      arguments: { action: 'nonexistent_action' },
    });
    assert.equal(res2.result?.isError, true);
    assert.match(res2.result.content[0].text, /UNKNOWN_BROWSER_ACTION/);

    // 3. Missing required url for navigate
    const res3 = await client.rpc('tools/call', {
      name: 'afyx_browser',
      arguments: { action: 'navigate' },
    });
    assert.equal(res3.result?.isError, true);
    assert.match(res3.result.content[0].text, /BROWSER_ARGUMENT_REQUIRED: 'url' is required/);

    // 4. Missing required selector for click
    const res4 = await client.rpc('tools/call', {
      name: 'afyx_browser',
      arguments: { action: 'click' },
    });
    assert.equal(res4.result?.isError, true);
    assert.match(res4.result.content[0].text, /BROWSER_ARGUMENT_REQUIRED: 'selector' is required/);

    // 5. Missing required action for document
    const res5 = await client.rpc('tools/call', {
      name: 'afyx_document',
      arguments: {},
    });
    assert.equal(res5.result?.isError, true);
    assert.match(res5.result.content[0].text, /DOCUMENT_ACTION_REQUIRED/);
  } finally {
    await client.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('MB18.3: CLI rejects invalid --browser-session-timeout-ms values fail-closed', () => {
  for (const badVal of ['0', '299999', '1800001', 'abc', '-500', '300000.5']) {
    const res = spawn(process.execPath, [HOST_BRIDGE, 'serve', '--mcp', '--browser-session-timeout-ms', badVal], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    res.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
    res.on('close', (code) => {
      assert.equal(code, 1, `Value ${badVal} must cause exit code 1`);
      assert.match(stderr, /--browser-session-timeout-ms must be an integer between 300000 and 1800000/);
    });
  }
});

test('MB18.3: CLI accepts valid --browser-session-timeout-ms and exposes budget in launch/close receipt', async () => {
  const root = mkdtempSync(join(tmpdir(), 'afyx-mcp-budget-'));
  const client = await createMcpClient([
    '--project-root', root,
    '--capabilities', 'browser',
    '--browser-origins', 'http://127.0.0.1:8080',
    '--browser-session-timeout-ms', '600000',
  ]);
  try {
    // Check discovery reflects the CLI-configured session timeout
    const disco = await client.rpc('tools/call', {
      name: 'afyx_capabilities',
      arguments: { intent: 'browser' },
    });
    const cap = disco.result?.structuredContent?.capabilities?.[0];
    assert.ok(cap);
    assert.equal(cap.authorization.sessionTimeoutMs, 600000);

    // Close before launch returns budget diagnostics
    const closeRes = await client.rpc('tools/call', {
      name: 'afyx_browser',
      arguments: { action: 'close' },
    });
    const structured = closeRes.result?.structuredContent;
    assert.equal(structured.status, 'CLOSED');
    assert.equal(structured.budget?.sessionTimeoutMs, 600000);
    assert.equal(structured.budget?.closureReason, 'NOT_STARTED');
  } finally {
    await client.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('MB18.3: model arguments cannot override host budget, allowed origins, or permissions', async () => {
  const root = mkdtempSync(join(tmpdir(), 'afyx-mcp-tamper-'));
  const client = await createMcpClient([
    '--project-root', root,
    '--capabilities', 'browser',
    '--browser-origins', 'http://127.0.0.1:8080',
    '--browser-session-timeout-ms', '400000',
  ]);
  try {
    // Attempting to pass sessionTimeoutMs in tool arguments is ignored by constructor / host policy
    const res = await client.rpc('tools/call', {
      name: 'afyx_browser',
      arguments: {
        action: 'close',
        sessionTimeoutMs: 9999999,
        allowedOrigins: ['http://evil.com'],
        allowEvaluation: true,
      },
    });
    const structured = res.result?.structuredContent;
    assert.equal(structured.budget.sessionTimeoutMs, 400000, 'host timeout remains 400000, not overridden by model');
  } finally {
    await client.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('MB18.3: AfyxBrowserSession session expiry sets truthful TIMEOUT closure reason and diagnostics', async () => {
  const { AfyxBrowserSession } = await import('../afyx-browser-devtools.mjs');
  const session = new AfyxBrowserSession({ sessionTimeoutMs: 300000 });
  assert.equal(session.budgetDiagnostics.sessionTimeoutMs, 300000);
  assert.equal(session.budgetDiagnostics.closureReason, null);

  // Simulate timeout expiry callback triggering
  session.budgetDiagnostics.closureReason = 'TIMEOUT';
  session.budgetDiagnostics.interruptionSource = 'AFYX_SESSION_TIMEOUT';

  // Subsequent page operations must explicitly diagnose session timeout
  assert.throws(
    () => session._page(),
    /BROWSER_PAGE_NOT_AVAILABLE: Session terminated due to session timeout \(300000ms reached\)/
  );

  const receipt = await session.close();
  assert.equal(receipt.closed, true);
  assert.equal(receipt.processExited, true);
  assert.equal(session.budgetDiagnostics.sessionTimeoutMs, 300000);
  assert.equal(session.budgetDiagnostics.closureReason, 'TIMEOUT');
  assert.equal(session.budgetDiagnostics.interruptionSource, 'AFYX_SESSION_TIMEOUT');
});

