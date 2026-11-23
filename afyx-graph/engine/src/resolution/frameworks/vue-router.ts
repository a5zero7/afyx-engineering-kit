/**
 * AFYX Engineering Kit - Vue Router Resolver
 *
 * Resolves routing declarations and navigation invocations in Vue / Nuxt applications.
 * Handles route arrays (`createRouter`, `new VueRouter`, `routes = [...]`),
 * component binding for routes, and navigation via named routes (`router.push({ name: '...' })`)
 * or path specifications (`router.push('/...')`, `navigateTo(...)`).
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
import { matchBracket, readFields, topLevelObjects } from './object-literal';
import { dependsOn } from './package-deps';
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

const VUE_SUPPORTED_LANGUAGES: readonly Language[] = ['typescript', 'javascript', 'vue'];

export interface VueRouteEntry {
  path: string;
  name: string | null;
  component: string | null;
  line: number;
}

const ROUTER_CREATION_REGEX =
  /\b(?:createRouter|createWebHistory|createWebHashHistory|createMemoryHistory)\s*\(|\bnew\s+VueRouter\s*\(/;
const ROUTE_ARRAY_ASSIGNMENT_REGEX = /\broutes\s*[:=]\s*\[/;

/**
 * Parses Vue Router route configuration objects from file source text.
 */
