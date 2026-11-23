import { mergeSymbolImpact, type SymbolImpactHost } from '../impact';
import type { Node } from '../types';
import { clamp } from '../utils';
import { boundToolOutput } from './tool-output';
import { textToolResult, type ToolResult } from './tool-results';

export interface ImpactToolSource extends SymbolImpactHost {
  resolveSymbols(symbol: string): { nodes: Node[]; note: string };
  groupDefinitions(nodes: Node[], fileFilter?: string): {
    groups: Node[][];
    filteredOut: boolean;
  };
}

export interface ImpactToolRequest {
  symbol: string;
  depth?: unknown;
  file?: unknown;
}

/** Adapt an already symbol-validated MCP Impact request to frozen graph capabilities. */
export function executeImpactTool(
  source: ImpactToolSource,
  request: ImpactToolRequest,
): ToolResult {
  const { symbol } = request;
  const depth = clamp((request.depth as number) || 2, 1, 10);
  const fileFilter = typeof request.file === 'string' ? request.file : undefined;

  const allMatches = source.resolveSymbols(symbol);
  if (allMatches.nodes.length === 0) {
    return textToolResult(`Symbol "${symbol}" not found in the codebase${allMatches.note}`);
  }

  const { groups, filteredOut } = source.groupDefinitions(allMatches.nodes, fileFilter);
  const filterNote = filteredOut
    ? `\n\n> **Note:** no definition of "${symbol}" matches file "${fileFilter}" — showing all definitions instead.`
    : '';
  const impactOf = (definitionNodes: Node[]) =>
    mergeSymbolImpact(source, definitionNodes, depth, 'first-seen');

  if (groups.length === 1) {
    const formatted = formatImpact(symbol, impactOf(groups[0]!)) +
      (fileFilter && !filteredOut ? '' : allMatches.note) + filterNote;
    return textToolResult(boundToolOutput(formatted));
  }

  const sections: string[] = [
    `**Impact of ${symbol} — ${groups.length} distinct definitions (each with its own blast radius; narrow with \`file\`)**`,
  ];
  for (const group of groups) {
    const head = group[0]!;
    const line = head.startLine ? `:${head.startLine}` : '';
    sections.push(
      '',
      formatImpact(`${head.qualifiedName} (${head.filePath}${line})`, impactOf(group)),
    );
  }
  return textToolResult(boundToolOutput(sections.join('\n') + filterNote));
}

function formatImpact(symbol: string, impact: { nodes: Map<string, Node> }): string {
  const lines: string[] = [
    `**Impact: "${symbol}" affects ${impact.nodes.size} symbols**`,
    '',
  ];
  const byFile = new Map<string, Node[]>();
  for (const node of impact.nodes.values()) {
    const existing = byFile.get(node.filePath) || [];
    existing.push(node);
    byFile.set(node.filePath, existing);
  }
  for (const [file, nodes] of byFile) {
    lines.push(`**${file}:**`);
    lines.push(nodes.map((node) => `${node.name}:${node.startLine}`).join(', '));
    lines.push('');
  }
  return lines.join('\n');
}
