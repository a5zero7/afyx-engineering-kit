/**
 * AFYX Engineering Kit - Ruby & Rails Framework Resolver
 *
 * Implements route extraction and symbol resolution for Ruby on Rails applications:
 * 1. Explicit HTTP route mapping (`get '/...', to: 'controller#action'`)
 * 2. RESTful resource route expansion (`resources :items`, `resource :profile`)
 * 3. Controller action resolution (`controller#action`)
 * 4. Convention-based model, controller, helper, and background job resolution
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

const RESTFUL_ACTION_MAPPINGS: Record<string, { method: string; path: (res: string) => string }> = {
  index: { method: 'GET', path: (r) => `/${r}` },
  create: { method: 'POST', path: (r) => `/${r}` },
  new: { method: 'GET', path: (r) => `/${r}/new` },
  show: { method: 'GET', path: (r) => `/${r}/:id` },
  edit: { method: 'GET', path: (r) => `/${r}/:id/edit` },
  update: { method: 'PATCH', path: (r) => `/${r}/:id` },
  destroy: { method: 'DELETE', path: (r) => `/${r}/:id` },
};

const STANDARD_PLURAL_ACTIONS: readonly string[] = ['index', 'create', 'new', 'show', 'edit', 'update', 'destroy'];
const STANDARD_SINGULAR_ACTIONS: readonly string[] = ['create', 'new', 'show', 'edit', 'update', 'destroy'];

function pluralizeWord(word: string): string {
  if (/[^aeiou]y$/.test(word)) return word.slice(0, -1) + 'ies';
  if (/(s|x|z|ch|sh)$/.test(word)) return word + 'es';
  return `${word}s`;
}

function camelCaseFromSnake(snake: string): string {
  return snake
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function resolveActionInController(
  controllerSubpath: string,
  actionMethod: string,
  ctx: ResolutionContext
): string | null {
  const directPath = `app/controllers/${controllerSubpath}_controller.rb`;
  if (ctx.fileExists(directPath)) {
    const directAction = ctx
      .getNodesInFile(directPath)
      .find((n) => (n.kind === 'method' || n.kind === 'function') && n.name === actionMethod);
    if (directAction) return directAction.id;
  }

  const baseControllerName = `${camelCaseFromSnake(controllerSubpath.split('/').pop()!)}Controller`;
  const matchingClasses = ctx.getNodesByName(baseControllerName).filter((n) => n.kind === 'class');

  for (const ctrlNode of matchingClasses) {
    const actionNode = ctx
      .getNodesInFile(ctrlNode.filePath)
      .find((n) => (n.kind === 'method' || n.kind === 'function') && n.name === actionMethod);
    if (actionNode) return actionNode.id;
  }

  return null;
}

function resolveActiveRecordModel(name: string, ctx: ResolutionContext): string | null {
  const snake = name.replace(/([A-Z])/g, '_$1').toLowerCase().slice(1);
  const candidateFilePaths = [
    `app/models/${snake}.rb`,
    `app/models/concerns/${snake}.rb`,
  ];

  for (const path of candidateFilePaths) {
    if (ctx.fileExists(path)) {
      const classNode = ctx.getNodesInFile(path).find((n) => n.kind === 'class' && n.name === name);
      if (classNode) return classNode.id;
    }
  }

  const candidateNodes = ctx.getNodesByName(name);
  const modelMatch = candidateNodes.find((n) => n.kind === 'class' && n.filePath.includes('app/models/'));
  return modelMatch ? modelMatch.id : null;
}

function resolveRailsController(name: string, ctx: ResolutionContext): string | null {
  const snake = name.replace(/([A-Z])/g, '_$1').toLowerCase().slice(1);
  const possiblePaths = [
    `app/controllers/${snake}.rb`,
    `app/controllers/api/${snake}.rb`,
    `app/controllers/api/v1/${snake}.rb`,
  ];

  for (const path of possiblePaths) {
    if (ctx.fileExists(path)) {
      const ctrl = ctx.getNodesInFile(path).find((n) => n.kind === 'class' && n.name === name);
      if (ctrl) return ctrl.id;
    }
  }

  const candidateNodes = ctx.getNodesByName(name);
  const ctrlMatch = candidateNodes.find((n) => n.kind === 'class' && n.filePath.includes('controllers/'));
  return ctrlMatch ? ctrlMatch.id : null;
}

function resolveRailsHelper(name: string, ctx: ResolutionContext): string | null {
  const snake = name.replace(/([A-Z])/g, '_$1').toLowerCase().slice(1);
  const path = `app/helpers/${snake}.rb`;

  if (ctx.fileExists(path)) {
    const helper = ctx.getNodesInFile(path).find((n) => n.kind === 'module' && n.name === name);
    if (helper) return helper.id;
  }

  return null;
}

function resolveRailsServiceOrJob(name: string, ctx: ResolutionContext): string | null {
  const snake = name.replace(/([A-Z])/g, '_$1').toLowerCase().slice(1);
  const paths = [
    `app/services/${snake}.rb`,
    `app/jobs/${snake}.rb`,
    `app/workers/${snake}.rb`,
  ];

  for (const p of paths) {
    if (ctx.fileExists(p)) {
      const cls = ctx.getNodesInFile(p).find((n) => n.kind === 'class' && n.name === name);
      if (cls) return cls.id;
    }
  }

  return null;
}

export const railsResolver: FrameworkResolver = {
  name: 'rails',
  languages: ['ruby'],

  claimsReference(name: string): boolean {
    return /^[\w/]+#\w+$/.test(name);
  },

  detect(context: ResolutionContext): boolean {
    const gemfile = context.readFile('Gemfile');
    if (gemfile && gemfile.includes("'rails'")) return true;

    if (context.fileExists('config/application.rb')) return true;

    return (
      context.fileExists('app/controllers/application_controller.rb') ||
      context.fileExists('config/routes.rb')
    );
  },

  resolve(ref: UnresolvedRef, context: ResolutionContext): ResolvedRef | null {
    const actionMatch = ref.referenceName.match(/^([\w/]+)#(\w+)$/);
    if (actionMatch) {
      const targetId = resolveActionInController(actionMatch[1]!, actionMatch[2]!, context);
      if (targetId) {
        return { original: ref, targetNodeId: targetId, confidence: 0.85, resolvedBy: 'framework' };
      }
      return null;
    }

    if (/^[A-Z][a-zA-Z]+$/.test(ref.referenceName)) {
      const modelId = resolveActiveRecordModel(ref.referenceName, context);
      if (modelId) {
        return { original: ref, targetNodeId: modelId, confidence: 0.8, resolvedBy: 'framework' };
      }
    }

    if (ref.referenceName.endsWith('Controller')) {
      const ctrlId = resolveRailsController(ref.referenceName, context);
      if (ctrlId) {
        return { original: ref, targetNodeId: ctrlId, confidence: 0.85, resolvedBy: 'framework' };
      }
    }

    if (ref.referenceName.endsWith('Helper')) {
      const helperId = resolveRailsHelper(ref.referenceName, context);
      if (helperId) {
        return { original: ref, targetNodeId: helperId, confidence: 0.8, resolvedBy: 'framework' };
      }
    }

    if (ref.referenceName.endsWith('Service') || ref.referenceName.endsWith('Job')) {
      const serviceId = resolveRailsServiceOrJob(ref.referenceName, context);
      if (serviceId) {
        return { original: ref, targetNodeId: serviceId, confidence: 0.8, resolvedBy: 'framework' };
      }
    }

    return null;
  },

  extract(filePath: string, content: string): FrameworkExtractionResult {
    if (!filePath.endsWith('.rb')) return { nodes: [], references: [] };

    const nodes: Node[] = [];
    const references: UnresolvedRef[] = [];
    const timestamp = Date.now();
    const cleanSource = stripCommentsForRegex(content, 'ruby');

    const directRoutePattern =
      /\b(get|post|put|patch|delete|match)\s+['"]([^'"]+)['"]\s*(?:,\s*to:\s*|=>\s*)['"]([^#'"]+)#([^'"]+)['"]/g;
    let match: RegExpExecArray | null;

    while ((match = directRoutePattern.exec(cleanSource)) !== null) {
      const verb = match[1]!.toUpperCase();
      const routePath = match[2]!;
      const ctrl = match[3]!;
      const action = match[4]!;
      const lineNum = cleanSource.slice(0, match.index).split('\n').length;

      const routeNode: Node = {
        id: `route:${filePath}:${lineNum}:${verb}:${routePath}`,
        kind: 'route',
        name: `${verb} ${routePath}`,
        qualifiedName: `${filePath}::route:${routePath}`,
        filePath,
        startLine: lineNum,
        endLine: lineNum,
        startColumn: 0,
        endColumn: match[0].length,
        language: 'ruby',
        updatedAt: timestamp,
      };
      nodes.push(routeNode);

      references.push({
        fromNodeId: routeNode.id,
        referenceName: `${ctrl}#${action}`,
        referenceKind: 'references',
        line: lineNum,
        column: 0,
        filePath,
        language: 'ruby',
      });
    }

    const resourcesPattern = /\b(resources?)\s+:(\w+)([^\n]*)/g;
    while ((match = resourcesPattern.exec(cleanSource)) !== null) {
      const isPlural = match[1] === 'resources';
      const resourceIdent = match[2]!;
      const optionsTail = match[3] || '';

      let activeActions = isPlural ? [...STANDARD_PLURAL_ACTIONS] : [...STANDARD_SINGULAR_ACTIONS];
      const onlyMatch = optionsTail.match(/only:\s*\[([^\]]*)\]/);
      const exceptMatch = optionsTail.match(/except:\s*\[([^\]]*)\]/);
      const toSymbolSet = (s: string) => new Set(s.split(',').map((x) => x.trim().replace(/^:/, '')));

      if (onlyMatch) {
        const allowed = toSymbolSet(onlyMatch[1]!);
        activeActions = activeActions.filter((a) => allowed.has(a));
      } else if (exceptMatch) {
        const forbidden = toSymbolSet(exceptMatch[1]!);
        activeActions = activeActions.filter((a) => !forbidden.has(a));
      }

      const controllerName = isPlural ? resourceIdent : pluralizeWord(resourceIdent);
      const lineNum = cleanSource.slice(0, match.index).split('\n').length;

      for (const act of activeActions) {
        const spec = RESTFUL_ACTION_MAPPINGS[act]!;
        const builtPath = spec.path(resourceIdent);

        const routeNode: Node = {
          id: `route:${filePath}:${lineNum}:${spec.method}:${controllerName}#${act}`,
          kind: 'route',
          name: `${spec.method} ${builtPath}`,
          qualifiedName: `${filePath}::route:${controllerName}#${act}`,
          filePath,
          startLine: lineNum,
          endLine: lineNum,
          startColumn: 0,
          endColumn: match[0].length,
          language: 'ruby',
          updatedAt: timestamp,
        };
        nodes.push(routeNode);

        references.push({
          fromNodeId: routeNode.id,
          referenceName: `${controllerName}#${act}`,
          referenceKind: 'references',
          line: lineNum,
          column: 0,
          filePath,
          language: 'ruby',
        });
      }
    }

    return { nodes, references };
  },
};
