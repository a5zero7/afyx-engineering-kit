/**
 * The bundled schema script (`schema.sql`) and the pieces of it other code re-runs.
 *
 * The DDL lives only in the script. Everything that recreates an object later — bulk
 * index windows, trigger repair, crash recovery — cuts that object's statement out of
 * the script text rather than keeping a second copy, so the two can never drift.
 * (Re-executing the whole script is not an option: it contains data inserts that are
 * not idempotent.)
 */

import * as fs from 'fs';
import * as path from 'path';

/** Comment that opens the full-text section of the script. */
const FTS_SECTION_MARKER = '-- Full-text search index on node names, docstrings, and signatures';

/** The script text, split around the full-text section. */
export interface SchemaSections {
  /** Everything before the FTS section. */
  head: string;
  /** The FTS table and its three triggers, or null when the script has no FTS section. */
  fts: string | null;
  /** Everything after the FTS triggers (later tables and indexes that must exist regardless). */
  tail: string;
}

let cachedScript: string | undefined;
let cachedIndexDdl: Map<string, string> | undefined;

/** The whole script. Read once per process. */
export function schemaScript(): string {
  cachedScript ??= fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
  return cachedScript;
}

/**
 * Split the script so a build without FTS5 can still create every other object.
 * When the script has no FTS marker, the entire text is `head`.
 */
export function splitSchema(): SchemaSections {
  const script = schemaScript();
  const at = script.indexOf(FTS_SECTION_MARKER);
  if (at < 0) return { head: script, fts: null, tail: '' };

  const fts = script.slice(at).match(/^[\s\S]*?CREATE TRIGGER IF NOT EXISTS nodes_au\b[\s\S]*?END;/)?.[0];
  if (!fts) throw new Error('schema.sql: FTS5 update trigger not found');
  return { head: script.slice(0, at), fts, tail: script.slice(at + fts.length) };
}

/** Why an index statement is being looked up; shapes the message when the script lacks it. */
export type IndexPurpose = 'parse' | 'ref' | 'edge' | 'recovery';

/** Statement that (re)creates the named plain (non-unique) index. */
export function indexDdl(name: string, purpose: IndexPurpose): string {
  if (!cachedIndexDdl) {
    cachedIndexDdl = new Map();
    for (const match of schemaScript().matchAll(/CREATE INDEX IF NOT EXISTS (\w+)[^;]*;/g)) {
      cachedIndexDdl.set(match[1]!, match[0]);
    }
  }
  const ddl = cachedIndexDdl.get(name);
  if (ddl) return ddl;
  throw new Error(
    purpose === 'recovery'
      ? `schema.sql: index ${name} not found for crash recovery`
      : `schema.sql: ${purpose} index ${name} not found for bulk-load recreation`
  );
}

/** The three statements that keep the FTS index in step with `nodes`, in script order. */
export function ftsTriggerDdl(expected: number): string[] {
  const found = schemaScript().match(/CREATE TRIGGER IF NOT EXISTS nodes_a[idu]\b[\s\S]*?END;/g);
  if (!found || found.length !== expected) {
    throw new Error(`schema.sql: expected ${expected} nodes FTS triggers, found ${found?.length ?? 0}`);
  }
  return found;
}
