/**
 * AFYX Engineering Kit - Rust Framework Resolver
 *
 * Implements route extraction and module resolution for Rust web backends:
 * 1. Actix-web attribute macros (`#[get("/...")]`, `#[post("/...")]`)
 * 2. Axum declarative routing (`.route("/path", get(handler).post(other))`)
 * 3. Actix-web resource & builder APIs (`web::resource`, `.route(..., web::get().to(...))`)
 * 4. Resolves handler functions, service/repository traits, domain structs, and workspace crates
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
import { getCargoWorkspaceCrateMap } from './cargo-workspace';

const workspaceMapCache = new WeakMap<ResolutionContext, Map<string, string>>();

function getCachedWorkspaceCrateMapping(ctx: ResolutionContext): Map<string, string> {
  const cached = workspaceMapCache.get(ctx);
  if (cached) return cached;
  const mapped = getCargoWorkspaceCrateMap(ctx);
  workspaceMapCache.set(ctx, mapped);
  return mapped;
}

const PREFERRED_HANDLER_DIRECTORIES: readonly string[] = ['/handlers/', '/handler/', '/api/', '/routes/', '/controllers/'];
const PREFERRED_SERVICE_DIRECTORIES: readonly string[] = ['/services/', '/service/', '/repository/', '/domain/'];
const PREFERRED_MODEL_DIRECTORIES: readonly string[] = ['/models/', '/model/', '/entities/', '/entity/', '/domain/', '/types/'];

const FUNCTION_KINDS_FILTER: ReadonlySet<string> = new Set(['function']);
const SERVICE_TRAIT_KINDS_FILTER: ReadonlySet<string> = new Set(['struct', 'trait']);
const STRUCT_KINDS_FILTER: ReadonlySet<string> = new Set(['struct']);

function findBalancedClosingParenthesis(str: string, openIndex: number): number {
  let nesting = 0;
  for (let idx = openIndex; idx < str.length; idx++) {
    const ch = str[idx];
    if (ch === '(') nesting++;
    else if (ch === ')') {
      nesting--;
      if (nesting === 0) return idx;
    }
  }
  return -1;
}

function locateCandidateByKindAndPath(
  symbolName: string,
  kindSet: ReadonlySet<string>,
  directoryKeywords: readonly string[],
  ctx: ResolutionContext
): string | null {
  const matches = ctx.getNodesByName(symbolName);
  if (matches.length === 0) return null;

  const validNodes = matches.filter((n) => kindSet.has(n.kind));
  if (validNodes.length === 0) return null;

  const inPreferredDirectory = validNodes.filter((n) =>
    directoryKeywords.some((pattern) => n.filePath.includes(pattern))
  );

  return inPreferredDirectory.length > 0 ? inPreferredDirectory[0]!.id : validNodes[0]!.id;
}

interface ResolvedRustModule {
  targetId: string;
  fromWorkspace: boolean;
}

function resolveRustModule(moduleIdentifier: string, ctx: ResolutionContext): ResolvedRustModule | null {
  const localTargetPaths = [`src/${moduleIdentifier}.rs`, `src/${moduleIdentifier}/mod.rs`];

  const crateMap = getCachedWorkspaceCrateMapping(ctx);
  const crateDirectory = crateMap.get(moduleIdentifier);
  const workspaceTargetPaths = crateDirectory
    ? [`${crateDirectory}/src/lib.rs`, `${crateDirectory}/src/main.rs`]
    : [];

  const targets: Array<{ path: string; fromWorkspace: boolean }> = [
    ...localTargetPaths.map((p) => ({ path: p, fromWorkspace: false })),
    ...workspaceTargetPaths.map((p) => ({ path: p, fromWorkspace: true })),
  ];

  for (const item of targets) {
    if (!ctx.fileExists(item.path)) continue;
    const fileNodes = ctx.getNodesInFile(item.path);
    const modNode = fileNodes.find((n) => n.kind === 'module');
    if (modNode) return { targetId: modNode.id, fromWorkspace: item.fromWorkspace };
    if (fileNodes.length > 0) return { targetId: fileNodes[0]!.id, fromWorkspace: item.fromWorkspace };
  }

  return null;
}

export const rustResolver: FrameworkResolver = {
  name: 'rust',
  languages: ['rust'],

  detect(context: ResolutionContext): boolean {
    return context.fileExists('Cargo.toml');
  },

  resolve(ref: UnresolvedRef, context: ResolutionContext): ResolvedRef | null {
    if (ref.referenceName.endsWith('_handler') || ref.referenceName.startsWith('handle_')) {
      const matchId = locateCandidateByKindAndPath(
        ref.referenceName,
        FUNCTION_KINDS_FILTER,
        PREFERRED_HANDLER_DIRECTORIES,
        context
      );
      if (matchId) {
        return {
          original: ref,
          targetNodeId: matchId,
          confidence: 0.8,
          resolvedBy: 'framework',
        };
      }
    }

    if (ref.referenceName.endsWith('Service') || ref.referenceName.endsWith('Repository')) {
      const matchId = locateCandidateByKindAndPath(
        ref.referenceName,
        SERVICE_TRAIT_KINDS_FILTER,
        PREFERRED_SERVICE_DIRECTORIES,
        context
      );
      if (matchId) {
        return {
          original: ref,
          targetNodeId: matchId,
          confidence: 0.8,
          resolvedBy: 'framework',
        };
      }
    }

    if (/^[A-Z][a-zA-Z]+$/.test(ref.referenceName)) {
      const matchId = locateCandidateByKindAndPath(
        ref.referenceName,
        STRUCT_KINDS_FILTER,
        PREFERRED_MODEL_DIRECTORIES,
        context
      );
      if (matchId) {
        return {
          original: ref,
          targetNodeId: matchId,
          confidence: 0.7,
          resolvedBy: 'framework',
        };
      }
    }

    if (/^[a-z_]+$/.test(ref.referenceName)) {
      const resolvedMod = resolveRustModule(ref.referenceName, context);
      if (resolvedMod) {
        return {
          original: ref,
          targetNodeId: resolvedMod.targetId,
          confidence: resolvedMod.fromWorkspace ? 0.95 : 0.6,
          resolvedBy: 'framework',
        };
      }
    }

    return null;
  },

  extract(filePath: string, content: string): FrameworkExtractionResult {
    if (!filePath.endsWith('.rs')) return { nodes: [], references: [] };

    const nodes: Node[] = [];
    const references: UnresolvedRef[] = [];
    const timestamp = Date.now();
    const cleanSource = stripCommentsForRegex(content, 'rust');

    const actixAttrPattern =
      /#\[(get|post|put|patch|delete|head|options)\s*\(\s*["']([^"']+)["'][^\]]*\)\]/g;
    let match: RegExpExecArray | null;

    while ((match = actixAttrPattern.exec(cleanSource)) !== null) {
      const httpVerb = match[1]!.toUpperCase();
      const endpoint = match[2]!;
      const lineNumber = cleanSource.slice(0, match.index).split('\n').length;

      const routeNode: Node = {
        id: `route:${filePath}:${lineNumber}:${httpVerb}:${endpoint}`,
        kind: 'route',
        name: `${httpVerb} ${endpoint}`,
        qualifiedName: `${filePath}::route:${endpoint}`,
        filePath,
        startLine: lineNumber,
        endLine: lineNumber,
        startColumn: 0,
        endColumn: match[0].length,
        language: 'rust',
        updatedAt: timestamp,
      };
      nodes.push(routeNode);

      const trailingText = cleanSource.slice(match.index + match[0].length);
      const fnDeclMatch = trailingText.match(/\n\s*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/);
      if (fnDeclMatch) {
        references.push({
          fromNodeId: routeNode.id,
          referenceName: fnDeclMatch[1]!,
          referenceKind: 'references',
          line: lineNumber,
          column: 0,
          filePath,
          language: 'rust',
        });
      }
    }

    const axumRoutePattern = /\.route\s*\(/g;
    while ((match = axumRoutePattern.exec(cleanSource)) !== null) {
      const openParen = cleanSource.indexOf('(', match.index);
      if (openParen < 0) continue;

      const closeParen = findBalancedClosingParenthesis(cleanSource, openParen);
      if (closeParen < 0) continue;

      const argsBlock = cleanSource.slice(openParen + 1, closeParen);
      const pathTokenMatch = argsBlock.match(/^\s*"([^"]+)"\s*,/);
      if (!pathTokenMatch) continue;

      const routeEndpoint = pathTokenMatch[1]!;
      const lineNumber = cleanSource.slice(0, match.index).split('\n').length;
      const methodsSegment = argsBlock.slice(pathTokenMatch[0].length);

      const methodCallPattern = /\b(get|post|put|patch|delete|head|options|trace)\s*\(\s*([A-Za-z_][\w:]*)/g;
      let mCall: RegExpExecArray | null;

      while ((mCall = methodCallPattern.exec(methodsSegment)) !== null) {
        const verb = mCall[1]!.toUpperCase();
        const handlerIdent = mCall[2]!.split('::').filter(Boolean).pop();
        if (!handlerIdent) continue;

        const routeNode: Node = {
          id: `route:${filePath}:${lineNumber}:${verb}:${routeEndpoint}`,
          kind: 'route',
          name: `${verb} ${routeEndpoint}`,
          qualifiedName: `${filePath}::route:${routeEndpoint}`,
          filePath,
          startLine: lineNumber,
          endLine: lineNumber,
          startColumn: 0,
          endColumn: 0,
          language: 'rust',
          updatedAt: timestamp,
        };
        nodes.push(routeNode);

        references.push({
          fromNodeId: routeNode.id,
          referenceName: handlerIdent,
          referenceKind: 'references',
          line: lineNumber,
          column: 0,
          filePath,
          language: 'rust',
        });
      }
    }

    const registerActixBuilderRoute = (pathStr: string, methodStr: string, handlerExpression: string, line: number) => {
      const handlerName = handlerExpression.split('::').filter(Boolean).pop();
      if (!handlerName) return;

      const verbUpper = methodStr.toUpperCase();
      const nodeInstance: Node = {
        id: `route:${filePath}:${line}:${verbUpper}:${pathStr}`,
        kind: 'route',
        name: `${verbUpper} ${pathStr}`,
        qualifiedName: `${filePath}::route:${pathStr}`,
        filePath,
        startLine: line,
        endLine: line,
        startColumn: 0,
        endColumn: 0,
        language: 'rust',
        updatedAt: timestamp,
      };
      nodes.push(nodeInstance);

      references.push({
        fromNodeId: nodeInstance.id,
        referenceName: handlerName,
        referenceKind: 'references',
        line,
        column: 0,
        filePath,
        language: 'rust',
      });
    };

    const webResourceRegex = /web::resource\s*\(\s*"([^"]+)"\s*\)/g;
    while ((match = webResourceRegex.exec(cleanSource)) !== null) {
      const endpoint = match[1]!;
      const startLine = cleanSource.slice(0, match.index).split('\n').length;
      const afterPos = match.index + match[0].length;
      const nextResPos = cleanSource.indexOf('web::resource', afterPos);
      const chainLimit = Math.min(afterPos + 500, nextResPos === -1 ? cleanSource.length : nextResPos);
      const chainSnippet = cleanSource.slice(afterPos, chainLimit);

      const methodToPattern = /web::(get|post|put|patch|delete|head)\s*\(\s*\)\s*\.to\s*\(\s*([A-Za-z_][\w:]*)/g;
      let mTo: RegExpExecArray | null;
      let detectedAny = false;

      while ((mTo = methodToPattern.exec(chainSnippet)) !== null) {
        const subLine = startLine + chainSnippet.slice(0, mTo.index).split('\n').length - 1;
        registerActixBuilderRoute(endpoint, mTo[1]!, mTo[2]!, subLine);
        detectedAny = true;
      }

      if (!detectedAny) {
        const directToMatch = chainSnippet.match(/^\s*\.to\s*\(\s*([A-Za-z_][\w:]*)/);
        if (directToMatch) {
          registerActixBuilderRoute(endpoint, 'ANY', directToMatch[1]!, startLine);
        }
      }
    }

    const directAppRouteRegex =
      /\.route\s*\(\s*"([^"]+)"\s*,\s*web::(get|post|put|patch|delete|head)\s*\(\s*\)\s*\.to\s*\(\s*([A-Za-z_][\w:]*)/g;
    while ((match = directAppRouteRegex.exec(cleanSource)) !== null) {
      const lineNum = cleanSource.slice(0, match.index).split('\n').length;
      registerActixBuilderRoute(match[1]!, match[2]!, match[3]!, lineNum);
    }

    return { nodes, references };
  },
};
