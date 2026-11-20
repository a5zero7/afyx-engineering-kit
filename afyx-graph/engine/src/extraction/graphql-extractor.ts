/**
 * AFYX-native GraphQL Intelligence Extractor (AFYX-215).
 *
 * Provides static extraction for GraphQL Schema Definition Language (SDL)
 * and executable documents:
 * - Schema types (type, interface, union, enum, input, scalar)
 * - Fields, field arguments, and return types
 * - Operations (query, mutation, subscription) and fragments
 * - Interface implementations, union member types, and fragment targets
 *
 * Dependency-free, secret-safe, and line-accurate.
 */

import * as path from 'path';
import type { Node, Edge, ExtractionResult, ExtractionError, UnresolvedReference } from '../types';
import { generateNodeId } from './node-id';

export function isGraphQLFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext === '.graphql' || ext === '.gql';
}

const BUILTIN_SCALARS = new Set(['Int', 'Float', 'String', 'Boolean', 'ID']);

export class GraphQLExtractor {
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
      this.parseDocument(fileNode.id);
    } catch (err) {
      this.errors.push({
        message: `GraphQL extraction error in ${this.filePath}: ${err instanceof Error ? err.message : String(err)}`,
        filePath: this.filePath,
        severity: 'warning',
        code: 'graphql_parse_error',
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
      language: 'json',
      startLine: 1,
      endLine: Math.max(lines.length, 1),
      startColumn: 0,
      endColumn: (lines[lines.length - 1] || '').length,
      updatedAt: Date.now(),
    };

    this.nodes.push(fileNode);
    return fileNode;
  }

  private cleanTypeReference(rawType: string): string {
    return rawType.replace(/[[\]!]/g, '').trim();
  }

  private parseDocument(fileNodeId: string): void {
    const lines = this.source.split(/\r?\n/);
    let i = 0;

    while (i < lines.length) {
      const raw = lines[i]!;
      const trimmed = raw.trim();
      const lineNum = i + 1;

      if (!trimmed || trimmed.startsWith('#')) {
        i++;
        continue;
      }

      // 1. Type / Interface / Input
      const typeMatch = /^(type|interface|input)\s+([A-Za-z_]\w*)(?:\s+implements\s+([A-Za-z0-9_&\s]+))?/.exec(trimmed);
      if (typeMatch) {
        const keyword = typeMatch[1]!;
        const typeName = typeMatch[2]!;
        const implementsRaw = typeMatch[3];
        const kind = keyword === 'interface' ? 'interface' : 'class';
        const typeNodeId = generateNodeId(this.filePath, kind, typeName, lineNum);

        this.nodes.push({
          id: typeNodeId,
          kind,
          name: typeName,
          qualifiedName: `${this.filePath}#${typeName}`,
          filePath: this.filePath,
          language: 'json',
          startLine: lineNum,
          endLine: lineNum,
          startColumn: 0,
          endColumn: raw.length,
          signature: trimmed.split('{')[0]!.trim(),
          updatedAt: Date.now(),
        });

        this.edges.push({
          source: fileNodeId,
          target: typeNodeId,
          kind: 'contains',
        });

        if (implementsRaw) {
          const ifaces = implementsRaw.split(/&|\s+/).filter(Boolean);
          for (const iface of ifaces) {
            this.unresolvedReferences.push({
              fromNodeId: typeNodeId,
              referenceName: iface,
              referenceKind: 'references',
              line: lineNum,
              column: 0,
            });
          }
        }

        // Parse fields inside block if opened
        if (trimmed.includes('{')) {
          i++;
          while (i < lines.length) {
            const bodyLine = lines[i]!.trim();
            const bodyLineNum = i + 1;
            if (bodyLine.startsWith('}') || bodyLine === '}') {
              break;
            }
            if (bodyLine && !bodyLine.startsWith('#')) {
              // field definition: name(args): Type
              const fieldMatch = /^([A-Za-z_]\w*)(?:\([^)]*\))?\s*:\s*([A-Za-z0-9_![\]]+)/.exec(bodyLine);
              if (fieldMatch) {
                const fieldName = fieldMatch[1]!;
                const returnTypeRaw = fieldMatch[2]!;
                const fieldNodeId = generateNodeId(this.filePath, 'property', `${typeName}.${fieldName}`, bodyLineNum);

                this.nodes.push({
                  id: fieldNodeId,
                  kind: 'property',
                  name: fieldName,
                  qualifiedName: `${this.filePath}#${typeName}.${fieldName}`,
                  filePath: this.filePath,
                  language: 'json',
                  startLine: bodyLineNum,
                  endLine: bodyLineNum,
                  startColumn: 0,
                  endColumn: lines[i]!.length,
                  signature: `${fieldName}: ${returnTypeRaw}`,
                  updatedAt: Date.now(),
                });

                this.edges.push({
                  source: typeNodeId,
                  target: fieldNodeId,
                  kind: 'contains',
                });

                const cleanType = this.cleanTypeReference(returnTypeRaw);
                if (cleanType && !BUILTIN_SCALARS.has(cleanType)) {
                  this.unresolvedReferences.push({
                    fromNodeId: fieldNodeId,
                    referenceName: cleanType,
                    referenceKind: 'references',
                    line: bodyLineNum,
                    column: 0,
                  });
                }
              }
            }
            i++;
          }
        }
        i++;
        continue;
      }

      // 2. Union
      const unionMatch = /^union\s+([A-Za-z_]\w*)\s*=\s*([A-Za-z0-9_| \t]+)/.exec(trimmed);
      if (unionMatch) {
        const unionName = unionMatch[1]!;
        const membersRaw = unionMatch[2]!;
        const unionNodeId = generateNodeId(this.filePath, 'type_alias', unionName, lineNum);

        this.nodes.push({
          id: unionNodeId,
          kind: 'type_alias',
          name: unionName,
          qualifiedName: `${this.filePath}#${unionName}`,
          filePath: this.filePath,
          language: 'json',
          startLine: lineNum,
          endLine: lineNum,
          startColumn: 0,
          endColumn: raw.length,
          signature: trimmed,
          updatedAt: Date.now(),
        });

        this.edges.push({
          source: fileNodeId,
          target: unionNodeId,
          kind: 'contains',
        });

        const members = membersRaw.split('|').map((s) => s.trim()).filter(Boolean);
        for (const member of members) {
          this.unresolvedReferences.push({
            fromNodeId: unionNodeId,
            referenceName: member,
            referenceKind: 'references',
            line: lineNum,
            column: 0,
          });
        }
        i++;
        continue;
      }

      // 3. Enum
      const enumMatch = /^enum\s+([A-Za-z_]\w*)/.exec(trimmed);
      if (enumMatch) {
        const enumName = enumMatch[1]!;
        const enumNodeId = generateNodeId(this.filePath, 'enum', enumName, lineNum);

        this.nodes.push({
          id: enumNodeId,
          kind: 'enum',
          name: enumName,
          qualifiedName: `${this.filePath}#${enumName}`,
          filePath: this.filePath,
          language: 'json',
          startLine: lineNum,
          endLine: lineNum,
          startColumn: 0,
          endColumn: raw.length,
          signature: `enum ${enumName}`,
          updatedAt: Date.now(),
        });

        this.edges.push({
          source: fileNodeId,
          target: enumNodeId,
          kind: 'contains',
        });

        if (trimmed.includes('{')) {
          i++;
          while (i < lines.length) {
            const bodyLine = lines[i]!.trim();
            const bodyLineNum = i + 1;
            if (bodyLine.startsWith('}') || bodyLine === '}') break;
            if (bodyLine && !bodyLine.startsWith('#')) {
              const valMatch = /^([A-Za-z0-9_]+)/.exec(bodyLine);
              if (valMatch) {
                const valName = valMatch[1]!;
                const valNodeId = generateNodeId(this.filePath, 'constant', `${enumName}.${valName}`, bodyLineNum);
                this.nodes.push({
                  id: valNodeId,
                  kind: 'constant',
                  name: valName,
                  qualifiedName: `${this.filePath}#${enumName}.${valName}`,
                  filePath: this.filePath,
                  language: 'json',
                  startLine: bodyLineNum,
                  endLine: bodyLineNum,
                  startColumn: 0,
                  endColumn: lines[i]!.length,
                  signature: valName,
                  updatedAt: Date.now(),
                });
                this.edges.push({
                  source: enumNodeId,
                  target: valNodeId,
                  kind: 'contains',
                });
              }
            }
            i++;
          }
        }
        i++;
        continue;
      }

      // 4. Scalar
      const scalarMatch = /^scalar\s+([A-Za-z_]\w*)/.exec(trimmed);
      if (scalarMatch) {
        const scalarName = scalarMatch[1]!;
        const scalarNodeId = generateNodeId(this.filePath, 'type_alias', scalarName, lineNum);

        this.nodes.push({
          id: scalarNodeId,
          kind: 'type_alias',
          name: scalarName,
          qualifiedName: `${this.filePath}#${scalarName}`,
          filePath: this.filePath,
          language: 'json',
          startLine: lineNum,
          endLine: lineNum,
          startColumn: 0,
          endColumn: raw.length,
          signature: `scalar ${scalarName}`,
          updatedAt: Date.now(),
        });

        this.edges.push({
          source: fileNodeId,
          target: scalarNodeId,
          kind: 'contains',
        });
        i++;
        continue;
      }

      // 5. Operations: query, mutation, subscription
      const opMatch = /^(query|mutation|subscription)\s+([A-Za-z_]\w*)/.exec(trimmed);
      if (opMatch) {
        const opType = opMatch[1]!;
        const opName = opMatch[2]!;
        const opNodeId = generateNodeId(this.filePath, 'function', opName, lineNum);

        this.nodes.push({
          id: opNodeId,
          kind: 'function',
          name: opName,
          qualifiedName: `${this.filePath}#${opName}`,
          filePath: this.filePath,
          language: 'json',
          startLine: lineNum,
          endLine: lineNum,
          startColumn: 0,
          endColumn: raw.length,
          signature: `${opType} ${opName}`,
          updatedAt: Date.now(),
        });

        this.edges.push({
          source: fileNodeId,
          target: opNodeId,
          kind: 'contains',
        });
        i++;
        continue;
      }

      // 6. Fragment
      const fragMatch = /^fragment\s+([A-Za-z_]\w*)\s+on\s+([A-Za-z_]\w*)/.exec(trimmed);
      if (fragMatch) {
        const fragName = fragMatch[1]!;
        const targetType = fragMatch[2]!;
        const fragNodeId = generateNodeId(this.filePath, 'function', fragName, lineNum);

        this.nodes.push({
          id: fragNodeId,
          kind: 'function',
          name: fragName,
          qualifiedName: `${this.filePath}#${fragName}`,
          filePath: this.filePath,
          language: 'json',
          startLine: lineNum,
          endLine: lineNum,
          startColumn: 0,
          endColumn: raw.length,
          signature: `fragment ${fragName} on ${targetType}`,
          updatedAt: Date.now(),
        });

        this.edges.push({
          source: fileNodeId,
          target: fragNodeId,
          kind: 'contains',
        });

        this.unresolvedReferences.push({
          fromNodeId: fragNodeId,
          referenceName: targetType,
          referenceKind: 'references',
          line: lineNum,
          column: 0,
        });
        i++;
        continue;
      }

      i++;
    }
  }
}
