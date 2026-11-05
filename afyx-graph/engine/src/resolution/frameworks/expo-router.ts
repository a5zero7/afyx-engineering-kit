/**
 * AFYX Engineering Kit - Expo Router (React Native) Framework Resolver
 *
 * Implements route declaration extraction and navigation edge resolution for Expo Router apps:
 * 1. File-based screen mapping (`app/**`, `src/app/**`) to route nodes
 * 2. Default export binding connecting routes to their rendering screen components
 * 3. Navigation call analysis (`router.push`, `router.replace`, `router.navigate`, etc.)
 * 4. Rich href expression parsing (template literals, Href objects, local variables, ternary forks)
 * 5. Route matching against literal, parameterized, and catch-all routes
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

const ROUTE_LANGUAGES: readonly Language[] = ['typescript', 'javascript', 'tsx', 'jsx'];
const APP_DIRECTORY_PATTERN = /(?:^|\/)(?:src\/)?app\//;
const SCREEN_FILE_EXTENSION_PATTERN = /\.(?:(?:ios|android|native|web)\.)?(tsx|ts|jsx|js|mjs|cjs)$/;

/**
 * Computes canonical route path from an app screen file path.
 */
export function routePathForFile(filePath: string): string | null {
  const appMatch = APP_DIRECTORY_PATTERN.exec(filePath);
  if (!appMatch) return null;

  const relativeSubpath = filePath.slice(appMatch.index + appMatch[0].length);
  const extMatch = SCREEN_FILE_EXTENSION_PATTERN.exec(relativeSubpath);
  if (!extMatch) return null;

  const stem = relativeSubpath.slice(0, extMatch.index);
  if (stem.endsWith('.d') || /\.(?:test|spec|stories)$/.test(stem)) return null;

  const segments = stem.split('/');
  if (segments.includes('__tests__') || segments.includes('__mocks__')) return null;

  const lastSegment = segments[segments.length - 1]!;
  if (lastSegment.startsWith('_')) return null;
  if (lastSegment.startsWith('+') && lastSegment !== '+not-found') return null;

  const visibleSegments = segments.filter((seg) => !(seg.startsWith('(') && seg.endsWith(')')));
  if (visibleSegments[visibleSegments.length - 1] === 'index') {
    visibleSegments.pop();
  }

  return `/${visibleSegments.join('/')}`;
}

function detectScreenLanguage(filePath: string): Language {
  const match = SCREEN_FILE_EXTENSION_PATTERN.exec(filePath)?.[1];
  switch (match) {
    case 'tsx':
      return 'tsx';
    case 'jsx':
      return 'jsx';
    case 'ts':
      return 'typescript';
    default:
      return 'javascript';
  }
}

const IDENTIFIER_CHARACTERS = '[A-Za-z_$][\\w$]*';

/**
 * Extracts default export symbol name from sanitized source text.
 */
export function defaultExportName(strippedContent: string): { name: string; index: number } | null {
  const exportPatterns: RegExp[] = [
    new RegExp(`export\\s+default\\s+(?:async\\s+)?function\\s*\\*?\\s*(${IDENTIFIER_CHARACTERS})`),
    new RegExp(`export\\s+default\\s+class\\s+(${IDENTIFIER_CHARACTERS})`),
    new RegExp(`export\\s+default\\s+(?:${IDENTIFIER_CHARACTERS}\\.)?${IDENTIFIER_CHARACTERS}\\s*\\(\\s*(${IDENTIFIER_CHARACTERS})\\s*[,)]`),
    new RegExp(`export\\s+default\\s+(${IDENTIFIER_CHARACTERS})\\s*;?\\s*$`, 'm'),
    new RegExp(`export\\s*\\{\\s*(${IDENTIFIER_CHARACTERS})\\s+as\\s+default\\s*\\}`),
  ];

  for (const pattern of exportPatterns) {
    const match = pattern.exec(strippedContent);
    if (match && match[1] && match[1] !== 'default') {
      return { name: match[1], index: match.index };
    }
  }

  return null;
}

export const NAV_METHOD = /(?:^|\.)(push|replace|navigate|dismissTo)$|^[a-z][A-Za-z]*(Push|Replace|Navigate)$/;

