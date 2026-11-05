/**
 * AFYX Engineering Kit - Flow Strip Layout Model
 *
 * Deterministic geometric calculation and layout packaging for horizontal
 * execution flow strips, hop cards, connector links, and boundary end-caps.
 */

import type {
  WireBoundaryCandidate,
  WireFlow,
  WireFlowBoundary,
  WireFlowContinuation,
  WireFlowEdge,
  WireFlowHop,
} from './api';

/* --------------------------------------------------------------- Dimensions -- */

/** Standard card width in pixels. */
export const CARD_WIDTH = 380;

/** Baseline connector width between two consecutive cards. */
export const LINK_WIDTH = 86;

/** Standard horizontal pitch between consecutive column start positions. */
export const COLUMN_PITCH = CARD_WIDTH + LINK_WIDTH;

/** IBM Plex Mono 11px average advance width and margin padding. */
const CHAR_PIXEL_WIDTH = 6.65;
const LABEL_SIDE_PADDING = 18;

/** Card header height (padding + text + divider). */
export const HEADER_HEIGHT = 35;

/** Source view typography sizing. */
export const CODE_LINE_HEIGHT = 19;
export const CODE_PADDING = 12;
export const NO_SOURCE_HEIGHT = CODE_LINE_HEIGHT + CODE_PADDING;

/** Vertical spacing between multiple cards stacked in the same column. */
export const ROW_GAP = 24;

/** Canvas boundary padding around the layout area. */
export const PADDING = 32;

/**
 * Computes deterministic card pixel height based on source line count.
 */
export function cardHeight(hop: WireFlowHop): number {
  const lineCount = hop.source?.lines?.length ?? 0;
  const contentHeight = lineCount > 0 ? lineCount * CODE_LINE_HEIGHT + CODE_PADDING : NO_SOURCE_HEIGHT;
  return HEADER_HEIGHT + contentHeight;
}

/* ---------------------------------------------------------------- End-Cap -- */

/** Width of boundary end-cap containers. */
export const END_CAP_WIDTH = 240;
export const END_CAP_PADDING = 12;
export const END_CAP_LINE = 17.4;
export const END_CAP_ROW = 18;
export const END_CAP_GAP = 8;

/** Average characters per line in end-cap typography before wrapping. */
const END_CAP_WRAP_CHARS = 32;

function countWrappedRows(content: string): number {
  return Math.max(1, Math.ceil(content.length / END_CAP_WRAP_CHARS));
}

/**
 * Dynamic dispatch site description rendered within a boundary end-cap.
 */
export interface EndCapSite {
  headline: string;
  key: string | null;
  notes: string[];
  candidates: WireBoundaryCandidate[];
  candidateHeading: string | null;
  candidateNote: string | null;
}

/**
 * Structured textual elements composing a boundary end-cap.
 */
export interface EndCapText {
  intro: string;
  sites: EndCapSite[];
  quiet: string | null;
  uncertainHeading: string | null;
  uncertain: WireFlowContinuation[];
  further: string | null;
  missed: string | null;
}

const formatPlural = (count: number, singularForm: string, pluralForm: string): string =>
  count === 1 ? singularForm : pluralForm;

/**
 * Builds structured text and annotations for a boundary end-cap.
 */
