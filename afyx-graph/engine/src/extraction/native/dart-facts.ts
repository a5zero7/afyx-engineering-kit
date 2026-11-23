import type { NodeKind, UnresolvedReference } from '../../types';
import { scanSource, type NativeToken } from './scanner';
import {
  finishDynamicFacts, narrowestOwner, nextToken, tokenText, unquote,
  type NativeDeclaration, type NativeReference,
} from './dynamic-fact-builder';

const CALLABLES = new Set<NodeKind>(['function', 'method']);
const CONTROL = new Set('assert catch do else for if return switch throw try while'.split(' '));
const MODIFIERS = new Set('abstract async covariant external factory final late required static const get set operator sync'.split(' '));
const BUILTINS = new Set('bool double dynamic Function int List Map Never num Object Record Set String Symbol Type Uri void'.split(' '));

function declarationStart(tokens: readonly NativeToken[], index: number, floor = 0): number {
  let start = index;
  while (start > floor && ![';', '{', '}'].includes(tokens[start - 1]!.text)) start -= 1;
  return start;
}

function directOwner(declarations: readonly NativeDeclaration[], index: number): NativeDeclaration | undefined {
  return narrowestOwner(declarations, index, new Set<NodeKind>(['class', 'enum']));
}

function nearestCallable(declarations: readonly NativeDeclaration[], index: number): NativeDeclaration | undefined {
  return narrowestOwner(declarations, index, CALLABLES);
}

function dartType(tokens: readonly NativeToken[], start: number, end: number): string | undefined {
  const identifiers = tokens.slice(start, end).filter((token) => token.kind === 'identifier' && !MODIFIERS.has(token.text));
  const first = identifiers[0]?.text;
  if (!first || ['var', 'final', 'const'].includes(first)) return undefined;
  return first.split('.').at(-1);
}

