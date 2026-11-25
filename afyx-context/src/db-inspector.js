/**
 * AFYX Read-Only Data & Schema Inspector (AfyxDbInspection/v1).
 *
 * Provides safe, strictly read-only inspection of local and external datasets:
 * - Local datasets: CSV, TSV, JSON, NDJSON, SQLite databases
 * - Enforces workspace path containment and symlink escape prevention
 * - Database-backed SQLite schema & sample inspection via node:sqlite in enforced read-only mode
 * - External catalogs: PostgreSQL, MySQL, MSSQL (returns NOT_AVAILABLE when unconfigured)
 * - Strict security: Rejects SQL mutations, multi-statements, administrative statements
 * - Sensitive-column masking: Automatically redacts credentials and sensitive attributes
 * - Bounded samples: Enforces maximum row limits (default 10, max 100)
 */

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, delimiter, extname, isAbsolute, join, resolve } from 'node:path';
import { checkPathContainment } from './path-containment.js';

export const DB_INSPECTION_CONTRACT = 'AfyxDbInspection/v1';

const SENSITIVE_COLUMN_PATTERN = /^(password|passwd|secret|token|api_key|apikey|auth|ssn|credit_card|card_num|hash|salt|private_key)$/i;

const MUTATION_SQL_PATTERN = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|REPLACE|GRANT|REVOKE|VACUUM|ATTACH|DETACH|REINDEX)\b/i;
const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;
const LIVE_CLIENTS = { postgres: 'psql', mysql: 'mysql' };
const LIVE_LIMIT = 100;
const LIVE_BUFFER = 256 * 1024;
const LIVE_TIMEOUT = 6000;
const PLAN_NODE_TYPES = new Set(['Seq Scan', 'Index Scan', 'Index Only Scan', 'Bitmap Heap Scan', 'Limit',
  'Result', 'Nested Loop', 'Sort', 'Aggregate', 'ALL', 'index', 'range', 'ref', 'eq_ref', 'const', 'system']);

function liveExecutable(name, explicit) {
  const file = process.platform === 'win32' ? name + '.exe' : name;
  const candidates = explicit !== undefined ? [explicit] :
    (process.env.PATH ?? '').split(delimiter).filter(isAbsolute).slice(0, 128).map(dir => join(dir, file));
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || !isAbsolute(candidate) || basename(candidate).toLowerCase() !== file) continue;
    try {
      const path = realpathSync(candidate);
      if (statSync(path).isFile() && basename(path).toLowerCase() === file) return path;
    } catch {}
  }
}

function liveStatement(dialect, operation, schema, relations) {
  if (operation === undefined || operation?.kind === 'schema' ||
      (dialect === 'mysql' && operation?.kind === 'show' && operation.name === 'tables')) {
    return {
      kind: 'schema',
      sql: "SELECT table_name FROM information_schema.tables WHERE table_schema = '" + schema +
        "' AND table_type = 'BASE TABLE' ORDER BY table_name LIMIT " + (LIVE_LIMIT + 1),
    };
  }
  if (operation?.kind === 'columns' && typeof operation.table === 'string' && IDENTIFIER.test(operation.table) &&
      Array.isArray(relations) && relations.length <= LIVE_LIMIT && relations.includes(operation.table)) {
    return { kind: 'columns', sql: "SELECT column_name FROM information_schema.columns WHERE table_schema = '" +
      schema + "' AND table_name = '" + operation.table + "' ORDER BY ordinal_position LIMIT " + (LIVE_LIMIT + 1) };
  }
  if (!['query', 'explain'].includes(operation?.kind) || typeof operation.sql !== 'string' || operation.sql.length > 2048) return;
  // A projection over one explicitly approved relation. No expressions, comments,
  // quoted input, functions, variables, joins, locks or statement separators.
  const match = /^SELECT +([a-z_][a-z0-9_]*(?: *, *[a-z_][a-z0-9_]*)*) +FROM +([a-z_][a-z0-9_]*)$/i.exec(operation.sql.trim());
  if (!match || !Array.isArray(relations) || relations.length > LIVE_LIMIT || !relations.includes(match[2])) return;
  const columns = match[1].split(',').map(s => s.trim());
  const table = match[2];
  if (columns.length > 16 || ![table, ...columns].every(v => IDENTIFIER.test(v))) return;
  const quote = dialect === 'postgres' ? '"' : '`';
  const q = id => quote + id + quote;
  const projection = 'SELECT ' + columns.map(q).join(', ') + ' FROM ' + q(schema) + '.' + q(table) + ' LIMIT ' + LIVE_LIMIT;
  if (operation.kind === 'explain') {
    return { kind: 'explain', sql: (dialect === 'postgres' ? 'EXPLAIN (FORMAT JSON) ' : 'EXPLAIN FORMAT=JSON ') + projection };
  }
  // Read the approved projection but expose only one bounded count, never rows.
  return { kind: 'query', sql: 'SELECT COUNT(*) FROM (' + projection + ') AS afyx_sample' };
}

