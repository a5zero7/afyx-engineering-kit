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
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { checkPathContainment } from './path-containment.js';

export const DB_INSPECTION_CONTRACT = 'AfyxDbInspection/v1';

const SENSITIVE_COLUMN_PATTERN = /^(password|passwd|secret|token|api_key|apikey|auth|ssn|credit_card|card_num|hash|salt|private_key)$/i;

const MUTATION_SQL_PATTERN = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|REPLACE|GRANT|REVOKE|VACUUM|ATTACH|DETACH|REINDEX)\b/i;

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

export class DbInspector {
  /**
   * @param {string} workspaceRoot
   */
  constructor(workspaceRoot) {
    this.workspaceRoot = resolve(workspaceRoot);
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
      if (containment.reason === 'PATH_TRAVERSAL_ESCAPE' || containment.reason === 'SYMLINK_ESCAPE' || containment.reason === 'ANCESTOR_ESCAPE') {
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

    const fullPath = containment.canonicalPath || resolve(this.workspaceRoot, relativePath);
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
  inspectExternalCatalog(dialect, config = {}) {
    // Fails closed if driver or live connection is not independently permitted/available
    return {
      contract: DB_INSPECTION_CONTRACT,
      dialect,
      status: 'NOT_AVAILABLE',
      reason: `External live database connection for '${dialect}' is not configured or permitted in this context.`,
      supportedDialects: ['sqlite', 'postgres', 'mysql', 'mssql'],
    };
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
          status: 'INSPECTED',
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
          const isView = item.type === 'view';

          // Safe metadata inspection using allowlisted PRAGMA statements
          let columns = [];
          try {
            const tableInfo = db.prepare(`PRAGMA table_info("${tableName}")`).all();
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
              const fkInfo = db.prepare(`PRAGMA foreign_key_list("${tableName}")`).all();
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
            const countRow = db.prepare(`SELECT COUNT(*) AS total FROM "${tableName}"`).get();
            rowCount = countRow ? Number(countRow.total) : 0;

            const rawSamples = db.prepare(`SELECT * FROM "${tableName}" LIMIT ?`).all(limit);
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
        status: 'INSPECTED',
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