export function navVerb(name: string): string | null {
  const match = NAV_METHOD.exec(name);
  if (!match) return null;
  return match[1] ?? match[2]!.toLowerCase();
}

const MAXIMUM_CALL_SCAN_LINES = 12;
export const HOLE = '\u0000';

function findClosingParenthesis(str: string, openIndex: number): number {
  let nestingDepth = 0;
  for (let i = openIndex; i < str.length; i++) {
    const char = str[i];
    if (char === '"' || char === "'") {
      const quoteChar = char;
      i++;
      while (i < str.length && str[i] !== quoteChar) {
        if (str[i] === '\\') i++;
        i++;
      }
      continue;
    }
    if (char === '`') {
      i = scanTemplateLiteralEnd(str, i);
      continue;
    }
    if (char === '(') nestingDepth++;
    else if (char === ')') {
      nestingDepth--;
      if (nestingDepth === 0) return i;
    }
  }
  return -1;
}

function scanTemplateLiteralEnd(str: string, openIndex: number): number {
  let idx = openIndex + 1;
  while (idx < str.length) {
    const char = str[idx];
    if (char === '\\') {
      idx += 2;
      continue;
    }
    if (char === '`') return idx;
    if (char === '$' && str[idx + 1] === '{') {
      let braceDepth = 0;
      for (idx = idx + 1; idx < str.length; idx++) {
        if (str[idx] === '{') braceDepth++;
        else if (str[idx] === '}') {
          braceDepth--;
          if (braceDepth === 0) break;
        } else if (str[idx] === '`') {
          idx = scanTemplateLiteralEnd(str, idx);
        }
      }
    }
    idx++;
  }
  return str.length;
}

export function stringEnd(str: string, atIndex: number): number {
  const quote = str[atIndex];
  if (quote === '`') return scanTemplateLiteralEnd(str, atIndex);
  for (let i = atIndex + 1; i < str.length; i++) {
    if (str[i] === '\\') i++;
    else if (str[i] === quote) return i;
  }
  return str.length;
}

export function readStringAt(str: string, atIndex: number): string | null {
  const quote = str[atIndex];
  if (quote === '"' || quote === "'") {
    let result = '';
    for (let i = atIndex + 1; i < str.length; i++) {
      const ch = str[i]!;
      if (ch === '\\') {
        result += str[i + 1] ?? '';
        i++;
        continue;
      }
      if (ch === quote) return result;
      result += ch;
    }
    return null;
  }

  if (quote === '`') {
    const endIndex = scanTemplateLiteralEnd(str, atIndex);
    let result = '';
    for (let i = atIndex + 1; i < endIndex; i++) {
      const ch = str[i]!;
      if (ch === '\\') {
        result += str[i + 1] ?? '';
        i++;
        continue;
      }
      if (ch === '$' && str[i + 1] === '{') {
        let braceNesting = 0;
        for (i = i + 1; i < endIndex; i++) {
          if (str[i] === '{') braceNesting++;
          else if (str[i] === '}') {
            braceNesting--;
            if (braceNesting === 0) break;
          }
        }
        result += HOLE;
        continue;
      }
      result += ch;
    }
    return result;
  }

  return null;
}

export interface HrefLiteral {
  path: string;
  display: string;
  alternates?: HrefLiteral[];
}

export function hrefArms(href: HrefLiteral): HrefLiteral[] {
  return href.alternates?.length ? [href, ...href.alternates] : [href];
}

function findTopLevelCharacter(str: string, targetChar: string, startFrom: number): number {
  let nesting = 0;
  for (let i = startFrom; i < str.length; i++) {
    const c = str[i];
    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      while (i < str.length && str[i] !== quote) {
        if (str[i] === '\\') i++;
        i++;
      }
      continue;
    }
    if (c === '`') {
      i = scanTemplateLiteralEnd(str, i);
      continue;
    }
    if (c === '(' || c === '[' || c === '{') nesting++;
    else if (c === ')' || c === ']' || c === '}') nesting--;
    else if (c === '?' && (str[i + 1] === '.' || str[i + 1] === '?')) i++;
    else if (nesting === 0 && c === targetChar) return i;
  }
  return -1;
}