export function endCapText(boundary: WireFlowBoundary): EndCapText {
  const sites: EndCapSite[] = boundary.sites.map((site) => {
    const notes: string[] = [];
    if (site.key === null) {
      notes.push('the key is a runtime value');
    }
    if (site.moreSites > 0) {
      notes.push(`+${site.moreSites} more such ${formatPlural(site.moreSites, 'site', 'sites')} here`);
    }

    const candidateHeading =
      site.candidates.length > 0
        ? `${site.candidates.length} candidate ${formatPlural(site.candidates.length, 'target', 'targets')} \u203a`
        : null;

    return {
      headline: `${site.label} at line ${site.line}`,
      key: site.key,
      notes,
      candidates: site.candidates,
      candidateHeading,
      candidateNote: site.candidateNote,
    };
  });

  const unreachedSymbols = boundary.missed.map((m) => m.name);
  const intro =
    boundary.sites.length > 0
      ? `${boundary.node.name} chooses its next call at runtime.`
      : `${boundary.node.name} is the last symbol on this path.`;

  const quiet =
    boundary.sites.length > 0
      ? null
      : 'No dynamic-dispatch site was detected in its body, so nothing here explains the break.';

  const uncertainHeading =
    boundary.uncertain.total > 0
      ? `${boundary.uncertain.total} name-only ${formatPlural(boundary.uncertain.total, 'match', 'matches')} not followed (confidence < 0.6)`
      : null;

  const further =
    boundary.further.total > 0
      ? `It makes ${boundary.further.total} further resolved ${formatPlural(boundary.further.total, 'call', 'calls')} this path does not need.`
      : null;

  const missed =
    unreachedSymbols.length > 0
      ? `Never reaches ${unreachedSymbols.join(', ')}${boundary.missed.length < unreachedSymbols.length ? '…' : '.'}`
      : null;

  return {
    intro,
    sites,
    quiet,
    uncertainHeading,
    uncertain: boundary.uncertain.items,
    further,
    missed,
  };
}

/**
 * Computes deterministic pixel height of an end-cap container.
 */
export function endCapHeight(boundary: WireFlowBoundary): number {
  const info = endCapText(boundary);
  let totalHeight = END_CAP_PADDING * 2;

  totalHeight += countWrappedRows(`Where the graph stops. ${info.intro}`) * END_CAP_LINE;

  for (const site of info.sites) {
    totalHeight += END_CAP_GAP;
    totalHeight += countWrappedRows(site.headline) * END_CAP_LINE;
    if (site.key !== null) totalHeight += END_CAP_ROW;
    for (const note of site.notes) {
      totalHeight += countWrappedRows(note) * END_CAP_LINE;
    }
    if (site.candidateHeading !== null) {
      totalHeight += END_CAP_LINE + site.candidates.length * END_CAP_ROW;
    } else if (site.candidateNote !== null) {
      totalHeight += countWrappedRows(site.candidateNote) * END_CAP_LINE;
    }
  }

  if (info.quiet !== null) {
    totalHeight += END_CAP_GAP + countWrappedRows(info.quiet) * END_CAP_LINE;
  }
  if (info.uncertainHeading !== null) {
    totalHeight += END_CAP_GAP + countWrappedRows(info.uncertainHeading) * END_CAP_LINE;
    totalHeight += info.uncertain.length * END_CAP_ROW;
  }
  if (info.further !== null) {
    totalHeight += END_CAP_GAP + countWrappedRows(info.further) * END_CAP_LINE;
  }
  if (info.missed !== null) {
    totalHeight += END_CAP_GAP + countWrappedRows(info.missed) * END_CAP_LINE;
  }

  return Math.round(totalHeight);
}

/* ---------------------------------------------------------------- Layout Types -- */

export interface FlowCardLayout {
  id: string;
  hop: WireFlowHop;
  x: number;
  y: number;
  width: number;
  height: number;
  column: number;
  flows: string[];
  step: number;
  stopLine: number | null;
}

export interface FlowLinkLayout {
  id: string;
  source: string;
  target: string;
  edge: WireFlowEdge | null;
  flows: string[];
  label: string;
  labelLines: string[];
  lineLabel: string | null;
  dash: string | null;
  cap: boolean;
}

export interface FlowEndCapLayout {
  id: string;
  anchorId: string;
  boundary: WireFlowBoundary;
  x: number;
  y: number;
  width: number;
  height: number;
  column: number;
  flows: string[];
}

export interface FlowLayout {
  cards: FlowCardLayout[];
  endCaps: FlowEndCapLayout[];
  links: FlowLinkLayout[];
  width: number;
  height: number;
  columns: number;
  gaps: number[];
}

