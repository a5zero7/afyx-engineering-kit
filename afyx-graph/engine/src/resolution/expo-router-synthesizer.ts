/**
 * AFYX Engineering Kit - Expo Router Return Helper Synthesizer
 *
 * Bridges navigation calls whose destinations are returned dynamically from helper functions,
 * analyzing helper function bodies for static screen-path literals and synthesizing corresponding `navigates` edges.
 */

import type { Edge, Language, Node } from '../types';
import type { ResolutionContext } from './types';
import type { MaybeYield } from './cooperative-yield';
import { stripCommentsForRegex } from './strip-comments';
import {
  matchRoute,
  normalizeHrefPath,
  readStringAt,
  routeTable,
  stringEnd,
  toHref,
} from './frameworks/expo-router';

const JS_LANGUAGES: ReadonlySet<Language> = new Set(['typescript', 'javascript', 'tsx', 'jsx']);
const JAVASCRIPT_FILE_REGEX = /\.(?:[cm]?[jt]sx?)$/;

const CALL_FED_NAVIGATION_PATTERN =
  /\.(push|replace|navigate|dismissTo)\(\s*(?:await\s+)?([A-Za-z_$][\w$.]*)\s*\(/g;
const MAX_HELPER_SCREENS_BOUND = 8;
const CALLABLE_HELPER_KINDS: ReadonlySet<string> = new Set(['function', 'method']);

interface NavigationInvocationSite {
  file: string;
  line: number;
  method: string;
  callee: string;
}

/**
 * Discovers helper-fed Expo Router navigation calls and synthesizes `navigates` graph edges.
 */
export async function expoRouterReturnEdges(ctx: ResolutionContext, onYield: MaybeYield): Promise<Edge[]> {
  const routerTable = routeTable(ctx);
  if (routerTable.exact.size === 0) return [];

  const invocationSites: NavigationInvocationSite[] = [];
  let fileScanCounter = 0;

  for (const filePath of ctx.getAllFiles()) {
    if (!JAVASCRIPT_FILE_REGEX.test(filePath)) continue;
    if ((++fileScanCounter & 63) === 0) {
      await onYield();
    }

    const fileContent = ctx.readFile(filePath);
    if (!fileContent || !/\.(?:push|replace|navigate|dismissTo)\(/.test(fileContent)) continue;

    const sanitizedContent = stripCommentsForRegex(fileContent, 'typescript');
    CALL_FED_NAVIGATION_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = CALL_FED_NAVIGATION_PATTERN.exec(sanitizedContent)) !== null) {
      const line = sanitizedContent.slice(0, match.index).split('\n').length;
      invocationSites.push({
        file: filePath,
        line,
        method: match[1]!,
        callee: match[2]!,
      });
    }
  }

  if (invocationSites.length === 0) return [];

  const synthesizedEdges: Edge[] = [];
  const registeredEdgeKeys = new Set<string>();
  const screensByHelperNode = new Map<
    string,
    Array<{ node: Node; href: string; line: number; column: number }> | null
  >();

  for (const site of invocationSites) {
    await onYield();
    const helperNode = resolveTargetHelperFunction(site, ctx);
    if (!helperNode) continue;

    let targetScreens = screensByHelperNode.get(helperNode.id);
    if (targetScreens === undefined) {
      targetScreens = extractScreenLiteralsFromBody(helperNode, ctx, routerTable);
      screensByHelperNode.set(helperNode.id, targetScreens);
    }

    if (!targetScreens) continue;

    for (const screenInfo of targetScreens) {
      const edgeKey = `${helperNode.id}>${screenInfo.node.id}`;
      if (registeredEdgeKeys.has(edgeKey)) continue;

      registeredEdgeKeys.add(edgeKey);
      synthesizedEdges.push({
        source: helperNode.id,
        target: screenInfo.node.id,
        kind: 'navigates',
        line: screenInfo.line,
        column: screenInfo.column,
        provenance: 'heuristic',
        metadata: {
          synthesizedBy: 'expo-router-return',
          href: screenInfo.href,
          navMethod: site.method,
          registeredAt: `${site.file}:${site.line}`,
        },
      });
    }
  }

  return synthesizedEdges;
}

function resolveTargetHelperFunction(site: NavigationInvocationSite, ctx: ResolutionContext): Node | null {
  const segments = site.callee.split('.');
  const bareIdentifier = segments[segments.length - 1]!;
  const rootIdentifier = segments[0]!;

  const candidateNodes = ctx
    .getNodesByName(bareIdentifier)
    .filter((n) => CALLABLE_HELPER_KINDS.has(n.kind) && JS_LANGUAGES.has(n.language));

  if (candidateNodes.length === 0) return null;

  const sameFileNodes = candidateNodes.filter((n) => n.filePath === site.file);
  if (sameFileNodes.length === 1) return sameFileNodes[0]!;
  if (sameFileNodes.length > 1) return null;

  const lang: Language = site.file.endsWith('x') ? 'tsx' : 'typescript';
  const importMapping = ctx
    .getImportMappings(site.file, lang)
    .find((im) => im.localName === rootIdentifier || im.localName === bareIdentifier);

  if (importMapping?.resolvedPath) {
    const fromImportedFile = candidateNodes.filter((n) => n.filePath === importMapping.resolvedPath);
    if (fromImportedFile.length === 1) return fromImportedFile[0]!;
  }

  return candidateNodes.length === 1 ? candidateNodes[0]! : null;
}

function extractScreenLiteralsFromBody(
  helper: Node,
  ctx: ResolutionContext,
  table: ReturnType<typeof routeTable>
): Array<{ node: Node; href: string; line: number; column: number }> | null {
  const fileLines = ctx.getFileLines?.(helper.filePath) ?? ctx.readFile(helper.filePath)?.split(/\r?\n/);
  if (!fileLines) return null;

  const bodySlice = stripCommentsForRegex(
    fileLines.slice(helper.startLine - 1, helper.endLine).join('\n'),
    'typescript'
  );

  const arrowIdx = bodySlice.indexOf('=>');
  const braceIdx = bodySlice.indexOf('{');
  const startOffset =
    arrowIdx >= 0 && (braceIdx < 0 || arrowIdx < braceIdx) ? arrowIdx + 2 : braceIdx >= 0 ? braceIdx + 1 : 0;

  const matchedScreens = new Map<string, { node: Node; href: string; line: number; column: number }>();

  for (let idx = startOffset; idx < bodySlice.length; idx++) {
    const ch = bodySlice[idx];
    if (ch !== '"' && ch !== "'" && ch !== '`') continue;

    const tokenStart = idx;
    const literalText = readStringAt(bodySlice, idx);
    idx = stringEnd(bodySlice, idx);

    if (literalText === null || !literalText.startsWith('/')) continue;

    const parsedHref = toHref(literalText);
    if (!parsedHref) continue;

    const normalizedSegments = normalizeHrefPath(parsedHref.path, helper.filePath);
    if (normalizedSegments === null) continue;

    const routeNode = matchRoute(normalizedSegments, table);
    if (!routeNode || matchedScreens.has(routeNode.id)) continue;

    const lineBreakIndex = bodySlice.lastIndexOf('\n', tokenStart - 1) + 1;
    matchedScreens.set(routeNode.id, {
      node: routeNode,
      href: parsedHref.display,
      line: helper.startLine + bodySlice.slice(0, tokenStart).split('\n').length - 1,
      column: tokenStart - lineBreakIndex,
    });

    if (matchedScreens.size > MAX_HELPER_SCREENS_BOUND) return null;
  }

  return matchedScreens.size > 0 ? [...matchedScreens.values()] : null;
}
