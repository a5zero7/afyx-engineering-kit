/**
 * AFYX Engineering Kit - React Framework Resolver
 *
 * Provides syntax and structure resolution for React ecosystems:
 * 1. Component resolution for JSX/TSX elements (with directory proximity heuristics)
 * 2. Custom React hook binding (`use*`)
 * 3. React Context and Provider resolution (`*Context`, `*Provider`)
 * 4. Extraction of declarative routes (`<Route path="..." ...>` and `createBrowserRouter`)
 */

import type { Language, Node } from '../../types';
import type {
  FrameworkExtractionResult,
  FrameworkResolver,
  ResolutionContext,
  ResolvedRef,
  UnresolvedRef,
} from '../types';
import { dependsOn } from './package-deps';

const REACT_SUPPORTED_LANGUAGES: readonly Language[] = [
  'javascript',
  'typescript',
  'tsx',
  'jsx',
];

const BUILT_IN_REACT_OR_JS_TYPES: ReadonlySet<string> = new Set([
  'Array',
  'Boolean',
  'Date',
  'Error',
  'Function',
  'JSON',
  'Math',
  'Number',
  'Object',
  'Promise',
  'RegExp',
  'String',
  'Symbol',
  'Map',
  'Set',
  'WeakMap',
  'WeakSet',
  'React',
  'Component',
  'Fragment',
  'Suspense',
  'StrictMode',
]);

const ACCEPTABLE_COMPONENT_KINDS: ReadonlySet<string> = new Set(['component', 'function', 'class']);

const PREFERRED_COMPONENT_DIRECTORIES: readonly string[] = [
  '/components/',
  '/src/components/',
  '/app/components/',
  '/pages/',
  '/src/pages/',
  '/views/',
  '/src/views/',
];

const PREFERRED_HOOK_DIRECTORIES: readonly string[] = [
  '/hooks/',
  '/src/hooks/',
  '/lib/hooks/',
  '/utils/hooks/',
];

const PREFERRED_CONTEXT_DIRECTORIES: readonly string[] = [
  '/context/',
  '/contexts/',
  '/src/context/',
  '/src/contexts/',
  '/providers/',
  '/src/providers/',
];

function isPascalCaseIdentifier(name: string): boolean {
  return /^[A-Z][a-zA-Z0-9]*$/.test(name);
}

function isBuiltInIdentifier(name: string): boolean {
  return BUILT_IN_REACT_OR_JS_TYPES.has(name);
}

function resolveMatchingComponent(name: string, callingFile: string, ctx: ResolutionContext): string | null {
  const allCandidates = ctx.getNodesByName(name);
  if (allCandidates.length === 0) return null;

  const validComponents = allCandidates.filter((n) => ACCEPTABLE_COMPONENT_KINDS.has(n.kind));
  if (validComponents.length === 0) return null;

  const directoryPrefix = callingFile.substring(0, callingFile.lastIndexOf('/'));
  const localDirMatches = validComponents.filter((cand) => cand.filePath.startsWith(directoryPrefix));
  if (localDirMatches.length > 0) {
    return localDirMatches[0]!.id;
  }

  const preferredDirMatches = validComponents.filter((cand) =>
    PREFERRED_COMPONENT_DIRECTORIES.some((dir) => cand.filePath.includes(dir))
  );
  if (preferredDirMatches.length > 0) {
    return preferredDirMatches[0]!.id;
  }

  return validComponents.length === 1 ? validComponents[0]!.id : null;
}

function resolveCustomHook(hookName: string, ctx: ResolutionContext): string | null {
  const candidateNodes = ctx.getNodesByName(hookName);
  if (candidateNodes.length === 0) return null;

  const functions = candidateNodes.filter((n) => n.kind === 'function' && n.name.startsWith('use'));
  if (functions.length === 0) return null;

  const preferredHookFiles = functions.filter((cand) =>
    PREFERRED_HOOK_DIRECTORIES.some((dir) => cand.filePath.includes(dir))
  );
  if (preferredHookFiles.length > 0) {
    return preferredHookFiles[0]!.id;
  }

  return functions[0]!.id;
}

function resolveContextProvider(name: string, ctx: ResolutionContext): string | null {
  let candidates = ctx.getNodesByName(name);
  if (candidates.length === 0) {
    const strippedSuffix = name.replace(/Context$|Provider$/, '');
    if (strippedSuffix !== name) {
      candidates = ctx.getNodesByName(strippedSuffix);
    }
    if (candidates.length === 0) return null;
  }

  const preferredLocations = candidates.filter((n) =>
    PREFERRED_CONTEXT_DIRECTORIES.some((dir) => n.filePath.includes(dir))
  );
  if (preferredLocations.length > 0) {
    return preferredLocations[0]!.id;
  }

  return candidates[0]!.id;
}

