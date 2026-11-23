import * as path from 'path';
import type { NodeKind, UnresolvedReference } from '../../types';
import { scanSource, type NativeToken } from './scanner';
import {
  finishDynamicFacts, narrowestOwner, tokenText, unquote,
  type NativeDeclaration, type NativeReference,
} from './dynamic-fact-builder';

const CONTAINERS = new Set<NodeKind>(['class', 'module']);
const CALLABLES = new Set<NodeKind>(['function', 'method']);
const BLOCK_START = new Set(['class', 'module', 'def', 'if', 'unless', 'case', 'begin', 'while', 'until', 'for', 'do']);
const CONTROL = new Set(['if', 'unless', 'while', 'until', 'for', 'case', 'when', 'return', 'yield', 'raise', 'super', 'defined']);
const HOOKS = new Set(['before_action', 'after_action', 'around_action', 'before_save', 'after_save', 'before_create', 'after_create', 'rescue_from']);

function rubyName(tokens: readonly NativeToken[], index: number): string {
  const base = tokens[index]?.text ?? '';
  const suffix = tokens[index + 1]?.text;
  return suffix === '!' || suffix === '?' || suffix === '=' ? `${base}${suffix}` : base;
}

function matchEnd(tokens: readonly NativeToken[], from: number): number | undefined {
  let depth = 1;
  for (let index = from + 1; index < tokens.length; index += 1) {
    const text = tokens[index]!.text;
    if (BLOCK_START.has(text)) depth += 1;
    else if (text === 'end') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return undefined;
}

/** Bounded Afyx-native Ruby semantic facts. */
export function extractNativeRubyFacts(filePath: string, source: string) {
  const started = Date.now();
  const scan = scanSource(source, { hashComments: true });
  const tokens = scan.tokens;
  const declarations: NativeDeclaration[] = [];
  const references: NativeReference[] = [];

  const ownerAt = (index: number, kinds?: ReadonlySet<NodeKind>) => narrowestOwner(declarations, index, kinds);
  const pushRef = (index: number, name: string, kind: UnresolvedReference['referenceKind'], owner = ownerAt(index, CALLABLES) ?? ownerAt(index, CONTAINERS)): void => {
    const token = tokens[index];
    if (token && name) references.push({ owner, token, name, kind });
  };

  // Container pass; nested ownership is fixed after all ranges are known.
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const keyword = tokens[index]!.text;
    if (keyword !== 'class' && keyword !== 'module') continue;
    const nameIndex = index + 1;
    if (tokens[nameIndex]?.kind !== 'identifier') continue;
    const matchedEnd = matchEnd(tokens, index);
    const end = matchedEnd ?? tokens.length - 1;
    declarations.push({
      kind: keyword === 'class' ? 'class' : 'module', name: rubyName(tokens, nameIndex),
      start: index, end, bodyStart: index, bodyEnd: end,
    });
  }
  for (const declaration of declarations) {
    declaration.parent = declarations.filter((item) => item !== declaration && CONTAINERS.has(item.kind) &&
      item.bodyStart !== undefined && item.bodyEnd !== undefined && item.bodyStart < declaration.start && item.bodyEnd >= declaration.end)
      .sort((left, right) => (left.bodyEnd! - left.bodyStart!) - (right.bodyEnd! - right.bodyStart!))[0];
  }

  // Methods, including `def self.name` singleton methods.
  for (let index = 0; index < tokens.length - 1; index += 1) {
    if (tokens[index]!.text !== 'def') continue;
    let nameIndex = index + 1;
    let staticMethod = false;
    if (tokens[nameIndex]?.text === 'self' && tokens[nameIndex + 1]?.text === '.') {
      staticMethod = true;
      nameIndex += 2;
    }
    if (tokens[nameIndex]?.kind !== 'identifier') continue;
    const end = matchEnd(tokens, index);
    if (end === undefined) continue;
    const parent = ownerAt(index, CONTAINERS);
    const open = tokens[nameIndex + 1]?.text === '(' ? nameIndex + 1 : -1;
    const close = open >= 0 ? scan.pairs.get(open) : undefined;
    declarations.push({
      kind: parent ? 'method' : 'function', name: rubyName(tokens, nameIndex), start: index, end,
      bodyStart: close ?? nameIndex, bodyEnd: end, parent, static: staticMethod,
      visibility: 'public', signature: open >= 0 && close !== undefined ? tokenText(source, tokens, open, close) : undefined,
    });
  }

  // Assignment-bound lambdas/procs establish their own callable ownership.
  for (let index = 1; index < tokens.length - 1; index += 1) {
    if (tokens[index]!.text !== '=' || tokens[index - 1]?.kind !== 'identifier') continue;
    const marker = tokens[index + 1]?.text;
    if (marker !== '->' && marker !== 'lambda' && marker !== 'proc') continue;
    let bodyStart = index + 2;
    while (bodyStart < tokens.length && tokens[bodyStart]!.text !== '{' && tokens[bodyStart]!.text !== 'do') bodyStart += 1;
    let bodyEnd = bodyStart < tokens.length && tokens[bodyStart]!.text === '{' ? scan.pairs.get(bodyStart) : matchEnd(tokens, bodyStart);
    if (bodyEnd === undefined) bodyEnd = bodyStart;
    const parent = ownerAt(index, CONTAINERS);
    declarations.push({ kind: parent ? 'method' : 'function', name: tokens[index - 1]!.text, start: index - 1, end: bodyEnd, bodyStart, bodyEnd, parent });
  }

  // Class inheritance and include/prepend/extend composition.
  for (const declaration of declarations.filter((item) => CONTAINERS.has(item.kind))) {
    const marker = declaration.start + 2;
    if (tokens[marker]?.text === '<' && tokens[marker + 1]?.kind === 'identifier') {
      references.push({ owner: declaration, token: tokens[marker + 1]!, name: tokens[marker + 1]!.text, kind: 'extends' });
    }
    for (let index = declaration.start + 2; index < declaration.end; index += 1) {
      if (!['include', 'prepend', 'extend'].includes(tokens[index]!.text)) continue;
      if (ownerAt(index, CALLABLES)) continue;
      for (let cursor = index + 1; cursor < declaration.end && tokens[cursor]!.start.line === tokens[index]!.start.line; cursor += 1) {
        if (tokens[cursor]!.kind === 'identifier' && /^[A-Z]/.test(tokens[cursor]!.text)) {
          references.push({ owner: declaration, token: tokens[cursor]!, name: tokens[cursor]!.text, kind: 'implements' });
        }
      }
    }
  }

  // require/require_relative dependencies.
  for (let index = 0; index < tokens.length - 1; index += 1) {
    if (tokens[index]!.text !== 'require' && tokens[index]!.text !== 'require_relative') continue;
    let value = index + 1;
    if (tokens[value]?.text === '(') value += 1;
    if (tokens[value]?.kind !== 'string') continue;
    const name = unquote(tokens[value]!.text);
    declarations.push({ kind: 'import', name, start: index, end: value, signature: source.slice(tokens[index]!.start.offset, tokens[value]!.end.offset) });
    let refPath = name;
    if (tokens[index]!.text === 'require_relative') {
      const slash = filePath.replace(/\\/g, '/').lastIndexOf('/');
      const dir = slash >= 0 ? filePath.replace(/\\/g, '/').slice(0, slash) : '';
      refPath = path.posix.normalize(dir ? `${dir}/${name}` : name);
    }
    if (refPath.includes('/')) {
      if (!refPath.endsWith('.rb')) refPath += '.rb';
      references.push({ token: tokens[value]!, name: refPath, kind: 'imports' });
    }
  }

  // Constants assigned at container/file scope.
  for (let index = 0; index < tokens.length - 2; index += 1) {
    if (tokens[index]!.kind !== 'identifier' || !/^[A-Z]/.test(tokens[index]!.text) || tokens[index + 1]?.text !== '=') continue;
    if (ownerAt(index, CALLABLES)) continue;
    const parent = ownerAt(index, CONTAINERS);
    declarations.push({ kind: 'constant', name: tokens[index]!.text, start: index, end: index + 2, parent });
  }

  // Calls: parenthesized, receiver calls, and common bare-call statements.
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.kind !== 'identifier' || CONTROL.has(token.text)) continue;
    if (['class', 'module', 'def', 'require', 'require_relative'].includes(tokens[index - 1]?.text ?? '')) continue;
    if (declarations.some((item) => item.start === index || (item.start === index - 1 && item.name === rubyName(tokens, index)))) continue;
    let call = tokens[index + 1]?.text === '(';
    let name = rubyName(tokens, index);
    let marker = index;
    if (tokens[index - 1]?.text === '.' || tokens[index - 1]?.text === '::') {
      const receiver = tokens[index - 2];
      if (receiver?.kind === 'identifier') {
        call = true;
        name = `${receiver.text}.${name}`;
        marker = index - 2;
        if (token.text === 'new' && /^[A-Z]/.test(receiver.text)) {
          pushRef(index - 2, receiver.text, 'instantiates');
        }
      }
    }
    const atStatementStart = index === 0 || token.start.line > tokens[index - 1]!.end.line || [';', 'do'].includes(tokens[index - 1]!.text);
    const hasArgument = tokens[index + 1] && tokens[index + 1]!.start.line === token.start.line &&
      (tokens[index + 1]!.kind === 'string' || tokens[index + 1]!.kind === 'identifier' || tokens[index + 1]!.text === ':');
    if (call || (atStatementStart && hasArgument)) pushRef(marker, name, 'calls');
  }

  // Rails-style callback symbols are established callable references; validation helpers are intentionally excluded.
  for (let index = 0; index < tokens.length - 2; index += 1) {
    if (!HOOKS.has(tokens[index]!.text)) continue;
    const endLine = tokens[index]!.start.line;
    for (let cursor = index + 1; cursor < tokens.length && tokens[cursor]!.start.line === endLine; cursor += 1) {
      if (tokens[cursor]!.text === ':' && tokens[cursor + 1]?.kind === 'identifier') {
        pushRef(cursor + 1, rubyName(tokens, cursor + 1), 'function_ref', ownerAt(index, CONTAINERS));
      }
    }
  }

  return finishDynamicFacts(filePath, source, 'ruby', scan, declarations, references, started);
}
