import type { UnresolvedReference } from '../../types';
import {
  finishDynamicFacts,
  type NativeDeclaration,
  type NativeReference,
  tokenText,
  unquote,
} from './dynamic-fact-builder';
import { scanSource, type NativeScanResult, type NativeToken } from './scanner';

const PREDEFINED_MACROS = new Set([
  'MODULE', 'MODULE_STRING', 'FILE', 'LINE', 'MACHINE',
  'FUNCTION_NAME', 'FUNCTION_ARITY', 'OTP_RELEASE',
  'FEATURE_AVAILABLE', 'FEATURE_ENABLED',
]);

const MFA_CALLS = new Set([
  'spawn', 'spawn_link', 'spawn_monitor', 'spawn_opt', 'apply',
  'erlang:spawn', 'erlang:spawn_link', 'erlang:spawn_monitor', 'erlang:spawn_opt', 'erlang:apply',
  'proc_lib:spawn', 'proc_lib:spawn_link', 'proc_lib:spawn_opt', 'proc_lib:start', 'proc_lib:start_link',
  'timer:apply_after', 'timer:apply_interval',
  'rpc:call', 'rpc:cast', 'rpc:async_call',
  'erpc:call', 'erpc:cast',
]);

const NON_CALL_ATOMS = new Set([
  'after', 'begin', 'case', 'catch', 'cond', 'end', 'fun', 'if', 'maybe',
  'of', 'receive', 'try', 'when',
]);

interface Form {
  readonly start: number;
  readonly end: number;
  readonly indexes: readonly number[];
}

function atom(token: NativeToken | undefined): string | null {
  if (!token) return null;
  if (token.kind === 'identifier' && /^[a-z]/u.test(token.text)) return token.text;
  if (token.kind === 'string' && token.text.startsWith("'")) return unquote(token.text).replace(/''/g, "'");
  return null;
}

function significant(tokens: readonly NativeToken[], start: number, end: number): number[] {
  const out: number[] = [];
  for (let index = start; index <= end; index += 1) {
    if (tokens[index]?.kind !== 'comment') out.push(index);
  }
  return out;
}

function forms(scan: NativeScanResult, source: string): Form[] {
  const tokens = scan.tokens;
  const result: Form[] = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    const text = tokens[index]!.text;
    if (text === '(' || text === '[' || text === '{') depth += 1;
    else if (text === ')' || text === ']' || text === '}') depth = Math.max(0, depth - 1);
    if (text !== '.' || depth !== 0) continue;
    let indexes = significant(tokens, start, index);
    if (start === 0 && source.startsWith('#!')) indexes = indexes.filter((item) => tokens[item]!.start.line > 1);
    if (indexes.length > 0) result.push({ start: indexes[0]!, end: index, indexes });
    start = index + 1;
  }
  if (start < tokens.length) {
    let indexes = significant(tokens, start, tokens.length - 1);
    if (start === 0 && source.startsWith('#!')) indexes = indexes.filter((item) => tokens[item]!.start.line > 1);
    if (indexes.length > 0) result.push({ start: indexes[0]!, end: tokens.length - 1, indexes });
  }
  return result;
}

function pair(scan: NativeScanResult, index: number): number | undefined {
  const value = scan.pairs.get(index);
  return value !== undefined && value > index ? value : undefined;
}

function topLevelSegments(
  tokens: readonly NativeToken[],
  scan: NativeScanResult,
  open: number,
  close: number
): number[][] {
  const parts: number[][] = [];
  let part: number[] = [];
  let binaryDepth = 0;
  for (let index = open + 1; index < close; index += 1) {
    const end = pair(scan, index);
    if (tokens[index]?.text === '<<') binaryDepth += 1;
    else if (tokens[index]?.text === '>>') binaryDepth = Math.max(0, binaryDepth - 1);
    if (tokens[index]?.text === ',' && binaryDepth === 0) {
      parts.push(part);
      part = [];
      continue;
    }
    part.push(index);
    if (end !== undefined) {
      for (let nested = index + 1; nested <= end; nested += 1) part.push(nested);
      index = end;
    }
  }
  if (part.length > 0 || parts.length > 0) parts.push(part);
  return parts;
}

