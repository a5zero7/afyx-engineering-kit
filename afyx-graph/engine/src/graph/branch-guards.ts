import * as fs from 'fs';
import type { Language } from '../types';
import { supportsBranchGuards, type BranchGuard } from './branch-guard-policy';
import {
  createNativeBranchGuardReader,
  nativeGuardsInSource,
  supportsNativeBranchGuards,
} from './native-branch-guards';

export {
  BRANCH_GUARD_LANGUAGES,
  guardLabel,
  supportsBranchGuards,
  type BranchGuard,
  type GuardExit,
  type GuardForm,
} from './branch-guard-policy';

export const MAX_PARSE_BYTES = 256 * 1024;
const JS_FAMILY: ReadonlySet<Language> = new Set(['typescript', 'javascript', 'tsx', 'jsx']);

export interface CallSite {
  line: number;
  column?: number | null;
  callee?: string;
}

export interface CallSiteText {
  callee: string;
  args: string;
  argList: string[];
  status?: number;
  span?: { start: { line: number; column: number }; end: { line: number; column: number } };
  within?: string;
}

export interface SiteTrigger {
  kind: 'prop' | 'option' | 'callback' | 'request' | 'decorator' | 'load';
  name: string;
  of: string | null;
  after?: string[];
}

export interface SiteLoop {
  text: string;
  kind: 'each' | 'while';
  branch: string;
}

export interface DefinitionDecorators {
  own: string[];
  class: string[];
}

export function siteKey(site: CallSite): string {
  return `${site.line}:${typeof site.column === 'number' ? site.column : ''}${site.callee ? `:${site.callee}` : ''}`;
}

function sourceOffset(source: string, line: number, column: number | null | undefined): number {
  if (line < 1) return -1;
  const lines = source.split('\n');
  if (line > lines.length) return -1;
  let offset = 0;
  for (let index = 1; index < line; index++) offset += lines[index - 1]!.length + 1;
  const text = lines[line - 1] ?? '';
  const resolved = column ?? Math.max(0, text.search(/\S/));
  return offset + Math.max(0, resolved);
}

function positionAt(source: string, offset: number): { line: number; column: number } {
  const prefix = source.slice(0, offset);
  const lines = prefix.split('\n');
  return { line: lines.length, column: lines.at(-1)?.length ?? 0 };
}

function readBounded(absPath: string): string | null {
  try {
    if (fs.statSync(absPath).size > MAX_PARSE_BYTES) return null;
    return fs.readFileSync(absPath, 'utf8');
  } catch {
    return null;
  }
}

export async function guardsForFile(
  absPath: string,
  language: Language,
  sites: readonly CallSite[]
): Promise<Map<string, BranchGuard[]>> {
  return guardsForFileSync(absPath, language, sites);
}

export function guardsForFileSync(
  absPath: string,
  language: Language,
  sites: readonly CallSite[]
): Map<string, BranchGuard[]> {
  const out = new Map<string, BranchGuard[]>();
  if (!supportsNativeBranchGuards(language)) return out;
  const source = readBounded(absPath);
  if (source === null) return out;
  const reader = createNativeBranchGuardReader(source, language);
  for (const site of sites) {
    const key = siteKey(site);
    if (!out.has(key)) out.set(key, reader(site.line, site.column ?? null));
  }
  return out;
}

export async function guardsInSource(
  source: string,
  language: Language,
  line: number,
  column: number | null = null
): Promise<BranchGuard[]> {
  return supportsNativeBranchGuards(language)
    ? nativeGuardsInSource(source, language, line, column)
    : [];
}

/** Native readers have no grammar warm-up; retained as a compatibility no-op. */
export async function warmBranchGuardGrammars(_only?: readonly Language[]): Promise<void> {}

interface RawCall {
  callee: string;
  start: number;
  open: number;
  close: number;
  argsStart: number;
  argsEnd: number;
}

function matching(source: string, start: number, open: string, close: string): number {
  let depth = 0;
  let quote: string | null = null;
  for (let index = start; index < source.length; index++) {
    const ch = source[index]!;
    if (quote) {
      if (ch === '\\') index++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '/' && source[index + 1] === '/') {
      index = source.indexOf('\n', index);
      if (index < 0) return -1;
      continue;
    }
    if (ch === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2);
      if (end < 0) return -1;
      index = end + 1;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close && --depth === 0) return index;
  }
  return -1;
}

