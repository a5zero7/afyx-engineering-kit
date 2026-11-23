/**
 * AFYX Engineering Kit - NestJS Framework Resolver
 *
 * Provides route extraction and architecture resolution for NestJS projects:
 * 1. HTTP Endpoints: `@Controller(prefix)` + `@Get/@Post/@Put/@Patch/@Delete/@Head/@Options/@All(path)`
 * 2. GraphQL Operations: `@Resolver` + `@Query/@Mutation/@Subscription`
 * 3. Microservice Messaging: `@MessagePattern` and `@EventPattern`
 * 4. WebSocket Gateways: `@WebSocketGateway` + `@SubscribeMessage`
 * 5. Dependency Injection references: Injected providers (`*Service`, `*Repository`, `*Gateway`, etc.)
 * 6. Cross-module route hierarchy resolution: `RouterModule.register` via `postExtract`
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
import { declaredDependencies } from './package-deps';

type SupportedJsLanguage = 'typescript' | 'javascript';

const HTTP_VERB_DECORATORS: readonly string[] = ['Get', 'Post', 'Put', 'Patch', 'Delete', 'Head', 'Options', 'All'];
const GRAPHQL_DECORATORS: readonly string[] = ['Query', 'Mutation', 'Subscription'];

const NEST_PROVIDER_CONVENTIONS: Array<[RegExp, string]> = [
  [/Service$/, '.service.'],
  [/Controller$/, '.controller.'],
  [/Resolver$/, '.resolver.'],
  [/Gateway$/, '.gateway.'],
  [/Repository$/, '.repository.'],
  [/Guard$/, '.guard.'],
  [/Interceptor$/, '.interceptor.'],
  [/Pipe$/, '.pipe.'],
  [/Module$/, '.module.'],
];

interface FoundDecorator {
  name: string;
  args: string;
  index: number;
  end: number;
  length: number;
}

function parseBalancedParentheses(source: string, openIndex: number): { args: string; end: number } | null {
  if (source[openIndex] !== '(') return null;
  let nesting = 0;
  let activeQuote: string | null = null;

  for (let idx = openIndex; idx < source.length; idx++) {
    const ch = source[idx]!;
    if (activeQuote) {
      if (ch === '\\') {
        idx++;
        continue;
      }
      if (ch === activeQuote) activeQuote = null;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      activeQuote = ch;
      continue;
    }

    if (ch === '(') nesting++;
    else if (ch === ')') {
      nesting--;
      if (nesting === 0) {
        return { args: source.slice(openIndex + 1, idx), end: idx + 1 };
      }
    }
  }

  return null;
}

function scanDecorators(source: string, targetNames: readonly string[]): FoundDecorator[] {
  const matches: FoundDecorator[] = [];
  const pattern = new RegExp(`@(${targetNames.join('|')})\\s*\\(`, 'g');
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(source)) !== null) {
    const openParenPos = match.index + match[0].length - 1;
    const parsed = parseBalancedParentheses(source, openParenPos);
    if (!parsed) continue;

    matches.push({
      name: match[1]!,
      args: parsed.args,
      index: match.index,
      end: parsed.end,
      length: parsed.end - match.index,
    });
    pattern.lastIndex = parsed.end;
  }

  return matches;
}

function scanMethodIdentifier(source: string, afterDecoratorEnd: number): string | null {
  let idx = afterDecoratorEnd;
  const whitespacePattern = /\s*/y;
  const decoratorPrefixPattern = /@[\w.]+/y;
  const modifierPattern = /(?:public|private|protected|async|static)\b/y;
  const methodCallPattern = /([A-Za-z_$][\w$]*)\s*\(/y;

  const skipWhitespace = (): void => {
    whitespacePattern.lastIndex = idx;
    if (whitespacePattern.exec(source)) idx = whitespacePattern.lastIndex;
  };

  for (;;) {
    skipWhitespace();
    if (source[idx] !== '@') break;
    decoratorPrefixPattern.lastIndex = idx;
    if (!decoratorPrefixPattern.exec(source)) break;
    idx = decoratorPrefixPattern.lastIndex;
    skipWhitespace();
    if (source[idx] === '(') {
      const parsed = parseBalancedParentheses(source, idx);
      if (!parsed) return null;
      idx = parsed.end;
    }
  }

  for (;;) {
    skipWhitespace();
    modifierPattern.lastIndex = idx;
    if (modifierPattern.exec(source) && modifierPattern.lastIndex > idx) {
      idx = modifierPattern.lastIndex;
      continue;
    }
    break;
  }

  skipWhitespace();
  methodCallPattern.lastIndex = idx;
  const match = methodCallPattern.exec(source);
  return match ? match[1]! : null;
}

