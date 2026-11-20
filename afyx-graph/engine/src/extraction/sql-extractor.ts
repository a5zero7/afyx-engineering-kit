/**
 * AFYX-native SQL Schema & Query Intelligence Extractor (AFYX-209).
 *
 * Provides statement-aware static extraction for the SQL dialect family:
 * - PostgreSQL
 * - MySQL
 * - SQLite
 * - Microsoft T-SQL
 * - Oracle SQL / PL/SQL
 *
 * Extracted Relationships:
 * - Tables and Views (NodeKind 'class' and 'interface')
 * - Columns and Data Types (NodeKind 'field')
 * - Primary Keys and Foreign Key referential integrity (EdgeKind 'references')
 * - Indexes (NodeKind 'property') with table target edges
 * - Functions and Stored Procedures (NodeKind 'function')
 * - View-to-table dependencies (EdgeKind 'references')
 */

import * as path from 'path';
import type { Node, Edge, ExtractionResult, ExtractionError, UnresolvedReference } from '../types';
import { generateNodeId } from './node-id';

export function isSqlFile(filePath: string): boolean {
  return filePath.toLowerCase().endsWith('.sql');
}

export class SqlExtractor {
  private filePath: string;
  private source: string;
  private nodes: Node[] = [];
  private edges: Edge[] = [];
  private unresolvedReferences: UnresolvedReference[] = [];
  private errors: ExtractionError[] = [];

  constructor(filePath: string, source: string) {
    this.filePath = filePath;
    this.source = source;
  }

  extract(): ExtractionResult {
    const startTime = Date.now();

    try {
      const fileNode = this.createFileNode();
      this.parseSqlStatements(fileNode.id);
    } catch (err) {
      this.errors.push({
        message: `SQL extraction error in ${this.filePath}: ${err instanceof Error ? err.message : String(err)}`,
        filePath: this.filePath,
        severity: 'warning',
        code: 'sql_parse_error',
      });
    }

    return {
      nodes: this.nodes,
      edges: this.edges,
      unresolvedReferences: this.unresolvedReferences,
      errors: this.errors,
      durationMs: Date.now() - startTime,
    };
  }

  private createFileNode(): Node {
    const lines = this.source.split(/\r?\n/);
    const fileName = path.basename(this.filePath);
    const id = generateNodeId(this.filePath, 'file', fileName, 1);

    const fileNode: Node = {
      id,
      kind: 'file',
      name: fileName,
      qualifiedName: this.filePath,
      filePath: this.filePath,
      language: 'cfquery',
      startLine: 1,
      endLine: Math.max(lines.length, 1),
      startColumn: 0,
      endColumn: (lines[lines.length - 1] || '').length,
      updatedAt: Date.now(),
    };

    this.nodes.push(fileNode);
    return fileNode;
  }