/** Bounded Afyx-native Dart facts for the repository's established graph contract. */
export function extractNativeDartFacts(filePath: string, source: string) {
  const started = Date.now();
  const scan = scanSource(source, { hashComments: false, dartSyntax: true });
  const tokens = scan.tokens;
  const declarations: NativeDeclaration[] = [];
  const references: NativeReference[] = [];

  const blockAfter = (from: number): { open: number; close: number } | undefined => {
    for (let index = from; index < tokens.length; index += 1) {
      if (tokens[index]!.text === ';') return undefined;
      if (tokens[index]!.text !== '{') continue;
      const close = scan.pairs.get(index);
      return close === undefined ? undefined : { open: index, close };
    }
    return undefined;
  };
  const pushRef = (index: number, name: string, kind: UnresolvedReference['referenceKind'], owner = nearestCallable(declarations, index) ?? directOwner(declarations, index)): void => {
    const token = tokens[index];
    if (token && name) references.push({ owner, token, name, kind });
  };

  // Imports, exports, parts, and part-of directives are file dependencies.
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const keyword = tokens[index]!.text;
    if (!['import', 'export', 'part'].includes(keyword)) continue;
    if (keyword === 'part' && tokens[index + 1]?.text === 'of') continue;
    const value = tokens.slice(index + 1).findIndex((token) => token.kind === 'string');
    if (value < 0) continue;
    const valueIndex = index + 1 + value;
    const end = nextToken(tokens, valueIndex + 1, ';');
    const name = unquote(tokens[valueIndex]!.text);
    declarations.push({ kind: keyword === 'export' ? 'export' : 'import', name, start: index, end: end < 0 ? valueIndex : end, signature: tokenText(source, tokens, index, end < 0 ? valueIndex : end) });
    references.push({ token: tokens[valueIndex]!, name, kind: keyword === 'export' ? 'exports' : 'imports' });
    index = end < 0 ? valueIndex : end;
  }

  // Class-like declarations. Mixins and extensions intentionally retain the
  // established class-shaped graph representation.
  for (let index = 0; index < tokens.length - 1; index += 1) {
    let keyword = tokens[index]!.text;
    let nameIndex = index + 1;
    if (keyword === 'abstract' && tokens[index + 1]?.text === 'class') { keyword = 'class'; nameIndex = index + 2; }
    if (!['class', 'mixin', 'extension', 'enum'].includes(keyword) || tokens[nameIndex]?.kind !== 'identifier') continue;
    if (keyword === 'extension' && tokens[nameIndex]?.text === 'type') nameIndex += 1;
    const body = blockAfter(nameIndex + 1);
    if (!body || tokens[nameIndex]?.kind !== 'identifier') continue;
    declarations.push({
      kind: keyword === 'enum' ? 'enum' : 'class', name: tokens[nameIndex]!.text,
      start: index, end: body.close, bodyStart: body.open, bodyEnd: body.close,
      visibility: tokens[nameIndex]!.text.startsWith('_') ? 'private' : 'public',
      abstract: tokens[index]!.text === 'abstract',
    });
  }

  // Typedefs are line/semicolon bounded aliases.
  for (let index = 0; index < tokens.length - 1; index += 1) {
    if (tokens[index]!.text !== 'typedef') continue;
    const end = nextToken(tokens, index + 1, ';');
    if (end < 0) continue;
    const equals = nextToken(tokens, index + 1, '=', end);
    const nameToken = equals >= 0
      ? tokens.slice(index + 1, equals).find((token) => token.kind === 'identifier')
      : tokens.slice(index + 1, end).find((token, offset, list) => token.kind === 'identifier' && list[offset + 1]?.text === '(');
    if (nameToken) declarations.push({ kind: 'type_alias', name: nameToken.text, start: index, end, visibility: nameToken.text.startsWith('_') ? 'private' : 'public' });
  }

  // Methods, functions, constructors, getters/setters, and arrow bodies.
  for (let index = 0; index < tokens.length - 1; index += 1) {
    if (tokens[index]!.text !== '(') continue;
    const close = scan.pairs.get(index);
    if (close === undefined) continue;
    let nameIndex = index - 1;
    let constructorClass: string | undefined;
    let name = tokens[nameIndex]?.text;
    if (tokens[nameIndex]?.kind !== 'identifier') continue;
    if (tokens[nameIndex - 1]?.text === '.' && tokens[nameIndex - 2]?.kind === 'identifier') {
      constructorClass = tokens[nameIndex - 2]!.text;
    }
    const parent = directOwner(declarations, index);
    const isCtor = parent?.kind === 'class' && (name === parent.name || constructorClass === parent.name);
    if (isCtor && name === parent?.name) continue; // unnamed construction remains an instantiation only
    const before = tokens[nameIndex - 1]?.text;
    if (!isCtor && (before === '.' || before === '?' || CONTROL.has(name!) || tokens[nameIndex - 1]?.text === 'new')) continue;
    // Candidate must be direct file/container content, never an invocation in an existing callable.
    if (nearestCallable(declarations, index)) continue;
    let cursor = close + 1;
    while (cursor < tokens.length && ['async', 'sync', '*'].includes(tokens[cursor]!.text)) cursor += 1;
    let bodyStart: number | undefined;
    let bodyEnd: number | undefined;
    let end = close;
    if (tokens[cursor]?.text === '{') {
      bodyStart = cursor;
      bodyEnd = scan.pairs.get(cursor);
      if (bodyEnd === undefined) continue;
      end = bodyEnd;
    } else if (tokens[cursor]?.text === '=>') {
      bodyStart = cursor;
      const semicolon = nextToken(tokens, cursor + 1, ';');
      bodyEnd = semicolon < 0 ? cursor : semicolon;
      end = bodyEnd;
    } else if (tokens[cursor]?.text === ';') {
      end = cursor;
    } else {
      continue;
    }
    const start = declarationStart(tokens, constructorClass ? nameIndex - 2 : nameIndex, (parent?.bodyStart ?? -1) + 1);
    const returnType = isCtor ? parent?.name : dartType(tokens, start, nameIndex);
    declarations.push({
      kind: parent ? 'method' : 'function', name: isCtor ? name! : name!, start, end,
      bodyStart, bodyEnd, parent, returnType,
      signature: `${returnType ? `${returnType} ` : ''}${tokenText(source, tokens, index, close)}`.trim(),
      visibility: name!.startsWith('_') ? 'private' : 'public',
      static: tokens.slice(start, nameIndex).some((token) => token.text === 'static'),
      async: tokens.slice(close + 1, Math.min(tokens.length, close + 4)).some((token) => token.text === 'async'),
    });
  }

  // Getter/setter arrow or block forms without a parameter list.
  for (let index = 0; index < tokens.length - 2; index += 1) {
    if (tokens[index]!.text !== 'get' || tokens[index + 1]?.kind !== 'identifier') continue;
    if (nearestCallable(declarations, index)) continue;
    const parent = directOwner(declarations, index);
    const marker = tokens[index + 2]?.text;
    let end = index + 1;
    let bodyStart: number | undefined;
    let bodyEnd: number | undefined;
    if (marker === '=>') { bodyStart = index + 2; bodyEnd = nextToken(tokens, index + 3, ';'); end = bodyEnd < 0 ? index + 2 : bodyEnd; }
    else if (marker === '{') { bodyStart = index + 2; bodyEnd = scan.pairs.get(bodyStart); if (bodyEnd === undefined) continue; end = bodyEnd; }
    else continue;
    declarations.push({ kind: parent ? 'method' : 'function', name: tokens[index + 1]!.text, start: index, end, bodyStart, bodyEnd, parent, visibility: tokens[index + 1]!.text.startsWith('_') ? 'private' : 'public' });
  }

  // Owned fields and static/file constants. Locals inside callables are excluded.
  for (let index = 0; index < tokens.length - 1; index += 1) {
    if (tokens[index]!.text !== '=' && tokens[index]!.text !== ';') continue;
    let nameIndex = index - 1;
    if (tokens[nameIndex]?.kind !== 'identifier') continue;
    if (nearestCallable(declarations, nameIndex)) continue;
    const parent = directOwner(declarations, nameIndex);
    let start = nameIndex;
    while (start > 0 && ![';', '{', '}'].includes(tokens[start - 1]!.text)) start -= 1;
    if (tokens.slice(start, nameIndex).some((token) => ['return', '=>', ')'].includes(token.text))) continue;
    const isConstant = tokens.slice(start, nameIndex).some((token) => token.text === 'const' || token.text === 'final') &&
      (!parent || tokens.slice(start, nameIndex).some((token) => token.text === 'static'));
    const kind: NodeKind = isConstant ? 'constant' : parent ? 'field' : 'variable';
    declarations.push({ kind, name: tokens[nameIndex]!.text, start, end: index, parent, visibility: tokens[nameIndex]!.text.startsWith('_') ? 'private' : 'public', static: tokens.slice(start, nameIndex).some((token) => token.text === 'static') });
  }

  // Enum members.
  for (const parent of declarations.filter((item) => item.kind === 'enum' && item.bodyStart !== undefined && item.bodyEnd !== undefined)) {
    for (let index = parent.bodyStart! + 1; index < parent.bodyEnd!; index += 1) {
      const token = tokens[index]!;
      if (token.kind === 'identifier' && (tokens[index - 1]?.text === '{' || tokens[index - 1]?.text === ',')) declarations.push({ kind: 'enum_member', name: token.text, start: index, end: index, parent });
      if (tokens[index]?.text === ';') break;
    }
  }

  // Inheritance, implementation, mixins, and extension targets.
  for (const declaration of declarations.filter((item) => item.kind === 'class')) {
    const end = declaration.bodyStart ?? declaration.end;
    let relation: UnresolvedReference['referenceKind'] | undefined;
    for (let index = declaration.start + 1; index < end; index += 1) {
      const text = tokens[index]!.text;
      if (text === 'extends') { relation = 'extends'; continue; }
      if (text === 'implements' || text === 'with') { relation = 'implements'; continue; }
      if (text === 'on') { relation = 'references'; continue; }
      const token = tokens[index]!;
      if (relation && token.kind === 'identifier' && /^[A-Z]/.test(token.text) && !BUILTINS.has(token.text)) references.push({ owner: declaration, token, name: token.text, kind: relation });
    }
  }

  // Declaration-header types.
  for (const declaration of declarations.filter((item) => CALLABLES.has(item.kind) || item.kind === 'field' || item.kind === 'constant')) {
    const limit = declaration.bodyStart ?? declaration.end;
    const seen = new Set<string>();
    for (let index = declaration.start; index < limit; index += 1) {
      const token = tokens[index]!;
      if (token.kind !== 'identifier' || token.text === declaration.name || BUILTINS.has(token.text) || MODIFIERS.has(token.text) || !/^[A-Z]/.test(token.text) || seen.has(token.text)) continue;
      seen.add(token.text);
      references.push({ owner: declaration, token, name: token.text, kind: 'references' });
    }
  }

  // Same-file reads of file/static constants. A local binding with the same
  // name shadows the graph target for the whole callable, matching Dart's
  // lexical value-reference contract without treating instance fields as
  // shared value dependencies.
  const constants = declarations.filter((item) => item.kind === 'constant');
  const constantNames = new Set(constants.map((item) => item.name));
  const callableOwners = declarations.filter((item) => CALLABLES.has(item.kind) && item.bodyStart !== undefined && item.bodyEnd !== undefined);
  const shadowed = new Set<string>();
  for (const owner of callableOwners) {
    for (let index = owner.bodyStart! + 1; index < owner.bodyEnd!; index += 1) {
      const token = tokens[index]!;
      if (!constantNames.has(token.text) || tokens[index + 1]?.text !== '=') continue;
      let start = index;
      while (start > owner.bodyStart! && ![';', '{', '}'].includes(tokens[start - 1]!.text)) start -= 1;
      if (tokens.slice(start, index).some((item) => ['const', 'final', 'var'].includes(item.text) || item.kind === 'identifier')) shadowed.add(token.text);
    }
  }
  for (const owner of callableOwners) {
    const emitted = new Set<string>();
    for (let index = owner.bodyStart! + 1; index < owner.bodyEnd!; index += 1) {
      const token = tokens[index]!;
      if (!constantNames.has(token.text) || shadowed.has(token.text) || emitted.has(token.text)) continue;
      if (tokens[index + 1]?.text === '=') continue;
      const target = constants.find((item) => item.name === token.text && item.parent === owner.parent) ??
        constants.find((item) => item.name === token.text && !item.parent);
      if (!target) continue;
      emitted.add(token.text);
      references.push({ owner, directTarget: target, token, name: token.text, kind: 'references' });
    }
  }

  // Runtime calls, member calls, construction, and bounded tear-offs.
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const token = tokens[index]!;
    if (token.kind !== 'identifier' || tokens[index + 1]?.text !== '(' || CONTROL.has(token.text)) continue;
    if (declarations.some((item) => item.name === token.text && item.start <= index && (item.bodyStart ?? item.end) >= index)) continue;
    let name = token.text;
    let marker = index;
    if (tokens[index - 1]?.text === '.') {
      let start = index - 2;
      if (tokens[start]?.kind === 'identifier') {
        name = `${tokens[start]!.text}.${name}`;
        marker = start;
      } else if (tokens[start]?.text === ')' && scan.pairs.has(start)) {
        const open = scan.pairs.get(start)!;
        const inner = tokens[open - 1];
        if (inner?.kind === 'identifier') {
          const receiver = tokens[open - 2]?.text === '.' && tokens[open - 3]?.kind === 'identifier'
            ? `${tokens[open - 3]!.text}.${inner.text}`
            : inner.text;
          if (/^[A-Z]/.test(receiver)) { name = `${receiver}().${name}`; marker = tokens[open - 2]?.text === '.' ? open - 3 : open - 1; }
        }
      }
    }
    const owner = nearestCallable(declarations, index) ?? directOwner(declarations, index);
    if (/^[A-Z][^.]*$/.test(name)) references.push({ owner, token: tokens[marker]!, name, kind: 'instantiates' });
    else references.push({ owner, token: tokens[marker]!, name, kind: 'calls' });
  }
  const callableNames = new Set(declarations.filter((item) => CALLABLES.has(item.kind)).map((item) => item.name));
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (!callableNames.has(token.text) || tokens[index + 1]?.text === '(') continue;
    if (['=', '(', ',', '[', ':'].includes(tokens[index - 1]?.text ?? '')) pushRef(index, token.text, 'function_ref');
  }

  return finishDynamicFacts(filePath, source, 'dart', scan, declarations, references, started);
}
