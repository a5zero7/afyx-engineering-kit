/**
 * AFYX Engineering Kit - Vue / Nuxt Framework Resolver
 *
 * Provides syntax and structure resolution for Vue 3 and Nuxt applications:
 * 1. Vue compiler macros (`defineProps`, `defineEmits`, `defineModel`, etc.)
 * 2. Nuxt auto-imported composables (`useRoute`, `useRouter`, `useFetch`, `useState`, etc.)
 * 3. Nuxt virtual modules (`#imports`, `#components`, `#app`, etc.)
 * 4. Component imports and path aliases (`@/*`, `~/*`)
 * 5. Nuxt file-based route and middleware extraction (`pages/`, `server/api/`, `middleware/`)
 */

import type { Node } from '../../types';
import type {
  FrameworkExtractionResult,
  FrameworkResolver,
  ResolutionContext,
  ResolvedRef,
  UnresolvedRef,
} from '../types';

const BUILTIN_VUE_COMPILER_MACROS: ReadonlySet<string> = new Set([
  'defineProps',
  'defineEmits',
  'defineExpose',
  'defineOptions',
  'defineSlots',
  'defineModel',
  'withDefaults',
]);

const BUILTIN_NUXT_COMPOSABLES: ReadonlySet<string> = new Set([
  'useRoute',
  'useRouter',
  'navigateTo',
  'abortNavigation',
  'useFetch',
  'useAsyncData',
  'useLazyFetch',
  'useLazyAsyncData',
  'refreshNuxtData',
  'useState',
  'clearNuxtState',
  'useHead',
  'useSeoMeta',
  'useServerSeoMeta',
  'useRuntimeConfig',
  'useAppConfig',
  'useNuxtApp',
  'useCookie',
  'useError',
  'createError',
  'showError',
  'clearError',
  'definePageMeta',
  'defineNuxtConfig',
  'defineNuxtPlugin',
  'defineNuxtRouteMiddleware',
  'useRequestHeaders',
  'useRequestEvent',
  'useRequestFetch',
  'useRequestURL',
]);

const NUXT_VIRTUAL_NAMESPACES: readonly string[] = [
  '#imports',
  '#components',
  '#app',
  '#build',
  '#head',
];

const ALIAS_SEARCH_EXTENSIONS: readonly string[] = [
  '',
  '.ts',
  '.js',
  '.vue',
  '/index.ts',
  '/index.js',
  '/index.vue',
];

function isPascalCaseIdentifier(text: string): boolean {
  return /^[A-Z][a-zA-Z0-9]*$/.test(text);
}

function resolveAliasedModule(
  importSpecifier: string,
  prefix: string,
  replacement: string,
  context: ResolutionContext
): string | null {
  const mappedSubPath = importSpecifier.replace(prefix, replacement);
  for (const ext of ALIAS_SEARCH_EXTENSIONS) {
    const candidatePath = mappedSubPath + ext;
    if (context.fileExists(candidatePath)) {
      const nodesInFile = context.getNodesInFile(candidatePath);
      if (nodesInFile.length > 0) {
        return nodesInFile[0]!.id;
      }
    }
  }
  return null;
}

function locateVueComponentTarget(name: string, fromFile: string, ctx: ResolutionContext): string | null {
  const matchingVueFiles: string[] = [];
  for (const filePath of ctx.getAllFiles()) {
    if (!filePath.endsWith('.vue')) continue;
    const baseName = filePath.split(/[/\\]/).pop() || '';
    if (baseName.replace(/\.vue$/, '') === name) {
      matchingVueFiles.push(filePath);
    }
  }

  if (matchingVueFiles.length === 0) return null;

  const findComponentIdInFile = (file: string): string | null => {
    const fileNodes = ctx.getNodesInFile(file);
    const componentNode = fileNodes.find((n) => n.kind === 'component' && n.name === name);
    return componentNode ? componentNode.id : null;
  };

  const callingDir = fromFile.substring(0, fromFile.lastIndexOf('/'));
  const sameDirFiles = matchingVueFiles.filter((f) => f.startsWith(callingDir));
  if (sameDirFiles.length > 0) {
    return findComponentIdInFile(sameDirFiles[0]!);
  }

  return matchingVueFiles.length === 1 ? findComponentIdInFile(matchingVueFiles[0]!) : null;
}

function mapFilePathToNuxtRoute(normalized: string, offset: number): string | null {
  const subPath = normalized.substring(offset);
  const strippedExt = subPath.replace(/\.vue$/, '');
  const strippedIndex = strippedExt.replace(/\/index$/, '');

  const parameterized = '/' + strippedIndex
    .replace(/\[\.\.\.([^\]]+)\]/g, '*$1')
    .replace(/\[{2}([^\]]+)\]{2}/g, ':$1?')
    .replace(/\[([^\]]+)\]/g, ':$1');

  if (parameterized === '/') return '/';
  return parameterized.replace(/\/$/, '');
}

