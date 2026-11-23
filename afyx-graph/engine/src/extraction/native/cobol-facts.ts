import type { ExtractionResult, UnresolvedReference } from '../../types';
import {
  finishDynamicFacts,
  type NativeDeclaration,
  type NativeReference,
} from './dynamic-fact-builder';
import type { NativeScanResult, NativeToken, NativeTokenKind } from './scanner';

interface SourceLine {
  readonly number: number;
  readonly start: number;
  readonly raw: string;
  readonly codeStart: number;
  readonly codeEnd: number;
  readonly code: string;
  readonly continuation: boolean;
  readonly firstToken?: number;
  readonly lastToken?: number;
}

const WORD_START = /[A-Za-z0-9_$#@]/u;
const WORD_PART = /[A-Za-z0-9_$#@-]/u;
const TOP_LEVELS = new Set([1, 66, 77]);
const SPECIAL_REGISTER = /^(?:RETURN-CODE|SQLCODE|SQLSTATE|TALLY|EIB[A-Z-]+|DFH[A-Z-]+|WHEN-COMPILED|LENGTH|ADDRESS)$/iu;
const EXEC_CICS_PROGRAM = /\b(?:LINK|XCTL)\b[\s\S]*?\bPROGRAM\s*\(\s*(?:['"]([A-Za-z0-9$#@-]+)['"]|([A-Za-z0-9-]+))\s*\)/iu;
const EXEC_CICS_TRANSID = /\b(?:RETURN|START)\b[\s\S]*?\bTRANSID\s*\(\s*(?:['"]([A-Za-z0-9$#@]{1,4})['"]|([A-Za-z0-9-]+))\s*\)/iu;
const EXEC_SQL_INCLUDE = /\bSQL\b[\s\S]*?\bINCLUDE\s+([A-Za-z0-9$#@-]+)/iu;

function sourceIsFreeForm(lines: readonly string[]): boolean {
  const marker = /^([ \t]*)(?:IDENTIFICATION\s+DIVISION|ID\s+DIVISION|PROGRAM-ID\b|\d{2}[ \t]+[A-Za-z])/iu;
  for (const line of lines) {
    const match = marker.exec(line);
    if (match) return match[1]!.length < 7;
  }
  return false;
}

function tokenizeCobol(source: string): { scan: NativeScanResult; lines: SourceLine[] } {
  const rawLines = source.split('\n');
  const freeForm = sourceIsFreeForm(rawLines);
  const tokens: NativeToken[] = [];
  const pairs = new Map<number, number>();
  const stack: Array<{ token: number; close: string }> = [];
  const unterminated: Array<'string' | 'comment' | 'delimiter'> = [];
  const lines: SourceLine[] = [];
  let lineOffset = 0;

  const emit = (kind: NativeTokenKind, start: number, end: number, line: number, lineStart: number): void => {
    tokens.push({
      kind,
      text: source.slice(start, end),
      start: { offset: start, line, column: start - lineStart },
      end: { offset: end, line, column: end - lineStart },
    });
  };

  for (let lineIndex = 0; lineIndex < rawLines.length; lineIndex += 1) {
    const rawWithCr = rawLines[lineIndex]!;
    const raw = rawWithCr.endsWith('\r') ? rawWithCr.slice(0, -1) : rawWithCr;
    let codeStart = freeForm ? 0 : Math.min(7, raw.length);
    let codeEnd = freeForm ? raw.length : Math.min(72, raw.length);
    const indicator = freeForm ? '' : raw[6];
    const firstToken = tokens.length;

    if (!freeForm && (indicator === '*' || indicator === '/')) {
      emit('comment', lineOffset + Math.min(6, raw.length), lineOffset + raw.length, lineIndex + 1, lineOffset);
      codeStart = raw.length;
      codeEnd = raw.length;
    } else {
      let cursor = codeStart;
      while (cursor < codeEnd) {
        const absolute = lineOffset + cursor;
        const char = raw[cursor]!;
        const next = raw[cursor + 1];
        if (/\s/u.test(char)) {
          cursor += 1;
          continue;
        }
        if (char === '*' && next === '>') {
          emit('comment', absolute, lineOffset + codeEnd, lineIndex + 1, lineOffset);
          cursor = codeEnd;
          continue;
        }
        if (char === "'" || char === '"') {
          const quote = char;
          const start = cursor++;
          let closed = false;
          while (cursor < codeEnd) {
            if (raw[cursor] !== quote) {
              cursor += 1;
              continue;
            }
            if (raw[cursor + 1] === quote) {
              cursor += 2;
              continue;
            }
            cursor += 1;
            closed = true;
            break;
          }
          emit('string', lineOffset + start, lineOffset + cursor, lineIndex + 1, lineOffset);
          if (!closed) unterminated.push('string');
          continue;
        }
        if (WORD_START.test(char)) {
          const start = cursor++;
          while (cursor < codeEnd && WORD_PART.test(raw[cursor]!)) cursor += 1;
          const text = raw.slice(start, cursor);
          emit(/^\d+$/u.test(text) ? 'number' : 'identifier', lineOffset + start, lineOffset + cursor, lineIndex + 1, lineOffset);
          continue;
        }
        emit('punctuation', absolute, absolute + 1, lineIndex + 1, lineOffset);
        const index = tokens.length - 1;
        if (char === '(') stack.push({ token: index, close: ')' });
        else if (char === ')') {
          const open = stack.at(-1);
          if (open?.close === char) {
            stack.pop();
            pairs.set(open.token, index);
            pairs.set(index, open.token);
          }
        }
        cursor += 1;
      }
    }

    const lastToken = tokens.length > firstToken ? tokens.length - 1 : undefined;
    lines.push({
      number: lineIndex + 1,
      start: lineOffset,
      raw,
      codeStart,
      codeEnd,
      code: raw.slice(codeStart, codeEnd),
      continuation: !freeForm && indicator === '-',
      firstToken: lastToken === undefined ? undefined : firstToken,
      lastToken,
    });
    lineOffset += rawWithCr.length + (lineIndex < rawLines.length - 1 ? 1 : 0);
  }
  if (stack.length > 0) unterminated.push('delimiter');
  return { scan: { tokens, pairs, unterminated }, lines };
}

/** COBOL-specific lexical view used by native semantic and syntax routes. */
export function scanCobolSource(source: string): NativeScanResult {
  return tokenizeCobol(source).scan;
}

function collapse(text: string, cap = 120): string {
  const flat = text.replace(/\s+/gu, ' ').trim();
  return flat.length > cap ? `${flat.slice(0, cap - 1)}…` : flat;
}

function lineToken(lines: readonly SourceLine[], tokens: readonly NativeToken[], line: number, text?: string): number | undefined {
  const item = lines[line - 1];
  if (item?.firstToken === undefined || item.lastToken === undefined) return undefined;
  for (let index = item.firstToken; index <= item.lastToken; index += 1) {
    const candidate = tokens[index]!.text.replace(/^['"]|['"]$/gu, '');
    if (!text || candidate.toUpperCase() === text.toUpperCase()) return index;
  }
  return text ? undefined : item.firstToken;
}

function tokenBetweenLines(
  lines: readonly SourceLine[], tokens: readonly NativeToken[], fromLine: number, toLine: number, text: string,
): NativeToken | undefined {
  for (let line = fromLine; line <= toLine; line += 1) {
    const index = lineToken(lines, tokens, line, text);
    if (index !== undefined) return tokens[index];
  }
  return undefined;
}

function rangeEnd(lines: readonly SourceLine[], fromLine: number, toLine: number): number {
  for (let line = Math.min(toLine, lines.length); line >= fromLine; line -= 1) {
    const token = lines[line - 1]?.lastToken;
    if (token !== undefined) return token;
  }
  return lines[fromLine - 1]?.firstToken ?? 0;
}

function addReference(
  references: NativeReference[], owner: NativeDeclaration | undefined,
  token: NativeToken | undefined, name: string | undefined,
  kind: UnresolvedReference['referenceKind'],
): void {
  if (token && name) references.push({ owner, token, name, kind });
}

interface DataItem {
  readonly line: number;
  readonly endLine: number;
  readonly level: number;
  readonly name: string;
  readonly declaration?: NativeDeclaration;
}

/** Bounded Afyx-native COBOL facts, preserving the established adapter contract. */
export function extractNativeCobolFacts(filePath: string, source: string): ExtractionResult {
  const started = Date.now();
  const { scan, lines } = tokenizeCobol(source);
  const tokens = scan.tokens;
  const declarations: NativeDeclaration[] = [];
  const references: NativeReference[] = [];
  if (tokens.length === 0) return finishDynamicFacts(filePath, source, 'cobol', scan, declarations, references, started);

  const programMatch = lines.map((line) => ({ line, match: /\bPROGRAM-ID\s*\.\s*['"]?([A-Za-z0-9$#@-]+)/iu.exec(line.code) }))
    .find((entry) => entry.match);
  let program: NativeDeclaration | undefined;
  if (programMatch?.match) {
    const name = programMatch.match[1]!;
    const start = lineToken(lines, tokens, programMatch.line.number, name)!;
    program = { kind: 'module', name, start, end: tokens.length - 1, bodyStart: start, bodyEnd: tokens.length - 1 };
    declarations.push(program);
  }

  const procedureLine = lines.find((line) => /\bPROCEDURE\s+DIVISION\b/iu.test(line.code))?.number;
  const dataStart = lines.find((line) => /\bDATA\s+DIVISION\b/iu.test(line.code))?.number;
  const dataEnd = procedureLine ? procedureLine - 1 : lines.length;
  const dataCandidates: Array<{ line: SourceLine; level: number; name: string }> = [];
  for (const line of lines) {
    if (dataStart && (line.number <= dataStart || line.number > dataEnd)) continue;
    const match = /^\s*(\d{2})\s+([A-Za-z0-9$#@-]+)/u.exec(line.code);
    if (match) dataCandidates.push({ line, level: Number.parseInt(match[1]!, 10), name: match[2]! });
  }

  const dataItems: DataItem[] = [];
  const open: Array<{ level: number; declaration: NativeDeclaration }> = [];
  for (let index = 0; index < dataCandidates.length; index += 1) {
    const item = dataCandidates[index]!;
    const next = dataCandidates[index + 1];
    const candidateEnd = next ? next.line.number - 1 : dataEnd;
    let endLine = item.line.number;
    while (endLine < candidateEnd && !/\.\s*$/u.test(lines[endLine - 1]!.code)) endLine += 1;
    const topLevel = TOP_LEVELS.has(item.level);
    if (item.level !== 88) {
      while (open.length > 0 && (topLevel || open.at(-1)!.level >= item.level)) open.pop();
    }
    if (/^FILLER$/iu.test(item.name)) {
      dataItems.push({ line: item.line.number, endLine, level: item.level, name: item.name });
      continue;
    }
    const tokenIndex = lineToken(lines, tokens, item.line.number, item.name);
    if (tokenIndex === undefined) continue;
    let semanticEnd = endLine;
    if (item.level !== 88) {
      for (let later = index + 1; later < dataCandidates.length; later += 1) {
        const candidate = dataCandidates[later]!;
        if (candidate.level !== 88 && (candidate.level <= item.level || TOP_LEVELS.has(candidate.level))) {
          semanticEnd = candidate.line.number - 1;
          break;
        }
        semanticEnd = Math.max(semanticEnd, candidate.line.number);
      }
    }
    const signature = collapse(lines.slice(item.line.number - 1, endLine).map((line) => line.code).join(' '))
      .replace(/\.\s*$/u, '');
    const declaration: NativeDeclaration = {
      kind: item.level === 88 ? 'constant' : open.length === 0 ? 'variable' : 'field',
      name: item.name,
      start: tokenIndex,
      end: rangeEnd(lines, item.line.number, item.level === 88 ? endLine : semanticEnd),
      parent: open.at(-1)?.declaration ?? program,
      signature,
    };
    declarations.push(declaration);
    dataItems.push({ line: item.line.number, endLine, level: item.level, name: item.name, declaration });
    if (item.level !== 88) open.push({ level: item.level, declaration });
  }

  const valueByName = new Map<string, string>();
  for (const item of dataItems) {
    if (!item.declaration?.signature) continue;
    const value = /\bVALUE\s+['"]([A-Za-z0-9$#@-]+)['"]/iu.exec(item.declaration.signature)?.[1];
    if (value) valueByName.set(item.name.toUpperCase(), value);
  }

  interface Header { line: number; name: string; section: boolean; declaration?: NativeDeclaration }
  const headers: Header[] = [];
  const procedureStart = procedureLine ? procedureLine + 1 : 1;
  const hasDataOnly = !procedureLine && dataCandidates.length > 0;
  if (!hasDataOnly) {
    for (const line of lines.slice(procedureStart - 1)) {
      const section = /^([A-Za-z0-9$#@-]+)\s+SECTION\s*\.\s*$/iu.exec(line.code);
      const paragraph = /^([A-Za-z0-9$#@-]+)\s*\.\s*$/u.exec(line.code);
      if (section) headers.push({ line: line.number, name: section[1]!, section: true });
      else if (paragraph && paragraph[1] !== '.') headers.push({ line: line.number, name: paragraph[1]!, section: false });
    }
  }

  let currentSection: NativeDeclaration | undefined;
  for (let index = 0; index < headers.length; index += 1) {
    const header = headers[index]!;
    if (header.section) currentSection = undefined;
    const nextBoundary = headers.slice(index + 1).find((candidate) => !header.section || candidate.section);
    const endLine = nextBoundary ? nextBoundary.line - 1 : lines.length;
    const tokenIndex = lineToken(lines, tokens, header.line, header.name);
    if (tokenIndex === undefined) continue;
    const declaration: NativeDeclaration = {
      kind: 'function', name: header.name, start: tokenIndex,
      end: rangeEnd(lines, header.line, endLine),
      bodyStart: tokenIndex, bodyEnd: rangeEnd(lines, header.line, endLine),
      parent: header.section ? program : currentSection ?? program,
      signature: header.section ? 'SECTION' : undefined,
    };
    declarations.push(declaration);
    header.declaration = declaration;
    if (header.section) currentSection = declaration;
  }

  const ownerAt = (line: number): NativeDeclaration | undefined => {
    const header = [...headers].reverse().find((candidate) => candidate.line <= line);
    return header?.declaration ?? program;
  };
  const dataOwnerAt = (line: number): NativeDeclaration | undefined => {
    const item = [...dataItems].reverse().find((candidate) => candidate.line <= line && candidate.endLine >= line);
    return item?.declaration ?? program;
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]!;
    const upper = line.code.toUpperCase();
    const inData = Boolean(dataStart && line.number > dataStart && line.number <= dataEnd);
    const owner = (procedureLine && line.number > procedureLine) || (!procedureLine && headers.length > 0)
      ? ownerAt(line.number)
      : inData ? dataOwnerAt(line.number) : program;
    const importOwner = inData ? program : owner;
    const tokenFor = (name: string, toLine = line.number): NativeToken | undefined =>
      tokenBetweenLines(lines, tokens, line.number, toLine, name);

    const copy = /\bCOPY\s+['"]?([A-Za-z0-9$#@-]+)/iu.exec(line.code);
    if (copy?.[1]) {
      const tokenIndex = lineToken(lines, tokens, line.number, copy[1]);
      if (tokenIndex !== undefined) {
        declarations.push({ kind: 'import', name: copy[1], start: tokenIndex, end: line.lastToken ?? tokenIndex, parent: importOwner, signature: collapse(line.code) });
        addReference(references, importOwner, tokens[tokenIndex], copy[1], 'imports');
      }
    }

    if (/\bEXEC\s+(?:CICS|SQL)\b/iu.test(upper)) {
      let end = lineIndex;
      while (end + 1 < lines.length && !/\bEND-EXEC\b/iu.test(lines[end]!.code)) end += 1;
      const text = lines.slice(lineIndex, end + 1).map((item) => item.code).join('\n');
      const execToken = (name: string): NativeToken | undefined =>
        tokenBetweenLines(lines, tokens, line.number, end + 1, name);
      const programCall = EXEC_CICS_PROGRAM.exec(text);
      if (programCall) {
        const name = programCall[1] ?? (programCall[2] ? valueByName.get(programCall[2].toUpperCase()) : undefined);
        addReference(references, owner, execToken(programCall[1] ?? programCall[2] ?? ''), name, 'calls');
      }
      const transid = EXEC_CICS_TRANSID.exec(text);
      if (transid) {
        const value = transid[1] ?? (transid[2] ? valueByName.get(transid[2].toUpperCase()) : undefined);
        if (value && /^[A-Za-z0-9$#@]{1,4}$/u.test(value)) addReference(references, owner, execToken(transid[1] ?? transid[2] ?? ''), `cics-transid:${value.toUpperCase()}`, 'calls');
      }
      const include = EXEC_SQL_INCLUDE.exec(text);
      if (include?.[1]) {
        const includeToken = execToken(include[1]);
        const tokenIndex = includeToken ? tokens.indexOf(includeToken) : -1;
        if (tokenIndex >= 0) {
          declarations.push({ kind: 'import', name: include[1], start: tokenIndex, end: rangeEnd(lines, line.number, end + 1), parent: owner, signature: collapse(text) });
          addReference(references, owner, includeToken, include[1], 'imports');
        }
      }
      lineIndex = end;
      continue;
    }

    if ((procedureLine && line.number <= procedureLine) || (!procedureLine && headers.length === 0)) continue;
    let statementEnd = lineIndex;
    while (statementEnd + 1 < lines.length && lines[statementEnd + 1]!.continuation) statementEnd += 1;
    const statement = lines.slice(lineIndex, statementEnd + 1).map((item) => item.code).join(' ');
    const statementToken = (name: string): NativeToken | undefined => tokenFor(name, statementEnd + 1);
    const perform = /\bPERFORM\s+([A-Za-z0-9$#@-]+)(?:\s+(?:THRU|THROUGH)\s+([A-Za-z0-9$#@-]+))?/iu.exec(statement);
    if (perform && !/^(?:UNTIL|VARYING|WITH|TEST|TIMES)$/iu.test(perform[1]!)) {
      addReference(references, owner, statementToken(perform[1]!), perform[1], 'calls');
      if (perform[2]) addReference(references, owner, statementToken(perform[2]), perform[2], 'calls');
    }
    const goTo = /\bGO\s+TO\s+([A-Za-z0-9$#@-]+)/iu.exec(statement);
    if (goTo?.[1]) addReference(references, owner, statementToken(goTo[1]), goTo[1], 'calls');
    const call = /\bCALL\s+(['"])([^'"]+)\1/iu.exec(statement);
    if (call?.[2]) addReference(references, owner, statementToken(call[2]), call[2], 'calls');

    let write: string | undefined;
    if (/\bCOMPUTE\b/iu.test(upper)) write = /\bCOMPUTE\s+([A-Za-z0-9$#@-]+)\s*=/iu.exec(statement)?.[1];
    else if (/\bMOVE\b/iu.test(upper)) write = /\bTO\s+([A-Za-z0-9$#@-]+)/iu.exec(statement)?.[1];
    else if (/\bADD\b/iu.test(upper)) write = /\b(?:GIVING|TO)\s+([A-Za-z0-9$#@-]+)/iu.exec(statement)?.[1];
    else if (/\bSUBTRACT\b/iu.test(upper)) write = /\b(?:GIVING|FROM)\s+([A-Za-z0-9$#@-]+)/iu.exec(statement)?.[1];
    if (write && !SPECIAL_REGISTER.test(write)) addReference(references, owner, statementToken(write), write, 'references');
    lineIndex = statementEnd;
  }

  return finishDynamicFacts(filePath, source, 'cobol', scan, declarations, references, started);
}
