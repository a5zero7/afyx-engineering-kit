import type { Node, NodeKind, UnresolvedReference } from '../../types';
import { scanSource, type NativeToken } from './scanner';
import {
  finishDynamicFacts, narrowestOwner, tokenText,
  type NativeDeclaration, type NativeReference,
} from './dynamic-fact-builder';

const TYPE_KINDS = new Set<NodeKind>(['namespace', 'class', 'struct', 'interface', 'enum']);
const CALLABLES = new Set<NodeKind>(['function', 'method']);
const MODIFIERS = new Set('public private protected friend shared readonly writeonly overridable overrides mustoverride notoverridable mustinherit notinheritable partial default shadows overloads async iterator widening narrowing'.split(' '));
const CONTROL = new Set('if elseif while until for foreach select switch catch synclock using with do loop return throw new get set addhandler removehandler raiseevent'.split(' '));
const BUILTINS = new Set('boolean byte sbyte char date decimal double integer uinteger long ulong object short ushort single string void'.split(' '));

interface SourceLine {
  readonly number: number;
  readonly start: number;
  readonly end: number;
}

function lower(token: NativeToken | undefined): string {
  return token?.text.toLowerCase() ?? '';
}

function identifierName(token: NativeToken | undefined): string | undefined {
  if (token?.kind !== 'identifier') return undefined;
  return token.text.startsWith('[') && token.text.endsWith(']') ? token.text.slice(1, -1) : token.text;
}

function dottedName(tokens: readonly NativeToken[], from: number, limit: number): { name: string; end: number } | undefined {
  const first = identifierName(tokens[from]);
  if (!first) return undefined;
  let name = first;
  let end = from;
  while (end + 2 <= limit && tokens[end + 1]?.text === '.') {
    const part = identifierName(tokens[end + 2]);
    if (!part) break;
    name += `.${part}`;
    end += 2;
  }
  return { name, end };
}

function linesFor(tokens: readonly NativeToken[]): SourceLine[] {
  const lines: SourceLine[] = [];
  for (let index = 0; index < tokens.length;) {
    const number = tokens[index]!.start.line;
    let end = index;
    while (end + 1 < tokens.length && tokens[end + 1]!.start.line === number) end += 1;
    lines.push({ number, start: index, end });
    index = end + 1;
  }
  return lines;
}

function significant(tokens: readonly NativeToken[], line: SourceLine): number[] {
  const out: number[] = [];
  for (let index = line.start; index <= line.end; index += 1) {
    if (tokens[index]!.kind !== 'comment') out.push(index);
  }
  return out;
}

function declarationKeyword(tokens: readonly NativeToken[], indexes: readonly number[]): number {
  for (let position = 0; position < indexes.length; position += 1) {
    const word = lower(tokens[indexes[position]!]);
    if (!MODIFIERS.has(word) && !['custom', 'readonly', 'writeonly'].includes(word)) return position;
  }
  return -1;
}

function matchingEnd(
  tokens: readonly NativeToken[],
  lines: readonly SourceLine[],
  from: number,
  keyword: string,
): number {
  let depth = 1;
  for (let lineIndex = from + 1; lineIndex < lines.length; lineIndex += 1) {
    const indexes = significant(tokens, lines[lineIndex]!);
    if (indexes.length === 0) continue;
    const words = indexes.map((index) => lower(tokens[index]));
    if (words[0] === 'end' && words[1] === keyword) {
      depth -= 1;
      if (depth === 0) return indexes.at(-1)!;
      continue;
    }
    if (['sub', 'function'].includes(keyword)) {
      const nestedAt = words.indexOf(keyword);
      if (nestedAt > 0 && words.slice(0, nestedAt).some((word) => word === 'dim' || word === '=')) {
        const open = indexes.slice(nestedAt + 1).find((index) => tokens[index]?.text === '(');
        const close = open === undefined ? undefined : indexes.find((index) => index > open && tokens[index]?.text === ')');
        if (close !== undefined && close === indexes.at(-1)) depth += 1;
      }
    }
    const head = declarationKeyword(tokens, indexes);
    if (head >= 0 && words[head] === keyword && !['sub', 'function', 'property'].includes(keyword)) depth += 1;
  }
  return tokens.length - 1;
}

function visibility(tokens: readonly NativeToken[], indexes: readonly number[]): Node['visibility'] {
  for (const index of indexes) {
    const word = lower(tokens[index]);
    if (word === 'public' || word === 'private' || word === 'protected') return word;
    if (word === 'friend') return 'internal';
  }
  return undefined;
}