type NestClassRole = 'controller' | 'resolver' | 'gateway' | 'other';

interface ClassScopeRange {
  kind: NestClassRole;
  prefix: string;
  start: number;
  end: number;
}

function extractFirstStringLiteral(argsText: string): string {
  const match = argsText.match(/['"`]([^'"`]*)['"`]/);
  return match ? match[1]! : '';
}

function parseControllerRoutePrefix(argsText: string): string {
  const propertyMatch = argsText.match(/path\s*:\s*['"`]([^'"`]*)['"`]/);
  if (propertyMatch) return propertyMatch[1]!;
  return extractFirstStringLiteral(argsText);
}

function parseGatewayNamespaceValue(argsText: string): string {
  const match = argsText.match(/namespace\s*:\s*['"`]([^'"`]*)['"`]/);
  return match ? match[1]! : '';
}

function computeClassScopes(source: string): ClassScopeRange[] {
  const classDecorators: Array<{ kind: NestClassRole; name: string; getPrefix: (a: string) => string }> = [
    { kind: 'controller', name: 'Controller', getPrefix: parseControllerRoutePrefix },
    { kind: 'resolver', name: 'Resolver', getPrefix: () => '' },
    { kind: 'gateway', name: 'WebSocketGateway', getPrefix: parseGatewayNamespaceValue },
    { kind: 'other', name: 'Injectable', getPrefix: () => '' },
    { kind: 'other', name: 'Module', getPrefix: () => '' },
    { kind: 'other', name: 'Catch', getPrefix: () => '' },
  ];

  const found: Array<{ kind: NestClassRole; prefix: string; index: number }> = [];
  for (const def of classDecorators) {
    for (const dec of scanDecorators(source, [def.name])) {
      found.push({ kind: def.kind, prefix: def.getPrefix(dec.args), index: dec.index });
    }
  }

  found.sort((a, b) => a.index - b.index);

  return found.map((item, idx) => ({
    kind: item.kind,
    prefix: item.prefix,
    start: item.index,
    end: idx + 1 < found.length ? found[idx + 1]!.index : source.length,
  }));
}

function locateEnclosingScope(scopes: ClassScopeRange[], charIndex: number): ClassScopeRange | null {
  for (const s of scopes) {
    if (charIndex >= s.start && charIndex < s.end) return s;
  }
  return null;
}

function buildJoinedHttpPath(prefix: string, endpoint: string): string {
  const segments = [prefix, endpoint]
    .map((p) => p.trim().replace(/^\/+|\/+$/g, ''))
    .filter((p) => p.length > 0);
  return `/${segments.join('/')}`;
}

function parseGraphqlOperationIdentifier(argsText: string, fallbackMethod: string | null): string {
  const namePropertyMatch = argsText.match(/name\s*:\s*['"`]([^'"`]*)['"`]/);
  if (namePropertyMatch) return namePropertyMatch[1]!;

  const leadingLiteralMatch = argsText.match(/^\s*['"`]([^'"`]*)['"`]/);
  if (leadingLiteralMatch) return leadingLiteralMatch[1]!;

  return fallbackMethod ?? '';
}

function detectFileScriptLanguage(filePath: string): SupportedJsLanguage {
  return filePath.endsWith('.ts') || filePath.endsWith('.tsx') ? 'typescript' : 'javascript';
}

function findMatchingBraceOrBracket(str: string, openIndex: number): number {
  const openCh = str[openIndex];
  if (openCh !== '[' && openCh !== '{' && openCh !== '(') return -1;

  let depth = 0;
  let activeQuote: string | null = null;

  for (let i = openIndex; i < str.length; i++) {
    const ch = str[i]!;
    if (activeQuote) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === activeQuote) activeQuote = null;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      activeQuote = ch;
      continue;
    }

    if (ch === '{' || ch === '[' || ch === '(') depth++;
    else if (ch === '}' || ch === ']' || ch === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }

  return -1;
}

interface ParsedRouteNode {
  path: string;
  moduleName: string | null;
  children: ParsedRouteNode[];
}

function parseObjectBodyStringField(body: string, fieldName: string): string {
  const re = new RegExp(`(?:^|[,{\\s])${fieldName}\\s*:\\s*['"\`]([^'"\`]*)['"\`]`);
  const m = body.match(re);
  return m ? m[1]! : '';
}

function parseObjectBodyIdentifierField(body: string, fieldName: string): string | null {
  const re = new RegExp(`(?:^|[,{\\s])${fieldName}\\s*:\\s*([A-Za-z_$][\\w$]*)`);
  const m = body.match(re);
  return m ? m[1]! : null;
}

function parseObjectBodyArrayField(body: string, fieldName: string): string | null {
  const re = new RegExp(`(?:^|[,{\\s])${fieldName}\\s*:\\s*\\[`);
  const m = re.exec(body);
  if (!m) return null;

  const openPos = m.index + m[0].length - 1;
  const closePos = findMatchingBraceOrBracket(body, openPos);
  if (closePos < 0) return null;

  return body.slice(openPos + 1, closePos);
}

function splitObjectsAtTopLevel(content: string): string[] {
  const results: string[] = [];
  let depth = 0;
  let start = -1;
  let activeQuote: string | null = null;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i]!;
    if (activeQuote) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === activeQuote) activeQuote = null;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      activeQuote = ch;
      continue;
    }

    if (depth === 0 && ch === '{') {
      depth = 1;
      start = i;
      continue;
    }

    if (ch === '{' || ch === '[' || ch === '(') depth++;
    else if (ch === '}' || ch === ']' || ch === ')') {
      depth--;
      if (depth === 0 && start >= 0 && ch === '}') {
        results.push(content.slice(start + 1, i));
        start = -1;
      }
    }
  }

  return results;
}

function parseRouteItems(raw: string): ParsedRouteNode[] {
  const list: ParsedRouteNode[] = [];
  for (const obj of splitObjectsAtTopLevel(raw)) {
    const path = parseObjectBodyStringField(obj, 'path');
    const moduleName = parseObjectBodyIdentifierField(obj, 'module');
    const childrenBlock = parseObjectBodyArrayField(obj, 'children');
    const children = childrenBlock ? parseRouteItems(childrenBlock) : [];
    list.push({ path, moduleName, children });
  }
  return list;
}

function walkRouteTree(items: ParsedRouteNode[], currentPrefix: string, results: Map<string, string>): void {
  for (const item of items) {
    const cumulativePrefix = buildJoinedHttpPath(currentPrefix, item.path);
    if (item.moduleName && !results.has(item.moduleName)) {
      results.set(item.moduleName, cumulativePrefix);
    }
    if (item.children.length > 0) {
      walkRouteTree(item.children, cumulativePrefix, results);
    }
  }
}

function collectRouterModuleRegistrations(source: string, outPrefixes: Map<string, string>): void {
  const routerRegisterRegex = /\bRouterModule\s*\.\s*(?:register|forRoot|forChild)\s*\(/g;
  let m: RegExpExecArray | null;

  while ((m = routerRegisterRegex.exec(source)) !== null) {
    const openParen = m.index + m[0].length - 1;
    const parsed = parseBalancedParentheses(source, openParen);
    if (!parsed) continue;

    const trimmedArgs = parsed.args.trim();
    if (trimmedArgs.startsWith('[')) {
      const closeBracket = findMatchingBraceOrBracket(trimmedArgs, 0);
      if (closeBracket > 0) {
        const routes = parseRouteItems(trimmedArgs.slice(1, closeBracket));
        walkRouteTree(routes, '', outPrefixes);
      }
    }

    routerRegisterRegex.lastIndex = parsed.end;
  }
}

function scanDecoratedClassName(source: string, afterDecoratorEnd: number): string | null {
  let idx = afterDecoratorEnd;
  const whitespacePattern = /\s*/y;
  const decoratorPrefixPattern = /@[\w.]+/y;
  const classDeclPattern = /(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/y;

  const skipWhitespace = (): void => {
    whitespacePattern.lastIndex = idx;
    if (whitespacePattern.exec(source)) idx = whitespacePattern.lastIndex;
  };

  for (;;) {
    skipWhitespace();
    if (source[idx] !== '@') break;
    decoratorPrefixPattern.lastIndex = idx;
    if (!decoratorPrefixPattern.exec(source)) break;
    idx = decoratorPrefixPattern.lastIndex;
    skipWhitespace();
    if (source[idx] === '(') {
      const parsed = parseBalancedParentheses(source, idx);
      if (!parsed) return null;
      idx = parsed.end;
    }
  }

  skipWhitespace();
  classDeclPattern.lastIndex = idx;
  const match = classDeclPattern.exec(source);
  return match ? match[1]! : null;
}

function collectModuleControllers(source: string, outMapping: Map<string, string>): void {
  for (const hit of scanDecorators(source, ['Module'])) {
    const parentClass = scanDecoratedClassName(source, hit.end);
    if (!parentClass) continue;

    const controllersFieldText = parseObjectBodyArrayField(hit.args, 'controllers');
    if (!controllersFieldText) continue;

    const controllerNames = controllersFieldText
      .split(',')
      .map((s) => s.trim())
      .filter((s) => /^[A-Za-z_$][\w$]*$/.test(s));

    for (const ctrl of controllerNames) {
      if (!outMapping.has(ctrl)) {
        outMapping.set(ctrl, parentClass);
      }
    }
  }
}

function prependModulePrefixToRoute(route: Node, prefix: string): Node | null {
  const separator = '::';
  const sepIdx = route.qualifiedName.indexOf(separator);
  if (sepIdx < 0) return null;

  const suffix = route.qualifiedName.slice(sepIdx + separator.length);
  const colonIdx = suffix.indexOf(':');
  if (colonIdx < 0) return null;

  const method = suffix.slice(0, colonIdx);
  const rawOriginalPath = suffix.slice(colonIdx + 1);
  const updatedDisplayName = `${method} ${buildJoinedHttpPath(prefix, rawOriginalPath)}`;

  return {
    ...route,
    name: updatedDisplayName,
    updatedAt: Date.now(),
  };
}

export const nestjsResolver: FrameworkResolver = {
  name: 'nestjs',
  languages: ['typescript', 'javascript'],

  detect(context: ResolutionContext): boolean {
    for (const dep of declaredDependencies(context)) {
      if (dep.startsWith('@nestjs/')) return true;
    }

    const files = context.getAllFiles();
    for (const f of files) {
      if (
        f.endsWith('.controller.ts') ||
        f.endsWith('.controller.js') ||
        f.endsWith('.module.ts') ||
        f.endsWith('.resolver.ts') ||
        f.endsWith('.gateway.ts')
      ) {
        const text = context.readFile(f);
        if (
          text &&
          (text.includes('@nestjs/') ||
            text.includes('@Controller') ||
            text.includes('@Module(') ||
            text.includes('@Resolver(') ||
            text.includes('@WebSocketGateway('))
        ) {
          return true;
        }
      }
    }

    return false;
  },

  resolve(ref: UnresolvedRef, context: ResolutionContext): ResolvedRef | null {
    for (const [pattern, extensionPattern] of NEST_PROVIDER_CONVENTIONS) {
      if (!pattern.test(ref.referenceName)) continue;

      const candidateClasses = context
        .getNodesByName(ref.referenceName)
        .filter((n) => n.kind === 'class');

      if (candidateClasses.length === 0) return null;

      const matchedByConvention = candidateClasses.find((n) => n.filePath.includes(extensionPattern));
      const targetNode = matchedByConvention ?? candidateClasses[0]!;

      return {
        original: ref,
        targetNodeId: targetNode.id,
        confidence: matchedByConvention ? 0.85 : 0.7,
        resolvedBy: 'framework',
      };
    }

    return null;
  },

  extract(filePath: string, content: string): FrameworkExtractionResult {
    if (!/\.(m?js|tsx?|cjs)$/.test(filePath)) return { nodes: [], references: [] };

    const nodes: Node[] = [];
    const references: UnresolvedRef[] = [];
    const timestamp = Date.now();
    const docLang = detectFileScriptLanguage(filePath);
    const sanitized = stripCommentsForRegex(content, docLang);

    const recordRoute = (
      charIndex: number,
      method: string,
      routePath: string,
      length: number,
      handlerMethodName: string | null
    ): void => {
      const line = sanitized.slice(0, charIndex).split('\n').length;
      const node: Node = {
        id: `route:${filePath}:${line}:${method}:${routePath}`,
        kind: 'route',
        name: `${method} ${routePath}`,
        qualifiedName: `${filePath}::${method}:${routePath}`,
        filePath,
        startLine: line,
        endLine: line,
        startColumn: 0,
        endColumn: length,
        language: docLang,
        updatedAt: timestamp,
      };
      nodes.push(node);

      if (handlerMethodName) {
        references.push({
          fromNodeId: node.id,
          referenceName: handlerMethodName,
          referenceKind: 'references',
          line,
          column: 0,
          filePath,
          language: docLang,
        });
      }
    };

    const classScopes = computeClassScopes(sanitized);

    for (const dec of scanDecorators(sanitized, HTTP_VERB_DECORATORS)) {
      const scope = locateEnclosingScope(classScopes, dec.index);
      const prefix = scope && scope.kind === 'controller' ? scope.prefix : '';
      const path = buildJoinedHttpPath(prefix, extractFirstStringLiteral(dec.args));
      recordRoute(dec.index, dec.name.toUpperCase(), path, dec.length, scanMethodIdentifier(sanitized, dec.end));
    }

    for (const dec of scanDecorators(sanitized, GRAPHQL_DECORATORS)) {
      const scope = locateEnclosingScope(classScopes, dec.index);
      if (!scope || scope.kind !== 'resolver') continue;

      const handler = scanMethodIdentifier(sanitized, dec.end);
      const operationName = parseGraphqlOperationIdentifier(dec.args, handler);
      recordRoute(dec.index, dec.name.toUpperCase(), operationName, dec.length, handler);
    }

    for (const dec of scanDecorators(sanitized, ['MessagePattern', 'EventPattern'])) {
      const verb = dec.name === 'EventPattern' ? 'EVENT' : 'MESSAGE';
      const handler = scanMethodIdentifier(sanitized, dec.end);
      const patternName = extractFirstStringLiteral(dec.args) || handler || '';
      recordRoute(dec.index, verb, patternName, dec.length, handler);
    }

    for (const dec of scanDecorators(sanitized, ['SubscribeMessage'])) {
      const scope = locateEnclosingScope(classScopes, dec.index);
      const namespace = scope && scope.kind === 'gateway' ? scope.prefix : '';
      const handler = scanMethodIdentifier(sanitized, dec.end);
      const eventName = extractFirstStringLiteral(dec.args) || handler || '';
      const fullEvent = namespace ? `${namespace}:${eventName}` : eventName;
      recordRoute(dec.index, 'WS', fullEvent, dec.length, handler);
    }

    return { nodes, references };
  },

  postExtract(context: ResolutionContext): Node[] {
    const moduleToPrefix = new Map<string, string>();
    const controllerToModule = new Map<string, string>();

    for (const filePath of context.getAllFiles()) {
      if (!/\.module\.(m?[jt]s|cjs)$/.test(filePath)) continue;

      const content = context.readFile(filePath);
      if (!content) continue;

      const safe = stripCommentsForRegex(content, detectFileScriptLanguage(filePath));
      collectRouterModuleRegistrations(safe, moduleToPrefix);
      collectModuleControllers(safe, controllerToModule);
    }

    const controllerToPrefix = new Map<string, string>();
    for (const [ctrl, mod] of controllerToModule) {
      const prefix = moduleToPrefix.get(mod);
      if (prefix && prefix !== '' && prefix !== '/') {
        controllerToPrefix.set(ctrl, prefix);
      }
    }

    if (controllerToPrefix.size === 0) return [];

    const updatedRoutes: Node[] = [];
    for (const [controllerName, prefix] of controllerToPrefix) {
      const controllerClasses = context.getNodesByName(controllerName).filter((n) => n.kind === 'class');
      for (const cls of controllerClasses) {
        const fileRoutes = context.getNodesInFile(cls.filePath).filter((n) => n.kind === 'route');
        for (const route of fileRoutes) {
          if (route.startLine < cls.startLine || route.startLine > cls.endLine) {
            continue;
          }
          const modifiedNode = prependModulePrefixToRoute(route, prefix);
          if (modifiedNode && modifiedNode.name !== route.name) {
            updatedRoutes.push(modifiedNode);
          }
        }
      }
    }

    return updatedRoutes;
  },
};
