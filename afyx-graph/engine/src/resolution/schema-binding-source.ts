/** Copyright (c) 2026 Afyx */
import { readFileSync, statSync } from 'node:fs';
import { scanSource, type NativeToken } from '../extraction/native/scanner';
import { hashContent } from '../extraction/content-hash';
import type { Edge, Node } from '../types';
import { validatePathWithinRoot } from '../utils';
import { isGeneratedFile } from '../extraction/generated-detection';
import { resolveImportPath } from './import-resolver';
import type { ResolutionContext } from './types';

export const JS_SOURCE = /\.[cm]?[jt]sx?$/i;
const MAX_SOURCE_BYTES = 1024 * 1024;

export type Binding = { owner: string; member: string; target: Node; evidence: string };
export type SchemaBindingContext = ResolutionContext & {
  indexedHash(file: string): string | undefined;
};

export function localSource(ctx: SchemaBindingContext, file: string): string | null {
  if (isGeneratedFile(file)) return null;
  const path = validatePathWithinRoot(ctx.getProjectRoot(), file);
  if (!path) return null;
  try {
    const stat = statSync(path);
    if (!stat.isFile() || stat.size > MAX_SOURCE_BYTES) return null;
    const source = readFileSync(path, 'utf8');
    // A path-scoped sync can leave unrelated edited files pending. Never
    // match current source positions to nodes from a different file revision.
    return ctx.indexedHash(file) === hashContent(source) ? source : null;
  } catch {
    return null;
  }
}

export function callable(node: Node): boolean {
  return node.kind === 'function' || node.kind === 'method';
}

export function ownerName(node: Node): string | undefined {
  return node.qualifiedName.split('::').at(-2);
}

export function schemaEdge(source: Node, binding: Binding, synthesis: string): Edge {
  return {
    source: source.id,
    target: binding.target.id,
    kind: 'calls',
    provenance: 'heuristic',
    metadata: { synthesis, binding: binding.evidence },
  };
}

function only<T>(matches: readonly T[]): T | undefined {
  return matches.length === 1 ? matches[0] : undefined;
}

export class BindingSource {
  private readonly scan;
  private readonly tokens: readonly NativeToken[];
  private readonly positions = new Map<string, Node[]>();
  private braceOwners?: number[];
  readonly nodes: Node[];

  constructor(readonly ctx: SchemaBindingContext, readonly file: string, readonly sourceText: string) {
    const python = file.endsWith('.py');
    this.scan = scanSource(sourceText, {
      rustSyntax: file.endsWith('.rs'),
      hashComments: python || /\.(?:rb|php|gql|graphql)$/.test(file),
      tripleQuotedStrings: python || file.endsWith('.java'),
      javascriptRegex: JS_SOURCE.test(file),
    });
    // Keep original indexes so delimiter pairs survive comment removal.
    this.tokens = this.scan.tokens;
    this.nodes = ctx.getNodesInFile(file);
    for (const node of this.nodes) {
      const key = `${node.startLine}:${node.startColumn}`;
      const at = this.positions.get(key) ?? [];
      at.push(node);
      this.positions.set(key, at);
    }
  }

