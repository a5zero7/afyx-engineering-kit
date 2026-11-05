/**
 * AFYX Engineering Kit - Express & Node.js Framework Resolver
 *
 * Implements route declaration extraction and handler reference resolution for Node.js backends:
 * 1. Express / Fastify / Koa endpoints (`app.get`, `router.post`, `router.route(...).get(...)`)
 * 2. Inline arrow handlers and response effects (`res.status`, `res.json`, `reply.send`)
 * 3. Mount-tree path prefix aggregation (`app.use('/api', router)`) via `postExtract`
 * 4. Middleware and Controller/Service method binding
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
import { resolveImportPath } from '../import-resolver';
import { dependsOn } from './package-deps';

function extractTrailingIdentifier(expression: string): string | null {
  const clean = expression.replace(/\s+/g, '').replace(/\(\)$/, '');
  const match = clean.match(/(?:\.|^)([A-Za-z_][A-Za-z0-9_]*)$/);
  return match ? match[1]! : null;
}

function findMatchingDelimiter(str: string, openPos: number, openChar: string, closeChar: string): number {
  let nesting = 0;
  for (let idx = openPos; idx < str.length; idx++) {
    const ch = str[idx];
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      idx++;
      while (idx < str.length && str[idx] !== quote) {
        if (str[idx] === '\\') idx++;
        idx++;
      }
      continue;
    }
    if (ch === openChar) nesting++;
    else if (ch === closeChar) {
      nesting--;
      if (nesting === 0) return idx;
    }
  }
  return -1;
}

const EXCLUDED_NOISE_CALLS: ReadonlySet<string> = new Set([
  'json', 'jsonp', 'send', 'sendStatus', 'sendFile', 'status', 'end', 'redirect',
  'render', 'set', 'get', 'header', 'type', 'format', 'attachment', 'download',
  'cookie', 'clearCookie', 'append', 'location', 'vary', 'links', 'accepts', 'is',
  'next', 'then', 'catch', 'finally', 'resolve', 'reject', 'all', 'race',
  'map', 'filter', 'forEach', 'reduce', 'find', 'push', 'pop', 'slice', 'splice',
  'includes', 'keys', 'values', 'entries', 'assign', 'parse', 'stringify',
  'log', 'error', 'warn', 'info', 'String', 'Number', 'Boolean', 'Array', 'Object',
  'Date', 'Math', 'JSON', 'Promise', 'require', 'fail',
]);

const RESPONSE_CHAIN_PATTERN =
  /\b(res|response|reply|rep|ctx)\s*\.\s*(?:[A-Za-z_$][\w$]*\s*\([^()]*\)\s*\.\s*)*([A-Za-z_$][\w$]*)\s*\(/g;

function collectResponseCallReferences(
  cleanContent: string,
  startOffset: number,
  endOffset: number,
  routeId: string,
  filePath: string,
  lang: 'typescript' | 'javascript'
): UnresolvedRef[] {
  const refs: UnresolvedRef[] = [];
  const bodyText = cleanContent.slice(startOffset, endOffset);
  RESPONSE_CHAIN_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = RESPONSE_CHAIN_PATTERN.exec(bodyText)) !== null) {
    const charPos = startOffset + match.index;
    const lineNumber = cleanContent.slice(0, charPos).split('\n').length;
    const colNumber = charPos - (cleanContent.lastIndexOf('\n', charPos - 1) + 1);

    refs.push({
      fromNodeId: routeId,
      referenceName: `${match[1]}.${match[2]}`,
      referenceKind: 'calls',
      line: lineNumber,
      column: colNumber,
      filePath,
      language: lang,
    });
  }

  return refs;
}

function parseTopLevelArguments(argsText: string): string[] {
  const argumentTokens: string[] = [];
  let depth = 0;
  let tokenStart = 0;

  for (let idx = 0; idx < argsText.length; idx++) {
    const ch = argsText[idx];
    if (ch === '"' || ch === "'" || ch === '`') {
      const q = ch;
      idx++;
      while (idx < argsText.length && argsText[idx] !== q) {
        if (argsText[idx] === '\\') idx++;
        idx++;
      }
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (ch === ',' && depth === 0) {
      argumentTokens.push(argsText.slice(tokenStart, idx));
      tokenStart = idx + 1;
    }
  }

  argumentTokens.push(argsText.slice(tokenStart));
  return argumentTokens;
}

function combinePathPrefixes(prefix: string, subPath: string): string {
  const cleanPrefix = prefix.replace(/\/+$/, '');
  const cleanSub = subPath.replace(/^\/+/, '');
  const assembled = cleanSub ? `${cleanPrefix}/${cleanSub}` : cleanPrefix;
  return assembled === '' ? '/' : assembled;
}

function resolveMountTargetFile(
  expr: string,
  cleanSource: string,
  callingFile: string,
  lang: 'typescript' | 'javascript',
  ctx: ResolutionContext
): string | null {
  const requireInlineMatch = /^require\s*\(\s*(['"])([^'"]+)\1\s*\)(?:\.\w+)?$/.exec(expr);
  if (requireInlineMatch) {
    return resolveImportPath(requireInlineMatch[2]!, callingFile, lang, ctx);
  }

  const identifierMatch = /^([A-Za-z_$][\w$]*)(?:\.(?:default|router|routes))?$/.exec(expr);
  if (!identifierMatch) return null;

  const varName = identifierMatch[1]!;
  const mapping = ctx.getImportMappings(callingFile, lang).find((im) => im.localName === varName);
  if (mapping) {
    return resolveImportPath(mapping.source, callingFile, lang, ctx);
  }

  const localRequireRegex = new RegExp(
    `\\b(?:const|let|var)\\s+${varName.replace(/\$/g, '\\$')}\\s*=\\s*require\\s*\\(\\s*(['"])([^'"]+)\\1\\s*\\)`
  );
  const localRequireMatch = localRequireRegex.exec(cleanSource);
  return localRequireMatch ? resolveImportPath(localRequireMatch[2]!, callingFile, lang, ctx) : null;
}

function isProbableMiddlewareIdentifier(name: string): boolean {
  const middlewareNames = [
    /^auth$/i,
    /^authenticate$/i,
    /^authorization$/i,
    /^validate/i,
    /^sanitize/i,
    /^rateLimit/i,
    /^cors$/i,
    /^helmet$/i,
    /^logger$/i,
    /^errorHandler$/i,
    /^notFound$/i,
    /Middleware$/i,
  ];

  return middlewareNames.some((pattern) => pattern.test(name));
}

function resolveMiddlewareTarget(name: string, ctx: ResolutionContext): string | null {
  const candidates = ctx.getNodesByName(name);
  const directMatch = candidates.find(
    (n) => n.name.toLowerCase() === name.toLowerCase() ||
           n.name.toLowerCase() === name.replace(/Middleware$/i, '').toLowerCase()
  );
  if (directMatch) return directMatch.id;

  const stem = name.replace(/Middleware$/i, '');
  if (stem !== name) {
    const stemCandidates = ctx.getNodesByName(stem);
    const preferred = stemCandidates.filter(
      (n) => n.filePath.includes('/middleware/') || n.filePath.includes('/middlewares/')
    );
    if (preferred.length > 0) return preferred[0]!.id;
    if (stemCandidates.length > 0) return stemCandidates[0]!.id;
  }

  return null;
}

function resolveControllerMethodTarget(
  controllerPrefix: string,
  actionMethod: string,
  ctx: ResolutionContext
): string | null {
  const methodCandidates = ctx.getNodesByName(actionMethod);
  const relevantMethods = methodCandidates.filter(
    (n) => (n.kind === 'method' || n.kind === 'function') &&
           n.filePath.toLowerCase().includes(controllerPrefix.toLowerCase())
  );
  if (relevantMethods.length > 0) return relevantMethods[0]!.id;

  const fullControllerName = `${controllerPrefix}Controller`;
  for (const ctrl of ctx.getNodesByName(fullControllerName)) {
    const fileNodes = ctx.getNodesInFile(ctrl.filePath);
    const matchedMethod = fileNodes.find(
      (n) => (n.kind === 'method' || n.kind === 'function') && n.name === actionMethod
    );
    if (matchedMethod) return matchedMethod.id;
  }

  return null;
}

function resolveServiceMethodTarget(
  serviceNamespace: string,
  methodName: string,
  ctx: ResolutionContext
): string | null {
  const methodCandidates = ctx.getNodesByName(methodName);
  const baseKeyword = serviceNamespace.replace(/(Service|Helper|Utils?)$/i, '').toLowerCase();
  const matchedServiceMethods = methodCandidates.filter(
    (n) => (n.kind === 'method' || n.kind === 'function') &&
           n.filePath.toLowerCase().includes(baseKeyword)
  );

  return matchedServiceMethods.length > 0 ? matchedServiceMethods[0]!.id : null;
}

function inferSourceLanguage(filePath: string): 'typescript' | 'javascript' {
  return filePath.endsWith('.ts') || filePath.endsWith('.tsx') ? 'typescript' : 'javascript';
}

export const expressResolver: FrameworkResolver = {
  name: 'express',
  languages: ['javascript', 'typescript'],

  detect(context: ResolutionContext): boolean {
    if (dependsOn(context, 'express', 'fastify', 'koa', 'hapi', '@hapi/hapi')) return true;

    for (const file of context.getAllFiles()) {
      if (file.includes('routes') || file.includes('controllers') || file.includes('middleware')) {
        const text = context.readFile(file);
        if (text && (text.includes('express') || text.includes('app.get') || text.includes('router.get'))) {
          return true;
        }
      }
    }

    return false;
  },

  resolve(ref: UnresolvedRef, context: ResolutionContext): ResolvedRef | null {
    if (isProbableMiddlewareIdentifier(ref.referenceName)) {
      const mwId = resolveMiddlewareTarget(ref.referenceName, context);
      if (mwId) {
        return {
          original: ref,
          targetNodeId: mwId,
          confidence: 0.8,
          resolvedBy: 'framework',
        };
      }
    }

    const controllerMatch = ref.referenceName.match(/^(\w+)Controller\.(\w+)$/);
    if (controllerMatch) {
      const targetId = resolveControllerMethodTarget(controllerMatch[1]!, controllerMatch[2]!, context);
      if (targetId) {
        return {
          original: ref,
          targetNodeId: targetId,
          confidence: 0.85,
          resolvedBy: 'framework',
        };
      }
    }

    const serviceMatch = ref.referenceName.match(/^(\w+)(Service|Helper|Utils?)\.(\w+)$/);
    if (serviceMatch) {
      const targetId = resolveServiceMethodTarget(`${serviceMatch[1]!}${serviceMatch[2]!}`, serviceMatch[3]!, context);
      if (targetId) {
        return {
          original: ref,
          targetNodeId: targetId,
          confidence: 0.8,
          resolvedBy: 'framework',
        };
      }
    }

    return null;
  },

  extract(filePath: string, content: string): FrameworkExtractionResult {
    if (!/\.(m?js|tsx?|cjs)$/.test(filePath)) return { nodes: [], references: [] };

    const nodes: Node[] = [];
    const references: UnresolvedRef[] = [];
    const timestamp = Date.now();
    const docLang = inferSourceLanguage(filePath);
    const sanitized = stripCommentsForRegex(content, docLang);

    const routeCallHeadPattern = /\b(app|router)\s*\.\s*(get|post|put|patch|delete|all|use)\s*\(\s*['"]([^'"]+)['"]\s*,/g;
    let match: RegExpExecArray | null;

    while ((match = routeCallHeadPattern.exec(sanitized)) !== null) {
      const httpVerb = match[2]!;
      const endpointPath = match[3]!;
      if (httpVerb === 'use' && !endpointPath.startsWith('/')) continue;

      const lineNumber = sanitized.slice(0, match.index).split('\n').length;
      const routeNode: Node = {
        id: `route:${filePath}:${lineNumber}:${httpVerb.toUpperCase()}:${endpointPath}`,
        kind: 'route',
        name: `${httpVerb.toUpperCase()} ${endpointPath}`,
        qualifiedName: `${filePath}::${httpVerb.toUpperCase()}:${endpointPath}`,
        filePath,
        startLine: lineNumber,
        endLine: lineNumber,
        startColumn: 0,
        endColumn: match[0].length,
        language: docLang,
        updatedAt: timestamp,
      };
      nodes.push(routeNode);

      const openParenIdx = sanitized.indexOf('(', match.index);
      const closeParenIdx = openParenIdx >= 0 ? findMatchingDelimiter(sanitized, openParenIdx, '(', ')') : -1;
      const callArgs = closeParenIdx > openParenIdx ? sanitized.slice(openParenIdx + 1, closeParenIdx) : '';
      const arrowPos = callArgs.indexOf('=>');

      if (arrowPos >= 0) {
        const afterArrow = callArgs.slice(arrowPos + 2);
        const bracePos = afterArrow.indexOf('{');
        let bodyBlock = afterArrow;
        let bodyStartOffset = openParenIdx + 1 + arrowPos + 2;

        if (bracePos >= 0 && afterArrow.slice(0, bracePos).trim() === '') {
          const matchingBrace = findMatchingDelimiter(afterArrow, bracePos, '{', '}');
          if (matchingBrace > bracePos) {
            bodyBlock = afterArrow.slice(bracePos + 1, matchingBrace);
            bodyStartOffset += bracePos + 1;
          }
        }

        const callRegex = /\b([A-Za-z_$][\w$]*)\s*\(/g;
        const recordedCalls = new Set<string>();
        let callMatch: RegExpExecArray | null;

        while ((callMatch = callRegex.exec(bodyBlock)) !== null) {
          const fnName = callMatch[1]!;
          if (recordedCalls.has(fnName) || EXCLUDED_NOISE_CALLS.has(fnName)) continue;
          recordedCalls.add(fnName);

          references.push({
            fromNodeId: routeNode.id,
            referenceName: fnName,
            referenceKind: 'calls',
            line: lineNumber,
            column: 0,
            filePath,
            language: docLang,
          });
        }

        references.push(
          ...collectResponseCallReferences(
            sanitized,
            bodyStartOffset,
            bodyStartOffset + bodyBlock.length,
            routeNode.id,
            filePath,
            docLang
          )
        );
      } else {
        const tokens = callArgs.split(',').map((s) => s.trim()).filter(Boolean);
        const handlerIdentifier = tokens[tokens.length - 1] ? extractTrailingIdentifier(tokens[tokens.length - 1]!) : null;

        if (handlerIdentifier) {
          references.push({
            fromNodeId: routeNode.id,
            referenceName: handlerIdentifier,
            referenceKind: 'references',
            line: lineNumber,
            column: 0,
            filePath,
            language: docLang,
          });
        }
      }
    }

    const routeChainPattern = /\b(?:app|router)\s*\.\s*route\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = routeChainPattern.exec(sanitized)) !== null) {
      const endpointPath = match[1]!;
      let scanOffset = match.index + match[0].length;

      for (;;) {
        const methodLink = /^\s*\.\s*(get|post|put|patch|delete|all)\s*\(/.exec(sanitized.slice(scanOffset, scanOffset + 64));
        if (!methodLink) break;

        const openParen = scanOffset + methodLink[0].length - 1;
        const closeParen = findMatchingDelimiter(sanitized, openParen, '(', ')');
        if (closeParen < 0) break;

        const verb = methodLink[1]!;
        const linkLine = sanitized.slice(0, openParen).split('\n').length;
        const chainedArgs = sanitized.slice(openParen + 1, closeParen);

        const routeNode: Node = {
          id: `route:${filePath}:${linkLine}:${verb.toUpperCase()}:${endpointPath}`,
          kind: 'route',
          name: `${verb.toUpperCase()} ${endpointPath}`,
          qualifiedName: `${filePath}::${verb.toUpperCase()}:${endpointPath}`,
          filePath,
          startLine: linkLine,
          endLine: linkLine,
          startColumn: 0,
          endColumn: methodLink[0].length,
          language: docLang,
          updatedAt: timestamp,
        };
        nodes.push(routeNode);

        if (chainedArgs.includes('=>')) {
          const callRegex = /\b([A-Za-z_$][\w$]*)\s*\(/g;
          const seen = new Set<string>();
          let cm: RegExpExecArray | null;
          while ((cm = callRegex.exec(chainedArgs)) !== null) {
            const name = cm[1]!;
            if (seen.has(name) || EXCLUDED_NOISE_CALLS.has(name)) continue;
            seen.add(name);
            references.push({
              fromNodeId: routeNode.id,
              referenceName: name,
              referenceKind: 'calls',
              line: linkLine,
              column: 0,
              filePath,
              language: docLang,
            });
          }
          references.push(
            ...collectResponseCallReferences(sanitized, openParen + 1, closeParen, routeNode.id, filePath, docLang)
          );
        } else {
          const argList = parseTopLevelArguments(chainedArgs).map((s) => s.trim()).filter(Boolean);
          const lastHandler = argList[argList.length - 1] ? extractTrailingIdentifier(argList[argList.length - 1]!) : null;
          if (lastHandler) {
            references.push({
              fromNodeId: routeNode.id,
              referenceName: lastHandler,
              referenceKind: 'references',
              line: linkLine,
              column: 0,
              filePath,
              language: docLang,
            });
          }
        }

        scanOffset = closeParen + 1;
      }
    }

    return { nodes, references };
  },

  postExtract(context: ResolutionContext): Node[] {
    const candidateFiles = context.getAllFiles().filter((f) => /\.(m?js|tsx?|cjs)$/.test(f));
    const mountRegistrations = new Map<string, Array<{ prefix: string; target: string }>>();

    for (const filePath of candidateFiles) {
      const fileSource = context.readFile(filePath);
      if (!fileSource || !fileSource.includes('.use(')) continue;

      const lang = inferSourceLanguage(filePath);
      const clean = stripCommentsForRegex(fileSource, lang);
      const useMountPattern = /\b[A-Za-z_$][\w$]*\.use\s*\(\s*(['"`])(\/[^'"`]*)\1\s*,/g;
      let m: RegExpExecArray | null;

      while ((m = useMountPattern.exec(clean)) !== null) {
        const openPos = clean.indexOf('(', m.index);
        const closePos = openPos >= 0 ? findMatchingDelimiter(clean, openPos, '(', ')') : -1;
        if (closePos < 0) continue;

        const args = parseTopLevelArguments(clean.slice(openPos + 1, closePos));
        const lastArg = args[args.length - 1]?.trim() ?? '';
        const targetFile = resolveMountTargetFile(lastArg, clean, filePath, lang, context);

        if (!targetFile || targetFile === filePath) continue;

        const existing = mountRegistrations.get(filePath) ?? [];
        existing.push({ prefix: m[2]!, target: targetFile });
        mountRegistrations.set(filePath, existing);
      }
    }

    if (mountRegistrations.size === 0) return [];

    let computedPrefixes = new Map<string, string>();
    for (let iteration = 0; iteration < 8; iteration++) {
      const nextIterationMap = new Map<string, string>();
      const ambiguousMounts = new Set<string>();

      for (const [sourceFile, targets] of mountRegistrations) {
        const base = computedPrefixes.get(sourceFile) ?? '';
        for (const { prefix, target } of targets) {
          const fullRoutePrefix = combinePathPrefixes(base, prefix);
          const existing = nextIterationMap.get(target);
          if (existing !== undefined && existing !== fullRoutePrefix) {
            ambiguousMounts.add(target);
          } else {
            nextIterationMap.set(target, fullRoutePrefix);
          }
        }
      }

      for (const ambig of ambiguousMounts) {
        nextIterationMap.delete(ambig);
      }

      let hasChanged = nextIterationMap.size !== computedPrefixes.size;
      if (!hasChanged) {
        for (const [k, v] of nextIterationMap) {
          if (computedPrefixes.get(k) !== v) {
            hasChanged = true;
            break;
          }
        }
      }

      computedPrefixes = nextIterationMap;
      if (!hasChanged) break;
    }

    const updatedNodes: Node[] = [];
    for (const [file, prefix] of computedPrefixes) {
      if (prefix === '' || prefix === '/') continue;

      for (const node of context.getNodesInFile(file)) {
        if (node.kind !== 'route') continue;

        const qualSep = node.qualifiedName.indexOf('::');
        if (qualSep < 0) continue;

        const colonPos = node.qualifiedName.indexOf(':', qualSep + 2);
        if (colonPos < 0) continue;

        const verb = node.qualifiedName.slice(qualSep + 2, colonPos);
        const originalPath = node.qualifiedName.slice(colonPos + 1);
        if (!originalPath.startsWith('/')) continue;

        const updatedName = `${verb} ${combinePathPrefixes(prefix, originalPath)}`;
        if (updatedName !== node.name) {
          updatedNodes.push({ ...node, name: updatedName });
        }
      }
    }

    return updatedNodes;
  },
};
