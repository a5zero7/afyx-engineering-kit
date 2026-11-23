/**
 * AFYX Engineering Kit - SvelteKit Router Resolver
 *
 * Implements navigation edge resolution for SvelteKit applications.
 * Resolves browser navigations (`goto`) and server-side action/load redirections (`redirect`),
 * linking caller functions to their corresponding SvelteKit page route destinations.
 */

import type { Language, Node } from '../../types';
import type {
  FrameworkResolver,
  ResolutionContext,
  ResolvedRef,
  UnresolvedRef,
} from '../types';
import { dependsOn } from './package-deps';
import {
  addRouteTo,
  appRootFor,
  nthArgumentText,
  parseHrefExpression,
  readHrefViaLocal,
  routesForFile,
  type RootedRouteTable,
  type RouteTable,
} from './expo-router';
import { destinationsForHref } from './nextjs';

const SVELTEKIT_LANGUAGES: readonly Language[] = ['typescript', 'javascript', 'svelte'];
const NAVIGATION_CALL_PATTERN = /^(?:goto|redirect)$/;

export type SvelteKitTable = RootedRouteTable;

/**
 * Determines whether a given node represents a canonical SvelteKit page.
 */
function isCanonicalSvelteKitPage(node: Node): boolean {
  return (
    node.language === 'svelte' &&
    node.filePath.endsWith('/+page.svelte') &&
    node.id === `route:${node.filePath}:${node.name}:1`
  );
}

/**
 * Checks if a route path segment denotes an optional parameter.
 */
function isOptionalRouteSegment(segment: string): boolean {
  return segment.startsWith(':') && segment.endsWith('?');
}

const tableCache = new WeakMap<ResolutionContext, SvelteKitTable>();

/**
 * Computes or retrieves cached SvelteKit route table from the resolution context.
 */
export function svelteKitTable(context: ResolutionContext): SvelteKitTable {
  const existingRoutes = context.getNodesByKind('route');
  const cachedInstance = tableCache.get(context);
  if (cachedInstance && cachedInstance.source === existingRoutes) {
    return cachedInstance;
  }

  const routesByAppRoot = new Map<string, RouteTable>();
  const secondaryRoutes: Array<{ root: string; path: string; node: Node }> = [];

  const getOrCreateTable = (root: string): RouteTable => {
    let t = routesByAppRoot.get(root);
    if (!t) {
      t = { source: existingRoutes, exact: new Map(), dynamic: [] };
      routesByAppRoot.set(root, t);
    }
    return t;
  };

  for (const routeNode of existingRoutes) {
    if (!isCanonicalSvelteKitPage(routeNode)) continue;
    if (!routeNode.name.startsWith('/') || routeNode.name.includes('*')) continue;

    const rootDir = appRootFor(routeNode.filePath);
    const primaryTable = getOrCreateTable(rootDir);
    addRouteTo(primaryTable, routeNode.name, routeNode);

    let parts = routeNode.name.split('/').slice(1);
    while (parts.length > 1 && isOptionalRouteSegment(parts[parts.length - 1]!)) {
      parts = parts.slice(0, -1);
      secondaryRoutes.push({ root: rootDir, path: `/${parts.join('/')}`, node: routeNode });
    }
  }

  for (const sec of secondaryRoutes) {
    const table = routesByAppRoot.get(sec.root);
    if (table && !table.exact.has(sec.path)) {
      addRouteTo(table, sec.path, sec.node);
    }
  }

  const generatedTable: SvelteKitTable = {
    source: existingRoutes,
    byRoot: routesByAppRoot,
  };
  tableCache.set(context, generatedTable);
  return generatedTable;
}

/**
 * Identifies the parameter position representing the destination URL for navigation calls.
 * `goto` takes href at index 0, whereas `redirect` takes status first and href at index 1.
 */
export function svelteKitHrefArgument(callName: string): 0 | 1 | null {
  if (callName === 'goto') return 0;
  if (callName === 'redirect') return 1;
  return null;
}

export const svelteKitRouterResolver: FrameworkResolver = {
  name: 'sveltekit-router',
  languages: [...SVELTEKIT_LANGUAGES],

  detect(context: ResolutionContext): boolean {
    return dependsOn(context, '@sveltejs/kit');
  },

  claimsReference(name: string): boolean {
    return NAVIGATION_CALL_PATTERN.test(name);
  },

  resolve(ref: UnresolvedRef, context: ResolutionContext): ResolvedRef | null {
    if (ref.referenceKind !== 'calls') return null;

    const targetArgIndex = svelteKitHrefArgument(ref.referenceName);
    if (targetArgIndex === null) return null;
    if (!SVELTEKIT_LANGUAGES.includes(ref.language)) return null;

    const scopedRoutes = routesForFile(svelteKitTable(context), ref.filePath);
    if (!scopedRoutes || scopedRoutes.exact.size === 0) return null;

    const sourceLines = context.getFileLines?.(ref.filePath) ?? context.readFile(ref.filePath)?.split(/\r?\n/) ?? null;
    if (!sourceLines) return null;

    const rawArgText = nthArgumentText(sourceLines, ref.line, ref.column, ref.referenceName, targetArgIndex);
    if (rawArgText === null) return null;

    let parsedHref = parseHrefExpression(rawArgText);
    if (!parsedHref && targetArgIndex === 0) {
      const parentNode = context.getNodeById?.(ref.fromNodeId);
      const scanStartLine = parentNode && parentNode.filePath === ref.filePath ? parentNode.startLine : Math.max(1, ref.line - 40);
      parsedHref = readHrefViaLocal(sourceLines, ref.line, ref.column, ref.referenceName, scanStartLine);
    }

    if (!parsedHref) return null;

    const destinationMatches = destinationsForHref(parsedHref, scopedRoutes);
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
                navMethod: ref.referenceName,
              },
            })),
          }
        : {}),
      confidence: 0.95,
      resolvedBy: 'framework',
      edgeKind: 'navigates',
      metadata: {
        href: primaryDestination.href.display,
        navMethod: ref.referenceName,
      },
    };
  },
};
