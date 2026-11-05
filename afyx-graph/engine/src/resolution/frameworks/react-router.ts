/**
 * AFYX Engineering Kit - React Router Resolver
 *
 * Implements navigation edge resolution for React Router applications across versions 5 and 6+.
 * Connects programmatic navigations (`history.push`, `history.replace`, `navigate`, `redirect`)
 * with extracted React Router `<Route>` components, synthesizing `navigates` graph edges.
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
  firstArgumentText,
  parseHrefExpression,
  readHrefViaLocal,
  routesForFile,
  type RootedRouteTable,
  type RouteTable,
} from './expo-router';
import { destinationsForHref } from './nextjs';

const ROUTE_LANGUAGES: readonly Language[] = ['typescript', 'javascript', 'tsx', 'jsx'];

export type ReactRouterTable = RootedRouteTable;
export const reactRouterRoot = appRootFor;

function isReactRouterRouteNode(node: Node): boolean {
  return (
    (node.language === 'tsx' || node.language === 'jsx') &&
    node.id === `route:${node.filePath}:${node.startLine}:${node.name}`
  );
}

function isOptionalRouteParameter(segment: string): boolean {
  return segment.startsWith(':') && segment.endsWith('?');
}

const tableCache = new WeakMap<ResolutionContext, ReactRouterTable>();

export function reactRouterTable(context: ResolutionContext): ReactRouterTable {
  const allRouteNodes = context.getNodesByKind('route');
  const cachedInstance = tableCache.get(context);
  if (cachedInstance && cachedInstance.source === allRouteNodes) {
    return cachedInstance;
  }

  const routesByRoot = new Map<string, RouteTable>();
  const shortenedVariants: Array<{ root: string; path: string; node: Node }> = [];

  const getOrCreateTable = (root: string): RouteTable => {
    let t = routesByRoot.get(root);
    if (!t) {
      t = { source: allRouteNodes, exact: new Map(), dynamic: [] };
      routesByRoot.set(root, t);
    }
    return t;
  };

  for (const node of allRouteNodes) {
    if (!isReactRouterRouteNode(node)) continue;
    if (!node.name.startsWith('/') || node.name.endsWith('*')) continue;

    const rootDir = reactRouterRoot(node.filePath);
    const normalizedPath = node.name.length > 1 && node.name.endsWith('/') ? node.name.slice(0, -1) : node.name;
    addRouteTo(getOrCreateTable(rootDir), normalizedPath, node);

    let parts = normalizedPath.split('/').slice(1);
    while (parts.length > 1 && isOptionalRouteParameter(parts[parts.length - 1]!)) {
      parts = parts.slice(0, -1);
      shortenedVariants.push({ root: rootDir, path: `/${parts.join('/')}`, node });
    }
  }

  for (const variant of shortenedVariants) {
    const table = routesByRoot.get(variant.root);
    if (table && !table.exact.has(variant.path)) {
      addRouteTo(table, variant.path, variant.node);
    }
  }

  const generatedTable: ReactRouterTable = { source: allRouteNodes, byRoot: routesByRoot };
  tableCache.set(context, generatedTable);
  return generatedTable;
}

const NAVIGATION_INVOCATION_REGEX =
  /^(?:history|navigate|router)\.(?:push|replace|navigate)$|^(?:navigate|redirect)$/;

export function reactRouterNavVerb(name: string): string | null {
  if (!NAVIGATION_INVOCATION_REGEX.test(name)) return null;
  const dotIndex = name.lastIndexOf('.');
  return dotIndex < 0 ? name : name.slice(dotIndex + 1);
}

export const reactRouterResolver: FrameworkResolver = {
  name: 'react-router',
  languages: [...ROUTE_LANGUAGES],

  detect(context: ResolutionContext): boolean {
    return dependsOn(context, 'react-router', 'react-router-dom', 'react-router-native');
  },

  claimsReference(name: string): boolean {
    return NAVIGATION_INVOCATION_REGEX.test(name);
  },

  resolve(ref: UnresolvedRef, context: ResolutionContext): ResolvedRef | null {
    if (ref.referenceKind !== 'calls') return null;

    const actionVerb = reactRouterNavVerb(ref.referenceName);
    if (!actionVerb) return null;
    if (!ROUTE_LANGUAGES.includes(ref.language)) return null;

    const activeRoutes = routesForFile(reactRouterTable(context), ref.filePath);
    if (!activeRoutes || activeRoutes.exact.size === 0) return null;

    const sourceLines = context.getFileLines?.(ref.filePath) ?? context.readFile(ref.filePath)?.split(/\r?\n/) ?? null;
    if (!sourceLines) return null;

    const argumentString = firstArgumentText(sourceLines, ref.line, ref.column, actionVerb);
    if (argumentString === null) return null;

    let targetHref = parseHrefExpression(argumentString);
    if (!targetHref) {
      const parentNode = context.getNodeById?.(ref.fromNodeId);
      const scanStart = parentNode && parentNode.filePath === ref.filePath ? parentNode.startLine : Math.max(1, ref.line - 40);
      targetHref = readHrefViaLocal(sourceLines, ref.line, ref.column, actionVerb, scanStart);
    }

    if (!targetHref) return null;

    const destinationMatches = destinationsForHref(targetHref, activeRoutes);
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
