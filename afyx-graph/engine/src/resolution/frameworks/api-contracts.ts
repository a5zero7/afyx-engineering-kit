/**
 * AFYX-native API Contracts & RPC Resolution (AFYX-215 / AFYX-216).
 *
 * Implements conservative, source-grounded symbol linking for:
 * 1. GraphQL Resolvers: Maps explicit resolver maps (JS/TS, Python) to GraphQL schema fields
 * 2. gRPC Implementations: Maps server handler implementations (JS/TS, Python, Java, Go) to .proto RPC declarations
 *
 * Adheres strictly to the AFYX resolution contract:
 * - Fails closed on ambiguity (returns null / UNRESOLVED when ambiguous or unproven)
 * - Never guesses from function-name similarity alone
 * - Respects cross-file boundaries and declaration scopes
 */

import * as path from 'path';
import type { Node } from '../../types';
import type {
  FrameworkExtractionResult,
  FrameworkResolver,
  ResolutionContext,
  ResolvedRef,
  UnresolvedRef,
} from '../types';

/**
 * GraphQL Framework Resolver
 */
export const graphqlResolver: FrameworkResolver = {
  name: 'graphql',
  languages: ['typescript', 'javascript', 'python'],

  detect(context: ResolutionContext): boolean {
    const allFiles = context.getAllFiles();
    return allFiles.some(
      (f) =>
        f.endsWith('.graphql') ||
        f.endsWith('.gql') ||
        f.includes('schema.graphql') ||
        f.includes('resolvers')
    );
  },

  claimsReference(name: string): boolean {
    return /^(Query|Mutation|Subscription|[A-Za-z_]\w*)\.[A-Za-z_]\w*$/.test(name);
  },

  extract(filePath: string, content: string): FrameworkExtractionResult {
    const nodes: Node[] = [];
    const references: UnresolvedRef[] = [];
    const ext = path.extname(filePath).toLowerCase();

    if (!['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py'].includes(ext)) {
      return { nodes, references };
    }

    const lines = content.split(/\r?\n/);

    if (ext === '.py') {
      // Python GraphQL resolver (e.g., Ariadne / Graphene / Strawberry)
      // Pattern: @query.field("fieldName") or @mutation.field("fieldName") def resolve_x(...):
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!.trim();
        const lineNum = i + 1;
        const decoratorMatch = /@(query|mutation|subscription)\.field\(["']([A-Za-z_]\w*)["']\)/i.exec(line);
        if (decoratorMatch) {
          const typeName = decoratorMatch[1]!.charAt(0).toUpperCase() + decoratorMatch[1]!.slice(1).toLowerCase();
          const fieldName = decoratorMatch[2]!;
          references.push({
            fromNodeId: `${filePath}#line:${lineNum}`,
            referenceName: `${typeName}.${fieldName}`,
            referenceKind: 'implements',
            line: lineNum,
            column: 0,
            filePath,
            language: 'python',
          });
        }
      }
    } else {
      // TypeScript / JavaScript GraphQL resolver map
      // e.g.:
      // const resolvers = {
      //   Query: {
      //     getBooks: getBooksResolver,
      //     author: (root, args) => ...
      //   },
      //   Mutation: {
      //     createBook: createBookImpl
      //   }
      // }
      let currentType: string | null = null;
      let depth = 0;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!.trim();
        const lineNum = i + 1;

        // Skip comments
        if (line.startsWith('//') || line.startsWith('/*') || line.startsWith('*')) continue;

        // Check for Root Type Block: Query:, Mutation:, Subscription:, or custom type in resolvers
        const typeBlockMatch = /^(Query|Mutation|Subscription|[A-Z][A-Za-z0-9_]*)\s*:\s*\{/.exec(line);
        if (typeBlockMatch) {
          currentType = typeBlockMatch[1]!;
          depth = 1;
          continue;
        }

        if (currentType && depth > 0) {
          if (line.includes('{')) depth++;
          if (line.includes('}')) {
            depth--;
            if (depth <= 0) {
              currentType = null;
              continue;
            }
          }

          // Field mapping: fieldName: handlerFn or fieldName(root, args)
          const fieldMatch = /^([A-Za-z_]\w*)\s*:\s*([A-Za-z0-9_]+)/.exec(line);
          if (fieldMatch && !['Query', 'Mutation', 'Subscription'].includes(fieldMatch[1]!)) {
            const fieldName = fieldMatch[1]!;
            const handlerName = fieldMatch[2]!;

            references.push({
              fromNodeId: `${filePath}#${currentType}.${fieldName}:${lineNum}`,
              referenceName: `${currentType}.${fieldName}`,
              referenceKind: 'implements',
              line: lineNum,
              column: 0,
              filePath,
              language: ext.startsWith('.ts') ? 'typescript' : 'javascript',
            });

            if (handlerName && handlerName !== 'function' && handlerName !== 'async') {
              references.push({
                fromNodeId: `${filePath}#${currentType}.${fieldName}:${lineNum}`,
                referenceName: handlerName,
                referenceKind: 'calls',
                line: lineNum,
                column: 0,
                filePath,
                language: ext.startsWith('.ts') ? 'typescript' : 'javascript',
              });
            }
          }
        }
      }
    }

    return { nodes, references };
  },

  resolve(ref: UnresolvedRef, context: ResolutionContext): ResolvedRef | null {
    if (!ref.referenceName.includes('.')) return null;

    const [typeName, fieldName] = ref.referenceName.split('.');
    if (!typeName || !fieldName) return null;

    // Look for GraphQL schema field nodes (property kind in .graphql / .gql)
    const fieldNodes = context.getNodesByName(fieldName).filter((n) => {
      const isGql = n.filePath.endsWith('.graphql') || n.filePath.endsWith('.gql');
      return isGql && n.qualifiedName.endsWith(`#${typeName}.${fieldName}`);
    });

    if (fieldNodes.length === 1) {
      return {
        original: ref,
        targetNodeId: fieldNodes[0]!.id,
        confidence: 0.95,
        resolvedBy: 'framework',
        edgeKind: 'implements',
      };
    }

    // If 0 or >1 matches, fail closed / report ambiguous (return null)
    return null;
  },
};

/**
 * gRPC Framework Resolver
 */
export const grpcResolver: FrameworkResolver = {
  name: 'grpc',
  languages: ['typescript', 'javascript', 'python', 'java', 'go'],

  detect(context: ResolutionContext): boolean {
    const allFiles = context.getAllFiles();
    return allFiles.some(
      (f) =>
        f.endsWith('.proto') ||
        f.includes('_pb.js') ||
        f.includes('_grpc_pb.js') ||
        f.includes('_pb2.py') ||
        f.includes('_pb2_grpc.py')
    );
  },

  claimsReference(name: string): boolean {
    return /^[A-Za-z0-9_]+\.[A-Za-z0-9_]+$/.test(name);
  },

  extract(filePath: string, content: string): FrameworkExtractionResult {
    const nodes: Node[] = [];
    const references: UnresolvedRef[] = [];
    const ext = path.extname(filePath).toLowerCase();
    const lines = content.split(/\r?\n/);

    if (ext === '.py') {
      // Python gRPC: class GreeterServicer(helloworld_pb2_grpc.GreeterServicer):
      let currentService: string | null = null;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!.trim();
        const lineNum = i + 1;

        const classMatch = /^class\s+([A-Za-z0-9_]+)\s*\(\s*(?:[A-Za-z0-9_.]+\.)?([A-Za-z0-9_]+)Servicer\s*\):/.exec(line);
        if (classMatch) {
          currentService = classMatch[2]!;
          continue;
        }

        if (currentService && /^def\s+([A-Za-z0-9_]+)\s*\(self,/.test(line)) {
          const methodMatch = /^def\s+([A-Za-z0-9_]+)\s*\(self,/.exec(line);
          if (methodMatch) {
            const methodName = methodMatch[1]!;
            references.push({
              fromNodeId: `${filePath}#${currentService}.${methodName}:${lineNum}`,
              referenceName: `${currentService}.${methodName}`,
              referenceKind: 'implements',
              line: lineNum,
              column: 0,
              filePath,
              language: 'python',
            });
          }
        }
      }
    } else if (ext === '.java') {
      // Java gRPC: class GreeterImpl extends GreeterGrpc.GreeterImplBase
      let currentService: string | null = null;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!.trim();
        const lineNum = i + 1;

        const classMatch = /class\s+([A-Za-z0-9_]+)\s+extends\s+(?:[A-Za-z0-9_.]+\.)?([A-Za-z0-9_]+)Grpc\.([A-Za-z0-9_]+)ImplBase/.exec(line);
        if (classMatch) {
          currentService = classMatch[2]!;
          continue;
        }

        if (currentService && /public\s+void\s+([A-Za-z0-9_]+)\s*\(/.test(line)) {
          const methodMatch = /public\s+void\s+([A-Za-z0-9_]+)\s*\(/.exec(line);
          if (methodMatch) {
            const methodName = methodMatch[1]!;
            references.push({
              fromNodeId: `${filePath}#${currentService}.${methodName}:${lineNum}`,
              referenceName: `${currentService}.${methodName}`,
              referenceKind: 'implements',
              line: lineNum,
              column: 0,
              filePath,
              language: 'java',
            });
          }
        }
      }
    } else if (['.ts', '.js', '.mjs', '.cjs'].includes(ext)) {
      // Node.js gRPC: server.addService(GreeterService, { sayHello: sayHelloHandler })
      const addServiceRegex = /server\.addService\s*\(\s*([^,\s]+?)(?:\.service)?\s*,\s*\{([\s\S]*?)\}\s*\)/g;
      let match: RegExpExecArray | null;

      while ((match = addServiceRegex.exec(content)) !== null) {
        let rawTarget = match[1]!;
        if (rawTarget.endsWith('.service')) {
          rawTarget = rawTarget.slice(0, -8);
        }
        const serviceName = rawTarget.split('.').pop() || rawTarget;
        const body = match[2]!;
        const lineNum = content.slice(0, match.index).split('\n').length;
        const entries = body.split(',').map((s) => s.trim()).filter(Boolean);

        for (const entry of entries) {
          const parts = entry.split(':').map((s) => s.trim());
          const methodName = parts[0];
          const handlerName = parts[1];

          if (methodName && /^[A-Za-z0-9_]+$/.test(methodName)) {
            references.push({
              fromNodeId: `${filePath}#${serviceName}.${methodName}:${lineNum}`,
              referenceName: `${serviceName}.${methodName}`,
              referenceKind: 'implements',
              line: lineNum,
              column: 0,
              filePath,
              language: ext.startsWith('.ts') ? 'typescript' : 'javascript',
            });

            if (handlerName && /^[A-Za-z0-9_]+$/.test(handlerName)) {
              references.push({
                fromNodeId: `${filePath}#${serviceName}.${methodName}:${lineNum}`,
                referenceName: handlerName,
                referenceKind: 'calls',
                line: lineNum,
                column: 0,
                filePath,
                language: ext.startsWith('.ts') ? 'typescript' : 'javascript',
              });
            }
          }
        }
      }
    }

    return { nodes, references };
  },

  resolve(ref: UnresolvedRef, context: ResolutionContext): ResolvedRef | null {
    if (!ref.referenceName.includes('.')) return null;

    const [serviceName, methodName] = ref.referenceName.split('.');
    if (!serviceName || !methodName) return null;

    // Look for method nodes declared in .proto files
    const protoMethods = context.getNodesByName(methodName).filter((n) => {
      const isProto = n.filePath.endsWith('.proto');
      if (!isProto || n.kind !== 'method') return false;

      // qualifiedName: filePath#qualServiceName.methodName
      const qname = n.qualifiedName;
      return qname.endsWith(`.${serviceName}.${methodName}`) || qname.endsWith(`#${serviceName}.${methodName}`);
    });

    // If exactly 1 unambiguous method found across .proto files
    if (protoMethods.length === 1) {
      return {
        original: ref,
        targetNodeId: protoMethods[0]!.id,
        confidence: 0.95,
        resolvedBy: 'framework',
        edgeKind: 'implements',
      };
    }

    // If duplicate or ambiguous (e.g. 2 different services have the same method and match), return null
    return null;
  },
};
