import type { NodeKind, UnresolvedReference } from '../../types';
import { scanSource, type NativeToken } from './scanner';
import {
  finishDynamicFacts, narrowestOwner, tokenText, unquote,
  type NativeDeclaration, type NativeReference,
} from './dynamic-fact-builder';

const CALLABLES = new Set<NodeKind>(['function', 'method']);
const LEFT_ASSIGN = new Set(['<-', '<<-', '=']);
const RIGHT_ASSIGN = new Set(['->', '->>']);
const IMPORTS = new Set(['library', 'require', 'requireNamespace', 'loadNamespace', 'source']);
const CLASSES = new Set(['setClass', 'setRefClass', 'R6Class', 'ggproto']);
const GENERICS = new Set(['setGeneric', 'setMethod']);
const CONTROL = new Set(['if', 'for', 'while', 'repeat', 'function', 'return', 'switch']);

function assignedName(token: NativeToken | undefined): string | undefined {
  if (!token || token.kind !== 'identifier') return undefined;
  return unquote(token.text).replace(/^\$/, '');
}

function functionRange(tokens: readonly NativeToken[], pairs: ReadonlyMap<number, number>, marker: number): { params: number; paramsEnd: number; bodyStart: number; bodyEnd: number } | undefined {
  const params = marker + 1;
  if (tokens[params]?.text !== '(') return undefined;
  const paramsEnd = pairs.get(params);
  if (paramsEnd === undefined) return undefined;
  const bodyStart = paramsEnd + 1;
  if (tokens[bodyStart]?.text === '{') {
    const bodyEnd = pairs.get(bodyStart);
    if (bodyEnd === undefined) return undefined;
    return { params, paramsEnd, bodyStart, bodyEnd };
  }
  let bodyEnd = bodyStart;
  while (bodyEnd + 1 < tokens.length && tokens[bodyEnd + 1]!.start.line === tokens[bodyStart]?.start.line) bodyEnd += 1;
  return { params, paramsEnd, bodyStart, bodyEnd };
}

