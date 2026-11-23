/**
 * Turning a `TaskContext` into text.
 *
 *   markdown   compact and ordered for a reader with a small budget: header, entry
 *              points, at most ten related symbols grouped by file, code blocks.
 *              Generated files (protobuf stubs, mocks, ...) always sort last and
 *              never appear among related symbols: flow questions want the
 *              hand-written implementation first.
 *   json       the same content as a structured document for programs
 *   tree       an indented relationship outline of a subgraph
 *   bytes      human-readable sizes
 */

import type { CodeBlock, Edge, Node, Subgraph, TaskContext } from '../types';
import { isGeneratedFile } from '../extraction/generated-detection';

const MAX_RELATED_SYMBOLS = 10;

/** Stable two-bucket ordering: authored artifacts precede generated artifacts. */
function authoredFirst<T>(items: readonly T[], fileOf: (item: T) => string, generated: (file: string) => boolean): T[] {
  const authored: T[] = [];
  const derived: T[] = [];
  for (const item of items) (generated(fileOf(item)) ? derived : authored).push(item);
  authored.push(...derived);
  return authored;
}

const locationOf = (node: Node): string => (node.startLine ? `:${node.startLine}` : '');

function renderEntryPoints(entries: readonly Node[]): string[] {
  if (!entries.length) return [];
  return entries.reduce<string[]>((output, node) => {
    output.push(`- **${node.name}** (${node.kind}) - ${node.filePath}${locationOf(node)}`);
    if (node.signature) output.push(`  \`${node.signature}\``);
    return output;
  }, ['### Entry Points\n']).concat('');
}

function renderRelatedSymbols(context: TaskContext, generated: (filePath: string) => boolean): string[] {
  const entryIds = new Set(context.entryPoints.map((node) => node.id));
  const related = Array.from(context.subgraph.nodes.values())
    .filter((node) => !entryIds.has(node.id) && !generated(node.filePath))
    .slice(0, MAX_RELATED_SYMBOLS);
  if (!related.length) return [];

  const byFile = related.reduce<Map<string, Node[]>>((groups, node) => {
    const siblings = groups.get(node.filePath);
    if (siblings) siblings.push(node);
    else groups.set(node.filePath, [node]);
    return groups;
  }, new Map());
  const lines = ['### Related Symbols\n'];
  byFile.forEach((nodes, file) => lines.push(`- ${file}: ${nodes.map((node) => `${node.name}:${node.startLine}`).join(', ')}`));
  return lines.concat('');
}

function renderCodeBlocks(blocks: readonly CodeBlock[]): string[] {
  if (!blocks.length) return [];
  const output = ['### Code\n'];
  for (const block of blocks) {
    output.push(
      `#### ${block.node?.name ?? 'Unknown'} (${block.filePath}:${block.startLine})\n`,
      `\`\`\`${block.language}`,
      block.content,
      '```\n',
    );
  }
  return output;
}

/** `isGenerated` defaults to the filename convention; the builder passes a storage-backed test that also knows header-flagged files. */
export function formatContextAsMarkdown(context: TaskContext, isGenerated: (filePath: string) => boolean = isGeneratedFile): string {
  const entries = authoredFirst(context.entryPoints, (node) => node.filePath, isGenerated);
  const blocks = authoredFirst(context.codeBlocks, (block) => block.filePath, isGenerated);
  return ['## Code Context\n', `**Query:** ${context.query}\n`]
    .concat(renderEntryPoints(entries), renderRelatedSymbols(context, isGenerated), renderCodeBlocks(blocks))
    .join('\n');
}

function describeNode(node: Node): Record<string, unknown> {
  const { id, kind, name, qualifiedName, filePath, language, startLine, endLine,
    signature, docstring, visibility, isExported, isAsync, isStatic } = node;
  return { id, kind, name, qualifiedName, filePath, language, startLine, endLine,
    signature, docstring, visibility, isExported, isAsync, isStatic };
}

