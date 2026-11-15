import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawnSync } from 'node:child_process';
import AfyxGraph from '../src/index';

describe('TypeScript Multi-Callsite Completeness', () => {
  let tmpDir: string;
  let cg: AfyxGraph;
  const cliPath = path.join(__dirname, '..', 'dist', 'bin', 'afyx-graph.js');

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-callsite-completeness-'));
    fs.mkdirSync(path.join(tmpDir, 'src'));

    fs.writeFileSync(
      path.join(tmpDir, 'src', 'db.ts'),
      'export function createProject(name: string): string {\n  return name;\n}\n'
    );

    fs.writeFileSync(
      path.join(tmpDir, 'src', 'actions.ts'),
      [
        'import { createProject } from "./db";',
        '',
        'export function createProjectAction(data: any) {',
        '  if (!data) {',
        '    return createProject("default");',
        '  }',
        '  return createProject(data.name);',
        '}',
        '',
      ].join('\n')
    );

    cg = AfyxGraph.initSync(tmpDir);
    await cg.indexAll();
  });

  afterAll(() => {
    cg?.destroy();
    if (tmpDir && fs.existsSync(tmpDir)) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      } catch {
        // ignore transient Windows file lock
      }
    }
  });

  it('preserves unique caller identity in getCallers (#1086 contract)', () => {
    const targetNode = cg.getNodesByName('createProject').find((n) => n.kind === 'function');
    expect(targetNode).toBeDefined();

    const callers = cg.getCallers(targetNode!.id);
    const callerFuncs = callers.filter((c) => c.node.name === 'createProjectAction');
    expect(callerFuncs).toHaveLength(1);
    expect(callerFuncs[0]!.node.filePath.replace(/\\/g, '/')).toContain('src/actions.ts');
  });

  it('retrieves all distinct callsite edges in findUsages', () => {
    const targetNode = cg.getNodesByName('createProject').find((n) => n.kind === 'function');
    expect(targetNode).toBeDefined();

    const usages = cg.findUsages(targetNode!.id);
    const callUsages = usages.filter((u) => u.edge.kind === 'calls' && u.node.name === 'createProjectAction');
    expect(callUsages).toHaveLength(2);

    const callLines = callUsages.map((u) => u.edge.line).sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(callLines).toEqual([5, 7]);
  });

  it('enumerates all callsite locations in CLI callers --json while preserving unique caller total', () => {
    const res = spawnSync(
      process.execPath,
      [cliPath, 'callers', 'createProject', '-p', tmpDir, '--json'],
      {
        encoding: 'utf8',
        env: { ...process.env, AFYX_GRAPH_NO_DAEMON: '1', AFYX_GRAPH_ALLOW_UNSAFE_NODE: '1' },
      }
    );
    expect(res.status).toBe(0);

    const data = JSON.parse(res.stdout);
    const def = data.definitions[0];
    expect(def.callers).toHaveLength(1);
    expect(def.callers[0].name).toBe('createProjectAction');

    const callEdges = def.edges.filter((e: any) => e.kind === 'calls');
    expect(callEdges).toHaveLength(2);
    const lines = callEdges.map((e: any) => e.line).sort((a: number, b: number) => a - b);
    expect(lines).toEqual([5, 7]);
  });

  it('enumerates all callsite locations in CLI impact --json', () => {
    const res = spawnSync(
      process.execPath,
      [cliPath, 'impact', 'createProject', '-p', tmpDir, '--json'],
      {
        encoding: 'utf8',
        env: { ...process.env, AFYX_GRAPH_NO_DAEMON: '1', AFYX_GRAPH_ALLOW_UNSAFE_NODE: '1' },
      }
    );
    expect(res.status).toBe(0);

    const data = JSON.parse(res.stdout);
    const def = data.definitions[0];
    const callEdges = def.edges.filter((e: any) => e.kind === 'calls');
    expect(callEdges).toHaveLength(2);
    const lines = callEdges.map((e: any) => e.line).sort((a: number, b: number) => a - b);
    expect(lines).toEqual([5, 7]);
  });
});