function arity(tokens: readonly NativeToken[], scan: NativeScanResult, open: number): number {
  const close = pair(scan, open);
  if (close === undefined || close === open + 1) return 0;
  return topLevelSegments(tokens, scan, open, close).filter((part) => part.length > 0).length;
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function precedingDoc(source: string, line: number): string | undefined {
  const lines = source.split(/\r?\n/);
  const found: string[] = [];
  for (let index = line - 2; index >= 0; index -= 1) {
    const match = /^\s*%%?\s?(.*)$/.exec(lines[index] ?? '');
    if (!match) break;
    found.unshift(match[1] ?? '');
  }
  const text = found.join('\n').trim();
  return text || undefined;
}

function staticListArity(tokens: readonly NativeToken[], scan: NativeScanResult, indexes: readonly number[]): number | null {
  const open = indexes.find((index) => tokens[index]?.text === '[');
  if (open === undefined) return null;
  const close = pair(scan, open);
  if (close === undefined || !indexes.includes(close)) return null;
  return arity(tokens, scan, open);
}

function functionHeads(tokens: readonly NativeToken[], scan: NativeScanResult, form: Form): Set<number> {
  const heads = new Set<number>();
  for (const index of form.indexes) {
    if (!atom(tokens[index]) || tokens[index + 1]?.text !== '(') continue;
    const close = pair(scan, index + 1);
    if (close === undefined || close > form.end) continue;
    let previous: number | undefined;
    for (const item of form.indexes) {
      if (item >= index) break;
      previous = item;
    }
    if (index !== form.indexes[0] && tokens[previous ?? -1]?.text !== ';') continue;
    let cursor = close + 1;
    while (cursor <= form.end && tokens[cursor]?.kind === 'comment') cursor += 1;
    while (cursor <= form.end && tokens[cursor]?.text !== '->' && tokens[cursor]?.text !== ';' && tokens[cursor]?.text !== '.') cursor += 1;
    if (tokens[cursor]?.text === '->') heads.add(index);
  }
  return heads;
}

function addReference(
  references: NativeReference[], owner: NativeDeclaration | undefined,
  token: NativeToken | undefined, name: string | null, kind: UnresolvedReference['referenceKind']
): void {
  if (token && name) references.push({ owner, token, name, kind });
}

function scanRelationships(
  tokens: readonly NativeToken[], scan: NativeScanResult, start: number, end: number,
  owner: NativeDeclaration | undefined, references: NativeReference[], moduleName: string | null,
  selfMacros: ReadonlySet<string>, atomMacros: ReadonlyMap<string, string>, heads = new Set<number>()
): void {
  for (let index = start; index <= end; index += 1) {
    const current = tokens[index];
    if (!current || current.kind === 'comment' || current.kind === 'string' && !current.text.startsWith("'")) continue;

    if (current.text === '?' && tokens[index + 1]?.kind === 'identifier') {
      const nameToken = tokens[index + 1]!;
      const name = nameToken.text;
      if (!PREDEFINED_MACROS.has(name)) {
        addReference(references, owner, nameToken, name, tokens[index + 2]?.text === '(' ? 'calls' : 'references');
      }
      continue;
    }

    if (current.text === '#' && atom(tokens[index + 1])) {
      addReference(references, owner, tokens[index + 1], atom(tokens[index + 1]), 'references');
      continue;
    }

    if (current.text === 'fun') {
      let cursor = index + 1;
      const first = atom(tokens[cursor]);
      if (!first) continue;
      let name = first;
      if (tokens[cursor + 1]?.text === ':' && atom(tokens[cursor + 2])) {
        name = `${first}::${atom(tokens[cursor + 2])}`;
        cursor += 2;
      }
      if (tokens[cursor + 1]?.text === '/' && /^\d+$/u.test(tokens[cursor + 2]?.text ?? '')) {
        addReference(references, owner, tokens[index + 1], `${name}/${tokens[cursor + 2]!.text}`, 'references');
      }
      continue;
    }

    const fn = atom(current);
    if (!fn || NON_CALL_ATOMS.has(fn) || tokens[index + 1]?.text !== '(' || heads.has(index)) continue;
    const close = pair(scan, index + 1);
    if (close === undefined || close > end) continue;
    const previous = tokens[index - 1]?.text;
    if (previous === 'fun') continue;
    let module: string | null = null;
    let localModule = false;
    if (previous === ':') {
      module = atom(tokens[index - 2]);
      localModule = tokens[index - 3]?.text === '?' && tokens[index - 2]?.text === 'MODULE';
      if (!module && !localModule) continue;
    }
    // A capitalized variable/function value is dynamic and intentionally silent.
    if (!module && !localModule && !atom(current)) continue;
    const count = arity(tokens, scan, index + 1);
    const referenceName = module ? `${module}::${fn}/${count}` : `${fn}/${count}`;
    addReference(references, owner, current, referenceName, 'calls');

    const args = topLevelSegments(tokens, scan, index + 1, close);
    const family = module ? `${module}:${fn}` : fn;
    if (MFA_CALLS.has(family)) {
      for (let part = 0; part + 2 < args.length; part += 1) {
        const moduleArg = args[part]!;
        const functionArg = args[part + 1]!;
        const targetModule = atom(tokens[moduleArg[0]!]);
        const moduleMacro = tokens[moduleArg[0]!]?.text === '?' && tokens[moduleArg[1]!]?.text === 'MODULE';
        const targetFunction = atom(tokens[functionArg[0]!]);
        if ((!targetModule && !moduleMacro) || !targetFunction) continue;
        const targetArity = staticListArity(tokens, scan, args[part + 2]!);
        const suffix = targetArity === null ? '' : `/${targetArity}`;
        addReference(references, owner, tokens[functionArg[0]!], moduleMacro ? `${targetFunction}${suffix}` : `${targetModule}::${targetFunction}${suffix}`, 'calls');
        break;
      }
    }

    if (module === 'gen_server' && (fn === 'call' || fn === 'cast') && args[0]) {
      const target = args[0];
      let server = atom(tokens[target[0]!]);
      if (tokens[target[0]!]?.text === '?' && tokens[target[1]!]?.kind === 'identifier') {
        const macro = tokens[target[1]!]!.text;
        if (macro === 'MODULE' || selfMacros.has(macro)) server = moduleName;
        else server = atomMacros.get(macro) ?? null;
      }
      if (server) addReference(references, owner, tokens[target[0]!], `${server}::${fn === 'call' ? 'handle_call/3' : 'handle_cast/2'}`, 'calls');
    }
  }
}

/** Bounded Afyx-native Erlang semantic facts. */
export function extractNativeErlangFacts(filePath: string, source: string) {
  const started = Date.now();
  const scan = scanSource(source, { hashComments: false, erlangSyntax: true });
  const tokens = scan.tokens;
  const sourceForms = forms(scan, source);
  const declarations: NativeDeclaration[] = [];
  const references: NativeReference[] = [];
  const exported = new Set<string>();
  const specs = new Map<string, { signature: string; line: number }>();
  const selfMacros = new Set<string>();
  const atomMacros = new Map<string, string>();
  let exportAll = false;
  let moduleName: string | null = null;
  let namespace: NativeDeclaration | undefined;

  for (const form of sourceForms) {
    const indexes = form.indexes;
    if (tokens[indexes[0]!]?.text !== '-' || tokens[indexes[1]!]?.kind !== 'identifier') continue;
    const attribute = tokens[indexes[1]!]!.text;
    const open = indexes.find((index) => tokens[index]?.text === '(');
    const close = open === undefined ? undefined : pair(scan, open);
    const args = open === undefined || close === undefined ? [] : topLevelSegments(tokens, scan, open, close);
    if (attribute === 'module') {
      if (open === undefined || close === undefined) continue;
      const nameIndex = args[0]?.[0];
      moduleName = atom(tokens[nameIndex ?? -1]);
      if (moduleName && nameIndex !== undefined) {
        namespace = { kind: 'namespace', name: moduleName, start: nameIndex, end: close, bodyStart: close, bodyEnd: Math.max(close, tokens.length - 1) };
        declarations.push(namespace);
      }
    } else if (attribute === 'export') {
      if (open === undefined || close === undefined) continue;
      const listOpen = args[0]?.find((index) => tokens[index]?.text === '[');
      const listClose = listOpen === undefined ? undefined : pair(scan, listOpen);
      if (listOpen !== undefined && listClose !== undefined) {
        for (let index = listOpen + 1; index + 2 < listClose; index += 1) {
          const name = atom(tokens[index]);
          if (name && tokens[index + 1]?.text === '/' && /^\d+$/u.test(tokens[index + 2]?.text ?? '')) exported.add(`${name}/${tokens[index + 2]!.text}`);
        }
      }
    } else if (attribute === 'compile') {
      if (indexes.some((index) => tokens[index]?.text === 'export_all')) exportAll = true;
    } else if (attribute === 'spec') {
      const nameIndex = indexes[2]!;
      const name = atom(tokens[nameIndex]);
      const argOpen = tokens[nameIndex + 1]?.text === '(' ? nameIndex + 1 : -1;
      if (name && argOpen >= 0) specs.set(`${name}/${arity(tokens, scan, argOpen)}`, {
        signature: collapse(tokenText(source, tokens, form.start, form.end)).slice(0, 300),
        line: tokens[form.start]!.start.line,
      });
    } else if (attribute === 'record') {
      if (open === undefined || close === undefined) continue;
      const nameIndex = args[0]?.[0];
      const name = atom(tokens[nameIndex ?? -1]);
      if (!name || nameIndex === undefined) continue;
      const record: NativeDeclaration = {
        kind: 'struct', name, start: nameIndex, end: close, parent: namespace,
        signature: collapse(tokenText(source, tokens, form.start, form.end)).slice(0, 300),
        docstring: precedingDoc(source, tokens[form.start]!.start.line),
      };
      declarations.push(record);
      const fieldOpen = args[1]?.find((index) => tokens[index]?.text === '{');
      const fieldClose = fieldOpen === undefined ? undefined : pair(scan, fieldOpen);
      if (fieldOpen !== undefined && fieldClose !== undefined) {
        for (const field of topLevelSegments(tokens, scan, fieldOpen, fieldClose)) {
          const fieldIndex = field.find((index) => atom(tokens[index]) !== null);
          const fieldName = atom(tokens[fieldIndex ?? -1]);
          if (fieldName && fieldIndex !== undefined) declarations.push({ kind: 'field', name: fieldName, start: fieldIndex, end: field.at(-1) ?? fieldIndex, parent: record });
        }
      }
    } else if (attribute === 'type' || attribute === 'opaque') {
      const nameIndex = indexes[2]!;
      const name = atom(tokens[nameIndex]);
      if (name) declarations.push({ kind: 'type_alias', name, start: nameIndex, end: form.end, parent: namespace, signature: collapse(tokenText(source, tokens, form.start, form.end)).slice(0, 200) });
    } else if (attribute === 'define') {
      if (open === undefined || close === undefined) continue;
      const nameIndex = args[0]?.find((index) => tokens[index]?.kind === 'identifier' || tokens[index]?.text.startsWith("'"));
      const name = nameIndex === undefined ? null : unquote(tokens[nameIndex]!.text);
      if (!name || nameIndex === undefined) continue;
      const macro: NativeDeclaration = { kind: 'constant', name, start: nameIndex, end: close, parent: namespace, signature: collapse(tokenText(source, tokens, form.start, form.end)).slice(0, 200) };
      declarations.push(macro);
      const replacement = args[1] ?? [];
      if (replacement.length > 0) {
        if (replacement.length === 2 && tokens[replacement[0]!]?.text === '?' && tokens[replacement[1]!]?.text === 'MODULE') selfMacros.add(name);
        const replacementAtom = replacement.length === 1 ? atom(tokens[replacement[0]!]) : null;
        if (replacementAtom) atomMacros.set(name, replacementAtom);
        scanRelationships(tokens, scan, replacement[0]!, replacement.at(-1)!, macro, references, moduleName, selfMacros, atomMacros);
      }
    } else if (attribute === 'behaviour' || attribute === 'behavior') {
      if (open === undefined || close === undefined) continue;
      const nameIndex = args[0]?.[0];
      addReference(references, namespace, tokens[nameIndex ?? -1], atom(tokens[nameIndex ?? -1]), 'implements');
    } else if (attribute === 'import' || attribute === 'include' || attribute === 'include_lib') {
      if (open === undefined || close === undefined) continue;
      const nameIndex = args[0]?.[0];
      const name = attribute === 'import' ? atom(tokens[nameIndex ?? -1]) : unquote(tokens[nameIndex ?? -1]?.text ?? '');
      if (name && nameIndex !== undefined) {
        declarations.push({ kind: 'import', name, start: nameIndex, end: close, parent: namespace, signature: collapse(tokenText(source, tokens, form.start, form.end)).slice(0, 200) });
        addReference(references, namespace, tokens[nameIndex], name, 'imports');
      }
    }
  }

  // Application resource files are Erlang terms rather than module forms.
  if (/\.app(?:\.src)?$/iu.test(filePath)) {
    const callback = /\{\s*mod\s*,\s*\{\s*([a-z][\w@]*|'(?:''|[^'])+')/u.exec(source)?.[1];
    if (callback) addReference(references, undefined, tokens[0], unquote(callback), 'references');
    for (const match of source.matchAll(/\{\s*(?:applications|included_applications)\s*,\s*\[([^\]]*)\]/gu)) {
      for (const item of (match[1] ?? '').split(',')) {
        const name = item.trim();
        if (/^(?:[a-z][\w@]*|'(?:''|[^'])+')$/u.test(name)) addReference(references, undefined, tokens[0], unquote(name), 'imports');
      }
    }
  }

  for (const form of sourceForms) {
    const head = form.indexes[0]!;
    const name = atom(tokens[head]);
    if (!name || tokens[head + 1]?.text !== '(') continue;
    const close = pair(scan, head + 1);
    if (close === undefined) continue;
    let arrow = close + 1;
    while (arrow <= form.end && tokens[arrow]?.text !== '->' && tokens[arrow]?.text !== '.') arrow += 1;
    if (tokens[arrow]?.text !== '->') continue;
    const fnArity = arity(tokens, scan, head + 1);
    const key = `${name}/${fnArity}`;
    const spec = specs.get(key);
    const fn: NativeDeclaration = {
      kind: 'function', name, start: head, end: form.end, bodyStart: arrow + 1, bodyEnd: form.end,
      parent: namespace, qualifiedSuffix: `/${fnArity}`,
      exported: exportAll || exported.has(key),
      signature: spec?.signature ?? collapse(tokenText(source, tokens, head, arrow - 1)).slice(0, 300),
      docstring: precedingDoc(source, spec?.line ?? tokens[head]!.start.line),
    };
    declarations.push(fn);
    scanRelationships(tokens, scan, head, form.end, fn, references, moduleName, selfMacros, atomMacros, functionHeads(tokens, scan, form));
  }

  return finishDynamicFacts(filePath, source, 'erlang', scan, declarations, references, started);
}