function callsIn(source: string): RawCall[] {
  const out: RawCall[] = [];
  const pattern = /\b(?:new\s+)?[A-Za-z_$][\w$]*(?:\s*(?:\?\.)?\.\s*[A-Za-z_$][\w$]*|\s*\([^()]*\)\s*\.\s*[A-Za-z_$][\w$]*)*\s*\(/g;
  for (const match of source.matchAll(pattern)) {
    if (match.index === undefined) continue;
    const open = match.index + match[0].lastIndexOf('(');
    const close = matching(source, open, '(', ')');
    if (close < 0) continue;
    let callee = match[0].slice(0, match[0].lastIndexOf('(')).trim();
    if (/^(?:if|for|while|switch|catch|function|func|def|sizeof)\b/.test(callee)) continue;
    // Keep arguments of inner calls in a chain. They are part of the observable
    // site (`res.status(201).json`, `ResponseEntity.status(CREATED).body`) and
    // carry response semantics; only the outer call's arguments live in `args`.
    callee = callee.replace(/^new\s+/, '').replace(/\?\./g, '.').replace(/\s+/g, '');
    out.push({ callee, start: match.index, open, close, argsStart: open + 1, argsEnd: close });
  }
  return out;
}

function splitTopLevel(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  let round = 0;
  let square = 0;
  let curly = 0;
  let quote: string | null = null;
  for (let index = 0; index < text.length; index++) {
    const ch = text[index]!;
    if (quote) {
      if (ch === '\\') index++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '(') round++;
    else if (ch === ')') round--;
    else if (ch === '[') square++;
    else if (ch === ']') square--;
    else if (ch === '{') curly++;
    else if (ch === '}') curly--;
    else if (ch === ',' && round === 0 && square === 0 && curly === 0) {
      out.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  const tail = text.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

function cut(text: string, limit: number): string {
  return text.length <= limit ? text : text.slice(0, limit - 1).trimEnd() + '…';
}

function objectSummary(text: string): string {
  const inner = text.trim().replace(/^\{/, '').replace(/\}$/, '');
  const keys: string[] = [];
  for (const part of splitTopLevel(inner)) {
    const spread = /^\.\.\.\s*([\w$.]+)/.exec(part);
    if (spread) keys.push(`...${spread[1]}`);
    else {
      const match = /^([A-Za-z_$][\w$]*|["'][^"']+["'])\s*(?::|$)/.exec(part);
      if (match) keys.push(match[1]!);
    }
    if (keys.length === 4) break;
  }
  const more = splitTopLevel(inner).length > keys.length;
  return keys.length ? `{ ${keys.join(', ')}${more ? ', …' : ''} }` : '{…}';
}

function summarizeArgument(raw: string): string {
  const text = raw.replace(/\s+/g, ' ').trim();
  const label = /^([A-Za-z_$][\w$]*\s*[:=]\s*)([\s\S]+)$/.exec(text);
  if (label && !text.startsWith('{')) return label[1] + summarizeArgument(label[2]!);
  if (/^(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(text)) return '() => …';
  if (/^\{[\s\S]*\}$/.test(text)) return objectSummary(text);
  if (/^\[[\s\S]*\]$/.test(text)) return '[…]';
  if (/^[A-Za-z_$][\w$.<>]*\s*\{[\s\S]*\}$/.test(text)) return text.replace(/\{[\s\S]*\}$/, '{…}');
  if (/^new\s+[A-Za-z_$][\w$.]*\s*\(/.test(text)) return text.replace(/\([\s\S]*$/, '(…)');
  if (/^[A-Za-z_$][\w$.]*(?:\([^)]*\)\.)*[A-Za-z_$]*\s*\(/.test(text)) {
    return text.replace(/\([\s\S]*$/, '(…)');
  }
  return cut(text, 40);
}

function callAt(source: string, line: number, column: number | null, want?: string): CallSiteText | null {
  const offset = sourceOffset(source, line, column);
  if (offset < 0) return null;
  const calls = callsIn(source);
  const candidates = calls.filter((call) =>
    (offset >= call.start && offset <= call.close) || (offset >= call.start - 4 && offset <= call.open)
  );
  const wanted = want?.replace(/\([^()]*\)/g, '').split('.').at(-1);
  let call = candidates
    .filter((candidate) => !wanted || candidate.callee.replace(/\([^()]*\)/g, '').split('.').at(-1) === wanted)
    .sort((left, right) => (left.close - left.start) - (right.close - right.start))[0];
  if (!call) {
    call = calls
      .filter((candidate) => candidate.start >= offset && candidate.start - offset < 8)
      .sort((left, right) => left.start - right.start)[0];
  }
  if (!call) {
    const tail = source.slice(offset, Math.min(source.length, offset + 160));
    const trailing = /^(?:new\s+)?([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\{/.exec(tail);
    if (!trailing) return null;
    const open = offset + trailing[0].lastIndexOf('{');
    const close = matching(source, open, '{', '}');
    if (close < 0) return null;
    return {
      callee: trailing[1]!,
      args: '{ … }',
      argList: ['{ … }'],
      span: { start: positionAt(source, offset), end: positionAt(source, close + 1) },
    };
  }
  const rawArgs = source.slice(call.argsStart, call.argsEnd);
  const argList = splitTopLevel(rawArgs).map(summarizeArgument);
  const parent = calls
    .filter((candidate) => candidate.start < call!.start && candidate.argsStart <= call!.start && candidate.argsEnd >= call!.close)
    .sort((left, right) => (left.close - left.start) - (right.close - right.start))[0];
  const objectStatus = /\bstatus\s*:\s*(\d{3})\b/.exec(rawArgs);
  return {
    callee: call.callee,
    args: cut(argList.join(', '), 96),
    argList,
    ...(objectStatus ? { status: Number(objectStatus[1]) } : {}),
    span: { start: positionAt(source, call.start), end: positionAt(source, call.close + 1) },
    ...(parent ? { within: parent.callee } : {}),
  };
}

export async function callSiteInSource(
  source: string,
  language: Language,
  line: number,
  column: number | null,
  want?: string
): Promise<CallSiteText | null> {
  return supportsBranchGuards(language) ? callAt(source, line, column, want) : null;
}

export async function callArgumentsInSource(
  source: string,
  language: Language,
  line: number,
  column: number | null
): Promise<string | null> {
  return (await callSiteInSource(source, language, line, column))?.args ?? null;
}

async function mapFile<T>(
  absPath: string,
  sites: readonly CallSite[],
  reader: (source: string, site: CallSite) => T | null
): Promise<Map<string, T>> {
  const out = new Map<string, T>();
  const source = readBounded(absPath);
  if (source === null) return out;
  for (const site of sites) {
    const value = reader(source, site);
    if (value !== null) out.set(siteKey(site), value);
  }
  return out;
}

export async function callSitesForFile(
  absPath: string,
  language: Language,
  sites: readonly CallSite[]
): Promise<Map<string, CallSiteText>> {
  if (!supportsBranchGuards(language)) return new Map();
  return mapFile(absPath, sites, (source, site) =>
    callAt(source, site.line, site.column ?? null, site.callee));
}

export async function callArgumentsForFile(
  absPath: string,
  language: Language,
  sites: readonly CallSite[]
): Promise<Map<string, string>> {
  if (!supportsBranchGuards(language)) return new Map();
  return mapFile(absPath, sites, (source, site) =>
    callAt(source, site.line, site.column ?? null, site.callee)?.args ?? null);
}

const LATER_CALLEES = new Set([
  'useEffect', 'useLayoutEffect', 'useFocusEffect', 'useImperativeHandle',
  'setTimeout', 'setInterval', 'requestAnimationFrame', 'requestIdleCallback',
  'runAfterInteractions', 'addListener', 'addEventListener', 'on', 'once',
  'subscribe', 'then', 'catch', 'finally', 'runOnJS', 'runOnUI', 'scheduleOnRN',
]);

function triggerAt(source: string, line: number, column: number | null): SiteTrigger | null {
  const offset = sourceOffset(source, line, column);
  if (offset < 0) return null;
  const lineStart = source.lastIndexOf('\n', offset - 1) + 1;
  const nextLine = source.indexOf('\n', offset);
  const lineEnd = nextLine < 0 ? source.length : nextLine;
  const sourceLine = source.slice(lineStart, lineEnd);
  const localOffset = offset - lineStart;
  const tagLine = /<([A-Za-z_$][\w$.-]*)(.*)\/?\s*>/.exec(sourceLine);
  if (tagLine) {
    const opens = [...sourceLine.slice(0, localOffset + 1).matchAll(/([A-Za-z_$][\w$-]*)\s*=\s*\{/g)];
    const active = opens.at(-1);
    if (active?.index !== undefined) {
      const valueStart = active.index + active[0].length;
      const valueEnd = sourceLine.indexOf('}', Math.max(valueStart, localOffset));
      if (valueEnd >= localOffset) {
        const name = active[1]!;
        const value = sourceLine.slice(valueStart, valueEnd);
        const deferred = /^on[A-Z]/.test(name) || /=>|\bfunction\b/.test(value);
        return deferred ? { kind: 'prop', name, of: tagLine[1]! } : null;
      }
    }
    const attrs = tagLine[2] ?? '';
    const attrsStart = sourceLine.indexOf(attrs);
    const attrPattern = /([A-Za-z_$][\w$-]*)\s*=\s*\{([\s\S]*?)\}(?=\s+[A-Za-z_$]|\s*\/?>)/g;
    for (const attr of attrs.matchAll(attrPattern)) {
      if (attr.index === undefined) continue;
      const start = attrsStart + attr.index;
      const end = start + attr[0].length;
      if (localOffset < start || localOffset > end) continue;
      const name = attr[1]!;
      const deferred = /^on[A-Z]/.test(name) || /=>|\bfunction\b/.test(attr[2] ?? '');
      return deferred ? { kind: 'prop', name, of: tagLine[1]! } : null;
    }
  }
  const tagPattern = /<([A-Za-z_$][\w$.-]*)([^<>]*?)\/?\s*>/gs;
  for (const match of source.matchAll(tagPattern)) {
    if (match.index === undefined || offset < match.index || offset > match.index + match[0].length) continue;
    const attrs = match[2] ?? '';
    const attrsStart = match.index + match[0].indexOf(attrs);
    const attrPattern = /([A-Za-z_$][\w$-]*)\s*=\s*\{([\s\S]*?)\}/g;
    for (const attr of attrs.matchAll(attrPattern)) {
      if (attr.index === undefined) continue;
      const start = attrsStart + attr.index;
      const end = start + attr[0].length;
      if (offset < start || offset > end) continue;
      const name = attr[1]!;
      const value = attr[2] ?? '';
      const deferred = /^on[A-Z]/.test(name) || /=>|\bfunction\b/.test(value);
      return deferred ? { kind: 'prop', name, of: match[1]! } : null;
    }
  }

  const calls = callsIn(source);
  const enclosing = calls
    .filter((call) => call.argsStart <= offset && call.argsEnd >= offset)
    .sort((a, b) => (a.close - a.start) - (b.close - b.start));
  for (const call of enclosing) {
    const name = call.callee.split('.').at(-1)!;
    if (name === 'useCallback' || name === 'useMemo' || name === 'useEffectEvent' || name === 'useEvent') return null;
    const prefix = source.slice(call.argsStart, offset);
    const option = /\b(on[A-Z][\w$]*)\s*:\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)?\s*=>[^]*$/m.exec(prefix);
    if (option) return { kind: 'option', name: option[1]!, of: call.callee };
    if (LATER_CALLEES.has(name)) {
      const first = splitTopLevel(source.slice(call.argsStart, call.argsEnd))[0]?.trim();
      return { kind: 'callback', name, of: first && /^(['"]).*\1$/s.test(first) ? first : null };
    }
  }
  return null;
}

export async function triggerInSource(
  source: string,
  language: Language,
  line: number,
  column: number | null
): Promise<SiteTrigger | null> {
  return JS_FAMILY.has(language) ? triggerAt(source, line, column) : null;
}

export async function triggersForFile(
  absPath: string,
  language: Language,
  sites: readonly CallSite[]
): Promise<Map<string, SiteTrigger>> {
  if (!JS_FAMILY.has(language)) return new Map();
  return mapFile(absPath, sites, (source, site) => triggerAt(source, site.line, site.column ?? null));
}

function loopHeaders(source: string, language: Language): Array<SiteLoop & { start: number; end: number }> {
  const out: Array<SiteLoop & { start: number; end: number }> = [];
  if (language === 'python') {
    const lines = source.split('\n');
    let base = 0;
    for (let row = 0; row < lines.length; row++) {
      const line = lines[row]!;
      const match = /^(\s*)(for\s+(.+?)\s+in\s+(.+?)|while\s+(.+?))\s*:\s*$/.exec(line);
      if (!match) { base += line.length + 1; continue; }
      const indent = match[1]!.length;
      let endRow = row + 1;
      while (endRow < lines.length) {
        const next = lines[endRow]!;
        if (next.trim() && (next.match(/^\s*/)?.[0].length ?? 0) <= indent) break;
        endRow++;
      }
      const end = lines.slice(0, endRow).reduce((sum, item) => sum + item.length + 1, 0);
      const text = match[3] ? `${match[3]} in ${match[4]}` : match[5]!;
      out.push({ kind: match[3] ? 'each' : 'while', text: cut(text, 60), branch: `${row + 1}:${indent}`, start: base + line.length + 1, end });
      base += line.length + 1;
    }
    return out;
  }
  const pattern = /\b(for|foreach|while)\b/g;
  for (const match of source.matchAll(pattern)) {
    if (match.index === undefined) continue;
    let cursor = match.index + match[0].length;
    while (/\s/.test(source[cursor] ?? '')) cursor++;
    let header = '';
    if (source[cursor] === '(') {
      const end = matching(source, cursor, '(', ')');
      if (end < 0) continue;
      header = source.slice(cursor + 1, end);
      cursor = end + 1;
    } else {
      const brace = source.indexOf('{', cursor);
      if (brace < 0 || source.slice(cursor, brace).includes('\n') && language !== 'go' && language !== 'swift' && language !== 'kotlin') continue;
      header = source.slice(cursor, brace).trim();
      cursor = brace;
    }
    while (/\s/.test(source[cursor] ?? '')) cursor++;
    if (source[cursor] !== '{') continue;
    const end = matching(source, cursor, '{', '}');
    if (end < 0) continue;
    let text = header.replace(/^(?:const|let|var|val|final)\s+/, '').trim();
    if (language === 'csharp') text = text.replace(/^var\s+/, '');
    const kind = match[1] === 'while' ? 'while' : 'each';
    const pos = positionAt(source, match.index);
    out.push({ kind, text: cut(text, 60), branch: `${pos.line}:${pos.column}`, start: cursor + 1, end });
  }
  return out;
}

export async function loopsInSource(
  source: string,
  language: Language,
  line: number,
  column: number | null = null
): Promise<SiteLoop[]> {
  if (!supportsBranchGuards(language)) return [];
  const offset = sourceOffset(source, line, column);
  return loopHeaders(source, language)
    .filter((loop) => loop.start <= offset && loop.end >= offset)
    .sort((a, b) => a.start - b.start)
    .map(({ start: _start, end: _end, ...loop }) => loop);
}

export async function loopsForFile(
  absPath: string,
  language: Language,
  sites: readonly CallSite[]
): Promise<Map<string, SiteLoop[]>> {
  const out = new Map<string, SiteLoop[]>();
  const source = readBounded(absPath);
  if (source === null || !supportsBranchGuards(language)) return out;
  for (const site of sites) out.set(siteKey(site), await loopsInSource(source, language, site.line, site.column ?? null));
  return out;
}

function leadingDecorators(lines: readonly string[], lineIndex: number, language: Language): string[] {
  const out: string[] = [];
  for (let index = lineIndex - 1; index >= 0; index--) {
    const text = lines[index]!.trim();
    if (!text) continue;
    const at = /^@(.+)$/.exec(text);
    const bracket = /^\[(.+)\]$/.exec(text);
    if (at) out.unshift(cut(at[1]!, 80));
    else if (language === 'csharp' && bracket) out.unshift(cut(bracket[1]!, 80));
    else break;
  }
  return out;
}

export async function decoratorsInSource(
  source: string,
  language: Language,
  line: number
): Promise<DefinitionDecorators | null> {
  if (!supportsBranchGuards(language)) return null;
  const lines = source.split('\n');
  if (line < 1 || line > lines.length) return null;
  let own = leadingDecorators(lines, line - 1, language);
  // Native extraction may anchor a declaration at its first decorator rather
  // than at the signature. In that case read the forward decorator stack too.
  if (/^@/.test(lines[line - 1]?.trim() ?? '')) {
    own = [];
    for (let index = line - 1; index < lines.length; index++) {
      const text = lines[index]!.trim();
      if (!text) continue;
      const at = /^@(.+)$/.exec(text);
      if (!at) break;
      own.push(cut(at[1]!, 80));
    }
  }
  let classLine = -1;
  for (let index = line - 2; index >= 0; index--) {
    if (/\b(?:class|struct|object)\s+[A-Za-z_$][\w$]*/.test(lines[index]!)) {
      classLine = index;
      break;
    }
  }
  return { own, class: classLine >= 0 ? leadingDecorators(lines, classLine, language) : [] };
}

export async function decoratorsForFile(
  absPath: string,
  language: Language,
  lines: readonly number[]
): Promise<Map<number, DefinitionDecorators>> {
  const out = new Map<number, DefinitionDecorators>();
  const source = readBounded(absPath);
  if (source === null) return out;
  for (const line of lines) {
    const value = await decoratorsInSource(source, language, line);
    if (value) out.set(line, value);
  }
  return out;
}

function addType(out: Map<string, string>, name: string, type: string): void {
  if (name && type && !['string', 'String'].includes(name)) out.set(name, type.trim());
}

export async function memberTypesInSource(
  source: string,
  language: Language,
  _line: number
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!supportsBranchGuards(language)) return out;
  if (language === 'typescript' || language === 'tsx' || language === 'javascript' || language === 'jsx') {
    for (const match of source.matchAll(/\b(?:private|public|protected)?\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$]*(?:<[^;=,)]+>)?)/g)) {
      const prefix = source.slice(Math.max(0, match.index! - 24), match.index);
      if (!/constructor[\s\S]*$/.test(prefix) && !/(?:private|public|protected|readonly)/.test(match[0])) continue;
      if (/constructor\s*\([^)]*$/.test(source.slice(0, match.index))) {
        if (!/(?:private|public|protected|readonly)/.test(match[0])) continue;
      }
      addType(out, match[1]!, match[2]!);
    }
  } else if (language === 'java') {
    for (const match of source.matchAll(/\b(?:private|public|protected)\s+(?:final\s+)?([A-Za-z_$][\w$]*(?:<[^;,)]+>)?)\s+([A-Za-z_$][\w$]*)\s*(?=[;,)=])/g)) {
      addType(out, match[2]!, match[1]!);
    }
    for (const ctor of source.matchAll(/\b(?:public|protected|private)\s+[A-Za-z_$][\w$]*\s*\(([^)]*)\)/g)) {
      for (const param of splitTopLevel(ctor[1]!)) {
        const match = /(?:final\s+)?([A-Za-z_$][\w$]*(?:<[^>]+>)?)\s+([A-Za-z_$][\w$]*)$/.exec(param.trim());
        if (match) addType(out, match[2]!, match[1]!);
      }
    }
  } else if (language === 'kotlin') {
    for (const match of source.matchAll(/\b(?:private\s+)?(?:val|var)\s+([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$]*(?:<[^>]+>)?)/g)) {
      addType(out, match[1]!, match[2]!);
    }
  } else if (language === 'csharp') {
    for (const match of source.matchAll(/\b(?:private|public|protected|internal)\s+(?:readonly\s+)?([A-Za-z_$][\w$]*(?:<[^;>{}]+>)?)\s+([A-Za-z_$][\w$]*)\s*(?=[;{])/g)) {
      addType(out, match[2]!, match[1]!);
    }
    for (const ctor of source.matchAll(/\b(?:public|protected|private|internal)\s+[A-Za-z_$][\w$]*\s*\(([^)]*)\)/g)) {
      for (const param of splitTopLevel(ctor[1]!)) {
        const match = /([A-Za-z_$][\w$]*(?:<[^>]+>)?)\s+([A-Za-z_$][\w$]*)$/.exec(param.trim());
        if (match) addType(out, match[2]!, match[1]!);
      }
    }
  }
  return out;
}

export async function memberTypesForFile(
  absPath: string,
  language: Language,
  line: number
): Promise<Map<string, string>> {
  const source = readBounded(absPath);
  return source === null ? new Map() : memberTypesInSource(source, language, line);
}
