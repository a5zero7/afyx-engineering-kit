/**
 * FTS5 dual-mode contract: the same searches, once with real FTS5 and once with it
 * simulated unavailable (the exact monkeypatch `fts5-fallback.test.ts` uses), so the
 * fallback trigger, tokenization, limits and empty-query behavior are pinned for both
 * paths. Golden recorded from the implementation before replacement; never regenerated
 * to make a change pass (AFYX_DB_QUERY_CONTRACT_WRITE=1 only for adding cases).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseConnection } from '../src/db';
import { QueryBuilder } from '../src/db/queries';
import { buildFixture } from './db-query-contract/fixture';

const { DatabaseSync } = require('node:sqlite');
const GOLDEN_PATH = path.join(__dirname, 'fixtures', 'db-query-fts-contract.golden.json');

function simulateMissingFts5(): void {
  const exec = DatabaseSync.prototype.exec;
  vi.spyOn(DatabaseSync.prototype, 'exec').mockImplementation(function (this: unknown, sql: string) {
    if (/CREATE VIRTUAL TABLE\b[^;]*\bUSING fts5\s*\(/i.test(sql)) throw new Error('no such module: fts5');
    return exec.call(this, sql);
  });
}

const QUERIES = ['helper', 'run', 'stage_apply::run', 'signIn', '""" AND OR', 'zzz_no_such_symbol', 'get$Value', ''] as const;

function computeFor(dbPath: string): Record<string, unknown> {
  const conn = DatabaseConnection.open(dbPath);
  const q = new QueryBuilder(conn.getDb());
  const out: Record<string, unknown> = { fts5Available: conn.fts5Available };
  for (const query of QUERIES) {
    try {
      out[`search ${query}`] = q.searchNodes(query, { limit: 8 }).map((r) => [r.node.id, Math.round(r.score * 100) / 100]);
    } catch (error) {
      out[`search ${query}`] = `throws: ${(error as Error).message}`;
    }
  }
  conn.close();
  return out;
}

describe('FTS5 dual-mode query contract', () => {
  let dir: string;
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('matches the recorded contract for FTS5-available and FTS5-unavailable databases', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-db-fts-contract-'));
    const withFts = path.join(dir, 'with-fts.db');
    const withoutFts = path.join(dir, 'without-fts.db');
    const fixture = buildFixture();

    {
      const conn = DatabaseConnection.initialize(withFts);
      const q = new QueryBuilder(conn.getDb());
      q.insertNodes(fixture.nodes);
      q.insertEdges(fixture.edges);
      conn.close();
    }
    simulateMissingFts5();
    {
      const conn = DatabaseConnection.initialize(withoutFts);
      const q = new QueryBuilder(conn.getDb());
      q.insertNodes(fixture.nodes);
      q.insertEdges(fixture.edges);
      conn.close();
    }
    vi.restoreAllMocks();

    const actual = { available: computeFor(withFts), unavailable: computeFor(withoutFts) };

    if (process.env.AFYX_DB_QUERY_CONTRACT_WRITE === '1') {
      fs.mkdirSync(path.dirname(GOLDEN_PATH), { recursive: true });
      fs.writeFileSync(GOLDEN_PATH, JSON.stringify(actual) + '\n');
      return;
    }
    const golden = JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf8'));
    expect(actual.available.fts5Available).toBe(true);
    expect(actual.unavailable.fts5Available).toBe(false);
    expect(actual).toEqual(golden);
  });
});
