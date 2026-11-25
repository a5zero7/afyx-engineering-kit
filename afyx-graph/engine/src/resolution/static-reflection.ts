/** Copyright (c) 2026 Afyx */
import type { Edge, Node } from '../types';
import type { MaybeYield } from './cooperative-yield';
import { BindingSource, callable, localSource, type SchemaBindingContext } from './schema-binding-source';

const MAX_EDGES = 2048;
function currentScope(source: BindingSource, line: number): Node | undefined {
  const matches = source.nodes.filter(node => callable(node) && node.startLine <= line && node.endLine >= line);
  return matches.length === 1 ? matches[0] : undefined;
}

function target(source: BindingSource, type: string, member: string | undefined, language: Node['language']): Node | undefined {
  const qualified = member === undefined ? type : type + '::' + member;
  const candidates = source.ctx.getNodesByQualifiedName(qualified).filter(node => node.language === language &&
    (member === undefined ? node.kind === 'class' : node.kind === 'method'));
  if (candidates.length !== 1) return undefined;
  const node = candidates[0]!;
  const content = localSource(source.ctx, node.filePath);
  if (!content) return undefined;
  if (language === 'csharp' && member !== undefined) {
    // Extraction may coalesce overloads into one method ID. Verify the
    // declaration count lexically in the exact owner body before linking.
    const origin = node.filePath === source.file ? source : new BindingSource(source.ctx, node.filePath, content);
    const index = origin.positionIndex(node);
    const scope = index === undefined ? undefined : origin.braceScope(index);
    if (scope === undefined || scope < 0) return undefined;
    const matches = [...origin.marks(member)].filter(mark =>
      origin.braceScope(mark) === scope && origin.text(origin.next(mark)) === '(');
    if (matches.length !== 1) return undefined;
  }
  return node;
}

function csharpMethodName(source: BindingSource, argument: number, call: number): string | undefined {
  const literal = source.literal(argument);
  const name = source.id(argument);
  if (literal || !name) return literal;
  const scope = source.braceScope(call);
  if (scope === undefined || scope < 0) return undefined;
  const declarations = [...source.marks(name)].filter(i =>
    i < call && source.braceScope(i) === scope && source.text(source.next(i)) === '=');
  if (declarations.length !== 1) return undefined;
  const declaration = declarations[0]!;
  if (source.text(declaration - 2) !== 'const' || source.text(declaration - 1) !== 'string') return undefined;
  const value = source.next(source.next(declaration));
  return source.text(source.next(value)) === ';' ? source.literal(value) : undefined;
}

function* reflect(source: BindingSource): IterableIterator<Edge> {
  for (let i = 0; i < source.length; i++) {
    const language = source.file.endsWith('.php') ? 'php' : source.file.endsWith('.cs') ? 'csharp' : 'ruby';
    const marker = source.text(i);
    if (!['ReflectionMethod', '[', 'typeof', 'public_send'].includes(marker)) continue;
    const caller = currentScope(source, source.line(i));
    if (!caller) continue;
    let resolved: Node | undefined;
    let kind: Edge['kind'] = 'references';
    if (language === 'php' && ((marker === 'ReflectionMethod' && source.text(i - 1) === 'new') || marker === '[')) {
      const open = marker === '[' ? i : source.next(i);
      if (source.text(open) !== (marker === '[' ? '[' : '(')) continue;
      const [type, method, extra] = [...source.items(open)];
      if (!type || !method || extra || source.next(method.start) !== method.stop) continue;
      const first = source.text(type.start) === '\\' ? source.next(type.start) : type.start;
      const name = source.names(first, '\\');
      const nameParts = [...name.parts];
      if (!nameParts.length || source.text(name.next) !== '::' || source.text(source.next(name.next)) !== 'class' ||
          source.next(source.next(name.next)) !== type.stop) continue;
      if (first === type.start) {
        if (nameParts.length !== 1) continue;
        const aliases = source.ctx.getImportMappings(source.file, 'php').filter(item => item.localName === nameParts[0]);
        if (aliases.length) continue;
        nameParts.unshift(...caller.qualifiedName.split('::').slice(0, -2));
      }
      const member = source.literal(method.start);
      if (member) resolved = target(source, nameParts.join('::'), member, 'php');
    } else if (language === 'csharp' && marker === 'typeof') {
      const open = source.next(i);
      const close = source.end(open);
      if (source.text(open) !== '(' || close === undefined) continue;
      const type = source.names(source.next(open), '.');
      if (!type.parts.length || type.next !== close) continue;
      const name = type.parts.length === 1
        ? [...caller.qualifiedName.split('::').slice(0, -2), ...type.parts].join('::') : type.parts.join('::');
      const dot = source.next(close);
      if (source.text(dot) === '.' && source.text(source.next(dot)) === 'GetMethod') {
        const args = source.next(source.next(dot));
        const [arg, extra] = [...source.items(args)];
        if (!arg || extra || source.next(arg.start) !== arg.stop) continue;
        const member = csharpMethodName(source, arg.start, i);
        if (member) resolved = target(source, name, member, 'csharp');
      } else if (source.text(i - 1) === '(' && source.text(i - 2) === 'CreateInstance' &&
                 source.text(i - 3) === '.' && source.text(i - 4) === 'Activator' && source.text(dot) === ')') {
        resolved = target(source, name, undefined, 'csharp');
        kind = 'instantiates';
      }
    } else if (language === 'ruby' && marker === 'public_send') {
      if (source.text(i - 1) === '.' && source.text(i - 2) !== 'self') continue;
      const type = caller.qualifiedName.split('::').slice(0, -1).join('::');
      if (!type || target(source, type, 'public_send', 'ruby')) continue;
      const open = source.next(i);
      const [arg] = [...source.items(open)];
      if (source.text(open) !== '(' || !arg || source.text(arg.start) !== ':' ||
          source.next(source.next(arg.start)) !== arg.stop) continue;
      const member = source.id(source.next(arg.start));
      if (member) resolved = target(source, type, member, 'ruby');
      kind = 'calls';
    }
    if (resolved && resolved.id !== caller.id) yield {
      source: caller.id, target: resolved.id, kind, line: source.line(i), provenance: 'heuristic',
      metadata: { synthesis: 'static-reflection' },
    };
  }
}

export async function staticReflectionEdges(ctx: SchemaBindingContext, files: readonly string[], yieldToLoop: MaybeYield): Promise<Edge[]> {
  const edges: Edge[] = [];
  for (const file of files) {
    if (!/\.(?:php|cs|rb)$/.test(file)) continue;
    await yieldToLoop();
    const content = localSource(ctx, file);
    if (!content || !/::class|ReflectionMethod|GetMethod|CreateInstance|public_send/.test(content)) continue;
    for (const edge of reflect(new BindingSource(ctx, file, content))) {
      edges.push(edge);
      if (edges.length >= MAX_EDGES) return edges;
    }
  }
  return edges;
}
