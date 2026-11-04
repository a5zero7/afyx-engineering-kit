/**
 * Graph behavior contract.
 *
 * Replays a fixed operation matrix - every traversal variant, call-graph, hierarchy,
 * usage, impact, path, containment and file-dependency operation - over twelve
 * synthetic graphs (plus an empty one and missing ids) and compares the results with
 * a golden recorded from the implementation before replacement. Small graphs are
 * recorded in full; large ones as digests.
 *
 * The golden must never be regenerated to make a change pass. Recording is opt-in and
 * only meant for adding corpus categories: AFYX_GRAPH_CONTRACT_WRITE=1.
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { computeGraphContract } from './graph-contract/compute';

const GOLDEN_PATH = path.join(__dirname, 'fixtures', 'graph-contract.golden.json');

describe('graph behavior contract', () => {
  const actual = JSON.parse(JSON.stringify(computeGraphContract())) as Record<string, any>;

  if (process.env.AFYX_GRAPH_CONTRACT_WRITE === '1') {
    it('records the golden', () => {
      fs.mkdirSync(path.dirname(GOLDEN_PATH), { recursive: true });
      fs.writeFileSync(GOLDEN_PATH, JSON.stringify(actual) + '\n');
    });
    return;
  }

  const golden = JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf8')) as Record<string, any>;

  it('covers exactly the recorded worlds', () => {
    expect(Object.keys(actual).sort()).toEqual(Object.keys(golden).sort());
  });

  for (const world of Object.keys(golden)) {
    it(`${world}: graph size is unchanged`, () => {
      expect(actual[world].counts).toEqual(golden[world].counts);
    });
    // One assertion group per operation family keeps a failure's message readable.
    const families = [...new Set(Object.keys(golden[world].records).map((key) => key.split(' ')[0]))];
    for (const family of families) {
      it(`${world}: ${family} results are unchanged`, () => {
        const keys = Object.keys(golden[world].records).filter((key) => key.split(' ')[0] === family);
        expect(Object.keys(actual[world].records).filter((key) => key.split(' ')[0] === family)).toEqual(keys);
        for (const key of keys) expect([key, actual[world].records[key]]).toEqual([key, golden[world].records[key]]);
      });
    }
  }
});