function typeNameAfter(tokens: readonly NativeToken[], indexes: readonly number[], marker: string): { name: string; index: number } | undefined {
  const at = indexes.findIndex((index) => lower(tokens[index]) === marker);
  if (at < 0) return undefined;
  for (let position = at + 1; position < indexes.length; position += 1) {
    const index = indexes[position]!;
    const name = identifierName(tokens[index]);
    if (!name || lower(tokens[index]) === 'new') continue;
    const qualified = dottedName(tokens, index, indexes.at(-1)!);
    if (!qualified) continue;
    return { name: qualified.name.split('.').at(-1)!, index };
  }
  return undefined;
}

/** Bounded, case-aware VB.NET facts for Afyx's graph contract. */
export function extractNativeVbnetFacts(filePath: string, source: string) {
  const started = Date.now();
  const scan = scanSource(source, { hashComments: false, vbnetSyntax: true });
  const tokens = scan.tokens;
  const lines = linesFor(tokens);
  const declarations: NativeDeclaration[] = [];
  const references: NativeReference[] = [];

  const ownerAt = (index: number, kinds?: ReadonlySet<NodeKind>) => narrowestOwner(declarations, index, kinds);
  const addRef = (index: number, name: string, kind: UnresolvedReference['referenceKind'], owner?: NativeDeclaration): void => {
    const token = tokens[index];
    if (token && name) references.push({ owner, token, name, kind });
  };

  // Namespaces establish qualification/ownership but are not compiler scopes here.
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const indexes = significant(tokens, lines[lineIndex]!);
    if (lower(tokens[indexes[0]!]) !== 'namespace') continue;
    const name = dottedName(tokens, indexes[1]!, indexes.at(-1)!);
    if (!name) continue;
    declarations.push({
      kind: 'namespace', name: name.name, start: indexes[1]!,
      end: matchingEnd(tokens, lines, lineIndex, 'namespace'),
      bodyStart: indexes.at(-1)!, bodyEnd: matchingEnd(tokens, lines, lineIndex, 'namespace'),
    });
  }

  // Named type containers. VB modules retain the established class-shaped graph node.
  const typeWords: Readonly<Record<string, NodeKind>> = {
    class: 'class', module: 'class', structure: 'struct', interface: 'interface', enum: 'enum',
  };
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const indexes = significant(tokens, lines[lineIndex]!);
    const head = declarationKeyword(tokens, indexes);
    const keyword = head >= 0 ? lower(tokens[indexes[head]!]) : '';
    const kind = typeWords[keyword];
    const nameIndex = head >= 0 ? indexes[head + 1] : undefined;
    const name = identifierName(nameIndex === undefined ? undefined : tokens[nameIndex]);
    if (!kind || nameIndex === undefined || !name || lower(tokens[indexes[0]!]) === 'end') continue;
    const end = matchingEnd(tokens, lines, lineIndex, keyword);
    declarations.push({
      kind, name, start: nameIndex, end, bodyStart: indexes.at(-1)!, bodyEnd: end,
      visibility: visibility(tokens, indexes),
      abstract: indexes.some((index) => lower(tokens[index]) === 'mustinherit'),
    });
  }

  // Nest namespaces and types after all ranges are known.
  for (const declaration of declarations) {
    declaration.parent = declarations.filter((candidate) => candidate !== declaration &&
      TYPE_KINDS.has(candidate.kind) && candidate.bodyStart !== undefined && candidate.bodyEnd !== undefined &&
      candidate.bodyStart < declaration.start && candidate.bodyEnd >= declaration.end)
      .sort((left, right) => (left.bodyEnd! - left.bodyStart!) - (right.bodyEnd! - right.bodyStart!))[0];
  }

  // Imports preserve concrete namespaces; aliases remain intentionally unsupported like the old adapter.
  for (const line of lines) {
    const indexes = significant(tokens, line);
    if (lower(tokens[indexes[0]!]) !== 'imports') continue;
    for (let position = 1; position < indexes.length; position += 1) {
      const index = indexes[position]!;
      const item = dottedName(tokens, index, indexes.at(-1)!);
      if (!item) continue;
      if (tokens[item.end + 1]?.text === '=') break;
      declarations.push({ kind: 'import', name: item.name, start: index, end: item.end, signature: tokenText(source, tokens, indexes[0]!, indexes.at(-1)!) });
      addRef(index, item.name, 'imports');
      position = indexes.indexOf(item.end);
      if (tokens[item.end + 1]?.text !== ',') break;
    }
  }

  // Delegates are type aliases in the established graph model.
  for (const line of lines) {
    const indexes = significant(tokens, line);
    const delegateAt = indexes.findIndex((index) => lower(tokens[index]) === 'delegate');
    if (delegateAt < 0) continue;
    const routineAt = indexes.findIndex((index, position) => position > delegateAt && ['sub', 'function'].includes(lower(tokens[index])));
    const nameIndex = routineAt >= 0 ? indexes[routineAt + 1] : undefined;
    const name = identifierName(nameIndex === undefined ? undefined : tokens[nameIndex]);
    if (!name || nameIndex === undefined) continue;
    declarations.push({ kind: 'type_alias', name, start: nameIndex, end: indexes.at(-1)!, parent: ownerAt(nameIndex, TYPE_KINDS), visibility: visibility(tokens, indexes) });
  }

  // Routines and constructors. Interface/MustOverride declarations are bodyless.
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const indexes = significant(tokens, lines[lineIndex]!);
    if (indexes.length === 0 || lower(tokens[indexes[0]!]) === 'end' || indexes.some((index) => lower(tokens[index]) === 'delegate')) continue;
    const routineAt = indexes.findIndex((index) => ['sub', 'function'].includes(lower(tokens[index])));
    if (routineAt < 0 || indexes.slice(0, routineAt).some((index) => ['dim', 'return', '='].includes(lower(tokens[index])))) continue;
    const nameIndex = indexes[routineAt + 1];
    const name = identifierName(nameIndex === undefined ? undefined : tokens[nameIndex]);
    if (!name || nameIndex === undefined) continue;
    const parent = ownerAt(nameIndex, TYPE_KINDS);
    const abstract = indexes.some((index) => ['mustoverride', 'declare'].includes(lower(tokens[index]))) || parent?.kind === 'interface';
    const keyword = lower(tokens[indexes[routineAt]!]);
    const end = abstract ? indexes.at(-1)! : matchingEnd(tokens, lines, lineIndex, keyword);
    const paramsOpen = indexes.slice(routineAt + 2).find((index) => tokens[index]?.text === '(');
    const paramsClose = paramsOpen === undefined ? undefined : scan.pairs.get(paramsOpen);
    const returnIndexes = paramsClose === undefined ? indexes : indexes.filter((index) => index > paramsClose);
    const returnType = keyword === 'function' ? typeNameAfter(tokens, returnIndexes, 'as')?.name : undefined;
    declarations.push({
      kind: parent ? 'method' : 'function', name, start: nameIndex, end,
      bodyStart: abstract ? undefined : indexes.at(-1), bodyEnd: abstract ? undefined : end,
      parent, returnType, signature: tokenText(source, tokens, indexes[0]!, indexes.at(-1)!),
      visibility: visibility(tokens, indexes), static: indexes.some((index) => lower(tokens[index]) === 'shared'),
      async: indexes.some((index) => lower(tokens[index]) === 'async'), abstract,
    });
  }

  // Properties, constants, fields, and events are direct type members only.
  for (const line of lines) {
    const indexes = significant(tokens, line);
    if (indexes.length === 0 || lower(tokens[indexes[0]!]) === 'end') continue;
    const owner = ownerAt(indexes[0]!, TYPE_KINDS);
    if (!owner || owner.kind === 'struct' || ownerAt(indexes[0]!, CALLABLES) ||
        indexes.some((index) => ['sub', 'function', 'delegate'].includes(lower(tokens[index])))) continue;
    const propertyAt = indexes.findIndex((index) => lower(tokens[index]) === 'property');
    if (propertyAt >= 0) {
      const nameIndex = indexes[propertyAt + 1];
      const name = identifierName(nameIndex === undefined ? undefined : tokens[nameIndex]);
      if (name && nameIndex !== undefined) declarations.push({ kind: 'property', name, start: nameIndex, end: indexes.at(-1)!, parent: owner, visibility: visibility(tokens, indexes), abstract: indexes.some((index) => lower(tokens[index]) === 'mustoverride') });
      continue;
    }
    const eventAt = indexes.findIndex((index) => lower(tokens[index]) === 'event');
    if (eventAt >= 0) {
      const nameIndex = indexes[eventAt + 1];
      const name = identifierName(nameIndex === undefined ? undefined : tokens[nameIndex]);
      if (name && nameIndex !== undefined) declarations.push({ kind: 'field', name, start: nameIndex, end: indexes.at(-1)!, parent: owner, visibility: visibility(tokens, indexes) });
      continue;
    }
    const marker = indexes.findIndex((index) => ['const', 'dim'].includes(lower(tokens[index])));
    const asAt = indexes.findIndex((index) => lower(tokens[index]) === 'as');
    if (marker < 0 && asAt < 1) continue;
    const nameIndex = marker >= 0 ? indexes[marker + 1] : indexes.slice(0, asAt).reverse().find((index) => tokens[index]!.kind === 'identifier');
    const name = identifierName(nameIndex === undefined ? undefined : tokens[nameIndex]);
    if (!name || nameIndex === undefined || MODIFIERS.has(name.toLowerCase())) continue;
    declarations.push({ kind: 'field', name, start: nameIndex, end: indexes.at(-1)!, parent: owner, visibility: visibility(tokens, indexes), static: indexes.some((index) => lower(tokens[index]) === 'shared') });
  }

  // Enum members are direct, non-End lines inside an enum.
  for (const parent of declarations.filter((item) => item.kind === 'enum')) {
    for (const line of lines) {
      if (line.start <= parent.bodyStart! || line.end >= parent.bodyEnd!) continue;
      const indexes = significant(tokens, line);
      const nameIndex = indexes.find((index) => tokens[index]!.kind === 'identifier');
      const name = identifierName(nameIndex === undefined ? undefined : tokens[nameIndex]);
      if (name && nameIndex !== undefined && !['end', 'inherits', 'implements'].includes(name.toLowerCase())) declarations.push({ kind: 'enum_member', name, start: nameIndex, end: line.end, parent });
    }
  }

  // Inherits/Implements statements belong to the nearest type.
  for (const line of lines) {
    const indexes = significant(tokens, line);
    const relationAt = indexes.findIndex((index) => ['inherits', 'implements'].includes(lower(tokens[index])));
    if (relationAt < 0) continue;
    const owner = ownerAt(indexes[relationAt]!, TYPE_KINDS);
    if (!owner) continue;
    const kind = lower(tokens[indexes[relationAt]!]) === 'inherits' ? 'extends' : 'implements';
    for (let position = relationAt + 1; position < indexes.length; position += 1) {
      const index = indexes[position]!;
      if (tokens[index]!.kind !== 'identifier' || lower(tokens[index]) === 'of') continue;
      const item = dottedName(tokens, index, indexes.at(-1)!);
      if (!item) continue;
      addRef(index, item.name.split('.').at(-1)!, kind, owner);
      const genericOpen = tokens[item.end + 1]?.text === '(' && lower(tokens[item.end + 2]) === 'of' ? item.end + 1 : -1;
      if (genericOpen >= 0 && scan.pairs.has(genericOpen)) position = indexes.indexOf(scan.pairs.get(genericOpen)!);
      else position = indexes.indexOf(item.end);
    }
  }

  // Header type references: preserve original spelling, compare keywords case-insensitively.
  for (const declaration of declarations.filter((item) => CALLABLES.has(item.kind) || ['property', 'field', 'constant', 'type_alias'].includes(item.kind))) {
    const limit = declaration.bodyStart ?? declaration.end;
    const seen = new Set<string>();
    for (let index = declaration.start; index <= limit; index += 1) {
      if (lower(tokens[index]) !== 'as') continue;
      const type = typeNameAfter(tokens, [index, ...Array.from({ length: limit - index }, (_, offset) => index + offset + 1)], 'as');
      if (!type || BUILTINS.has(type.name.toLowerCase()) || seen.has(type.name.toLowerCase())) continue;
      seen.add(type.name.toLowerCase());
      addRef(type.index, type.name, 'references', declaration);
    }
  }

  // Calls and construction are emitted only inside routine bodies. As before,
  // parenthesized default-property/index access remains a call candidate.
  for (const owner of declarations.filter((item) => CALLABLES.has(item.kind) && item.bodyStart !== undefined && item.bodyEnd !== undefined)) {
    const emitted = new Set<string>();
    for (let index = owner.bodyStart! + 1; index < owner.bodyEnd!; index += 1) {
      if (lower(tokens[index]) === 'new') {
        const item = dottedName(tokens, index + 1, owner.bodyEnd!);
        if (item && !BUILTINS.has(item.name.toLowerCase())) {
          const name = item.name.split('.').at(-1)!;
          const key = `new:${index}:${name.toLowerCase()}`;
          if (!emitted.has(key)) { addRef(index + 1, name, 'instantiates', owner); emitted.add(key); }
        }
        continue;
      }
      const name = identifierName(tokens[index]);
      if (!name || CONTROL.has(name.toLowerCase())) continue;
      if (lower(tokens[index - 1]) === 'new') continue;
      let open = index + 1;
      if (tokens[open]?.text === '(' && lower(tokens[open + 1]) === 'of' && scan.pairs.has(open)) open = scan.pairs.get(open)! + 1;
      if (tokens[open]?.text !== '(' || !scan.pairs.has(open)) continue;
      if (declarations.some((item) => item.start === index)) continue;
      let callName = name;
      let marker = index;
      if (tokens[index - 1]?.text === '.' && tokens[index - 2]?.kind === 'identifier') {
        const receiver = identifierName(tokens[index - 2])!;
        callName = ['me', 'mybase', 'myclass'].includes(receiver.toLowerCase()) ? name : `${receiver}.${name}`;
        marker = index - 2;
      }
      const key = `call:${marker}:${callName.toLowerCase()}`;
      if (!emitted.has(key)) { addRef(marker, callName, 'calls', owner); emitted.add(key); }
    }
  }

  return finishDynamicFacts(filePath, source, 'vbnet', scan, declarations, references, started);
}
