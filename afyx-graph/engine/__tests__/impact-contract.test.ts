/**
 * Deterministic impact/affected-tests contract: symbol impact (direction, depth,
 * dedup, ordering, multi-definition merge) and affected-tests (file-level transitive
 * BFS, test-file classification integration, multi-input union, depth boundaries),
 * driven against the real built CLI + MCP server over a synthetic real-extracted
 * fixture (see `impact-contract/fixture.ts`) covering every required graph/file shape.
 *
 * Golden recorded from the implementation before replacement (Phase 3B.5, main @
 * e2cfa3c); never regenerated to make a change pass (AFYX_IMPACT_CONTRACT_WRITE=1
 * only for adding cases). Requires a built dist/ (npm run build:clean).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { AfyxGraph } from '../src';
import { writeFixture } from './impact-contract/fixture';

const GOLDEN_PATH = path.join(__dirname, 'fixtures', 'impact-contract.golden.json');
const CLI = path.join(__dirname, '..', 'dist', 'bin', 'afyx-graph.js');
const SCENARIOS = path.join(__dirname, 'impact-contract', 'scenarios.mjs');

describe('Impact / affected-tests contract', () => {
  let dir: string;

  beforeAll(async () => {
    if (!fs.existsSync(CLI)) throw new Error('dist/ is not built: run `npm run build:clean` first');
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-graph-impact-contract-'));
    writeFixture(dir);
    const cg = AfyxGraph.initSync(dir);
    await cg.indexAll();
    cg.close();
  }, 120_000);

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('matches the recorded contract across every symbol/file/test-mapping shape', () => {
    const outFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-graph-impact-out-')), 'result.json');
    execFileSync(process.execPath, [SCENARIOS, CLI, dir, outFile], {
      encoding: 'utf-8',
      env: { ...process.env, AFYX_GRAPH_NO_DAEMON: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 480_000, // this test alone runs 250+ real CLI/MCP subprocess spawns
    });
    const actual = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    fs.rmSync(path.dirname(outFile), { recursive: true, force: true });

    if (process.env.AFYX_IMPACT_CONTRACT_WRITE === '1') {
      fs.mkdirSync(path.dirname(GOLDEN_PATH), { recursive: true });
      fs.writeFileSync(GOLDEN_PATH, JSON.stringify(actual, null, 2) + '\n');
      return;
    }
    const golden = JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf8'));
    expect(Object.keys(actual).length).toBeGreaterThanOrEqual(100);
    expect(actual).toEqual(golden);
  }, 500_000);
});
