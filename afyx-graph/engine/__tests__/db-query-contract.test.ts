/**
 * Query behavior contract.
 *
 * Replays a fixed operation matrix over a deterministic fixture (same-name symbols
 * across files, qualified/nested/punctuated names, every edge kind, pending and failed
 * unresolved references, generated files, a dependency cycle, wide fan-in/out, and a
 * name common enough to exercise the search co-location logic) against `QueryBuilder`,
 * and compares exact results — including order — with a golden recorded from the
 * implementation before replacement.
 *
 * The golden must never be regenerated to make a change pass. Recording is opt-in and
 * only meant for adding operations: AFYX_DB_QUERY_CONTRACT_WRITE=1.
 */
import { afterAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { computeCacheContract, computeQueryContract, writeFixture } from './db-query-contract/compute';

const GOLDEN_PATH = path.join(__dirname, 'fixtures', 'db-query-contract.golden.json');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-db-query-contract-'));
afterAll(() => {
  try { fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* a handle the engine left open is not this test's failure */ }
});

describe('query behavior contract', () => {
  const { dbPath, fixture } = writeFixture(scratch);
  const actual = JSON.parse(JSON.stringify({ ops: computeQueryContract(dbPath, fixture), cache: computeCacheContract(dbPath) })) as Record<string, any>;

  if (process.env.AFYX_DB_QUERY_CONTRACT_WRITE === '1') {
    it('records the golden', () => {
      fs.mkdirSync(path.dirname(GOLDEN_PATH), { recursive: true });
      fs.writeFileSync(GOLDEN_PATH, JSON.stringify(actual) + '\n');
    });
    return;
  }

  const golden = JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf8')) as Record<string, any>;

  it('covers exactly the recorded sections', () => {
    expect(Object.keys(actual)).toEqual(Object.keys(golden));
  });

  for (const section of ['ops', 'cache'] as const) {
    it(`covers exactly the recorded ${section}`, () => {
      expect(Object.keys(actual[section]).sort()).toEqual(Object.keys(golden[section]).sort());
    });
    for (const key of Object.keys(golden[section])) {
      it(`${section}: ${key}`, () => {
        expect([key, actual[section][key]]).toEqual([key, golden[section][key]]);
      });
    }
  }
});