let sqliteModule = null;
try {
  sqliteModule = await import('node:sqlite');
} catch {
  // node:sqlite not available in this runtime
}

function hashFile(path) {
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
  } catch {
    return null;
  }
}

function escapeSqliteIdentifier(name) {
  return String(name).replace(/"/g, '""');
}

export class DbInspector {
  /**
   * @param {string} workspaceRoot
   */
  constructor(workspaceRoot, { runClient = spawnSync } = {}) {
    this.workspaceRoot = resolve(workspaceRoot);
    this.runClient = runClient;
  }

  /**
   * Inspects a dataset file (CSV, TSV, JSON, NDJSON, SQLite).
   *
   * @param {string} relativePath
   * @param {object} [options]
   * @param {number} [options.sampleLimit=10]
   * @returns {object} Inspection summary
   */
  inspectDataset(relativePath, options = {}) {
    // 1. Enforce strict workspace path containment
    const containment = checkPathContainment(relativePath, this.workspaceRoot, { expectFile: true });
    if (!containment.contained) {
      if (containment.reason !== 'DIRECTORY_NOT_ALLOWED') {
        return {
          contract: DB_INSPECTION_CONTRACT,
          status: 'ACCESS_DENIED',
          reason: containment.reason,
          path: relativePath,
          error: containment.error,
        };
      }
      if (containment.reason === 'DIRECTORY_NOT_ALLOWED') {
        return {
          contract: DB_INSPECTION_CONTRACT,
          status: 'DIRECTORY_NOT_ALLOWED',
          path: relativePath,
          error: containment.error,
        };
      }
    }

    const fullPath = containment.canonicalPath;
    if (!existsSync(fullPath)) {
      return {
        contract: DB_INSPECTION_CONTRACT,
        status: 'FILE_NOT_FOUND',
        path: relativePath,
        error: `Dataset file does not exist: ${relativePath}`,
      };
    }

    const ext = extname(fullPath).toLowerCase();
    const limit = Math.max(1, Math.min(options.sampleLimit ?? 10, 100));

    if (ext === '.csv' || ext === '.tsv') {
      return this._inspectCsv(fullPath, relativePath, ext === '.tsv' ? '\t' : ',', limit);
    } else if (ext === '.json') {
      return this._inspectJson(fullPath, relativePath, limit);
    } else if (ext === '.ndjson' || ext === '.jsonl') {
      return this._inspectNdjson(fullPath, relativePath, limit);
    } else if (['.db', '.sqlite', '.sqlite3'].includes(ext)) {
      return this._inspectSqlite(fullPath, relativePath, limit);
    } else {
      return {
        contract: DB_INSPECTION_CONTRACT,
        format: 'unsupported',
        status: 'UNSUPPORTED_FORMAT',
        path: relativePath,
        message: `Format '${ext}' is not supported for local data inspection.`,
      };
    }
  }

  /**
   * Connects to or checks status of external database catalog.
   *
   * @param {string} dialect 'postgres' | 'mysql' | 'mssql'
   * @param {object} [config]
   * @returns {object}
   */
  inspectExternalCatalog(dialect, config = {}, operation) {
    const report = (status, reason, metadata = {}) => ({
      contract: DB_INSPECTION_CONTRACT, dialect, status, reason, ...metadata,
    });
    if (!Object.hasOwn(LIVE_CLIENTS, dialect) || config?.live !== true || config.authorized !== true) {
      return report('NOT_AVAILABLE', 'LIVE_DATABASE_NOT_AUTHORIZED', { supportedDialects: ['sqlite', 'postgres', 'mysql', 'mssql'] });
    }
    const { host, user, database, password, allowedHosts, readOnlyRole } = config;
    const postgres = dialect === 'postgres';
    const schema = config.schema ?? (postgres ? 'public' : database);
    const port = config.port ?? (postgres ? 5432 : 3306);
    if (readOnlyRole !== true || typeof host !== 'string' || !/^[a-z0-9][a-z0-9.-]{0,252}$/i.test(host) ||
        !Array.isArray(allowedHosts) || allowedHosts.length > 16 || !allowedHosts.includes(host) ||
        ![user, database, schema].every(value => typeof value === 'string' && IDENTIFIER.test(value)) ||
        !Number.isInteger(port) || port < 1 || port > 65535 ||
        (password !== undefined && (typeof password !== 'string' || password.length > 1024 || /[\0\r\n]/.test(password)))) {
      return report('ACCESS_DENIED', 'UNAPPROVED_CONNECTION');
    }
    const statement = liveStatement(dialect, operation, schema, config.approvedRelations);
    if (!statement) return report('ACCESS_DENIED', 'UNSUPPORTED_READ_ONLY_OPERATION');
    const executable = liveExecutable(LIVE_CLIENTS[dialect], config.executable);
    if (!executable) return report('NOT_AVAILABLE', 'DB_CLIENT_UNAVAILABLE');
    let caFile;
    if (!postgres || config.tlsCaFile !== undefined) {
      try {
        if (typeof config.tlsCaFile !== 'string' || !isAbsolute(config.tlsCaFile)) throw new Error();
        caFile = realpathSync(config.tlsCaFile);
        if (!statSync(caFile).isFile()) throw new Error();
      } catch {
        return report('ACCESS_DENIED', 'DB_TLS_TRUST_REQUIRED');
      }
    }
    const env = process.platform === 'win32' && process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {};
    const args = ['--host=' + host, '--port=' + port, '--' + (postgres ? 'username' : 'user') + '=' + user];
    let input;
    if (postgres) {
      Object.assign(env, { PGCONNECT_TIMEOUT: '3', PGSSLMODE: 'verify-full', PGSSLROOTCERT: caFile ?? 'system',
        PGPASSFILE: join(executable, 'disabled-passfile'), PGOPTIONS: '-c default_transaction_read_only=on -c statement_timeout=3000 -c search_path=pg_catalog' });
      if (password !== undefined) env.PGPASSWORD = password;
      args.unshift('--no-psqlrc', '--no-password', '--quiet', '--no-align', '--tuples-only', '--set=ON_ERROR_STOP=1');
      args.push('--dbname=' + database, '--file=-');
      input = 'BEGIN READ ONLY;\n' + statement.sql + ';\nROLLBACK;\n';
    } else {
      if (password !== undefined) env.MYSQL_PWD = password;
      args.unshift('--no-defaults', '--no-login-paths', '--batch', '--raw', '--skip-column-names', '--binary-mode');
      args.push('--protocol=TCP', '--connect-timeout=3', '--ssl-mode=VERIFY_IDENTITY', '--ssl-ca=' + caFile, '--database=' + database);
      input = 'START TRANSACTION READ ONLY;\n' + statement.sql + ';\nROLLBACK;\n';
    }
    try {
      const result = this.runClient(executable, args, {
        env, input, encoding: 'utf8', shell: false, windowsHide: true,
        timeout: LIVE_TIMEOUT, killSignal: 'SIGKILL', maxBuffer: LIVE_BUFFER,
      });
      if (result.error || result.status !== 0) {
        return report('ERROR', result.error?.code === 'ETIMEDOUT' ? 'DB_TIMEOUT' : 'DB_CLIENT_FAILED');
      }
      if (typeof result.stdout !== 'string' || Buffer.byteLength(result.stdout) > LIVE_BUFFER) return report('ERROR', 'DB_INVALID_RESPONSE');
      const output = result.stdout.trim();
      if (statement.kind === 'explain') {
        const plan = JSON.parse(output);
        if (postgres ? !Array.isArray(plan) || plan.length !== 1 || !plan[0]?.Plan : !plan?.query_block) {
          return report('ERROR', 'DB_INVALID_RESPONSE');
        }
        const root = postgres ? plan[0].Plan : plan.query_block.table ?? plan.query_block;
        if (typeof root !== 'object' || root === null || Array.isArray(root)) return report('ERROR', 'DB_INVALID_RESPONSE');
        const name = postgres ? root['Node Type'] : root.access_type;
        const rows = postgres ? root['Plan Rows'] : root.rows_examined_per_scan;
        return report('PLAN_INSPECTED', null, { readOnly: true, format: 'json', executed: false,
          plan: { access: PLAN_NODE_TYPES.has(name) ? name : null,
            estimatedRows: Number.isSafeInteger(rows) && rows >= 0 ? rows : null } });
      }
      if (statement.kind === 'query') {
        if (!/^\d{1,3}$/.test(output) || Number(output) > LIVE_LIMIT) return report('ERROR', 'DB_INVALID_RESPONSE');
        return report('QUERY_INSPECTED', null, { readOnly: true, rowsObserved: Number(output), sampleLimit: LIVE_LIMIT });
      }
      const rows = output ? output.split(/\r?\n/) : [];
      if (rows.length > LIVE_LIMIT + 1 || !rows.every(name => IDENTIFIER.test(name))) return report('ERROR', 'DB_INVALID_RESPONSE');
      const names = rows.slice(0, LIVE_LIMIT).map(name =>
        SENSITIVE_COLUMN_PATTERN.test(name) || (password && name.includes(password)) ? '[REDACTED]' : name);
      return report('SCHEMA_INSPECTED', null, { readOnly: true,
        [statement.kind === 'columns' ? 'columns' : 'tables']: names, truncated: rows.length > LIVE_LIMIT });
    } catch {
      return report('ERROR', 'DB_INVALID_RESPONSE');
    }
  }

  /**
   * Validates whether a SQL query string is strictly safe and read-only.
   *
   * @param {string} sql
   * @returns {{ safe: boolean, error?: string }}
   */
  static validateReadOnlySql(sql) {
    if (typeof sql !== 'string' || !sql.trim()) {
      return { safe: false, error: 'SQL query must be a non-empty string.' };
    }

    const trimmed = sql.trim();

    // Check for multi-statements
    if (trimmed.includes(';')) {
      const parts = trimmed.split(';').map((s) => s.trim()).filter(Boolean);
      if (parts.length > 1) {
        return { safe: false, error: 'Multi-statement SQL queries are strictly prohibited.' };
      }
    }

    // Check for mutation keywords
    if (MUTATION_SQL_PATTERN.test(trimmed)) {
      return { safe: false, error: 'Query contains mutation or administrative SQL keywords.' };
    }

    // Check for dangerous PRAGMAs or EXPLAIN ANALYZE
    if (/\bPRAGMA\b/i.test(trimmed)) {
      const isReadOnlyPragma = /\bPRAGMA\s+(?:table_info|foreign_key_list|index_list|index_info)\b/i.test(trimmed);
      if (!isReadOnlyPragma) {
        return { safe: false, error: 'Only schema-inspection PRAGMA statements are permitted.' };
      }
    }

    if (/\bEXPLAIN\s+ANALYZE\b/i.test(trimmed)) {
      return { safe: false, error: 'EXPLAIN ANALYZE executes mutations and is not permitted.' };
    }

    // Must be SELECT or allowed PRAGMA or WITH query
    if (!/^\s*(?:SELECT|PRAGMA|WITH)\b/i.test(trimmed)) {
      return { safe: false, error: 'Query must be a SELECT or read-only PRAGMA query.' };
    }

    return { safe: true };
  }

  _inspectCsv(fullPath, relPath, delimiter, limit) {
    const content = readFileSync(fullPath, 'utf8');
    const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);

    if (lines.length === 0) {
      return {
        contract: DB_INSPECTION_CONTRACT,
        format: 'csv',
        path: relPath,
        status: 'EMPTY_FILE',
        rowCount: 0,
        columns: [],
        sample: [],
      };
    }

    const header = lines[0].split(delimiter).map((h) => h.trim().replace(/^["']|["']$/g, ''));
    const rows = lines.slice(1);
    const sampleRows = rows.slice(0, limit).map((line) => {
      const cells = line.split(delimiter).map((c) => c.trim().replace(/^["']|["']$/g, ''));
      const obj = {};
      header.forEach((col, idx) => {
        const val = cells[idx] ?? '';
        obj[col] = SENSITIVE_COLUMN_PATTERN.test(col) ? '[REDACTED]' : val;
      });
      return obj;
    });

    const columns = header.map((col) => ({
      name: col,
      isSensitive: SENSITIVE_COLUMN_PATTERN.test(col),
      inferredType: this._inferTypeFromSample(sampleRows.map((r) => r[col])),
    }));

    return {
      contract: DB_INSPECTION_CONTRACT,
      format: delimiter === '\t' ? 'tsv' : 'csv',
      path: relPath,
      status: 'INSPECTED',
      rowCount: rows.length,
      columnsCount: columns.length,
      columns,
      sample: sampleRows,
      sampleLimit: limit,
    };
  }

  _inspectJson(fullPath, relPath, limit) {
    try {
      const content = readFileSync(fullPath, 'utf8');
      const parsed = JSON.parse(content);

      if (Array.isArray(parsed)) {
        const sampleItems = parsed.slice(0, limit).map((item) => this._maskSensitiveObject(item));
        const allKeys = [...new Set(parsed.flatMap((item) => (typeof item === 'object' && item !== null ? Object.keys(item) : [])))];
        const columns = allKeys.map((k) => ({
          name: k,
          isSensitive: SENSITIVE_COLUMN_PATTERN.test(k),
          inferredType: this._inferTypeFromSample(sampleItems.map((r) => r[k])),
        }));

        return {
          contract: DB_INSPECTION_CONTRACT,
          format: 'json',
          path: relPath,
          status: 'INSPECTED',
          isCollection: true,
          rowCount: parsed.length,
          columns,
          sample: sampleItems,
        };
      } else if (typeof parsed === 'object' && parsed !== null) {
        const keys = Object.keys(parsed);
        const masked = this._maskSensitiveObject(parsed);
        return {
          contract: DB_INSPECTION_CONTRACT,
          format: 'json',
          path: relPath,
          status: 'INSPECTED',
          isCollection: false,
          propertiesCount: keys.length,
          columns: keys.map((k) => ({
            name: k,
            isSensitive: SENSITIVE_COLUMN_PATTERN.test(k),
            type: typeof parsed[k],
          })),
          sample: [masked],
        };
      }
    } catch (err) {
      return {
        contract: DB_INSPECTION_CONTRACT,
        format: 'json',
        path: relPath,
        status: 'PARSE_ERROR',
        error: String(err),
      };
    }
  }

  _inspectNdjson(fullPath, relPath, limit) {
    const content = readFileSync(fullPath, 'utf8');
    const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const parsedRows = [];

    for (let i = 0; i < Math.min(lines.length, limit); i++) {
      try {
        parsedRows.push(this._maskSensitiveObject(JSON.parse(lines[i])));
      } catch {
        // Skip malformed row
      }
    }

    const allKeys = [...new Set(parsedRows.flatMap((r) => Object.keys(r)))];
    return {
      contract: DB_INSPECTION_CONTRACT,
      format: 'ndjson',
      path: relPath,
      status: 'INSPECTED',
      rowCount: lines.length,
      columnsCount: allKeys.length,
      columns: allKeys.map((k) => ({
        name: k,
        isSensitive: SENSITIVE_COLUMN_PATTERN.test(k),
        inferredType: this._inferTypeFromSample(parsedRows.map((r) => r[k])),
      })),
      sample: parsedRows,
    };
  }

  _inspectSqlite(fullPath, relPath, limit) {
    const initialHash = hashFile(fullPath);
    try {
      // 1. Check file header signature
      const fd = readFileSync(fullPath);
      const isSqlite = fd.slice(0, 16).toString('ascii').startsWith('SQLite format 3');
      if (!isSqlite) {
        return {
          contract: DB_INSPECTION_CONTRACT,
          format: 'sqlite',
          path: relPath,
          status: 'INVALID_SQLITE_HEADER',
        };
      }

      // 2. If node:sqlite is not available, report supported header inspection
      if (!sqliteModule || !sqliteModule.DatabaseSync) {
        return {
          contract: DB_INSPECTION_CONTRACT,
          format: 'sqlite',
          path: relPath,
          status: 'HEADER_ONLY_FALLBACK',
          readOnly: true,
          mode: 'header-only',
          fileSizeBytes: statSync(fullPath).size,
          message: 'Valid SQLite format 3 database file identified. node:sqlite runtime is not present.',
        };
      }

      // 3. Open database in enforced read-only mode
      const db = new sqliteModule.DatabaseSync(fullPath, { readOnly: true });
      let tables = [];
      let views = [];

      try {
        const schemaItems = db.prepare(
          "SELECT type, name, tbl_name FROM sqlite_schema WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name ASC"
        ).all();

        for (const item of schemaItems) {
          const tableName = item.name;
          const escapedName = escapeSqliteIdentifier(tableName);
          const isView = item.type === 'view';

          // Safe metadata inspection using allowlisted PRAGMA statements
          let columns = [];
          try {
            const tableInfo = db.prepare(`PRAGMA table_info("${escapedName}")`).all();
            columns = tableInfo.map((col) => ({
              name: col.name,
              type: col.type || 'TEXT',
              notNull: Boolean(col.notnull),
              isPrimaryKey: Boolean(col.pk),
              isSensitive: SENSITIVE_COLUMN_PATTERN.test(col.name),
            }));
          } catch {
            // Fallback for virtual or special tables
          }

          let foreignKeys = [];
          if (!isView) {
            try {
              const fkInfo = db.prepare(`PRAGMA foreign_key_list("${escapedName}")`).all();
              foreignKeys = fkInfo.map((fk) => ({
                id: fk.id,
                table: fk.table,
                from: fk.from,
                to: fk.to,
              }));
            } catch {
              // Ignore pragma error
            }
          }

          let rowCount = 0;
          let sampleRows = [];
          try {
            const countRow = db.prepare(`SELECT COUNT(*) AS total FROM "${escapedName}"`).get();
            rowCount = countRow ? Number(countRow.total) : 0;

            const rawSamples = db.prepare(`SELECT * FROM "${escapedName}" LIMIT ?`).all(limit);
            sampleRows = rawSamples.map((row) => this._maskSensitiveObject(row));
          } catch {
            // Some views or virtual tables cannot be directly counted
          }

          const tableMetadata = {
            name: tableName,
            type: item.type,
            rowCount,
            columnsCount: columns.length,
            columns,
            foreignKeys,
            sample: sampleRows,
          };

          if (isView) {
            views.push(tableMetadata);
          } else {
            tables.push(tableMetadata);
          }
        }
      } finally {
        db.close();
      }

      // 4. Verify post-inspection hash to guarantee strict read-only execution
      const postHash = hashFile(fullPath);
      const unchanged = initialHash === postHash;

      return {
        contract: DB_INSPECTION_CONTRACT,
        format: 'sqlite',
        path: relPath,
        status: 'SCHEMA_INSPECTED',
        readOnly: true,
        databaseHash: postHash,
        hashVerifiedUnchanged: unchanged,
        tablesCount: tables.length,
        viewsCount: views.length,
        tables,
        views,
        sampleLimit: limit,
      };
    } catch (err) {
      return {
        contract: DB_INSPECTION_CONTRACT,
        format: 'sqlite',
        path: relPath,
        status: 'ERROR',
        error: String(err),
      };
    }
  }

  _maskSensitiveObject(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    const copy = Array.isArray(obj) ? [] : {};
    for (const [k, v] of Object.entries(obj)) {
      if (SENSITIVE_COLUMN_PATTERN.test(k)) {
        copy[k] = '[REDACTED]';
      } else if (v && typeof v === 'object') {
        copy[k] = this._maskSensitiveObject(v);
      } else {
        copy[k] = v;
      }
    }
    return copy;
  }

  _inferTypeFromSample(values) {
    const nonNulls = values.filter((v) => v !== null && v !== undefined && v !== '');
    if (nonNulls.length === 0) return 'unknown';

    if (nonNulls.every((v) => !isNaN(Number(v)))) {
      return nonNulls.every((v) => Number.isInteger(Number(v))) ? 'integer' : 'float';
    }
    if (nonNulls.every((v) => v === 'true' || v === 'false' || typeof v === 'boolean')) {
      return 'boolean';
    }
    if (nonNulls.every((v) => !isNaN(Date.parse(v)) && (v.includes('-') || v.includes('/')))) {
      return 'date';
    }
    return 'string';
  }
}