export function toHref(literal: string | null): HrefLiteral | null {
  if (literal === null || literal.length === 0) return null;
  const queryOrHashPos = literal.search(/[?#]/);
  const pathPart = queryOrHashPos < 0 ? literal : literal.slice(0, queryOrHashPos);
  if (pathPart.length === 0) return null;
  return { path: pathPart, display: literal.split(HOLE).join('${…}') };
}

function locateTernaryColon(str: string, questionMarkPos: number): number {
  let depth = 0;
  let curr = questionMarkPos + 1;
  for (let step = 0; step < 64; step++) {
    const nextQ = findTopLevelCharacter(str, '?', curr);
    const nextColon = findTopLevelCharacter(str, ':', curr);
    if (nextColon < 0) return -1;
    if (nextQ >= 0 && nextQ < nextColon) {
      depth++;
      curr = nextQ + 1;
      continue;
    }
    if (depth === 0) return nextColon;
    depth--;
    curr = nextColon + 1;
  }
  return -1;
}

export function parseHrefExpression(expr: string): HrefLiteral | null {
  let rawExpression = expr.trim().replace(/\s+(?:as|satisfies)\s+[\w$.<>[\]|&\s]+$/, '');

  while (rawExpression.startsWith('(') && findClosingParenthesis(rawExpression, 0) === rawExpression.length - 1) {
    rawExpression = rawExpression.slice(1, -1).trim().replace(/\s+(?:as|satisfies)\s+[\w$.<>[\]|&\s]+$/, '');
  }

  if (rawExpression.length === 0) return null;

  const questionIndex = findTopLevelCharacter(rawExpression, '?', 0);
  if (questionIndex > 0) {
    const colonIndex = locateTernaryColon(rawExpression, questionIndex);
    if (colonIndex > questionIndex) {
      const positiveArm = parseHrefExpression(rawExpression.slice(questionIndex + 1, colonIndex));
      const negativeArm = parseHrefExpression(rawExpression.slice(colonIndex + 1));
      const collectedArms = [
        ...(positiveArm ? hrefArms(positiveArm) : []),
        ...(negativeArm ? hrefArms(negativeArm) : []),
      ];

      const primary = collectedArms[0];
      if (!primary) return null;

      const remaining = collectedArms.slice(1);
      return remaining.length
        ? { path: primary.path, display: primary.display, alternates: remaining }
        : { path: primary.path, display: primary.display };
    }
  }

  if (rawExpression[0] === '{') {
    const pathnameMatch = /\bpathname\s*:\s*/.exec(rawExpression);
    return pathnameMatch ? toHref(readStringAt(rawExpression, pathnameMatch.index + pathnameMatch[0].length)) : null;
  }

  return toHref(readStringAt(rawExpression, 0));
}

export function readHrefArgument(
  lines: readonly string[],
  line: number,
  column: number,
  method: string
): HrefLiteral | null {
  const rawArg = firstArgumentText(lines, line, column, method);
  return rawArg === null ? null : parseHrefExpression(rawArg);
}

export function firstArgumentText(
  lines: readonly string[],
  line: number,
  column: number,
  method: string
): string | null {
  return nthArgumentText(lines, line, column, method, 0);
}

export function nthArgumentText(
  lines: readonly string[],
  line: number,
  column: number,
  method: string,
  index: number
): string | null {
  const lineZeroBased = line - 1;
  if (lineZeroBased < 0 || lineZeroBased >= lines.length) return null;

  const windowText = lines.slice(lineZeroBased, lineZeroBased + MAXIMUM_CALL_SCAN_LINES).join('\n');
  const methodOffset = windowText.indexOf(method, Math.max(0, column));
  if (methodOffset < 0) return null;

  let openIndex = methodOffset + method.length;
  while (openIndex < windowText.length && /\s/.test(windowText[openIndex]!)) openIndex++;
  if (windowText[openIndex] !== '(') return null;

  const closeIndex = findClosingParenthesis(windowText, openIndex);
  let argumentsText = windowText.slice(openIndex + 1, closeIndex < 0 ? undefined : closeIndex);

  for (let i = 0; i < index; i++) {
    const commaIndex = findTopLevelCharacter(argumentsText, ',', 0);
    if (commaIndex < 0) return null;
    argumentsText = argumentsText.slice(commaIndex + 1);
  }

  const separatorIndex = findTopLevelCharacter(argumentsText, ',', 0);
  return separatorIndex < 0 ? argumentsText : argumentsText.slice(0, separatorIndex);
}

const TYPE_ASSERTION_PATTERN = /\s+(?:as|satisfies)\s+[\w$.<>[\]|&\s]+$/;
const CONTINUATION_LINE_PATTERN = /^[?:.)\]}`'"+&|]/;

export function readHrefViaLocal(
  lines: readonly string[],
  line: number,
  column: number,
  method: string,
  enclosingStart: number
): HrefLiteral | null {
  const argText = firstArgumentText(lines, line, column, method);
  if (argText === null) return null;

  const identifier = argText.trim().replace(TYPE_ASSERTION_PATTERN, '');
  if (!/^[A-Za-z_$][\w$]*$/.test(identifier)) return null;

  const escapedName = identifier.replace(/\$/g, '\\$');
  const declarationPattern = new RegExp(`\\b(?:const|let|var)\\s+${escapedName}\\s*(?::[^=]*?)?=(?!=)`);
  const reassignmentPattern = new RegExp(`(?:^|[^.\\w$])${escapedName}\\s*=(?!=)`);
  const lowerBoundary = Math.max(0, enclosingStart - 1);

  for (let i = line - 2; i >= lowerBoundary; i--) {
    const currentLine = lines[i]!;
    const match = declarationPattern.exec(currentLine);
    if (!match) {
      if (reassignmentPattern.test(currentLine)) return null;
      continue;
    }

    let initializer = currentLine.slice(match.index + match[0].length);
    for (let j = i + 1; j < line - 1 && j < i + MAXIMUM_CALL_SCAN_LINES; j++) {
      const nextLine = lines[j]!;
      if (!CONTINUATION_LINE_PATTERN.test(nextLine.trimStart()) && areBracketsBalanced(initializer)) {
        break;
      }
      initializer += '\n' + nextLine;
    }

    return parseHrefExpression(initializer);
  }

  return null;
}

function areBracketsBalanced(str: string): boolean {
  let nesting = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (c === '"' || c === "'" || c === '`') {
      const end = stringEnd(str, i);
      if (end >= str.length) return false;
      i = end;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') nesting++;
    else if (c === ')' || c === ']' || c === '}') nesting--;
  }
  return nesting <= 0;
}