  private cleanIdentifier(ident: string): string {
    if (!ident) return '';
    let s = ident.trim();
    // Strip quotes: "id", `id`, [id]
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith('`') && s.endsWith('`'))) {
      s = s.slice(1, -1);
    } else if (s.startsWith('[') && s.endsWith(']')) {
      s = s.slice(1, -1);
    }
    return s.trim();
  }

  private parseSqlStatements(fileNodeId: string): void {
    const lines = this.source.split(/\r?\n/);
    const tableNodes = new Map<string, string>(); // tableName (lowercase) -> nodeId

    // First: tokenize text while stripping comments and tracking line numbers
    interface Statement {
      startLine: number;
      endLine: number;
      text: string;
    }

    const statements: Statement[] = [];
    let curStmt = '';
    let stmtStartLine = 1;

    let inBlockComment = false;
    let inDollarQuote = false;
    let dollarTag = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineNum = i + 1;
      let lineText = '';

      let idx = 0;
      while (idx < line.length) {
        if (inBlockComment) {
          const endComment = line.indexOf('*/', idx);
          if (endComment >= 0) {
            inBlockComment = false;
            idx = endComment + 2;
          } else {
            break; // rest of line is inside comment
          }
        } else if (inDollarQuote) {
          const endDollar = line.indexOf(dollarTag, idx);
          if (endDollar >= 0) {
            inDollarQuote = false;
            lineText += line.slice(idx, endDollar + dollarTag.length);
            idx = endDollar + dollarTag.length;
          } else {
            lineText += line.slice(idx);
            break;
          }
        } else {
          // Check for line comment --
          if (line[idx] === '-' && line[idx + 1] === '-') {
            break; // comment till end of line
          }
          // Check for block comment /*
          if (line[idx] === '/' && line[idx + 1] === '*') {
            inBlockComment = true;
            idx += 2;
            continue;
          }
          // Check for PostgreSQL dollar quotes $$ or $tag$
          if (line[idx] === '$') {
            const m = line.slice(idx).match(/^\$[a-zA-Z0-9_]*\$/);
            if (m) {
              inDollarQuote = true;
              dollarTag = m[0];
              lineText += dollarTag;
              idx += dollarTag.length;
              continue;
            }
          }

          lineText += line[idx];
          idx++;
        }
      }

      const trimmed = lineText.trim();
      // Check for T-SQL 'GO' separator
      if (/^\s*GO\s*$/i.test(trimmed)) {
        if (curStmt.trim()) {
          statements.push({ startLine: stmtStartLine, endLine: lineNum - 1, text: curStmt.trim() });
          curStmt = '';
        }
        stmtStartLine = lineNum + 1;
        continue;
      }

      // Check statement terminators (semicolon or Oracle slash '/')
      let pos = 0;
      while (pos < lineText.length) {
        const semiIdx = lineText.indexOf(';', pos);
        if (semiIdx >= 0) {
          curStmt += ' ' + lineText.slice(pos, semiIdx);
          if (curStmt.trim()) {
            statements.push({ startLine: stmtStartLine, endLine: lineNum, text: curStmt.trim() });
          }
          curStmt = '';
          stmtStartLine = lineNum;
          pos = semiIdx + 1;
        } else {
          curStmt += ' ' + lineText.slice(pos);
          break;
        }
      }

      if (trimmed === '/' && curStmt.trim()) {
        statements.push({ startLine: stmtStartLine, endLine: lineNum, text: curStmt.trim() });
        curStmt = '';
        stmtStartLine = lineNum + 1;
      }
    }

    if (curStmt.trim()) {
      statements.push({ startLine: stmtStartLine, endLine: lines.length, text: curStmt.trim() });
    }

    // Process each statement
    for (const stmt of statements) {
      const s = stmt.text.trim();
      if (!s) continue;

      // 1. CREATE TABLE
      const createTableMatch = s.match(
        /^CREATE\s+(?:(?:GLOBAL\s+TEMPORARY|TEMPORARY|TEMP|UNLOGGED)\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)\s*\(([\s\S]*)\)(?:[^\)]*)$/i,
      );
      if (createTableMatch) {
        const rawTableName = createTableMatch[1]!;
        const body = createTableMatch[2]!;
        const tableName = this.cleanIdentifier(rawTableName.split('.').pop() || rawTableName);
        const schema = rawTableName.includes('.') ? this.cleanIdentifier(rawTableName.split('.')[0]!) : '';
        const qualName = schema ? `${schema}.${tableName}` : tableName;

        const tableNodeId = generateNodeId(this.filePath, 'class', `table:${qualName}`, stmt.startLine);
        this.nodes.push({
          id: tableNodeId,
          kind: 'class',
          name: tableName,
          qualifiedName: `${this.filePath}#${qualName}`,
          filePath: this.filePath,
          language: 'cfquery',
          startLine: stmt.startLine,
          endLine: stmt.endLine,
          startColumn: 0,
          endColumn: 0,
          signature: `TABLE ${qualName}`,
          updatedAt: Date.now(),
        });
        this.edges.push({
          source: fileNodeId,
          target: tableNodeId,
          kind: 'contains',
        });
        tableNodes.set(tableName.toLowerCase(), tableNodeId);
        if (schema) tableNodes.set(qualName.toLowerCase(), tableNodeId);

        // Parse columns and table constraints
        this.parseTableBody(body, tableNodeId, qualName, stmt.startLine, tableNodes);
        continue;
      }

      // 2. ALTER TABLE ADD CONSTRAINT FOREIGN KEY
      const alterFkMatch = s.match(
        /^ALTER\s+TABLE\s+(?:ONLY\s+)?([^\s]+)\s+ADD\s+(?:CONSTRAINT\s+[^\s]+\s+)?FOREIGN\s+KEY\s*\(([^\)]+)\)\s*REFERENCES\s+([^\s(]+)(?:\s*\(([^\)]+)\))?/i,
      );
      if (alterFkMatch) {
        const sourceTable = this.cleanIdentifier(alterFkMatch[1]!.split('.').pop()!);
        const targetTable = this.cleanIdentifier(alterFkMatch[3]!.split('.').pop()!);

        const sourceId = tableNodes.get(sourceTable.toLowerCase());
        const targetId = tableNodes.get(targetTable.toLowerCase());

        if (sourceId && targetId) {
          this.edges.push({
            source: sourceId,
            target: targetId,
            kind: 'references',
          });
        } else if (sourceId) {
          this.unresolvedReferences.push({
            fromNodeId: sourceId,
            referenceName: targetTable,
            referenceKind: 'references',
            line: stmt.startLine,
            column: 0,
          });
        }
        continue;
      }

      // 3. CREATE VIEW
      const createViewMatch = s.match(
        /^CREATE\s+(?:OR\s+REPLACE\s+)?(?:(?:TEMPORARY|TEMP)\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)(?:\s*\([^\)]*\))?\s+AS\s+([\s\S]+)/i,
      );
      if (createViewMatch) {
        const rawViewName = createViewMatch[1]!;
        const queryBody = createViewMatch[2]!;
        const viewName = this.cleanIdentifier(rawViewName.split('.').pop() || rawViewName);

        const viewId = generateNodeId(this.filePath, 'interface', `view:${viewName}`, stmt.startLine);
        this.nodes.push({
          id: viewId,
          kind: 'interface',
          name: viewName,
          qualifiedName: `${this.filePath}#view:${viewName}`,
          filePath: this.filePath,
          language: 'cfquery',
          startLine: stmt.startLine,
          endLine: stmt.endLine,
          startColumn: 0,
          endColumn: 0,
          signature: `VIEW ${viewName}`,
          updatedAt: Date.now(),
        });
        this.edges.push({
          source: fileNodeId,
          target: viewId,
          kind: 'contains',
        });
        tableNodes.set(viewName.toLowerCase(), viewId);

        // Find referenced tables in query FROM and JOIN
        this.extractQueryTableReferences(queryBody, viewId, stmt.startLine, tableNodes);
        continue;
      }

      // 4. CREATE INDEX
      const createIndexMatch = s.match(
        /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s]+)\s+ON\s+([^\s(]+)/i,
      );
      if (createIndexMatch) {
        const idxName = this.cleanIdentifier(createIndexMatch[1]!.split('.').pop()!);
        const onTable = this.cleanIdentifier(createIndexMatch[2]!.split('.').pop()!);

        const idxId = generateNodeId(this.filePath, 'property', `index:${idxName}`, stmt.startLine);
        this.nodes.push({
          id: idxId,
          kind: 'property',
          name: idxName,
          qualifiedName: `${this.filePath}#index:${idxName}`,
          filePath: this.filePath,
          language: 'cfquery',
          startLine: stmt.startLine,
          endLine: stmt.endLine,
          startColumn: 0,
          endColumn: 0,
          signature: `INDEX ${idxName} ON ${onTable}`,
          updatedAt: Date.now(),
        });
        this.edges.push({
          source: fileNodeId,
          target: idxId,
          kind: 'contains',
        });

        const targetTableId = tableNodes.get(onTable.toLowerCase());
        if (targetTableId) {
          this.edges.push({
            source: idxId,
            target: targetTableId,
            kind: 'references',
          });
        }
        continue;
      }

      // 5. CREATE FUNCTION / PROCEDURE / PACKAGE (Oracle, PostgreSQL, MySQL)
      const createRoutineMatch = s.match(
        /^CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE|PACKAGE(?:\s+BODY)?|TRIGGER)\s+([^\s(]+)/i,
      );
      if (createRoutineMatch) {
        const rawName = createRoutineMatch[1]!;
        const routineName = this.cleanIdentifier(rawName.split('.').pop() || rawName);
        const routineId = generateNodeId(this.filePath, 'function', `routine:${routineName}`, stmt.startLine);

        this.nodes.push({
          id: routineId,
          kind: 'function',
          name: routineName,
          qualifiedName: `${this.filePath}#routine:${routineName}`,
          filePath: this.filePath,
          language: 'cfquery',
          startLine: stmt.startLine,
          endLine: stmt.endLine,
          startColumn: 0,
          endColumn: 0,
          signature: `ROUTINE ${routineName}`,
          updatedAt: Date.now(),
        });
        this.edges.push({
          source: fileNodeId,
          target: routineId,
          kind: 'contains',
        });
      }
    }
  }

  private parseTableBody(
    body: string,
    tableNodeId: string,
    tableQualName: string,
    startLine: number,
    tableNodes: Map<string, string>,
  ): void {
    // Split columns by comma, respecting parentheses
    const columnDefs: string[] = [];
    let cur = '';
    let parenDepth = 0;

    for (let i = 0; i < body.length; i++) {
      const ch = body[i]!;
      if (ch === '(') parenDepth++;
      else if (ch === ')') parenDepth--;

      if (ch === ',' && parenDepth === 0) {
        columnDefs.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    if (cur.trim()) columnDefs.push(cur.trim());

    for (const def of columnDefs) {
      const trimmed = def.trim();
      if (!trimmed) continue;

      // Table-level PRIMARY KEY constraint: PRIMARY KEY (col1, col2)
      if (/^(?:CONSTRAINT\s+[^\s]+\s+)?PRIMARY\s+KEY\s*\((.*)\)/i.test(trimmed)) {
        const pkId = generateNodeId(this.filePath, 'property', `${tableQualName}:PK`, startLine);
        this.nodes.push({
          id: pkId,
          kind: 'property',
          name: 'PRIMARY KEY',
          qualifiedName: `${this.filePath}#${tableQualName}:PK`,
          filePath: this.filePath,
          language: 'cfquery',
          startLine,
          endLine: startLine,
          startColumn: 0,
          endColumn: 0,
          signature: trimmed,
          updatedAt: Date.now(),
        });
        this.edges.push({
          source: tableNodeId,
          target: pkId,
          kind: 'contains',
        });
        continue;
      }

      // Table-level FOREIGN KEY constraint: FOREIGN KEY (col) REFERENCES other_table(col)
      const tableFkMatch = trimmed.match(
        /^(?:CONSTRAINT\s+[^\s]+\s+)?FOREIGN\s+KEY\s*\(([^\)]+)\)\s*REFERENCES\s+([^\s(]+)/i,
      );
      if (tableFkMatch) {
        const targetTable = this.cleanIdentifier(tableFkMatch[2]!.split('.').pop()!);
        const targetId = tableNodes.get(targetTable.toLowerCase());
        if (targetId) {
          this.edges.push({
            source: tableNodeId,
            target: targetId,
            kind: 'references',
          });
        } else {
          this.unresolvedReferences.push({
            fromNodeId: tableNodeId,
            referenceName: targetTable,
            referenceKind: 'references',
            line: startLine,
            column: 0,
          });
        }
        continue;
      }

      // Standard Column Definition: col_name data_type [constraints]
      const colMatch = trimmed.match(/^([^\s]+)\s+([^\s,(]+(?:\s*\([^\)]*\))?)([\s\S]*)/i);
      if (colMatch) {
        const rawColName = colMatch[1]!;
        // Avoid reserved constraint keywords as column names
        if (/^(PRIMARY|FOREIGN|CONSTRAINT|UNIQUE|CHECK|INDEX|KEY)$/i.test(rawColName)) {
          continue;
        }

        const colName = this.cleanIdentifier(rawColName);
        const colType = colMatch[2]!.trim();
        const constraints = colMatch[3] || '';

        const isPk = /PRIMARY\s+KEY/i.test(constraints);
        const sig = isPk ? `${colType} PRIMARY KEY` : colType;

        const colId = generateNodeId(this.filePath, 'field', `${tableQualName}.${colName}`, startLine);
        this.nodes.push({
          id: colId,
          kind: 'field',
          name: colName,
          qualifiedName: `${this.filePath}#${tableQualName}.${colName}`,
          filePath: this.filePath,
          language: 'cfquery',
          startLine,
          endLine: startLine,
          startColumn: 0,
          endColumn: 0,
          signature: sig,
          updatedAt: Date.now(),
        });
        this.edges.push({
          source: tableNodeId,
          target: colId,
          kind: 'contains',
        });

        // Inline REFERENCES other_table(col)
        const inlineRefMatch = constraints.match(/REFERENCES\s+([^\s(]+)/i);
        if (inlineRefMatch) {
          const targetTable = this.cleanIdentifier(inlineRefMatch[1]!.split('.').pop()!);
          const targetTableId = tableNodes.get(targetTable.toLowerCase());
          if (targetTableId) {
            this.edges.push({
              source: colId,
              target: targetTableId,
              kind: 'references',
            });
            this.edges.push({
              source: tableNodeId,
              target: targetTableId,
              kind: 'references',
            });
          } else {
            this.unresolvedReferences.push({
              fromNodeId: colId,
              referenceName: targetTable,
              referenceKind: 'references',
              line: startLine,
              column: 0,
            });
          }
        }
      }
    }
  }

  private extractQueryTableReferences(
    query: string,
    fromNodeId: string,
    line: number,
    tableNodes: Map<string, string>,
  ): void {
    const fromJoinRegex = /\b(?:FROM|JOIN)\s+([^\s(),;]+)/gi;
    let match: RegExpExecArray | null;

    while ((match = fromJoinRegex.exec(query)) !== null) {
      const rawTarget = match[1]!;
      // Skip subqueries starting with (
      if (rawTarget.startsWith('(') || /^(SELECT|VALUES)$/i.test(rawTarget)) continue;

      const targetTable = this.cleanIdentifier(rawTarget.split('.').pop() || rawTarget);
      const targetId = tableNodes.get(targetTable.toLowerCase());

      if (targetId) {
        this.edges.push({
          source: fromNodeId,
          target: targetId,
          kind: 'references',
        });
      } else {
        this.unresolvedReferences.push({
          fromNodeId,
          referenceName: targetTable,
          referenceKind: 'references',
          line,
          column: match.index,
        });
      }
    }
  }
}
