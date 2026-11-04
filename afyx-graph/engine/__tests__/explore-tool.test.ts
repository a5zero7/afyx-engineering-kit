import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import AfyxGraph from '../src/index';
import {
  allocateExploreBudget,
  getExploreBudget,
  getExploreOutputBudget,
  normalizeQuerySpelling,
  ToolHandler,
} from '../src/mcp/tools';
import { executeExploreTool } from '../src/mcp/explore-tool';

describe('MCP Explore adapter seam', () => {
  let root: string;
  let graph: AfyxGraph;
  let handler: ToolHandler;

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-explore-adapter-'));
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src', 'auth.ts'), [
      'export class AuthService {',
      '  authenticate(token: string) { return this.validate(token); }',
      '  validate(token: string) { return token.length > 3; }',
      '}',
    ].join('\n'));
    fs.writeFileSync(path.join(root, 'src', 'api.ts'), [
      "import { AuthService } from './auth';",
      'export function requestHandler(token: string) {',
      '  return new AuthService().authenticate(token);',
      '}',
    ].join('\n'));
    graph = AfyxGraph.initSync(root, ['**/*.ts'], []);
    await graph.indexAll();
    handler = new ToolHandler(graph);
  }, 30_000);

  afterAll(() => {
    try { graph.close(); } catch { /* best effort */ }
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('freezes exported policy helpers and allocation fundamentals', () => {
    const points = [0, 149, 150, 499, 500, 4999, 5000, 14999, 15000, 30000];
    const budgets = points.map((fileCount) => ({
      calls: getExploreBudget(fileCount),
      output: getExploreOutputBudget(fileCount),
    }));
    expect(budgets.map(({ calls }) => calls))
      .toEqual([1, 1, 1, 1, 2, 2, 3, 3, 4, 5]);
    expect(budgets.map(({ output }) => output.maxOutputChars)).toEqual([
      13000, 13000, 18000, 18000, 24000,
      24000, 24000, 24000, 24000, 24000,
    ]);
    expect(budgets.map(({ output }) => output.defaultMaxFiles))
      .toEqual([4, 4, 5, 5, 8, 8, 8, 8, 8, 8]);
    expect(normalizeQuerySpelling('cowboy_stream_h:request_process/3'))
      .toBe('cowboy_stream_h.request_process');
    expect(normalizeQuerySpelling('path:src/2fa/api.ts name:requestHandler'))
      .toBe('path:src/2fa/api.ts name:requestHandler');

    const allocation = allocateExploreBudget([
      { path: 'pinned.ts', score: 1, worth: 1, pinned: true, spine: false },
      { path: 'spine.ts', score: 20, worth: 1, pinned: false, spine: true },
      { path: 'weak.ts', score: 0.01, worth: 1, pinned: false, spine: false },
    ], getExploreOutputBudget(1000), 3);
    expect([...allocation.allowances.keys()])
      .toEqual(['pinned.ts', 'spine.ts']);
    expect(allocation.allowances.get('pinned.ts'))
      .toBe(allocation.allowances.get('spine.ts'));
    expect(allocation.cliffed).toContain('weak.ts');
  });

  it('matches the ToolHandler facade with injected shared host capabilities', async () => {
    const args = { query: 'authentication request handler' };
    const facade = await (handler as unknown as {
      handleExplore(input: Record<string, unknown>): Promise<unknown>;
    }).handleExplore(args);
    const direct = await executeExploreTool(graph, args.query, args, {
      isFileStaleOnDisk: () => false,
      numberSourceLines: (slice, firstLineNumber) => slice
        .split('\n')
        .map((line, index) => `${firstLineNumber + index}\t${line}`)
        .join('\n'),
      synthEdgeNote: () => null,
    });
    expect(direct).toEqual(facade);
  });
});
