/**
 * AFYX Engineering Kit - React Router Link Synthesizer
 *
 * Scans JSX elements (`<Link>`, `<NavLink>`, `<Navigate>`, `<LinkContainer>`) for declarative
 * route destinations defined via the `to` attribute, resolving literal, template, and object-based
 * expressions against the React Router route table to synthesize `navigates` edges.
 */

import type { Edge } from '../types';
import type { ResolutionContext } from './types';
import type { MaybeYield } from './cooperative-yield';
import { stripCommentsForRegex } from './strip-comments';
import { isTestPath } from '../search/query-utils';
import { parseHrefExpression, routesForFile, toHref, type HrefLiteral } from './frameworks/expo-router';
import { matchBracket } from './frameworks/object-literal';
import { destinationsForHref } from './frameworks/nextjs';
import { reactRouterTable } from './frameworks/react-router';
import { enclosingFn, makeLineAt } from './synth-utils';

const REACT_SOURCE_FILE_PATTERN = /\.(?:[cm]?[jt]sx?|mdx)$/;
const REACT_ROUTER_LINK_REGEX =
  /<(Link|NavLink|Navigate|LinkContainer|IndexLinkContainer)\b([^>]*?)\bto\s*=\s*(?:"([^"]*)"|'([^']*)'|(?=\{))/g;
const FAST_TAG_FILTER = /<(?:Link|NavLink|Navigate|LinkContainer|IndexLinkContainer)\b/;
const MAX_COMPONENT_NAVIGATION_EDGES = 24;

/**
 * Synthesizes `navigates` graph edges for React Router declarative links.
 */
export async function reactRouterLinkEdges(ctx: ResolutionContext, onYield: MaybeYield): Promise<Edge[]> {
  const routerTable = reactRouterTable(ctx);
  if (routerTable.byRoot.size === 0) return [];

  const synthesizedEdges: Edge[] = [];
  const processedPairKeys = new Set<string>();
  const componentEdgeCounter = new Map<string, number>();
  let fileBatchCounter = 0;

  for (const filePath of ctx.getAllFiles()) {
    if (!REACT_SOURCE_FILE_PATTERN.test(filePath) || isTestPath(filePath)) continue;

    const fileRouteCollection = routesForFile(routerTable, filePath);
    if (!fileRouteCollection || fileRouteCollection.exact.size === 0) continue;

    if ((++fileBatchCounter & 63) === 0) {
      await onYield();
    }

    const fileContent = ctx.readFile(filePath);
    if (!fileContent || !FAST_TAG_FILTER.test(fileContent)) continue;

    const sanitizedContent = stripCommentsForRegex(fileContent, 'typescript');
    const nodesInFile = ctx.getNodesInFile(filePath);
    const lineResolver = makeLineAt(sanitizedContent, 1);

    REACT_ROUTER_LINK_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = REACT_ROUTER_LINK_REGEX.exec(sanitizedContent)) !== null) {
      const tagName = match[1]!;
      const quotedLiteralValue = match[3] ?? match[4] ?? null;
      let targetHref: HrefLiteral | null;

      if (quotedLiteralValue !== null) {
        targetHref = toHref(quotedLiteralValue);
      } else {
        const attributeOffset = match.index + match[0].length;
        const closingBraceOffset = matchBracket(sanitizedContent, attributeOffset);
        if (closingBraceOffset < 0) continue;

        targetHref = parseHrefExpression(sanitizedContent.slice(attributeOffset + 1, closingBraceOffset));
      }

      if (!targetHref || !targetHref.path.startsWith('/')) continue;

      const lineNumber = lineResolver(match.index);
      const hostComponent = enclosingFn(nodesInFile, lineNumber);
      if (!hostComponent) continue;

      for (const { node: destinationRoute, href: armSpec } of destinationsForHref(targetHref, fileRouteCollection)) {
        const pairKey = `${hostComponent.id}>${destinationRoute.id}`;
        if (processedPairKeys.has(pairKey)) continue;

        const currentCount = (componentEdgeCounter.get(hostComponent.id) ?? 0) + 1;
        componentEdgeCounter.set(hostComponent.id, currentCount);
        if (currentCount > MAX_COMPONENT_NAVIGATION_EDGES) continue;

        processedPairKeys.add(pairKey);
        synthesizedEdges.push({
          source: hostComponent.id,
          target: destinationRoute.id,
          kind: 'navigates',
          line: lineNumber,
          provenance: 'heuristic',
          metadata: {
            synthesizedBy: 'react-router-link',
            href: armSpec.display,
            navMethod: tagName === 'Navigate' ? 'navigate' : 'link',
            registeredAt: `${filePath}:${lineNumber}`,
          },
        });
      }
    }
  }

  return synthesizedEdges;
}