function describeEdge(edge: Edge): Record<string, unknown> {
  const { source, target, kind, line, column } = edge;
  return { source, target, kind, line, column };
}

export function formatContextAsJson(context: TaskContext): string {
  return JSON.stringify({
    query: context.query,
    summary: context.summary,
    entryPoints: context.entryPoints.map(describeNode),
    nodes: [...context.subgraph.nodes.values()].map(describeNode),
    edges: context.subgraph.edges.map(describeEdge),
    codeBlocks: context.codeBlocks.map((block) => ({
      filePath: block.filePath,
      startLine: block.startLine,
      endLine: block.endLine,
      language: block.language,
      content: block.content,
      nodeName: block.node?.name,
      nodeKind: block.node?.kind,
    })),
    relatedFiles: context.relatedFiles,
    stats: context.stats,
  }, null, 2);
}

// ---- relationship outline -----------------------------------------------------------------

const OUTLINE_KINDS: ReadonlySet<string> = new Set(['calls', 'extends', 'implements', 'imports', 'references']);
const MAX_EDGES_LISTED = 3;
const MAX_OUTLINE_REMAINDER = 10;
const SIGNATURE_WIDTH = 50;

const shorten = (text: string, width: number): string => (text.length <= width ? text : `${text.slice(0, width - 3)}...`);

export function formatSubgraphTree(subgraph: Subgraph, entryPoints: Node[]): string {
  const outgoing = subgraph.edges.reduce<Map<string, Edge[]>>((index, edge) => {
    const existing = index.get(edge.source);
    if (existing) existing.push(edge);
    else index.set(edge.source, [edge]);
    return index;
  }, new Map());
  const visited = new Set<string>();
  const lines: string[] = [];
  const nameOf = (id: string): string => subgraph.nodes.get(id)?.name ?? 'unknown';

  const appendNode = (node: Node, depth: number, indent: string): void => {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    const signature = node.signature ? ` - ${shorten(node.signature, SIGNATURE_WIDTH)}` : '';
    lines.push(`${indent}${node.kind}: ${node.name} (${node.filePath}${locationOf(node)})${signature}`);

    const relations = (outgoing.get(node.id) ?? []).filter((edge) => OUTLINE_KINDS.has(edge.kind));
    const byKind = relations.reduce<Map<string, Edge[]>>((groups, edge) => {
      const siblings = groups.get(edge.kind);
      if (siblings) siblings.push(edge);
      else groups.set(edge.kind, [edge]);
      return groups;
    }, new Map());
    const inner = `${indent}  `;
    for (const [kind, group] of byKind) {
      if (group.length > MAX_EDGES_LISTED) {
        const shown = group.slice(0, MAX_EDGES_LISTED).map((edge) => nameOf(edge.target)).join(', ');
        lines.push(`${inner}├── ${kind}: ${shown} and ${group.length - MAX_EDGES_LISTED} more`);
      } else {
        group.forEach((edge, index) => lines.push(`${inner}${index === group.length - 1 ? '└──' : '├──'} ${kind} → ${nameOf(edge.target)}`));
      }
    }
    if (depth >= 1) return;
    for (const edge of relations.slice(0, MAX_EDGES_LISTED)) {
      const target = subgraph.nodes.get(edge.target);
      if (target && !visited.has(target.id)) appendNode(target, depth + 1, inner);
    }
  };

  for (const entry of entryPoints) {
    appendNode(entry, 0, '');
    lines.push('');
  }

  const remaining = [...subgraph.nodes.values()].filter((node) => !visited.has(node.id));
  if (remaining.length > MAX_OUTLINE_REMAINDER) {
    lines.push(`... and ${remaining.length} more related symbols`);
  } else if (remaining.length > 0) {
    lines.push('Other relevant symbols:');
    for (const node of remaining) lines.push(`  ${node.kind}: ${node.name} (${node.filePath}${locationOf(node)})`);
  }
  return lines.join('\n').trim();
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