  get length(): number { return this.tokens.length; }
  text(i: number): string { return this.tokens[i]?.text ?? ''; }
  id(i: number): string | undefined {
    const token = this.tokens[i];
    return token?.kind === 'identifier' ? token.text : undefined;
  }
  literal(i: number): string | undefined {
    const token = this.tokens[i];
    if (token?.kind !== 'string') return undefined;
    return /^(['"])([A-Za-z_]\w*)\1$/.exec(token.text)?.[2];
  }
  stringToken(i: number): string | undefined {
    const token = this.tokens[i];
    return token?.kind === 'string' ? token.text : undefined;
  }
  line(i: number): number { return this.tokens[i]?.start.line ?? 0; }
  end(i: number): number | undefined { return this.scan.pairs.get(i); }
  next(i: number): number {
    do { i++; } while (this.tokens[i]?.kind === 'comment');
    return i;
  }
  braceScope(index: number): number | undefined {
    if (!this.braceOwners) {
      const blocks: Array<{ open: number; close: number }> = [];
      this.braceOwners = [];
      for (let i = 0; i < this.length; i++) {
        while (blocks.length && blocks.at(-1)!.close <= i) blocks.pop();
        this.braceOwners.push(blocks.at(-1)?.open ?? -1);
        const close = this.end(i);
        if (this.text(i) === '{' && close !== undefined) blocks.push({ open: i, close });
      }
    }
    return this.braceOwners[index];
  }
  pythonScope(index: number): string | undefined {
    const line = this.line(index);
    return this.nodes.filter(node => (callable(node) || node.kind === 'class') &&
      node.startLine <= line && node.endLine >= line)
      .sort((a, b) => b.startLine - a.startLine)[0]?.id;
  }
  nodeAt(i: number, predicate: (node: Node) => boolean): Node | undefined {
    const token = this.tokens[i];
    if (!token) return undefined;
    const { line, column } = token.start;
    return only((this.positions.get(`${line}:${column}`) ?? []).filter(predicate));
  }

  positionIndex(node: Node): number | undefined {
    let low = 0, high = this.tokens.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      const pos = this.tokens[middle]!.start;
      if (pos.line < node.startLine || (pos.line === node.startLine && pos.column < node.startColumn)) low = middle + 1;
      else high = middle;
    }
    const pos = this.tokens[low]?.start;
    return pos?.line === node.startLine && pos.column === node.startColumn ? low : undefined;
  }

  containsPosition(open: number, close: number, node: Node): boolean {
    const index = this.positionIndex(node);
    return index !== undefined && index > open && index < close;
  }

  qualified(i: number) { return this.names(i, '.'); }

  names(i: number, separator: string): { parts: string[]; next: number } {
    const parts: string[] = [];
    for (let name = this.id(i); name; name = this.id(i)) {
      parts.push(name);
      i = this.next(i);
      if (this.text(i) !== separator) break;
      i = this.next(i);
    }
    return { parts, next: i };
  }

  *marks(name: string): IterableIterator<number> {
    for (let i = 0; i < this.length; i++) if (this.id(i) === name) yield i;
  }

  *items(open: number): IterableIterator<{ start: number; stop: number }> {
    const close = this.end(open);
    if (close === undefined) return;
    for (let start = this.next(open); start < close;) {
      let stop = start;
      while (stop < close && this.text(stop) !== ',') {
        stop = this.next(this.end(stop) ?? stop);
      }
      if (stop > start) yield { start, stop };
      start = this.next(stop);
    }
  }

  *properties(open: number): IterableIterator<{ key: string; start: number; value: number; stop: number }> {
    if (this.text(open) !== '{') return;
    for (const { start, stop } of this.items(open)) {
      const keyIndex = this.text(start) === 'async' && this.id(this.next(start)) ? this.next(start) : start;
      const key = this.id(keyIndex) ?? this.literal(keyIndex);
      if (!key) continue;
      const afterKey = this.next(keyIndex);
      const value = this.text(afterKey) === ':' ? this.next(afterKey) : keyIndex;
      yield { key, start: keyIndex, value, stop };
    }
  }

  propertyTarget(property: { key: string; start: number; value: number; stop: number }): Node | undefined {
    const name = this.id(property.value);
    if (name && this.next(property.value) === property.stop) {
      const locals = this.nodes.filter(node => callable(node) && !ownerName(node) && node.name === name);
      if (locals.length > 0) return only(locals);
      const imports = this.ctx.getImportMappings(this.file, /\.[cm]?tsx?$/i.test(this.file) ? 'typescript' : 'javascript');
      const binding = only(imports.filter(item => item.localName === name && !item.isNamespace && !item.isDefault));
      if (!binding) return undefined;
      const path = binding.resolvedPath ?? resolveImportPath(binding.source, this.file,
        /\.[cm]?tsx?$/i.test(this.file) ? 'typescript' : 'javascript', this.ctx);
      return path ? only(this.ctx.getNodesInFile(path).filter(node =>
        callable(node) && !ownerName(node) && node.name === binding.exportedName)) : undefined;
    }
    // Native extraction anchors ordinary object methods at their key and
    // inferred arrow/function names at the key or the initializer.
    return this.nodeAt(property.start, node => callable(node) && node.name === property.key)
      ?? this.nodeAt(property.value, callable);
  }

  *annotations(): IterableIterator<{
    name: string; args: number[]; after: number;
  }> {
    for (let i = 0; i < this.length; i++) {
      if (this.text(i) !== '@') continue;
      const annotation = this.qualified(this.next(i));
      if (!annotation.parts.length) continue;
      let after = annotation.next;
      const args = this.text(after) === '(' ? [...this.items(after)].map(arg => arg.start) : [];
      if (this.text(after) === '(') {
        const close = this.end(after);
        if (close === undefined) continue;
        after = this.next(close);
      }
      while (this.text(after) === '@') {
        const decorator = this.qualified(this.next(after));
        if (!decorator.parts.length) break;
        const close = this.end(decorator.next);
        after = close === undefined ? decorator.next : this.next(close);
      }
      yield { name: annotation.parts.join('.'), args, after };
    }
  }

  declaration(after: number, predicate: (node: Node) => boolean): Node | undefined {
    const modifiers = new Set(['public', 'private', 'protected', 'static', 'async', 'override', 'export', 'default']);
    for (let i = after; i < this.length; i = this.next(i)) {
      const node = this.nodeAt(i, predicate);
      if (node) return node;
      if (!modifiers.has(this.text(i))) break;
    }
    return undefined;
  }
}

export function groupBy<T>(items: Iterable<T>, key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const name = key(item);
    const group = groups.get(name) ?? [];
    group.push(item);
    groups.set(name, group);
  }
  return groups;
}
