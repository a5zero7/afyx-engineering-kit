/**
 * Reading symbol source for code blocks.
 *
 * Two rules matter more than convenience. A config-leaf node (a single key lifted out
 * of a YAML/properties file) never has its value read: the on-disk line is
 * `key = <secret>`, so only the key is returned. And a path that escapes the project
 * root (lexically or through a symlink) is treated as unreadable.
 *
 * A reader is scoped to one operation and reads each file at most once, however many
 * symbols of that file are requested.
 */

import * as fs from 'fs';
import type { CodeBlock, Node, Subgraph } from '../types';
import { logDebug } from '../errors';
import { isConfigLeafNode, validatePathWithinRoot } from '../utils';

const TRUNCATION_MARKER = '\n... (truncated) ...';

export class SourceReader {
  private readonly cache = new Map<string, string[] | null>();

  constructor(private readonly projectRoot: string) {}

  /** Lines of a project file, or null when it is missing, outside the root, or unreadable. */
  private load(filePath: string): string[] | null {
    if (this.cache.has(filePath)) return this.cache.get(filePath)!;

    let result: string[] | null = null;
    const resolved = validatePathWithinRoot(this.projectRoot, filePath);
    if (resolved && fs.existsSync(resolved)) {
      try {
        result = fs.readFileSync(resolved, 'utf-8').split('\n');
      } catch (error) {
        logDebug('Failed to extract code from file', { filePath, error: String(error) });
      }
    }
    this.cache.set(filePath, result);
    return result;
  }

  /** The node's source between its start and end lines (1-indexed, inclusive). */
  read(node: Node): string | null {
    if (isConfigLeafNode(node)) return node.signature || node.qualifiedName || node.name;
    const lines = this.load(node.filePath);
    if (!lines) return null;
    const first = Math.max(0, node.startLine - 1);
    const afterLast = Math.min(lines.length, node.endLine);
    return lines.slice(first, afterLast).join('\n');
  }
}

/**
 * Nodes worth showing code for, best first: entry points, then remaining functions
 * and methods, then remaining classes (each group in discovery order).
 */
function codePriority(subgraph: Subgraph): Node[] {
  const rootIds = new Set(subgraph.roots);
  const result = subgraph.roots
    .map((id) => subgraph.nodes.get(id))
    .filter((node): node is Node => node !== undefined);
  const remaining = Array.from(subgraph.nodes.values()).filter((node) => !rootIds.has(node.id));
  const tiers: ReadonlyArray<(node: Node) => boolean> = [
    (node) => node.kind === 'function' || node.kind === 'method',
    (node) => node.kind === 'class',
  ];
  for (const belongsToTier of tiers) {
    result.push(...remaining.filter(belongsToTier));
  }
  return result;
}

/** Code blocks for the highest-priority symbols, stopping as soon as the budget is met. */
export function selectCodeBlocks(subgraph: Subgraph, reader: SourceReader, maxBlocks: number, maxBlockSize: number): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  for (const node of codePriority(subgraph)) {
    if (blocks.length >= maxBlocks) break;
    const source = reader.read(node);
    if (!source) continue;
    const content = source.length > maxBlockSize
      ? `${source.slice(0, maxBlockSize)}${TRUNCATION_MARKER}`
      : source;
    blocks.push({
      content,
      filePath: node.filePath,
      startLine: node.startLine,
      endLine: node.endLine,
      language: node.language,
      node,
    });
  }
  return blocks;
}
