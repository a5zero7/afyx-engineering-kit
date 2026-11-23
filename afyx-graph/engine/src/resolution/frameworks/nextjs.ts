/**
 * AFYX Engineering Kit - Next.js Framework Resolver
 *
 * Implements route declaration extraction and navigation edge resolution for Next.js applications:
 * 1. App Router (app/.../page.tsx, app/.../route.ts)
 * 2. Pages Router (pages/.../page.tsx, pages/api/.../*.ts)
 * 3. Client and server navigations (router.push, router.replace, redirect, NextResponse.redirect)
 * 4. Resolves destination href expressions against the internal Next.js route table.
 */

import type { Language, Node } from '../../types';
import type {
  FrameworkResolver,
  ResolutionContext,
  ResolvedRef,
  UnresolvedRef,
} from '../types';
import { stripCommentsForRegex } from '../strip-comments';
import { dependsOn } from './package-deps';
import {
  HOLE,
  hrefArms,
  defaultExportName,
  firstArgumentText,
  matchRoute,
  parseHrefExpression,
  readHrefViaLocal,
  type HrefLiteral,
  type RouteTable,
} from './expo-router';

const NEXT_LANGUAGES: readonly Language[] = ['typescript', 'javascript', 'tsx', 'jsx'];
const HTTP_VERBS_REGEX = 'GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS';

export interface NextRouteFile {
  kind: 'page' | 'handler' | 'api';
  path: string;
  root: string;
}

/**
 * Normalizes Next.js dynamic path segments:
 * `[slug]` -> `:slug`, `[...all]` / `[[...all]]` -> `:all*`
 */
function normalizeNextSegment(segment: string): string {
  const optionalCatchAllMatch = /^\[\[\.\.\.([^\]]+)\]\]$/.exec(segment);
  if (optionalCatchAllMatch) return `:${optionalCatchAllMatch[1]}*`;

  const catchAllMatch = /^\[\.\.\.([^\]]+)\]$/.exec(segment);
  if (catchAllMatch) return `:${catchAllMatch[1]}*`;

  const paramMatch = /^\[([^\]]+)\]$/.exec(segment);
  if (paramMatch) return `:${paramMatch[1]}`;

  return segment;
}

/**
 * Maps a repository file path to its Next.js route classification.
 */
