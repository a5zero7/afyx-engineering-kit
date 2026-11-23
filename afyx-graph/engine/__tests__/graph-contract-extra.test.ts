/**
 * Supplementary graph behavior contract: container kinds, containment cycles, glob
 * escaping and the type hierarchy. Same rules as graph-contract.test.ts — the golden is
 * recorded from the implementation before replacement and is never regenerated to make
 * a change pass (AFYX_GRAPH_CONTRACT_WRITE=1 only for adding corpus categories).
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { computeExtraContract } from './graph-contract/compute-extra';

const GOLDEN_PATH = path.join(__dirname, 'fixtures', 'graph-contract-extra.golden.json');

describe('graph behavior contract (extra worlds)', () => {
  const actual = JSON.parse(JSON.stringify(computeExtraContract(), (_key, value) => (value === undefined ? null : value))) as Record<string, any>;

  if (process.env.AFYX_GRAPH_CONTRACT_WRITE === '1') {
    it('records the golden', () => {
      fs.writeFileSync(GOLDEN_PATH, JSON.stringify(actual) + '\n');
    });
    return;
  }

  const golden = JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf8')) as Record<string, any>;

  it('covers exactly the recorded worlds', () => {
    expect(Object.keys(actual).sort()).toEqual(Object.keys(golden).sort());
  });

  for (const world of Object.keys(golden)) {
    const records = golden[world];
    const families = [...new Set(Object.keys(records).map((key) => key.split(' ')[0]))];
    for (const family of families) {
      it(`${world}: ${family} results are unchanged`, () => {
        const keys = Object.keys(records).filter((key) => key.split(' ')[0] === family);
        expect(Object.keys(actual[world]).filter((key) => key.split(' ')[0] === family)).toEqual(keys);
        for (const key of keys) expect([key, actual[world][key]]).toEqual([key, records[key]]);
      });
    }
  }
});
