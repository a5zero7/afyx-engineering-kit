import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const bridge = fileURLToPath(new URL('../src/graph-mcp-bridge.js', import.meta.url));
const hash = (value) => createHash('sha256').update(value).digest('hex');

function invoke(payload) {
  const p = spawnSync(process.execPath, [bridge], {
    encoding: 'utf8',
    input: JSON.stringify(payload), timeout: 10_000, maxBuffer: 3_000_000,
  });
  assert.equal(p.status, 0, p.stderr);
  return JSON.parse(p.stdout);
}

test('installed bridge optimizes bounded repetitive Graph output and recovers byte-exact across invocations', () => {
  const lab = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-graph-ace-mcp-'));
  try {
    const projectRoot = path.join(lab, 'project');
    fs.mkdirSync(projectRoot);
    const stateDir = path.join(lab, 'ace-state');
    const original = ('Repeated structural dependency summary for this indexed project. ' + 'Z'.repeat(72) + '\n').repeat(300);
    const identity = {
      projectRoot, stateDir, sourceIdentity: 'graph-mcp-project:' + hash(projectRoot),
    };
    const reduced = invoke({
      ...identity, operation: 'reduce', toolName: 'afyx_graph_inventory',
      graphResult: { content: [{ type: 'text', text: original }] },
    });
    assert.equal(reduced.status, 'optimized');
    assert.ok(reduced.savedChars > 0);
    const rendered = reduced.result.content[0].text;
    const reference = rendered.match(/ace:v1:[0-9a-f]{16}:[0-9a-f]{16}:[0-9a-f]{64}/)?.[0];
    assert.ok(reference);
    assert.notEqual(rendered, original);
    const recovered = invoke({ ...identity, operation: 'recover', reference });
    assert.equal(recovered.status, 'recovered');
    assert.equal(recovered.content, original);
    const disabled = invoke({
      ...identity, operation: 'reduce', toolName: 'afyx_graph_explore',
      graphResult: { content: [{ type: 'text', text: original }] },
    });
    assert.equal(disabled.status, 'fallback');
  } finally {
    fs.rmSync(lab, { force: true, recursive: true });
  }
});

test('invalid references, unavailable roots and unsafe state overlap do not return partial data', () => {
  const lab = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-graph-ace-negative-'));
  try {
    const projectRoot = path.join(lab, 'project');
    fs.mkdirSync(projectRoot);
    const identity = { projectRoot, stateDir: path.join(lab, 'ace'), sourceIdentity: 'source' };
    assert.equal(invoke({ ...identity, operation: 'recover', reference: 'ace:v1:invalid' }).status, 'fallback');
    assert.equal(invoke({ ...identity, operation: 'recover',
      reference: 'ace:v1:' + 'a'.repeat(16) + ':' + 'b'.repeat(16) + ':' + 'c'.repeat(64) }).status, 'fallback');
    const invalid = invoke({
      ...identity, stateDir: path.join(projectRoot, 'inside'), operation: 'reduce',
      toolName: 'afyx_graph_inventory',
      graphResult: { content: [{ type: 'text', text: 'x'.repeat(30_000) }] },
    });
    assert.equal(invalid.status, 'fallback');
  } finally {
    fs.rmSync(lab, { force: true, recursive: true });
  }
});


test('real installer artifact contains a verified runnable Graph MCP bridge and exact recovery', () => {
  const lab = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-packaged-ace-mcp-')));
  try {
    const source = fileURLToPath(new URL('../', import.meta.url));
    const artifactTool = fileURLToPath(new URL('../../scripts/afyx-context-artifact.mjs', import.meta.url));
    const current = path.join(lab, 'installed', 'current');
    const metadataFile = path.join(lab, 'installed', 'metadata.json');
    const manifestFile = path.join(lab, 'installed', 'integrity.sha256');
    const build = spawnSync(process.execPath, [
      artifactTool, 'prepare', '--source', source,
      '--target', current, '--metadata', metadataFile,
      '--manifest', manifestFile, '--revision', 'a'.repeat(40),
    ], { encoding: 'utf8', timeout: 10_000 });
    assert.equal(build.status, 0, build.stderr);
    const manifest = fs.readFileSync(manifestFile, 'utf8');
    const metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
    assert.equal(metadata.artifact_digest, hash(manifest));
    const packagedBridge = path.join(current, 'dist', 'graph-mcp-bridge.js');
    assert.ok(manifest.includes('  current/dist/graph-mcp-bridge.js'));
    assert.equal(
      hash(fs.readFileSync(packagedBridge)),
      manifest.split('\n').find((line) => line.endsWith('  current/dist/graph-mcp-bridge.js')).slice(0, 64),
    );

    const projectRoot = path.join(lab, 'indexed-project');
    fs.mkdirSync(projectRoot);
    const stateDir = path.join(lab, 'private-state');
    const identity = {
      projectRoot, stateDir, sourceIdentity: 'graph-mcp-project:' + hash(projectRoot),
    };
    const invokeInstalled = (payload) => {
      const run = spawnSync(process.execPath, [packagedBridge], {
        input: JSON.stringify(payload), encoding: 'utf8', timeout: 10_000, maxBuffer: 3_000_000,
      });
      assert.equal(run.status, 0, run.stderr);
      return JSON.parse(run.stdout);
    };
    const original = ('Indexed project dependency summary - repeat data with a safe trace. ' + 'Q'.repeat(100) + '\n').repeat(240);
    const reduced = invokeInstalled({
      ...identity, operation: 'reduce', toolName: 'afyx_graph_inventory',
      graphResult: { content: [{ type: 'text', text: original }] },
    });
    assert.equal(reduced.status, 'optimized');
    const reference = reduced.result.content[0].text.match(/ace:v1:[0-9a-f]{16}:[0-9a-f]{16}:[0-9a-f]{64}/)?.[0];
    assert.ok(reference);
    const recovered = invokeInstalled({ ...identity, operation: 'recover', reference });
    assert.equal(recovered.status, 'recovered');
    assert.equal(recovered.content, original);
  } finally {
    fs.rmSync(lab, { recursive: true, force: true });
  }
});
