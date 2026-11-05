/**
 * AFYX Engineering Kit - Vue Router Link Synthesizer
 *
 * Identifies declarative `<router-link>`, `<RouterLink>`, `<NuxtLink>`, and `<nuxt-link>` tags
 * within Vue single-file components and JSX files, mapping literal and bound `:to` expressions
 * by route name or path against the Vue Router table to synthesize `navigates` graph edges.
 */

import type { Edge, Node } from '../types';
import type { ResolutionContext } from './types';
import type { MaybeYield } from './cooperative-yield';
import { isTestPath } from '../search/query-utils';
import { readStringAt, routesForFile, toHref } from './frameworks/expo-router';
import { destinationsForHref } from './frameworks/nextjs';
import { parseVuePathObject, routeNameInExpression, vueRouteTable } from './frameworks/vue-router';
import { enclosingFn, makeLineAt } from './synth-utils';

const VUE_TEMPLATE_FILE = /\.(?:vue|[cm]?[jt]sx?)$/;
const VUE_LINK_TAG_REGEX =
  /<(router-link|RouterLink|NuxtLink|nuxt-link)\b([^>]*?)\s:?to\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const VUE_TAG_FAST_FILTER = /<(?:router-link|RouterLink|NuxtLink|nuxt-link)\b/;
const MAX_COMPONENT_LINK_COUNT = 24;

/**
 * Traverses Vue/Nuxt source files to synthesize `navigates` edges from template link tags.
 */
export async function vueRouterLinkEdges(ctx: ResolutionContext, onYield: MaybeYield): Promise<Edge[]> {
  const routerTable = vueRouteTable(ctx);
  if (routerTable.byRoot.size === 0) return [];

  const synthesizedEdges: Edge[] = [];
  const processedEdgeKeys = new Set<string>();
  const linkCounterPerComponent = new Map<string, number>();
  let scannedFileCount = 0;

  for (const filePath of ctx.getAllFiles()) {
    if (!VUE_TEMPLATE_FILE.test(filePath) || isTestPath(filePath)) continue;

    const fileRouteNamespace = routesForFile(routerTable, filePath);
    if (!fileRouteNamespace || fileRouteNamespace.exact.size === 0) continue;

    if ((++scannedFileCount & 63) === 0) {
      await onYield();
    }

    const fileContent = ctx.readFile(filePath);
    if (!fileContent || !VUE_TAG_FAST_FILTER.test(fileContent)) continue;

    const nodesInFile = ctx.getNodesInFile(filePath);
    const lineResolver = makeLineAt(fileContent, 1);

    VUE_LINK_TAG_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = VUE_LINK_TAG_REGEX.exec(fileContent)) !== null) {
      const rawAttributeValue = (match[3] ?? match[4] ?? '').trim();
      if (rawAttributeValue.length === 0) continue;

      const lineNumber = lineResolver(match.index);
      const hostComponent = enclosingFn(nodesInFile, lineNumber);
      if (!hostComponent) continue;

      const isBoundAttribute = match[0].includes(':to');
      const routeNamedLiteral = isBoundAttribute ? routeNameInExpression(rawAttributeValue) : null;
      const matchedByName = routeNamedLiteral === null ? undefined : fileRouteNamespace.byName.get(routeNamedLiteral);

      let destinationTargets: Array<{ node: Node; display: string }>;

      if (matchedByName && routeNamedLiteral !== null) {
        destinationTargets = [{ node: matchedByName, display: routeNamedLiteral }];
      } else {
        const parsedHref = isBoundAttribute
          ? parseVuePathObject(rawAttributeValue) ?? toHref(readStringAt(rawAttributeValue, 0))
          : toHref(rawAttributeValue);

        if (!parsedHref || !parsedHref.path.startsWith('/')) continue;
        destinationTargets = destinationsForHref(parsedHref, fileRouteNamespace).map((d) => ({
          node: d.node,
          display: d.href.display,
        }));
      }

      for (const { node: targetNode, display } of destinationTargets) {
        const edgeKey = `${hostComponent.id}>${targetNode.id}`;
        if (processedEdgeKeys.has(edgeKey)) continue;

        const currentLinkCount = (linkCounterPerComponent.get(hostComponent.id) ?? 0) + 1;
        linkCounterPerComponent.set(hostComponent.id, currentLinkCount);
        if (currentLinkCount > MAX_COMPONENT_LINK_COUNT) continue;

        processedEdgeKeys.add(edgeKey);
        synthesizedEdges.push({
          source: hostComponent.id,
          target: targetNode.id,
          kind: 'navigates',
          line: lineNumber,
          provenance: 'heuristic',
          metadata: {
            synthesizedBy: 'vue-router-link',
            href: display,
            navMethod: 'link',
            ...(routeNamedLiteral !== null && fileRouteNamespace.byName.has(routeNamedLiteral)
              ? { by: 'name' }
              : {}),
            registeredAt: `${filePath}:${lineNumber}`,
          },
        });
      }
    }
  }

  return synthesizedEdges;
}
