/**
 * AFYX Engineering Kit - TanStack Router Link Synthesizer
 *
 * Extracts declarative `<Link to="...">` and `<Navigate to="...">` route bindings
 * from JSX components, resolves them against TanStack Router route hierarchies,
 * and synthesizes attributed navigation edges.
 */

import type { Edge } from '../types';
import type { ResolutionContext } from './types';
import type { MaybeYield } from './cooperative-yield';
import { stripCommentsForRegex } from './strip-comments';
import { isTestPath } from '../search/query-utils';
import { readStringAt, routesForFile } from './frameworks/expo-router';
import { destinationsForHref } from './frameworks/nextjs';
import { tanstackDestination, tanstackTable } from './frameworks/tanstack-router';
import { enclosingFn, makeLineAt } from './synth-utils';

const JSX_SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/;
const TANSTACK_LINK_TAG_REGEX = /<(Link|Navigate)\b([^>]*?)\bto\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*)/g;
const TAG_PRESENCE_CHECK = /<(?:Link|Navigate)\b/;
const MAX_COMPONENT_NAVIGATION_FANOUT = 24;

/**
 * Traverses files to synthesize `navigates` edges for TanStack Router links.
 */
export async function tanstackLinkEdges(ctx: ResolutionContext, onYield: MaybeYield): Promise<Edge[]> {
  const routerTable = tanstackTable(ctx);
  if (routerTable.byRoot.size === 0) return [];

  const synthesizedEdges: Edge[] = [];
  const processedEdgeKeys = new Set<string>();
  const componentFanoutMap = new Map<string, number>();
  let fileBatchCounter = 0;

  for (const filePath of ctx.getAllFiles()) {
    if (!JSX_SOURCE_FILE.test(filePath) || isTestPath(filePath)) continue;

    const routeNamespace = routesForFile(routerTable, filePath);
    if (!routeNamespace || routeNamespace.exact.size === 0) continue;

    if ((++fileBatchCounter & 63) === 0) {
      await onYield();
    }

    const sourceContent = ctx.readFile(filePath);
    if (!sourceContent || !TAG_PRESENCE_CHECK.test(sourceContent)) continue;

    const sanitizedContent = stripCommentsForRegex(sourceContent, 'typescript');
    const nodesInFile = ctx.getNodesInFile(filePath);
    const lineResolver = makeLineAt(sanitizedContent, 1);

    TANSTACK_LINK_TAG_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = TANSTACK_LINK_TAG_REGEX.exec(sanitizedContent)) !== null) {
      let destinationLiteral: string | null = match[3] ?? match[4] ?? null;

      if (destinationLiteral === null) {
        const offset = match.index + match[0].length;
        const charAtOffset = sanitizedContent[offset];
        if (charAtOffset === '"' || charAtOffset === "'" || charAtOffset === '`') {
          destinationLiteral = readStringAt(sanitizedContent, offset);
        }
      }

      if (destinationLiteral === null) continue;

      const parsedDestination = tanstackDestination(JSON.stringify(destinationLiteral));
      if (!parsedDestination) continue;

      const lineNumber = lineResolver(match.index);
      const hostComponent = enclosingFn(nodesInFile, lineNumber);
      if (!hostComponent) continue;

      for (const { node: targetRoute, href: armSpec } of destinationsForHref(parsedDestination, routeNamespace)) {
        const edgeKey = `${hostComponent.id}>${targetRoute.id}`;
        if (processedEdgeKeys.has(edgeKey)) continue;

        const currentFanout = (componentFanoutMap.get(hostComponent.id) ?? 0) + 1;
        componentFanoutMap.set(hostComponent.id, currentFanout);
        if (currentFanout > MAX_COMPONENT_NAVIGATION_FANOUT) continue;

        processedEdgeKeys.add(edgeKey);
        synthesizedEdges.push({
          source: hostComponent.id,
          target: targetRoute.id,
          kind: 'navigates',
          line: lineNumber,
          provenance: 'heuristic',
          metadata: {
            synthesizedBy: 'tanstack-link',
            href: armSpec.display,
            navMethod: match[1] === 'Navigate' ? 'navigate' : 'link',
            registeredAt: `${filePath}:${lineNumber}`,
          },
        });
      }
    }
  }

  return synthesizedEdges;
}
