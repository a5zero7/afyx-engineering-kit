import * as path from 'path';
import type { Edge, ExtractionResult, Node, NodeKind, UnresolvedReference } from '../../types';
import { generateNodeId } from '../node-id';
import { scanSource, type NativeToken } from './scanner';

interface SwiftDeclaration {
  kind: NodeKind;
  name: string;
  start: number;
  end: number;
  bodyStart?: number;
  bodyEnd?: number;
  paramsStart?: number;
  paramsEnd?: number;
  parent?: SwiftDeclaration;
  visibility?: Node['visibility'];
  static?: boolean;
  async?: boolean;
  returnType?: string;
  signature?: string;
  extension?: boolean;
  extensionTarget?: string;
}

const TYPE_KINDS: Readonly<Record<string, NodeKind>> = {
  class: 'class', struct: 'struct', protocol: 'interface', enum: 'enum', actor: 'class', extension: 'class',
};
const CONTAINERS = new Set<NodeKind>(['class', 'struct', 'interface', 'enum']);
const CALLABLES = new Set<NodeKind>(['function', 'method', 'property']);
const CONTROL = new Set(['if', 'for', 'while', 'switch', 'guard', 'catch', 'return', 'throw', 'sizeof', 'type', 'some', 'any']);
const TYPE_WORDS = new Set([
  'Any', 'AnyObject', 'Bool', 'Character', 'Double', 'Float', 'Int', 'Int8', 'Int16', 'Int32', 'Int64',
  'Never', 'Self', 'String', 'Substring', 'UInt', 'UInt8', 'UInt16', 'UInt32', 'UInt64', 'Void',
  'actor', 'associatedtype', 'async', 'class', 'convenience', 'deinit', 'dynamic', 'enum', 'extension',
  'fileprivate', 'final', 'func', 'import', 'indirect', 'init', 'inout', 'internal', 'isolated', 'let',
  'mutating', 'nonisolated', 'open', 'optional', 'override', 'private', 'protocol', 'public', 'rethrows',
  'some', 'static', 'struct', 'throws', 'typealias', 'unowned', 'var', 'weak', 'where', 'any',
]);

function visibility(tokens: readonly NativeToken[], start: number, end: number): Node['visibility'] {
  for (let index = start; index < end; index += 1) {
    const text = tokens[index]?.text;
    if (text === 'public' || text === 'private' || text === 'internal') return text;
    if (text === 'fileprivate') return 'private';
    if (text === 'open') return 'public';
  }
  return 'internal';
}

function simpleType(tokens: readonly NativeToken[], start: number, end: number): string | undefined {
  const identifiers = tokens.slice(start, end).filter((token) =>
    token.kind === 'identifier' && !TYPE_WORDS.has(token.text));
  const value = identifiers.at(-1)?.text;
  return value && /^[A-Za-z_]\w*$/u.test(value) ? value : undefined;
}

