import type { Edge, ExtractionError, ExtractionResult, Node, UnresolvedReference } from '../../types';
import { generateNodeId } from '../node-id';

/**
 * Standard Odoo model name conversion from XML ID:
 * `model_purchase_request` -> `purchase.request`
 * `purchase.model_purchase_order` -> `purchase.order`
 */
function odooModelNameFromId(modelId: string): string {
  const parts = modelId.split('.');
  const bareId = parts[parts.length - 1]!;
  if (bareId.startsWith('model_')) {
    return bareId.slice(6).replace(/_/g, '.');
  }
  return modelId;
}

/**
 * Unescape standard XML predefined entities.
 */
function unescapeXml(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * Strips XML comments while preserving newlines and byte lengths.
 * CDATA sections are preserved intact.
 */
function stripXmlComments(source: string): string {
  const out = source.split('');
  const n = source.length;
  let i = 0;
  while (i < n) {
    if (source.startsWith('<![CDATA[', i)) {
      const end = source.indexOf(']]>', i + 9);
      i = end >= 0 ? end + 3 : n;
      continue;
    }
    if (source.startsWith('<!--', i)) {
      const end = source.indexOf('-->', i + 4);
      const stop = end >= 0 ? end + 3 : n;
      for (let j = i; j < stop; j++) {
        if (source.charCodeAt(j) !== 10) out[j] = ' ';
      }
      i = stop;
      continue;
    }
    i++;
  }
  return out.join('');
}

interface XmlElementToken {
  name: string;
  attributes: Record<string, string>;
  isSelfClosing: boolean;
  isClosing: boolean;
  line: number;
  col: number;
}

/**
 * Safe, non-recursing linear scanner that extracts XML element tags and attributes.
 * O(N) complexity with zero regex catastrophic backtracking risk.
 */
class SafeXmlScanner {
  private pos = 0;
  private line = 1;
  private col = 1;
  private readonly len: number;

  constructor(private readonly source: string) {
    this.len = source.length;
  }

  getLine(): number {
    return this.line;
  }

  nextElement(): XmlElementToken | null {
    while (this.pos < this.len) {
      const ch = this.source[this.pos];
      if (ch === '\n') {
        this.line++;
        this.col = 1;
        this.pos++;
        continue;
      }

      if (ch === '<') {
        // Check CDATA
        if (this.source.startsWith('<![CDATA[', this.pos)) {
          const end = this.source.indexOf(']]>', this.pos + 9);
          if (end >= 0) {
            this.advancePast(end + 3);
          } else {
            this.advancePast(this.len);
          }
          continue;
        }

        // Check DOCTYPE / Processing Instructions
        if (this.source.startsWith('<?', this.pos) || this.source.startsWith('<!', this.pos)) {
          const end = this.source.indexOf('>', this.pos);
          if (end >= 0) {
            this.advancePast(end + 1);
          } else {
            this.advancePast(this.len);
          }
          continue;
        }

        // Element tag
        const startLine = this.line;
        const startCol = this.col;
        this.pos++;
        this.col++;

        let isClosing = false;
        if (this.pos < this.len && this.source[this.pos] === '/') {
          isClosing = true;
          this.pos++;
          this.col++;
        }

        // Read tag name
        this.skipWhitespace();
        const nameStart = this.pos;
        while (this.pos < this.len && /[a-zA-Z0-9_.:-]/.test(this.source[this.pos]!)) {
          this.pos++;
          this.col++;
        }
        const tagName = this.source.slice(nameStart, this.pos).toLowerCase();
        if (!tagName) continue;

        // Read attributes
        const attributes: Record<string, string> = {};
        let isSelfClosing = false;

        while (this.pos < this.len) {
          this.skipWhitespace();
          if (this.pos >= this.len) break;

          const curr = this.source[this.pos];
          if (curr === '>') {
            this.pos++;
            this.col++;
            break;
          }
          if (curr === '/' && this.pos + 1 < this.len && this.source[this.pos + 1] === '>') {
            isSelfClosing = true;
            this.pos += 2;
            this.col += 2;
            break;
          }

          // Attribute name
          const attrNameStart = this.pos;
          while (this.pos < this.len && /[a-zA-Z0-9_.:-]/.test(this.source[this.pos]!)) {
            this.pos++;
            this.col++;
          }
          const attrName = this.source.slice(attrNameStart, this.pos).toLowerCase();
          if (!attrName) {
            this.pos++;
            this.col++;
            continue;
          }

          this.skipWhitespace();
          if (this.pos < this.len && this.source[this.pos] === '=') {
            this.pos++;
            this.col++;
            this.skipWhitespace();

            if (this.pos < this.len) {
              const quote = this.source[this.pos];
              if (quote === '"' || quote === "'") {
                this.pos++;
                this.col++;
                const valStart = this.pos;
                while (this.pos < this.len && this.source[this.pos] !== quote) {
                  if (this.source[this.pos] === '\n') {
                    this.line++;
                    this.col = 1;
                  } else {
                    this.col++;
                  }
                  this.pos++;
                }
                const rawVal = this.source.slice(valStart, this.pos);
                attributes[attrName] = unescapeXml(rawVal);
                if (this.pos < this.len && this.source[this.pos] === quote) {
                  this.pos++;
                  this.col++;
                }
              }
            }
          }
        }

        return {
          name: tagName,
          attributes,
          isSelfClosing,
          isClosing,
          line: startLine,
          col: startCol,
        };
      }

      this.pos++;
      this.col++;
    }

    return null;
  }

  /** Read inner text content up to the matching closing tag </tagName> */
  readTextUntilClosing(tagName: string): string {
    const start = this.pos;
    const lowerTag = tagName.toLowerCase();
    while (this.pos < this.len) {
      if (this.source[this.pos] === '\n') {
        this.line++;
        this.col = 1;
        this.pos++;
        continue;
      }
      if (this.source[this.pos] === '<') {
        if (this.source.startsWith(`</${lowerTag}>`, this.pos) || this.source.startsWith(`</${tagName}>`, this.pos)) {
          const text = this.source.slice(start, this.pos);
          return unescapeXml(text).trim();
        }
      }
      this.pos++;
      this.col++;
    }
    return unescapeXml(this.source.slice(start, this.pos)).trim();
  }

  private skipWhitespace(): void {
    while (this.pos < this.len && /\s/.test(this.source[this.pos]!)) {
      if (this.source[this.pos] === '\n') {
        this.line++;
        this.col = 1;
      } else {
        this.col++;
      }
      this.pos++;
    }
  }

  private advancePast(targetPos: number): void {
    while (this.pos < targetPos && this.pos < this.len) {
      if (this.source[this.pos] === '\n') {
        this.line++;
        this.col = 1;
      } else {
        this.col++;
      }
      this.pos++;
    }
  }
}

interface ParsedXmlField {
  name: string;
  value: string;
  ref?: string;
  eval?: string;
}

/**
 * Extractor for Odoo Security XML files (`security/*.xml`).
 * Parses `ir.rule` (record rules) and `res.groups` (security groups) using safe structural scanner.
 * Prohibits external entity expansion (XXE safe).
 *
 * Semantic distinction:
 * - `ir.model.access` defines baseline model grants (read/write/create/unlink).
 * - `ir.rule` defines operational restrictions (domain filters that filter which rows apply).
 */
export class OdooSecurityXmlExtractor {
  private readonly filePath: string;
  private readonly source: string;
  private readonly cleanSource: string;
  private readonly nodes: Node[] = [];
  private readonly edges: Edge[] = [];
  private readonly unresolvedReferences: UnresolvedReference[] = [];
  private readonly errors: ExtractionError[] = [];
  private readonly seenRecordIds = new Set<string>();

  constructor(filePath: string, source: string) {
    this.filePath = filePath.replace(/\\/g, '/');
    this.source = source;
    this.cleanSource = stripXmlComments(source);
  }

  extract(): ExtractionResult {
    const startTime = Date.now();

    // XXE and DTD Guard: Reject external entities, parameter entities, and unsafe DOCTYPE constructs
    if (
      /<!DOCTYPE\b[^>]*\b(?:SYSTEM|ENTITY)\b/i.test(this.cleanSource) ||
      /<!ENTITY\b/i.test(this.cleanSource) ||
      /<!DOCTYPE\b[^>]*\[/i.test(this.cleanSource)
    ) {
      this.errors.push({
        message: 'Security policy violation: XML with DTD external entity declarations or internal subsets (XXE) is refused',
        line: 1,
        column: 1,
        severity: 'error',
        code: 'unsafe_xml_construct',
      });
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
      language: 'xml',
      startLine: 1,
      endLine: lineCount,
      startColumn: 1,
      endColumn: 1,
      signature: `file ${this.filePath}`,
      updatedAt: Date.now(),
    };
    this.nodes.push(fileNode);

    try {
      this.parseStructuralXml();
    } catch (err) {
      this.errors.push({
        message: `Odoo XML extraction error: ${err instanceof Error ? err.message : String(err)}`,
        line: 1,
        column: 1,
        severity: 'error',
        code: 'parse_error',
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

  private parseStructuralXml(): void {
    const scanner = new SafeXmlScanner(this.cleanSource);
    let token: XmlElementToken | null;

    while ((token = scanner.nextElement()) !== null) {
      if (token.name === 'record' && !token.isClosing) {
        const recordId = token.attributes['id'];
        const recordModel = token.attributes['model'];
        const startLine = token.line;

        if (!recordId || !recordModel) {
          continue;
        }

        if (this.seenRecordIds.has(recordId)) {
          this.errors.push({
            message: `Duplicate record definition for id '${recordId}' in '${this.filePath}' at line ${startLine}`,
            line: startLine,
            column: token.col,
            severity: 'warning',
            code: 'duplicate_record_id',
          });
        } else {
          this.seenRecordIds.add(recordId);
        }

        const fields = new Map<string, ParsedXmlField>();

        if (!token.isSelfClosing) {
          // Collect child fields until </record>
          let inner: XmlElementToken | null;
          while ((inner = scanner.nextElement()) !== null) {
            if (inner.name === 'record' && inner.isClosing) {
              break;
            }
            if (inner.name === 'field' && !inner.isClosing) {
              const fieldName = inner.attributes['name'];
              if (fieldName) {
                let textVal = '';
                if (!inner.isSelfClosing) {
                  textVal = scanner.readTextUntilClosing('field');
                }
                fields.set(fieldName, {
                  name: fieldName,
                  value: textVal,
                  ref: inner.attributes['ref'],
                  eval: inner.attributes['eval'],
                });
              }
            }
          }
        }

        const endLine = scanner.getLine();

        if (recordModel === 'ir.rule') {
          this.extractIrRule(recordId, fields, startLine, endLine);
        } else if (recordModel === 'res.groups') {
          this.extractResGroups(recordId, fields, startLine, endLine);
        } else if (recordModel === 'ir.model.access') {
          this.extractXmlAcl(recordId, fields, startLine, endLine);
        }
      }
    }
  }

  private extractIrRule(
    ruleId: string,
    fields: Map<string, ParsedXmlField>,
    startLine: number,
    endLine: number,
  ): void {
    const ruleName = fields.get('name')?.value || ruleId;
    const modelField = fields.get('model_id');
    const modelRef = modelField?.ref || modelField?.value || '';
    const domainForce = fields.get('domain_force')?.value || '';

    // Groups resolution
    const groupField = fields.get('groups');
    const groups: string[] = [];
    if (groupField) {
      if (groupField.ref) {
        groups.push(groupField.ref);
      }
      if (groupField.eval) {
        const refMatches = groupField.eval.matchAll(/\bref\s*\(\s*["']([^"']+)["']\s*\)/g);
        for (const rm of refMatches) {
          if (rm[1]) groups.push(rm[1]);
        }
        // Check for unsupported dynamic expressions
        if (
          !/^\s*\[\s*(?:\(\s*[46]\s*,\s*(?:0\s*,\s*)?(?:ref\s*\([^)]+\)|\[\s*(?:ref\s*\([^)]+\)\s*,?\s*)*\])\s*\)\s*,?\s*)*\]\s*$/.test(
            groupField.eval,
          ) &&
          !/^\s*\[\s*\]\s*$/.test(groupField.eval)
        ) {
          this.errors.push({
            message: `Complex or dynamic Python expression in ir.rule groups eval: '${groupField.eval}'`,
            line: startLine,
            column: 1,
            severity: 'warning',
            code: 'unsupported_dynamic_eval',
          });
        }
      }
    }

    // Permission flags on ir.rule:
    // In Odoo, these flags denote whether the rule RESTRICTION APPLIES (1) or NOT (0) to the operation.
    // They are NOT model-level access grants (which are handled exclusively by ir.model.access).
    const permRead = this.parseEvalBool(fields.get('perm_read')?.eval ?? fields.get('perm_read')?.value, 1);
    const permWrite = this.parseEvalBool(fields.get('perm_write')?.eval ?? fields.get('perm_write')?.value, 1);
    const permCreate = this.parseEvalBool(fields.get('perm_create')?.eval ?? fields.get('perm_create')?.value, 1);
    const permUnlink = this.parseEvalBool(fields.get('perm_unlink')?.eval ?? fields.get('perm_unlink')?.value, 1);

    // Global rule detection: in Odoo, if field 'global' is True OR if no groups are bound, the rule is Global.
    const explicitGlobal = fields.get('global');
    let isGlobal = groups.length === 0;
    if (explicitGlobal) {
      const parsedGlobal = this.parseEvalBool(explicitGlobal.eval ?? explicitGlobal.value, isGlobal ? 1 : 0);
      isGlobal = parsedGlobal === 1;
    }

    const modelOdooName = odooModelNameFromId(modelRef);
    const nodeId = generateNodeId(this.filePath, 'constant', ruleId, startLine);

    const restrictedOps: string[] = [];
    if (permRead === 1) restrictedOps.push('read');
    if (permWrite === 1) restrictedOps.push('write');
    if (permCreate === 1) restrictedOps.push('create');
    if (permUnlink === 1) restrictedOps.push('unlink');

    const node: Node = {
      id: nodeId,
      kind: 'constant',
      name: ruleId,
      qualifiedName: `${this.filePath}::${ruleId}`,
      filePath: this.filePath,
      language: 'xml',
      startLine,
      endLine,
      startColumn: 1,
      endColumn: 1,
      signature: `RecordRule: model=${modelOdooName} (${modelRef}), scope=${isGlobal ? 'GLOBAL' : 'Group-Bound (' + groups.join(', ') + ')'}, domain=${domainForce}, restrictions=[${restrictedOps.join(', ') || 'none'}] (r:${permRead} w:${permWrite} c:${permCreate} u:${permUnlink})`,
      docstring: [
        `Odoo Record Rule (ir.rule): ${ruleName}`,
        `Rule ID: ${ruleId}`,
        `Model: ${modelOdooName} (${modelRef})`,
        `Scope: ${isGlobal ? 'GLOBAL (All Users — Intersected with AND across global rules)' : 'Group-Bound (' + groups.join(', ') + ') — Unioned with OR per group, then ANDed with global rules'}`,
        groups.length > 0 ? `Groups: ${groups.join(', ')}` : 'Groups: ALL',
        `Domain Filter: ${domainForce || '[UNRESTRICTED]'}`,
        `Operation Restrictions (Rule Applicability):`,
        `- Read: ${permRead === 1 ? 'RESTRICTED by domain filter' : 'UNRESTRICTED by this rule'}`,
        `- Write: ${permWrite === 1 ? 'RESTRICTED by domain filter' : 'UNRESTRICTED by this rule'}`,
        `- Create: ${permCreate === 1 ? 'RESTRICTED by domain filter' : 'UNRESTRICTED by this rule'}`,
        `- Unlink: ${permUnlink === 1 ? 'RESTRICTED by domain filter' : 'UNRESTRICTED by this rule'}`,
        `Note: In Odoo, record rules restrict operations to matching records; they do not grant baseline model access (which is governed by ir.model.access).`,
      ].join('\n'),
      updatedAt: Date.now(),
    };
    this.nodes.push(node);

    // References to model
    if (modelRef) {
      this.unresolvedReferences.push({
        fromNodeId: nodeId,
        referenceName: modelRef,
        referenceKind: 'references',
        line: startLine,
        column: 1,
        filePath: this.filePath,
        language: 'xml',
      });
      if (modelOdooName !== modelRef) {
        this.unresolvedReferences.push({
          fromNodeId: nodeId,
          referenceName: modelOdooName,
          referenceKind: 'references',
          line: startLine,
          column: 1,
          filePath: this.filePath,
          language: 'xml',
        });
      }
    }

    // References to groups
    for (const group of groups) {
      this.unresolvedReferences.push({
        fromNodeId: nodeId,
        referenceName: group,
        referenceKind: 'references',
        line: startLine,
        column: 1,
        filePath: this.filePath,
        language: 'xml',
      });
    }
  }

  private extractResGroups(
    groupId: string,
    fields: Map<string, ParsedXmlField>,
    startLine: number,
    endLine: number,
  ): void {
    const groupName = fields.get('name')?.value || groupId;
    const categoryRef = fields.get('category_id')?.ref || fields.get('category_id')?.value || '';

    // Implied groups resolution
    const impliedField = fields.get('implied_ids');
    const impliedGroups: string[] = [];
    if (impliedField) {
      if (impliedField.ref) impliedGroups.push(impliedField.ref);
      if (impliedField.eval) {
        const refMatches = impliedField.eval.matchAll(/\bref\s*\(\s*["']([^"']+)["']\s*\)/g);
        for (const rm of refMatches) {
          if (rm[1]) impliedGroups.push(rm[1]);
        }
      }
    }

    const nodeId = generateNodeId(this.filePath, 'constant', groupId, startLine);
    const node: Node = {
      id: nodeId,
      kind: 'constant',
      name: groupId,
      qualifiedName: `${this.filePath}::${groupId}`,
      filePath: this.filePath,
      language: 'xml',
      startLine,
      endLine,
      startColumn: 1,
      endColumn: 1,
      signature: `SecurityGroup: ${groupName} (category=${categoryRef || 'none'})`,
      docstring: [
        `Odoo Security Group (res.groups): ${groupName}`,
        `Group ID: ${groupId}`,
        categoryRef ? `Category: ${categoryRef}` : null,
        impliedGroups.length > 0 ? `Implied Groups: ${impliedGroups.join(', ')}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
      updatedAt: Date.now(),
    };
    this.nodes.push(node);

    if (categoryRef) {
      this.unresolvedReferences.push({
        fromNodeId: nodeId,
        referenceName: categoryRef,
        referenceKind: 'references',
        line: startLine,
        column: 1,
        filePath: this.filePath,
        language: 'xml',
      });
    }

    for (const imp of impliedGroups) {
      this.unresolvedReferences.push({
        fromNodeId: nodeId,
        referenceName: imp,
        referenceKind: 'references',
        line: startLine,
        column: 1,
        filePath: this.filePath,
        language: 'xml',
      });
    }
  }

  private extractXmlAcl(
    ruleId: string,
    fields: Map<string, ParsedXmlField>,
    startLine: number,
    endLine: number,
  ): void {
    const ruleName = fields.get('name')?.value || ruleId;
    const modelRef = fields.get('model_id')?.ref || fields.get('model_id')?.value || '';
    const groupRef = fields.get('group_id')?.ref || fields.get('group_id')?.value || '';

    const permRead = this.parseEvalBool(fields.get('perm_read')?.eval ?? fields.get('perm_read')?.value, 0);
    const permWrite = this.parseEvalBool(fields.get('perm_write')?.eval ?? fields.get('perm_write')?.value, 0);
    const permCreate = this.parseEvalBool(fields.get('perm_create')?.eval ?? fields.get('perm_create')?.value, 0);
    const permUnlink = this.parseEvalBool(fields.get('perm_unlink')?.eval ?? fields.get('perm_unlink')?.value, 0);

    const modelOdooName = odooModelNameFromId(modelRef);
    const nodeId = generateNodeId(this.filePath, 'constant', ruleId, startLine);

    const node: Node = {
      id: nodeId,
      kind: 'constant',
      name: ruleId,
      qualifiedName: `${this.filePath}::${ruleId}`,
      filePath: this.filePath,
      language: 'xml',
      startLine,
      endLine,
      startColumn: 1,
      endColumn: 1,
      signature: `ACL (XML): model=${modelOdooName} (${modelRef}), group=${groupRef || 'GLOBAL'}, grants=[read:${permRead}, write:${permWrite}, create:${permCreate}, unlink:${permUnlink}]`,
      docstring: [
        `Odoo Access Control List Rule (XML ir.model.access): ${ruleName}`,
        `Rule ID: ${ruleId}`,
        `Model: ${modelOdooName} (${modelRef})`,
        `Group: ${groupRef || 'GLOBAL (All Users)'}`,
        `Model-Level Grants:`,
        `- Read: ${permRead === 1 ? 'GRANTED' : 'DENIED (Not granted)'}`,
        `- Write: ${permWrite === 1 ? 'GRANTED' : 'DENIED (Not granted)'}`,
        `- Create: ${permCreate === 1 ? 'GRANTED' : 'DENIED (Not granted)'}`,
        `- Unlink: ${permUnlink === 1 ? 'GRANTED' : 'DENIED (Not granted)'}`,
      ].join('\n'),
      updatedAt: Date.now(),
    };
    this.nodes.push(node);

    if (modelRef) {
      this.unresolvedReferences.push({
        fromNodeId: nodeId,
        referenceName: modelRef,
        referenceKind: 'references',
        line: startLine,
        column: 1,
        filePath: this.filePath,
        language: 'xml',
      });
      if (modelOdooName !== modelRef) {
        this.unresolvedReferences.push({
          fromNodeId: nodeId,
          referenceName: modelOdooName,
          referenceKind: 'references',
          line: startLine,
          column: 1,
          filePath: this.filePath,
          language: 'xml',
        });
      }
    }

    if (groupRef) {
      this.unresolvedReferences.push({
        fromNodeId: nodeId,
        referenceName: groupRef,
        referenceKind: 'references',
        line: startLine,
        column: 1,
        filePath: this.filePath,
        language: 'xml',
      });
    }
  }

  private parseEvalBool(evalStr: string | undefined, defaultVal: number): number {
    if (evalStr === undefined) return defaultVal;
    const clean = evalStr.trim().toLowerCase();
    if (clean === '1' || clean === 'true') return 1;
    if (clean === '0' || clean === 'false') return 0;
    return defaultVal;
  }
}
