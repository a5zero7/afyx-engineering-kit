/**
 * `afyx-graph affected` input-path normalization (#825).
 *
 * The index stores project-relative, forward-slash paths. A user (or a wrapping
 * script) may pass a `./`-prefixed path or an absolute path; before #825 those
 * silently matched nothing and reported 0 affected tests. All three spellings
 * must now resolve the same affected test file.
 *
 * Exercised end-to-end against the built binary.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AfyxGraph } from '../src';

const BIN = path.resolve(__dirname, '../dist/bin/afyx-graph.js');

function affected(cwd: string, arg: string): string[] {
  const out = execFileSync(process.execPath, [BIN, 'affected', arg, '--quiet', '-p', cwd], {
    encoding: 'utf-8',
    env: { ...process.env, AFYX_GRAPH_NO_DAEMON: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

function affectedJson(cwd: string, ...args: string[]): {
  affectedTests: string[];
  affectedTestsAnalysis: {
    emptyReason: string | null;
    evidenceSufficient: boolean;
    provesNoTestsAffected: false;
    indexedTestFiles: number;
    candidateTestFiles: number;
    customFilterApplied: boolean;
    limitations: string[];
  };
} {
  const out = execFileSync(process.execPath, [BIN, 'affected', ...args, '--json', '--explain', '-p', cwd], {
    encoding: 'utf-8',
    env: { ...process.env, AFYX_GRAPH_NO_DAEMON: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(out);
}

describe('afyx-graph affected — input path normalization (#825)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-graph-affected-paths-'));
    fs.mkdirSync(path.join(tempDir, 'src'));
    // util.ts <- helper.ts <- helper.test.ts (transitive test dependency)
    fs.writeFileSync(path.join(tempDir, 'src/util.ts'), 'export function util(x: number){ return x + 1; }\n');
    fs.writeFileSync(
      path.join(tempDir, 'src/helper.ts'),
      "import { util } from './util';\nexport function helper(){ return util(1); }\n",
    );
    fs.writeFileSync(
      path.join(tempDir, 'src/helper.test.ts'),
      "import { helper } from './helper';\ntest('t', () => helper());\n",
    );
    fs.writeFileSync(path.join(tempDir, 'src/unrelated.ts'), 'export const unrelated = true;\n');
    const cg = AfyxGraph.initSync(tempDir);
    await cg.indexAll();
    cg.close();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('bare-relative, ./-prefixed, and absolute paths all resolve the same affected test', () => {
    const expected = ['src/helper.test.ts'];
    // Baseline that always worked.
    expect(affected(tempDir, 'src/util.ts')).toEqual(expected);
    // Both of these returned [] before the normalization fix.
    expect(affected(tempDir, './src/util.ts')).toEqual(expected);
    expect(affected(tempDir, path.join(tempDir, 'src/util.ts'))).toEqual(expected);
  });

  it('reports indexed-but-unreachable tests without claiming no test is affected', () => {
    const result = affectedJson(tempDir, 'src/unrelated.ts');
    expect(result.affectedTests).toEqual([]);
    expect(result.affectedTestsAnalysis).toMatchObject({
      emptyReason: 'NO_REACHABLE_INDEXED_TESTS',
      evidenceSufficient: true,
      provesNoTestsAffected: false,
      indexedTestFiles: 1,
      candidateTestFiles: 1,
      limitations: [],
    });
  });

  it('refuses a definitive empty conclusion when maxDepth cuts off a reachable test', () => {
    const result = affectedJson(tempDir, 'src/util.ts', '--depth', '1');
    expect(result.affectedTests).toEqual([]);
    expect(result.affectedTestsAnalysis.emptyReason).toBe('INSUFFICIENT_GRAPH_EVIDENCE');
    expect(result.affectedTestsAnalysis.provesNoTestsAffected).toBe(false);
    expect(result.affectedTestsAnalysis.limitations).toContain('TRAVERSAL_DEPTH_LIMITED');
  });

  it('reports custom-filter candidates separately from recognized indexed tests', () => {
    const result = affectedJson(tempDir, 'src/unrelated.ts', '--filter', '*.spec.ts');
    expect(result.affectedTests).toEqual([]);
    expect(result.affectedTestsAnalysis).toMatchObject({
      emptyReason: 'NO_REACHABLE_INDEXED_TESTS',
      indexedTestFiles: 1,
      candidateTestFiles: 0,
      customFilterApplied: true,
      provesNoTestsAffected: false,
    });
  });

  it('fails closed when the requested changed file is absent from the structural index', () => {
    const result = affectedJson(tempDir, 'src/missing.ts');
    expect(result.affectedTests).toEqual([]);
    expect(result.affectedTestsAnalysis.emptyReason).toBe('INSUFFICIENT_GRAPH_EVIDENCE');
    expect(result.affectedTestsAnalysis.evidenceSufficient).toBe(false);
    expect(result.affectedTestsAnalysis.limitations).toContain('CHANGED_FILE_NOT_STRUCTURALLY_INDEXED');
  });
});
