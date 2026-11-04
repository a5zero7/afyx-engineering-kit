import type { Edge, Node } from '../types';
import { clamp } from '../utils';
import { boundToolOutput } from './tool-output';
import { textToolResult, type ToolResult } from './tool-results';

export type RelationshipDirection = 'callers' | 'callees';

export interface RelationshipToolRequest {
  symbol: string;
  file?: unknown;
  limit?: unknown;
}

export interface RelationshipToolSource {
  resolveSymbols(symbol: string): { nodes: Node[]; note: string };
  groupDefinitions(nodes: Node[], fileFilter?: string): { groups: Node[][]; filteredOut: boolean };
  getCallers(nodeId: string): Array<{ node: Node; edge: Edge }>;
  getCallees(nodeId: string): Array<{ node: Node; edge: Edge }>;
}

interface CollectedRelationships {
  nodes: Node[];
  labels: Map<string, string>;
}

/**
 * Adapt an already symbol-validated MCP relationship request to the frozen
 * symbol-resolution, definition-grouping, and Graph relationship APIs.
 */
export function executeRelationshipTool(
  source: RelationshipToolSource,
  request: RelationshipToolRequest,
  direction: RelationshipDirection,
): ToolResult {
  const { symbol } = request;
  const limit = clamp((request.limit as number) || 20, 1, 100);
  const fileFilter = typeof request.file === 'string' ? request.file : undefined;
  const allMatches = source.resolveSymbols(symbol);

  if (allMatches.nodes.length === 0) {
    return textToolResult(`Symbol "${symbol}" not found in the codebase${allMatches.note}`);
  }

  const { groups, filteredOut } = source.groupDefinitions(allMatches.nodes, fileFilter);
  const filterNote = filteredOut
    ? `\n\n> **Note:** no definition of "${symbol}" matches file "${fileFilter}" — showing all definitions instead.`
    : '';
  const collect = (definitionNodes: Node[]): CollectedRelationships => {
    const seen = new Set<string>();
    const nodes: Node[] = [];
    const labels = new Map<string, string>();

    for (const definition of definitionNodes) {
      const relationships = direction === 'callers'
        ? source.getCallers(definition.id)
        : source.getCallees(definition.id);
      for (const relationship of relationships) {
        if (!seen.has(relationship.node.id)) {
          seen.add(relationship.node.id);
          nodes.push(relationship.node);
          const label = edgeLabel(relationship.edge);
          if (label) labels.set(relationship.node.id, label);
        }
      }
    }
    return { nodes, labels };
  };

  const noun = direction;
  const title = direction === 'callers' ? `Callers of ${symbol}` : `Callees of ${symbol}`;
  if (groups.length === 1) {
    const collected = collect(groups[0]!);
    if (collected.nodes.length === 0) {
      return textToolResult(`No ${noun} found for "${symbol}"${allMatches.note}${filterNote}`);
    }
    const note = fileFilter && !filteredOut ? '' : allMatches.note;
    const cut = collected.nodes.length > limit
      ? `\n\n> Showing ${limit} of ${collected.nodes.length} ${noun}; pass \`limit\` (up to 100) to widen.`
      : '';
    const formatted = formatNodeList(collected.nodes.slice(0, limit), title, collected.labels)
      + cut + note + filterNote;
    return textToolResult(boundToolOutput(formatted));
  }

  const heading = direction === 'callers' ? 'Callers of' : 'Callees of';
  const lines: string[] = [
    `**${heading} ${symbol} — ${groups.length} distinct definitions (narrow with \`file\`)**`,
  ];
  for (const group of groups) {
    const collected = collect(group);
    lines.push('', definitionHeading(group));
    if (collected.nodes.length === 0) {
      lines.push(`- (no ${noun})`);
      continue;
    }
    for (const relatedNode of collected.nodes.slice(0, limit)) {
      const location = relatedNode.startLine ? `:${relatedNode.startLine}` : '';
      const label = collected.labels.get(relatedNode.id);
      lines.push(
        `- ${relatedNode.name} (${relatedNode.kind}) - ${relatedNode.filePath}${location}`
        + `${label ? ` — via ${label}` : ''}`,
      );
    }
    if (collected.nodes.length > limit) {
      lines.push(`- … +${collected.nodes.length - limit} more (pass \`limit\` to widen)`);
    }
  }
  return textToolResult(boundToolOutput(lines.join('\n') + filterNote));
}

function definitionHeading(group: Node[]): string {
  const head = group[0]!;
  const line = head.startLine ? `:${head.startLine}` : '';
  return `**${head.qualifiedName}** (${head.kind}) — ${head.filePath}${line}`;
}

function formatNodeList(nodes: Node[], title: string, labels: Map<string, string>): string {
  const lines: string[] = [`**${title} (${nodes.length} found)**`, ''];
  for (const node of nodes) {
    const location = node.startLine ? `:${node.startLine}` : '';
    const label = labels.get(node.id);
    lines.push(
      `- ${node.name} (${node.kind}) - ${node.filePath}${location}`
      + `${label ? ` — via ${label}` : ''}`,
    );
  }
  return lines.join('\n');
}

function edgeLabel(edge: Edge): string | null {
  if (edge.kind === 'calls') return null;
  if (edge.metadata?.fnRef === true) return 'callback registration';
  if (edge.kind === 'instantiates') return 'instantiation';
  if (edge.kind === 'imports') return 'import';
  if (edge.kind === 'references') return 'reference';
  return edge.kind;
}