/** Resolves SVG stroke dash pattern based on edge properties. */
export function dashFor(edge: WireFlowEdge): string | null {
  if (edge.synthesized) return '5 3';
  if (edge.uncertain) return '2 3';
  return null;
}

export const END_CAP_DASH = '2 4';

export const capId = (anchorId: string): string => `cap:${anchorId}`;
export const isCapId = (id: string): boolean => id.startsWith('cap:');
export const anchorOf = (id: string): string => (isCapId(id) ? id.slice(4) : id);

export const LABEL_MAX_CHARS = 26;

function shortenPathSegments(sourceText: string): string {
  return sourceText.replace(/[\w.@$/\\-]+[/\\]([\w.$-]+:\d+)/g, '$1');
}

/** Formats multi-line labels for connector links. */
export function labelLinesFor(edge: WireFlowEdge): string[] {
  return shortenPathSegments(edge.label)
    .split(' \u00b7 ')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) =>
      segment.length > LABEL_MAX_CHARS ? `${segment.slice(0, LABEL_MAX_CHARS - 1)}\u2026` : segment
    );
}

/** Derives call site line text for connector footer. */
export function lineLabelFor(edge: WireFlowEdge): string | null {
  return typeof edge.line === 'number' && edge.line > 0 ? `line ${edge.line}` : null;
}

/* ------------------------------------------------------------- Layout Builder -- */

interface LayoutMember {
  id: string;
  width: number;
  height: number;
  rank: number;
  onActive: boolean;
}

/**
 * Computes deterministic multi-column layout for a set of execution flows.
 */
