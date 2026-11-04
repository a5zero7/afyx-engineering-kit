import * as path from 'path';
import type { Edge, ExtractionResult, Node, NodeKind, UnresolvedReference } from '../../types';
import { generateNodeId } from '../node-id';
import { scanSource, type NativeToken } from './scanner';

interface SolidityDeclaration {
  kind: NodeKind;
  name: string;
  start: number;
  end: number;
  bodyStart?: number;
  bodyEnd?: number;
  paramsStart?: number;
  paramsEnd?: number;
  headerEnd?: number;
  parent?: SolidityDeclaration;
  visibility?: Node['visibility'];
  signature?: string;
  returnType?: string;
}

const CONTAINERS = new Set<NodeKind>(['class', 'interface', 'struct', 'enum']);
const CALLABLES = new Set<NodeKind>(['function', 'method']);
const DECLARATION_WORDS = new Set([
  'abstract', 'contract', 'interface', 'library', 'struct', 'enum', 'error', 'event',
  'function', 'constructor', 'modifier', 'fallback', 'receive', 'type',
]);
const HEADER_WORDS = new Set([
  'public', 'private', 'internal', 'external', 'pure', 'view', 'payable', 'constant',
  'immutable', 'virtual', 'override', 'returns', 'memory', 'storage', 'calldata',
]);
const TYPE_WORDS = new Set([
  ...HEADER_WORDS,
  'address', 'bool', 'byte', 'bytes', 'fixed', 'string', 'ufixed', 'mapping',
  'int', 'uint', 'function', 'contract', 'interface', 'library', 'struct', 'enum',
]);
const CALL_EXCLUSIONS = new Set([
  'if', 'for', 'while', 'do', 'try', 'catch', 'return', 'emit', 'revert', 'new',
  'function', 'modifier', 'constructor', 'fallback', 'receive', 'returns',
]);

function solidityVisibility(tokens: readonly NativeToken[], start: number, end: number): Node['visibility'] {
  for (let index = start; index < end; index += 1) {
    const text = tokens[index]?.text;
    if (text === 'external' || text === 'public') return 'public';
    if (text === 'private') return 'private';
    if (text === 'internal') return 'internal';
  }
  return undefined;
}

function isBuiltinType(name: string): boolean {
  return TYPE_WORDS.has(name) || /^(?:u?int)(?:8|16|24|32|40|48|56|64|72|80|88|96|104|112|120|128|136|144|152|160|168|176|184|192|200|208|216|224|232|240|248|256)?$/u.test(name) ||
    /^bytes(?:[1-9]|[12]\d|3[0-2])$/u.test(name);
}