export interface RootedRouteTable<T extends RouteTable = RouteTable> {
  source: readonly Node[];
  byRoot: Map<string, T>;
}

export function routesForFile<T extends RouteTable>(table: RootedRouteTable<T>, filePath: string): T | null {
  let matchedRoutes: T | null = null;
  let maxPrefixLength = -1;

  for (const [rootPath, routeSet] of table.byRoot) {
    if (rootPath.length > maxPrefixLength && filePath.startsWith(rootPath)) {
      matchedRoutes = routeSet;
      maxPrefixLength = rootPath.length;
    }
  }

  return matchedRoutes;
}

export function addRouteTo(table: RouteTable, path: string, node: Node): void {
  if (!table.exact.has(path)) {
    table.exact.set(path, node);
  }
  if (path.includes(':')) {
    table.dynamic.push({ node, segs: path.split('/').slice(1) });
  }
}

export function appRootFor(filePath: string): string {
  const match = /^((?:[^/]+\/)*?)(?:src|pages|app|routes)\//.exec(filePath);
  if (match) return match[1]!;

  const lastSlashIndex = filePath.lastIndexOf('/');
  return lastSlashIndex < 0 ? '' : filePath.slice(0, lastSlashIndex + 1);
}

interface RouteEntry {
  node: Node;
  segs: string[];
}

export interface RouteTable {
  source: readonly Node[];
  exact: Map<string, Node>;
  dynamic: RouteEntry[];
}

const tableRegistry = new Map<string, RouteTable>();

