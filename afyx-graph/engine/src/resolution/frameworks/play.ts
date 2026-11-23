/**
 * AFYX Engineering Kit - Play Framework (Scala/Java) Resolver
 *
 * Implements route declaration extraction and handler binding for Play Framework applications:
 * 1. Parses route specifications from `conf/routes` and `conf/*.routes` files
 * 2. Maps HTTP endpoints (`GET`, `POST`, `PUT`, `DELETE`, etc.) to controller action methods
 * 3. Resolves `Controller.action` references to matching methods inside controller classes
 */

import type { Node } from '../../types';
import type {
  FrameworkExtractionResult,
  FrameworkResolver,
  ResolutionContext,
  ResolvedRef,
  UnresolvedRef,
} from '../types';
import { isPlayRoutesFile } from '../../extraction/grammars';

const PLAY_ROUTE_ROW_PATTERN = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\S+)\s+(.+)$/;
const METHOD_OR_FUNCTION_KINDS: ReadonlySet<string> = new Set(['method', 'function']);
const CLASS_KINDS: ReadonlySet<string> = new Set(['class']);

export const playResolver: FrameworkResolver = {
  name: 'play',
  languages: ['scala', 'java', 'yaml'],

  detect(context: ResolutionContext): boolean {
    const sbtBuild = context.readFile('build.sbt');
    if (sbtBuild && /playframework|"play"|sbt-plugin|PlayScala|PlayJava/i.test(sbtBuild)) {
      return true;
    }

    return context.fileExists('conf/routes') || context.fileExists('conf/application.conf');
  },

  claimsReference(name: string): boolean {
    return /^[A-Za-z_]\w*\.[A-Za-z_]\w*$/.test(name);
  },

  resolve(ref: UnresolvedRef, context: ResolutionContext): ResolvedRef | null {
    const nameMatch = ref.referenceName.match(/^([A-Za-z_]\w*)\.([A-Za-z_]\w*)$/);
    if (!nameMatch) return null;

    const [, ctrlClassName, actionMethodName] = nameMatch;
    const targetClasses = context.getNodesByName(ctrlClassName!).filter((n) => CLASS_KINDS.has(n.kind));

    for (const classNode of targetClasses) {
      const targetMethod = context
        .getNodesInFile(classNode.filePath)
        .find((n) => METHOD_OR_FUNCTION_KINDS.has(n.kind) && n.name === actionMethodName);

      if (targetMethod) {
        return {
          original: ref,
          targetNodeId: targetMethod.id,
          confidence: 0.9,
          resolvedBy: 'framework',
        };
      }
    }

    return null;
  },

  extract(filePath: string, content: string): FrameworkExtractionResult {
    if (!isPlayRoutesFile(filePath)) return { nodes: [], references: [] };

    const nodes: Node[] = [];
    const references: UnresolvedRef[] = [];
    const timestamp = Date.now();
    const rows = content.split('\n');

    for (let idx = 0; idx < rows.length; idx++) {
      const trimmedLine = rows[idx]!.trim();
      if (!trimmedLine || trimmedLine.startsWith('#') || trimmedLine.startsWith('->')) {
        continue;
      }

      const match = trimmedLine.match(PLAY_ROUTE_ROW_PATTERN);
      if (!match) continue;

      const [, verb, endpointPath, handlerSignature] = match;
      const functionPrefix = handlerSignature!.split('(')[0]!.trim();
      const dotSegments = functionPrefix.split('.').filter(Boolean);
      if (dotSegments.length < 2) continue;

      const handlerQualifier = dotSegments.slice(-2).join('.');
      const currentLine = idx + 1;

      const routeNode: Node = {
        id: `route:${filePath}:${currentLine}:${verb}:${endpointPath}`,
        kind: 'route',
        name: `${verb} ${endpointPath}`,
        qualifiedName: `${filePath}::${verb}:${endpointPath}`,
        filePath,
        startLine: currentLine,
        endLine: currentLine,
        startColumn: 0,
        endColumn: 0,
        language: 'scala',
        updatedAt: timestamp,
      };
      nodes.push(routeNode);

      references.push({
        fromNodeId: routeNode.id,
        referenceName: handlerQualifier,
        referenceKind: 'references',
        line: currentLine,
        column: 0,
        filePath,
        language: 'scala',
      });
    }

    return { nodes, references };
  },
};