export const vueResolver: FrameworkResolver = {
  name: 'vue',

  detect(context: ResolutionContext): boolean {
    const manifestJson = context.readFile('package.json');
    if (manifestJson) {
      try {
        const pkg = JSON.parse(manifestJson) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (allDeps.vue || allDeps.nuxt || allDeps['@nuxt/kit']) {
          return true;
        }
      } catch {
        // Ignore JSON parse errors
      }
    }

    return context.getAllFiles().some((p) => p.endsWith('.vue'));
  },

  resolve(ref: UnresolvedRef, context: ResolutionContext): ResolvedRef | null {
    if (BUILTIN_VUE_COMPILER_MACROS.has(ref.referenceName)) {
      return {
        original: ref,
        targetNodeId: ref.fromNodeId,
        confidence: 1.0,
        resolvedBy: 'framework',
      };
    }

    if (BUILTIN_NUXT_COMPOSABLES.has(ref.referenceName)) {
      return {
        original: ref,
        targetNodeId: ref.fromNodeId,
        confidence: 1.0,
        resolvedBy: 'framework',
      };
    }

    if (ref.referenceKind === 'imports' && ref.referenceName.startsWith('#')) {
      if (NUXT_VIRTUAL_NAMESPACES.some((prefix) => ref.referenceName.startsWith(prefix))) {
        return {
          original: ref,
          targetNodeId: ref.fromNodeId,
          confidence: 1.0,
          resolvedBy: 'framework',
        };
      }
    }

    if (ref.referenceKind === 'imports' && ref.referenceName.startsWith('@/')) {
      const targetId = resolveAliasedModule(ref.referenceName, '@/', 'src/', context);
      if (targetId) {
        return {
          original: ref,
          targetNodeId: targetId,
          confidence: 0.9,
          resolvedBy: 'framework',
        };
      }
    }

    if (ref.referenceKind === 'imports' && ref.referenceName.startsWith('~/')) {
      const targetId = resolveAliasedModule(ref.referenceName, '~/', 'src/', context);
      if (targetId) {
        return {
          original: ref,
          targetNodeId: targetId,
          confidence: 0.9,
          resolvedBy: 'framework',
        };
      }
    }

    if (isPascalCaseIdentifier(ref.referenceName) && ref.referenceKind === 'calls') {
      const componentNodeId = locateVueComponentTarget(ref.referenceName, ref.filePath, context);
      if (componentNodeId) {
        return {
          original: ref,
          targetNodeId: componentNodeId,
          confidence: 0.8,
          resolvedBy: 'framework',
        };
      }
    }

    return null;
  },

  extract(filePath: string, _content: string): FrameworkExtractionResult {
    const createdNodes: Node[] = [];
    const timestamp = Date.now();
    const normalized = filePath.replace(/\\/g, '/');

    const pagesIndex = normalized.indexOf('/pages/');
    if (pagesIndex !== -1 && normalized.endsWith('.vue')) {
      const routeUri = mapFilePathToNuxtRoute(normalized, pagesIndex + '/pages/'.length);
      if (routeUri !== null) {
        createdNodes.push({
          id: `route:${filePath}:${routeUri}:1`,
          kind: 'route',
          name: routeUri,
          qualifiedName: `${filePath}::route:${routeUri}`,
          filePath,
          startLine: 1,
          endLine: 1,
          startColumn: 0,
          endColumn: 0,
          language: 'vue',
          updatedAt: timestamp,
        });
      }
    }

    const apiIndex = normalized.indexOf('/server/api/');
    if (apiIndex !== -1) {
      const rawApiSubpath = normalized.substring(apiIndex + '/server/api/'.length);
      const cleanSubpath = rawApiSubpath.replace(/\.[^/.]+$/, '').replace(/\/index$/, '');
      const apiRouteName = `/api/${cleanSubpath}`;

      createdNodes.push({
        id: `route:${filePath}:${apiRouteName}:1`,
        kind: 'route',
        name: apiRouteName,
        qualifiedName: `${filePath}::route:${apiRouteName}`,
        filePath,
        startLine: 1,
        endLine: 1,
        startColumn: 0,
        endColumn: 0,
        language: normalized.endsWith('.vue') ? 'vue' : 'typescript',
        updatedAt: timestamp,
      });
    }

    const middlewareIndex = normalized.indexOf('/middleware/');
    if (middlewareIndex !== -1) {
      const rawMiddlewareSubpath = normalized.substring(middlewareIndex + '/middleware/'.length);
      const middlewareIdent = rawMiddlewareSubpath.replace(/\.[^/.]+$/, '');

      createdNodes.push({
        id: `middleware:${filePath}:${middlewareIdent}:1`,
        kind: 'function',
        name: middlewareIdent,
        qualifiedName: `${filePath}::middleware:${middlewareIdent}`,
        filePath,
        startLine: 1,
        endLine: 1,
        startColumn: 0,
        endColumn: 0,
        language: normalized.endsWith('.vue') ? 'vue' : 'typescript',
        updatedAt: timestamp,
      });
    }

    return { nodes: createdNodes, references: [] };
  },
};
