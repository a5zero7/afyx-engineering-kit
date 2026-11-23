import type { NodeKind, UnresolvedReference } from '../../types';
import { scanSource, type NativeToken } from './scanner';
import {
  finishDynamicFacts, narrowestOwner, nextToken, tokenText, unquote,
  type NativeDeclaration, type NativeReference,
} from './dynamic-fact-builder';

const CONTAINER_KINDS = new Set<NodeKind>(['class', 'interface', 'trait', 'enum']);
const CALLABLE_KINDS = new Set<NodeKind>(['function', 'method']);
const CONTROL = new Set(['if', 'elseif', 'while', 'for', 'foreach', 'switch', 'catch', 'isset', 'empty', 'echo', 'array', 'match', 'function', 'fn']);
const VISIBILITY = new Set(['public', 'private', 'protected']);
const BUILTIN_TYPES = new Set('array bool boolean callable false float int integer iterable mixed never null object resource self static string true void'.split(' '));

function bare(text: string): string {
  return text.replace(/^\$/, '');
}

function qualified(tokens: readonly NativeToken[], start: number, end: number): string {
  const parts: string[] = [];
  for (let index = start; index < end; index += 1) {
    const token = tokens[index]!;
    if (token.kind === 'identifier') parts.push(bare(token.text));
    else if (token.text === '\\') parts.push('\\');
  }
  return parts.join('').replace(/^\\/, '');
}

function phpReferenceName(name: string): string {
  const clean = name.replace(/^\\/, '');
  const split = clean.lastIndexOf('\\');
  return split < 0 ? clean : `${clean.slice(0, split)}::${clean.slice(split + 1)}`;
}

function phpVisibility(tokens: readonly NativeToken[], start: number, end: number): 'public' | 'private' | 'protected' {
  for (let index = start; index < end; index += 1) {
    if (VISIBILITY.has(tokens[index]!.text)) return tokens[index]!.text as 'public' | 'private' | 'protected';
  }
  return 'public';
}

