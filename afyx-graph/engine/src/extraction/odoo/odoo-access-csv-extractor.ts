import type { Edge, ExtractionError, ExtractionResult, Node, UnresolvedReference } from '../../types';
import { generateNodeId } from '../node-id';

interface ParsedCsvRecord {
  line: number;
  fields: string[];
}

/**
 * Safe RFC 4180 CSV tokenizer and parser.
 * Correctly handles quotes, embedded commas, newlines within quotes, and escaped quotes.
 */
function parseCsv(source: string): { records: ParsedCsvRecord[]; errors: ExtractionError[] } {
  const records: ParsedCsvRecord[] = [];
  const errors: ExtractionError[] = [];
  const len = source.length;
  let i = 0;
  let currentLine = 1;

  let currentFields: string[] = [];
  let currentField = '';
  let inQuotes = false;
  let fieldStartLine = 1;

  while (i < len) {
    const ch = source[i];

    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < len && source[i + 1] === '"') {
          // Escaped quote: ""
          currentField += '"';
          i += 2;
          continue;
        }
        // Closing quote
        inQuotes = false;
        i++;
        continue;
      }
      if (ch === '\n') {
        currentLine++;
      }
      currentField += ch;
      i++;
      continue;
    }

    // Outside quotes
    if (ch === '"') {
      inQuotes = true;
      fieldStartLine = currentLine;
      i++;
      continue;
    }

    if (ch === ',') {
      currentFields.push(currentField.trim());
      currentField = '';
      i++;
      continue;
    }

    if (ch === '\r') {
      if (i + 1 < len && source[i + 1] === '\n') {
        i++;
      }
      currentFields.push(currentField.trim());
      currentField = '';
      if (currentFields.some((f) => f.length > 0)) {
        records.push({ line: currentLine, fields: currentFields });
      }
      currentFields = [];
      currentLine++;
      i++;
      continue;
    }

    if (ch === '\n') {
      currentFields.push(currentField.trim());
      currentField = '';
      if (currentFields.some((f) => f.length > 0)) {
        records.push({ line: currentLine, fields: currentFields });
      }
      currentFields = [];
      currentLine++;
      i++;
      continue;
    }

    currentField += ch;
    i++;
  }

  // Push remaining field / record
  if (inQuotes) {
    errors.push({
      message: `Unterminated quoted CSV field starting at line ${fieldStartLine}`,
      line: fieldStartLine,
      column: 1,
      severity: 'error',
      code: 'syntax_error',
    });
  }

  if (currentField.length > 0 || currentFields.length > 0) {
    currentFields.push(currentField.trim());
    if (currentFields.some((f) => f.length > 0)) {
      records.push({ line: currentLine, fields: currentFields });
    }
  }

  return { records, errors };
}

/**
 * Standard Odoo model name conversion from XML ID:
 * `model_purchase_request` -> `purchase.request`
 */
function odooModelNameFromId(modelId: string): string {
  if (modelId.startsWith('model_')) {
    return modelId.slice(6).replace(/_/g, '.');
  }
  return modelId;
}

/**
 * Parse binary permission flag (0, 1, '0', '1', 'True', 'False').
 * Returns number 0 or 1, or null if invalid.
 */
function parsePermFlag(val: string): number | null {
  const clean = val.trim().toLowerCase();
  if (clean === '1' || clean === 'true') return 1;
  if (clean === '0' || clean === 'false' || clean === '') return 0;
  return null;
}

/**
 * Extractor for Odoo Access Control List CSV files (ir.model.access.csv).
 */
export class OdooAccessCsvExtractor {
  private readonly filePath: string;
  private readonly source: string;
  private readonly nodes: Node[] = [];
  private readonly edges: Edge[] = [];
  private readonly unresolvedReferences: UnresolvedReference[] = [];
  private readonly errors: ExtractionError[] = [];

  constructor(filePath: string, source: string) {
    this.filePath = filePath.replace(/\\/g, '/');
    this.source = source;
  }