export function nextRouteForFile(filePath: string): NextRouteFile | null {
  if (/(?:^|\/)(?:__tests__|__mocks__|node_modules)\//.test(filePath)) return null;

  const appRouterMatch = /^((?:[^/]+\/)*?)(?:src\/)?app\/(.+)$/.exec(filePath);
  if (appRouterMatch) {
    const fileEntryMatch = /^(.*?)(?:^|\/)(page|route)\.(?:tsx|ts|jsx|js|mjs|cjs|mdx?)$/.exec(appRouterMatch[2]!);
    if (!fileEntryMatch) return null;

    const segments = fileEntryMatch[1]!.split('/').filter(Boolean);
    if (segments.some((s) => s.startsWith('@') || /^\(\.{1,3}\)/.test(s))) return null;

    const cleanSegments = segments
      .filter((s) => !(s.startsWith('(') && s.endsWith(')')))
      .map(normalizeNextSegment);

    return {
      kind: fileEntryMatch[2] === 'page' ? 'page' : 'handler',
      path: `/${cleanSegments.join('/')}`,
      root: appRouterMatch[1]!,
    };
  }

  const pagesRouterMatch = /^((?:[^/]+\/)*?)(?:src\/)?pages\/(.+)$/.exec(filePath);
  if (pagesRouterMatch) {
    const relativePath = pagesRouterMatch[2]!;
    const extensionMatch = /\.(?:tsx|ts|jsx|js|mjs|cjs|mdx?)$/.exec(relativePath);
    if (!extensionMatch) return null;

    const pathWithoutExt = relativePath.slice(0, extensionMatch.index);
    const segments = pathWithoutExt.split('/');
    const lastSegment = segments[segments.length - 1]!;

    if (lastSegment.startsWith('_') || /\.(?:test|spec|stories|config|d)$/.test(pathWithoutExt)) {
      return null;
    }

    if (segments[segments.length - 1] === 'index') {
      segments.pop();
    }

    return {
      kind: segments[0] === 'api' ? 'api' : 'page',
      path: `/${segments.map(normalizeNextSegment).join('/')}`,
      root: pagesRouterMatch[1]!,
    };
  }

  return null;
}

function resolveFileLanguage(filePath: string): Language {
  if (filePath.endsWith('.tsx')) return 'tsx';
  if (filePath.endsWith('.jsx')) return 'jsx';
  if (/\.(?:ts|mts|cts)$/.test(filePath)) return 'typescript';
  return 'javascript';
}

interface NextTable extends RouteTable {
  roots: string[];
}

const tableCache = new WeakMap<ResolutionContext, NextTable>();

export function nextRouteTable(context: ResolutionContext): NextTable {
  const allRoutes = context.getNodesByKind('route');
  const cachedInstance = tableCache.get(context);
  if (cachedInstance && cachedInstance.source === allRoutes) {
    return cachedInstance;
  }

  const exactMap = new Map<string, Node>();
  const dynamicRoutes: RouteTable['dynamic'] = [];
  const recognizedRoots = new Set<string>();

  for (const node of allRoutes) {
    const fileMeta = nextRouteForFile(node.filePath);
    if (!fileMeta || fileMeta.kind !== 'page' || fileMeta.path !== node.name) continue;

    exactMap.set(node.name, node);
    if (node.name.includes(':')) {
      dynamicRoutes.push({ node, segs: node.name.split('/').slice(1) });
    }
    recognizedRoots.add(fileMeta.root);
  }

  const constructedTable: NextTable = {
    source: allRoutes,
    exact: exactMap,
    dynamic: dynamicRoutes,
    roots: [...recognizedRoots],
  };

  tableCache.set(context, constructedTable);
  return constructedTable;
}

function splitHrefSegments(href: HrefLiteral): string[] | null {
  let targetPath = href.path;
  const urlProtocolMatch = /^(?:[a-z][a-z0-9+.-]*:)?\/\/[^/]*(\/.*)?$/i.exec(targetPath);
  if (urlProtocolMatch) {
    targetPath = urlProtocolMatch[1] ?? '/';
  }

  if (!targetPath.startsWith('/')) return null;

  return targetPath
    .split('/')
    .slice(1)
    .filter((segment) => segment.length > 0)
    .map((segment) => (segment.includes(HOLE) ? '*' : safeDecodeUri(segment)));
}

function safeDecodeUri(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export interface HrefDestination {
  node: Node;
  href: HrefLiteral;
}

export function destinationsForHref(href: HrefLiteral, table: RouteTable): HrefDestination[] {
  const matches: HrefDestination[] = [];
  const visitedNodeIds = new Set<string>();

  for (const candidateArm of hrefArms(href)) {
    const parts = splitHrefSegments(candidateArm);
    if (parts === null) continue;

    const matchedNode = matchRoute(parts, table);
    if (!matchedNode || visitedNodeIds.has(matchedNode.id)) continue;

    visitedNodeIds.add(matchedNode.id);
    matches.push({ node: matchedNode, href: candidateArm });
  }

  return matches;
}

export function pageForHref(href: HrefLiteral, table: RouteTable): Node | null {
  return destinationsForHref(href, table)[0]?.node ?? null;
}

const NAVIGATION_PATTERN =
  /(?:^|\.)(push|replace|prefetch)$|^(redirect|permanentRedirect)$|^(?:NextResponse|Response)\.(redirect)$/;

export function nextNavVerb(name: string): string | null {
  const match = NAVIGATION_PATTERN.exec(name);
  if (!match) return null;
  if (match[3]) return 'response.redirect';
  return match[1] ?? match[2]!;
}

export const nextjsResolver: FrameworkResolver = {
  name: 'nextjs',
  languages: [...NEXT_LANGUAGES],

  detect(context: ResolutionContext): boolean {
    if (dependsOn(context, 'next')) return true;

    const fileList = context.getAllFiles();
    const containsNextConfigFile = fileList.some((p) => /(?:^|\/)next\.config\.[cm]?[jt]s$/.test(p));
    return containsNextConfigFile && fileList.some((p) => nextRouteForFile(p) !== null);
  },

  claimsReference(name: string): boolean {
    return NAVIGATION_PATTERN.test(name);
  },

  extract(filePath: string, content: string) {
    const routeClassification = nextRouteForFile(filePath);
    if (!routeClassification) return { nodes: [], references: [] };

    const detectedLanguage = resolveFileLanguage(filePath);
    const timestamp = Date.now();
    const createdNodes: Node[] = [];
    const createdReferences: UnresolvedRef[] = [];

    const cleanContent = stripCommentsForRegex(content, 'typescript');
    const computeLine = (index: number): number => cleanContent.slice(0, index).split('\n').length;

    if (routeClassification.kind === 'handler') {
      const handledMethods = new Set<string>();
      const handlerPattern = new RegExp(
        `\\bexport\\s+(?:async\\s+)?function\\s+(${HTTP_VERBS_REGEX})\\b|\\bexport\\s+(?:const|let)\\s+(${HTTP_VERBS_REGEX})\\s*=`,
        'g'
      );
      let match: RegExpExecArray | null;

      while ((match = handlerPattern.exec(cleanContent)) !== null) {
        const verbMethod = (match[1] ?? match[2])!;
        if (handledMethods.has(verbMethod)) continue;

        handledMethods.add(verbMethod);
        const line = computeLine(match.index);

        const handlerNode: Node = {
          id: `route:${filePath}:${line}:${verbMethod}:${routeClassification.path}`,
          kind: 'route',
          name: `${verbMethod} ${routeClassification.path}`,
          qualifiedName: `${filePath}::${verbMethod}:${routeClassification.path}`,
          filePath,
          startLine: line,
          endLine: line,
          startColumn: 0,
          endColumn: match[0].length,
          language: detectedLanguage,
          isExported: true,
          updatedAt: timestamp,
        };
        createdNodes.push(handlerNode);
        createdReferences.push({
          fromNodeId: handlerNode.id,
          referenceName: verbMethod,
          referenceKind: 'references',
          line,
          column: 0,
          filePath,
          language: detectedLanguage,
          candidates: [verbMethod],
        });
      }

      return { nodes: createdNodes, references: createdReferences };
    }

    const routeDisplayName =
      routeClassification.kind === 'api' ? `ANY ${routeClassification.path}` : routeClassification.path;
    const pageNode: Node = {
      id:
        routeClassification.kind === 'api'
          ? `route:${filePath}:1:ANY:${routeClassification.path}`
          : `route:${filePath}:${routeClassification.path}`,
      kind: 'route',
      name: routeDisplayName,
      qualifiedName:
        routeClassification.kind === 'api'
          ? `${filePath}::ANY:${routeClassification.path}`
          : `${filePath}::route:${routeClassification.path}`,
      filePath,
      startLine: 1,
      endLine: 1,
      startColumn: 0,
      endColumn: 0,
      language: detectedLanguage,
      isExported: true,
      updatedAt: timestamp,
    };
    createdNodes.push(pageNode);

    const defaultExport = defaultExportName(cleanContent);
    if (defaultExport) {
      createdReferences.push({
        fromNodeId: pageNode.id,
        referenceName: defaultExport.name,
        referenceKind: routeClassification.kind === 'api' ? 'references' : 'calls',
        line: computeLine(defaultExport.index),
        column: 0,
        filePath,
        language: detectedLanguage,
        candidates: [defaultExport.name],
      });
    }

    return { nodes: createdNodes, references: createdReferences };
  },

  resolve(ref: UnresolvedRef, context: ResolutionContext): ResolvedRef | null {
    if (ref.referenceKind !== 'calls') return null;

    const actionVerb = nextNavVerb(ref.referenceName);
    if (!actionVerb) return null;
    if (!NEXT_LANGUAGES.includes(ref.language)) return null;

    const table = nextRouteTable(context);
    if (table.exact.size === 0 || !table.roots.some((root) => ref.filePath.startsWith(root))) {
      return null;
    }

    const callee = ref.referenceName.slice(ref.referenceName.lastIndexOf('.') + 1);
    const lines = context.getFileLines?.(ref.filePath) ?? context.readFile(ref.filePath)?.split(/\r?\n/) ?? null;
    if (!lines) return null;

    let argumentText = firstArgumentText(lines, ref.line, ref.column, callee);
    if (argumentText === null) return null;

    if (/^\s*new\s+URL\s*\(/.test(argumentText)) {
      argumentText = firstArgumentText([argumentText], 1, 0, 'URL');
    }

    let targetHref = argumentText === null ? null : parseHrefExpression(argumentText);
    if (!targetHref) {
      const parentNode = context.getNodeById?.(ref.fromNodeId);
      const startLine = parentNode && parentNode.filePath === ref.filePath ? parentNode.startLine : Math.max(1, ref.line - 40);
      targetHref = readHrefViaLocal(lines, ref.line, ref.column, callee, startLine);
    }

    if (!targetHref) return null;

    const destinationMatches = destinationsForHref(targetHref, table);
    const primaryDestination = destinationMatches[0];
    if (!primaryDestination) return null;

    return {
      original: ref,
      targetNodeId: primaryDestination.node.id,
      ...(destinationMatches.length > 1
        ? {
            alsoTargets: destinationMatches.slice(1).map((dest) => ({
              targetNodeId: dest.node.id,
              metadata: {
                href: dest.href.display,
                navMethod: actionVerb,
              },
            })),
          }
        : {}),
      confidence: 0.95,
      resolvedBy: 'framework',
      edgeKind: 'navigates',
      metadata: {
        href: primaryDestination.href.display,
        navMethod: actionVerb,
      },
    };
  },
};
