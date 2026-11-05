/**
 * AFYX Engineering Kit - TanStack Router Resolver
 *
 * Implements route declaration extraction and navigation edge resolution for TanStack Router.
 * Supports both file-based routing (`createFileRoute`, `createLazyFileRoute`) and code-based
 * declarative route trees (`createRoute`, `createRootRoute`).
 * Normalizes TanStack parameter patterns (`$param`, `$`) into canonical route forms (`:param`, `:splat*`).
 */

import type { Language, Node } from '../../types';
import type {
  FrameworkExtractionResult,
  FrameworkResolver,
  ResolutionContext,
  ResolvedRef,
  UnresolvedRef,
} from '../types';
import { stripCommentsForRegex } from '../strip-comments';
import { dependsOn } from './package-deps';
import { matchBracket, readFields } from './object-literal';
import {
  addRouteTo,
  appRootFor,
  firstArgumentText,
  parseHrefExpression,
  readHrefViaLocal,
  readStringAt,
  routesForFile,
  toHref,
  type HrefLiteral,
  type RootedRouteTable,
  type RouteTable,
} from './expo-router';
import { destinationsForHref } from './nextjs';

const TANSTACK_LANGUAGES: readonly Language[] = ['typescript', 'javascript', 'tsx', 'jsx'];

/**
 * Normalizes TanStack route path patterns to canonical route strings.
 * `$param` becomes `:param`, bare `$` becomes `:splat*`, pathless layouts `_layout` and groups `(group)` are elided.
 */
export function tanstackPath(rawInput: string): string | null {
  if (!rawInput.startsWith('/')) return null;

  const normalizedSegments: string[] = [];
  for (const part of rawInput.split('/')) {
    if (part.length === 0) continue;
    if (part.startsWith('_')) continue;
    if (part.startsWith('(') && part.endsWith(')')) continue;

    const basePart = part.endsWith('_') ? part.slice(0, -1) : part;
    if (basePart === '$') {
      normalizedSegments.push(':splat*');
    } else if (basePart.startsWith('$')) {
      normalizedSegments.push(`:${basePart.slice(1)}`);
    } else {
      normalizedSegments.push(basePart);
    }
  }

  return `/${normalizedSegments.join('/')}`;
}

function isPathlessLayoutSpecifier(raw: string): boolean {
  if (raw.length > 1 && raw.endsWith('/')) return false;
  const parts = raw.split('/').filter((p) => p.length > 0);
  const tail = parts[parts.length - 1];
  return tail !== undefined && tail.startsWith('_');
}

function isLayoutWrappingFile(filePath: string, content: string): boolean {
  const filename = filePath.slice(filePath.lastIndexOf('/') + 1);
  if (/(?:^|\.)route\.(?:tsx|ts|jsx|js)$/.test(filename)) return true;
  return /<Outlet\b/.test(content);
}

function resolveFileLanguage(filePath: string): Language {
  if (filePath.endsWith('.tsx')) return 'tsx';
  if (filePath.endsWith('.jsx')) return 'jsx';
  if (/\.(?:ts|mts|cts)$/.test(filePath)) return 'typescript';
  return 'javascript';
}

export interface TanstackRouteEntry {
  path: string;
  component: string | null;
  index: boolean;
  fileBased: boolean;
  line: number;
}

