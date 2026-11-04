import { afterEach, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpAceRuntime } from '../src/mcp/ace-runtime';

const originalRuntime = process.env.AFYX_CONTEXT_RUNTIME_ROOT;
const originalState = process.env.AFYX_CONTEXT_STATE_ROOT;
const originalOptIn = process.env.AFYX_CONTEXT_OPT_IN;
const folders: string[] = [];

afterEach(() => {
  if (originalRuntime === undefined) delete process.env.AFYX_CONTEXT_RUNTIME_ROOT;
  else process.env.AFYX_CONTEXT_RUNTIME_ROOT = originalRuntime;
  if (originalState === undefined) delete process.env.AFYX_CONTEXT_STATE_ROOT;
  else process.env.AFYX_CONTEXT_STATE_ROOT = originalState;
  if (originalOptIn === undefined) delete process.env.AFYX_CONTEXT_OPT_IN;
  else process.env.AFYX_CONTEXT_OPT_IN = originalOptIn;
  for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true });
});

const digest = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');

function fakeInstalledAce(): { project: string; runtime: string; bridge: string; state: string } {
  // Use the canonical temp path: on macOS /var is a symlink to /private/var,
  // and the production bridge intentionally refuses symlinked state ancestors.
  const lab = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-native-mcp-')));
  folders.push(lab);
  const project = path.join(lab, 'project');
  fs.mkdirSync(path.join(project, '.afyx-graph'), { recursive: true });
  fs.writeFileSync(path.join(project, '.afyx-graph', 'afyx-graph.db'), '');
  const runtime = path.join(lab, 'installed-context');
  const current = path.join(runtime, 'current');
  const dist = path.join(current, 'dist');
  fs.mkdirSync(dist, { recursive: true });
  const sourceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../afyx-context/src');
  const manifest: string[] = [];
  for (const filename of fs.readdirSync(sourceDir).filter((name) => name.endsWith('.js'))) {
    const bytes = fs.readFileSync(path.join(sourceDir, filename));
    fs.writeFileSync(path.join(dist, filename), bytes);
    manifest.push(digest(bytes) + '  current/dist/' + filename);
  }
  const pkg = Buffer.from('{"type":"module"}\n');
  fs.writeFileSync(path.join(current, 'package.json'), pkg);
  manifest.push(digest(pkg) + '  current/package.json');
  const identity = { source_revision: 'a'.repeat(40), product_version: '0.1.0' };
  const identityBytes = Buffer.from(JSON.stringify(identity));
  fs.writeFileSync(path.join(current, 'identity.json'), identityBytes);
  manifest.push(digest(identityBytes) + '  current/identity.json');
  const manifestBytes = Buffer.from(manifest.sort().join('\n') + '\n');
  fs.writeFileSync(path.join(runtime, 'integrity.sha256'), manifestBytes);
  fs.writeFileSync(path.join(runtime, 'metadata.json'), JSON.stringify({
    product_name: 'Afyx Context Engine', ownership_class: 'AFYX',
    ...identity, artifact_digest: digest(manifestBytes),
  }));
  const state = path.join(lab, 'private-ace-state');
  process.env.AFYX_CONTEXT_RUNTIME_ROOT = runtime;
  process.env.AFYX_CONTEXT_STATE_ROOT = state;
  delete process.env.AFYX_CONTEXT_OPT_IN;
  return { project, runtime, bridge: path.join(dist, 'graph-mcp-bridge.js'), state };
}

test('native Graph MCP runtime reduces repetitive structural output and recovers exactly', async () => {
  const fixture = fakeInstalledAce();
  const runtime = new McpAceRuntime();
  expect(runtime.recoveryAvailable()).toBe(true);
  const original = ('Repeated structural dependency summary for indexed project. ' + 'A'.repeat(85) + '\n').repeat(250);
  const result = { content: [{ type: 'text' as const, text: original }] };
  const optimized = await runtime.maybeOptimize('afyx_graph_inventory', { projectPath: fixture.project }, result, null);
  expect(optimized).not.toBe(result);
  const ref = optimized.content[0]?.text.match(/ace:v1:[0-9a-f]{16}:[0-9a-f]{16}:[0-9a-f]{64}/)?.[0];
  expect(ref).toBeTruthy();
  const recovered = await runtime.recover(ref, fixture.project);
  expect(recovered.isError).toBeUndefined();
  expect(recovered.content[0]?.text).toBe(original);
});

test('explicit OFF, protected output and tampered ACE artifact cannot intercept Graph results', async () => {
  const fixture = fakeInstalledAce();
  const runtime = new McpAceRuntime();
  const original = ('Repeated structural dependency summary for indexed project. ' + 'A'.repeat(85) + '\n').repeat(250);
  const result = { content: [{ type: 'text' as const, text: original }] };
  expect(await runtime.maybeOptimize('afyx_graph_explore', { projectPath: fixture.project }, result, null)).toBe(result);
  const protectedResult = { content: [{ type: 'text' as const, text: 'SECURITY: preserve authoritative evidence.\\n' + original }] };
  expect(await runtime.maybeOptimize('afyx_graph_inventory', { projectPath: fixture.project }, protectedResult, null)).toBe(protectedResult);
  const graphError = { ...result, isError: true };
  expect(await runtime.maybeOptimize('afyx_graph_inventory', { projectPath: fixture.project }, graphError, null)).toBe(graphError);
  expect(fs.existsSync(fixture.state)).toBe(false);
  process.env.AFYX_CONTEXT_OPT_IN = '0';
  expect(runtime.recoveryAvailable()).toBe(false);
  expect(await runtime.maybeOptimize('afyx_graph_inventory', { projectPath: fixture.project }, result, null)).toBe(result);
  delete process.env.AFYX_CONTEXT_OPT_IN;
  fs.appendFileSync(fixture.bridge, '\n// untrusted modification\n');
  expect(runtime.recoveryAvailable()).toBe(false);
  expect(await runtime.maybeOptimize('afyx_graph_inventory', { projectPath: fixture.project }, result, null)).toBe(result);
});

test('unique output and absent ACE do not start an optimizer or create state', async () => {
  const fixture = fakeInstalledAce();
  const runtime = new McpAceRuntime();
  const unique = Array.from({ length: 400 }, (_, i) => ('Unique structural entry ' + i + ' ' + 'X'.repeat(i % 90 + 64))).join('\n');
  const result = { content: [{ type: 'text' as const, text: unique }] };
  expect(await runtime.maybeOptimize('afyx_graph_inventory', { projectPath: fixture.project }, result, null)).toBe(result);
  expect(fs.existsSync(fixture.state)).toBe(false);
  fs.rmSync(fixture.runtime, { recursive: true, force: true });
  expect(runtime.recoveryAvailable()).toBe(false);
  const missing = await runtime.recover('ace:v1:' + 'a'.repeat(16) + ':' + 'b'.repeat(16) + ':' + 'c'.repeat(64), fixture.project);
  expect(missing.isError).toBe(true);
});
