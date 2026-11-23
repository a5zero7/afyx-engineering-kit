import * as path from 'path';
import type { NodeKind, UnresolvedReference } from '../../types';
import { scanSource, type NativeToken } from './scanner';
import {
  finishDynamicFacts, narrowestOwner, tokenText,
  type NativeDeclaration, type NativeReference,
} from './dynamic-fact-builder';

const ROUTINES = new Set(['procedure', 'function', 'constructor', 'destructor']);
const VISIBILITIES = new Set(['private', 'protected', 'public', 'published']);
const CALLABLES = new Set<NodeKind>(['function', 'method']);
const CALL_STOP = new Set([
  'and', 'array', 'as', 'begin', 'case', 'class', 'const', 'constructor', 'destructor',
  'div', 'do', 'downto', 'else', 'end', 'except', 'exit', 'false', 'file', 'finally',
  'for', 'function', 'if', 'implementation', 'in', 'inherited', 'interface', 'is',
  'mod', 'nil', 'not', 'of', 'or', 'packed', 'procedure', 'program', 'property',
  'raise', 'record', 'repeat', 'set', 'shl', 'shr', 'then', 'to', 'true', 'try',
  'type', 'unit', 'until', 'uses', 'var', 'while', 'with', 'xor',
]);

function lower(token: NativeToken | undefined): string {
  return token?.text.toLowerCase() ?? '';
}

function statementEnd(tokens: readonly NativeToken[], pairs: ReadonlyMap<number, number>, from: number, limit = tokens.length): number {
  for (let index = from; index < limit; index += 1) {
    if (['(', '['].includes(tokens[index]!.text) && pairs.has(index)) {
      index = pairs.get(index)!;
      continue;
    }
    if (tokens[index]!.text === ';') return index;
  }
  return Math.max(from, limit - 1);
}

function dottedName(tokens: readonly NativeToken[], from: number, limit: number): { name: string; end: number } | undefined {
  if (tokens[from]?.kind !== 'identifier') return undefined;
  let name = tokens[from]!.text;
  let end = from;
  while (end + 2 < limit && tokens[end + 1]?.text === '.' && tokens[end + 2]?.kind === 'identifier') {
    name += `.${tokens[end + 2]!.text}`;
    end += 2;
  }
  return { name, end };
}