/** Bounded Afyx-native R semantic facts. */
export function extractNativeRFacts(filePath: string, source: string) {
  const started = Date.now();
  const scan = scanSource(source, { hashComments: true, backtickIdentifiers: true });
  const tokens = scan.tokens;
  const declarations: NativeDeclaration[] = [];
  const references: NativeReference[] = [];
  const classCalls = new Set<number>();

  const ownerAt = (index: number) => narrowestOwner(declarations, index, CALLABLES);
  const pushRef = (index: number, name: string, kind: UnresolvedReference['referenceKind'], owner = ownerAt(index)): void => {
    const token = tokens[index];
    if (token && name) references.push({ owner, token, name, kind });
  };

  // Assignment-bound functions, including nested functions and shorthand \(x).
  for (let index = 1; index < tokens.length - 2; index += 1) {
    if (!LEFT_ASSIGN.has(tokens[index]!.text)) continue;
    const name = assignedName(tokens[index - 1]);
    if (!name) continue;
    const marker = index + 1;
    const isLong = tokens[marker]?.text === 'function';
    const isShort = tokens[marker]?.text === '\\' && tokens[marker + 1]?.text === '(';
    const insideFactory = [...scan.pairs.entries()].some(([open, close]) =>
      tokens[open]?.text === '(' && open < marker && close > marker &&
      (CLASSES.has(tokens[open - 1]?.text ?? '') || GENERICS.has(tokens[open - 1]?.text ?? '')));
    if (insideFactory) continue;
    const range = isLong ? functionRange(tokens, scan.pairs, marker) : isShort ? functionRange(tokens, scan.pairs, marker) : undefined;
    if (!range) continue;
    declarations.push({
      kind: 'function', name, start: index - 1, end: range.bodyEnd,
      bodyStart: range.bodyStart, bodyEnd: range.bodyEnd, parent: ownerAt(index),
      signature: tokenText(source, tokens, range.params, range.paramsEnd),
    });
  }

  // R OO/generic constructors use the first string as their public definition name.
  for (let index = 0; index < tokens.length - 2; index += 1) {
    const callee = tokens[index]!.text;
    if ((!CLASSES.has(callee) && !GENERICS.has(callee)) || tokens[index + 1]?.text !== '(') continue;
    const close = scan.pairs.get(index + 1);
    if (close === undefined) continue;
    const nameToken = tokens.slice(index + 2, close).find((item) => item.kind === 'string');
    if (!nameToken) continue;
    const name = unquote(nameToken.text);
    const declaration: NativeDeclaration = {
      kind: CLASSES.has(callee) ? 'class' : 'function', name, start: index, end: close,
      bodyStart: index + 1, bodyEnd: close, parent: ownerAt(index),
    };
    declarations.push(declaration);
    classCalls.add(index);

    // ggproto's second positional argument is its parent.
    if (callee === 'ggproto') {
      let commaCount = 0;
      for (let cursor = index + 2; cursor < close; cursor += 1) {
        if (tokens[cursor]!.text === ',') commaCount += 1;
        else if (commaCount === 1 && tokens[cursor]!.kind === 'identifier') {
          references.push({ owner: declaration, token: tokens[cursor]!, name: tokens[cursor]!.text, kind: 'extends' });
          break;
        }
      }
    }

    // Named function arguments inside R5/R6/list/ggproto become owned methods.
    for (let cursor = index + 2; cursor < close - 2; cursor += 1) {
      if (tokens[cursor]!.kind !== 'identifier' || tokens[cursor + 1]?.text !== '=' || tokens[cursor + 2]?.text !== 'function') continue;
      const range = functionRange(tokens, scan.pairs, cursor + 2);
      if (!range || range.bodyEnd > close) continue;
      declarations.push({
        kind: 'method', name: tokens[cursor]!.text, start: cursor, end: range.bodyEnd,
        bodyStart: range.bodyStart, bodyEnd: range.bodyEnd, parent: declaration,
        signature: tokenText(source, tokens, range.params, range.paramsEnd),
      });
      cursor = range.bodyEnd;
    }
  }

  // Package and source dependencies are imports, never runtime calls.
  for (let index = 0; index < tokens.length - 2; index += 1) {
    if (!IMPORTS.has(tokens[index]!.text) || tokens[index + 1]?.text !== '(') continue;
    const close = scan.pairs.get(index + 1);
    if (close === undefined) continue;
    let valueIndex = index + 2;
    if (tokens[valueIndex]?.kind === 'identifier' && tokens[valueIndex + 1]?.text === '=') valueIndex += 2;
    const value = tokens[valueIndex];
    if (!value || (value.kind !== 'identifier' && value.kind !== 'string')) continue;
    const name = unquote(value.text);
    declarations.push({ kind: 'import', name, start: index, end: close, signature: tokenText(source, tokens, index, close) });
    references.push({ token: value, name, kind: 'imports', owner: ownerAt(index) });
  }

  // File-level variables/constants and right-assignment. Class/generic idioms do not get twins.
  for (let index = 1; index < tokens.length - 1; index += 1) {
    if (LEFT_ASSIGN.has(tokens[index]!.text)) {
      const name = assignedName(tokens[index - 1]);
      if (!name || ownerAt(index) || tokens[index + 1]?.text === 'function' ||
          (tokens[index + 1]?.kind === 'identifier' && classCalls.has(index + 1))) continue;
      declarations.push({ kind: /^[A-Z][A-Z0-9._]*$/.test(name) ? 'constant' : 'variable', name, start: index - 1, end: index + 1 });
    } else if (RIGHT_ASSIGN.has(tokens[index]!.text)) {
      const name = assignedName(tokens[index + 1]);
      if (!name || ownerAt(index)) continue;
      declarations.push({ kind: /^[A-Z][A-Z0-9._]*$/.test(name) ? 'constant' : 'variable', name, start: Math.max(0, index - 1), end: index + 1 });
    }
  }

  // Calls preserve namespace/member spelling and ownership.
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const token = tokens[index]!;
    if (token.kind !== 'identifier' || tokens[index + 1]?.text !== '(' || CONTROL.has(token.text) || IMPORTS.has(token.text) || CLASSES.has(token.text) || GENERICS.has(token.text)) continue;
    if (tokens[index - 1]?.text === 'function' || tokens[index - 1]?.text === '\\') continue;
    let name = token.text.replace(/^\$/, '');
    let marker = index;
    if ((tokens[index - 1]?.text === '::' || tokens[index - 1]?.text === ':::') && tokens[index - 2]?.kind === 'identifier') {
      name = `${tokens[index - 2]!.text}${tokens[index - 1]!.text}${name}`;
      marker = index - 2;
    } else if (token.text.startsWith('$') && tokens[index - 1]?.kind === 'identifier') {
      name = `${tokens[index - 1]!.text}$${name}`;
      marker = index - 1;
    }
    pushRef(marker, name, 'calls');
  }

  // Same-file functions used as values (for example list(handler = clean_data)).
  const defined = new Set(declarations.filter((item) => item.kind === 'function' || item.kind === 'method').map((item) => item.name));
  for (let index = 0; index < tokens.length; index += 1) {
    const name = assignedName(tokens[index]);
    if (!name || !defined.has(name) || tokens[index + 1]?.text === '(' || LEFT_ASSIGN.has(tokens[index + 1]?.text ?? '')) continue;
    if (['=', '(', ','].includes(tokens[index - 1]?.text ?? '')) pushRef(index, name, 'function_ref');
  }

  return finishDynamicFacts(filePath, source, 'r', scan, declarations, references, started);
}
