/**
 * Persistence contract.
 *
 * Replays deterministic persistence scenarios — connection lifecycle, schema and
 * migrations, node/edge/file/ref/metadata writes through every public write path,
 * transactions and rollback, cascades, and the reads the query layer serves from the
 * stored data — against scratch databases, and compares logical results with a golden
 * recorded from the implementation before replacement.
 *
 * The golden must never be regenerated to make a change pass. Recording is opt-in
 * (AFYX_DB_CONTRACT_WRITE=1) and only meant for adding scenarios.
 */
import { describe, expect, it, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { asyncRecord, computeDbContract, pathEquivalence } from './db-contract/scenarios.mjs';
import { srcApi } from './db-contract/api';

const GOLDEN_PATH = path.join(__dirname, 'fixtures', 'db-contract.golden.json');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-db-contract-'));
afterAll(() => {
  try { fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* a handle the engine left open is not this test's failure */ }
});

// Scratch paths appear in a few messages; keep the golden machine independent.
const scrub = (value: unknown): unknown => JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === 'string' ? v.split(scratch).join('<scratch>').replace(/\\/g, '/') : v)));

const asyncPart = await asyncRecord(srcApi, scratch);

describe('persistence contract', () => {
  const actual = scrub({ ...computeDbContract(srcApi, scratch), async: asyncPart, equivalence: pathEquivalence(srcApi, scratch) }) as Record<string, any>;

  if (process.env.AFYX_DB_CONTRACT_WRITE === '1') {
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

  for (const section of Object.keys(golden)) {
    const value = golden[section];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const key of Object.keys(value)) {
        it(`${section}.${key} is unchanged`, () => {
          expect(actual[section][key]).toEqual(value[key]);
        });
      }
    } else {
      it(`${section} is unchanged`, () => {
        expect(actual[section]).toEqual(value);
      });
    }
  }

  it('stores the same rows whichever write path produced them', () => {
    expect(actual.equivalence.same).toBe(true);
  });
});