export function routeTable(context: ResolutionContext): RouteTable {
  const existingRoutes = context.getNodesByKind('route');
  const projectKey = context.getProjectRoot();
  const cachedInstance = tableRegistry.get(projectKey);

  if (cachedInstance && cachedInstance.source === existingRoutes) {
    return cachedInstance;
  }

  const exactMap = new Map<string, Node>();
  const dynamicRoutes: RouteEntry[] = [];

  for (const node of existingRoutes) {
    if (routePathForFile(node.filePath) !== node.name) continue;
    exactMap.set(node.name, node);
    if (node.name.includes('[')) {
      dynamicRoutes.push({ node, segs: node.name.split('/').slice(1) });
    }
  }

  const generatedTable: RouteTable = {
    source: existingRoutes,
    exact: exactMap,
    dynamic: dynamicRoutes,
  };

  tableRegistry.set(projectKey, generatedTable);
  return generatedTable;
}

export function normalizeHrefPath(path: string, fromFile: string): string[] | null {
  let targetPath = path;

  if (!targetPath.startsWith('/')) {
    if (routePathForFile(fromFile) === null) return null;

    const directoryIndexRoute = routePathForFile(
      fromFile.slice(0, fromFile.lastIndexOf('/') + 1) + 'index.tsx'
    );
    if (directoryIndexRoute === null) return null;

    const parentSegments = directoryIndexRoute.split('/').slice(1);
    if (targetPath.startsWith('./')) {
      targetPath = `/${[...parentSegments, targetPath.slice(2)].join('/')}`;
    } else if (targetPath.startsWith('../')) {
      const parentStack = [...parentSegments];
      while (targetPath.startsWith('../')) {
        parentStack.pop();
        targetPath = targetPath.slice(3);
      }
      targetPath = `/${[...parentStack, targetPath].join('/')}`;
    } else {
      targetPath = `/${[...parentSegments, targetPath].join('/')}`;
    }
  }

  return targetPath
    .split('/')
    .slice(1)
    .filter((s) => s.length > 0 && !(s.startsWith('(') && s.endsWith(')')))
    .map((s) => (s.includes(HOLE) ? '*' : safeDecodeSegment(s)));
}

