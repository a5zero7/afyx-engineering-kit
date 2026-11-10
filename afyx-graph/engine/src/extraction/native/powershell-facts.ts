/** Static PowerShell facts with conservative, case-insensitive local binding. */
import type { ExtractionResult } from '../../types';
import { scanSource, type NativeToken } from './scanner';
import {
  finishDynamicFacts, narrowestOwner, ownersByToken,
  type NativeDeclaration, type NativeReference,
} from './dynamic-fact-builder';

const CONTROL = new Set([
  'function', 'filter', 'param', 'begin', 'process', 'end', 'if', 'elseif', 'else',
  'foreach', 'for', 'while', 'do', 'switch', 'try', 'catch', 'finally', 'return',
  'throw', 'break', 'continue', 'in', 'where', 'class', 'enum',
]);

function withoutOpaqueRegions(source: string): string {
  const lines = source.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  let blockComment = false;
  let hereEnd: "'@" | '"@' | null = null;
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (hereEnd) {
      lines[index] = line.replace(/[^\r\n]/g, ' ');
      if (line.trimStart().startsWith(hereEnd)) hereEnd = null;
      continue;
    }
    const output = line.split('');
    for (let cursor = 0; cursor < line.length; cursor++) {
      const char = line[cursor]!;
      if (blockComment) {
        if (char === '#' && line[cursor + 1] === '>') {
          output[cursor] = output[cursor + 1] = ' ';
          cursor++;
          blockComment = false;
        } else if (char !== '\r' && char !== '\n') output[cursor] = ' ';
        continue;
      }
      if (quote) {
        if (char === '`' && quote === '"') { cursor++; continue; }
        if (char === "'" && quote === "'" && line[cursor + 1] === "'") { cursor++; continue; }
        if (char === quote) quote = null;
        continue;
      }
      if (char === '#') break; // The native scanner handles the rest of this line.
      if (char === '<' && line[cursor + 1] === '#') {
        output[cursor] = output[cursor + 1] = ' ';
        cursor++;
        blockComment = true;
        continue;
      }
      if (char === '@' && (line[cursor + 1] === "'" || line[cursor + 1] === '"') &&
          !line.slice(cursor + 2).trim()) {
        hereEnd = line[cursor + 1] === "'" ? "'@" : '"@';
        for (let part = cursor; part < line.length; part++) {
          if (line[part] !== '\r' && line[part] !== '\n') output[part] = ' ';
        }
        break;
      }
      if (char === "'" || char === '"') quote = char;
    }
    lines[index] = output.join('');
  }
  return lines.join('');
}

function commandStart(tokens: readonly NativeToken[], index: number, source: string): boolean {
  if (index === 0) return true;
  const prior = tokens[index - 1]!;
  const gap = source.slice(prior.end.offset, tokens[index]!.start.offset);
  if (gap.replace(/`\r?\n/g, '').includes('\n')) return true;
  if ([';', '|', '{', '}', '&', '('].includes(prior.text)) return true;
  return ['if', 'elseif', 'while', 'return'].includes(prior.text.toLowerCase());
}

function commandName(tokens: readonly NativeToken[], index: number): string {
  const first = tokens[index];
  if (first?.kind !== 'identifier') return '';
  let name = first.text;
  let cursor = index + 1;
  while (tokens[cursor]?.text === '-' && tokens[cursor + 1]?.kind === 'identifier' &&
      tokens[cursor]!.start.offset === tokens[cursor - 1]!.end.offset &&
      tokens[cursor + 1]!.start.offset === tokens[cursor]!.end.offset) {
    name += `-${tokens[cursor + 1]!.text}`;
    cursor += 2;
  }
  return name;
}

function staticPath(tail: string): string | null {
  const text = tail.trimStart();
  const quote = text[0] === "'" || text[0] === '"' ? text[0] : null;
  const close = quote ? text.indexOf(quote, 1) : -1;
  if (quote && close < 0) return null;
  const value = quote ? text.slice(1, close) : /^[^\s;|&#]+/.exec(text)?.[0];
  if (!value || !/^(?:\.\.?[\\/])/.test(value) || /[$`*?\[\]{}()]/.test(value)) return null;
  return value.replace(/\\/g, '/');
}

