/**
 * AFYX Graph Engine - UI Type Hierarchy Model & Tree Layout
 *
 * Computes deterministic geometric positions, orthogonal connector routing,
 * descendant fold thresholds, polymorphic dispatch headlines, and SVG connector paths
 * for type inheritance and implementation trees in the AFYX viewer.
 */

import type { WireHierarchy, WireHierarchyNode, WireNodeDetail, WireNodeRef } from './wire';

export const HIER_ROW_H = 24;
export const HIER_INDENT = 22;
export const HIER_GLYPH_X = 18;
export const HIER_PORT_X = HIER_GLYPH_X + 8;
export const HIER_FOLD_AT = 12;

export interface HierarchyRow {
  entry: WireHierarchyNode | null;
  node: WireNodeRef;
  side: 'ancestor' | 'focus' | 'descendant';
  indent: number;
  index: number;
  word: string;
}

export interface HierarchyConnector {
  fromIndex: number;
  toIndex: number;
  x: number;
  toX: number;
  relation: 'extends' | 'implements';
  synthesized: boolean;
}

export interface HierarchyModel {
  rows: HierarchyRow[];
  connectors: HierarchyConnector[];
  focusIndex: number;
  foldFrom: number | null;
  foldCount: number;
  foldNoun: string;
  headline: string;
  note: string;
}

export function buildHierarchyModel(
  hierarchy: WireHierarchy,
  focus: WireNodeDetail,
): HierarchyModel {
  const assembledRows: HierarchyRow[] = [];

  const sortedAncestors = [...hierarchy.ancestors.items].sort(
    (a, b) => b.depth - a.depth || a.name.localeCompare(b.name),
  );

  for (const ancestor of sortedAncestors) {
    assembledRows.push({
      entry: ancestor,
      node: ancestor,
      side: 'ancestor',
      indent: 0,
      index: assembledRows.length,
      word: ancestor.relation,
    });
  }

  const focusIndex = assembledRows.length;
  assembledRows.push({
    entry: null,
    node: focus,
    side: 'focus',
    indent: 0,
    index: focusIndex,
    word: '',
  });

  for (const descendant of hierarchy.descendants.items) {
    assembledRows.push({
      entry: descendant,
      node: descendant,
      side: 'descendant',
      indent: descendant.depth * HIER_INDENT,
      index: assembledRows.length,
      word: descendant.relation,
    });
  }

  const nodeMap = new Map(
    assembledRows
      .filter((row) => row.side !== 'ancestor')
      .map((row) => [row.node.id, row] as const),
  );

  const routingConnectors: HierarchyConnector[] = [];

  for (let i = 0; i < focusIndex; i++) {
    const currentRow = assembledRows[i];
    const nextRow = assembledRows[i + 1];
    if (!currentRow?.entry || !nextRow) {
      continue;
    }
    routingConnectors.push({
      fromIndex: i,
      toIndex: i + 1,
      x: HIER_PORT_X,
      toX: HIER_PORT_X,
      relation: currentRow.entry.relation,
      synthesized: currentRow.entry.synthesized,
    });
  }

  for (const row of assembledRows) {
    if (row.side !== 'descendant' || !row.entry) {
      continue;
    }
    const parentNode = nodeMap.get(row.entry.parentId) ?? assembledRows[focusIndex];
    if (!parentNode) {
      continue;
    }
    routingConnectors.push({
      fromIndex: parentNode.index,
      toIndex: row.index,
      x: parentNode.indent + HIER_PORT_X,
      toX: row.indent + HIER_GLYPH_X - 2,
      relation: row.entry.relation,
      synthesized: row.entry.synthesized,
    });
  }

  const descendantCount = assembledRows.length - focusIndex - 1;
  const foldThreshold =
    descendantCount > HIER_FOLD_AT ? focusIndex + 1 + HIER_FOLD_AT : null;
  const foldedElements = foldThreshold === null ? [] : assembledRows.slice(foldThreshold);

  return {
    rows: assembledRows,
    connectors: routingConnectors,
    focusIndex,
    foldFrom: foldThreshold,
    foldCount: foldedElements.length,
    foldNoun: resolveSubtypeNoun(
      foldedElements.map((r) => r.entry).filter((e): e is WireHierarchyNode => !!e),
    ),
    headline: constructHeadlineText(hierarchy, focus),
    note: constructFootnoteText(hierarchy),
  };
}

function resolveSubtypeNoun(entries: readonly WireHierarchyNode[]): string {
  if (entries.length === 0) {
    return 'subtypes';
  }
  const implementsCount = entries.filter((e) => e.relation === 'implements').length;
  if (implementsCount === entries.length) {
    return 'implementations';
  }
  if (implementsCount === 0) {
    return 'subclasses';
  }
  return 'subtypes';
}

function constructHeadlineText(hierarchy: WireHierarchy, focus: WireNodeDetail): string {
  if (hierarchy.polymorphic) {
    return `A call through ${focus.name} dispatches to ${hierarchy.implementers} implementations — no single static target.`;
  }
  return '';
}

function constructFootnoteText(hierarchy: WireHierarchy): string {
  const messages: string[] = [];
  if (hierarchy.descendants.truncated) {
    messages.push(
      `Showing ${hierarchy.descendants.shown} of ${hierarchy.descendants.total} subtypes`,
    );
  } else if (hierarchy.bounded) {
    messages.push('Deeper subtypes exist below the levels walked');
  }
  if (hierarchy.ancestors.truncated) {
    messages.push(
      `${hierarchy.ancestors.total - hierarchy.ancestors.shown} more supertypes above`,
    );
  }
  return messages.join(' · ');
}

export function visibleHierarchy(
  model: HierarchyModel,
  expanded: boolean,
): { rows: HierarchyRow[]; connectors: HierarchyConnector[]; height: number } {
  const visibleCount =
    expanded || model.foldFrom === null ? model.rows.length : model.foldFrom;

  return {
    rows: model.rows.slice(0, visibleCount),
    connectors: model.connectors.filter(
      (c) => c.toIndex < visibleCount && c.fromIndex < visibleCount,
    ),
    height: visibleCount * HIER_ROW_H,
  };
}

export function connectorPath(c: HierarchyConnector): string {
  const yStart = c.fromIndex * HIER_ROW_H + HIER_ROW_H / 2;
  const yEnd = c.toIndex * HIER_ROW_H + HIER_ROW_H / 2;

  if (c.toX <= c.x) {
    return `M ${c.x} ${yStart} L ${c.x} ${yEnd}`;
  }
  return `M ${c.x} ${yStart} L ${c.x} ${yEnd} L ${c.toX} ${yEnd}`;
}