/** Afyx-native facts for the bounded Swift surface used by graph/resolution. */
export function extractNativeSwiftFacts(filePath: string, source: string): ExtractionResult {
  const started = Date.now();
  const scan = scanSource(source, { hashComments: false, swiftSyntax: true });
  const tokens = scan.tokens;
  const declarations: SwiftDeclaration[] = [];
  const refs: UnresolvedReference[] = [];

  const nextText = (from: number, text: string, limit = tokens.length): number => {
    for (let index = from; index < limit; index += 1) if (tokens[index]?.text === text) return index;
    return -1;
  };
  const lineEnd = (from: number): number => {
    const line = tokens[from]?.start.line;
    let end = from;
    while (end + 1 < tokens.length && tokens[end + 1]!.start.line === line) end += 1;
    return end;
  };
  const statementStart = (at: number): number => {
    let start = at;
    const line = tokens[at]?.start.line;
    while (start > 0 && tokens[start - 1]!.start.line === line && ![';', '{', '}'].includes(tokens[start - 1]!.text)) start -= 1;
    return start;
  };
  const ownerFor = (start: number, end: number, kinds: ReadonlySet<NodeKind>): SwiftDeclaration | undefined => declarations
    .filter((item) => kinds.has(item.kind) && item.bodyStart !== undefined && item.bodyEnd !== undefined && item.bodyStart < start && item.bodyEnd >= end)
    .sort((left, right) => (left.end - left.start) - (right.end - right.start))[0];
  const bodyAfter = (from: number, limit = tokens.length): { open: number; close: number } | undefined => {
    let cursor = from;
    while (cursor < limit && !['{', ';'].includes(tokens[cursor]!.text)) cursor += 1;
    if (tokens[cursor]?.text !== '{') return undefined;
    const close = scan.pairs.get(cursor);
    return close === undefined ? undefined : { open: cursor, close };
  };

  // Named type/extension declarations establish ownership before members.
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const keyword = tokens[index]!.text;
    const kind = TYPE_KINDS[keyword];
    if (!kind) continue;
    let cursor = index + 1;
    const nameParts: NativeToken[] = [];
    while (cursor < tokens.length && ![':', '{', ';', 'where'].includes(tokens[cursor]!.text)) {
      if (tokens[cursor]!.kind === 'identifier') nameParts.push(tokens[cursor]!);
      cursor += 1;
    }
    const nameToken = keyword === 'extension' ? nameParts.at(-1) : nameParts[0];
    if (!nameToken) continue;
    const body = bodyAfter(cursor);
    if (!body) continue;
    const start = statementStart(index);
    declarations.push({
      kind, name: nameToken.text, start, end: body.close, bodyStart: body.open, bodyEnd: body.close,
      visibility: visibility(tokens, start, index), extension: keyword === 'extension',
      extensionTarget: keyword === 'extension' ? nameParts.map((token) => token.text).join('.') : undefined,
    });
  }

  // Resolve nested type ownership after all type ranges are known.
  for (const declaration of declarations) {
    declaration.parent = declarations
      .filter((candidate) => candidate !== declaration && CONTAINERS.has(candidate.kind) && candidate.bodyStart !== undefined &&
        candidate.bodyStart < declaration.start && candidate.end >= declaration.end)
      .sort((left, right) => (left.end - left.start) - (right.end - right.start))[0];
  }

  // Functions, methods, initializers and deinitializers.
  for (let index = 0; index < tokens.length; index += 1) {
    const keyword = tokens[index]!.text;
    if (!['func', 'init', 'deinit'].includes(keyword)) continue;
    let nameIndex = index;
    let name = keyword;
    if (keyword === 'func') {
      nameIndex = index + 1;
      if (tokens[nameIndex]?.kind !== 'identifier') continue;
      name = tokens[nameIndex]!.text;
    }
    let paramsStart = nextText(nameIndex + 1, '(');
    if (keyword === 'deinit') paramsStart = -1;
    const paramsEnd = paramsStart < 0 ? nameIndex : scan.pairs.get(paramsStart);
    if (paramsStart >= 0 && paramsEnd === undefined) continue;
    let headerEnd = (paramsEnd ?? nameIndex) + 1;
    while (headerEnd < tokens.length && !['{', ';', '}'].includes(tokens[headerEnd]!.text) &&
      tokens[headerEnd]!.start.line <= tokens[index]!.start.line + 4) headerEnd += 1;
    const bodyStart = tokens[headerEnd]?.text === '{' ? headerEnd : undefined;
    const bodyEnd = bodyStart === undefined ? undefined : scan.pairs.get(bodyStart);
    const end = bodyEnd ?? Math.max(paramsEnd ?? nameIndex, headerEnd - 1);
    const parent = ownerFor(index, end, CONTAINERS);
    const start = statementStart(index);
    const arrow = nextText((paramsEnd ?? nameIndex) + 1, '->', bodyStart ?? headerEnd);
    declarations.push({
      kind: parent ? 'method' : 'function', name, start, end, bodyStart, bodyEnd,
      paramsStart: paramsStart < 0 ? undefined : paramsStart, paramsEnd,
      parent, visibility: visibility(tokens, start, index),
      static: tokens.slice(start, index).some((token) => token.text === 'static' || token.text === 'class'),
      async: tokens.slice((paramsEnd ?? nameIndex) + 1, bodyStart ?? headerEnd).some((token) => token.text === 'async'),
      returnType: arrow < 0 ? undefined : simpleType(tokens, arrow + 1, bodyStart ?? headerEnd),
      signature: paramsStart < 0 ? undefined : source.slice(tokens[paramsStart]!.start.offset, tokens[bodyStart ?? headerEnd - 1]!.end.offset).trim(),
    });
  }

  // Stored/computed properties and top-level values. Locals remain data-flow, not nodes.
  for (let index = 0; index < tokens.length - 1; index += 1) {
    if (!['let', 'var'].includes(tokens[index]!.text) || tokens[index + 1]?.kind !== 'identifier') continue;
    const callable = ownerFor(index, index + 1, CALLABLES);
    if (callable) continue;
    const parent = ownerFor(index, index + 1, CONTAINERS);
    const nameIndex = index + 1;
    let cursor = nameIndex + 1;
    const baseLine = tokens[index]!.start.line;
    let equals = -1;
    let bodyStart: number | undefined;
    while (cursor < tokens.length) {
      const text = tokens[cursor]!.text;
      if (text === '=') equals = cursor;
      if (text === '{') {
        if (equals < 0) bodyStart = cursor;
        break;
      }
      if (text === ';' || text === '}' || (tokens[cursor]!.start.line > baseLine && tokens[cursor]!.start.column <= tokens[index]!.start.column)) break;
      cursor += 1;
    }
    const bodyEnd = bodyStart === undefined ? undefined : scan.pairs.get(bodyStart);
    const end = bodyEnd ?? (equals >= 0 ? lineEnd(equals) : Math.max(nameIndex, cursor - 1));
    const start = statementStart(index);
    const shared = tokens.slice(start, index).some((token) => token.text === 'static' || token.text === 'class');
    const kind: NodeKind = bodyStart !== undefined ? 'property' : parent ? (shared ? (tokens[index]!.text === 'let' ? 'constant' : 'variable') : 'field') : (tokens[index]!.text === 'let' ? 'constant' : 'variable');
    declarations.push({ kind, name: tokens[nameIndex]!.text, start, end, bodyStart, bodyEnd, parent,
      visibility: visibility(tokens, start, index), static: shared });
  }

  // Type aliases and associated types are named type-level contracts.
  for (let index = 0; index < tokens.length - 1; index += 1) {
    if (!['typealias', 'associatedtype'].includes(tokens[index]!.text) || tokens[index + 1]?.kind !== 'identifier') continue;
    const parent = ownerFor(index, index + 1, CONTAINERS);
    declarations.push({ kind: 'type_alias', name: tokens[index + 1]!.text, start: statementStart(index), end: lineEnd(index), parent,
      visibility: visibility(tokens, statementStart(index), index) });
  }

  // Enum case declarations can contain multiple comma-separated cases.
  for (const parent of declarations.filter((item) => item.kind === 'enum' && item.bodyStart !== undefined && item.bodyEnd !== undefined)) {
    for (let index = parent.bodyStart! + 1; index < parent.bodyEnd!; index += 1) {
      if (tokens[index]!.text !== 'case') continue;
      const line = tokens[index]!.start.line;
      for (let cursor = index + 1; cursor < parent.bodyEnd! && tokens[cursor]!.start.line === line; cursor += 1) {
        if (tokens[cursor]!.kind !== 'identifier') continue;
        if (cursor === index + 1 || tokens[cursor - 1]?.text === ',') declarations.push({ kind: 'enum_member', name: tokens[cursor]!.text, start: cursor, end: cursor, parent });
      }
    }
  }

  declarations.sort((left, right) => left.start - right.start || right.end - left.end);
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const fileNode: Node = {
    id: `file:${filePath}`, kind: 'file', name: path.basename(filePath), qualifiedName: filePath,
    filePath, language: 'swift', startLine: 1, endLine: source.split('\n').length,
    startColumn: 0, endColumn: 0, isExported: false, updatedAt: Date.now(),
  };
  nodes.push(fileNode);
  const nodeByDeclaration = new Map<SwiftDeclaration, Node>();
  for (const declaration of declarations) {
    const token = tokens[declaration.start]!;
    const endToken = tokens[declaration.end] ?? token;
    const parentNode = declaration.parent ? nodeByDeclaration.get(declaration.parent) : undefined;
    const qualifiedName = parentNode ? `${parentNode.qualifiedName}::${declaration.name}` : declaration.name;
    const node: Node = {
      id: generateNodeId(filePath, declaration.kind, qualifiedName, token.start.line),
      kind: declaration.kind, name: declaration.name, qualifiedName, filePath, language: 'swift',
      startLine: token.start.line, endLine: endToken.end.line, startColumn: token.start.column, endColumn: endToken.end.column,
      visibility: declaration.visibility, isExported: declaration.visibility === 'public',
      isStatic: declaration.static, isAsync: declaration.async, signature: declaration.signature,
      returnType: declaration.returnType, updatedAt: Date.now(),
    };
    nodes.push(node);
    nodeByDeclaration.set(declaration, node);
    edges.push({ source: parentNode?.id ?? fileNode.id, target: node.id, kind: 'contains' });
  }

  // Imports are file-owned module dependencies and visible graph nodes.
  for (const match of source.matchAll(/^\s*(?:@(?:testable|preconcurrency)\s+)?import\s+(?:class\s+|struct\s+|enum\s+|protocol\s+|func\s+|var\s+|let\s+)?([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)[^\r\n]*$/gm)) {
    const name = match[1]!;
    const offset = match.index ?? 0;
    const line = source.slice(0, offset).split('\n').length;
    const column = match[0].indexOf('import');
    const importNode: Node = {
      id: generateNodeId(filePath, 'import', name, line), kind: 'import', name, qualifiedName: name,
      filePath, language: 'swift', startLine: line, endLine: line, startColumn: Math.max(0, column), endColumn: match[0].length,
      signature: match[0].trim(), updatedAt: Date.now(),
    };
    nodes.push(importNode);
    edges.push({ source: fileNode.id, target: importNode.id, kind: 'contains' });
    refs.push({ fromNodeId: fileNode.id, referenceName: name, referenceKind: 'imports', line, column: Math.max(0, column) });
  }

  const ownerAt = (index: number): Node => {
    const declaration = declarations.filter((item) => item.bodyStart !== undefined && item.bodyStart < index && (item.bodyEnd ?? item.end) >= index)
      .sort((left, right) => (left.end - left.start) - (right.end - right.start))[0];
    return declaration ? nodeByDeclaration.get(declaration) ?? fileNode : fileNode;
  };
  const pushRef = (index: number, name: string, kind: UnresolvedReference['referenceKind'], columnIndex = index): void => {
    const token = tokens[columnIndex];
    if (!token || !name) return;
    refs.push({ fromNodeId: ownerAt(index).id, referenceName: name, referenceKind: kind, line: token.start.line, column: token.start.column });
  };

  // Inheritance and protocol conformance use the established Swift `extends` surface.
  for (const declaration of declarations.filter((item) => CONTAINERS.has(item.kind))) {
    const node = nodeByDeclaration.get(declaration);
    if (!node) continue;
    if (declaration.extensionTarget) {
      const token = tokens[declaration.start]!;
      refs.push({ fromNodeId: node.id, referenceName: declaration.extensionTarget, referenceKind: 'references', line: token.start.line, column: token.start.column });
    }
    const limit = declaration.bodyStart ?? declaration.end;
    const colon = nextText(declaration.start + 1, ':', limit);
    if (colon < 0) continue;
    for (let index = colon + 1; index < limit; index += 1) {
      const token = tokens[index]!;
      if (token.kind !== 'identifier' || TYPE_WORDS.has(token.text) || ['where'].includes(token.text)) continue;
      refs.push({ fromNodeId: node.id, referenceName: token.text, referenceKind: 'extends', line: token.start.line, column: token.start.column });
    }
  }

  // Product-level type dependencies from declaration headers.
  const seenTypes = new Set<string>();
  for (const declaration of declarations) {
    const node = nodeByDeclaration.get(declaration);
    if (!node) continue;
    const limit = declaration.bodyStart ?? declaration.end + 1;
    for (let index = declaration.start; index < limit; index += 1) {
      const token = tokens[index]!;
      if (token.kind !== 'identifier' || TYPE_WORDS.has(token.text) || token.text === declaration.name || CONTROL.has(token.text)) continue;
      if (!/^[A-Z]/u.test(token.text) && tokens[index - 1]?.text !== '@') continue;
      const key = `${node.id}\0${token.text}\0${token.start.offset}`;
      if (seenTypes.has(key)) continue;
      seenTypes.add(key);
      refs.push({ fromNodeId: node.id, referenceName: token.text, referenceKind: 'references', line: token.start.line, column: token.start.column });
    }
  }

  // Property-wrapper attributes and metatype arguments may be the only link to
  // a model type (for example `@Siblings(through: Pivot.self, ...)`).
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.kind !== 'identifier' || TYPE_WORDS.has(token.text)) continue;
    const attribute = tokens[index - 1]?.text === '@';
    const metatype = tokens[index + 1]?.text === '.' && tokens[index + 2]?.text === 'self';
    if (!attribute && !metatype) continue;
    pushRef(index, token.text, 'references');
  }

  // Calls preserve receiver spelling and encode factory chains for return-type resolution.
  const declarationNames = new Set<number>();
  for (const declaration of declarations) {
    for (let index = declaration.start; index <= Math.min(declaration.bodyStart ?? declaration.end, declaration.end); index += 1) {
      if (tokens[index]?.text === declaration.name) { declarationNames.add(index); break; }
    }
  }
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const callee = tokens[index]!;
    if (callee.kind !== 'identifier' || tokens[index + 1]?.text !== '(' || CONTROL.has(callee.text) || declarationNames.has(index)) continue;
    let name = callee.text;
    let columnIndex = index;
    if (tokens[index - 1]?.text === '.' && tokens[index - 2]?.text === ')') {
      const innerOpen = scan.pairs.get(index - 2);
      const innerName = innerOpen === undefined ? undefined : tokens[innerOpen - 1];
      if (innerName?.kind === 'identifier') {
        let inner = innerName.text;
        let innerStart = innerOpen! - 1;
        if (tokens[innerStart - 1]?.text === '.' && tokens[innerStart - 2]?.kind === 'identifier') {
          inner = `${tokens[innerStart - 2]!.text}.${inner}`;
          innerStart -= 2;
        }
        name = `${inner}().${callee.text}`;
        columnIndex = innerStart;
      }
    } else if (tokens[index - 1]?.text === '.') {
      let start = index;
      while (start >= 2 && tokens[start - 1]!.text === '.' && tokens[start - 2]?.kind === 'identifier') start -= 2;
      if (start < index) {
        name = tokens.slice(start, index + 1).map((token) => token.text).join('');
        if (tokens[start]!.text === 'self' || tokens[start]!.text === 'super') name = callee.text;
        columnIndex = start;
      }
    }
    pushRef(index, name, 'calls', columnIndex);
  }

  // Callable values: bare same-file names in value/argument positions and #selector.
  const defined = new Set(declarations.filter((item) => item.kind === 'function' || item.kind === 'method').map((item) => item.name));
  const inParameters = (index: number): boolean => declarations.some((item) => item.paramsStart !== undefined && item.paramsEnd !== undefined && item.paramsStart < index && index < item.paramsEnd);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.kind !== 'identifier' || tokens[index + 1]?.text === '(' || inParameters(index)) continue;
    if (tokens[index - 2]?.text === '#' && tokens[index - 1]?.text === 'selector') pushRef(index, token.text, 'function_ref');
    else if (defined.has(token.text) && ['(', ',', '=', '[', ':'].includes(tokens[index - 1]?.text ?? '')) pushRef(index, token.text, 'function_ref');
  }

  nodes.splice(1, nodes.length - 1, ...nodes.slice(1).sort((left, right) => left.startLine - right.startLine || left.startColumn - right.startColumn || left.kind.localeCompare(right.kind)));
  refs.sort((left, right) => left.line - right.line || left.column - right.column);
  return {
    nodes, edges, unresolvedReferences: refs,
    errors: scan.unterminated.map((kind) => ({ message: `Incomplete ${kind} while scanning ${filePath}`, filePath, severity: 'warning' as const, code: 'native_incomplete_source' })),
    durationMs: Date.now() - started,
  };
}