function statementTail(source: string, offset: number): string {
  const end = source.indexOf('\n', offset);
  return (source.slice(offset, end < 0 ? source.length : end).split(/[;|&#]/, 1)[0] ?? '');
}

export function extractNativePowerShellFacts(filePath: string, source: string): ExtractionResult {
  const started = Date.now();
  const scan = scanSource(withoutOpaqueRegions(source), { hashComments: true });
  const tokens = scan.tokens;
  const declarations: NativeDeclaration[] = [];
  const references: NativeReference[] = [];
  const headers = new Set<number>();

  for (let index = 0; index < tokens.length; index++) {
    if (!['function', 'filter'].includes(tokens[index]!.text.toLowerCase())) continue;
    const nameIndex = index + 1;
    const name = commandName(tokens, nameIndex);
    if (!name) continue;
    let open = nameIndex + name.split('-').length * 2 - 1;
    if (name.indexOf('-') < 0) open = nameIndex + 1;
    if (tokens[open]?.text !== '{') continue;
    const close = scan.pairs.get(open);
    if (close === undefined) continue;
    declarations.push({ kind: 'function', name, start: nameIndex, end: close,
      bodyStart: open + 1, bodyEnd: close - 1 });
    for (let part = index; part <= open; part++) headers.add(part);
    index = open;
  }
  for (const declaration of declarations) {
    declaration.parent = narrowestOwner(declarations.filter((other) => other !== declaration), declaration.start);
  }
  const owners = ownersByToken(tokens, declarations);
  const functions = new Map<string, NativeDeclaration[]>();
  for (const declaration of declarations) {
    const key = declaration.name.toLowerCase();
    const group = functions.get(key) ?? [];
    group.push(declaration);
    functions.set(key, group);
  }

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (headers.has(index)) continue;
    const owner = owners[index];
    if (token.text.toLowerCase() === 'param' && tokens[index + 1]?.text === '(') {
      const close = scan.pairs.get(index + 1);
      if (close !== undefined) {
        for (let part = index + 2; part < close; part++) {
          const parameter = tokens[part];
          if (!parameter || !/^\$[_\p{ID_Start}][_\p{ID_Continue}]*$/u.test(parameter.text)) continue;
          declarations.push({ kind: 'parameter', name: parameter.text.slice(1),
            start: part, end: part, parent: owner });
        }
      }
      continue;
    }
    if (/^\$[_\p{ID_Start}][_\p{ID_Continue}]*$/u.test(token.text) && tokens[index + 1]?.text === '=' &&
        commandStart(tokens, index, source)) {
      declarations.push({ kind: 'variable', name: token.text.slice(1),
        start: index, end: index, parent: owner });
      continue;
    }
    if (!commandStart(tokens, index, source)) continue;
    if (token.text === '.' || token.text === '&') {
      const tail = statementTail(source, token.end.offset);
      const target = staticPath(tail);
      if (target) references.push({ owner, token, name: target, kind: 'imports' });
      continue;
    }
    const name = commandName(tokens, index);
    if (!name || CONTROL.has(name.toLowerCase())) continue;
    const tail = statementTail(source, token.start.offset + name.length);
    if (name.toLowerCase() === 'import-module') {
      const target = staticPath(tail);
      if (target) references.push({ owner, token, name: target, kind: 'imports' });
      continue;
    }
    if (name.toLowerCase() === 'export-modulemember') {
      const names = /-Function\s+([\w-]+(?:\s*,\s*[\w-]+)*)/i.exec(tail)?.[1];
      for (const item of names?.split(/\s*,\s*/) ?? []) {
        const matches = functions.get(item.toLowerCase());
        if (matches?.length === 1) matches[0]!.exported = true;
      }
      continue;
    }
    const matches = functions.get(name.toLowerCase());
    if (matches?.length === 1) references.push({ owner, token, name,
      kind: 'calls', directTarget: matches[0] });
    else if (!matches && name.includes('-')) references.push({ owner, token, name, kind: 'calls' });
  }

  // Manifest data files carry static key/value declarations but no executable
  // calls. A module path is an import only when it is explicitly relative.
  if (filePath.toLowerCase().endsWith('.psd1')) {
    for (let index = 0; index < tokens.length - 2; index++) {
      const token = tokens[index]!;
      if (token.kind !== 'identifier' || tokens[index + 1]?.text !== '=' ||
          !commandStart(tokens, index, source)) continue;
      declarations.push({ kind: 'constant', name: token.text, start: index, end: index });
      if (token.text.toLowerCase() === 'rootmodule') {
        const tail = statementTail(source, tokens[index + 1]!.end.offset);
        const target = staticPath(tail);
        if (target) references.push({ token, name: target, kind: 'imports' });
      }
    }
  }

  const result = finishDynamicFacts(filePath, source, 'powershell', scan, declarations, references, started);
  for (const edge of result.edges) {
    if (edge.kind === 'references' && edge.metadata?.valueRef === true) edge.kind = 'calls';
  }
  for (const node of result.nodes) {
    if (node.isExported) result.edges.push({ source: `file:${filePath}`, target: node.id, kind: 'exports' });
  }
  return result;
}
