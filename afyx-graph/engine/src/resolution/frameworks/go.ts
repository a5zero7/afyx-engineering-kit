/**
 * AFYX Engineering Kit - Go Web Framework Resolver
 *
 * Implements route declaration extraction and symbol resolution for Go HTTP ecosystems:
 * 1. Supports Gin, Echo, Fiber, Chi, and standard library `net/http` multiplexers (including Go 1.22+ method patterns)
 * 2. Connects route endpoints (`.GET`, `.POST`, `.HandleFunc`, etc.) to handler functions
 * 3. Resolves handler, service, repository, middleware, and domain struct references using directory heuristics
 */

import type { Node } from '../../types';
import type {
  FrameworkExtractionResult,
  FrameworkResolver,
  ResolutionContext,
  ResolvedRef,
  UnresolvedRef,
} from '../types';
import { stripCommentsForRegex } from '../strip-comments';

const PREFERRED_HANDLER_DIRS: readonly string[] = ['handler', 'handlers', 'api', 'routes', 'controller', 'controllers'];
const PREFERRED_SERVICE_DIRS: readonly string[] = ['service', 'services', 'repository', 'store', 'pkg'];
const PREFERRED_MIDDLEWARE_DIRS: readonly string[] = ['middleware', 'middlewares'];
const PREFERRED_MODEL_DIRS: readonly string[] = ['model', 'models', 'entity', 'entities', 'domain', 'pkg'];

const SERVICE_TARGET_KINDS: ReadonlySet<string> = new Set(['struct', 'interface']);

function extractLastIdentifierFromExpr(expression: string): string | null {
  const sanitized = expression.trim().replace(/\s+/g, '').replace(/\(\)$/, '');
  const match = sanitized.match(/(?:\.|^)([A-Za-z_][A-Za-z0-9_]*)$/);
  return match ? match[1]! : null;
}

function parseGo122MethodPrefix(urlPath: string, rawMethodName: string): string | null {
  if (rawMethodName !== 'Handle' && rawMethodName !== 'HandleFunc') return null;
  const match = urlPath.match(/^(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD|CONNECT|TRACE)\s+\S/);
  return match ? match[1]! : null;
}

function locateCandidateByKindAndDirs(
  name: string,
  targetKind: string | null,
  directoryPatterns: readonly string[],
  ctx: ResolutionContext,
  multipleKinds?: ReadonlySet<string>
): string | null {
  const candidates = ctx.getNodesByName(name);
  if (candidates.length === 0) return null;

  const filtered = candidates.filter((node) => {
    if (multipleKinds) return multipleKinds.has(node.kind);
    if (targetKind) return node.kind === targetKind;
    return true;
  });

  if (filtered.length === 0) return null;

  const localized = filtered.filter((node) =>
    directoryPatterns.some((dir) => node.filePath.includes(`/${dir}/`))
  );

  return localized.length > 0 ? localized[0]!.id : filtered[0]!.id;
}

export const goResolver: FrameworkResolver = {
  name: 'go',
  languages: ['go'],

  detect(context: ResolutionContext): boolean {
    if (context.readFile('go.mod')) return true;
    return context.getAllFiles().some((f) => f.endsWith('.go'));
  },

  resolve(ref: UnresolvedRef, context: ResolutionContext): ResolvedRef | null {
    if (ref.referenceName.endsWith('Handler') || ref.referenceName.startsWith('Handle')) {
      const targetId = locateCandidateByKindAndDirs(ref.referenceName, 'function', PREFERRED_HANDLER_DIRS, context);
      if (targetId) {
        return {
          original: ref,
          targetNodeId: targetId,
          confidence: 0.8,
          resolvedBy: 'framework',
        };
      }
    }

    if (
      ref.referenceName.endsWith('Service') ||
      ref.referenceName.endsWith('Repository') ||
      ref.referenceName.endsWith('Store')
    ) {
      const targetId = locateCandidateByKindAndDirs(
        ref.referenceName,
        null,
        PREFERRED_SERVICE_DIRS,
        context,
        SERVICE_TARGET_KINDS
      );
      if (targetId) {
        return {
          original: ref,
          targetNodeId: targetId,
          confidence: 0.8,
          resolvedBy: 'framework',
        };
      }
    }

    if (
      ref.referenceName.endsWith('Middleware') ||
      ref.referenceName.startsWith('Auth') ||
      ref.referenceName.startsWith('Log')
    ) {
      const targetId = locateCandidateByKindAndDirs(ref.referenceName, 'function', PREFERRED_MIDDLEWARE_DIRS, context);
      if (targetId) {
        return {
          original: ref,
          targetNodeId: targetId,
          confidence: 0.75,
          resolvedBy: 'framework',
        };
      }
    }

    if (/^[A-Z][a-zA-Z]+$/.test(ref.referenceName)) {
      const targetId = locateCandidateByKindAndDirs(ref.referenceName, 'struct', PREFERRED_MODEL_DIRS, context);
      if (targetId) {
        return {
          original: ref,
          targetNodeId: targetId,
          confidence: 0.7,
          resolvedBy: 'framework',
        };
      }
    }

    return null;
  },

  extract(filePath: string, content: string): FrameworkExtractionResult {
    if (!filePath.endsWith('.go')) return { nodes: [], references: [] };

    const nodes: Node[] = [];
    const references: UnresolvedRef[] = [];
    const timestamp = Date.now();
    const cleanSource = stripCommentsForRegex(content, 'go');

    const routeCallRegex =
      /\b\w+\.(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD|Get|Post|Put|Patch|Delete|Handle|HandleFunc)\s*\(\s*"([^"]+)"\s*,\s*([^)]+)\)/g;
    let match: RegExpExecArray | null;

    while ((match = routeCallRegex.exec(cleanSource)) !== null) {
      const rawVerb = match[1]!;
      const rawPath = match[2]!;
      const handlerExpr = match[3]!;

      const go122Method = parseGo122MethodPrefix(rawPath, rawVerb);
      if (!rawPath.startsWith('/') && !go122Method) continue;

      const lineNumber = cleanSource.slice(0, match.index).split('\n').length;
      const actualPath = go122Method ? rawPath.slice(go122Method.length).trimStart() : rawPath;
      const actualVerb = go122Method
        ? go122Method
        : rawVerb === 'Handle' || rawVerb === 'HandleFunc'
          ? 'ANY'
          : rawVerb.toUpperCase();

      const routeNode: Node = {
        id: `route:${filePath}:${lineNumber}:${actualVerb}:${actualPath}`,
        kind: 'route',
        name: `${actualVerb} ${actualPath}`,
        qualifiedName: `${filePath}::route:${actualPath}`,
        filePath,
        startLine: lineNumber,
        endLine: lineNumber,
        startColumn: 0,
        endColumn: match[0].length,
        language: 'go',
        updatedAt: timestamp,
      };
      nodes.push(routeNode);

      const resolvedHandlerName = extractLastIdentifierFromExpr(handlerExpr);
      if (resolvedHandlerName) {
        references.push({
          fromNodeId: routeNode.id,
          referenceName: resolvedHandlerName,
          referenceKind: 'references',
          line: lineNumber,
          column: 0,
          filePath,
          language: 'go',
        });
      }
    }

    return { nodes, references };
  },
};
