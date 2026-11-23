import type { Language, NodeKind, UnresolvedReference } from '../../types';
import { scanSource, type NativeToken } from './scanner';
import {
  finishDynamicFacts, narrowestOwner, nextToken, tokenText, unquote,
  type NativeDeclaration, type NativeReference,
} from './dynamic-fact-builder';

const CALLABLES = new Set<NodeKind>(['function', 'method']);
const CONTROL = new Set(['if', 'elseif', 'for', 'while', 'repeat', 'until', 'return', 'function', 'local', 'type', 'typeof', 'assert']);
const LUA_BUILTINS = new Set('any boolean buffer nil never number string thread unknown vector'.split(' '));

function matchLuaEnd(tokens: readonly NativeToken[], from: number): number | undefined {
  let depth = 1;
  for (let index = from + 1; index < tokens.length; index += 1) {
    const text = tokens[index]!.text;
    if (['function', 'if', 'for', 'while'].includes(text)) depth += 1;
    else if (text === 'repeat') depth += 1;
    else if (text === 'end' || text === 'until') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return undefined;
}

function memberTarget(tokens: readonly NativeToken[], equals: number): { receiver?: string; name?: string } {
  if (tokens[equals - 1]?.kind === 'identifier') {
    const name = tokens[equals - 1]!.text;
    if ((tokens[equals - 2]?.text === '.' || tokens[equals - 2]?.text === ':') && tokens[equals - 3]?.kind === 'identifier') {
      return { receiver: tokens[equals - 3]!.text, name };
    }
    return { name };
  }
  if (tokens[equals - 1]?.text === ']' && tokens[equals - 2]?.kind === 'string' && tokens[equals - 3]?.text === '[') {
    const receiver = tokens[equals - 4]?.kind === 'identifier' ? tokens[equals - 4]!.text : undefined;
    return { receiver, name: unquote(tokens[equals - 2]!.text) };
  }
  return {};
}

function precedingLuaDoc(tokens: readonly NativeToken[], index: number): string | undefined {
  const declarationLine = tokens[index]?.start.line ?? 0;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const token = tokens[cursor]!;
    if (token.text === 'local') continue;
    if (token.kind !== 'comment') return undefined;
    if (declarationLine - token.end.line > 1) return undefined;
    return token.text.replace(/^--\[\[\s?/, '').replace(/\s?\]\]$/, '').replace(/^--\s?/, '').trim();
  }
  return undefined;
}