function safeDecodeSegment(seg: string): string {
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

export function matchRoute(segments: string[], table: RouteTable): Node | null {
  const exactMatch = table.exact.get(`/${segments.join('/')}`);
  if (exactMatch) return exactMatch;

  let optimalCandidate: { node: Node; score: number } | null = null;
  let isTie = false;

  for (const dynamicRoute of table.dynamic) {
    const computedScore = scoreDynamicRouteMatch(segments, dynamicRoute.segs);
    if (computedScore === null) continue;

    if (optimalCandidate === null || computedScore > optimalCandidate.score) {
      optimalCandidate = { node: dynamicRoute.node, score: computedScore };
      isTie = false;
    } else if (computedScore === optimalCandidate.score) {
      isTie = true;
    }
  }

  return optimalCandidate && !isTie ? optimalCandidate.node : null;
}

function isParameterSegment(segment: string): boolean {
  return (segment.startsWith('[') && segment.endsWith(']')) || (segment.startsWith(':') && !segment.endsWith('*'));
}

function isWildcardCatchAll(segment: string): boolean {
  return (segment.startsWith('[...') && segment.endsWith(']')) || (segment.startsWith(':') && segment.endsWith('*'));
}

function scoreDynamicRouteMatch(hrefSegments: string[], routeSegments: string[]): number | null {
  let score = 0;
  let hrefIdx = 0;

  for (let r = 0; r < routeSegments.length; r++) {
    const rSeg = routeSegments[r]!;
    if (isWildcardCatchAll(rSeg)) {
      if (hrefIdx >= hrefSegments.length) return null;
      score += hrefSegments.length - hrefIdx;
      hrefIdx = hrefSegments.length;
      continue;
    }

    if (hrefIdx >= hrefSegments.length) return null;

    const hSeg = hrefSegments[hrefIdx]!;
    if (isParameterSegment(rSeg)) {
      score += 2;
    } else if (hSeg === rSeg) {
      score += 3;
    } else if (hSeg === '*') {
      score += 1;
    } else {
      return null;
    }

    hrefIdx++;
  }

  return hrefIdx === hrefSegments.length ? score : null;
}

export const expoRouterResolver: FrameworkResolver = {
  name: 'expo-router',
  languages: [...ROUTE_LANGUAGES],

  detect(context: ResolutionContext): boolean {
    if (dependsOn(context, 'expo-router')) return true;

    const files = context.getAllFiles();
    const hasLayout = files.some((f) => /(?:^|\/)(?:src\/)?app\/_layout\.(?:tsx|jsx|ts|js)$/.test(f));
    const hasExpoConfig = files.some((f) => /^app\.(?:json|config\.(?:js|ts))$/.test(f));
    return hasLayout && hasExpoConfig;
  },

  claimsReference(name: string): boolean {
    return NAV_METHOD.test(name);
  },

  extract(filePath: string, content: string) {
    const routeUri = routePathForFile(filePath);
    if (routeUri === null) return { nodes: [], references: [] };

    const detectedLang = detectScreenLanguage(filePath);
    const node: Node = {
      id: `route:${filePath}:${routeUri}`,
      kind: 'route',
      name: routeUri,
      qualifiedName: `${filePath}::route:${routeUri}`,
      filePath,
      startLine: 1,
      endLine: 1,
      startColumn: 0,
      endColumn: 0,
      language: detectedLang,
      isExported: true,
      updatedAt: Date.now(),
    };

    const references: UnresolvedRef[] = [];
    const strippedContent = stripCommentsForRegex(content, 'typescript');
    const screenExport = defaultExportName(strippedContent);

    if (screenExport) {
      references.push({
        fromNodeId: node.id,
        referenceName: screenExport.name,
        referenceKind: 'calls',
        line: strippedContent.slice(0, screenExport.index).split('\n').length,
        column: 0,
        filePath,
        language: detectedLang,
        candidates: [screenExport.name],
      });
    }

    return { nodes: [node], references };
  },

  resolve(ref: UnresolvedRef, context: ResolutionContext): ResolvedRef | null {
    if (ref.referenceKind !== 'calls') return null;

    const methodVerb = navVerb(ref.referenceName);
    if (!methodVerb) return null;
    if (!ROUTE_LANGUAGES.includes(ref.language)) return null;

    const callee = ref.referenceName.slice(ref.referenceName.lastIndexOf('.') + 1);
    const lines = context.getFileLines?.(ref.filePath) ?? context.readFile(ref.filePath)?.split(/\r?\n/) ?? null;
    if (!lines) return null;

    let targetHref = readHrefArgument(lines, ref.line, ref.column, callee);
    if (!targetHref) {
      const parentNode = context.getNodeById?.(ref.fromNodeId);
      const scanStart = parentNode && parentNode.filePath === ref.filePath ? parentNode.startLine : Math.max(1, ref.line - 40);
      targetHref = readHrefViaLocal(lines, ref.line, ref.column, callee, scanStart);
    }

    if (!targetHref) return null;

    const activeTable = routeTable(context);
    const reachedTargets: Node[] = [];
    const visitedTargetIds = new Set<string>();

    for (const candidateArm of hrefArms(targetHref)) {
      const normalizedParts = normalizeHrefPath(candidateArm.path, ref.filePath);
      if (normalizedParts === null) continue;

      const matchedNode = matchRoute(normalizedParts, activeTable);
      if (!matchedNode || visitedTargetIds.has(matchedNode.id)) continue;

      visitedTargetIds.add(matchedNode.id);
      reachedTargets.push(matchedNode);
    }

    const primaryTarget = reachedTargets[0];
    if (!primaryTarget) return null;

    return {
      original: ref,
      targetNodeId: primaryTarget.id,
      ...(reachedTargets.length > 1
        ? {
            alsoTargets: reachedTargets.slice(1).map((t) => ({
              targetNodeId: t.id,
              metadata: {
                href: targetHref.display,
                navMethod: methodVerb,
              },
            })),
          }
        : {}),
      confidence: 0.95,
      resolvedBy: 'framework',
      edgeKind: 'navigates',
      metadata: {
        href: targetHref.display,
        navMethod: methodVerb,
        ...(callee !== methodVerb ? { via: callee } : {}),
      },
    };
  },
};