  extract(): ExtractionResult {
    const startTime = Date.now();
    const { records, errors: parseErrors } = parseCsv(this.source);
    this.errors.push(...parseErrors);

    if (records.length === 0) {
      return {
        nodes: this.nodes,
        edges: this.edges,
        unresolvedReferences: this.unresolvedReferences,
        errors: this.errors,
        durationMs: Date.now() - startTime,
      };
    }

    // Emit file-level node
    const lineCount = (this.source.match(/\n/g) || []).length + 1;
    const fileNodeId = generateNodeId(this.filePath, 'file', this.filePath, 1);
    const fileNode: Node = {
      id: fileNodeId,
      kind: 'file',
      name: this.filePath.split('/').pop() || this.filePath,
      qualifiedName: this.filePath,
      filePath: this.filePath,
      language: 'csv',
      startLine: 1,
      endLine: lineCount,
      startColumn: 1,
      endColumn: 1,
      signature: `file ${this.filePath}`,
      updatedAt: Date.now(),
    };
    this.nodes.push(fileNode);

    // Inspect header row
    const headerRecord = records[0]!;
    const headerCols = headerRecord.fields.map((c) => c.toLowerCase().trim());

    const idIdx = headerCols.indexOf('id');
    const nameIdx = headerCols.indexOf('name');
    let modelIdx = headerCols.indexOf('model_id:id');
    if (modelIdx < 0) modelIdx = headerCols.indexOf('model_id');
    let groupIdx = headerCols.indexOf('group_id:id');
    if (groupIdx < 0) groupIdx = headerCols.indexOf('group_id');
    const readIdx = headerCols.indexOf('perm_read');
    const writeIdx = headerCols.indexOf('perm_write');
    const createIdx = headerCols.indexOf('perm_create');
    const unlinkIdx = headerCols.indexOf('perm_unlink');

    if (idIdx < 0 || modelIdx < 0 || readIdx < 0 || writeIdx < 0 || createIdx < 0 || unlinkIdx < 0) {
      this.errors.push({
        message: `CSV file does not match Odoo ir.model.access.csv header specification: '${headerRecord.fields.join(',')}'`,
        line: headerRecord.line,
        column: 1,
        severity: 'warning',
        code: 'invalid_acl_header',
      });
      return {
        nodes: this.nodes,
        edges: this.edges,
        unresolvedReferences: this.unresolvedReferences,
        errors: this.errors,
        durationMs: Date.now() - startTime,
      };
    }

    const seenRuleIds = new Set<string>();

    // Process data rows
    for (let r = 1; r < records.length; r++) {
      const row = records[r]!;
      const fields = row.fields;
      if (fields.length <= idIdx || !fields[idIdx]) continue;

      const ruleId = fields[idIdx]!;
      if (seenRuleIds.has(ruleId)) {
        this.errors.push({
          message: `Duplicate ACL rule id '${ruleId}' in file at line ${row.line}`,
          line: row.line,
          column: 1,
          severity: 'warning',
          code: 'duplicate_rule_id',
        });
      } else {
        seenRuleIds.add(ruleId);
      }

      const ruleName = nameIdx >= 0 && fields[nameIdx] ? fields[nameIdx]! : ruleId;
      const modelXmlId = fields[modelIdx] || '';
      const groupXmlId = groupIdx >= 0 && fields[groupIdx] ? fields[groupIdx]! : '';

      const rFlag = readIdx >= 0 && fields[readIdx] !== undefined ? parsePermFlag(fields[readIdx]!) : 0;
      const wFlag = writeIdx >= 0 && fields[writeIdx] !== undefined ? parsePermFlag(fields[writeIdx]!) : 0;
      const cFlag = createIdx >= 0 && fields[createIdx] !== undefined ? parsePermFlag(fields[createIdx]!) : 0;
      const uFlag = unlinkIdx >= 0 && fields[unlinkIdx] !== undefined ? parsePermFlag(fields[unlinkIdx]!) : 0;

      if (rFlag === null || wFlag === null || cFlag === null || uFlag === null) {
        this.errors.push({
          message: `Invalid or non-boolean permission flag for ACL rule '${ruleId}' at line ${row.line} (defaulted to 0/DENIED)`,
          line: row.line,
          column: 1,
          severity: 'warning',
          code: 'invalid_permission_flag',
        });
      }

      const permR = rFlag ?? 0;
      const permW = wFlag ?? 0;
      const permC = cFlag ?? 0;
      const permU = uFlag ?? 0;

      const modelOdooName = odooModelNameFromId(modelXmlId);
      const isGlobal = !groupXmlId;
      const nodeId = generateNodeId(this.filePath, 'constant', ruleId, row.line);

      const node: Node = {
        id: nodeId,
        kind: 'constant',
        name: ruleId,
        qualifiedName: `${this.filePath}::${ruleId}`,
        filePath: this.filePath,
        language: 'csv',
        startLine: row.line,
        endLine: row.line,
        startColumn: 1,
        endColumn: fields.join(',').length,
        signature: `ACL: model=${modelOdooName} (${modelXmlId}), group=${isGlobal ? 'GLOBAL (All Users)' : groupXmlId}, grants=[read:${permR}, write:${permW}, create:${permC}, unlink:${permU}]`,
        docstring: [
          `Odoo Access Control List Rule: ${ruleName}`,
          `Rule ID: ${ruleId}`,
          `Model: ${modelOdooName} (${modelXmlId})`,
          `Group: ${isGlobal ? 'GLOBAL (All Users)' : groupXmlId}`,
          `Grants (Model-Level):`,
          `- Read: ${permR === 1 ? 'GRANTED' : 'DENIED (Not granted)'}`,
          `- Write: ${permW === 1 ? 'GRANTED' : 'DENIED (Not granted)'}`,
          `- Create: ${permC === 1 ? 'GRANTED' : 'DENIED (Not granted)'}`,
          `- Unlink: ${permU === 1 ? 'GRANTED' : 'DENIED (Not granted)'}`,
        ].join('\n'),
        updatedAt: Date.now(),
      };
      this.nodes.push(node);

      // Edge / UnresolvedReference to model
      const primaryModelRef = modelXmlId || modelOdooName;
      if (primaryModelRef) {
        this.unresolvedReferences.push({
          fromNodeId: nodeId,
          referenceName: primaryModelRef,
          referenceKind: 'references',
          line: row.line,
          column: 1,
          filePath: this.filePath,
          language: 'csv',
        });
      }

      // Edge / UnresolvedReference to group
      if (groupXmlId) {
        this.unresolvedReferences.push({
          fromNodeId: nodeId,
          referenceName: groupXmlId,
          referenceKind: 'references',
          line: row.line,
          column: 1,
          filePath: this.filePath,
          language: 'csv',
        });
      }
    }

    return {
      nodes: this.nodes,
      edges: this.edges,
      unresolvedReferences: this.unresolvedReferences,
      errors: this.errors,
      durationMs: Date.now() - startTime,
    };
  }
}
