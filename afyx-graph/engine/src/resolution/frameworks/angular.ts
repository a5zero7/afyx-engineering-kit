/**
 * AFYX Engineering Kit — Angular Framework Resolver
 *
 * Connects the native AngularExtractor into the framework resolver registry:
 * - Detects Angular projects via `@angular/core` in package.json or `angular.json`.
 * - Dispatches TypeScript extraction through `AngularExtractor`.
 * - Resolves Angular DI/module/route component references to graph nodes.
 */

import type { Node } from '../../types';
import type {
  FrameworkExtractionResult,
  FrameworkResolver,
  ResolutionContext,
  ResolvedRef,
  UnresolvedRef,
} from '../types';
import { AngularExtractor } from '../../extraction/angular-extractor';
import { declaredDependencies } from './package-deps';

export const angularResolver: FrameworkResolver = {
  name: 'angular',
  languages: ['typescript'],

  detect(context: ResolutionContext): boolean {
    if (context.fileExists('angular.json')) {
      return true;
    }
    const deps = declaredDependencies(context);
    return deps.has('@angular/core') || deps.has('@angular/router');
  },

  extract(filePath: string, source: string): FrameworkExtractionResult {
    const result = new AngularExtractor(filePath, source).extract();
    return {
      nodes: result.nodes,
      references: result.unresolvedReferences.map((ref) => ({
        fromNodeId: ref.fromNodeId,
        referenceName: ref.referenceName,
        referenceKind: ref.referenceKind,
        line: ref.line,
        column: ref.column,
        filePath: ref.filePath ?? filePath,
        language: ref.language ?? 'typescript',
        ...(ref.candidates ? { candidates: ref.candidates } : {}),
      })),
    };
  },

  resolve(ref: UnresolvedRef, context: ResolutionContext): ResolvedRef | null {
    if (ref.language !== 'typescript') return null;
    if (
      ref.referenceKind !== 'references' &&
      ref.referenceKind !== 'type_of' &&
      ref.referenceKind !== 'navigates'
    ) {
      return null;
    }

    const candidates = context.getNodesByName(ref.referenceName);
    if (candidates.length === 0) return null;

    const preferred =
      candidates.find(
        (n: Node) =>
          (n.decorators?.some((d) => d.startsWith('@Component') || d.startsWith('@NgModule') || d.startsWith('@Injectable')) ??
            false) &&
          (n.kind === 'component' || n.kind === 'module' || n.kind === 'class'),
      ) ?? candidates.find((n: Node) => n.kind === 'component' || n.kind === 'class' || n.kind === 'module');

    if (!preferred) return null;

    return {
      original: ref,
      targetNodeId: preferred.id,
      confidence: 0.85,
      resolvedBy: 'framework',
      edgeKind: ref.referenceKind === 'navigates' ? 'navigates' : 'references',
    };
  },
};