/** Shared native semantic core for Lua and its typed Luau specialization. */
export function extractNativeLuaFacts(filePath: string, source: string, language: 'lua' | 'luau') {
  const started = Date.now();
  const scan = scanSource(source, { hashComments: false, luaSyntax: true });
  const tokens = scan.tokens;
  const declarations: NativeDeclaration[] = [];
  const references: NativeReference[] = [];
  const tableReceivers = new Map<number, string>();

  const ownerAt = (index: number) => narrowestOwner(declarations, index, CALLABLES);
  const pushRef = (index: number, name: string, kind: UnresolvedReference['referenceKind'], owner = ownerAt(index)): void => {
    const token = tokens[index];
    if (token && name) references.push({ owner, token, name, kind });
  };

  // Name table literals so nested function-valued fields can inherit a stable receiver.
  for (let open = 0; open < tokens.length; open += 1) {
    if (tokens[open]!.text !== '{' || !scan.pairs.has(open)) continue;
    const equals = open - 1;
    if (tokens[equals]?.text !== '=') continue;
    const target = memberTarget(tokens, equals);
    if (!target.name) continue;
    const enclosing = [...scan.pairs.entries()]
      .filter(([candidate, close]) => tokens[candidate]?.text === '{' && candidate < open && close > open && tableReceivers.has(candidate))
      .sort((left, right) => right[0] - left[0])[0]?.[0];
    const parent = enclosing === undefined ? target.receiver : tableReceivers.get(enclosing);
    tableReceivers.set(open, parent ? `${parent}.${target.name}` : target.name);
  }

  // Declared functions: global/local and table/member forms.
  for (let index = 0; index < tokens.length - 1; index += 1) {
    if (tokens[index]!.text !== 'function') continue;
    if (tokens[index - 1]?.text === '=') continue;
    let cursor = index + 1;
    const parts: string[] = [];
    const separators: string[] = [];
    while (cursor < tokens.length && tokens[cursor]!.text !== '(') {
      if (tokens[cursor]!.kind === 'identifier') parts.push(tokens[cursor]!.text);
      else if (tokens[cursor]!.text === '.' || tokens[cursor]!.text === ':') separators.push(tokens[cursor]!.text);
      else break;
      cursor += 1;
    }
    if (tokens[cursor]?.text !== '(' || parts.length === 0) continue;
    const paramsEnd = scan.pairs.get(cursor);
    const end = paramsEnd === undefined ? undefined : matchLuaEnd(tokens, index);
    if (paramsEnd === undefined || end === undefined) continue;
    const name = parts.at(-1)!;
    const receiver = parts.length > 1 ? parts.slice(0, -1).join('.') : undefined;
    let signatureEnd = paramsEnd;
    if (language === 'luau' && tokens[paramsEnd + 1]?.text === ':') {
      signatureEnd = paramsEnd + 1;
      while (signatureEnd + 1 < end && tokens[signatureEnd + 1]!.start.line === tokens[paramsEnd]!.start.line) signatureEnd += 1;
    }
    declarations.push({
      kind: receiver ? 'method' : 'function', name, start: index, end, bodyStart: paramsEnd, bodyEnd: end,
      qualifiedPrefix: receiver, signature: tokenText(source, tokens, cursor, signatureEnd),
      docstring: precedingLuaDoc(tokens, index),
      returnType: language === 'luau' && tokens[paramsEnd + 1]?.text === ':'
        ? tokens.slice(paramsEnd + 2, signatureEnd + 1).find((item) => item.kind === 'identifier' && !LUA_BUILTINS.has(item.text))?.text
        : undefined,
    });
  }

  // Assignment-bound anonymous functions, including nested table fields.
  for (let index = 1; index < tokens.length; index += 1) {
    if (tokens[index]!.text !== 'function' || tokens[index - 1]?.text !== '=') continue;
    const equals = index - 1;
    const target = memberTarget(tokens, equals);
    if (!target.name) continue;
    const open = nextToken(tokens, index + 1, '(');
    const paramsEnd = open < 0 ? undefined : scan.pairs.get(open);
    const end = paramsEnd === undefined ? undefined : matchLuaEnd(tokens, index);
    if (paramsEnd === undefined || end === undefined) continue;
    const enclosingTable = [...tableReceivers.entries()]
      .filter(([candidate]) => candidate < index && (scan.pairs.get(candidate) ?? candidate) > index)
      .sort((left, right) => right[0] - left[0])[0]?.[1];
    const receiver = target.receiver ?? enclosingTable;
    declarations.push({
      kind: receiver ? 'method' : 'function', name: target.name, start: target.receiver ? equals - 3 : equals - 1,
      end, bodyStart: paramsEnd, bodyEnd: end, qualifiedPrefix: receiver,
      signature: tokenText(source, tokens, open, paramsEnd),
    });
  }

  // Luau type aliases and their type references.
  if (language === 'luau') {
    for (let index = 0; index < tokens.length - 2; index += 1) {
      let marker = index;
      let exported = false;
      if (tokens[marker]!.text === 'export' && tokens[marker + 1]?.text === 'type') { exported = true; marker += 1; }
      if (tokens[marker]!.text !== 'type' || tokens[marker + 1]?.kind !== 'identifier') continue;
      let end = marker + 2;
      while (end + 1 < tokens.length && tokens[end + 1]!.start.line === tokens[marker]!.start.line) end += 1;
      declarations.push({ kind: 'type_alias', name: tokens[marker + 1]!.text, start: index, end, exported });
      for (let cursor = marker + 2; cursor <= end; cursor += 1) {
        const token = tokens[cursor]!;
        if (token.kind === 'identifier' && /^[A-Z]/.test(token.text) && token.text !== tokens[marker + 1]!.text) pushRef(cursor, token.text, 'references');
      }
      index = end;
    }
  }

  // Variables and require dependencies.
  for (let index = 0; index < tokens.length - 2; index += 1) {
    const local = tokens[index]!.text === 'local';
    const nameIndex = local ? index + 1 : index;
    if (tokens[nameIndex]?.kind !== 'identifier' || tokens[nameIndex + 1]?.text !== '=') continue;
    const value = nameIndex + 2;
    if (tokens[value]?.text === 'function') continue;
    if (tokens[value]?.text === 'require') {
      const open = tokens[value + 1]?.text === '(' ? value + 1 : -1;
      const close = open >= 0 ? scan.pairs.get(open) : value + 1;
      if (close !== undefined) {
        const valueTokens = open >= 0 ? tokens.slice(open + 1, close) : tokens.slice(value + 1, value + 2);
        const string = valueTokens.find((item) => item.kind === 'string');
        const identifiers = valueTokens.filter((item) => item.kind === 'identifier');
        const module = string ? unquote(string.text) : identifiers.at(-1)?.text;
        const token = string ?? identifiers.at(-1);
        if (module && token) {
          declarations.push({ kind: 'import', name: module, start: value, end: close, signature: tokenText(source, tokens, value, close) });
          references.push({ token, name: module, kind: 'imports', owner: ownerAt(value) });
        }
      }
      continue;
    }
    if (!ownerAt(index)) declarations.push({ kind: 'variable', name: tokens[nameIndex]!.text, start: index, end: value });
  }
  // Bare require calls.
  for (let index = 0; index < tokens.length - 2; index += 1) {
    if (tokens[index]!.text !== 'require' || tokens[index + 1]?.text !== '(') continue;
    if (tokens[index - 1]?.text === '=') continue;
    const close = scan.pairs.get(index + 1);
    if (close === undefined) continue;
    const string = tokens.slice(index + 2, close).find((item) => item.kind === 'string');
    if (!string) continue;
    const module = unquote(string.text);
    declarations.push({ kind: 'import', name: module, start: index, end: close, signature: tokenText(source, tokens, index, close) });
    references.push({ token: string, name: module, kind: 'imports', owner: ownerAt(index) });
  }

  // Calls preserve dotted/colon receivers. Declarations and require are excluded.
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const token = tokens[index]!;
    if (token.kind !== 'identifier' || tokens[index + 1]?.text !== '(' || CONTROL.has(token.text) || token.text === 'require') continue;
    if (tokens[index - 1]?.text === 'function') continue;
    if (declarations.some((item) => item.name === token.text && item.start <= index && (item.bodyStart ?? item.end) >= index)) continue;
    let name = token.text;
    let marker = index;
    if ((tokens[index - 1]?.text === '.' || tokens[index - 1]?.text === ':') && tokens[index - 2]?.kind === 'identifier') {
      name = `${tokens[index - 2]!.text}.${name}`;
      marker = index - 2;
    }
    pushRef(marker, name, 'calls');
  }

  // Same-file callable values in assignment/argument/table positions.
  const defined = new Set(declarations.filter((item) => CALLABLES.has(item.kind)).map((item) => item.name));
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (!defined.has(token.text) || tokens[index + 1]?.text === '(' || tokens[index - 1]?.text === 'function') continue;
    if (['=', '(', ',', '{'].includes(tokens[index - 1]?.text ?? '')) pushRef(index, token.text, 'function_ref');
  }

  return finishDynamicFacts(filePath, source, language as Language, scan, declarations, references, started);
}
