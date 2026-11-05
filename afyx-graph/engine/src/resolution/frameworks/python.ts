/**
 * AFYX Engineering Kit - Python Framework Resolver (Django, Flask, FastAPI)
 *
 * Provides route extraction, handler binding, and cross-module route prefixing for Python web frameworks:
 * 1. Django: URLconfs (`path`, `re_path`, `url`), DRF ViewSet routers, Model/View/Form resolution,
 *    and QuerySet._iterable_class dynamic dispatch bridging.
 * 2. Flask: `@app.route` / `@bp.route` endpoints, Flask-RESTful `add_resource`.
 * 3. FastAPI: `@router.<method>` decorators, dependency injection bindings, and
 *    recursive `include_router(prefix=...)` prefix composition in `postExtract`.
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

const MODEL_DIRECTORIES: readonly string[] = ['models', 'app/models', 'src/models'];
const VIEW_DIRECTORIES: readonly string[] = ['views', 'app/views', 'src/views', 'api/views'];
const FORM_DIRECTORIES: readonly string[] = ['forms', 'app/forms', 'src/forms'];
const ROUTER_DIRECTORIES: readonly string[] = ['/routers/', '/api/', '/routes/', '/endpoints/'];
const DEPENDENCY_DIRECTORIES: readonly string[] = ['/dependencies/', '/deps/', '/core/'];

const CLASS_NODE_KINDS: ReadonlySet<string> = new Set(['class']);
const VIEW_NODE_KINDS: ReadonlySet<string> = new Set(['class', 'function']);
const VARIABLE_NODE_KINDS: ReadonlySet<string> = new Set(['variable']);
const FUNCTION_NODE_KINDS: ReadonlySet<string> = new Set(['function']);

function locateSymbolByKindAndDirectory(
  symbolName: string,
  allowedKinds: ReadonlySet<string>,
  directoryPatterns: readonly string[],
  context: ResolutionContext
): string | null {
  const matches = context.getNodesByName(symbolName);
  if (matches.length === 0) return null;

  const validKinds = matches.filter((n) => allowedKinds.has(n.kind));
  if (validKinds.length === 0) return null;

  if (directoryPatterns.length > 0) {
    const favored = validKinds.filter((n) =>
      directoryPatterns.some((pattern) => n.filePath.includes(pattern))
    );
    if (favored.length > 0) return favored[0]!.id;
  }

  return validKinds[0]!.id;
}

function resolveDjangoModelIterable(ctx: ResolutionContext): string | null {
  const modelIterableCls = ctx.getNodesByName('ModelIterable').find((n) => n.kind === 'class');
  if (!modelIterableCls) return null;

  const iterMethod = ctx.getNodesByName('__iter__').find(
    (n) => n.filePath === modelIterableCls.filePath &&
           n.startLine >= modelIterableCls.startLine &&
           n.startLine <= modelIterableCls.endLine
  );
  return iterMethod ? iterMethod.id : null;
}

function parseDjangoUrlHandlerExpression(expression: string): { name: string; kind: 'references' | 'imports' } | null {
  const includeMatch = expression.match(/^include\s*\(\s*['"]([^'"]+)['"]/);
  if (includeMatch) return { name: includeMatch[1]!, kind: 'imports' };

  let trimmed = expression.replace(/\.as_view\s*\([^)]*\)\s*$/, '');
  trimmed = trimmed.replace(/\.\w+\s*\([^)]*\)\s*$/, '');

  const tokens = trimmed.split('.').filter(Boolean);
  if (tokens.length === 0) return null;

  const finalToken = tokens[tokens.length - 1]!;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(finalToken)) return null;

  return { name: finalToken, kind: 'references' };
}

export const djangoResolver: FrameworkResolver = {
  name: 'django',
  languages: ['python'],

  detect(context: ResolutionContext): boolean {
    const reqs = context.readFile('requirements.txt');
    if (reqs && reqs.toLowerCase().includes('django')) return true;

    const setup = context.readFile('setup.py');
    if (setup && setup.toLowerCase().includes('django')) return true;

    const pyproj = context.readFile('pyproject.toml');
    if (pyproj && pyproj.toLowerCase().includes('django')) return true;

    return context.fileExists('manage.py');
  },

  claimsReference(name: string): boolean {
    return name === '_iterable_class' || name.endsWith('.urls');
  },

  resolve(ref: UnresolvedRef, context: ResolutionContext): ResolvedRef | null {
    if (ref.referenceName.endsWith('Model') || /^[A-Z][a-z]+$/.test(ref.referenceName)) {
      const match = locateSymbolByKindAndDirectory(ref.referenceName, CLASS_NODE_KINDS, MODEL_DIRECTORIES, context);
      if (match) return { original: ref, targetNodeId: match, confidence: 0.8, resolvedBy: 'framework' };
    }

    if (ref.referenceName.endsWith('View') || ref.referenceName.endsWith('ViewSet')) {
      const match = locateSymbolByKindAndDirectory(ref.referenceName, VIEW_NODE_KINDS, VIEW_DIRECTORIES, context);
      if (match) return { original: ref, targetNodeId: match, confidence: 0.8, resolvedBy: 'framework' };
    }

    if (ref.referenceName.endsWith('Form')) {
      const match = locateSymbolByKindAndDirectory(ref.referenceName, CLASS_NODE_KINDS, FORM_DIRECTORIES, context);
      if (match) return { original: ref, targetNodeId: match, confidence: 0.8, resolvedBy: 'framework' };
    }

    if (ref.referenceName === '_iterable_class') {
      const iterId = resolveDjangoModelIterable(context);
      if (iterId) return { original: ref, targetNodeId: iterId, confidence: 0.7, resolvedBy: 'framework' };
    }

    return null;
  },

  extract(filePath: string, content: string): FrameworkExtractionResult {
    if (!filePath.endsWith('.py')) return { nodes: [], references: [] };

    const nodes: Node[] = [];
    const references: UnresolvedRef[] = [];
    const timestamp = Date.now();
    const sanitized = stripCommentsForRegex(content, 'python');

    const djangoUrlPattern = /\b(path|re_path|url)\s*\(\s*r?['"]([^'"]+)['"]\s*,\s*([\w.]+(?:\s*\([^)]*\))?)/g;
    let match: RegExpExecArray | null;

    while ((match = djangoUrlPattern.exec(sanitized)) !== null) {
      const endpoint = match[2]!;
      const handlerStr = match[3]!;
      const lineNum = sanitized.slice(0, match.index).split('\n').length;

      const routeNode: Node = {
        id: `route:${filePath}:${lineNum}:${endpoint}`,
        kind: 'route',
        name: endpoint,
        qualifiedName: `${filePath}::route:${endpoint}`,
        filePath,
        startLine: lineNum,
        endLine: lineNum,
        startColumn: 0,
        endColumn: match[0].length,
        language: 'python',
        updatedAt: timestamp,
      };
      nodes.push(routeNode);

      const target = parseDjangoUrlHandlerExpression(handlerStr.trim());
      if (target) {
        references.push({
          fromNodeId: routeNode.id,
          referenceName: target.name,
          referenceKind: target.kind,
          line: lineNum,
          column: 0,
          filePath,
          language: 'python',
        });
      }
    }

    const drfRegisterPattern = /\.register\s*\(\s*r?['"]([^'"]+)['"]\s*,\s*([\w.]+)/g;
    while ((match = drfRegisterPattern.exec(sanitized)) !== null) {
      const rawPrefix = match[1]!.replace(/^\^|\/?\$$/g, '');
      const viewsetClass = match[2]!.split('.').pop()!;
      if (!/View(Set)?$/.test(viewsetClass)) continue;

      const lineNum = sanitized.slice(0, match.index).split('\n').length;
      const routeNode: Node = {
        id: `route:${filePath}:${lineNum}:VIEWSET:${rawPrefix}`,
        kind: 'route',
        name: `VIEWSET /${rawPrefix}`,
        qualifiedName: `${filePath}::route:${rawPrefix}`,
        filePath,
        startLine: lineNum,
        endLine: lineNum,
        startColumn: 0,
        endColumn: match[0].length,
        language: 'python',
        updatedAt: timestamp,
      };
      nodes.push(routeNode);

      references.push({
        fromNodeId: routeNode.id,
        referenceName: viewsetClass,
        referenceKind: 'references',
        line: lineNum,
        column: 0,
        filePath,
        language: 'python',
      });
    }

    return { nodes, references };
  },
};

interface PythonDecoratorConfig {
  regex: RegExp;
  defaultVerb: string;
  verbGroupIndex?: number;
  verbFromListGroupIndex?: number;
  pathGroupIndex: number;
}

function extractPythonDecoratorEndpoints(
  filePath: string,
  sanitized: string,
  cfg: PythonDecoratorConfig
): FrameworkExtractionResult {
  const nodes: Node[] = [];
  const references: UnresolvedRef[] = [];
  const timestamp = Date.now();
  let m: RegExpExecArray | null;

  while ((m = cfg.regex.exec(sanitized)) !== null) {
    const rawPath = m[cfg.pathGroupIndex];
    let methodVerb = cfg.defaultVerb;

    if (cfg.verbGroupIndex && m[cfg.verbGroupIndex]) {
      methodVerb = m[cfg.verbGroupIndex]!.toUpperCase();
    } else if (cfg.verbFromListGroupIndex && m[cfg.verbFromListGroupIndex]) {
      const verbMatch = m[cfg.verbFromListGroupIndex]!.match(/['"]([A-Z]+)['"]/i);
      if (verbMatch) methodVerb = verbMatch[1]!.toUpperCase();
    }

    const lineNum = sanitized.slice(0, m.index).split('\n').length;
    const displayName = methodVerb ? `${methodVerb} ${rawPath || '/'}` : (rawPath || '/');

    const routeNode: Node = {
      id: `route:${filePath}:${lineNum}:${methodVerb}:${rawPath}`,
      kind: 'route',
      name: displayName,
      qualifiedName: `${filePath}::${methodVerb}:${rawPath}`,
      filePath,
      startLine: lineNum,
      endLine: lineNum,
      startColumn: 0,
      endColumn: m[0].length,
      language: 'python',
      updatedAt: timestamp,
    };
    nodes.push(routeNode);

    const followingText = sanitized.slice(m.index + m[0].length);
    const defMatch = followingText.match(/\n\s*(?:async\s+)?def\s+(\w+)/);
    if (defMatch) {
      references.push({
        fromNodeId: routeNode.id,
        referenceName: defMatch[1]!,
        referenceKind: 'references',
        line: lineNum,
        column: 0,
        filePath,
        language: 'python',
      });
    }
  }

  return { nodes, references };
}

function extractFlaskRestfulResources(filePath: string, source: string): FrameworkExtractionResult {
  const nodes: Node[] = [];
  const references: UnresolvedRef[] = [];
  const timestamp = Date.now();
  const pattern = /\.add\w*[Rr]esource\s*\(\s*(\w+)\s*,\s*((?:['"][^'"]+['"]\s*,?\s*)+)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(source)) !== null) {
    const resourceCls = match[1]!;
    const paths = (match[2]!.match(/['"]([^'"]+)['"]/g) || []).map((s) => s.slice(1, -1));
    const lineNum = source.slice(0, match.index).split('\n').length;

    for (const urlPath of paths) {
      const routeNode: Node = {
        id: `route:${filePath}:${lineNum}:ANY:${urlPath}`,
        kind: 'route',
        name: `ANY ${urlPath}`,
        qualifiedName: `${filePath}::ANY:${urlPath}`,
        filePath,
        startLine: lineNum,
        endLine: lineNum,
        startColumn: 0,
        endColumn: 0,
        language: 'python',
        updatedAt: timestamp,
      };
      nodes.push(routeNode);

      references.push({
        fromNodeId: routeNode.id,
        referenceName: resourceCls,
        referenceKind: 'references',
        line: lineNum,
        column: 0,
        filePath,
        language: 'python',
      });
    }
  }

  return { nodes, references };
}

export const flaskResolver: FrameworkResolver = {
  name: 'flask',
  languages: ['python'],

  detect(context: ResolutionContext): boolean {
    for (const conf of ['requirements.txt', 'pyproject.toml', 'Pipfile', 'setup.py']) {
      const text = context.readFile(conf);
      if (text && /\bflask\b/i.test(text)) return true;
    }

    const appCandidates = context
      .getAllFiles()
      .filter((p) => /(?:^|\/)(app|application|main|wsgi|__init__)\.py$/.test(p))
      .slice(0, 50);

    for (const f of appCandidates) {
      const text = context.readFile(f);
      if (text && /\bFlask\s*\(/.test(text) && /\bimport\s+flask\b|\bfrom\s+flask\b/.test(text)) {
        return true;
      }
    }

    return false;
  },

  resolve(ref: UnresolvedRef, context: ResolutionContext): ResolvedRef | null {
    if (ref.referenceName.endsWith('_bp') || ref.referenceName.endsWith('_blueprint')) {
      const match = locateSymbolByKindAndDirectory(ref.referenceName, VARIABLE_NODE_KINDS, [], context);
      if (match) return { original: ref, targetNodeId: match, confidence: 0.8, resolvedBy: 'framework' };
    }

    return null;
  },

  extract(filePath: string, content: string): FrameworkExtractionResult {
    if (!filePath.endsWith('.py')) return { nodes: [], references: [] };

    const sanitized = stripCommentsForRegex(content, 'python');
    const decoratorRoutes = extractPythonDecoratorEndpoints(filePath, sanitized, {
      regex: /@(\w+)\.route\s*\(\s*['"]([^'"]*)['"](?:\s*,\s*methods\s*=\s*[[(]([^\])]+)[\])])?\s*\)/g,
      defaultVerb: 'GET',
      verbFromListGroupIndex: 3,
      pathGroupIndex: 2,
    });
    const restfulRoutes = extractFlaskRestfulResources(filePath, sanitized);

    return {
      nodes: [...decoratorRoutes.nodes, ...restfulRoutes.nodes],
      references: [...decoratorRoutes.references, ...restfulRoutes.references],
    };
  },
};

function combinePythonRoutePaths(prefix: string, subPath: string): string {
  const p1 = prefix.replace(/\/+$/, '');
  const p2 = subPath.replace(/^\/+/, '');
  if (!p1) return p2 ? `/${p2}` : '';
  return p2 ? `${p1}/${p2}` : p1;
}

function resolveFastApiIncludedRouter(
  targetExpr: string,
  sourceFile: string,
  localVars: Map<string, string>,
  ctx: ResolutionContext
): { file: string; variable: string } | null {
  const segments = targetExpr.split('.');
  const primaryName = segments[0]!;

  if (segments.length === 1 && localVars.has(primaryName)) {
    return { file: sourceFile, variable: primaryName };
  }

  const mapping = ctx.getImportMappings(sourceFile, 'python').find((im) => im.localName === primaryName);
  if (!mapping) return null;

  if (segments.length > 1) {
    const importedModule =
      resolveImportPath(`${mapping.source}.${mapping.exportedName}`, sourceFile, 'python', ctx) ??
      resolveImportPath(mapping.source, sourceFile, 'python', ctx);

    return importedModule ? { file: importedModule, variable: segments[segments.length - 1]! } : null;
  }

  const directModule = resolveImportPath(mapping.source, sourceFile, 'python', ctx);
  return directModule ? { file: directModule, variable: mapping.exportedName } : null;
}

export const fastapiResolver: FrameworkResolver = {
  name: 'fastapi',
  languages: ['python'],

  detect(context: ResolutionContext): boolean {
    const reqs = context.readFile('requirements.txt');
    if (reqs && /\bfastapi\b/i.test(reqs)) return true;

    const pyproj = context.readFile('pyproject.toml');
    if (pyproj && /\bfastapi\b/i.test(pyproj)) return true;

    for (const rootFile of ['app.py', 'main.py', 'api.py']) {
      const src = context.readFile(rootFile);
      if (src && src.includes('FastAPI(')) return true;
    }

    let scannedFiles = 0;
    for (const f of context.getAllFiles()) {
      const normalized = f.replace(/\\/g, '/');
      const filename = normalized.slice(normalized.lastIndexOf('/') + 1);

      if (filename === 'requirements.txt' || filename === 'pyproject.toml' || filename === 'requirements-dev.txt') {
        const text = context.readFile(f);
        if (text && /\bfastapi\b/i.test(text)) return true;
        if (++scannedFiles >= 40) break;
      } else if ((filename === 'main.py' || filename === 'app.py' || filename === 'api.py') && normalized.split('/').length <= 4) {
        const text = context.readFile(f);
        if (text && text.includes('FastAPI(')) return true;
        if (++scannedFiles >= 40) break;
      }
    }

    return false;
  },

  resolve(ref: UnresolvedRef, context: ResolutionContext): ResolvedRef | null {
    if (ref.referenceName.endsWith('_router') || ref.referenceName === 'router') {
      const target = locateSymbolByKindAndDirectory(ref.referenceName, VARIABLE_NODE_KINDS, ROUTER_DIRECTORIES, context);
      if (target) return { original: ref, targetNodeId: target, confidence: 0.8, resolvedBy: 'framework' };
    }

    if (ref.referenceName.startsWith('get_') || ref.referenceName.startsWith('Depends')) {
      const target = locateSymbolByKindAndDirectory(ref.referenceName, FUNCTION_NODE_KINDS, DEPENDENCY_DIRECTORIES, context);
      if (target) return { original: ref, targetNodeId: target, confidence: 0.75, resolvedBy: 'framework' };
    }

    return null;
  },

  extract(filePath: string, content: string): FrameworkExtractionResult {
    if (!filePath.endsWith('.py')) return { nodes: [], references: [] };

    const clean = stripCommentsForRegex(content, 'python');
    return extractPythonDecoratorEndpoints(filePath, clean, {
      regex: /@(\w+)\.(get|post|put|patch|delete|options|head)\s*\(\s*['"]([^'"]*)['"]/g,
      defaultVerb: '',
      verbGroupIndex: 2,
      pathGroupIndex: 3,
    });
  },

  postExtract(context: ResolutionContext): Node[] {
    interface SubRouterMount {
      fromVar: string;
      prefix: string;
      target: { file: string; variable: string };
    }

    const localRouterPrefixes = new Map<string, Map<string, string>>();
    const mountsByFile = new Map<string, SubRouterMount[]>();
    const lineToRouterVar = new Map<string, Map<number, string>>();

    for (const filePath of context.getAllFiles()) {
      if (!filePath.endsWith('.py')) continue;

      const fileContent = context.readFile(filePath);
      if (!fileContent || (!fileContent.includes('APIRouter') && !fileContent.includes('include_router'))) {
        continue;
      }

      const cleanSource = stripCommentsForRegex(fileContent, 'python');
      const varMap = new Map<string, string>();
      const routerDeclRegex = /\b([A-Za-z_]\w*)\s*=\s*APIRouter\s*\(([^)]*)\)/g;
      let m: RegExpExecArray | null;

      while ((m = routerDeclRegex.exec(cleanSource)) !== null) {
        const prefixParamMatch = /\bprefix\s*=\s*['"]([^'"]*)['"]/.exec(m[2]!);
        varMap.set(m[1]!, prefixParamMatch ? prefixParamMatch[1]! : '');
      }
      localRouterPrefixes.set(filePath, varMap);

      const methodToVar = new Map<number, string>();
      const methodDecorPattern = /@([A-Za-z_]\w*)\.(?:get|post|put|patch|delete|options|head)\s*\(/g;
      while ((m = methodDecorPattern.exec(cleanSource)) !== null) {
        methodToVar.set(cleanSource.slice(0, m.index).split('\n').length, m[1]!);
      }
      lineToRouterVar.set(filePath, methodToVar);

      const includePattern = /\b([A-Za-z_]\w*)\.include_router\s*\(\s*([A-Za-z_][\w.]*)\s*((?:,[^)]*)?)\)/g;
      while ((m = includePattern.exec(cleanSource)) !== null) {
        const trailingArgs = m[3] ?? '';
        const literalPrefixMatch = /\bprefix\s*=\s*['"]([^'"]*)['"]/.exec(trailingArgs);
        if (!literalPrefixMatch && /\bprefix\s*=/.test(trailingArgs)) continue;

        const resolvedTarget = resolveFastApiIncludedRouter(m[2]!, filePath, varMap, context);
        if (!resolvedTarget) continue;

        const list = mountsByFile.get(filePath) ?? [];
        list.push({
          fromVar: m[1]!,
          prefix: literalPrefixMatch ? literalPrefixMatch[1]! : '',
          target: resolvedTarget,
        });
        mountsByFile.set(filePath, list);
      }
    }

    if (
      mountsByFile.size === 0 &&
      ![...localRouterPrefixes.values()].some((v) => [...v.values()].some((p) => p !== ''))
    ) {
      return [];
    }

    const buildKey = (file: string, variable: string): string => `${file}\u0000${variable}`;
    let computedBasePrefixes = new Map<string, string>();

    for (let round = 0; round < 8; round++) {
      const nextIteration = new Map<string, string>();

      for (const [mountingFile, mounts] of mountsByFile) {
        for (const mount of mounts) {
          const inheritedBase = computedBasePrefixes.get(buildKey(mountingFile, mount.fromVar)) ?? '';
          const currentVarOwnPrefix = localRouterPrefixes.get(mountingFile)?.get(mount.fromVar) ?? '';
          const accumulatedPath = combinePythonRoutePaths(
            combinePythonRoutePaths(inheritedBase, currentVarOwnPrefix),
            mount.prefix
          );

          const targetKey = buildKey(mount.target.file, mount.target.variable);
          const previouslySeen = nextIteration.get(targetKey);
          if (previouslySeen !== undefined && previouslySeen !== accumulatedPath) {
            nextIteration.set(targetKey, '\u0000');
          } else {
            nextIteration.set(targetKey, accumulatedPath);
          }
        }
      }

      for (const [k, v] of [...nextIteration]) {
        if (v === '\u0000') nextIteration.delete(k);
      }

      let changed = nextIteration.size !== computedBasePrefixes.size;
      if (!changed) {
        for (const [k, v] of nextIteration) {
          if (computedBasePrefixes.get(k) !== v) {
            changed = true;
            break;
          }
        }
      }

      computedBasePrefixes = nextIteration;
      if (!changed) break;
    }

    const routeUpdates: Node[] = [];
    for (const [filePath, lineMap] of lineToRouterVar) {
      const vars = localRouterPrefixes.get(filePath) ?? new Map<string, string>();
      for (const node of context.getNodesInFile(filePath)) {
        if (node.kind !== 'route') continue;

        const variable = lineMap.get(node.startLine);
        if (!variable) continue;

        const effectivePrefix = combinePythonRoutePaths(
          computedBasePrefixes.get(buildKey(filePath, variable)) ?? '',
          vars.get(variable) ?? ''
        );

        if (effectivePrefix === '' || effectivePrefix === '/') continue;

        const sep = node.qualifiedName.indexOf('::');
        const colon = sep < 0 ? -1 : node.qualifiedName.indexOf(':', sep + 2);
        if (colon < 0) continue;

        const methodVerb = node.qualifiedName.slice(sep + 2, colon);
        const originalPath = node.qualifiedName.slice(colon + 1);
        const updatedName = `${methodVerb} ${combinePythonRoutePaths(effectivePrefix, originalPath)}`.trim();

        if (updatedName !== node.name) {
          routeUpdates.push({ ...node, name: updatedName });
        }
      }
    }

    return routeUpdates;
  },
};