export function buildFlowLayout(flows: readonly WireFlow[], activeId: string | null): FlowLayout {
  const activeFlow = flows.find((f) => f.id === activeId) ?? flows[0] ?? null;
  const activeIndexMap = new Map<string, number>();
  activeFlow?.hops.forEach((hop, idx) => activeIndexMap.set(hop.node.id, idx));

  const cardMap = new Map<string, { hop: WireFlowHop; flows: string[]; order: number }>();
  const linkMap = new Map<string, { source: string; target: string; edge: WireFlowEdge; flows: string[] }>();
  const outgoingNeighbors = new Map<string, Set<string>>();
  const incomingDegree = new Map<string, number>();

  let encounterOrder = 0;

  for (const flow of flows) {
    for (let i = 0; i < flow.hops.length; i++) {
      const hop = flow.hops[i] as WireFlowHop;
      const hopId = hop.node.id;

      const existingCard = cardMap.get(hopId);
      if (existingCard) {
        if (!existingCard.flows.includes(flow.id)) {
          existingCard.flows.push(flow.id);
        }
      } else {
        cardMap.set(hopId, { hop, flows: [flow.id], order: encounterOrder++ });
        incomingDegree.set(hopId, 0);
        outgoingNeighbors.set(hopId, new Set());
      }

      const prevHop = flow.hops[i - 1];
      if (!prevHop || hop.edge === null) continue;

      const srcId = prevHop.node.id;
      const linkKey = `${srcId} ${hopId}`;
      const existingLink = linkMap.get(linkKey);

      if (existingLink) {
        if (!existingLink.flows.includes(flow.id)) {
          existingLink.flows.push(flow.id);
        }
        continue;
      }

      linkMap.set(linkKey, { source: srcId, target: hopId, edge: hop.edge, flows: [flow.id] });
      const succSet = outgoingNeighbors.get(srcId);
      if (succSet && !succSet.has(hopId)) {
        succSet.add(hopId);
        incomingDegree.set(hopId, (incomingDegree.get(hopId) ?? 0) + 1);
      }
    }
  }

  if (cardMap.size === 0) {
    return { cards: [], endCaps: [], links: [], width: 0, height: 0, columns: 0, gaps: [] };
  }

  // Topological / longest path distance for column index
  const columnIndices = new Map<string, number>();
  for (const id of cardMap.keys()) {
    columnIndices.set(id, 0);
  }

  const remainingDegree = new Map(incomingDegree);
  const queue = [...cardMap.keys()].filter((id) => (remainingDegree.get(id) ?? 0) === 0);
  const resolvedNodes = new Set<string>();

  while (queue.length > 0) {
    const currentId = queue.shift() as string;
    resolvedNodes.add(currentId);

    for (const neighbor of outgoingNeighbors.get(currentId) ?? []) {
      const nextCol = (columnIndices.get(currentId) ?? 0) + 1;
      columnIndices.set(neighbor, Math.max(columnIndices.get(neighbor) ?? 0, nextCol));

      const count = (remainingDegree.get(neighbor) ?? 0) - 1;
      remainingDegree.set(neighbor, count);
      if (count === 0) {
        queue.push(neighbor);
      }
    }
  }

  // Handle cycle nodes by projecting from incoming neighbors
  for (const id of cardMap.keys()) {
    if (resolvedNodes.has(id)) continue;
    let maxPredCol = 0;
    for (const [predId, successors] of outgoingNeighbors) {
      if (successors.has(id)) {
        maxPredCol = Math.max(maxPredCol, (columnIndices.get(predId) ?? 0) + 1);
      }
    }
    columnIndices.set(id, maxPredCol);
  }

  // End-caps mapping
  const boundaryCaps = new Map<string, { boundary: WireFlowBoundary; flows: string[] }>();
  for (const flow of flows) {
    const boundary = flow.boundary;
    if (!boundary || !cardMap.has(boundary.node.id)) continue;

    const existingCap = boundaryCaps.get(boundary.node.id);
    if (existingCap) {
      if (!existingCap.flows.includes(flow.id)) {
        existingCap.flows.push(flow.id);
      }
    } else {
      boundaryCaps.set(boundary.node.id, { boundary, flows: [flow.id] });
    }
  }

  const members = new Map<string, LayoutMember>();
  for (const [id, card] of cardMap) {
    members.set(id, {
      id,
      width: CARD_WIDTH,
      height: cardHeight(card.hop),
      rank: card.order,
      onActive: activeIndexMap.has(id),
    });
  }

  const capColumns = new Map<string, number>();
  let nextCapRank = cardMap.size;

  for (const [anchorId, cap] of boundaryCaps) {
    const capElementId = capId(anchorId);
    capColumns.set(capElementId, (columnIndices.get(anchorId) ?? 0) + 1);
    members.set(capElementId, {
      id: capElementId,
      width: END_CAP_WIDTH,
      height: endCapHeight(cap.boundary),
      rank: nextCapRank++,
      onActive: activeIndexMap.has(anchorId),
    });
  }

  const resolveColumn = (id: string): number => capColumns.get(id) ?? columnIndices.get(id) ?? 0;

  const columnBuckets = new Map<number, string[]>();
  for (const id of members.keys()) {
    const col = resolveColumn(id);
    const bucket = columnBuckets.get(col);
    if (bucket) {
      bucket.push(id);
    } else {
      columnBuckets.set(col, [id]);
    }
  }

  for (const bucket of columnBuckets.values()) {
    bucket.sort((a, b) => {
      const aMember = members.get(a) as LayoutMember;
      const bMember = members.get(b) as LayoutMember;
      const activeScoreA = aMember.onActive ? 0 : 1;
      const activeScoreB = bMember.onActive ? 0 : 1;
      if (activeScoreA !== activeScoreB) return activeScoreA - activeScoreB;
      return aMember.rank - bMember.rank;
    });
  }

  const totalColumns = Math.max(...columnBuckets.keys()) + 1;

  // Compute connector gaps accommodating widest link labels
  const linkDescriptors = [...linkMap.entries()].map(([k, entry]) => ({
    key: k,
    link: entry,
    lines: labelLinesFor(entry.edge),
    lineLabel: lineLabelFor(entry.edge),
  }));

  const connectorGaps = Array.from({ length: Math.max(0, totalColumns - 1) }, () => LINK_WIDTH);
  for (const { link, lines, lineLabel } of linkDescriptors) {
    const fromCol = columnIndices.get(link.source) ?? 0;
    if (fromCol < 0 || fromCol >= connectorGaps.length) continue;

    const maxChars = Math.max(0, ...lines.map((l) => l.length), lineLabel?.length ?? 0);
    const calculatedGap = Math.ceil(maxChars * CHAR_PIXEL_WIDTH) + LABEL_SIDE_PADDING;
    connectorGaps[fromCol] = Math.max(connectorGaps[fromCol] as number, calculatedGap);
  }

  const colWidths = Array.from({ length: totalColumns }, () => 0);
  for (const [col, memberIds] of columnBuckets) {
    colWidths[col] = Math.max(...memberIds.map((id) => (members.get(id) as LayoutMember).width));
  }

  const columnXOffsets: number[] = [PADDING];
  for (let c = 1; c < totalColumns; c++) {
    columnXOffsets[c] =
      (columnXOffsets[c - 1] as number) + (colWidths[c - 1] as number) + (connectorGaps[c - 1] as number);
  }

  const columnTotalHeights = new Map<number, number>();
  for (const [col, memberIds] of columnBuckets) {
    const sumHeights = memberIds.reduce((sum, id) => sum + (members.get(id) as LayoutMember).height, 0);
    columnTotalHeights.set(col, sumHeights + ROW_GAP * (memberIds.length - 1));
  }

  const maxColumnHeight = Math.max(...columnTotalHeights.values());

  const cardLayouts = new Map<string, FlowCardLayout>();
  const endCapLayouts: FlowEndCapLayout[] = [];

  for (const [col, memberIds] of columnBuckets) {
    let currentY = PADDING + (maxColumnHeight - (columnTotalHeights.get(col) ?? 0)) / 2;

    for (const id of memberIds) {
      const member = members.get(id) as LayoutMember;
      const capData = boundaryCaps.get(anchorOf(id));

      if (capData && isCapId(id)) {
        endCapLayouts.push({
          id,
          anchorId: anchorOf(id),
          boundary: capData.boundary,
          x: columnXOffsets[col] as number,
          y: currentY,
          width: member.width,
          height: member.height,
          column: col,
          flows: capData.flows,
        });
      } else {
        const cardData = cardMap.get(id) as { hop: WireFlowHop; flows: string[]; order: number };
        cardLayouts.set(id, {
          id,
          hop: cardData.hop,
          x: columnXOffsets[col] as number,
          y: currentY,
          width: member.width,
          height: member.height,
          column: col,
          flows: cardData.flows,
          step: activeIndexMap.get(id) ?? -1,
          stopLine: boundaryCaps.get(id)?.boundary.sites[0]?.line ?? null,
        });
      }

      currentY += member.height + ROW_GAP;
    }
  }

  const renderedLinks: FlowLinkLayout[] = linkDescriptors.map(({ link, lines, lineLabel }) => ({
    id: `${link.source}->${link.target}`,
    source: link.source,
    target: link.target,
    edge: link.edge,
    flows: link.flows,
    label: link.edge.label,
    labelLines: lines,
    lineLabel,
    dash: dashFor(link.edge),
    cap: false,
  }));

  for (const cap of endCapLayouts) {
    renderedLinks.push({
      id: `${cap.anchorId}->${cap.id}`,
      source: cap.anchorId,
      target: cap.id,
      edge: null,
      flows: cap.flows,
      label: 'end of static path',
      labelLines: ['end of', 'static path'],
      lineLabel: null,
      dash: END_CAP_DASH,
      cap: true,
    });
  }

  const totalWidth =
    (columnXOffsets[totalColumns - 1] as number) + (colWidths[totalColumns - 1] as number) + PADDING;
  const totalHeight = PADDING * 2 + maxColumnHeight;

  return {
    cards: [...cardLayouts.values()].sort((a, b) => a.column - b.column || a.y - b.y),
    endCaps: endCapLayouts.sort((a, b) => a.column - b.column || a.y - b.y),
    links: renderedLinks,
    width: totalWidth,
    height: totalHeight,
    columns: totalColumns,
    gaps: connectorGaps,
  };
}
