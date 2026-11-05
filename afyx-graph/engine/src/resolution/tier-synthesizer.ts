/**
 * AFYX Engineering Kit - Cross-Tier Channel Synthesizer
 *
 * Infers and synthesizes cross-tier communication edges across distributed web and service architectures:
 * 1. HTTP Client calls (fetch, axios, ky, got, ofetch, useSWR, useFetch) -> Route nodes
 * 2. Message and job queues (Bull, BullMQ, NestJS @Processor/@Process) -> Job workers
 * 3. Event buses & WebSockets (EventEmitter, NestJS @OnEvent, Socket.IO, WS @SubscribeMessage) -> Event consumers
 */

import type { Edge, Language, Node } from '../types';
import type { ResolutionContext } from './types';
import type { MaybeYield } from './cooperative-yield';
import { stripCommentsForRegex } from './strip-comments';
import { resolveImportPath } from './import-resolver';
import { isGeneratedFile } from '../extraction/generated-detection';
import { isTestPath } from '../search/query-utils';
import { HOLE, readStringAt } from './frameworks/expo-router';
import { enclosingFn, enclosingValue, makeLineAt } from './synth-utils';

const JS_TS_EXTENSION = /\.(?:[cm]?[jt]sx?)$/;
const FANOUT_LIMIT = 6;
const SUPPORTED_HTTP_METHODS: ReadonlySet<string> = new Set([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
  'ALL',
  'ANY',
]);

export const TIER_CLIENT_TO_SERVER = 'client→server';
export const TIER_SERVER_TO_CLIENT = 'server→client';

/* -------------------------------------------------------- AST String Helpers -- */

function scanClosingParen(str: string, startIndex: number): number {
  let nesting = 0;
  for (let idx = startIndex; idx < str.length; idx++) {
    const ch = str[idx];
    if (ch === '"' || ch === "'") {
      const quoteChar = ch;
      idx++;
      while (idx < str.length && str[idx] !== quoteChar) {
        if (str[idx] === '\\') idx++;
        idx++;
      }
      continue;
    }
    if (ch === '`') {
      idx = scanTemplateBoundary(str, idx);
      continue;
    }
    if (ch === '(') {
      nesting++;
    } else if (ch === ')') {
      nesting--;
      if (nesting === 0) return idx;
    }
  }
  return -1;
}

function scanTemplateBoundary(str: string, backtickIndex: number): number {
  let idx = backtickIndex + 1;
  while (idx < str.length) {
    const ch = str[idx];
    if (ch === '\\') {
      idx += 2;
      continue;
    }
    if (ch === '`') return idx;
    if (ch === '$' && str[idx + 1] === '{') {
      let braceDepth = 0;
      for (idx = idx + 1; idx < str.length; idx++) {
        if (str[idx] === '{') braceDepth++;
        else if (str[idx] === '}') {
          braceDepth--;
          if (braceDepth === 0) break;
        } else if (str[idx] === '`') {
          idx = scanTemplateBoundary(str, idx);
        }
      }
    }
    idx++;
  }
  return str.length;
}