/** Afyx-native semantic facts for the bounded Solidity product contract. */
export function extractNativeSolidityFacts(filePath: string, source: string): ExtractionResult {
  const started = Date.now();
  const scan = scanSource(source, { hashComments: false });
  const tokens = scan.tokens;
  const declarations: SolidityDeclaration[] = [];

  const nextText = (from: number, text: string, limit = tokens.length): number => {
    for (let index = from; index < limit; index += 1) if (tokens[index]?.text === text) return index;
    return -1;
  };
  const bodyAfter = (from: number, limit = tokens.length): { open: number; close: number } | undefined => {
    for (let cursor = from; cursor < limit; cursor += 1) {
      if (tokens[cursor]?.text === ';') return undefined;
      if (tokens[cursor]?.text !== '{') continue;
      const close = scan.pairs.get(cursor);
      return close === undefined ? undefined : { open: cursor, close };
    }
    return undefined;
  };
  const headerEndAfter = (from: number, limit = tokens.length): number => {
    for (let cursor = from; cursor < limit; cursor += 1) {
      const text = tokens[cursor]?.text;
      if (text === '{' || text === ';') return cursor;
      if ((text === '(' || text === '[') && scan.pairs.has(cursor)) cursor = scan.pairs.get(cursor)!;
    }
    return Math.max(from, limit - 1);
  };
  const ownerFor = (start: number, end = start): SolidityDeclaration | undefined => declarations
    .filter((item) => CONTAINERS.has(item.kind) && item.bodyStart !== undefined && item.bodyEnd !== undefined &&
      item.bodyStart < start && item.bodyEnd >= end)
    .sort((left, right) => (left.end - left.start) - (right.end - right.start))[0];
  const directStatements = (start: number, end: number): Array<{ start: number; end: number }> => {
    const statements: Array<{ start: number; end: number }> = [];
    let statementStart = start;
    for (let cursor = start; cursor < end; cursor += 1) {
      const token = tokens[cursor]!;
      if (token.text === '{' && scan.pairs.has(cursor)) {
        cursor = scan.pairs.get(cursor)!;
        statementStart = cursor + 1;
      } else if (token.text === ';') {
        statements.push({ start: statementStart, end: cursor });
        statementStart = cursor + 1;
      }
    }
    return statements;
  };

  // Contract-like and aggregate containers establish lexical ownership.
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const keyword = tokens[index]!.text;
    if (!['contract', 'interface', 'library', 'struct', 'enum'].includes(keyword)) continue;
    const name = tokens[index + 1];
    if (name?.kind !== 'identifier') continue;
    const body = bodyAfter(index + 2);
    if (!body) continue;
    const kind: NodeKind = keyword === 'interface' ? 'interface' : keyword === 'struct' ? 'struct' : keyword === 'enum' ? 'enum' : 'class';
    declarations.push({ kind, name: name.text, start: index, end: body.close, bodyStart: body.open, bodyEnd: body.close });
    index += 1;
  }
  declarations.sort((left, right) => left.start - right.start || right.end - left.end);
  for (const declaration of declarations) declaration.parent = ownerFor(declaration.start, declaration.end);

  // Functions and Solidity-specific callable forms.
  for (let index = 0; index < tokens.length; index += 1) {
    const keyword = tokens[index]!.text;
    if (!['function', 'constructor', 'modifier', 'fallback', 'receive'].includes(keyword)) continue;
    let name = keyword;
    let nameIndex = index;
    if (keyword === 'function' || keyword === 'modifier') {
      nameIndex = index + 1;
      if (tokens[nameIndex]?.kind !== 'identifier') continue;
      name = tokens[nameIndex]!.text;
    }
    const paramsStart = nextText(nameIndex + 1, '(');
    const paramsEnd = paramsStart < 0 ? undefined : scan.pairs.get(paramsStart);
    if (paramsStart < 0 || paramsEnd === undefined) continue;
    const headerEnd = headerEndAfter(paramsEnd + 1);
    const bodyStart = tokens[headerEnd]?.text === '{' ? headerEnd : undefined;
    const bodyEnd = bodyStart === undefined ? undefined : scan.pairs.get(bodyStart);
    const end = bodyEnd ?? headerEnd;
    const parent = ownerFor(index, end);
    const returnsIndex = nextText(paramsEnd + 1, 'returns', headerEnd);
    let returnType: string | undefined;
    if (returnsIndex >= 0 && tokens[returnsIndex + 1]?.text === '(') {
      const returnsEnd = scan.pairs.get(returnsIndex + 1) ?? headerEnd;
      returnType = tokens.slice(returnsIndex + 2, returnsEnd)
        .find((token) => token.kind === 'identifier' && !isBuiltinType(token.text))?.text ??
        tokens.slice(returnsIndex + 2, returnsEnd).find((token) => token.kind === 'identifier')?.text;
    }
    const signatureParts = [source.slice(tokens[paramsStart]!.start.offset, tokens[paramsEnd]!.end.offset)];
    for (let cursor = paramsEnd + 1; cursor < headerEnd; cursor += 1) {
      const text = tokens[cursor]!.text;
      if (['public', 'private', 'internal', 'external', 'pure', 'view', 'payable'].includes(text)) signatureParts.push(text);
      if (text === 'returns' && tokens[cursor + 1]?.text === '(') {
        const close = scan.pairs.get(cursor + 1);
        if (close !== undefined) {
          signatureParts.push(source.slice(tokens[cursor]!.start.offset, tokens[close]!.end.offset));
          cursor = close;
        }
      }
    }
    declarations.push({
      kind: parent ? 'method' : 'function', name, start: index, end, bodyStart, bodyEnd,
      paramsStart, paramsEnd, headerEnd, parent,
      visibility: solidityVisibility(tokens, paramsEnd + 1, headerEnd),
      signature: signatureParts.join(' '), returnType,
    });
  }

  // Events, custom errors, and user-defined value types are graph definitions.
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const keyword = tokens[index]!.text;
    if (!['event', 'error', 'type'].includes(keyword) || tokens[index + 1]?.kind !== 'identifier') continue;
    const end = nextText(index + 2, ';');
    if (end < 0) continue;
    declarations.push({
      kind: keyword === 'type' ? 'type_alias' : 'field', name: tokens[index + 1]!.text,
      start: index, end, parent: ownerFor(index, end),
      signature: source.slice(tokens[index]!.start.offset, tokens[end]!.end.offset).trim().slice(0, 200),
    });
  }

  // Enum values are comma-delimited identifiers within the enum body.
  for (const parent of declarations.filter((item) => item.kind === 'enum' && item.bodyStart !== undefined && item.bodyEnd !== undefined)) {
    for (let cursor = parent.bodyStart! + 1; cursor < parent.bodyEnd!; cursor += 1) {
      const token = tokens[cursor]!;
      if (token.kind === 'identifier' && (tokens[cursor - 1]?.text === '{' || tokens[cursor - 1]?.text === ',')) {
        declarations.push({ kind: 'enum_member', name: token.text, start: cursor, end: cursor, parent });
      }
    }
  }

  // Direct semicolon statements provide state variables, struct members, and file constants.
  const fieldOwners: Array<SolidityDeclaration | undefined> = [
    undefined,
    ...declarations.filter((item) => ['class', 'interface', 'struct'].includes(item.kind)),
  ];
  for (const parent of fieldOwners) {
    const start = parent?.bodyStart === undefined ? 0 : parent.bodyStart + 1;
    const end = parent?.bodyEnd ?? tokens.length;
    for (const statement of directStatements(start, end)) {
      const slice = tokens.slice(statement.start, statement.end + 1);
      const words = slice.filter((token) => token.kind === 'identifier').map((token) => token.text);
      if (words.length < 2 || words.some((word) => DECLARATION_WORDS.has(word)) ||
          ['pragma', 'import', 'using'].includes(words[0] ?? '')) continue;
      const equals = slice.findIndex((token) => token.text === '=');
      const limit = equals >= 0 ? equals : slice.length - 1;
      let nameToken: NativeToken | undefined;
      for (let cursor = limit - 1; cursor >= 0; cursor -= 1) {
        if (slice[cursor]!.kind === 'identifier' && !HEADER_WORDS.has(slice[cursor]!.text)) {
          nameToken = slice[cursor];
          break;
        }
      }
      if (!nameToken) continue;
      const nameIndex = tokens.indexOf(nameToken);
      const declarationStart = tokens.findIndex((token, index) => index >= statement.start && index <= statement.end && token.kind !== 'comment');
      const kind: NodeKind = parent ? 'field' : words.includes('constant') ? 'constant' : 'variable';
      declarations.push({
        kind, name: nameToken.text, start: declarationStart < 0 ? nameIndex : declarationStart, end: statement.end, parent,
        visibility: solidityVisibility(tokens, statement.start, nameIndex),
        signature: source.slice(tokens[statement.start]!.start.offset, tokens[statement.end]!.end.offset).trim(),
      });
    }
  }

  declarations.sort((left, right) => left.start - right.start || right.end - left.end || left.kind.localeCompare(right.kind));
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const refs: UnresolvedReference[] = [];
  const fileNode: Node = {
    id: `file:${filePath}`, kind: 'file', name: path.basename(filePath), qualifiedName: filePath,
    filePath, language: 'solidity', startLine: 1, endLine: source.split('\n').length,
    startColumn: 0, endColumn: 0, isExported: false, updatedAt: Date.now(),
  };
  nodes.push(fileNode);
  const nodeByDeclaration = new Map<SolidityDeclaration, Node>();
  for (const declaration of declarations) {
    const start = tokens[declaration.start]!;
    const end = tokens[declaration.end] ?? start;
    const parentNode = declaration.parent ? nodeByDeclaration.get(declaration.parent) : undefined;
    const node: Node = {
      id: generateNodeId(filePath, declaration.kind, declaration.name, start.start.line),
      kind: declaration.kind, name: declaration.name,
      qualifiedName: parentNode ? `${parentNode.qualifiedName}::${declaration.name}` : declaration.name,
      filePath, language: 'solidity', startLine: start.start.line, endLine: end.end.line,
      startColumn: start.start.column, endColumn: end.end.column,
      visibility: declaration.visibility, signature: declaration.signature,
      returnType: declaration.returnType, updatedAt: Date.now(),
    };
    nodes.push(node);
    nodeByDeclaration.set(declaration, node);
    edges.push({ source: parentNode?.id ?? fileNode.id, target: node.id, kind: 'contains' });
  }

  const ownerAt = (index: number): Node => {
    const owner = declarations.filter((item) => CALLABLES.has(item.kind) && item.bodyStart !== undefined && item.bodyStart < index && item.end >= index)
      .sort((left, right) => (left.end - left.start) - (right.end - right.start))[0] ??
      declarations.filter((item) => CONTAINERS.has(item.kind) && item.bodyStart !== undefined && item.bodyStart < index && item.end >= index)
        .sort((left, right) => (left.end - left.start) - (right.end - right.start))[0];
    return owner ? nodeByDeclaration.get(owner) ?? fileNode : fileNode;
  };
  const addRef = (from: Node, token: NativeToken, kind: UnresolvedReference['referenceKind'], name = token.text): void => {
    refs.push({ fromNodeId: from.id, referenceName: name, referenceKind: kind, line: token.start.line, column: token.start.column });
  };

  // Imports preserve the source module and named bindings.
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index]!.text !== 'import') continue;
    const end = nextText(index + 1, ';');
    if (end < 0) continue;
    const moduleToken = tokens.slice(index + 1, end).find((token) => token.kind === 'string');
    if (!moduleToken) continue;
    const moduleName = moduleToken.text.slice(1, -1);
    const importNode: Node = {
      id: generateNodeId(filePath, 'import', moduleName, tokens[index]!.start.line),
      kind: 'import', name: moduleName, qualifiedName: moduleName, filePath, language: 'solidity',
      startLine: tokens[index]!.start.line, endLine: tokens[end]!.end.line,
      startColumn: tokens[index]!.start.column, endColumn: tokens[end]!.end.column,
      signature: source.slice(tokens[index]!.start.offset, tokens[end]!.end.offset), updatedAt: Date.now(),
    };
    nodes.push(importNode);
    edges.push({ source: fileNode.id, target: importNode.id, kind: 'contains' });
    addRef(fileNode, moduleToken, 'imports', moduleName);
    for (const binding of tokens.slice(index + 1, end)) {
      if (binding.kind === 'identifier' && !['import', 'from', 'as'].includes(binding.text)) addRef(fileNode, binding, 'imports');
    }
    index = end;
  }

  // Inheritance uses Solidity's single `is` relation; resolution may later reclassify interfaces.
  for (const declaration of declarations.filter((item) => item.kind === 'class' || item.kind === 'interface')) {
    if (declaration.bodyStart === undefined) continue;
    const marker = nextText(declaration.start + 1, 'is', declaration.bodyStart);
    if (marker < 0) continue;
    let segmentStart = marker + 1;
    for (let cursor = segmentStart; cursor <= declaration.bodyStart; cursor += 1) {
      if (cursor < declaration.bodyStart && tokens[cursor]!.text !== ',') continue;
      const ancestor = tokens.slice(segmentStart, cursor).find((token) => token.kind === 'identifier');
      if (ancestor) addRef(nodeByDeclaration.get(declaration)!, ancestor, 'extends');
      segmentStart = cursor + 1;
    }
  }

  // Header type references and modifier/base-constructor invocations.
  for (const declaration of declarations.filter((item) => CALLABLES.has(item.kind) && item.paramsStart !== undefined && item.paramsEnd !== undefined)) {
    const from = nodeByDeclaration.get(declaration)!;
    const seenTypes = new Set<string>();
    let segmentStart = declaration.paramsStart! + 1;
    for (let cursor = segmentStart; cursor <= declaration.paramsEnd!; cursor += 1) {
      if (cursor < declaration.paramsEnd! && tokens[cursor]!.text !== ',') continue;
      const identifiers = tokens.slice(segmentStart, cursor).filter((token) => token.kind === 'identifier');
      for (const type of identifiers.slice(0, Math.max(1, identifiers.length - 1))) {
        if (!isBuiltinType(type.text) && !seenTypes.has(type.text)) {
          seenTypes.add(type.text);
          addRef(from, type, 'references');
        }
      }
      segmentStart = cursor + 1;
    }
    if (declaration.headerEnd === undefined) continue;
    for (let cursor = declaration.paramsEnd! + 1; cursor < declaration.headerEnd; cursor += 1) {
      const token = tokens[cursor]!;
      if (token.text === 'returns' && tokens[cursor + 1]?.text === '(') {
        cursor = scan.pairs.get(cursor + 1) ?? cursor;
        continue;
      }
      if (token.text === 'override' && tokens[cursor + 1]?.text === '(') {
        cursor = scan.pairs.get(cursor + 1) ?? cursor;
        continue;
      }
      if (token.kind !== 'identifier' || HEADER_WORDS.has(token.text)) continue;
      addRef(from, token, 'calls');
      if (tokens[cursor + 1]?.text === '(') cursor = scan.pairs.get(cursor + 1) ?? cursor;
    }
  }

  // State/struct field type references and `using Library for Type` relations.
  for (const declaration of declarations.filter((item) => item.kind === 'field' || item.kind === 'constant' || item.kind === 'variable')) {
    if (tokens[declaration.start]?.text === 'event' || tokens[declaration.start]?.text === 'error') continue;
    const from = nodeByDeclaration.get(declaration)!;
    const nameIndex = tokens.findIndex((token, index) => index >= declaration.start && index <= declaration.end && token.text === declaration.name);
    if (nameIndex < 0) continue;
    const seen = new Set<string>();
    for (let cursor = declaration.start; cursor < nameIndex; cursor += 1) {
      const token = tokens[cursor]!;
      if (token.kind !== 'identifier' || isBuiltinType(token.text) || HEADER_WORDS.has(token.text) || seen.has(token.text)) continue;
      seen.add(token.text);
      addRef(from, token, 'references');
    }
  }
  for (let index = 0; index < tokens.length - 2; index += 1) {
    if (tokens[index]!.text !== 'using' || tokens[index + 1]?.kind !== 'identifier') continue;
    const from = ownerAt(index);
    addRef(from, tokens[index + 1]!, 'references');
    const forIndex = nextText(index + 2, 'for');
    if (forIndex >= 0 && tokens[forIndex + 1]?.kind === 'identifier' && !isBuiltinType(tokens[forIndex + 1]!.text)) {
      addRef(from, tokens[forIndex + 1]!, 'references');
    }
  }

  // Calls, event/error emission, and contract creation within callable bodies.
  for (const declaration of declarations.filter((item) => CALLABLES.has(item.kind) && item.bodyStart !== undefined && item.bodyEnd !== undefined)) {
    const from = nodeByDeclaration.get(declaration)!;
    for (let cursor = declaration.bodyStart! + 1; cursor < declaration.bodyEnd!; cursor += 1) {
      const token = tokens[cursor]!;
      if (token.text === 'new' && tokens[cursor + 1]?.kind === 'identifier') {
        addRef(from, tokens[cursor + 1]!, 'instantiates');
        continue;
      }
      if (token.kind !== 'identifier' || tokens[cursor + 1]?.text !== '(' || CALL_EXCLUSIONS.has(token.text)) continue;
      if (declarations.some((item) => item !== declaration && item.start === cursor)) continue;
      const receiver = tokens[cursor - 2]?.kind === 'identifier' && tokens[cursor - 1]?.text === '.' ? tokens[cursor - 2] : undefined;
      addRef(from, receiver ?? token, 'calls', receiver ? `${receiver.text}.${token.text}` : token.text);
    }
  }

  nodes.splice(1, nodes.length - 1, ...nodes.slice(1).sort((left, right) =>
    left.startLine - right.startLine || left.startColumn - right.startColumn || left.kind.localeCompare(right.kind)));
  refs.sort((left, right) => left.line - right.line || left.column - right.column || left.referenceKind.localeCompare(right.referenceKind));
  return {
    nodes, edges, unresolvedReferences: refs,
    errors: scan.unterminated.map((kind) => ({
      message: `Incomplete ${kind} while scanning ${filePath}`,
      filePath, severity: 'warning' as const, code: 'native_incomplete_source',
    })),
    durationMs: Date.now() - started,
  };
}
