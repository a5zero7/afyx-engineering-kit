/**
 * AFYX Engineering Kit - Next.js Router Link Synthesizer
 *
 * Scans JSX elements (`<Link>`, `<NextLink>`, `<a>`) for internal route references,
 * matching literal and pathname-parameterized href expressions against the Next.js route table,
 * and synthesizing navigable graph edges attributed to enclosing React components.
 */

import type { Edge } from '../types';
import type { ResolutionContext } from './types';
import type { MaybeYield } from './cooperative-yield';
import { stripCommentsForRegex } from './strip-comments';
import { isTestPath } from '../search/query-utils';
import { readStringAt, toHref } from './frameworks/expo-router';
import { nextRouteTable, destinationsForHref } from './frameworks/nextjs';
import { enclosingFn, makeLineAt } from './synth-utils';

const REACT_JSX_FILE = /\.(?:[cm]?[jt]sx?|mdx)$/;
const JSX_LINK_TAG_REGEX = /<(Link|NextLink|a)\b([^>]*?)\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*)/g;
const COMPONENT_LINK_FANOUT_MAX = 24;

/**
 * Discovers and synthesizes `navigates` edges for Next.js markup links.
 */
export async function nextLinkEdges(ctx: ResolutionContext, onYield: MaybeYield): Promise<Edge[]> {
  const routeTable = nextRouteTable(ctx);
  if (routeTable.exact.size === 0) return [];

  const synthesizedEdges: Edge[] = [];
  const registeredEdgeKeys = new Set<string>();
  const linkCountPerComponent = new Map<string, number>();
  let filesInspected = 0;

  for (const filePath of ctx.getAllFiles()) {
    if (!REACT_JSX_FILE.test(filePath) || isTestPath(filePath)) continue;
    if (!routeTable.roots.some((rootPrefix) => filePath.startsWith(rootPrefix))) continue;

    if ((++filesInspected & 63) === 0) {
      await onYield();
    }

    const fileContent = ctx.readFile(filePath);
    if (!fileContent || !fileContent.includes('href')) continue;

    const sanitizedContent = stripCommentsForRegex(fileContent, 'typescript');
    const nodesInFile = ctx.getNodesInFile(filePath);
    const lineResolver = makeLineAt(sanitizedContent, 1);

    JSX_LINK_TAG_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = JSX_LINK_TAG_REGEX.exec(sanitizedContent)) !== null) {
      const tagName = match[1]!;
      let resolvedHrefLiteral: string | null = match[3] ?? match[4] ?? null;

      if (resolvedHrefLiteral === null) {
        const offset = match.index + match[0].length;
        const charAtOffset = sanitizedContent[offset];

        if (charAtOffset === '"' || charAtOffset === "'" || charAtOffset === '`') {
          resolvedHrefLiteral = readStringAt(sanitizedContent, offset);
        } else if (charAtOffset === '{') {
          const pathnameMatcher = /\bpathname\s*:\s*/y;
          pathnameMatcher.lastIndex = offset;
          const braceEnd = sanitizedContent.indexOf('}', offset);
          const sliceBoundary = braceEnd < 0 ? undefined : braceEnd;
          const searchSlice = sanitizedContent.slice(0, sliceBoundary).slice(offset);
          const foundKey = pathnameMatcher.exec(searchSlice);
          if (foundKey) {
            resolvedHrefLiteral = readStringAt(sanitizedContent, offset + foundKey.index + foundKey[0].length);
          }
        }
      }

      if (resolvedHrefLiteral === null) continue;
      if (tagName === 'a' && !resolvedHrefLiteral.startsWith('/')) continue;

      const parsedHref = toHref(resolvedHrefLiteral);
      if (!parsedHref) continue;

      const lineNumber = lineResolver(match.index);
      const hostComponent = enclosingFn(nodesInFile, lineNumber);
      if (!hostComponent) continue;

      for (const { node: targetPage, href: armSpec } of destinationsForHref(parsedHref, routeTable)) {
        const edgeKey = `${hostComponent.id}>${targetPage.id}`;
        if (registeredEdgeKeys.has(edgeKey)) continue;

        const currentCount = (linkCountPerComponent.get(hostComponent.id) ?? 0) + 1;
        linkCountPerComponent.set(hostComponent.id, currentCount);
        if (currentCount > COMPONENT_LINK_FANOUT_MAX) continue;

        registeredEdgeKeys.add(edgeKey);
        synthesizedEdges.push({
          source: hostComponent.id,
          target: targetPage.id,
          kind: 'navigates',
          line: lineNumber,
          provenance: 'heuristic',
          metadata: {
            synthesizedBy: 'next-link',
            href: armSpec.display,
            navMethod: tagName === 'a' ? 'a' : 'link',
            registeredAt: `${filePath}:${lineNumber}`,
          },
        });
      }
    }
  }

  return synthesizedEdges;
}