const ROUTE_CALL_TRIGGER_PATTERN = /\bcreate(?:File|Lazy(?:File)?|Root)?Route\s*\(/;

/**
 * Parses file-based and code-based TanStack routes from source code.
 */
export function parseTanstackRoutes(source: string): TanstackRouteEntry[] {
  if (!ROUTE_CALL_TRIGGER_PATTERN.test(source)) return [];

  const strippedSource = stripCommentsForRegex(source, 'typescript');
  const routeEntries: TanstackRouteEntry[] = [];
  const computeLineNumber = (idx: number): number => strippedSource.slice(0, idx).split('\n').length;

  const fileRouteRegex = /\bcreate(?:Lazy)?FileRoute\s*\(/g;
  let fileMatch: RegExpExecArray | null;

  while ((fileMatch = fileRouteRegex.exec(strippedSource)) !== null) {
    const openParen = fileMatch.index + fileMatch[0].length - 1;
    const closeParen = matchBracket(strippedSource, openParen);
    if (closeParen < 0) continue;

    const rawPath = readStringAt(strippedSource.slice(openParen + 1, closeParen).trimStart(), 0);
    if (rawPath === null) continue;

    const normalizedPath = tanstackPath(rawPath);
    if (normalizedPath === null || isPathlessLayoutSpecifier(rawPath)) continue;

    routeEntries.push({
      path: normalizedPath,
      component: locateComponentIdentifier(extractTrailingCallChain(strippedSource, closeParen + 1)),
      index: rawPath.length > 1 && rawPath.endsWith('/'),
      fileBased: true,
      line: computeLineNumber(fileMatch.index),
    });
  }

  const codeBasedDeclarations = new Map<
    string,
    { path: string | null; parent: string | null; component: string | null; isRoot: boolean; charIndex: number }
  >();

  const codeRouteRegex = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*?)?=\s*create(Root)?Route\s*\(\s*\{/g;
  let codeMatch: RegExpExecArray | null;

  while ((codeMatch = codeRouteRegex.exec(strippedSource)) !== null) {
    const openingBrace = strippedSource.indexOf('{', codeMatch.index + codeMatch[0].length - 1);
    const closingBrace = matchBracket(strippedSource, openingBrace);
    if (closingBrace < 0) continue;

    const properties = readFields(strippedSource, openingBrace, closingBrace);
    const pathField = properties.get('path');
    const pathValue = codeMatch[2] ? '/' : pathField ? readStringAt(pathField.text.trimStart(), 0) : null;

    const parentField = properties.get('getParentRoute');
    const parentName = parentField ? (/=>\s*([A-Za-z_$][\w$]*)/.exec(parentField.text)?.[1] ?? null) : null;
    const compField = properties.get('component');

    codeBasedDeclarations.set(codeMatch[1]!, {
      path: pathValue,
      parent: parentName,
      component: compField ? locateComponentIdentifier(compField.text) : null,
      isRoot: codeMatch[2] !== undefined,
      charIndex: codeMatch.index,
    });
  }

  const parentRoutesWithIndexChild = new Set(
    [...codeBasedDeclarations.values()]
      .filter((decl) => decl.path === '/' && decl.parent !== null)
      .map((decl) => decl.parent!)
  );

  for (const [varName, decl] of codeBasedDeclarations) {
    if (decl.path === null || decl.isRoot || parentRoutesWithIndexChild.has(varName)) continue;

    const assembledPath = composeParentRouteChain(varName, codeBasedDeclarations);
    if (assembledPath === null) continue;

    const canonicalPath = tanstackPath(assembledPath);
    if (canonicalPath === null) continue;

    routeEntries.push({
      path: canonicalPath,
      component: decl.component,
      index: decl.path === '/',
      fileBased: false,
      line: computeLineNumber(decl.charIndex),
    });
  }

  return routeEntries;
}

function composeParentRouteChain(
  initialRoute: string,
  decls: Map<string, { path: string | null; parent: string | null }>
): string | null {
  const parts: string[] = [];
  let currentIdentifier: string | null = initialRoute;

  for (let depth = 0; currentIdentifier !== null && depth < 24; depth++) {
    const record = decls.get(currentIdentifier);
    if (!record) return null;

    if (record.path !== null) {
      const segments = record.path.split('/').filter((s) => s.length > 0);
      parts.unshift(...segments);
    }
    currentIdentifier = record.parent;
  }

  return `/${parts.join('/')}`;
}

function extractTrailingCallChain(content: string, offset: number): string {
  let idx = offset;
  const initial = idx;

  for (let pass = 0; pass < 8; pass++) {
    while (idx < content.length && /\s/.test(content[idx]!)) idx++;
    if (content[idx] === '.') {
      idx++;
      while (idx < content.length && /[\w$]/.test(content[idx]!)) idx++;
      while (idx < content.length && /\s/.test(content[idx]!)) idx++;
    }
    if (content[idx] !== '(') break;
    const closing = matchBracket(content, idx);
    if (closing < 0) break;
    idx = closing + 1;
  }

  return content.slice(initial, idx);
}

function locateComponentIdentifier(text: string): string | null {
  const dynamicImportMatch = /\bimport\s*\(\s*['"`]([^'"`]+)['"`]/.exec(text);
  if (dynamicImportMatch) {
    const specifier = dynamicImportMatch[1]!;
    const basename = specifier.split('/').pop() ?? '';
    return basename.replace(/\.\w+$/, '') || null;
  }

  return (
    /(?:^|[^\w$])component\s*:\s*([A-Z][A-Za-z0-9_]*)/.exec(text)?.[1] ??
    /^\s*([A-Z][A-Za-z0-9_]*)\s*$/.exec(text)?.[1] ??
    null
  );
}

function formatTanstackRouteId(filePath: string, line: number, path: string): string {
  return `route:${filePath}:${line}:${path}:tanstack`;
}

export type TanstackTable = RootedRouteTable;

function isRegisteredTanstackRoute(node: Node): boolean {
  return node.id === formatTanstackRouteId(node.filePath, node.startLine, node.name);
}

const tableCache = new WeakMap<ResolutionContext, TanstackTable>();

export function tanstackTable(context: ResolutionContext): TanstackTable {
  const routeNodes = context.getNodesByKind('route');
  const cached = tableCache.get(context);
  if (cached && cached.source === routeNodes) {
    return cached;
  }

  const byRoot = new Map<string, RouteTable>();
  for (const node of routeNodes) {
    if (!isRegisteredTanstackRoute(node)) continue;
    const rootPath = appRootFor(node.filePath);
    let appTable = byRoot.get(rootPath);
    if (!appTable) {
      appTable = { source: routeNodes, exact: new Map(), dynamic: [] };
      byRoot.set(rootPath, appTable);
    }
    addRouteTo(appTable, node.name, node);
  }

  const builtTable: TanstackTable = { source: routeNodes, byRoot };
  tableCache.set(context, builtTable);
  return builtTable;
}

const NAVIGATION_INVOCATION_REGEX = /^(?:navigate|redirect)$|^(?:router|Route)\.navigate$/;

export function tanstackNavVerb(name: string): string | null {
  if (!NAVIGATION_INVOCATION_REGEX.test(name)) return null;
  const dotIndex = name.lastIndexOf('.');
  return dotIndex < 0 ? name : name.slice(dotIndex + 1);
}

export function tanstackDestination(argumentExpression: string): HrefLiteral | null {
  const trimmed = argumentExpression.trim();
  const rawTarget = trimmed[0] === '{' ? extractToPropertyFromObject(trimmed) : readStringAt(trimmed, 0);
  if (rawTarget === null) return null;

  const normalized = tanstackPath(rawTarget);
  return normalized === null ? parseHrefExpression(trimmed) : toHref(normalized);
}

function extractToPropertyFromObject(objectText: string): string | null {
  const closingBrace = matchBracket(objectText, 0);
  if (closingBrace < 0) return null;
  const toField = readFields(objectText, 0, closingBrace).get('to');
  return toField ? readStringAt(toField.text.trimStart(), 0) : null;
}

export const tanstackRouterResolver: FrameworkResolver = {
  name: 'tanstack-router',
  languages: [...TANSTACK_LANGUAGES],

  detect(context: ResolutionContext): boolean {
    return dependsOn(
      context,
      '@tanstack/react-router',
      '@tanstack/solid-router',
      '@tanstack/router',
      '@tanstack/react-start',
      '@tanstack/start'
    );
  },

  claimsReference(name: string): boolean {
    return NAVIGATION_INVOCATION_REGEX.test(name);
  },

  extract(filePath: string, content: string): FrameworkExtractionResult {
    const isLayout = isLayoutWrappingFile(filePath, content);
    const parsedRoutes = parseTanstackRoutes(content).filter((entry) => !(entry.fileBased && isLayout));
    if (parsedRoutes.length === 0) return { nodes: [], references: [] };

    const detectedLanguage = resolveFileLanguage(filePath);
    const nowTimestamp = Date.now();
    const createdNodes: Node[] = [];
    const createdRefs: UnresolvedRef[] = [];

    const uniqueByPath = new Map<string, TanstackRouteEntry>();
    for (const r of parsedRoutes) {
      const existing = uniqueByPath.get(r.path);
      if (!existing || (r.index && !existing.index)) {
        uniqueByPath.set(r.path, r);
      }
    }

    for (const route of uniqueByPath.values()) {
      const node: Node = {
        id: formatTanstackRouteId(filePath, route.line, route.path),
        kind: 'route',
        name: route.path,
        qualifiedName: `${filePath}::route:${route.path}`,
        filePath,
        startLine: route.line,
        endLine: route.line,
        startColumn: 0,
        endColumn: 0,
        language: detectedLanguage,
        updatedAt: nowTimestamp,
      };
      createdNodes.push(node);

      if (route.component) {
        createdRefs.push({
          fromNodeId: node.id,
          referenceName: route.component,
          referenceKind: 'calls',
          line: route.line,
          column: 0,
          filePath,
          language: detectedLanguage,
          candidates: [route.component],
        });
      }
    }

    return { nodes: createdNodes, references: createdRefs };
  },

  resolve(ref: UnresolvedRef, context: ResolutionContext): ResolvedRef | null {
    if (ref.referenceKind !== 'calls') return null;

    const actionVerb = tanstackNavVerb(ref.referenceName);
    if (!actionVerb) return null;
    if (!TANSTACK_LANGUAGES.includes(ref.language)) return null;

    const routeTableScope = routesForFile(tanstackTable(context), ref.filePath);
    if (!routeTableScope || routeTableScope.exact.size === 0) return null;

    const lines = context.getFileLines?.(ref.filePath) ?? context.readFile(ref.filePath)?.split(/\r?\n/) ?? null;
    if (!lines) return null;

    const argText = firstArgumentText(lines, ref.line, ref.column, actionVerb);
    if (argText === null) return null;

    let targetHref = tanstackDestination(argText);
    if (!targetHref) {
      const parentNode = context.getNodeById?.(ref.fromNodeId);
      const startLine = parentNode && parentNode.filePath === ref.filePath ? parentNode.startLine : Math.max(1, ref.line - 40);
      targetHref = readHrefViaLocal(lines, ref.line, ref.column, actionVerb, startLine);
    }

    if (!targetHref) return null;

    const matchingDestinations = destinationsForHref(targetHref, routeTableScope);
    const primaryTarget = matchingDestinations[0];
    if (!primaryTarget) return null;

    return {
      original: ref,
      targetNodeId: primaryTarget.node.id,
      ...(matchingDestinations.length > 1
        ? {
            alsoTargets: matchingDestinations.slice(1).map((dest) => ({
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
        href: primaryTarget.href.display,
        navMethod: actionVerb,
      },
    };
  },
};