/** Bounded Afyx-native PHP semantic facts; default/fallback parsing remains unchanged. */
export function extractNativePhpFacts(filePath: string, source: string) {
  const started = Date.now();
  const scan = scanSource(source, { hashComments: false });
  const tokens = scan.tokens;
  const pairStart = new Map<number, number>();
  for (const [open, close] of scan.pairs) pairStart.set(close, open);
  const declarations: NativeDeclaration[] = [];
  const references: NativeReference[] = [];
  let namespace = '';

  const blockAfter = (from: number, limit = tokens.length): { open: number; close: number } | undefined => {
    for (let index = from; index < limit; index += 1) {
      if (tokens[index]!.text === ';') return undefined;
      if (tokens[index]!.text !== '{') continue;
      const close = scan.pairs.get(index);
      return close === undefined ? undefined : { open: index, close };
    }
    return undefined;
  };
  const ownerAt = (index: number, kinds?: ReadonlySet<NodeKind>) => narrowestOwner(declarations, index, kinds);
  const pushRef = (index: number, name: string, kind: UnresolvedReference['referenceKind'], owner = ownerAt(index, CALLABLE_KINDS) ?? ownerAt(index, CONTAINER_KINDS)): void => {
    const token = tokens[index];
    if (token && name) references.push({ owner, token, name, kind });
  };

  // Namespace and class-like ownership are established before members.
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index]!.text === 'namespace') {
      let end = index + 1;
      while (end < tokens.length && ![';', '{'].includes(tokens[end]!.text)) end += 1;
      namespace = qualified(tokens, index + 1, end);
      continue;
    }
    const keyword = tokens[index]!.text;
    if (!['class', 'interface', 'trait', 'enum'].includes(keyword) || tokens[index + 1]?.kind !== 'identifier') continue;
    if (tokens[index - 1]?.text === '::') continue;
    const body = blockAfter(index + 2);
    if (!body) continue;
    const kind: NodeKind = keyword === 'interface' ? 'interface' : keyword === 'trait' ? 'trait' : keyword === 'enum' ? 'enum' : 'class';
    declarations.push({ kind, name: bare(tokens[index + 1]!.text), start: index, end: body.close, bodyStart: body.open, bodyEnd: body.close, qualifiedPrefix: namespace || undefined });
  }
  for (const declaration of declarations.filter((item) => CONTAINER_KINDS.has(item.kind))) {
    declaration.parent = declarations.filter((item) => item !== declaration && CONTAINER_KINDS.has(item.kind) &&
      item.bodyStart !== undefined && item.bodyEnd !== undefined && item.bodyStart < declaration.start && item.bodyEnd >= declaration.end)
      .sort((left, right) => (left.bodyEnd! - left.bodyStart!) - (right.bodyEnd! - right.bodyStart!))[0];
  }

  // Named functions/methods plus assignment-bound anonymous and arrow functions.
  for (let index = 0; index < tokens.length; index += 1) {
    const keyword = tokens[index]!.text;
    if (keyword !== 'function' && keyword !== 'fn') continue;
    let nameIndex = index + 1;
    if (tokens[nameIndex]?.text === '&') nameIndex += 1;
    const named = tokens[nameIndex]?.kind === 'identifier' && tokens[nameIndex + 1]?.text === '(';
    const paramsStart = nextToken(tokens, named ? nameIndex + 1 : index + 1, '(');
    if (paramsStart < 0) continue;
    const paramsEnd = scan.pairs.get(paramsStart);
    if (paramsEnd === undefined) continue;
    let name = named ? bare(tokens[nameIndex]!.text) : '';
    if (!name) {
      const equals = index - 1;
      if (tokens[equals]?.text === '=' && tokens[equals - 1]?.kind === 'identifier') name = bare(tokens[equals - 1]!.text);
      else name = `<anonymous@${tokens[index]!.start.line}>`;
    }
    let bodyStart: number | undefined;
    let bodyEnd: number | undefined;
    let end = paramsEnd;
    if (keyword === 'function') {
      const body = blockAfter(paramsEnd + 1);
      if (body) { bodyStart = body.open; bodyEnd = body.close; end = body.close; }
      else end = nextToken(tokens, paramsEnd + 1, ';') >= 0 ? nextToken(tokens, paramsEnd + 1, ';') : paramsEnd;
    } else {
      const semicolon = nextToken(tokens, paramsEnd + 1, ';');
      end = semicolon < 0 ? paramsEnd : semicolon;
      bodyStart = paramsEnd;
      bodyEnd = end;
    }
    const parent = ownerAt(index, CONTAINER_KINDS);
    const headerStart = Math.max(0, index - 5);
    const colon = nextToken(tokens, paramsEnd + 1, ':', bodyStart ?? end + 1);
    const rawReturn = colon >= 0 ? tokens.slice(colon + 1, bodyStart ?? end).find((item) => item.kind === 'identifier') : undefined;
    const normalizedReturn = rawReturn ? bare(rawReturn.text) : undefined;
    const returnType = normalizedReturn && ['self', 'static', 'this'].includes(normalizedReturn.toLowerCase())
      ? 'self'
      : normalizedReturn && !BUILTIN_TYPES.has(normalizedReturn.toLowerCase()) ? normalizedReturn : undefined;
    declarations.push({
      kind: parent ? 'method' : 'function', name, start: index, end, bodyStart, bodyEnd, parent,
      qualifiedPrefix: parent ? undefined : namespace || undefined,
      signature: tokenText(source, tokens, paramsStart, colon >= 0 ? (bodyStart ?? end) - 1 : paramsEnd).trim(),
      returnType,
      visibility: parent ? phpVisibility(tokens, headerStart, index) : 'public',
      static: tokens.slice(headerStart, index).some((item) => item.text === 'static'),
    });
  }

  // Class properties, constants, and enum cases.
  for (const parent of declarations.filter((item) => CONTAINER_KINDS.has(item.kind) && item.bodyStart !== undefined && item.bodyEnd !== undefined)) {
    for (let index = parent.bodyStart! + 1; index < parent.bodyEnd!; index += 1) {
      if (ownerAt(index, CALLABLE_KINDS)) continue;
      if (tokens[index]!.text === 'case' && tokens[index + 1]?.kind === 'identifier') {
        declarations.push({ kind: 'enum_member', name: bare(tokens[index + 1]!.text), start: index + 1, end: index + 1, parent });
      }
      if (tokens[index]!.text === 'const' && tokens[index + 1]?.kind === 'identifier') {
        const end = nextToken(tokens, index + 2, ';', parent.bodyEnd);
        declarations.push({ kind: 'constant', name: bare(tokens[index + 1]!.text), start: index, end: end < 0 ? index + 1 : end, parent, visibility: phpVisibility(tokens, Math.max(parent.bodyStart!, index - 3), index) });
      }
      const token = tokens[index]!;
      if (!token.text.startsWith('$')) continue;
      const previous = tokens[index - 1]?.text;
      if (previous === '->' || previous === '?->' || previous === '(' || previous === ',') continue;
      let statementStart = index;
      while (statementStart > parent.bodyStart! && ![';', '{', '}'].includes(tokens[statementStart - 1]!.text)) statementStart -= 1;
      if (!tokens.slice(statementStart, index).some((item) => VISIBILITY.has(item.text) || item.text === 'static' || item.text === 'readonly')) continue;
      const end = nextToken(tokens, index + 1, ';', parent.bodyEnd);
      declarations.push({ kind: 'field', name: bare(token.text), start: statementStart, end: end < 0 ? index : end, parent, visibility: phpVisibility(tokens, statementStart, index), static: tokens.slice(statementStart, index).some((item) => item.text === 'static') });
    }
  }

  // Inheritance, interfaces, and trait composition.
  for (const declaration of declarations.filter((item) => CONTAINER_KINDS.has(item.kind))) {
    const headerEnd = declaration.bodyStart ?? declaration.end;
    for (let index = declaration.start + 2; index < headerEnd; index += 1) {
      if (tokens[index]!.text !== 'extends' && tokens[index]!.text !== 'implements') continue;
      const kind = tokens[index]!.text as 'extends' | 'implements';
      let cursor = index + 1;
      const relationEnd = kind === 'extends' ? Math.min(headerEnd, (() => {
        const implementsIndex = nextToken(tokens, cursor, 'implements', headerEnd);
        return implementsIndex < 0 ? headerEnd : implementsIndex;
      })()) : headerEnd;
      while (cursor < relationEnd) {
        let end = cursor;
        while (end < relationEnd && tokens[end]!.text !== ',') end += 1;
        const name = qualified(tokens, cursor, end);
        const marker = tokens.slice(cursor, end).findIndex((item) => item.kind === 'identifier');
        if (name && marker >= 0) references.push({ owner: declaration, token: tokens[cursor + marker]!, name, kind });
        cursor = end + 1;
      }
      index = Math.max(index, relationEnd - 1);
    }
    if (declaration.bodyStart === undefined || declaration.bodyEnd === undefined) continue;
    for (let index = declaration.bodyStart + 1; index < declaration.bodyEnd; index += 1) {
      if (tokens[index]!.text !== 'use' || ownerAt(index, CALLABLE_KINDS)) continue;
      const end = nextToken(tokens, index + 1, ';', declaration.bodyEnd);
      if (end < 0) continue;
      let cursor = index + 1;
      while (cursor < end) {
        let segmentEnd = cursor;
        while (segmentEnd < end && tokens[segmentEnd]!.text !== ',') segmentEnd += 1;
        const name = qualified(tokens, cursor, segmentEnd);
        const marker = tokens.slice(cursor, segmentEnd).find((item) => item.kind === 'identifier');
        if (name && marker) references.push({ owner: declaration, token: marker, name, kind: 'implements' });
        cursor = segmentEnd + 1;
      }
    }
  }

  // Namespace imports and static include/require dependencies.
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index]!.text === 'use' && !ownerAt(index, CONTAINER_KINDS)) {
      const end = nextToken(tokens, index + 1, ';');
      if (end < 0) continue;
      let start = index + 1;
      if (tokens[start]?.text === 'function' || tokens[start]?.text === 'const') start += 1;
      const groupOpen = nextToken(tokens, start, '{', end);
      if (groupOpen >= 0) {
        const prefix = qualified(tokens, start, groupOpen).replace(/\\+$/, '');
        let cursor = groupOpen + 1;
        while (cursor < end && tokens[cursor]?.text !== '}') {
          let memberEnd = cursor;
          while (memberEnd < end && tokens[memberEnd]!.text !== ',' && tokens[memberEnd]!.text !== '}') memberEnd += 1;
          const asIndex = nextToken(tokens, cursor, 'as', memberEnd);
          const member = qualified(tokens, cursor, asIndex >= 0 ? asIndex : memberEnd);
          if (member) {
            const name = `${prefix}\\${member}`;
            declarations.push({ kind: 'import', name, start: index, end, signature: tokenText(source, tokens, index, end).trim() });
            references.push({ token: tokens[cursor]!, name: phpReferenceName(name), kind: 'imports' });
          }
          cursor = memberEnd + 1;
        }
        index = end;
        continue;
      }
      const asIndex = nextToken(tokens, start, 'as', end);
      const name = qualified(tokens, start, asIndex >= 0 ? asIndex : end);
      if (name) {
        declarations.push({ kind: 'import', name, start: index, end, qualifiedPrefix: undefined, signature: tokenText(source, tokens, index, end).trim() });
        references.push({ token: tokens[start]!, name: phpReferenceName(name), kind: 'imports' });
      }
      index = end;
      continue;
    }
    if (!['include', 'include_once', 'require', 'require_once'].includes(tokens[index]!.text)) continue;
    let value = index + 1;
    if (tokens[value]?.text === '(') value += 1;
    if (tokens[value]?.kind !== 'string') continue;
    const literal = tokens[value]!.text;
    if (literal.includes('$') || literal.includes('{')) continue;
    const name = unquote(literal);
    const end = nextToken(tokens, value + 1, ';');
    declarations.push({ kind: 'import', name, start: index, end: end < 0 ? value : end, signature: tokenText(source, tokens, index, end < 0 ? value : end).trim() });
    references.push({ token: tokens[value]!, name, kind: 'imports' });
  }

  // User-defined parameter/property/return types keep namespace-import resolution connected.
  for (const declaration of declarations.filter((item) => CALLABLE_KINDS.has(item.kind))) {
    const headerEnd = declaration.bodyStart ?? declaration.end;
    for (let index = declaration.start; index < headerEnd; index += 1) {
      const token = tokens[index]!;
      const name = bare(token.text);
      if (token.kind !== 'identifier' || name === declaration.name || name.startsWith('$') ||
          BUILTIN_TYPES.has(name.toLowerCase()) || CONTROL.has(name) || VISIBILITY.has(name) ||
          ['function', 'static', 'final', 'abstract'].includes(name)) continue;
      if (/^[A-Z_\\]/.test(name) || tokens[index + 1]?.text.startsWith('$')) {
        references.push({ owner: declaration, token, name: name.replace(/^\\/, ''), kind: 'references' });
      }
    }
  }

  // Runtime calls and constructor creation, attributed to the narrowest callable.
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const token = tokens[index]!;
    if (token.text === 'new' && tokens[index + 1]?.kind === 'identifier') {
      pushRef(index + 1, bare(tokens[index + 1]!.text), 'instantiates');
      continue;
    }
    if (token.kind !== 'identifier' || tokens[index + 1]?.text !== '(' || CONTROL.has(token.text)) continue;
    if (tokens[index - 1]?.text === 'function' || tokens[index - 1]?.text === 'fn') continue;
    if (declarations.some((item) => item.name === bare(token.text) && item.start <= index && (item.bodyStart ?? item.end) >= index)) continue;
    let name = bare(token.text);
    let marker = index;
    if ((tokens[index - 1]?.text === '->' || tokens[index - 1]?.text === '?->') && tokens[index - 2]?.text === ')') {
      const open = pairStart.get(index - 2);
      const inner = open === undefined ? undefined : tokens[open - 1];
      const owner = open === undefined ? undefined : tokens[open - 3];
      if (open !== undefined && inner?.kind === 'identifier' && tokens[open - 2]?.text === '::' && owner?.kind === 'identifier') {
        name = `${bare(owner.text)}::${bare(inner.text)}().${name}`;
        marker = open - 3;
      }
    } else if (tokens[index - 1]?.text === '->' || tokens[index - 1]?.text === '?->' || tokens[index - 1]?.text === '::') {
      const receiver = tokens[index - 2];
      if (receiver?.kind === 'identifier') {
        if (tokens[index - 1]?.text === '::') {
          name = `${bare(receiver.text)}.${name}`;
          marker = index - 2;
        } else {
          const receiverParts = [bare(receiver.text)];
          marker = index - 2;
          while (marker >= 2 && (tokens[marker - 1]?.text === '->' || tokens[marker - 1]?.text === '?->') &&
                 tokens[marker - 2]?.kind === 'identifier') {
            receiverParts.unshift(bare(tokens[marker - 2]!.text));
            marker -= 2;
          }
          name = `${receiverParts.join('->')}.${name}`;
        }
      }
    }
    pushRef(marker, name, 'calls');
  }

  // Established PHP HOF callable spellings.
  const hof = new Set(['array_map', 'array_filter', 'array_walk', 'call_user_func', 'call_user_func_array', 'register_shutdown_function', 'set_error_handler', 'set_exception_handler', 'spl_autoload_register', 'usort', 'uasort', 'uksort']);
  for (let index = 0; index < tokens.length - 1; index += 1) {
    if (!hof.has(tokens[index]!.text) || tokens[index + 1]?.text !== '(') continue;
    const end = scan.pairs.get(index + 1) ?? index + 1;
    for (let cursor = index + 2; cursor < end; cursor += 1) {
      if (tokens[cursor]!.kind !== 'string') continue;
      let name = unquote(tokens[cursor]!.text);
      if (!/^[A-Za-z_]\w*$/.test(name)) continue;
      const arrayOpen = tokens.slice(index + 2, cursor).map((item) => item.text).lastIndexOf('[');
      if (arrayOpen >= 0) {
        const absoluteOpen = index + 2 + arrayOpen;
        const receiver = tokens.slice(absoluteOpen + 1, cursor);
        if (receiver.some((item) => item.text === '$this')) name = `this.${name}`;
        else {
          const scope = receiver.find((item, offset) => item.kind === 'identifier' && receiver[offset + 1]?.text === '::');
          if (scope) name = `${bare(scope.text)}::${name}`;
        }
      }
      pushRef(cursor, name, 'function_ref');
    }
  }

  return finishDynamicFacts(filePath, source, 'php', scan, declarations, references, started);
}
