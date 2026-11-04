/**
 * Search behavior contract.
 *
 * Replays a fixed corpus through every exported function of src/search/* and
 * compares the outputs with a frozen golden recorded from the pre-replacement
 * implementation. It asserts observable behavior only (values, ordering,
 * determinism, limits, edge cases), so it survives any internal restructuring.
 *
 * The golden must never be regenerated to make a change pass. A difference is
 * a behavior change to investigate. Recording is opt-in and only meant for
 * adding new corpus categories: AFYX_SEARCH_CONTRACT_WRITE=1.
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { computeSearchContract } from './search-contract/compute';

const GOLDEN_PATH = path.join(__dirname, 'fixtures', 'search-contract.golden.json');

describe('search behavior contract', () => {
  const actual = JSON.parse(JSON.stringify(computeSearchContract())) as Record<string, unknown>;

  if (process.env.AFYX_SEARCH_CONTRACT_WRITE === '1') {
    it('records the golden', () => {
      fs.mkdirSync(path.dirname(GOLDEN_PATH), { recursive: true });
      fs.writeFileSync(GOLDEN_PATH, JSON.stringify(actual) + '\n');
    });
    return;
  }

  const golden = JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf8')) as Record<string, unknown[]>;

  it('covers exactly the recorded function set', () => {
    expect(Object.keys(actual).sort()).toEqual(Object.keys(golden).sort());
  });

  for (const name of Object.keys(golden)) {
    it(`${name} reproduces the recorded outputs`, () => {
      if (name !== 'parseQuery') {
        expect(actual[name]).toEqual(golden[name]);
        return;
      }
      // The current Graph language registry has one intentional additive
      // entry (CSV). The historical golden stays immutable: prove the new
      // behavior exactly, then compare every pre-existing entry unchanged.
      const parsed = actual[name] as Array<{
        kinds: string[]; languages: string[]; nameFilters: string[];
        pathFilters: string[]; text: string;
      }>;
      const added = {
        kinds: [], languages: ['csv'], nameFilters: [],
        pathFilters: [], text: 'sample',
      };
      const additions = parsed.filter((entry) => entry.languages.length === 1 && entry.languages[0] === 'csv');
      expect(additions).toEqual([added]);
      expect(parsed.length).toBe(golden[name]!.length + 1);
      expect(parsed.filter((entry) => entry !== additions[0])).toEqual(golden[name]);
    });
  }

  it('is deterministic across repeated evaluation', () => {
    expect(JSON.parse(JSON.stringify(computeSearchContract()))).toEqual(actual);
  });
});
