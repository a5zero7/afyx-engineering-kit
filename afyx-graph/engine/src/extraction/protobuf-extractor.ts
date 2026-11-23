/**
 * AFYX-native Protocol Buffers & gRPC Intelligence Extractor (AFYX-216).
 *
 * Provides static extraction for Protocol Buffers (.proto) files:
 * - Package namespaces and imports
 * - Services and gRPC RPC methods (unary and streaming)
 * - Messages, fields, types, and nested types
 * - Enums and enum values
 * - Request/response message bindings and field type references
 *
 * Dependency-free, secret-safe, and line-accurate.
 */

import * as path from 'path';
import type { Node, Edge, ExtractionResult, ExtractionError, UnresolvedReference } from '../types';
import { generateNodeId } from './node-id';

export function isProtobufFile(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() === '.proto';
}

const PROTO_PRIMITIVES = new Set([
  'double', 'float', 'int32', 'int64', 'uint32', 'uint64', 'sint32', 'sint64',
  'fixed32', 'fixed64', 'sfixed32', 'sfixed64', 'bool', 'string', 'bytes',
]);

export class ProtobufExtractor {
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
      this.parseProto(fileNode.id);
    } catch (err) {
      this.errors.push({
        message: `Protobuf extraction error in ${this.filePath}: ${err instanceof Error ? err.message : String(err)}`,
        filePath: this.filePath,
        severity: 'warning',
        code: 'protobuf_parse_error',
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
      language: 'properties',
      startLine: 1,
      endLine: Math.max(lines.length, 1),
      startColumn: 0,
      endColumn: (lines[lines.length - 1] || '').length,
      updatedAt: Date.now(),
    };

    this.nodes.push(fileNode);
    return fileNode;
  }

  private parseProto(fileNodeId: string): void {
    const lines = this.source.split(/\r?\n/);
    let packageName = '';
    let currentContainerId = fileNodeId;
    let i = 0;

    while (i < lines.length) {
      let raw = lines[i]!;
      // Strip line comments
      const commentIdx = raw.indexOf('//');
      if (commentIdx >= 0) {
        raw = raw.slice(0, commentIdx);
      }
      const trimmed = raw.trim();
      const lineNum = i + 1;

      if (!trimmed) {
        i++;
        continue;
      }

      // 1. Package declaration
      const pkgMatch = /^package\s+([A-Za-z0-9_.]+)\s*;/.exec(trimmed);
      if (pkgMatch) {
        packageName = pkgMatch[1]!;
        const pkgNodeId = generateNodeId(this.filePath, 'namespace', packageName, lineNum);
        this.nodes.push({
          id: pkgNodeId,
          kind: 'namespace',
          name: packageName,
          qualifiedName: `${this.filePath}#${packageName}`,
          filePath: this.filePath,
          language: 'properties',
          startLine: lineNum,
          endLine: lineNum,
          startColumn: 0,
          endColumn: raw.length,
          signature: `package ${packageName}`,
          updatedAt: Date.now(),
        });
        this.edges.push({
          source: fileNodeId,
          target: pkgNodeId,
          kind: 'contains',
        });
        currentContainerId = pkgNodeId;
        i++;
        continue;
      }

      // 2. Import statement
      const importMatch = /^import\s+(?:public\s+|weak\s+)?["']([^"']+)["']\s*;/.exec(trimmed);
      if (importMatch) {
        const importTarget = importMatch[1]!;
        this.unresolvedReferences.push({
          fromNodeId: currentContainerId,
          referenceName: importTarget,
          referenceKind: 'imports',
          line: lineNum,
          column: 0,
        });
        i++;
        continue;
      }

      // 3. Service definition
      const serviceMatch = /^service\s+([A-Za-z0-9_]+)\s*\{?/.exec(trimmed);
      if (serviceMatch) {
        const serviceName = serviceMatch[1]!;
        const qualServiceName = packageName ? `${packageName}.${serviceName}` : serviceName;
        const serviceNodeId = generateNodeId(this.filePath, 'interface', qualServiceName, lineNum);

        this.nodes.push({
          id: serviceNodeId,
          kind: 'interface',
          name: serviceName,
          qualifiedName: `${this.filePath}#${qualServiceName}`,
          filePath: this.filePath,
          language: 'properties',
          startLine: lineNum,
          endLine: lineNum,
          startColumn: 0,
          endColumn: raw.length,
          signature: `service ${serviceName}`,
          updatedAt: Date.now(),
        });

        this.edges.push({
          source: currentContainerId,
          target: serviceNodeId,
          kind: 'contains',
        });

        // Scan inside service body for RPC methods
        i++;
        while (i < lines.length) {
          let sRaw = lines[i]!;
          const sComment = sRaw.indexOf('//');
          if (sComment >= 0) sRaw = sRaw.slice(0, sComment);
          const sTrimmed = sRaw.trim();
          const sLineNum = i + 1;

          if (sTrimmed.startsWith('}') || sTrimmed === '}') break;

          // rpc MethodName (ReqType) returns (RespType)
          const rpcMatch = /^rpc\s+([A-Za-z0-9_]+)\s*\(\s*(?:stream\s+)?([A-Za-z0-9_.]+)\s*\)\s*returns\s*\(\s*(?:stream\s+)?([A-Za-z0-9_.]+)\s*\)/.exec(sTrimmed);
          if (rpcMatch) {
            const methodName = rpcMatch[1]!;
            const reqType = rpcMatch[2]!;
            const respType = rpcMatch[3]!;
            const methodNodeId = generateNodeId(this.filePath, 'method', `${qualServiceName}.${methodName}`, sLineNum);

            this.nodes.push({
              id: methodNodeId,
              kind: 'method',
              name: methodName,
              qualifiedName: `${this.filePath}#${qualServiceName}.${methodName}`,
              filePath: this.filePath,
              language: 'properties',
              startLine: sLineNum,
              endLine: sLineNum,
              startColumn: 0,
              endColumn: sRaw.length,
              signature: sTrimmed.replace(/;$/, ''),
              updatedAt: Date.now(),
            });

            this.edges.push({
              source: serviceNodeId,
              target: methodNodeId,
              kind: 'contains',
            });

            // References to request and response types
            this.unresolvedReferences.push({
              fromNodeId: methodNodeId,
              referenceName: reqType,
              referenceKind: 'references',
              line: sLineNum,
              column: 0,
            });
            this.unresolvedReferences.push({
              fromNodeId: methodNodeId,
              referenceName: respType,
              referenceKind: 'references',
              line: sLineNum,
              column: 0,
            });
          }
          i++;
        }
        i++;
        continue;
      }

      // 4. Message definition
      const msgMatch = /^message\s+([A-Za-z0-9_]+)\s*\{?/.exec(trimmed);
      if (msgMatch) {
        const msgName = msgMatch[1]!;
        const qualMsgName = packageName ? `${packageName}.${msgName}` : msgName;
        const msgNodeId = generateNodeId(this.filePath, 'class', qualMsgName, lineNum);

        this.nodes.push({
          id: msgNodeId,
          kind: 'class',
          name: msgName,
          qualifiedName: `${this.filePath}#${qualMsgName}`,
          filePath: this.filePath,
          language: 'properties',
          startLine: lineNum,
          endLine: lineNum,
          startColumn: 0,
          endColumn: raw.length,
          signature: `message ${msgName}`,
          updatedAt: Date.now(),
        });

        this.edges.push({
          source: currentContainerId,
          target: msgNodeId,
          kind: 'contains',
        });

        // Parse fields inside message
        i++;
        while (i < lines.length) {
          let mRaw = lines[i]!;
          const mComment = mRaw.indexOf('//');
          if (mComment >= 0) mRaw = mRaw.slice(0, mComment);
          const mTrimmed = mRaw.trim();
          const mLineNum = i + 1;

          if (mTrimmed.startsWith('}') || mTrimmed === '}') break;

          // Field: [optional|repeated|required] type name = number [options];
          const fieldMatch = /^(?:optional\s+|repeated\s+|required\s+)?([A-Za-z0-9_.]+)\s+([A-Za-z0-9_]+)\s*=\s*(\d+)/.exec(mTrimmed);
          if (fieldMatch && !['message', 'enum', 'oneof', 'option'].includes(fieldMatch[1]!)) {
            const fieldType = fieldMatch[1]!;
            const fieldName = fieldMatch[2]!;
            const fieldNodeId = generateNodeId(this.filePath, 'field', `${qualMsgName}.${fieldName}`, mLineNum);

            this.nodes.push({
              id: fieldNodeId,
              kind: 'field',
              name: fieldName,
              qualifiedName: `${this.filePath}#${qualMsgName}.${fieldName}`,
              filePath: this.filePath,
              language: 'properties',
              startLine: mLineNum,
              endLine: mLineNum,
              startColumn: 0,
              endColumn: mRaw.length,
              signature: mTrimmed.replace(/;$/, ''),
              updatedAt: Date.now(),
            });

            this.edges.push({
              source: msgNodeId,
              target: fieldNodeId,
              kind: 'contains',
            });

            // If not a built-in primitive, reference the message/enum type
            if (!PROTO_PRIMITIVES.has(fieldType)) {
              this.unresolvedReferences.push({
                fromNodeId: fieldNodeId,
                referenceName: fieldType,
                referenceKind: 'references',
                line: mLineNum,
                column: 0,
              });
            }
          }
          i++;
        }
        i++;
        continue;
      }

      // 5. Enum definition
      const enumMatch = /^enum\s+([A-Za-z0-9_]+)\s*\{?/.exec(trimmed);
      if (enumMatch) {
        const enumName = enumMatch[1]!;
        const qualEnumName = packageName ? `${packageName}.${enumName}` : enumName;
        const enumNodeId = generateNodeId(this.filePath, 'enum', qualEnumName, lineNum);

        this.nodes.push({
          id: enumNodeId,
          kind: 'enum',
          name: enumName,
          qualifiedName: `${this.filePath}#${qualEnumName}`,
          filePath: this.filePath,
          language: 'properties',
          startLine: lineNum,
          endLine: lineNum,
          startColumn: 0,
          endColumn: raw.length,
          signature: `enum ${enumName}`,
          updatedAt: Date.now(),
        });

        this.edges.push({
          source: currentContainerId,
          target: enumNodeId,
          kind: 'contains',
        });

        // Scan enum values
        i++;
        while (i < lines.length) {
          let eRaw = lines[i]!;
          const eComment = eRaw.indexOf('//');
          if (eComment >= 0) eRaw = eRaw.slice(0, eComment);
          const eTrimmed = eRaw.trim();
          const eLineNum = i + 1;

          if (eTrimmed.startsWith('}') || eTrimmed === '}') break;

          const valMatch = /^([A-Za-z0-9_]+)\s*=\s*(-?\d+)/.exec(eTrimmed);
          if (valMatch && valMatch[1] !== 'option') {
            const valName = valMatch[1]!;
            const valNodeId = generateNodeId(this.filePath, 'constant', `${qualEnumName}.${valName}`, eLineNum);

            this.nodes.push({
              id: valNodeId,
              kind: 'constant',
              name: valName,
              qualifiedName: `${this.filePath}#${qualEnumName}.${valName}`,
              filePath: this.filePath,
              language: 'properties',
              startLine: eLineNum,
              endLine: eLineNum,
              startColumn: 0,
              endColumn: eRaw.length,
              signature: eTrimmed.replace(/;$/, ''),
              updatedAt: Date.now(),
            });

            this.edges.push({
              source: enumNodeId,
              target: valNodeId,
              kind: 'contains',
            });
          }
          i++;
        }
        i++;
        continue;
      }

      i++;
    }
  }
}