function parseCallArguments(str: string, openParenIdx: number): string[] | null {
  const closeParenIdx = scanClosingParen(str, openParenIdx);
  if (closeParenIdx < 0) return null;

  const innerText = str.slice(openParenIdx + 1, closeParenIdx);
  const argumentList: string[] = [];
  let bracketDepth = 0;
  let argumentStart = 0;

  for (let i = 0; i < innerText.length; i++) {
    const ch = innerText[i];
    if (ch === '"' || ch === "'") {
      const q = ch;
      i++;
      while (i < innerText.length && innerText[i] !== q) {
        if (innerText[i] === '\\') i++;
        i++;
      }
      continue;
    }
    if (ch === '`') {
      i = scanTemplateBoundary(innerText, i);
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') bracketDepth++;
    else if (ch === ')' || ch === ']' || ch === '}') bracketDepth--;
    else if (ch === ',' && bracketDepth === 0) {
      argumentList.push(innerText.slice(argumentStart, i));
      argumentStart = i + 1;
    }
  }

  argumentList.push(innerText.slice(argumentStart));
  return argumentList.map((arg) => arg.trim()).filter((arg, idx) => arg.length > 0 || idx === 0);
}

function extractLeadingLiteralString(text: string): string | null {
  const trimmed = text.trim().replace(/^\(\s*/, '');
  const urlInstMatch = /^new\s+URL\s*\(/.exec(trimmed);
  if (urlInstMatch) {
    const args = parseCallArguments(trimmed, urlInstMatch[0].length - 1);
    return args && args[0] ? extractLeadingLiteralString(args[0]) : null;
  }
  if (trimmed[0] === '"' || trimmed[0] === "'" || trimmed[0] === '`') {
    return readStringAt(trimmed, 0);
  }
  return null;
}

function extractHttpMethodInConfig(text: string): string | null {
  const methodMatch = /\bmethod\s*:\s*(['"`])([A-Za-z]+)\1/.exec(text);
  return methodMatch ? methodMatch[2]!.toUpperCase() : null;
}

function extractFirstLiteralToken(rawArgs: string): string | null {
  const match = /(['"`])([^'"`]+)\1/.exec(rawArgs);
  return match ? match[2]! : null;
}

function extractAllLiteralTokens(rawArgs: string): string[] {
  const tokens: string[] = [];
  const regex = /(['"`])([^'"`]+)\1/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(rawArgs)) !== null) {
    tokens.push(match[2]!);
  }
  return tokens;
}

function extractMethodTargetAfterDecorator(
  source: string,
  afterIndex: number
): { name: string; index: number } | null {
  let cursor = afterIndex;
  const whitespacePattern = /\s*/y;
  const decoratorPattern = /@[\w.]+/y;
  const modifierPattern = /(?:public|private|protected|async|static|readonly|override)\b/y;
  const identifierPattern = /([A-Za-z_$][\w$]*)\s*[<(]/y;

  const skipWhitespace = (): void => {
    whitespacePattern.lastIndex = cursor;
    if (whitespacePattern.exec(source)) {
      cursor = whitespacePattern.lastIndex;
    }
  };

  while (true) {
    skipWhitespace();
    if (source[cursor] !== '@') break;
    decoratorPattern.lastIndex = cursor;
    if (!decoratorPattern.exec(source)) break;
    cursor = decoratorPattern.lastIndex;
    skipWhitespace();
    if (source[cursor] === '(') {
      const closingIdx = scanClosingParen(source, cursor);
      if (closingIdx < 0) return null;
      cursor = closingIdx + 1;
    }
  }

  while (true) {
    skipWhitespace();
    modifierPattern.lastIndex = cursor;
    if (modifierPattern.exec(source) && modifierPattern.lastIndex > cursor) {
      cursor = modifierPattern.lastIndex;
      continue;
    }
    break;
  }

  skipWhitespace();
  identifierPattern.lastIndex = cursor;
  const match = identifierPattern.exec(source);
  return match ? { name: match[1]!, index: cursor } : null;
}

function findDecoratorInstances(
  source: string,
  decoratorName: string
): Array<{ args: string; index: number; end: number }> {
  const instances: Array<{ args: string; index: number; end: number }> = [];
  const regex = new RegExp(`@${decoratorName}\\s*\\(`, 'g');
  let match: RegExpExecArray | null;

  while ((match = regex.exec(source)) !== null) {
    const openParen = match.index + match[0].length - 1;
    const closeParen = scanClosingParen(source, openParen);
    if (closeParen < 0) continue;
    instances.push({
      args: source.slice(openParen + 1, closeParen),
      index: match.index,
      end: closeParen + 1,
    });
    regex.lastIndex = closeParen + 1;
  }

  return instances;
}

/* ------------------------------------------------------------- File Facts -- */

interface FileFacts {
  file: string;
  safe: string;
  nodes: Node[];
  lineOf: (idx: number) => number;
  columnOf: (idx: number) => number;
  routeLines: Set<number>;
  clients: Map<string, { baseURL: string | null }>;
  defaultClient: { baseURL: string | null } | null;
  queues: Map<string, string>;
  socketServer: boolean;
}

const CLIENT_INSTANCE_CREATION =
  /\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]*?)?=\s*(?:await\s+)?(?:(?:axios|ky|got|ofetch|\$fetch|wretch|redaxios)\s*\.\s*(?:create|extend)|new\s+Axios|wretch)\s*\(/g;
const DEFAULT_CLIENT_INSTANCE =
  /\bexport\s+default\s+(?:(?:axios|ky|got|ofetch|\$fetch|wretch|redaxios)\s*\.\s*(?:create|extend)|new\s+Axios|wretch)\s*\(/;
const QUEUE_DECLARATION =
  /\b(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]*?)?=\s*(?:new\s+)?(?:Queue|Bull|BullQueue)\s*(?:<[^>]*>)?\s*\(\s*(['"`])([^'"`]+)\2/g;
const INJECT_QUEUE_DECORATOR =
  /@InjectQueue\s*\(\s*(['"`])([^'"`]+)\1\s*\)\s*(?:(?:private|public|protected|readonly)\s+)*([A-Za-z_$][\w$]*)/g;
const WEBSOCKET_SERVER_HEURISTIC =
  /@WebSocketGateway\s*\(|@SubscribeMessage\s*\(|@WebSocketServer\s*\(|\bnew\s+(?:Server|SocketIOServer|WebSocketServer|WebSocket\.Server|WSServer)\b|\.on\s*\(\s*['"]connection['"]/;

function parseBaseUrlFromArguments(source: string, openParenIdx: number): string | null {
  const args = parseCallArguments(source, openParenIdx);
  const firstArg = args?.[0] ?? '';
  const match = /\b(?:baseURL|baseUrl|prefixUrl|baseURI)\s*:\s*/.exec(firstArg);
  if (!match) return null;
  return readStringAt(firstArg, match.index + match[0].length);
}

function analyzeFileFacts(ctx: ResolutionContext, filePath: string): FileFacts | null {
  const fileContent = ctx.readFile(filePath);
  if (!fileContent) return null;

  const sanitizedContent = stripCommentsForRegex(fileContent, 'typescript');
  const fileNodes = ctx.getNodesInFile(filePath);
  const routeDeclarationLines = new Set<number>();

  for (const node of fileNodes) {
    if (node.kind === 'route') {
      routeDeclarationLines.add(node.startLine);
    }
  }

  const clientRegistry = new Map<string, { baseURL: string | null }>();
  CLIENT_INSTANCE_CREATION.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = CLIENT_INSTANCE_CREATION.exec(sanitizedContent)) !== null) {
    clientRegistry.set(match[1]!, {
      baseURL: parseBaseUrlFromArguments(sanitizedContent, match.index + match[0].length - 1),
    });
  }

  const defaultMatch = DEFAULT_CLIENT_INSTANCE.exec(sanitizedContent);
  const defaultClientInfo = defaultMatch
    ? { baseURL: parseBaseUrlFromArguments(sanitizedContent, defaultMatch.index + defaultMatch[0].length - 1) }
    : null;

  const queueRegistry = new Map<string, string>();
  QUEUE_DECLARATION.lastIndex = 0;
  while ((match = QUEUE_DECLARATION.exec(sanitizedContent)) !== null) {
    queueRegistry.set(match[1]!, match[3]!);
  }

  INJECT_QUEUE_DECORATOR.lastIndex = 0;
  while ((match = INJECT_QUEUE_DECORATOR.exec(sanitizedContent)) !== null) {
    queueRegistry.set(match[3]!, match[2]!);
  }

  return {
    file: filePath,
    safe: sanitizedContent,
    nodes: fileNodes,
    lineOf: makeLineAt(sanitizedContent, 1),
    columnOf: (idx: number) => idx - (sanitizedContent.lastIndexOf('\n', idx - 1) + 1),
    routeLines: routeDeclarationLines,
    clients: clientRegistry,
    defaultClient: defaultClientInfo,
    queues: queueRegistry,
    socketServer: WEBSOCKET_SERVER_HEURISTIC.test(sanitizedContent),
  };
}

function resolveImportedFacts(
  ctx: ResolutionContext,
  currentFacts: FileFacts,
  symbolIdentifier: string,
  factsCache: Map<string, FileFacts | null>
): { facts: FileFacts; exportedName: string; isDefault: boolean } | null {
  const languageMode: Language = currentFacts.file.endsWith('x') ? 'tsx' : 'typescript';
  const mapping = ctx
    .getImportMappings(currentFacts.file, languageMode)
    .find((m) => m.localName === symbolIdentifier);

  if (!mapping) return null;

  const targetPath = mapping.resolvedPath ?? resolveImportPath(mapping.source, currentFacts.file, languageMode, ctx);
  if (!targetPath) return null;

  let cachedFacts = factsCache.get(targetPath);
  if (cachedFacts === undefined) {
    cachedFacts = JS_TS_EXTENSION.test(targetPath) ? analyzeFileFacts(ctx, targetPath) : null;
    factsCache.set(targetPath, cachedFacts);
  }

  return cachedFacts
    ? { facts: cachedFacts, exportedName: mapping.exportedName, isDefault: mapping.isDefault }
    : null;
}

/* ------------------------------------------------------------- 1. HTTP ------------------------------------------------------------- */

const KNOWN_HTTP_CLIENT_IDENTIFIERS =
  /^(?:axios|ky|got|superagent|http|https|httpClient|httpService|api|apiClient|client|restClient|request|agent|fetcher|instance|\$api|\$http|\$axios|axiosInstance|Axios|HttpClient|backend|server)$/;
const KNOWN_SERVER_ROUTER_IDENTIFIERS =
  /^(?:app|router|route|routes|express|fastify|koa|hono|elysia|apiRouter|v1|v2|r)$/;

const GENERIC_TYPE_PARAM = String.raw`(?:<[^()<>]*(?:<[^()<>]*>[^()<>]*)*>)?`;
const BARE_HTTP_INVOCATION = new RegExp(
  String.raw`(?:(?:window|globalThis|global)\s*\.\s*)?\b(fetch|\$fetch|ofetch|axios|ky|got|useFetch|useSWR)\s*${GENERIC_TYPE_PARAM}\s*\(`,
  'g'
);
const MEMBER_HTTP_INVOCATION = new RegExp(
  String.raw`((?:this\s*\.\s*)?[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*\.\s*(get|post|put|patch|delete|head|options|request|\$get|\$post|\$put|\$patch|\$delete)\s*${GENERIC_TYPE_PARAM}\s*\(`,
  'g'
);

interface HttpRouteDescriptor {
  node: Node;
  method: string;
  segments: string[];
}

interface HttpClientCallSite {
  fn: Node;
  file: string;
  line: number;
  column: number;
  callee: string;
  method: string;
  segments: string[];
  suffixMatch: boolean;
  displayUrl: string;
}

function discoverHttpRoutes(ctx: ResolutionContext): HttpRouteDescriptor[] {
  const routes: HttpRouteDescriptor[] = [];

  for (const node of ctx.getNodesByKind('route')) {
    const spaceIndex = node.name.indexOf(' ');
    if (spaceIndex <= 0) continue;

    const httpMethod = node.name.slice(0, spaceIndex).toUpperCase();
    if (!SUPPORTED_HTTP_METHODS.has(httpMethod)) continue;

    const routePath = node.name.slice(spaceIndex + 1).trim();
    if (!routePath.startsWith('/')) continue;

    routes.push({
      node,
      method: httpMethod,
      segments: routePath.split('/').filter((s) => s.length > 0),
    });
  }

  return routes;
}

const PARAM_PLACEHOLDER = /^(?::|\{|\[|<|\*)|\?$/;
const CATCH_ALL_PLACEHOLDER = /^(?:\*|\[\.\.\.|\{\*|:[\w$]+\*$|\{[\w$]+:\*\}|\*[\w$]*$)/;

function computePathSimilarityScore(
  clientSegments: readonly string[],
  routeSegments: readonly string[]
): number | null {
  let score = 0;
  let clientIdx = 0;

  for (let rIdx = 0; rIdx < routeSegments.length; rIdx++) {
    const rSeg = routeSegments[rIdx]!;

    if (CATCH_ALL_PLACEHOLDER.test(rSeg)) {
      if (clientIdx >= clientSegments.length) return null;
      score += clientSegments.length - clientIdx;
      clientIdx = clientSegments.length;
      continue;
    }

    if (clientIdx >= clientSegments.length) return null;
    const cSeg = clientSegments[clientIdx]!;

    if (PARAM_PLACEHOLDER.test(rSeg)) {
      score += 2;
    } else if (cSeg === rSeg) {
      score += 3;
    } else {
      return null;
    }

    clientIdx++;
  }

  return clientIdx === clientSegments.length ? score : null;
}

function matchRouteForClientCall(
  site: HttpClientCallSite,
  allRoutes: readonly HttpRouteDescriptor[]
): HttpRouteDescriptor | null {
  let highestMatch: HttpRouteDescriptor | null = null;
  let highestScore = -1;
  let isScoreTied = false;

  for (const candidateRoute of allRoutes) {
    if (
      candidateRoute.method !== 'ALL' &&
      candidateRoute.method !== 'ANY' &&
      candidateRoute.method !== site.method
    ) {
      continue;
    }

    let calculatedScore: number | null;
    if (site.suffixMatch) {
      if (
        site.segments.length < 2 ||
        candidateRoute.segments.length < site.segments.length ||
        candidateRoute.segments.length - site.segments.length > 2
      ) {
        continue;
      }
      calculatedScore = computePathSimilarityScore(
        site.segments,
        candidateRoute.segments.slice(candidateRoute.segments.length - site.segments.length)
      );
    } else {
      calculatedScore = computePathSimilarityScore(site.segments, candidateRoute.segments);
    }

    if (calculatedScore === null) continue;

    if (calculatedScore > highestScore) {
      highestMatch = candidateRoute;
      highestScore = calculatedScore;
      isScoreTied = false;
    } else if (calculatedScore === highestScore) {
      isScoreTied = true;
    }
  }

  return isScoreTied ? null : highestMatch;
}

function parseClientUrlSegments(
  rawUrl: string,
  configuredBaseUrl: string | null
): { segments: string[]; suffixMatch: boolean; displayUrl: string } | null {
  let currentPath = rawUrl;
  const queryOrHashIdx = currentPath.search(/[?#]/);
  if (queryOrHashIdx >= 0) {
    currentPath = currentPath.slice(0, queryOrHashIdx);
  }

  let isSuffix = false;
  const absoluteUrlMatch = /^(?:[a-z][a-z0-9+.-]*:)?\/\/[^/]*(\/.*)?$/i.exec(currentPath);

  if (absoluteUrlMatch) {
    currentPath = absoluteUrlMatch[1] ?? '/';
  } else if (!currentPath.startsWith('/')) {
    if (currentPath.startsWith(HOLE)) {
      const rest = currentPath.slice(1);
      if (!rest.startsWith('/')) return null;
      currentPath = rest;
      isSuffix = true;
    } else if (configuredBaseUrl !== null) {
      const parsedBase = parseClientUrlSegments(configuredBaseUrl, null);
      if (!parsedBase) {
        if (!configuredBaseUrl.includes(HOLE)) return null;
        isSuffix = true;
        currentPath = '/' + currentPath;
      } else {
        isSuffix = parsedBase.suffixMatch;
        currentPath = '/' + [...parsedBase.segments, ...currentPath.split('/')].filter(Boolean).join('/');
      }
    } else {
      return null;
    }
  } else if (configuredBaseUrl !== null) {
    const parsedBase = parseClientUrlSegments(configuredBaseUrl, null);
    if (parsedBase && parsedBase.segments.length > 0) {
      isSuffix = parsedBase.suffixMatch;
      currentPath = '/' + [...parsedBase.segments, ...currentPath.split('/')].filter(Boolean).join('/');
    } else if (!parsedBase && configuredBaseUrl.includes(HOLE)) {
      isSuffix = true;
    }
  }

  const segmentList = currentPath
    .split('/')
    .filter((s) => s.length > 0)
    .map((s) => (s.includes(HOLE) ? '*' : s));

  if (segmentList.length > 0 && segmentList.every((s) => s === '*')) {
    return null;
  }

  return {
    segments: segmentList,
    suffixMatch: isSuffix,
    displayUrl: '/' + segmentList.map((s) => (s === '*' ? '${…}' : s)).join('/'),
  };
}

function resolveHttpClientContext(
  ctx: ResolutionContext,
  facts: FileFacts,
  receiverExpression: string,
  factsCache: Map<string, FileFacts | null>
): { baseURL: string | null } | null {
  const parts = receiverExpression.replace(/\s+/g, '').replace(/^this\./, '').split('.');
  const headSymbol = parts[0]!;
  const tailSymbol = parts[parts.length - 1]!;

  const localClient = facts.clients.get(headSymbol);
  if (localClient) return localClient;

  const importedInfo = resolveImportedFacts(ctx, facts, headSymbol, factsCache);
  if (importedInfo) {
    const matchedClient = importedInfo.isDefault
      ? importedInfo.facts.defaultClient
      : importedInfo.facts.clients.get(importedInfo.exportedName) ?? null;
    if (matchedClient) return matchedClient;
  }

  if (KNOWN_SERVER_ROUTER_IDENTIFIERS.test(tailSymbol) || KNOWN_SERVER_ROUTER_IDENTIFIERS.test(headSymbol)) {
    return null;
  }

  if (KNOWN_HTTP_CLIENT_IDENTIFIERS.test(tailSymbol)) {
    return { baseURL: null };
  }

  return null;
}

function findHttpClientCallSites(
  ctx: ResolutionContext,
  facts: FileFacts,
  destinationList: HttpClientCallSite[],
  factsCache: Map<string, FileFacts | null>
): void {
  const { safe, nodes, lineOf } = facts;

  const registerCall = (
    startOffset: number,
    openParenOffset: number,
    presetVerb: string | null,
    injectedBaseUrl: string | null
  ): void => {
    const lineNumber = lineOf(startOffset);
    const calleeSignature = safe.slice(startOffset, openParenOffset).replace(/\s+/g, '').replace(/<.*>$/, '');

    if (facts.routeLines.has(lineNumber)) return;

    const enclosingFunction = enclosingFn(nodes, lineNumber);
    if (!enclosingFunction) return;

    const parsedArgs = parseCallArguments(safe, openParenOffset);
    if (!parsedArgs || !parsedArgs[0]) return;

    let targetUrlExpression = parsedArgs[0];
    let resolvedVerb = presetVerb;

    if (targetUrlExpression.trimStart().startsWith('{')) {
      const urlProperty = /\burl\s*:\s*/.exec(targetUrlExpression);
      if (!urlProperty) return;
      resolvedVerb = resolvedVerb ?? extractHttpMethodInConfig(targetUrlExpression) ?? 'GET';
      targetUrlExpression = targetUrlExpression.slice(urlProperty.index + urlProperty[0].length);
    } else if (resolvedVerb === null) {
      resolvedVerb = extractHttpMethodInConfig(parsedArgs.slice(1).join(',')) ?? 'GET';
    }

    const literalUrl = extractLeadingLiteralString(targetUrlExpression);
    if (literalUrl === null) return;

    const parsedPath = parseClientUrlSegments(literalUrl, injectedBaseUrl);
    if (!parsedPath) return;

    destinationList.push({
      fn: enclosingFunction,
      file: facts.file,
      line: lineNumber,
      column: facts.columnOf(startOffset),
      callee: calleeSignature,
      method: resolvedVerb,
      segments: parsedPath.segments,
      suffixMatch: parsedPath.suffixMatch,
      displayUrl: parsedPath.displayUrl,
    });
  };

  BARE_HTTP_INVOCATION.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = BARE_HTTP_INVOCATION.exec(safe)) !== null) {
    const precedingChar = safe[match.index - 1];
    if (precedingChar === '.' && !/^(?:window|globalThis|global)\s*\./.test(match[0])) {
      continue;
    }
    registerCall(match.index, match.index + match[0].length - 1, null, null);
  }

  MEMBER_HTTP_INVOCATION.lastIndex = 0;
  while ((match = MEMBER_HTTP_INVOCATION.exec(safe)) !== null) {
    const clientBinding = resolveHttpClientContext(ctx, facts, match[1]!, factsCache);
    if (!clientBinding) continue;
    const httpVerb = match[2]!.replace(/^\$/, '').toUpperCase();
    registerCall(
      match.index,
      match.index + match[0].length - 1,
      httpVerb === 'REQUEST' ? null : httpVerb,
      clientBinding.baseURL
    );
  }
}

/* ------------------------------------------------------------- 2. Queues ----------------------------------------------------------- */

const QUEUE_ADD_CALL =
  /((?:this\s*\.\s*)?[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*\.\s*add\s*\(\s*(['"`])([^'"`]+)\2/g;
const QUEUE_NAME_HEURISTIC = /queue|jobs?$|worker|bull|flow|producer/i;
const WORKER_CONSTRUCTOR = /\bnew\s+Worker\s*(?:<[^>]*>)?\s*\(\s*(['"`])([^'"`]+)\1\s*,\s*/g;
const QUEUE_PROCESS_CALL =
  /((?:this\s*\.\s*)?[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*\.\s*process\s*\(\s*(?:(['"`])([^'"`]+)\2\s*,\s*)?(?:\d+\s*,\s*)?/g;
const QUEUE_HANDLER_ARG_PATTERN =
  /^(?:(?:async\s+)?([A-Za-z_$][\w$.]*)\s*(?:[,)]|$)|(?:async\s*)?(?:\(|function\b|[A-Za-z_$][\w$]*\s*=>))/;

interface JobQueueProducer {
  fn: Node;
  file: string;
  line: number;
  column: number;
  callee: string;
  queue: string | null;
  job: string;
}

interface JobQueueConsumer {
  node: Node;
  file: string;
  line: number;
  queue: string | null;
  job: string | null;
}

function resolveQueueBinding(
  ctx: ResolutionContext,
  facts: FileFacts,
  receiverExpression: string,
  factsCache: Map<string, FileFacts | null>
): string | null {
  const parts = receiverExpression.replace(/\s+/g, '').replace(/^this\./, '').split('.');
  const headSymbol = parts[0]!;
  const localQueue = facts.queues.get(headSymbol);
  if (localQueue) return localQueue;

  const importedInfo = resolveImportedFacts(ctx, facts, headSymbol, factsCache);
  if (importedInfo) {
    const queueName = importedInfo.facts.queues.get(importedInfo.exportedName);
    if (queueName) return queueName;
  }

  return null;
}

function findQueueHandlerNode(
  ctx: ResolutionContext,
  facts: FileFacts,
  rawArgText: string,
  lineNumber: number,
  factsCache: Map<string, FileFacts | null>
): Node | null {
  const match = QUEUE_HANDLER_ARG_PATTERN.exec(rawArgText.trimStart());
  if (!match) return null;

  if (match[1]) {
    const functionName = match[1].split('.').pop()!;
    const candidateNodes = ctx
      .getNodesByName(functionName)
      .filter((n) => n.kind === 'function' || n.kind === 'method');

    const sameFileNodes = candidateNodes.filter((n) => n.filePath === facts.file);
    if (sameFileNodes.length === 1) return sameFileNodes[0]!;
    if (sameFileNodes.length > 1) return null;

    const imported = resolveImportedFacts(ctx, facts, match[1].split('.')[0]!, factsCache);
    if (imported) {
      const fromImported = candidateNodes.filter((n) => n.filePath === imported.facts.file);
      if (fromImported.length === 1) return fromImported[0]!;
    }

    return candidateNodes.length === 1 ? candidateNodes[0]! : null;
  }

  return enclosingFn(facts.nodes, lineNumber) ?? enclosingValue(facts.nodes, lineNumber);
}

function findClassAfterIndex(facts: FileFacts, startOffset: number): Node | null {
  const classRegex = /\bclass\s+([A-Za-z_$][\w$]*)/g;
  classRegex.lastIndex = startOffset;
  const hit = classRegex.exec(facts.safe);
  if (!hit) return null;

  const line = facts.lineOf(hit.index);
  return facts.nodes.find((n) => n.kind === 'class' && n.name === hit[1] && n.startLine >= line - 2) ?? null;
}

function findDecoratedMethodNode(facts: FileFacts, endOffset: number, parentClass: Node | null): Node | null {
  const signatureInfo = extractMethodTargetAfterDecorator(facts.safe, endOffset);
  if (!signatureInfo) return null;

  const line = facts.lineOf(signatureInfo.index);
  return (
    facts.nodes.find(
      (n) =>
        (n.kind === 'method' || n.kind === 'function') &&
        n.name === signatureInfo.name &&
        n.startLine >= line - 1 &&
        n.startLine <= line + 1 &&
        (!parentClass || (n.startLine >= parentClass.startLine && n.endLine <= parentClass.endLine))
    ) ?? null
  );
}

function discoverQueueInteractions(
  ctx: ResolutionContext,
  facts: FileFacts,
  producers: JobQueueProducer[],
  consumers: JobQueueConsumer[],
  factsCache: Map<string, FileFacts | null>
): void {
  const { safe, nodes, lineOf } = facts;

  QUEUE_ADD_CALL.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = QUEUE_ADD_CALL.exec(safe)) !== null) {
    const receiver = match[1]!;
    const queueName = resolveQueueBinding(ctx, facts, receiver, factsCache);
    const tailIdentifier = receiver.replace(/\s+/g, '').split('.').pop()!;

    if (queueName === null && !QUEUE_NAME_HEURISTIC.test(tailIdentifier)) continue;

    const line = lineOf(match.index);
    const callerFn = enclosingFn(nodes, line);
    if (!callerFn) continue;

    producers.push({
      fn: callerFn,
      file: facts.file,
      line,
      column: facts.columnOf(match.index),
      callee: `${receiver.replace(/\s+/g, '')}.add`,
      queue: queueName,
      job: match[3]!,
    });
  }

  // NestJS @Processor & @Process
  for (const procDecorator of findDecoratorInstances(safe, 'Processor')) {
    const queueName = extractFirstLiteralToken(procDecorator.args);
    const enclosingClass = findClassAfterIndex(facts, procDecorator.end);
    if (!enclosingClass) continue;

    let hasExplicitJobDecorators = false;

    for (const jobDecorator of findDecoratorInstances(safe, 'Process')) {
      const line = lineOf(jobDecorator.index);
      if (line < enclosingClass.startLine || line > enclosingClass.endLine) continue;

      const methodNode = findDecoratedMethodNode(facts, jobDecorator.end, enclosingClass);
      if (!methodNode) continue;

      hasExplicitJobDecorators = true;
      consumers.push({
        node: methodNode,
        file: facts.file,
        line,
        queue: queueName,
        job: extractFirstLiteralToken(jobDecorator.args),
      });
    }

    if (!hasExplicitJobDecorators) {
      const defaultProcessMethod = nodes.find(
        (n) =>
          n.kind === 'method' &&
          n.name === 'process' &&
          n.startLine >= enclosingClass.startLine &&
          n.endLine <= enclosingClass.endLine
      );
      if (defaultProcessMethod) {
        consumers.push({
          node: defaultProcessMethod,
          file: facts.file,
          line: defaultProcessMethod.startLine,
          queue: queueName,
          job: null,
        });
      }
    }
  }

  // BullMQ: new Worker('email', handler)
  WORKER_CONSTRUCTOR.lastIndex = 0;
  while ((match = WORKER_CONSTRUCTOR.exec(safe)) !== null) {
    const line = lineOf(match.index);
    const targetHandler = findQueueHandlerNode(
      ctx,
      facts,
      safe.slice(match.index + match[0].length, match.index + match[0].length + 200),
      line,
      factsCache
    );
    if (!targetHandler) continue;

    consumers.push({
      node: targetHandler,
      file: facts.file,
      line,
      queue: match[2]!,
      job: null,
    });
  }

  // Bull: queue.process('welcome', handler) or queue.process(handler)
  QUEUE_PROCESS_CALL.lastIndex = 0;
  while ((match = QUEUE_PROCESS_CALL.exec(safe)) !== null) {
    const receiver = match[1]!;
    const queueName = resolveQueueBinding(ctx, facts, receiver, factsCache);
    const tailIdentifier = receiver.replace(/\s+/g, '').split('.').pop()!;

    if (queueName === null && !QUEUE_NAME_HEURISTIC.test(tailIdentifier)) continue;

    const line = lineOf(match.index);
    const targetHandler = findQueueHandlerNode(
      ctx,
      facts,
      safe.slice(match.index + match[0].length, match.index + match[0].length + 200),
      line,
      factsCache
    );
    if (!targetHandler) continue;

    consumers.push({
      node: targetHandler,
      file: facts.file,
      line,
      queue: queueName,
      job: match[3] ?? null,
    });
  }
}

function synthesizeQueueEdges(
  producers: readonly JobQueueProducer[],
  consumers: readonly JobQueueConsumer[],
  edges: Edge[],
  visitedPairs: Set<string>
): void {
  for (const prod of producers) {
    let candidateConsumers = consumers.filter(
      (c) =>
        (prod.queue === null || c.queue === null || c.queue === prod.queue) &&
        (c.job === null || c.job === prod.job)
    );

    const exactMatch = candidateConsumers.filter(
      (c) => c.job === prod.job && c.queue === prod.queue && prod.queue !== null
    );

    if (exactMatch.length > 0) {
      candidateConsumers = exactMatch;
    } else {
      const matchByJob = candidateConsumers.filter((c) => c.job === prod.job);
      if (matchByJob.length > 0) {
        candidateConsumers = matchByJob;
      } else if (prod.queue === null) {
        continue;
      } else {
        candidateConsumers = candidateConsumers.filter((c) => c.queue === prod.queue);
      }
    }

    if (candidateConsumers.length === 0 || candidateConsumers.length > FANOUT_LIMIT) {
      continue;
    }

    for (const cons of candidateConsumers) {
      if (cons.node.id === prod.fn.id) continue;
      const pairKey = `${prod.fn.id}>${cons.node.id}`;
      if (visitedPairs.has(pairKey)) continue;

      visitedPairs.add(pairKey);
      edges.push({
        source: prod.fn.id,
        target: cons.node.id,
        kind: 'calls',
        line: prod.line,
        column: prod.column,
        provenance: 'heuristic',
        metadata: {
          synthesizedBy: 'queue-job',
          channel: 'queue',
          callee: prod.callee,
          event: prod.job,
          ...(prod.queue ?? cons.queue ? { queue: prod.queue ?? cons.queue } : {}),
          registeredAt: `${cons.file}:${cons.line}`,
        },
      });
    }
  }
}

/* ------------------------------------------------------------- 3. Events ----------------------------------------------------------- */

const EVENT_EMIT_CALL =
  /((?:[\w$]+(?:\([^()]*\))?\s*\.\s*)*[\w$]+)\s*\.\s*(emit|emitAsync)\s*\(\s*(['"`])([^'"`\n]+)\3/g;
const SOCKET_ON_CALL =
  /((?:[\w$]+(?:\([^()]*\))?\s*\.\s*)*[\w$]+)\s*\.\s*(?:on|once)\s*\(\s*(['"`])([^'"`\n]+)\2\s*,\s*/g;

const SOCKET_RECEIVER_TOKENS =
  /^(?:socket|io|ws|wss|client|server|namespace|nsp|conn|connection|gateway|broadcast|to|in|of|except|volatile|local|sockets|socketServer|wsServer|room|channel|pusher|ably|ioClient|socketClient|sock)$/;
const EVENT_BUS_RECEIVER_TOKENS =
  /^(?:eventEmitter|emitter|events|eventBus|bus|dispatcher|pubsub|publisher|eventPublisher|ee|hub|mediator|broker|messageBus|appEvents|domainEvents|eventsService|eventService)$/;
const BUILTIN_TRANSPORT_EVENTS =
  /^(?:error|connect|connect_error|connect_failed|connection|disconnect|disconnecting|reconnect|reconnect_attempt|reconnecting|reconnect_error|reconnect_failed|close|open|end|data|ready|drain|finish|pipe|unpipe|listening|timeout|ping|pong|upgrade|newListener|removeListener)$/;

interface EventDispatcher {
  fn: Node;
  file: string;
  line: number;
  column: number;
  callee: string;
  event: string;
  shape: 'bus' | 'socket';
  side: 'server' | 'client';
}

interface EventHandler {
  node: Node;
  file: string;
  line: number;
  pattern: string;
  kind: 'bus' | 'socket';
  side: 'server' | 'client';
}

function classifyEventReceiverShape(receiverExpression: string): 'bus' | 'socket' | null {
  const tokens = receiverExpression
    .replace(/\([^()]*\)/g, '')
    .replace(/\s+/g, '')
    .split('.')
    .filter((s) => s !== 'this');

  if (tokens.some((t) => SOCKET_RECEIVER_TOKENS.test(t))) return 'socket';
  if (tokens.some((t) => EVENT_BUS_RECEIVER_TOKENS.test(t))) return 'bus';
  return null;
}

function discoverEventInteractions(
  ctx: ResolutionContext,
  facts: FileFacts,
  dispatchers: EventDispatcher[],
  handlers: EventHandler[],
  factsCache: Map<string, FileFacts | null>
): void {
  const { safe, nodes, lineOf } = facts;
  const architectureSide: 'server' | 'client' = facts.socketServer ? 'server' : 'client';

  EVENT_EMIT_CALL.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = EVENT_EMIT_CALL.exec(safe)) !== null) {
    const shape = classifyEventReceiverShape(match[1]!);
    if (!shape || BUILTIN_TRANSPORT_EVENTS.test(match[4]!)) continue;

    const line = lineOf(match.index);
    const callerFn = enclosingFn(nodes, line);
    if (!callerFn) continue;

    dispatchers.push({
      fn: callerFn,
      file: facts.file,
      line,
      column: facts.columnOf(match.index),
      callee: `${match[1]!.replace(/\s+/g, '')}.${match[2]!}`,
      event: match[4]!,
      shape,
      side: architectureSide,
    });
  }

  // NestJS @OnEvent
  for (const eventDec of findDecoratorInstances(safe, 'OnEvent')) {
    const targetMethod = findDecoratedMethodNode(facts, eventDec.end, null);
    if (!targetMethod) continue;

    const patterns = eventDec.args.trimStart().startsWith('[')
      ? extractAllLiteralTokens(eventDec.args)
      : [extractFirstLiteralToken(eventDec.args)].filter((x): x is string => x !== null);

    for (const pattern of patterns) {
      handlers.push({
        node: targetMethod,
        file: facts.file,
        line: lineOf(eventDec.index),
        pattern,
        kind: 'bus',
        side: architectureSide,
      });
    }
  }

  // NestJS @SubscribeMessage
  for (const subDec of findDecoratorInstances(safe, 'SubscribeMessage')) {
    const targetMethod = findDecoratedMethodNode(facts, subDec.end, null);
    const eventName = extractFirstLiteralToken(subDec.args);
    if (!targetMethod || eventName === null) continue;

    handlers.push({
      node: targetMethod,
      file: facts.file,
      line: lineOf(subDec.index),
      pattern: eventName,
      kind: 'socket',
      side: 'server',
    });
  }

  // socket.on / socket.once
  SOCKET_ON_CALL.lastIndex = 0;
  while ((match = SOCKET_ON_CALL.exec(safe)) !== null) {
    if (classifyEventReceiverShape(match[1]!) !== 'socket' || BUILTIN_TRANSPORT_EVENTS.test(match[3]!)) {
      continue;
    }

    const line = lineOf(match.index);
    const targetHandler = findQueueHandlerNode(
      ctx,
      facts,
      safe.slice(match.index + match[0].length, match.index + match[0].length + 200),
      line,
      factsCache
    );
    if (!targetHandler) continue;

    handlers.push({
      node: targetHandler,
      file: facts.file,
      line,
      pattern: match[3]!,
      kind: 'socket',
      side: architectureSide,
    });
  }
}

function escapeRegexSpecialChars(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchesEventPattern(pattern: string, eventName: string): boolean {
  if (pattern === eventName) return true;
  if (!pattern.includes('*')) return false;

  const regexSource =
    '^' +
    pattern
      .split('**')
      .map((part) => part.split('*').map(escapeRegexSpecialChars).join('[^.]+'))
      .join('.*') +
    '$';

  return new RegExp(regexSource).test(eventName);
}

function synthesizeEventEdges(
  dispatchers: readonly EventDispatcher[],
  handlers: readonly EventHandler[],
  edges: Edge[],
  visitedPairs: Set<string>
): void {
  const dispatchesByGroupKey = new Map<string, EventDispatcher[]>();

  for (const d of dispatchers) {
    const groupKey = `${d.shape}:${d.event}`;
    const list = dispatchesByGroupKey.get(groupKey) ?? [];
    list.push(d);
    dispatchesByGroupKey.set(groupKey, list);
  }

  for (const [, group] of dispatchesByGroupKey) {
    if (group.length > FANOUT_LIMIT) continue;

    for (const d of group) {
      let matchingHandlers: EventHandler[];
      let derivedTier: string | null = null;

      if (d.shape === 'bus') {
        matchingHandlers = handlers.filter((h) => h.kind === 'bus' && matchesEventPattern(h.pattern, d.event));
      } else if (d.side === 'client') {
        matchingHandlers = handlers.filter(
          (h) => h.kind === 'socket' && h.side === 'server' && h.pattern === d.event
        );
        derivedTier = TIER_CLIENT_TO_SERVER;
      } else {
        matchingHandlers = handlers.filter(
          (h) => h.kind === 'socket' && h.side === 'client' && h.pattern === d.event
        );
        derivedTier = TIER_SERVER_TO_CLIENT;
      }

      if (matchingHandlers.length === 0 || matchingHandlers.length > FANOUT_LIMIT) continue;

      for (const h of matchingHandlers) {
        if (h.node.id === d.fn.id) continue;
        const pairKey = `${d.fn.id}>${h.node.id}`;
        if (visitedPairs.has(pairKey)) continue;

        visitedPairs.add(pairKey);
        edges.push({
          source: d.fn.id,
          target: h.node.id,
          kind: 'calls',
          line: d.line,
          column: d.column,
          provenance: 'heuristic',
          metadata: {
            synthesizedBy: 'event-bus',
            channel: d.shape === 'bus' ? 'event' : 'socket',
            callee: d.callee,
            event: d.event,
            ...(derivedTier ? { tier: derivedTier } : {}),
            registeredAt: `${h.file}:${h.line}`,
          },
        });
      }
    }
  }
}

/* ----------------------------------------------------------- Pass Orchestrator ----------------------------------------------------- */

const HTTP_TRIGGER_PREFILTER =
  /\b(?:fetch|\$fetch|ofetch|axios|ky|got|useFetch|useSWR)\b|\.\s*(?:get|post|put|patch|delete|head|options|request|\$get|\$post)\s*[<(]/;
const QUEUE_TRIGGER_PREFILTER = /\.\s*add\s*\(|@Processor\s*\(|\bnew\s+Worker\s*[<(]|\.\s*process\s*\(/;
const EVENT_TRIGGER_PREFILTER = /\.\s*(?:emit|emitAsync|on|once)\s*\(|@OnEvent\s*\(|@SubscribeMessage\s*\(/;

/**
 * Traverses indexed project files to synthesize cross-tier edges connecting clients,
 * queue workers, and event handlers across service boundaries.
 */
export async function crossTierEdges(ctx: ResolutionContext, onYield: MaybeYield): Promise<Edge[]> {
  const declaredRoutes = discoverHttpRoutes(ctx);
  const httpSites: HttpClientCallSite[] = [];
  const queueProducers: JobQueueProducer[] = [];
  const queueConsumers: JobQueueConsumer[] = [];
  const eventDispatchers: EventDispatcher[] = [];
  const eventHandlers: EventHandler[] = [];
  const fileFactsCache = new Map<string, FileFacts | null>();

  let processedCount = 0;

  for (const filePath of ctx.getAllFiles()) {
    if (!JS_TS_EXTENSION.test(filePath) || isTestPath(filePath) || isGeneratedFile(filePath)) {
      continue;
    }

    if ((++processedCount & 63) === 0) {
      await onYield();
    }

    const content = ctx.readFile(filePath);
    if (!content) continue;

    const requiresHttp = declaredRoutes.length > 0 && HTTP_TRIGGER_PREFILTER.test(content);
    const requiresQueue = QUEUE_TRIGGER_PREFILTER.test(content);
    const requiresEvents = EVENT_TRIGGER_PREFILTER.test(content);

    if (!requiresHttp && !requiresQueue && !requiresEvents) continue;

    let facts = fileFactsCache.get(filePath);
    if (facts === undefined) {
      facts = analyzeFileFacts(ctx, filePath);
      fileFactsCache.set(filePath, facts);
    }
    if (!facts) continue;

    if (requiresHttp) {
      findHttpClientCallSites(ctx, facts, httpSites, fileFactsCache);
    }
    if (requiresQueue) {
      discoverQueueInteractions(ctx, facts, queueProducers, queueConsumers, fileFactsCache);
    }
    if (requiresEvents) {
      discoverEventInteractions(ctx, facts, eventDispatchers, eventHandlers, fileFactsCache);
    }
  }

  const synthesizedEdges: Edge[] = [];
  const registeredEdgeKeys = new Set<string>();

  for (const site of httpSites) {
    const matchedRoute = matchRouteForClientCall(site, declaredRoutes);
    if (!matchedRoute || matchedRoute.node.id === site.fn.id) continue;

    const edgeKey = `${site.fn.id}>${matchedRoute.node.id}`;
    if (registeredEdgeKeys.has(edgeKey)) continue;

    registeredEdgeKeys.add(edgeKey);
    synthesizedEdges.push({
      source: site.fn.id,
      target: matchedRoute.node.id,
      kind: 'calls',
      line: site.line,
      column: site.column,
      provenance: 'heuristic',
      metadata: {
        synthesizedBy: 'http-client',
        channel: 'http',
        callee: site.callee,
        tier: TIER_CLIENT_TO_SERVER,
        method: site.method,
        href: site.displayUrl,
        registeredAt: `${matchedRoute.node.filePath}:${matchedRoute.node.startLine}`,
      },
    });
  }

  await onYield();
  synthesizeQueueEdges(queueProducers, queueConsumers, synthesizedEdges, registeredEdgeKeys);
  synthesizeEventEdges(eventDispatchers, eventHandlers, synthesizedEdges, registeredEdgeKeys);

  return synthesizedEdges;
}