export function parseVueRoutes(sourceContent: string): VueRouteEntry[] {
  if (!ROUTER_CREATION_REGEX.test(sourceContent) && !ROUTE_ARRAY_ASSIGNMENT_REGEX.test(sourceContent)) {
    return [];
  }

  const sanitized = stripCommentsForRegex(sourceContent, 'typescript');
  const routeEntries: VueRouteEntry[] = [];
  const registeredEntries = new Set<string>();

  const arrayPatterns = /\broutes\s*[:=]\s*\[/g;
  let match: RegExpExecArray | null;

  while ((match = arrayPatterns.exec(sanitized)) !== null) {
    const openingBracketPos = match.index + match[0].length - 1;
    const closingBracketPos = matchBracket(sanitized, openingBracketPos);
    if (closingBracketPos < 0) continue;

    for (const objRange of topLevelObjects(sanitized, openingBracketPos + 1, closingBracketPos)) {
      const fieldMap = readFields(sanitized, objRange.start, objRange.end);
      const pathEntry = fieldMap.get('path');
      if (!pathEntry) continue;

      const pathValue = readStringAt(pathEntry.text.trimStart(), 0);
      if (pathValue === null || !pathValue.startsWith('/')) continue;

      const compEntry = fieldMap.get('component') ?? fieldMap.get('components');
      if (!compEntry) continue;

      const targetComponentName = extractComponentNameFromField(compEntry.text);
      if (!targetComponentName) continue;

      const nameEntry = fieldMap.get('name');
      const explicitName = nameEntry ? readStringAt(nameEntry.text.trimStart(), 0) : null;
      const declarationLine = sanitized.slice(0, pathEntry.at).split('\n').length;

      const deduplicationKey = `${pathValue}#${explicitName ?? ''}`;
      if (registeredEntries.has(deduplicationKey)) continue;

      registeredEntries.add(deduplicationKey);
      routeEntries.push({
        path: pathValue,
        name: explicitName,
        component: targetComponentName,
        line: declarationLine,
      });
    }

    arrayPatterns.lastIndex = closingBracketPos;
  }

  return routeEntries;
}

/**
 * Extracts component name from either a direct identifier or a dynamic import.
 */
function extractComponentNameFromField(fieldExpression: string): string | null {
  const dynamicImportMatch = /\bimport\s*\(\s*['"`]([^'"`]+)['"`]/.exec(fieldExpression);
  if (dynamicImportMatch) {
    const rawSpecifier = dynamicImportMatch[1]!;
    const fileBasename = rawSpecifier.split('/').pop() ?? '';
    return fileBasename.replace(/\.\w+$/, '') || null;
  }

  const directIdentifierMatch = /^\s*([A-Z][A-Za-z0-9_]*)\s*$/.exec(fieldExpression);
  return directIdentifierMatch?.[1] ?? null;
}

function detectFileLanguage(filePath: string): Language {
  if (filePath.endsWith('.vue')) return 'vue';
  if (/\.(?:ts|mts|cts)$/.test(filePath)) return 'typescript';
  return 'javascript';
}

function formatVueRouteId(filePath: string, line: number, path: string): string {
  return `route:${filePath}:${line}:${path}:vue`;
}

export interface VueAppRoutes extends RouteTable {
  byName: Map<string, Node>;
}

export type VueRouteTable = RootedRouteTable<VueAppRoutes>;

function isConfigGeneratedVueRoute(node: Node): boolean {
  return node.id === formatVueRouteId(node.filePath, node.startLine, node.name);
}

function isNuxtPageRoute(node: Node): boolean {
  return (
    node.language === 'vue' &&
    node.filePath.includes('/pages/') &&
    node.id === `route:${node.filePath}:${node.name}:1`
  );
}

const vueTableCache = new WeakMap<ResolutionContext, VueRouteTable>();

/**
 * Builds or retrieves the cached Vue route table.
 */
export function vueRouteTable(context: ResolutionContext): VueRouteTable {
  const availableRoutes = context.getNodesByKind('route');
  const cachedInstance = vueTableCache.get(context);
  if (cachedInstance && cachedInstance.source === availableRoutes) {
    return cachedInstance;
  }

  const routesByAppRoot = new Map<string, VueAppRoutes>();
  const configFilesToReparse = new Map<string, { root: string; nodes: Node[] }>();

  const getOrCreateRouteTable = (rootPath: string): VueAppRoutes => {
    let appTable = routesByAppRoot.get(rootPath);
    if (!appTable) {
      appTable = {
        source: availableRoutes,
        exact: new Map(),
        dynamic: [],
        byName: new Map(),
      };
      routesByAppRoot.set(rootPath, appTable);
    }
    return appTable;
  };

  for (const routeNode of availableRoutes) {
    const isConfigRoute = isConfigGeneratedVueRoute(routeNode);
    if (!isConfigRoute && !isNuxtPageRoute(routeNode)) continue;
    if (!routeNode.name.startsWith('/')) continue;

    const rootDir = appRootFor(routeNode.filePath);
    const targetTable = getOrCreateRouteTable(rootDir);
    addRouteTo(targetTable, routeNode.name, routeNode);

    if (isConfigRoute) {
      const existingRecord = configFilesToReparse.get(routeNode.filePath);
      if (existingRecord) {
        existingRecord.nodes.push(routeNode);
      } else {
        configFilesToReparse.set(routeNode.filePath, { root: rootDir, nodes: [routeNode] });
      }
    }
  }

  for (const [filePath, metadata] of configFilesToReparse) {
    const fileSource = context.readFile(filePath);
    if (!fileSource) continue;

    const namesMap = getOrCreateRouteTable(metadata.root).byName;
    const nodesByPath = new Map(metadata.nodes.map((n) => [n.name, n]));

    for (const routeEntry of parseVueRoutes(fileSource)) {
      if (!routeEntry.name) continue;
      const matchingNode = nodesByPath.get(routeEntry.path);
      if (matchingNode && !namesMap.has(routeEntry.name)) {
        namesMap.set(routeEntry.name, matchingNode);
      }
    }
  }

  const tableResult: VueRouteTable = { source: availableRoutes, byRoot: routesByAppRoot };
  vueTableCache.set(context, tableResult);
  return tableResult;
}

const VUE_NAVIGATION_CALL_REGEX = /^\$?router\.(?:push|replace)$|^navigateTo$/;

export function vueNavVerb(name: string): string | null {
  if (!VUE_NAVIGATION_CALL_REGEX.test(name)) return null;
  const dotIndex = name.lastIndexOf('.');
  return dotIndex < 0 ? name : name.slice(dotIndex + 1);
}

export function routeNameInExpression(expr: string): string | null {
  const trimmed = expr.trim();
  if (trimmed[0] !== '{') return null;
  const namePropertyMatch = /\bname\s*:\s*['"`]/.exec(trimmed);
  if (!namePropertyMatch) return null;
  return readStringAt(trimmed, namePropertyMatch.index + namePropertyMatch[0].length - 1);
}

export function parseVuePathObject(expr: string): HrefLiteral | null {
  const trimmed = expr.trim();
  if (trimmed[0] !== '{') return null;
  const pathPropertyMatch = /\bpath\s*:\s*['"`]/.exec(trimmed);
  if (!pathPropertyMatch) return null;
  return toHref(readStringAt(trimmed, pathPropertyMatch.index + pathPropertyMatch[0].length - 1));
}

function isVueRouteGeneratedRef(ref: UnresolvedRef): boolean {
  return ref.fromNodeId.startsWith('route:') && ref.fromNodeId.endsWith(':vue');
}

function resolveVueComponentByName(name: string, callingFilePath: string, ctx: ResolutionContext): Node | null {
  const matchingCandidates = ctx
    .getNodesByName(name)
    .filter((cand) => cand.kind === 'component' || (cand.kind === 'function' && cand.filePath.endsWith('.vue')));

  if (matchingCandidates.length === 0) return null;
  if (matchingCandidates.length === 1) return matchingCandidates[0]!;

  const appRoot = appRootFor(callingFilePath);
  const localCandidates = matchingCandidates.filter((cand) => cand.filePath.startsWith(appRoot));
  return localCandidates.length === 1 ? localCandidates[0]! : null;
}

export const vueRouterResolver: FrameworkResolver = {
  name: 'vue-router',
  languages: [...VUE_SUPPORTED_LANGUAGES],

  detect(context: ResolutionContext): boolean {
    return dependsOn(context, 'vue-router', 'nuxt', 'nuxt3');
  },

  claimsReference(name: string): boolean {
    return VUE_NAVIGATION_CALL_REGEX.test(name);
  },

  extract(filePath: string, content: string): FrameworkExtractionResult {
    const routeEntries = parseVueRoutes(content);
    if (routeEntries.length === 0) return { nodes: [], references: [] };

    const detectedLang = detectFileLanguage(filePath);
    const timestamp = Date.now();
    const createdNodes: Node[] = [];
    const createdReferences: UnresolvedRef[] = [];

    for (const entry of routeEntries) {
      const nodeInstance: Node = {
        id: formatVueRouteId(filePath, entry.line, entry.path),
        kind: 'route',
        name: entry.path,
        qualifiedName: `${filePath}::route:${entry.path}`,
        filePath,
        startLine: entry.line,
        endLine: entry.line,
        startColumn: 0,
        endColumn: 0,
        language: detectedLang,
        updatedAt: timestamp,
      };
      createdNodes.push(nodeInstance);

      if (entry.component) {
        createdReferences.push({
          fromNodeId: nodeInstance.id,
          referenceName: entry.component,
          referenceKind: 'calls',
          line: entry.line,
          column: 0,
          filePath,
          language: detectedLang,
          candidates: [entry.component],
        });
      }
    }

    return { nodes: createdNodes, references: createdReferences };
  },

  resolve(ref: UnresolvedRef, context: ResolutionContext): ResolvedRef | null {
    if (ref.referenceKind !== 'calls') return null;

    if (isVueRouteGeneratedRef(ref)) {
      const boundComponent = resolveVueComponentByName(ref.referenceName, ref.filePath, context);
      return boundComponent
        ? {
            original: ref,
            targetNodeId: boundComponent.id,
            confidence: 0.95,
            resolvedBy: 'framework',
          }
        : null;
    }

    const navigationVerb = vueNavVerb(ref.referenceName);
    if (!navigationVerb) return null;
    if (!VUE_SUPPORTED_LANGUAGES.includes(ref.language)) return null;

    const scopedRoutes = routesForFile(vueRouteTable(context), ref.filePath);
    if (!scopedRoutes || scopedRoutes.exact.size === 0) return null;

    const sourceLines = context.getFileLines?.(ref.filePath) ?? context.readFile(ref.filePath)?.split(/\r?\n/) ?? null;
    if (!sourceLines) return null;

    const argumentText = firstArgumentText(sourceLines, ref.line, ref.column, navigationVerb);
    if (argumentText === null) return null;

    const targetRouteName = routeNameInExpression(argumentText);
    if (targetRouteName !== null) {
      const namedRouteNode = scopedRoutes.byName.get(targetRouteName);
      return namedRouteNode
        ? {
            original: ref,
            targetNodeId: namedRouteNode.id,
            confidence: 0.95,
            resolvedBy: 'framework',
            edgeKind: 'navigates',
            metadata: {
              href: targetRouteName,
              navMethod: navigationVerb,
              by: 'name',
            },
          }
        : null;
    }

    let parsedHref = parseHrefExpression(argumentText) ?? parseVuePathObject(argumentText);
    if (!parsedHref) {
      const parentNode = context.getNodeById?.(ref.fromNodeId);
      const scanStartLine = parentNode && parentNode.filePath === ref.filePath ? parentNode.startLine : Math.max(1, ref.line - 40);
      parsedHref = readHrefViaLocal(sourceLines, ref.line, ref.column, navigationVerb, scanStartLine);
    }

    if (!parsedHref) return null;

    const targetDestinations = destinationsForHref(parsedHref, scopedRoutes);
    const primaryDestination = targetDestinations[0];
    if (!primaryDestination) return null;

    return {
      original: ref,
      targetNodeId: primaryDestination.node.id,
      ...(targetDestinations.length > 1
        ? {
            alsoTargets: targetDestinations.slice(1).map((dest) => ({
              targetNodeId: dest.node.id,
              metadata: {
                href: dest.href.display,
                navMethod: navigationVerb,
              },
            })),
          }
        : {}),
      confidence: 0.95,
      resolvedBy: 'framework',
      edgeKind: 'navigates',
      metadata: {
        href: primaryDestination.href.display,
        navMethod: navigationVerb,
      },
    };
  },
};
