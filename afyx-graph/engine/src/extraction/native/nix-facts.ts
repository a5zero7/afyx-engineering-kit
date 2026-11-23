import type { NodeKind, UnresolvedReference } from '../../types';
import { scanSource, type NativeToken } from './scanner';
import {
  finishDynamicFacts, narrowestOwner, tokenText,
  type NativeDeclaration, type NativeReference,
} from './dynamic-fact-builder';

const CALLABLES = new Set<NodeKind>(['function']);
const KEYWORDS = new Set(['assert', 'else', 'if', 'in', 'inherit', 'let', 'or', 'rec', 'then', 'with']);

function isStaticPath(value: string): boolean {
  return (value.startsWith('./') || value.startsWith('../')) && !/[\s{}()[\];"'<>$]/.test(value);
}

function attrName(tokens: readonly NativeToken[], start: number, end: number): string {
  return tokens.slice(start, end).map((token) => token.text).join('');
}

function isStaticAttrPath(tokens: readonly NativeToken[], start: number, end: number): boolean {
  const validSegment = (segment: readonly NativeToken[]): boolean => {
    if (segment.length === 1 && segment[0]!.kind === 'string') return !segment[0]!.text.includes('${');
    if (segment.length === 0 || segment[0]!.kind !== 'identifier') return false;
    for (let index = 1; index < segment.length; index += 2) {
      if (segment[index]?.text !== '-' || segment[index + 1]?.kind !== 'identifier') return false;
    }
    return segment.length % 2 === 1;
  };
  let segmentStart = start;
  for (let index = start; index <= end; index += 1) {
    if (index < end && tokens[index]!.text !== '.') continue;
    if (!validSegment(tokens.slice(segmentStart, index))) return false;
    segmentStart = index + 1;
  }
  return true;
}

function pathAt(source: string, token: NativeToken): string | undefined {
  const tail = source.slice(token.start.offset);
  const match = /^(?:\.\.?\/)[A-Za-z0-9_+.-]+(?:\/[A-Za-z0-9_+.-]+)*/.exec(tail);
  return match && isStaticPath(match[0]) ? match[0] : undefined;
}

function statementEnd(tokens: readonly NativeToken[], pairs: ReadonlyMap<number, number>, from: number): number {
  for (let index = from; index < tokens.length; index += 1) {
    if (['(', '[', '{'].includes(tokens[index]!.text) && pairs.has(index)) { index = pairs.get(index)!; continue; }
    if (tokens[index]!.text === ';') return index;
  }
  return tokens.length - 1;
}

function parameterText(source: string, tokens: readonly NativeToken[], start: number, end: number): string {
  const text = tokenText(source, tokens, start, end).trim();
  if (text.startsWith('{') || text.startsWith('(') || text.includes('@')) return text;
  return `(${text})`;
}

/** Bounded structural Nix facts. This intentionally performs no evaluation. */
export function extractNativeNixFacts(filePath: string, source: string) {
  const started = Date.now();
  const scan = scanSource(source, { hashComments: true, nixSyntax: true });
  const tokens = scan.tokens;
  const declarations: NativeDeclaration[] = [];
  const references: NativeReference[] = [];

  const callableAt = (index: number) => narrowestOwner(declarations, index, CALLABLES);
  const pushRef = (index: number, name: string, kind: UnresolvedReference['referenceKind'], owner = callableAt(index)): void => {
    const token = tokens[index];
    if (token && name) references.push({ owner, token, name, kind });
  };
  const staticPathFrom = (index: number): { value: string; end: number } | undefined => {
    const token = tokens[index];
    if (!token) return undefined;
    if (token.kind === 'string') {
      const value = token.text.slice(1, -1);
      return isStaticPath(value) ? { value, end: index } : undefined;
    }
    if (token.text !== '.') return undefined;
    const value = pathAt(source, token);
    if (!value) return undefined;
    const endOffset = token.start.offset + value.length;
    let end = index;
    while (end + 1 < tokens.length && tokens[end + 1]!.end.offset <= endOffset) end += 1;
    return { value, end };
  };

  // A brace is an exported result set only when it is the outer expression or
  // immediately follows the outer function/let `:`/`in` boundary.
  const exportedSets = new Set<number>();
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index]!.text !== '{' || !scan.pairs.has(index)) continue;
    const prior = tokens[index - 1]?.text;
    const atRoot = index === 0 || prior === 'in' || prior === ':' || (prior === 'rec' && tokens[index - 2]?.text === 'in');
    const parameterSet = tokens[scan.pairs.get(index)! + 1]?.text === ':';
    if (atRoot && !parameterSet) exportedSets.add(index);
  }
  const exportedAt = (index: number): boolean => [...exportedSets].some((open) => open < index && (scan.pairs.get(open) ?? open) > index) &&
    ![...scan.pairs.entries()].some(([open, close]) => tokens[open]?.text === '{' && open < index && close > index && !exportedSets.has(open));

  interface Binding { start: number; equals: number; end: number; name: string; valueStart: number; }
  const bindings: Binding[] = [];
  for (let equals = 0; equals < tokens.length; equals += 1) {
    if (tokens[equals]!.text !== '=') continue;
    let start = equals - 1;
    while (start > 0 && ![';', '{', '}', 'let', 'in'].includes(tokens[start - 1]!.text)) start -= 1;
    if (start >= equals || tokens.slice(start, equals).some((token) => ['(', ')', ':'].includes(token.text))) continue;
    const name = attrName(tokens, start, equals).trim();
    if (!name || name.startsWith('.') || KEYWORDS.has(name) || !isStaticAttrPath(tokens, start, equals)) continue;
    const end = statementEnd(tokens, scan.pairs, equals + 1);
    bindings.push({ start, equals, end, name, valueStart: equals + 1 });
  }

  // Named binding declarations and curried function values.
  for (const binding of bindings) {
    let cursor = binding.valueStart;
    const params: Array<{ start: number; end: number }> = [];
    for (;;) {
      if (tokens[cursor]?.text === '{' || tokens[cursor]?.text === '(') {
        const close = scan.pairs.get(cursor);
        if (close !== undefined && tokens[close + 1]?.text === ':') {
          params.push({ start: cursor, end: close });
          cursor = close + 2;
          continue;
        }
      }
      if (tokens[cursor]?.kind === 'identifier' && tokens[cursor + 1]?.text === ':') {
        params.push({ start: cursor, end: cursor });
        cursor += 2;
        continue;
      }
      break;
    }
    const parent = callableAt(binding.start);
    if (params.length > 0) {
      const signature = params.map((param) => parameterText(source, tokens, param.start, param.end)).join(' : ').replace(/^\(([^{}@()]*)\) : \(([^{}@()]*)\)$/u, '$1 : $2');
      declarations.push({
        kind: 'function', name: binding.name, start: binding.start, end: binding.end,
        bodyStart: cursor, bodyEnd: binding.end, parent, signature,
        exported: exportedAt(binding.start),
      });
    } else {
      declarations.push({
        kind: 'variable', name: binding.name, start: binding.start, end: binding.end,
        bodyStart: binding.valueStart, bodyEnd: binding.end, parent,
        signature: `= ${tokenText(source, tokens, binding.valueStart, Math.min(binding.end, binding.valueStart + 30)).slice(0, 100)}`,
        exported: exportedAt(binding.start),
      });
    }
  }

  // `inherit a;` / `inherit (pkgs) a b;` create structural variables.
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index]!.text !== 'inherit') continue;
    const end = statementEnd(tokens, scan.pairs, index + 1);
    let cursor = index + 1;
    if (tokens[cursor]?.text === '(' && scan.pairs.has(cursor)) cursor = scan.pairs.get(cursor)! + 1;
    for (; cursor < end; cursor += 1) {
      const token = tokens[cursor]!;
      if (token.kind === 'identifier' && !KEYWORDS.has(token.text)) declarations.push({ kind: 'variable', name: token.text, start: cursor, end: cursor, parent: callableAt(index), exported: exportedAt(index) });
    }
    index = end;
  }

  const emitImport = (index: number, path: { value: string; end: number }, owner = callableAt(index)): void => {
    declarations.push({ kind: 'import', name: path.value, start: index, end: path.end, parent: owner, signature: tokenText(source, tokens, index, path.end).slice(0, 100) });
    references.push({ owner, token: tokens[path.end]!, name: path.value, kind: 'imports' });
  };

  // Direct imports and callPackage file loads.
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index - 1]?.text === '.') continue;
    let callee = '';
    let cursor = index;
    if (tokens[index]!.text === 'import') { callee = 'import'; cursor = index + 1; }
    else if (tokens[index]!.text === 'builtins' && tokens[index + 1]?.text === '.' && tokens[index + 2]?.text === 'import') { callee = 'builtins.import'; cursor = index + 3; }
    else if (tokens[index]!.kind === 'identifier') {
      let end = index;
      while (tokens[end + 1]?.text === '.' && tokens[end + 2]?.kind === 'identifier') end += 2;
      callee = tokens.slice(index, end + 1).map((token) => token.text).join('');
      if (callee.endsWith('callPackage') || callee.endsWith('callPackages')) cursor = end + 1;
      else continue;
    } else continue;
    const path = staticPathFrom(cursor);
    if (path) emitImport(index, path);
    if (callee !== 'import' && callee !== 'builtins.import') pushRef(index, callee, 'calls');
  }

  // imports/modules list bindings contain path dependencies without calls.
  for (const binding of bindings) {
    const leaf = binding.name.split('.').at(-1);
    if (leaf !== 'imports' && leaf !== 'modules') continue;
    if (tokens[binding.valueStart]?.text !== '[') continue;
    const close = scan.pairs.get(binding.valueStart) ?? binding.end;
    for (let index = binding.valueStart + 1; index < close; index += 1) {
      const path = staticPathFrom(index);
      if (!path) continue;
      emitImport(index, path, callableAt(binding.start));
      index = path.end;
    }
  }

  // Function application and attribute selections. Only applications within a
  // named function become call refs, matching the existing lexical contract.
  for (const declaration of declarations.filter((item) => item.kind === 'function' && item.bodyStart !== undefined && item.bodyEnd !== undefined)) {
    for (let index = declaration.bodyStart!; index < declaration.bodyEnd!; index += 1) {
      const token = tokens[index]!;
      if (token.kind !== 'identifier' || KEYWORDS.has(token.text)) continue;
      let end = index;
      while (tokens[end + 1]?.text === '.' && tokens[end + 2]?.kind === 'identifier') end += 2;
      const name = tokens.slice(index, end + 1).map((item) => item.text).join('');
      if (name === 'import' || name === 'builtins.import' || name.endsWith('callPackage') || name.endsWith('callPackages')) { index = end; continue; }
      const argument = tokens[end + 1];
      const applied = argument && argument.start.line <= token.start.line + 1 &&
        (argument.kind === 'identifier' || argument.kind === 'string' || ['(', '{', '[', '.'].includes(argument.text));
      if (applied) references.push({ owner: declaration, token, name, kind: 'calls' });
      index = end;
    }
  }

  // Same-file function bindings used as values.
  const functions = new Set(declarations.filter((item) => item.kind === 'function').map((item) => item.name));
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (!functions.has(token.text) || tokens[index + 1]?.text === ':' || bindings.some((binding) => binding.start === index)) continue;
    if (['=', '[', '{', ','].includes(tokens[index - 1]?.text ?? '')) pushRef(index, token.text, 'function_ref');
  }

  return finishDynamicFacts(filePath, source, 'nix', scan, declarations, references, started);
}