export const reactResolver: FrameworkResolver = {
  name: 'react',
  languages: [...REACT_SUPPORTED_LANGUAGES],

  detect(context: ResolutionContext): boolean {
    if (dependsOn(context, 'react', 'next', 'react-native')) return true;

    return context.getAllFiles().some((p) => p.endsWith('.jsx') || p.endsWith('.tsx'));
  },

  resolve(ref: UnresolvedRef, context: ResolutionContext): ResolvedRef | null {
    if (
      (ref.language === 'tsx' || ref.language === 'jsx') &&
      isPascalCaseIdentifier(ref.referenceName) &&
      !isBuiltInIdentifier(ref.referenceName)
    ) {
      const componentTargetId = resolveMatchingComponent(ref.referenceName, ref.filePath, context);
      if (componentTargetId) {
        return {
          original: ref,
          targetNodeId: componentTargetId,
          confidence: 0.8,
          resolvedBy: 'framework',
        };
      }
    }

    if (ref.referenceName.startsWith('use') && ref.referenceName.length > 3) {
      const hookTargetId = resolveCustomHook(ref.referenceName, context);
      if (hookTargetId) {
        return {
          original: ref,
          targetNodeId: hookTargetId,
          confidence: 0.85,
          resolvedBy: 'framework',
        };
      }
    }

    if (ref.referenceName.endsWith('Context') || ref.referenceName.endsWith('Provider')) {
      const contextTargetId = resolveContextProvider(ref.referenceName, context);
      if (contextTargetId) {
        return {
          original: ref,
          targetNodeId: contextTargetId,
          confidence: 0.8,
          resolvedBy: 'framework',
        };
      }
    }

    return null;
  },

  extract(filePath: string, content: string): FrameworkExtractionResult {
    const extractedNodes: Node[] = [];
    const extractedRefs: UnresolvedRef[] = [];
    const timestamp = Date.now();
    const isTsx = filePath.endsWith('.tsx');
    const docLanguage = isTsx ? 'tsx' : 'jsx';

    const routeTagPattern = /<Route\b/g;
    let tagMatch: RegExpExecArray | null;

    while ((tagMatch = routeTagPattern.exec(content)) !== null) {
      const tagWindow = content.slice(tagMatch.index, tagMatch.index + 400);
      const pathMatch = tagWindow.match(/\bpath\s*=\s*["']([^"']+)["']/);
      if (!pathMatch) continue;

      const pathString = pathMatch[1]!;
      const componentBinding =
        tagWindow.match(/\bcomponent\s*=\s*\{\s*([A-Z][A-Za-z0-9_]*)/) ||
        tagWindow.match(/\belement\s*=\s*\{\s*<\s*([A-Z][A-Za-z0-9_]*)/);

      const lineIndex = content.slice(0, tagMatch.index).split('\n').length;
      const routeNode: Node = {
        id: `route:${filePath}:${lineIndex}:${pathString}`,
        kind: 'route',
        name: pathString,
        qualifiedName: `${filePath}::route:${pathString}`,
        filePath,
        startLine: lineIndex,
        endLine: lineIndex,
        startColumn: 0,
        endColumn: 0,
        language: docLanguage,
        updatedAt: timestamp,
      };

      extractedNodes.push(routeNode);
      if (componentBinding) {
        extractedRefs.push({
          fromNodeId: routeNode.id,
          referenceName: componentBinding[1]!,
          referenceKind: 'references',
          line: lineIndex,
          column: 0,
          filePath,
          language: docLanguage,
        });
      }
    }

    if (/\b(?:createBrowserRouter|createHashRouter|createMemoryRouter|createRoutesFromElements)\b/.test(content)) {
      const propertyPattern = /\bpath\s*:\s*['"]([^'"]*)['"]/g;
      let propMatch: RegExpExecArray | null;

      while ((propMatch = propertyPattern.exec(content)) !== null) {
        const propWindow = content.slice(propMatch.index, propMatch.index + 300);
        const compMatch =
          propWindow.match(/\belement\s*:\s*<\s*([A-Z][A-Za-z0-9_]*)/) ||
          propWindow.match(/\bComponent\s*:\s*([A-Z][A-Za-z0-9_]*)/);

        if (!compMatch) continue;

        const routePath = propMatch[1] || '/';
        const lineIndex = content.slice(0, propMatch.index).split('\n').length;

        const routeNode: Node = {
          id: `route:${filePath}:${lineIndex}:${routePath}`,
          kind: 'route',
          name: routePath,
          qualifiedName: `${filePath}::route:${routePath}`,
          filePath,
          startLine: lineIndex,
          endLine: lineIndex,
          startColumn: 0,
          endColumn: 0,
          language: docLanguage,
          updatedAt: timestamp,
        };

        extractedNodes.push(routeNode);
        extractedRefs.push({
          fromNodeId: routeNode.id,
          referenceName: compMatch[1]!,
          referenceKind: 'references',
          line: lineIndex,
          column: 0,
          filePath,
          language: docLanguage,
        });
      }
    }

    return { nodes: extractedNodes, references: extractedRefs };
  },
};
