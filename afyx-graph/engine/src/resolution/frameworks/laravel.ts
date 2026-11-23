/**
 * AFYX Engineering Kit - Laravel Framework Resolver
 *
 * Implements route extraction and symbol resolution for PHP Laravel applications:
 * 1. Declarative HTTP routing: `Route::get`, `Route::post`, `Route::resource`, `Route::apiResource`
 * 2. Controller method binding: `[Controller::class, 'method']` and `'Controller@method'`
 * 3. Eloquent Model static calls: `Model::find()`, `Model::where()`
 * 4. Facade and core helper recognition
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

export const FACADE_MAPPINGS: Record<string, string> = {
  Auth: 'Illuminate\\Auth\\AuthManager',
  Cache: 'Illuminate\\Cache\\CacheManager',
  Config: 'Illuminate\\Config\\Repository',
  DB: 'Illuminate\\Database\\DatabaseManager',
  Event: 'Illuminate\\Events\\Dispatcher',
  File: 'Illuminate\\Filesystem\\Filesystem',
  Gate: 'Illuminate\\Auth\\Access\\Gate',
  Hash: 'Illuminate\\Hashing\\HashManager',
  Log: 'Illuminate\\Log\\LogManager',
  Mail: 'Illuminate\\Mail\\Mailer',
  Queue: 'Illuminate\\Queue\\QueueManager',
  Redis: 'Illuminate\\Redis\\RedisManager',
  Request: 'Illuminate\\Http\\Request',
  Response: 'Illuminate\\Http\\Response',
  Route: 'Illuminate\\Routing\\Router',
  Session: 'Illuminate\\Session\\SessionManager',
  Storage: 'Illuminate\\Filesystem\\FilesystemManager',
  URL: 'Illuminate\\Routing\\UrlGenerator',
  Validator: 'Illuminate\\Validation\\Factory',
  View: 'Illuminate\\View\\Factory',
};

const LARAVEL_GLOBAL_HELPERS: ReadonlySet<string> = new Set([
  'route', 'view', 'config', 'env', 'app', 'abort', 'redirect',
  'response', 'request', 'session', 'url', 'asset', 'mix',
]);

const CONTROLLER_METHOD_REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*Controller@\w+$/;

function parseLaravelRouteHandlerExpression(expr: string): string | null {
  const trimmed = expr.trim();
  const getShortName = (s: string) => s.split('\\').pop()!;

  const tupleMatch = trimmed.match(/^\[\s*([A-Za-z_\\][\w\\]*)::class\s*,\s*['"]([^'"]+)['"]\s*\]/);
  if (tupleMatch) {
    return `${getShortName(tupleMatch[1]!)}@${tupleMatch[2]!}`;
  }

  const atMatch = trimmed.match(/^['"]([^'"@]+)@([^'"]+)['"]$/);
  if (atMatch) {
    return `${getShortName(atMatch[1]!)}@${atMatch[2]!}`;
  }

  const classMatch = trimmed.match(/^([A-Za-z_\\][\w\\]*)::class/);
  if (classMatch) {
    return getShortName(classMatch[1]!);
  }

  return null;
}

function resolveEloquentModelMethod(className: string, methodName: string, ctx: ResolutionContext): string | null {
  const modelPaths = [`app/Models/${className}.php`, `app/${className}.php`];

  for (const path of modelPaths) {
    if (ctx.fileExists(path)) {
      const nodes = ctx.getNodesInFile(path);
      const methodNode = nodes.find((n) => n.kind === 'method' && n.name === methodName);
      if (methodNode) return methodNode.id;

      const classNode = nodes.find((n) => n.kind === 'class' && n.name === className);
      if (classNode) return classNode.id;
    }
  }

  return null;
}

function resolveLaravelControllerAction(controllerName: string, actionName: string, ctx: ResolutionContext): string | null {
  const standardPath = `app/Http/Controllers/${controllerName}.php`;
  if (ctx.fileExists(standardPath)) {
    const nodes = ctx.getNodesInFile(standardPath);
    const methodNode = nodes.find((n) => n.kind === 'method' && n.name === actionName);
    if (methodNode) return methodNode.id;
  }

  const candidateClasses = ctx.getNodesByName(controllerName);
  for (const cls of candidateClasses) {
    if (cls.kind === 'class' && cls.filePath.includes('Controllers')) {
      const nodes = ctx.getNodesInFile(cls.filePath);
      const method = nodes.find((n) => n.kind === 'method' && n.name === actionName);
      if (method) return method.id;
    }
  }

  return null;
}

export const laravelResolver: FrameworkResolver = {
  name: 'laravel',
  languages: ['php'],

  detect(context: ResolutionContext): boolean {
    return context.fileExists('artisan') || context.fileExists('app/Http/Kernel.php');
  },

  claimsReference(name: string): boolean {
    return CONTROLLER_METHOD_REF_PATTERN.test(name);
  },

  resolve(ref: UnresolvedRef, context: ResolutionContext): ResolvedRef | null {
    const modelCallMatch = ref.referenceName.match(/^([A-Z][a-zA-Z]+)::(\w+)$/);
    if (modelCallMatch) {
      const targetId = resolveEloquentModelMethod(modelCallMatch[1]!, modelCallMatch[2]!, context);
      if (targetId) {
        return {
          original: ref,
          targetNodeId: targetId,
          confidence: 0.85,
          resolvedBy: 'framework',
        };
      }
    }

    if (ref.referenceName.match(/^(?:Auth|Cache|DB|Log|Mail|Queue|Session|Storage|Validator|Route|Request|Response)::\w+$/)) {
      return null;
    }

    if (LARAVEL_GLOBAL_HELPERS.has(ref.referenceName)) {
      return null;
    }

    const controllerActionMatch = ref.referenceName.match(/^([A-Z][a-zA-Z]+Controller)@(\w+)$/);
    if (controllerActionMatch) {
      const targetId = resolveLaravelControllerAction(controllerActionMatch[1]!, controllerActionMatch[2]!, context);
      if (targetId) {
        return {
          original: ref,
          targetNodeId: targetId,
          confidence: 0.9,
          resolvedBy: 'framework',
        };
      }
    }

    return null;
  },

  extract(filePath: string, content: string): FrameworkExtractionResult {
    if (!filePath.endsWith('.php')) return { nodes: [], references: [] };

    const nodes: Node[] = [];
    const references: UnresolvedRef[] = [];
    const timestamp = Date.now();
    const cleanSource = stripCommentsForRegex(content, 'php');

    const routeCallRegex = /Route::(get|post|put|patch|delete|options|any)\s*\(\s*['"]([^'"]+)['"]\s*,\s*([^)]+)\)/g;
    let match: RegExpExecArray | null;

    while ((match = routeCallRegex.exec(cleanSource)) !== null) {
      const verb = match[1]!.toUpperCase();
      const endpoint = match[2]!;
      const handlerExpression = match[3]!;
      const lineNum = cleanSource.slice(0, match.index).split('\n').length;

      const routeNode: Node = {
        id: `route:${filePath}:${lineNum}:${verb}:${endpoint}`,
        kind: 'route',
        name: `${verb} ${endpoint}`,
        qualifiedName: `${filePath}::route:${endpoint}`,
        filePath,
        startLine: lineNum,
        endLine: lineNum,
        startColumn: 0,
        endColumn: match[0].length,
        language: 'php',
        updatedAt: timestamp,
      };
      nodes.push(routeNode);

      const targetIdentifier = parseLaravelRouteHandlerExpression(handlerExpression);
      if (targetIdentifier) {
        references.push({
          fromNodeId: routeNode.id,
          referenceName: targetIdentifier,
          referenceKind: 'references',
          line: lineNum,
          column: 0,
          filePath,
          language: 'php',
        });
      }
    }

    const resourceRegex = /Route::(resource|apiResource)\s*\(\s*['"]([^'"]+)['"]\s*(?:,\s*([^)]+))?\)/g;
    while ((match = resourceRegex.exec(cleanSource)) !== null) {
      const resourceName = match[2]!;
      const handlerExpr = match[3];
      const lineNum = cleanSource.slice(0, match.index).split('\n').length;

      const routeNode: Node = {
        id: `route:${filePath}:${lineNum}:RESOURCE:${resourceName}`,
        kind: 'route',
        name: `resource:${resourceName}`,
        qualifiedName: `${filePath}::route:${resourceName}`,
        filePath,
        startLine: lineNum,
        endLine: lineNum,
        startColumn: 0,
        endColumn: match[0].length,
        language: 'php',
        updatedAt: timestamp,
      };
      nodes.push(routeNode);

      if (handlerExpr) {
        const handlerName = parseLaravelRouteHandlerExpression(handlerExpr);
        if (handlerName) {
          references.push({
            fromNodeId: routeNode.id,
            referenceName: handlerName,
            referenceKind: 'imports',
            line: lineNum,
            column: 0,
            filePath,
            language: 'php',
          });
        }
      }
    }

    return { nodes, references };
  },
};
