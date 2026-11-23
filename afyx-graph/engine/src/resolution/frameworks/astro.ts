/**
 * AFYX Engineering Kit - Astro Framework Resolver
 *
 * Provides syntax and structure resolution for Astro applications, handling:
 * 1. Global Astro runtime objects (`Astro.props`, `Astro.params`, etc.)
 * 2. Virtual module imports (`astro:content`, `astro:assets`, etc.)
 * 3. Component tags and invocations (PascalCase identifier resolution)
 * 4. File-system based page routing under `src/pages/`
 */

import type { Node } from '../../types';
import type {
  FrameworkResolver,
  ResolutionContext,
  ResolvedRef,
  UnresolvedRef,
} from '../types';

const KNOWN_ASTRO_VIRTUAL_NAMESPACES: readonly string[] = [
  'astro:content',
  'astro:assets',
  'astro:actions',
  'astro:env',
  'astro:i18n',
  'astro:middleware',
  'astro:transitions',
  'astro:components',
  'astro:schema',
];

const ROUTE_SOURCE_EXTENSIONS_PATTERN = /\.(?:astro|ts|js|mjs)$/;
const CONFIG_FILE_PATTERN = /\.config\.[a-z]+$/;
const PASCAL_CASE_PATTERN = /^[A-Z][a-zA-Z0-9]*$/;

/**
 * Checks if a reference points to the built-in Astro global context.
 */
function isAstroRuntimeGlobal(refName: string): boolean {
  return refName === 'Astro' || refName.startsWith('Astro.');
}

/**
 * Checks if an import specifier corresponds to an Astro virtual module.
 */
function isAstroVirtualModuleSpecifier(refName: string): boolean {
  return KNOWN_ASTRO_VIRTUAL_NAMESPACES.some((ns) => refName === ns || refName.startsWith(`${ns}/`));
}

/**
 * Maps a file path relative to src/pages/ to a standard URL route representation.
 */
export function buildAstroRouteFromPath(subPath: string): string {
  const strippedExtension = subPath.replace(ROUTE_SOURCE_EXTENSIONS_PATTERN, '');
  const withoutTrailingIndex = strippedExtension.replace(/(?:^|\/)index$/, '').replace(/\/$/, '');

  const parameterized = withoutTrailingIndex
    .replace(/\[\.\.\.([^\]]+)\]/g, '*$1')
    .replace(/\[([^\]]+)\]/g, ':$1');

  const normalized = `/${parameterized}`.replace(/\/+/g, '/');
  return normalized === '/' ? '/' : normalized.replace(/\/$/, '');
}

/**
 * Resolves component references by locating matching component nodes in the graph.
 */
function locateComponentTarget(
  componentName: string,
  callingFilePath: string,
  ctx: ResolutionContext
): string | null {
  const candidateComponents = ctx
    .getNodesByName(componentName)
    .filter((candidate) => candidate.kind === 'component');

  if (candidateComponents.length === 0) return null;

  const callingDir = callingFilePath.substring(0, callingFilePath.lastIndexOf('/'));
  const localDirMatches = candidateComponents.filter((cand) => cand.filePath.startsWith(callingDir));

  if (localDirMatches.length > 0) {
    return localDirMatches[0]!.id;
  }

  return candidateComponents.length === 1 ? candidateComponents[0]!.id : null;
}

export const astroResolver: FrameworkResolver = {
  name: 'astro',

  detect(context: ResolutionContext): boolean {
    const rawManifest = context.readFile('package.json');
    if (rawManifest) {
      try {
        const manifest = JSON.parse(rawManifest) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        if (manifest.dependencies?.astro || manifest.devDependencies?.astro) {
          return true;
        }
      } catch {
        // Ignore unparseable package.json
      }
    }

    return context.getAllFiles().some((filePath) => filePath.endsWith('.astro'));
  },

  resolve(ref: UnresolvedRef, context: ResolutionContext): ResolvedRef | null {
    if (isAstroRuntimeGlobal(ref.referenceName)) {
      return {
        original: ref,
        targetNodeId: ref.fromNodeId,
        confidence: 1.0,
        resolvedBy: 'framework',
      };
    }

    if (ref.referenceKind === 'imports' && ref.referenceName.startsWith('astro:')) {
      if (isAstroVirtualModuleSpecifier(ref.referenceName)) {
        return {
          original: ref,
          targetNodeId: ref.fromNodeId,
          confidence: 1.0,
          resolvedBy: 'framework',
        };
      }
    }

    if (
      PASCAL_CASE_PATTERN.test(ref.referenceName) &&
      (ref.referenceKind === 'references' || ref.referenceKind === 'calls')
    ) {
      const targetComponentId = locateComponentTarget(ref.referenceName, ref.filePath, context);
      if (targetComponentId) {
        return {
          original: ref,
          targetNodeId: targetComponentId,
          confidence: 0.8,
          resolvedBy: 'framework',
        };
      }
    }

    return null;
  },

  extract(filePath: string, _content: string) {
    const extractedNodes: Node[] = [];
    const normalizedFilePath = filePath.replace(/\\/g, '/');

    const pagesMarkerMatch = /(?:^|\/)src\/pages\//.exec(normalizedFilePath);
    if (pagesMarkerMatch && ROUTE_SOURCE_EXTENSIONS_PATTERN.test(normalizedFilePath)) {
      const relativePagePath = normalizedFilePath.substring(pagesMarkerMatch.index + pagesMarkerMatch[0].length);
      const fileName = relativePagePath.split('/').pop() || '';

      const segments = relativePagePath.split('/');
      const hasPrivateSegments = segments.some((seg) => seg.startsWith('_'));
      const isConfigFile = CONFIG_FILE_PATTERN.test(fileName);

      if (!hasPrivateSegments && !isConfigFile) {
        const routeUri = buildAstroRouteFromPath(relativePagePath);
        extractedNodes.push({
          id: `route:${filePath}:${routeUri}:1`,
          kind: 'route',
          name: routeUri,
          qualifiedName: `${filePath}::route:${routeUri}`,
          filePath,
          startLine: 1,
          endLine: 1,
          startColumn: 0,
          endColumn: 0,
          language: normalizedFilePath.endsWith('.astro') ? 'astro' : 'typescript',
          updatedAt: Date.now(),
        });
      }
    }

    return { nodes: extractedNodes, references: [] };
  },
};
