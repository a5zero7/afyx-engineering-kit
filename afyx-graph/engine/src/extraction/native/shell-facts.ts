/** Bounded, source-grounded facts for the static subset of POSIX shell. */
import type { ExtractionResult } from '../../types';
import { scanSource, type NativeToken } from './scanner';
import {
  finishDynamicFacts, narrowestOwner, ownersByToken,
  type NativeDeclaration, type NativeReference,
} from './dynamic-fact-builder';

const CONTROL = new Set([
  'if', 'then', 'elif', 'else', 'fi', 'for', 'in', 'while', 'until', 'do', 'done',
  'case', 'esac', 'function', 'select', 'time', 'export', 'readonly', 'local',
  'declare', 'typeset', 'source', 'return', 'break', 'continue',
]);

/** Mask here-document bodies without changing UTF-16 offsets or line numbers. */
function withoutHereDocuments(source: string): string {
  const lines = source.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const pending: Array<{ label: string; stripTabs: boolean }> = [];
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (pending.length) {
      const active = pending[0]!;
      const body = line.replace(/\r?\n$/, '');
      if ((active.stripTabs ? body.replace(/^\t+/, '') : body) === active.label) pending.shift();
      lines[index] = line.replace(/[^\r\n]/g, ' ');
      continue;
    }
    for (let cursor = 0; cursor < line.length; cursor++) {
      const char = line[cursor]!;
      if (char === '\\' && quote !== "'") { cursor++; continue; }
      if (quote) { if (char === quote) quote = null; continue; }
      if (char === "'" || char === '"') { quote = char; continue; }
      if (char === '#' && (cursor === 0 || /\s/.test(line[cursor - 1]!))) break;
      if (char !== '<' || line[cursor + 1] !== '<' || line[cursor + 2] === '<') continue;
      const match = /^<<(-?)[ \t]*(['"]?)([A-Za-z_][\w-]*)\2/.exec(line.slice(cursor));
      if (!match) continue;
      pending.push({ label: match[3]!, stripTabs: match[1] === '-' });
      cursor += match[0].length - 1;
    }
  }
  return lines.join('');
}

function commandStart(tokens: readonly NativeToken[], index: number, source: string): boolean {
  if (index === 0) return true;
  const previous = tokens[index - 1]!;
  const gap = source.slice(previous.end.offset, tokens[index]!.start.offset);
  if (/\n/.test(gap.replace(/\\\r?\n/g, ''))) return true;
  if ([';', '|', '&', '{', '}', '('].includes(previous.text)) {
    // A command substitution is dynamic from the enclosing statement's view.
    return !(previous.text === '(' && tokens[index - 2]?.text === '$');
  }
  return ['if', 'then', 'elif', 'do', 'while', 'until', '!'].includes(previous.text);
}

function staticRelativeOperand(tail: string): string | null {
  const text = tail.trimStart();
  const quote = text[0] === '"' || text[0] === "'" ? text[0] : null;
  const close = quote ? text.indexOf(quote, 1) : -1;
  if (quote && close < 0) return null;
  const value = quote ? text.slice(1, close) : /^[^\s;|&#]+/.exec(text)?.[0];
  if (!value || !value.startsWith('./') && !value.startsWith('../')) return null;
  return /[$`*?\[\]{}()]/.test(value) ? null : value;
}

function statementTail(source: string, offset: number): string {
  const end = source.indexOf('\n', offset);
  return (source.slice(offset, end < 0 ? source.length : end).split(/[;|&#]/, 1)[0] ?? '');
}

export function extractNativeShellFacts(filePath: string, source: string): ExtractionResult {
  const started = Date.now();
  const scan = scanSource(withoutHereDocuments(source), { hashComments: true });
  const tokens = scan.tokens;
  const declarations: NativeDeclaration[] = [];
  const references: NativeReference[] = [];
  const headers = new Set<number>();

  for (let index = 0; index < tokens.length; index++) {
    const keyword = tokens[index]?.text === 'function' ? index : -1;
    const nameIndex = keyword >= 0 ? index + 1 : index;
    const name = tokens[nameIndex];
    if (name?.kind !== 'identifier' || !/^[A-Za-z_][\w]*$/.test(name.text)) continue;
    const openParen = tokens[nameIndex + 1]?.text === '(' ? nameIndex + 1 : -1;
    const afterName = openParen >= 0 && tokens[nameIndex + 2]?.text === ')' ? nameIndex + 3 : nameIndex + 1;
    if (keyword < 0 && openParen < 0) continue;
    if (tokens[afterName]?.text !== '{') continue;
    const close = scan.pairs.get(afterName);
    if (close === undefined) continue;
    declarations.push({ kind: 'function', name: name.text, start: nameIndex, end: close,
      bodyStart: afterName + 1, bodyEnd: close - 1 });
    for (let part = keyword >= 0 ? keyword : nameIndex; part <= afterName; part++) headers.add(part);
    index = afterName;
  }
  for (const declaration of declarations) {
    declaration.parent = narrowestOwner(declarations.filter((other) => other !== declaration), declaration.start);
  }
  const owners = ownersByToken(tokens, declarations);
  const functions = new Map<string, NativeDeclaration[]>();
  for (const declaration of declarations) {
    const group = functions.get(declaration.name) ?? [];
    group.push(declaration);
    functions.set(declaration.name, group);
  }

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (headers.has(index) || !commandStart(tokens, index, source)) continue;
    const owner = owners[index];
    if (token.text === '.' && source[token.end.offset] === '/') {
      const tail = statementTail(source, token.start.offset);
      const target = staticRelativeOperand(tail);
      if (target) references.push({ owner, token, name: target, kind: 'imports' });
      continue;
    }
    if (token.text === 'source' || token.text === '.' ||
        (token.text === 'bash' || token.text === 'sh' || token.text === 'zsh')) {
      const tail = statementTail(source, token.end.offset);
      const target = staticRelativeOperand(tail);
      if (target) references.push({ owner, token, name: target, kind: 'imports' });
      continue;
    }
    if (token.text === 'export' || token.text === 'readonly') {
      const next = tokens[index + 1];
      if (next?.kind === 'identifier' && tokens[index + 2]?.text === '=') {
        declarations.push({ kind: token.text === 'readonly' ? 'constant' : 'variable',
          name: next.text, start: index + 1, end: index + 1,
          exported: token.text === 'export', parent: owner });
      }
      continue;
    }
    if (token.kind !== 'identifier' || CONTROL.has(token.text)) continue;
    const matches = functions.get(token.text);
    if (matches?.length === 1) references.push({ owner, token, name: token.text,
      kind: 'calls', directTarget: matches[0] });
  }

  const result = finishDynamicFacts(filePath, source, 'shell', scan, declarations, references, started);
  for (const edge of result.edges) {
    if (edge.kind === 'references' && edge.metadata?.valueRef === true) edge.kind = 'calls';
  }
  for (const node of result.nodes) {
    if (node.isExported) result.edges.push({ source: `file:${filePath}`, target: node.id, kind: 'exports' });
  }
  return result;
}
