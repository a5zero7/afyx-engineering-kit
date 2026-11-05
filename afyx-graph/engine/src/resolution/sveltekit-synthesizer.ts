/**
 * AFYX Engineering Kit - SvelteKit Router Link Synthesizer
 *
 * Infers and synthesizes navigation links from Svelte template `<a href="...">` markup
 * to corresponding SvelteKit routes, and binds route nodes directly to page components (`+page.svelte`).
 */

import type { Edge, Node } from '../types';
import type { ResolutionContext } from './types';
import type { MaybeYield } from './cooperative-yield';
import { isTestPath } from '../search/query-utils';
import { HOLE, readStringAt, routesForFile, toHref } from './frameworks/expo-router';
import { destinationsForHref } from './frameworks/nextjs';
import { svelteKitTable } from './frameworks/sveltekit-router';
import { enclosingFn, makeLineAt } from './synth-utils';

const SVELTE_TEMPLATE_FILE = /\.svelte$/;
const SVELTE_LINK_TAG_REGEX = /<a\b([^>]*?)\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*)/g;
const MAX_SVELTE_LINK_FANOUT = 24;

/**
 * Traverses Svelte files to synthesize `navigates` edges from markup `<a>` anchors.
 */
export async function svelteKitLinkEdges(ctx: ResolutionContext, onYield: MaybeYield): Promise<Edge[]> {
  const routerTable = svelteKitTable(ctx);
  if (routerTable.byRoot.size === 0) return [];

  const synthesizedEdges: Edge[] = [];
  const processedPairKeys = new Set<string>();
  const linkFanoutCounter = new Map<string, number>();
  let fileBatchCounter = 0;

  for (const filePath of ctx.getAllFiles()) {
    if (!SVELTE_TEMPLATE_FILE.test(filePath) || isTestPath(filePath)) continue;

    const fileRouteCollection = routesForFile(routerTable, filePath);
    if (!fileRouteCollection || fileRouteCollection.exact.size === 0) continue;

    if ((++fileBatchCounter & 63) === 0) {
      await onYield();
    }

    const fileContent = ctx.readFile(filePath);
    if (!fileContent || !fileContent.includes('href')) continue;

    const nodesInFile = ctx.getNodesInFile(filePath);
    const lineResolver = makeLineAt(fileContent, 1);

    SVELTE_LINK_TAG_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = SVELTE_LINK_TAG_REGEX.exec(fileContent)) !== null) {
      let rawHrefValue: string | null = match[2] ?? match[3] ?? null;

      if (rawHrefValue === null) {
        const offset = match.index + match[0].length;
        const charAtOffset = fileContent[offset];
        if (charAtOffset === '"' || charAtOffset === "'" || charAtOffset === '`') {
          rawHrefValue = readStringAt(fileContent, offset);
        }
      }

      if (rawHrefValue === null) continue;
      if (!rawHrefValue.startsWith('/')) continue;

      const parsedHref = toHref(rawHrefValue.replace(/\{[^}]*\}/g, HOLE));
      if (!parsedHref) continue;

      const lineNumber = lineResolver(match.index);
      const hostComponent = enclosingFn(nodesInFile, lineNumber);
      if (!hostComponent) continue;

      for (const { node: targetPage, href: armSpec } of destinationsForHref(parsedHref, fileRouteCollection)) {
        const pairKey = `${hostComponent.id}>${targetPage.id}`;
        if (processedPairKeys.has(pairKey)) continue;

        const currentCount = (linkFanoutCounter.get(hostComponent.id) ?? 0) + 1;
        linkFanoutCounter.set(hostComponent.id, currentCount);
        if (currentCount > MAX_SVELTE_LINK_FANOUT) continue;

        processedPairKeys.add(pairKey);
        synthesizedEdges.push({
          source: hostComponent.id,
          target: targetPage.id,
          kind: 'navigates',
          line: lineNumber,
          provenance: 'heuristic',
          metadata: {
            synthesizedBy: 'sveltekit-link',
            href: armSpec.display,
            navMethod: 'a',
            registeredAt: `${filePath}:${lineNumber}`,
          },
        });
      }
    }
  }

  return synthesizedEdges;
}

/**
 * Creates `calls` edges binding each SvelteKit route node to the `+page.svelte` component within the same file.
 */
export async function svelteKitPageComponentEdges(ctx: ResolutionContext, onYield: MaybeYield): Promise<Edge[]> {
  const routerTable = svelteKitTable(ctx);
  if (routerTable.byRoot.size === 0) return [];

  const synthesizedEdges: Edge[] = [];
  let fileBatchCounter = 0;

  const targetPageNodes = new Set<Node>();
  for (const routeNamespace of routerTable.byRoot.values()) {
    for (const pageNode of routeNamespace.exact.values()) {
      targetPageNodes.add(pageNode);
    }
  }

  for (const pageNode of targetPageNodes) {
    if ((++fileBatchCounter & 31) === 0) {
      await onYield();
    }

    const hostComponent = ctx.getNodesInFile(pageNode.filePath).find((n) => n.kind === 'component');
    if (!hostComponent) continue;

    synthesizedEdges.push({
      source: pageNode.id,
      target: hostComponent.id,
      kind: 'calls',
      line: hostComponent.startLine,
      provenance: 'heuristic',
      metadata: {
        synthesizedBy: 'sveltekit-page',
        registeredAt: pageNode.filePath,
      },
    });
  }

  return synthesizedEdges;
}
