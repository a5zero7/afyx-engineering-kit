/**
 * Connection lifecycle and file-handle hygiene.
 *
 * On Windows an open database file cannot be deleted or replaced, so a connection that
 * was not really released shows up as EPERM/EBUSY the moment a test (or a full
 * re-index) tries to remove the file. These loops close, delete, replace and reopen
 * scratch databases repeatedly and fail on any handle left behind. They run on every
 * platform; on POSIX they also check that a clean close leaves no WAL sidecars.
 */
import { afterAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DatabaseConnection, removeDatabaseFiles } from '../src/db';
import { QueryBuilder } from '../src/db/queries';
import type { Node } from '../src/types';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-db-handles-'));
afterAll(() => fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));

const sample = (id: string): Node => ({
  id, kind: 'function', name: `fn_${id}`, qualifiedName: `src/a.ts::fn_${id}`, filePath: 'src/a.ts', language: 'typescript',
  startLine: 1, endLine: 2, startColumn: 0, endColumn: 1, updatedAt: 1,
});

describe('database lifecycle and handles', () => {
  it('opens, writes and closes repeatedly without keeping the file locked', () => {
    const file = path.join(scratch, 'loop', 'graph.db');
    DatabaseConnection.initialize(file).close();
    for (let i = 0; i < 40; i++) {
      const conn = DatabaseConnection.open(file);
      new QueryBuilder(conn.getDb()).insertNode(sample(`loop${i}`));
      conn.close();
    }
    const conn = DatabaseConnection.open(file);
    expect(new QueryBuilder(conn.getDb()).getNodeById('loop39')?.name).toBe('fn_loop39');
    expect(new QueryBuilder(conn.getDb()).getNodesByFile('src/a.ts')).toHaveLength(40);
    conn.close();
    expect(() => fs.rmSync(file, { force: true })).not.toThrow();
  });

  it('can delete the database and its sidecars immediately after close', () => {
    const file = path.join(scratch, 'delete', 'graph.db');
    const conn = DatabaseConnection.initialize(file);
    new QueryBuilder(conn.getDb()).insertNode(sample('d1'));
    conn.close();
    expect(() => removeDatabaseFiles(file)).not.toThrow();
    expect([file, `${file}-wal`, `${file}-shm`].map((f) => fs.existsSync(f))).toEqual([false, false, false]);
  });

  it('can replace the database at the same path after close', () => {
    const file = path.join(scratch, 'replace', 'graph.db');
    for (let round = 0; round < 5; round++) {
      const conn = DatabaseConnection.initialize(file);
      const queries = new QueryBuilder(conn.getDb());
      queries.insertNode(sample(`r${round}`));
      expect(queries.getNodesByFile('src/a.ts').map((n) => n.id)).toEqual([`r${round}`]);
      conn.close();
      removeDatabaseFiles(file);
    }
  });

  it('releases the file when a transaction throws', () => {
    const file = path.join(scratch, 'tx', 'graph.db');
    const conn = DatabaseConnection.initialize(file);
    const queries = new QueryBuilder(conn.getDb());
    for (let i = 0; i < 10; i++) {
      expect(() => conn.transaction(() => { queries.insertNode(sample(`t${i}`)); throw new Error('abort'); })).toThrow('abort');
    }
    expect(queries.getNodesByFile('src/a.ts')).toHaveLength(0);
    conn.close();
    expect(() => removeDatabaseFiles(file)).not.toThrow();
  });

  it('keeps two connections to one file consistent and closes both cleanly', () => {
    const file = path.join(scratch, 'double', 'graph.db');
    const a = DatabaseConnection.initialize(file);
    const b = DatabaseConnection.open(file);
    new QueryBuilder(a.getDb()).insertNode(sample('shared'));
    expect(new QueryBuilder(b.getDb()).getNodeById('shared')?.id).toBe('shared');
    a.close();
    b.close();
    expect(() => removeDatabaseFiles(file)).not.toThrow();
  });

  it('releases the file when initializing over an existing database fails', () => {
    const file = path.join(scratch, 'init-fail', 'graph.db');
    DatabaseConnection.initialize(file).close();
    expect(() => DatabaseConnection.initialize(file)).toThrow(/UNIQUE constraint failed/);
    expect(() => removeDatabaseFiles(file)).not.toThrow();
    expect(fs.existsSync(file)).toBe(false);
  });

  it('releases the file when opening something that is not a database fails', () => {
    const file = path.join(scratch, 'not-a-db', 'graph.db');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'this is not a sqlite database'.repeat(50));
    expect(() => DatabaseConnection.open(file)).toThrow(/not a database/i);
    expect(() => fs.rmSync(file)).not.toThrow();
  });

  it('leaves no WAL sidecars behind after a clean close (POSIX and Windows)', () => {
    const file = path.join(scratch, 'sidecar', 'graph.db');
    const conn = DatabaseConnection.initialize(file);
    new QueryBuilder(conn.getDb()).insertNodes([sample('s1'), sample('s2')]);
    conn.close();
    expect([`${file}-wal`, `${file}-shm`].map((f) => fs.existsSync(f))).toEqual([false, false]);
  });
});