function pascalBlockEnd(tokens: readonly NativeToken[], open: number): number {
  let depth = 1;
  for (let index = open + 1; index < tokens.length; index += 1) {
    const word = lower(tokens[index]);
    const prior = lower(tokens[index - 1]);
    const opens = word === 'begin' || word === 'case' || word === 'try' || word === 'asm' ||
      ((word === 'class' || word === 'record' || word === 'interface' || word === 'object') && prior === '=');
    if (opens) depth += 1;
    else if (word === 'end') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return tokens.length - 1;
}

function declarationParent(declarations: readonly NativeDeclaration[], index: number): NativeDeclaration | undefined {
  return narrowestOwner(declarations, index, new Set<NodeKind>(['class', 'interface']));
}

function precedingDoc(tokens: readonly NativeToken[], index: number): string | undefined {
  const comment = tokens[index - 1];
  const declaration = tokens[index];
  if (comment?.kind !== 'comment' || !declaration || comment.end.line < declaration.start.line - 1) return undefined;
  const text = comment.text.startsWith('{')
    ? comment.text.slice(1, comment.text.endsWith('}') ? -1 : undefined)
    : comment.text.startsWith('(*')
      ? comment.text.slice(2, comment.text.endsWith('*)') ? -2 : undefined)
      : comment.text.replace(/^\/\//, '');
  const normalized = text.trim().replace(/^\*\s?/gm, '').trim();
  return normalized || undefined;
}

/** Bounded Pascal/Delphi facts. It models Afyx symbols, not compiler grammar topology. */
export function extractNativePascalFacts(filePath: string, source: string) {
  const started = Date.now();
  const scan = scanSource(source, { hashComments: false, pascalSyntax: true });
  const tokens = scan.tokens;
  const declarations: NativeDeclaration[] = [];
  const references: NativeReference[] = [];
  const ref = (index: number, name: string, kind: UnresolvedReference['referenceKind'], owner?: NativeDeclaration): void => {
    const token = tokens[index];
    if (token && name) references.push({ owner, token, name, kind });
  };

  // Unit/program/library identity.
  for (let index = 0; index < tokens.length; index += 1) {
    if (!['unit', 'program', 'library'].includes(lower(tokens[index]))) continue;
    const nameToken = tokens[index + 1];
    const name = nameToken?.kind === 'identifier' ? nameToken.text : path.basename(filePath, path.extname(filePath));
    declarations.push({ kind: 'module', name, start: nameToken?.kind === 'identifier' ? index + 1 : index, end: statementEnd(tokens, scan.pairs, index) });
    break;
  }

  // Type declarations. Class, record, interface, enum and aliases share `Name = ...`.
  for (let index = 0; index + 2 < tokens.length; index += 1) {
    if (tokens[index]!.kind !== 'identifier' || tokens[index + 1]!.text !== '=') continue;
    let value = index + 2;
    if (lower(tokens[value]) === 'packed') value += 1;
    const shape = lower(tokens[value]);
    let kind: NodeKind = 'type_alias';
    let end = statementEnd(tokens, scan.pairs, value);
    let bodyStart: number | undefined;
    let bodyEnd: number | undefined;
    if (shape === 'class' || shape === 'record' || shape === 'object') {
      kind = 'class';
      bodyStart = value;
      bodyEnd = pascalBlockEnd(tokens, value);
      end = statementEnd(tokens, scan.pairs, bodyEnd);
    } else if (shape === 'interface') {
      kind = 'interface';
      bodyStart = value;
      bodyEnd = pascalBlockEnd(tokens, value);
      end = statementEnd(tokens, scan.pairs, bodyEnd);
    } else if (tokens[value]?.text === '(' && scan.pairs.has(value)) {
      kind = 'enum';
      bodyStart = value;
      bodyEnd = scan.pairs.get(value)!;
      end = statementEnd(tokens, scan.pairs, bodyEnd);
    } else if (!/^[TPI][A-Za-z0-9_]*$/.test(tokens[index]!.text)) continue;
    const declaration: NativeDeclaration = { kind, name: tokens[index]!.text, start: index, end, bodyStart, bodyEnd };
    declarations.push(declaration);
    if ((kind === 'class' || kind === 'interface') && tokens[value + 1]?.text === '(') {
      const close = scan.pairs.get(value + 1);
      if (close !== undefined) {
        let ordinal = 0;
        for (let cursor = value + 2; cursor < close; cursor += 1) {
          const target = dottedName(tokens, cursor, close);
          if (!target) continue;
          ref(cursor, target.name, kind === 'class' && ordinal === 0 ? 'extends' : 'implements', declaration);
          ordinal += 1;
          cursor = target.end;
        }
      }
    }
    if (kind === 'enum' && bodyStart !== undefined && bodyEnd !== undefined) {
      for (let cursor = bodyStart + 1; cursor < bodyEnd; cursor += 1) {
        if (tokens[cursor]!.kind !== 'identifier' || (cursor > bodyStart + 1 && tokens[cursor - 1]!.text !== ',')) continue;
        declarations.push({ kind: 'enum_member', name: tokens[cursor]!.text, start: cursor, end: cursor, parent: declaration });
      }
    }
    index = Math.max(index, value);
  }

  // Nest type declarations after all enclosing ranges are known.
  for (const declaration of declarations) {
    if (!['class', 'interface', 'enum', 'type_alias'].includes(declaration.kind)) continue;
    declaration.parent = declarations.filter((candidate) => candidate !== declaration &&
      (candidate.kind === 'class' || candidate.kind === 'interface') &&
      candidate.bodyStart !== undefined && candidate.bodyEnd !== undefined &&
      candidate.bodyStart < declaration.start && candidate.bodyEnd > declaration.end)
      .sort((left, right) => (left.bodyEnd! - left.bodyStart!) - (right.bodyEnd! - right.bodyStart!))[0];
  }

  // Uses clauses preserve one import node/reference per dotted unit.
  for (let index = 0; index < tokens.length; index += 1) {
    if (lower(tokens[index]) !== 'uses') continue;
    const end = statementEnd(tokens, scan.pairs, index + 1);
    for (let cursor = index + 1; cursor < end; cursor += 1) {
      const unit = dottedName(tokens, cursor, end);
      if (!unit) continue;
      const declaration: NativeDeclaration = {
        kind: 'import', name: unit.name, start: cursor, end: unit.end,
        signature: tokenText(source, tokens, index, end),
      };
      declarations.push(declaration);
      ref(cursor, unit.name, 'imports');
      cursor = unit.end;
      if (lower(tokens[cursor + 1]) === 'in') cursor += 2;
    }
    index = end;
  }

  const implementation = tokens.findIndex((token) => lower(token) === 'implementation');
  const routineIndex = new Map<string, NativeDeclaration>();
  const visibilityAt = (container: NativeDeclaration | undefined, index: number) => {
    if (!container?.bodyStart) return undefined;
    let visibility: NativeDeclaration['visibility'];
    for (let cursor = container.bodyStart + 1; cursor < index; cursor += 1) {
      const word = lower(tokens[cursor]);
      if (VISIBILITIES.has(word)) visibility = word === 'published' ? 'public' : word as NativeDeclaration['visibility'];
    }
    return visibility;
  };

  // Callable declarations and implementation bodies.
  for (let index = 0; index < tokens.length; index += 1) {
    const routine = lower(tokens[index]);
    if (!ROUTINES.has(routine)) continue;
    const full = dottedName(tokens, index + 1, tokens.length);
    if (!full) continue;
    const headerEnd = statementEnd(tokens, scan.pairs, full.end + 1);
    const parent = declarationParent(declarations, index);
    const inImplementation = implementation >= 0 && index > implementation && !parent;
    const shortName = full.name.split('.').at(-1)!;
    const explicitClass = full.name.includes('.') ? full.name.split('.')[0]! : undefined;
    const key = `${explicitClass ?? parent?.name ?? ''}::${shortName}`.toLowerCase();
    const openParams = tokens.findIndex((token, at) => at > full.end && at < headerEnd && token.text === '(');
    const closeParams = openParams >= 0 ? scan.pairs.get(openParams) : undefined;
    let returnType: string | undefined;
    if (routine === 'function') {
      const colon = tokens.findIndex((token, at) => at > (closeParams ?? full.end) && at < headerEnd && token.text === ':');
      if (colon >= 0) returnType = dottedName(tokens, colon + 1, headerEnd)?.name;
    }
    const signature = `${openParams >= 0 && closeParams !== undefined ? tokenText(source, tokens, openParams, closeParams) : ''}${returnType ? `: ${returnType}` : ''}` || undefined;

    if (inImplementation) {
      const existing = routineIndex.get(key) ?? (!explicitClass ? routineIndex.get(`::${shortName}`.toLowerCase()) : undefined);
      let begin = headerEnd + 1;
      while (begin < tokens.length && lower(tokens[begin]) !== 'begin') {
        if (ROUTINES.has(lower(tokens[begin]))) break;
        begin += 1;
      }
      const bodyEnd = begin < tokens.length && lower(tokens[begin]) === 'begin' ? pascalBlockEnd(tokens, begin) : headerEnd;
      if (existing) {
        existing.bodyStart = begin;
        existing.bodyEnd = bodyEnd;
        existing.end = Math.max(existing.end, bodyEnd);
        if (!existing.returnType) existing.returnType = returnType;
      } else if (!explicitClass) {
        const declaration: NativeDeclaration = {
          kind: 'function', name: shortName, start: index + 1, end: bodyEnd,
          bodyStart: begin, bodyEnd, signature, returnType,
        };
        declarations.push(declaration);
        routineIndex.set(key, declaration);
        routineIndex.set(`::${shortName}`.toLowerCase(), declaration);
      }
      index = headerEnd;
      continue;
    }

    const declaration: NativeDeclaration = {
      kind: parent ? 'method' : 'function', name: shortName, start: full.end, end: headerEnd,
      parent, signature, returnType, visibility: visibilityAt(parent, index),
      static: lower(tokens[index - 1]) === 'class' || tokens.slice(full.end + 1, headerEnd).some((token) => lower(token) === 'static'),
      docstring: precedingDoc(tokens, index),
    };
    if (!routineIndex.has(key)) {
      declarations.push(declaration);
      routineIndex.set(key, declaration);
      if (!parent) routineIndex.set(`::${shortName}`.toLowerCase(), declaration);
    }
    index = headerEnd;
  }

  // Class fields and properties, restricted to direct class/interface statements.
  for (const container of declarations.filter((item) => (item.kind === 'class' || item.kind === 'interface') && item.bodyStart !== undefined && item.bodyEnd !== undefined)) {
    let visibility: NativeDeclaration['visibility'];
    let statementStart = container.bodyStart! + 1;
    for (let index = statementStart; index < container.bodyEnd!; index += 1) {
      const nested = declarations.find((item) => item.parent === container && item.bodyStart === index && item.bodyEnd !== undefined);
      if (nested) { index = nested.bodyEnd!; statementStart = index + 1; continue; }
      const word = lower(tokens[index]);
      if (VISIBILITIES.has(word)) {
        visibility = word === 'published' ? 'public' : word as NativeDeclaration['visibility'];
        statementStart = index + 1;
        continue;
      }
      if (tokens[index]!.text !== ';') continue;
      const slice = tokens.slice(statementStart, index);
      const head = lower(slice[0]);
      if (head === 'property' && slice[1]?.kind === 'identifier') {
        declarations.push({ kind: 'property', name: slice[1]!.text, start: statementStart + 1, end: index, parent: container, visibility });
      } else if (!ROUTINES.has(head) && head !== 'class' && head !== 'type' && head !== 'const') {
        const colon = slice.findIndex((token) => token.text === ':');
        if (colon > 0) {
          for (let cursor = 0; cursor < colon; cursor += 1) {
            if (slice[cursor]!.kind === 'identifier' && (cursor === 0 || slice[cursor - 1]!.text === ',')) {
              declarations.push({ kind: 'field', name: slice[cursor]!.text, start: statementStart + cursor, end: index, parent: container, visibility });
            }
          }
        }
      }
      statementStart = index + 1;
    }
  }

  // Const sections. Local shadows are retained only as suppression evidence.
  const shadowedConstants = new Set<string>();
  for (let index = 0; index < tokens.length; index += 1) {
    if (lower(tokens[index]) !== 'const') continue;
    const owner = narrowestOwner(declarations, index, CALLABLES) ?? declarations.find((item) =>
      CALLABLES.has(item.kind) && item.start < index && item.bodyStart !== undefined &&
      item.bodyStart > index && item.bodyEnd !== undefined && item.bodyEnd > index);
    for (let cursor = index + 1; cursor + 1 < tokens.length;) {
      if (tokens[cursor]!.kind !== 'identifier' || tokens[cursor + 1]!.text !== '=') break;
      const end = statementEnd(tokens, scan.pairs, cursor + 2);
      if (owner) shadowedConstants.add(tokens[cursor]!.text.toLowerCase());
      else declarations.push({ kind: 'constant', name: tokens[cursor]!.text, start: cursor, end, signature: tokenText(source, tokens, cursor + 2, Math.max(cursor + 2, end - 1)) });
      cursor = end + 1;
    }
  }

  const callables = declarations.filter((item) => CALLABLES.has(item.kind) && item.bodyStart !== undefined && item.bodyEnd !== undefined);
  const functions = new Map(declarations.filter((item) => CALLABLES.has(item.kind)).map((item) => [item.name.toLowerCase(), item]));
  const constants = new Map(declarations.filter((item) => item.kind === 'constant').map((item) => [item.name.toLowerCase(), item]));

  for (const owner of callables) {
    for (let index = owner.bodyStart! + 1; index < owner.bodyEnd!; index += 1) {
      const token = tokens[index]!;
      if (token.kind !== 'identifier') continue;
      const word = lower(token);
      const targetConstant = constants.get(word);
      if (targetConstant && !shadowedConstants.has(word) && targetConstant !== owner) {
        references.push({ owner, directTarget: targetConstant, token, name: token.text, kind: 'function_ref' });
      }
      const name = dottedName(tokens, index, owner.bodyEnd!);
      if (!name) continue;
      const next = tokens[name.end + 1];
      if (next?.text === '(' && !CALL_STOP.has(word)) {
        let callName = name.name;
        const close = scan.pairs.get(name.end + 1);
        let consumed = name.end;
        if (close !== undefined && tokens[close + 1]?.text === '.' && tokens[close + 2]?.kind === 'identifier') {
          const outer = tokens[close + 2]!.text;
          callName = /^[TI][A-Z]/.test(name.name) ? `${name.name}().${outer}` : outer;
          consumed = close + 2;
          if (tokens[consumed + 1]?.text === '(' && scan.pairs.has(consumed + 1)) consumed = scan.pairs.get(consumed + 1)!;
        }
        ref(index, callName, 'calls', owner);
        if (close !== undefined) {
          // Bare same-file routines passed as callback arguments, including @Routine.
          for (let cursor = name.end + 2; cursor < close; cursor += 1) {
            const candidate = tokens[cursor];
            if (candidate?.kind === 'identifier' && functions.has(candidate.text.toLowerCase()) && tokens[cursor + 1]?.text !== '(') {
              ref(cursor, candidate.text, 'function_ref', owner);
            }
          }
        }
        index = consumed;
      } else if (next?.text === ':=' && functions.has(lower(tokens[name.end + 2]))) {
        const candidateIndex = tokens[name.end + 2]?.text === '@' ? name.end + 3 : name.end + 2;
        const candidate = tokens[candidateIndex];
        if (candidate?.kind === 'identifier' && functions.has(candidate.text.toLowerCase())) ref(candidateIndex, candidate.text, 'function_ref', owner);
      } else if (name.name.includes('.') && tokens[name.end + 1]?.text === ';') {
        let statementStart = index;
        while (statementStart > owner.bodyStart! + 1 && ![';', 'begin', 'then', 'do', 'else'].includes(lower(tokens[statementStart - 1]))) statementStart -= 1;
        if (tokens.slice(statementStart, index).some((item) => item.text === ':=' || item.text === '=')) {
          index = name.end;
          continue;
        }
        const parts = name.name.split('.');
        const callName = parts.length >= 3 && /^[TI][A-Z]/.test(parts[0]!)
          ? `${parts.slice(0, -1).join('.')}().${parts.at(-1)}`
          : name.name;
        ref(index, callName, 'calls', owner);
      } else if (!name.name.includes('.') && tokens[name.end + 1]?.text === ';' && functions.has(word) && word !== owner.name.toLowerCase()) {
        ref(index, name.name, 'calls', owner);
      }
      index = Math.max(index, name.end);
    }
  }

  return finishDynamicFacts(filePath, source, 'pascal', scan, declarations, references, started);
}
