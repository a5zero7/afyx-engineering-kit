import { scanSource, type NativeToken } from '../extraction/native/scanner';
import type { Language } from '../types';
import type { BranchGuard, GuardExit, GuardForm } from './branch-guard-policy';

const NATIVE_GUARD_LANGUAGES: ReadonlySet<Language> = new Set([
  'typescript', 'tsx', 'javascript', 'jsx', 'arkts', 'python', 'java', 'go', 'kotlin',
  'c', 'cpp', 'objc', 'csharp',
  'swift',
]);
const TEXT_LIMIT = 80;

interface Arm {
  start: number;
  end: number;
  after: number;
  open?: number;
}

interface IfShape {
  keyword: number;
  conditionStart: number;
  conditionEnd: number;
  consequence: Arm;
  alternative?: Arm;
}

interface NativeView {
  source: string;
  tokens: readonly NativeToken[];
  pairs: ReadonlyMap<number, number>;
  lineOffsets: readonly number[];
}

interface PythonLine {
  readonly number: number;
  readonly indent: number;
  readonly tokens: readonly number[];
}

export function supportsNativeBranchGuards(language: Language): boolean {
  return NATIVE_GUARD_LANGUAGES.has(language);
}

function viewOf(source: string, language: Language): NativeView {
  const scanned = scanSource(source, {
    hashComments: language === 'python',
    tripleQuotedStrings: language === 'kotlin',
    backtickIdentifiers: language === 'kotlin',
    cppRawStrings: language === 'cpp',
    csharpStrings: language === 'csharp',
    swiftSyntax: language === 'swift',
  });
  const tokens = scanned.tokens.filter((token) => token.kind !== 'comment');
  const pairs = new Map<number, number>();
  const stack: number[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const text = tokens[index]!.text;
    if (text === '(' || text === '[' || text === '{') stack.push(index);
    else if (text === ')' || text === ']' || text === '}') {
      const open = stack.at(-1);
      if (open !== undefined) {
        const expected = tokens[open]!.text === '(' ? ')' : tokens[open]!.text === '[' ? ']' : '}';
        if (text === expected) {
          stack.pop();
          pairs.set(open, index);
          pairs.set(index, open);
        }
      }
    }
  }
  const lineOffsets = [0];
  for (let offset = 0; offset < source.length; offset += 1) {
    if (source[offset] === '\n') lineOffsets.push(offset + 1);
  }
  return { source, tokens, pairs, lineOffsets };
}

function collapse(text: string): string {
  const value = text.replace(/\s+/g, ' ').trim().replace(/^\((.*)\)$/s, '$1').trim();
  return value.length > TEXT_LIMIT ? `${value.slice(0, TEXT_LIMIT - 1)}…` : value;
}

function slice(view: NativeView, first: number, lastExclusive: number): string {
  const start = view.tokens[first]?.start.offset;
  const end = view.tokens[lastExclusive - 1]?.end.offset;
  return start === undefined || end === undefined ? '' : collapse(view.source.slice(start, end));
}

function rawSlice(view: NativeView, first: number, lastExclusive: number): string {
  const start = view.tokens[first]?.start.offset;
  const end = view.tokens[lastExclusive - 1]?.end.offset;
  return start === undefined || end === undefined ? '' : view.source.slice(start, end);
}

function bodyAt(view: NativeView, start: number, language: Language = 'typescript'): Arm | null {
  const token = view.tokens[start];
  if (!token) return null;
  if (token.text === '{') {
    const close = view.pairs.get(start);
    return close === undefined ? null : { start: start + 1, end: close, after: close + 1, open: start };
  }
  if (token.text === 'if') {
    const nested = ifAt(view, start, language);
    if (nested) {
      const after = nested.alternative?.after ?? nested.consequence.after;
      return { start, end: after, after };
    }
  }
  let end = start + 1;
  const line = token.start.line;
  while (end < view.tokens.length) {
    const current = view.tokens[end]!;
    if (current.text === ';') return { start, end: end + 1, after: end + 1 };
    if (current.text === 'else') break;
    if (current.text === '}' || current.start.line > line) break;
    end += 1;
  }
  return { start, end, after: end };
}

function ifAt(view: NativeView, keyword: number, language: Language = 'typescript'): IfShape | null {
  if (view.tokens[keyword]?.text !== 'if') return null;
  let conditionStart = keyword + 1;
  let conditionEnd: number;
  let bodyStart: number;
  if (view.tokens[conditionStart]?.text === '(') {
    const close = view.pairs.get(conditionStart);
    if (close === undefined) return null;
    conditionStart += 1;
    conditionEnd = close;
    bodyStart = close + 1;
  } else if (language === 'go' || language === 'swift') {
    bodyStart = conditionStart;
    let depth = 0;
    let lastSemicolon = -1;
    while (bodyStart < view.tokens.length) {
      const text = view.tokens[bodyStart]!.text;
      if (depth === 0 && text === '{') break;
      if (depth === 0 && text === ';') lastSemicolon = bodyStart;
      if (text === '(' || text === '[') depth += 1;
      else if (text === ')' || text === ']') depth = Math.max(0, depth - 1);
      bodyStart += 1;
    }
    if (view.tokens[bodyStart]?.text !== '{') return null;
    conditionEnd = bodyStart;
    if (language === 'go' && lastSemicolon >= 0) conditionStart = lastSemicolon + 1;
  } else return null;
  const consequence = bodyAt(view, bodyStart, language);
  if (!consequence) return null;
  let next = consequence.after;
  while (view.tokens[next]?.text === ';') next += 1;
  const alternative = view.tokens[next]?.text === 'else' ? bodyAt(view, next + 1, language) ?? undefined : undefined;
  return { keyword, conditionStart, conditionEnd, consequence, alternative };
}

function contains(view: NativeView, arm: Arm, offset: number): boolean {
  const start = view.tokens[arm.start]?.start.offset ?? view.tokens[arm.open ?? arm.start]?.end.offset ?? 0;
  const end = view.tokens[arm.end - 1]?.end.offset ?? view.tokens[arm.open ?? arm.end]?.start.offset ?? start;
  return offset >= start && offset < end;
}

function branchKey(token: NativeToken): string {
  return `${token.start.line}:${token.start.column}`;
}

function exitIn(view: NativeView, arm: Arm, language: Language = 'typescript'): GuardExit | null {
  const text = rawSlice(view, arm.start, arm.end).replace(/[;}\s]+$/g, '');
  const match = /(?:^|[;\n])\s*(return|throw|break|continue|yield|goto)\b[^;\n]*$/s.exec(text);
  if (!match) {
    if (language === 'go' && /(?:^|[;\n])\s*(?:panic|os\.Exit|log\.(?:Fatal|Fatalf|Fatalln))\s*\([^;\n]*\)\s*$/s.test(text)) return 'exit';
    return null;
  }
  return match[1] === 'throw' ? 'throw' : 'return';
}

function guard(
  view: NativeView,
  form: GuardForm,
  text: string,
  negated: boolean,
  keyword: number,
  options: {
    armExit?: GuardExit | null;
    exit?: GuardExit | null;
    branchIndex?: number;
    lineIndex?: number | null;
  } = {},
): BranchGuard | null {
  const value = collapse(text);
  const branchToken = view.tokens[options.branchIndex ?? keyword];
  const lineToken = options.lineIndex === null ? null : view.tokens[options.lineIndex ?? keyword];
  if (!value || !branchToken) return null;
  return {
    text: value,
    negated,
    form,
    line: lineToken?.start.line ?? 0,
    branch: branchKey(branchToken),
    ...(options.armExit ? { armExit: options.armExit } : {}),
    ...(options.exit ? { exit: options.exit } : {}),
  };
}

function containingBrace(view: NativeView, tokenIndex: number): number | null {
  let found: number | null = null;
  for (const [open, close] of view.pairs) {
    if (open >= close || view.tokens[open]?.text !== '{') continue;
    if (open < tokenIndex && tokenIndex < close && (found === null || open > found)) found = open;
  }
  return found;
}

function functionBoundary(view: NativeView, siteToken: number, language: Language): number {
  let boundary = -1;
  for (const [open, close] of view.pairs) {
    if (open >= close || view.tokens[open]?.text !== '{' || !(open < siteToken && siteToken < close)) continue;
    const before = view.tokens[open - 1]?.text;
    let named = false;
    if (language === 'go') {
      const floor = containingBrace(view, open) ?? -1;
      let funcIndex = -1;
      for (let index = open - 1; index > floor; index -= 1) {
        if (view.tokens[index]!.text === 'func') { funcIndex = index; break; }
        if ([';', '{', '}'].includes(view.tokens[index]!.text)) break;
      }
      if (funcIndex >= 0) {
        const afterFunc = view.tokens[funcIndex + 1]?.text;
        const receiverClose = afterFunc === '(' ? view.pairs.get(funcIndex + 1) : undefined;
        const declaration = view.tokens[funcIndex + 1]?.kind === 'identifier'
          || (receiverClose !== undefined && view.tokens[receiverClose + 1]?.kind === 'identifier');
        let assigned = false;
        for (let index = funcIndex - 1; index > floor; index -= 1) {
          const text = view.tokens[index]!.text;
          if (text === '=' || text === ':=' || (text === ':' && view.tokens[index + 1]?.text === '=')) { assigned = true; break; }
          if ([';', '{', '}'].includes(text)) break;
        }
        named = declaration || assigned;
      }
    } else if (language === 'java' || language === 'c' || language === 'cpp' || language === 'objc' || language === 'csharp') {
      if (before === ')') {
        const params = view.pairs.get(open - 1);
        const name = params === undefined ? undefined : view.tokens[params - 1]?.text;
        named = !!name && !['if', 'for', 'while', 'switch', 'catch', 'synchronized'].includes(name);
      } else if (before === '->' || before === '=>' || (before === '>' && view.tokens[open - 2]?.text === '-')) {
        const floor = containingBrace(view, open) ?? -1;
        for (let index = open - (before === '->' || before === '=>' ? 2 : 3); index > floor; index -= 1) {
          const text = view.tokens[index]!.text;
          if (text === '=') { named = true; break; }
          if (text === ';') break;
        }
      } else if (language === 'objc') {
        const line = view.tokens[open]!.start.line;
        for (let index = open - 1; index >= 0 && view.tokens[index]!.start.line === line; index -= 1) {
          if (view.tokens[index]!.text === '-' || view.tokens[index]!.text === '+') { named = true; break; }
        }
      }
    } else if (language === 'swift') {
      const floor = containingBrace(view, open) ?? -1;
      for (let index = open - 1; index > floor; index -= 1) {
        const text = view.tokens[index]!.text;
        if (['func', 'init', 'deinit'].includes(text)) { named = true; break; }
        if ([';', '{', '}'].includes(text)) break;
      }
      if (!named) {
        const firstNested = view.tokens.slice(open + 1, close).findIndex((token) => token.text === '{');
        const closureLimit = firstNested < 0 ? close : open + 1 + firstNested;
        const hasIn = view.tokens.slice(open + 1, closureLimit).some((token) => token.text === 'in');
        const previous = view.tokens[open - 1];
        const header = view.tokens.slice(Math.max(floor + 1, open - 16), open).map((token) => token.text);
        const controlHeader = header.some((text) => ['if', 'else', 'guard', 'switch', 'for', 'while', 'catch', 'do'].includes(text));
        const trailing = !controlHeader && (previous?.text === ')' || previous?.kind === 'identifier');
        const assigned = previous?.text === '=';
        named = hasIn || trailing || assigned;
      }
    } else if (language === 'kotlin') {
      if (before === '=') named = true;
      if (before === ')') {
        const params = view.pairs.get(open - 1);
        named = params !== undefined && view.tokens[params - 2]?.text === 'fun';
      }
      if (!named) {
        const floor = containingBrace(view, open) ?? -1;
        const arrow = view.tokens.slice(open + 1, close).findIndex((token) => token.text === '->');
        if (arrow >= 0) {
          for (let index = open - 1; index > floor; index -= 1) {
            const text = view.tokens[index]!.text;
            if (text === '=') { named = true; break; }
            if ([';', '{', '}'].includes(text)) break;
          }
        }
        for (let index = open - 1; !named && index > floor; index -= 1) {
          if (['class', 'interface', 'object'].includes(view.tokens[index]!.text)) { named = true; break; }
          if ([';', '{', '}'].includes(view.tokens[index]!.text)) break;
        }
      }
    } else if (before === ')') {
      const params = view.pairs.get(open - 1);
      if (params !== undefined) named = view.tokens[params - 2]?.text === 'function';
    } else if (before === '=>') {
      const floor = containingBrace(view, open) ?? 0;
      for (let index = open - 2; index >= floor; index -= 1) {
        const text = view.tokens[index]!.text;
        if (text === ';' || text === '{' || text === '}') break;
        if (text === '=' && ['const', 'let', 'var'].includes(view.tokens[index - 2]?.text ?? '')) {
          named = true;
          break;
        }
      }
    }
    if (named && open > boundary) boundary = open;
  }
  if (language === 'java') {
    const floor = containingBrace(view, siteToken) ?? -1;
    for (let index = siteToken - 1; index > floor; index -= 1) {
      const arrow = view.tokens[index]!.text === '->'
        || (view.tokens[index]!.text === '>' && view.tokens[index - 1]?.text === '-');
      if (arrow) {
        for (let cursor = index - 1; cursor > floor; cursor -= 1) {
          const text = view.tokens[cursor]!.text;
          if (text === '=') { boundary = Math.max(boundary, index); break; }
          if (text === ';') break;
        }
        break;
      }
      if (view.tokens[index]!.text === ';') break;
    }
  }
  return boundary;
}

function tokenAtOffset(view: NativeView, offset: number): number {
  const found = view.tokens.findIndex((token) => token.start.offset <= offset && offset < token.end.offset);
  if (found >= 0) return found;
  const next = view.tokens.findIndex((token) => token.start.offset >= offset);
  return next >= 0 ? next : Math.max(0, view.tokens.length - 1);
}

function laterInContainingBlock(view: NativeView, first: number, second: number): boolean {
  const block = containingBrace(view, first);
  if (block === null) return true;
  const close = view.pairs.get(block);
  return close !== undefined && first < second && second < close;
}

function ifGuards(view: NativeView, siteOffset: number, siteToken: number, boundary: number, language: Language): BranchGuard[] {
  const found: BranchGuard[] = [];
  for (let index = boundary + 1; index < view.tokens.length; index += 1) {
    if (view.tokens[index]!.text !== 'if') continue;
    const shape = ifAt(view, index, language);
    if (!shape) continue;
    const condition = slice(view, shape.conditionStart, shape.conditionEnd);
    if (contains(view, shape.consequence, siteOffset)) {
      const item = guard(view, 'if', condition, false, index, { armExit: exitIn(view, shape.consequence, language) });
      if (item) found.push(item);
      continue;
    }
    if (shape.alternative && contains(view, shape.alternative, siteOffset)) {
      const item = guard(view, 'else', condition, true, index, { armExit: exitIn(view, shape.alternative, language) });
      if (item) found.push(item);
      continue;
    }
    const after = shape.alternative?.after ?? shape.consequence.after;
    if (!shape.alternative && after <= siteToken && laterInContainingBlock(view, index, siteToken)) {
      const exit = exitIn(view, shape.consequence, language);
      if (exit) {
        const item = guard(view, 'guard', condition, true, index, { exit });
        if (item) found.push(item);
      }
    }
  }
  return found;
}

function catchGuards(view: NativeView, siteOffset: number, boundary: number, language: Language): BranchGuard[] {
  const found: BranchGuard[] = [];
  for (let index = boundary + 1; index < view.tokens.length; index += 1) {
    if (view.tokens[index]!.text !== 'catch') continue;
    let body = index + 1;
    if (view.tokens[body]?.text === '(') body = (view.pairs.get(body) ?? body) + 1;
    const arm = bodyAt(view, body);
    if (!arm || !contains(view, arm, siteOffset)) continue;
    const item = guard(view, 'catch', 'on error', false, index, { armExit: exitIn(view, arm, language), lineIndex: null });
    if (item) found.push(item);
  }
  return found;
}

function swiftGuardGuards(view: NativeView, siteOffset: number, siteToken: number, boundary: number): BranchGuard[] {
  const found: BranchGuard[] = [];
  for (let index = boundary + 1; index < view.tokens.length; index += 1) {
    if (view.tokens[index]!.text !== 'guard') continue;
    let elseIndex = index + 1;
    let depth = 0;
    while (elseIndex < view.tokens.length) {
      const text = view.tokens[elseIndex]!.text;
      if (depth === 0 && text === 'else') break;
      if (text === '(' || text === '[') depth += 1;
      else if (text === ')' || text === ']') depth = Math.max(0, depth - 1);
      else if (depth === 0 && ['{', '}', ';'].includes(text)) break;
      elseIndex += 1;
    }
    if (view.tokens[elseIndex]?.text !== 'else') continue;
    const arm = bodyAt(view, elseIndex + 1, 'swift');
    if (!arm) continue;
    const condition = slice(view, index + 1, elseIndex);
    if (contains(view, arm, siteOffset)) {
      const item = guard(view, 'else', condition, true, index, { armExit: exitIn(view, arm, 'swift') });
      if (item) found.push(item);
    } else if (arm.after <= siteToken && laterInContainingBlock(view, index, siteToken)) {
      const item = guard(view, 'guard', condition, false, index, { exit: exitIn(view, arm, 'swift') ?? 'exit' });
      if (item) found.push(item);
    }
  }
  return found;
}

function switchGuards(view: NativeView, siteToken: number, boundary: number, language: Language): BranchGuard[] {
  const found: BranchGuard[] = [];
  for (let index = boundary + 1; index < siteToken; index += 1) {
    if (view.tokens[index]!.text !== 'switch') continue;
    let conditionStart = index + 1;
    let conditionClose: number | undefined;
    let blockOpen: number | undefined;
    if (view.tokens[conditionStart]?.text === '(') {
      conditionClose = view.pairs.get(conditionStart);
      blockOpen = conditionClose === undefined ? undefined : conditionClose + 1;
      conditionStart += 1;
    } else if (language === 'go' || language === 'swift') {
      blockOpen = conditionStart;
      let depth = 0;
      let lastSemicolon = -1;
      while (blockOpen < view.tokens.length) {
        const text = view.tokens[blockOpen]!.text;
        if (depth === 0 && text === '{') break;
        if (depth === 0 && text === ';') lastSemicolon = blockOpen;
        if (text === '(' || text === '[') depth += 1;
        else if (text === ')' || text === ']') depth = Math.max(0, depth - 1);
        blockOpen += 1;
      }
      conditionClose = blockOpen;
      if (language === 'go' && lastSemicolon >= 0) conditionStart = lastSemicolon + 1;
    }
    const blockClose = blockOpen === undefined ? undefined : view.pairs.get(blockOpen);
    if (conditionClose === undefined || blockOpen === undefined || blockClose === undefined || siteToken >= blockClose) continue;
    const subject = slice(view, conditionStart, conditionClose);
    let active: number | null = null;
    for (let cursor = blockOpen + 1; cursor < blockClose; cursor += 1) {
      if (view.tokens[cursor]!.text === 'case' || view.tokens[cursor]!.text === 'default') {
        if (cursor > siteToken) break;
        active = cursor;
      }
    }
    if (active === null) continue;
    const isDefault = view.tokens[active]!.text === 'default';
    let colon = active + 1;
    let arrow = false;
    while (colon < blockClose && view.tokens[colon]!.text !== ':') {
      if (view.tokens[colon]!.text === '->'
        || (view.tokens[colon]!.text === '-' && view.tokens[colon + 1]?.text === '>')) {
        arrow = true;
        break;
      }
      colon += 1;
    }
    // The established Java oracle currently emits no guard for switch rules.
    if (language === 'java' && arrow) continue;
    const value = isDefault ? '' : slice(view, active + 1, colon);
    const equality = ['java', 'go', 'c', 'cpp', 'objc', 'csharp', 'swift'].includes(language) ? '==' : '===';
    const item = guard(view, 'case', isDefault ? `${subject}: default` : subject ? `${subject} ${equality} ${value}` : value, false, index, {
      lineIndex: isDefault && language !== 'java' ? index : active,
    });
    if (item) found.push(item);
  }
  return found;
}

function kotlinWhenGuards(view: NativeView, siteToken: number, boundary: number): BranchGuard[] {
  const found: BranchGuard[] = [];
  for (let index = boundary + 1; index < siteToken; index += 1) {
    if (view.tokens[index]!.text !== 'when') continue;
    let subject = '';
    let blockOpen = index + 1;
    if (view.tokens[blockOpen]?.text === '(') {
      const close = view.pairs.get(blockOpen);
      if (close === undefined) continue;
      subject = slice(view, blockOpen + 1, close);
      blockOpen = close + 1;
    }
    if (view.tokens[blockOpen]?.text !== '{') continue;
    const blockClose = view.pairs.get(blockOpen);
    if (blockClose === undefined || siteToken >= blockClose) continue;
    let activeArrow = -1;
    let activeStart = blockOpen + 1;
    let candidateStart = blockOpen + 1;
    for (let cursor = blockOpen + 1; cursor < blockClose; cursor += 1) {
      const text = view.tokens[cursor]!.text;
      if (text === '->' && cursor < siteToken) {
        activeArrow = cursor;
        activeStart = candidateStart;
      }
      if ((text === ',' || text === '}') && cursor < siteToken) candidateStart = cursor + 1;
      if (text === '->' && cursor > siteToken) break;
    }
    if (activeArrow < 0) continue;
    activeStart = activeArrow - 1;
    const armLine = view.tokens[activeArrow]!.start.line;
    while (activeStart > blockOpen + 1 && view.tokens[activeStart - 1]!.start.line === armLine) activeStart -= 1;
    while (activeStart < activeArrow && [',', ';'].includes(view.tokens[activeStart]!.text)) activeStart += 1;
    const value = slice(view, activeStart, activeArrow);
    const isElse = value === 'else';
    const text = isElse ? `${subject}: else` : subject ? `${subject} == ${value}` : value;
    const item = guard(view, 'case', text, false, index, { branchIndex: index, lineIndex: isElse ? null : activeStart });
    if (item) found.push(item);
  }
  return found;
}

function statementStart(view: NativeView, index: number, boundary: number): number {
  let depth = 0;
  const line = view.tokens[index]?.start.line ?? 0;
  for (let cursor = index - 1; cursor > boundary; cursor -= 1) {
    const text = view.tokens[cursor]!.text;
    if (depth === 0 && text === '}') return cursor + 1;
    if (depth === 0 && view.tokens[cursor]!.end.line < line) return cursor + 1;
    if (text === ')' || text === ']' || text === '}') depth += 1;
    else if (text === '(' || text === '[' || text === '{') {
      if (depth > 0) depth -= 1;
      else return cursor + 1;
    } else if (depth === 0 && (text === ';' || text === '=' || text === 'return')) return cursor + 1;
  }
  return boundary + 1;
}

function ternaryGuards(view: NativeView, siteToken: number, boundary: number): BranchGuard[] {
  const found: BranchGuard[] = [];
  for (let question = boundary + 1; question < view.tokens.length; question += 1) {
    if (view.tokens[question]!.text !== '?') continue;
    let colon = question + 1;
    let nested = 0;
    for (; colon < view.tokens.length; colon += 1) {
      const text = view.tokens[colon]!.text;
      if (text === '?') nested += 1;
      else if (text === ':' && nested-- === 0) break;
      else if ((text === ';' || text === '}') && nested === 0) break;
    }
    if (view.tokens[colon]?.text !== ':') continue;
    let end = colon + 1;
    const questionLine = view.tokens[question]!.start.line;
    while (end < view.tokens.length && ![';', '}'].includes(view.tokens[end]!.text)
      && view.tokens[end]!.start.line === questionLine) end += 1;
    if (!(question < siteToken && siteToken < end)) continue;
    const conditionStart = statementStart(view, question, boundary);
    const condition = slice(view, conditionStart, question);
    const item = guard(view, 'ternary', condition, siteToken > colon, question, {
      branchIndex: conditionStart,
      lineIndex: conditionStart,
    });
    if (item) found.push(item);
  }
  return found;
}

function logicalGuards(view: NativeView, siteToken: number, boundary: number): BranchGuard[] {
  const found: BranchGuard[] = [];
  for (let operator = boundary + 1; operator < siteToken; operator += 1) {
    const text = view.tokens[operator]!.text;
    if (text !== '&&' && text !== '||') continue;
    const left = statementStart(view, operator, boundary);
    const rightEnd = (() => {
      let enclosingClose = view.tokens.length;
      let enclosed = false;
      for (const [open, close] of view.pairs) {
        if (view.tokens[open]?.text === '{') continue;
        if (open < operator && operator < close && close < enclosingClose) {
          enclosingClose = close;
          enclosed = true;
        }
      }
      let cursor = operator + 1;
      const operatorLine = view.tokens[operator]!.start.line;
      while (cursor < enclosingClose && ![';', ',', '}', '?', ':'].includes(view.tokens[cursor]!.text)) {
        if (!enclosed && view.tokens[cursor]!.start.line > operatorLine) break;
        cursor += 1;
      }
      return cursor;
    })();
    if (siteToken >= rightEnd) continue;
    const item = guard(view, text === '&&' ? 'and' : 'or', slice(view, left, operator), text === '||', operator, {
      branchIndex: left,
      lineIndex: left,
    });
    if (item) found.push(item);
  }
  return found;
}

function dedupeAndOrder(items: BranchGuard[]): BranchGuard[] {
  const unique = new Map<string, BranchGuard>();
  for (const item of items) unique.set(`${item.branch}:${item.form}:${item.negated}:${item.text}`, item);
  const branchLine = (item: BranchGuard): number => Number.parseInt(item.branch, 10) || item.line;
  return [...unique.values()].sort((left, right) => branchLine(left) - branchLine(right) || left.branch.localeCompare(right.branch));
}

function pythonLines(view: NativeView): PythonLine[] {
  const byLine = new Map<number, number[]>();
  for (let index = 0; index < view.tokens.length; index += 1) {
    const token = view.tokens[index]!;
    if (token.kind === 'comment') continue;
    const list = byLine.get(token.start.line) ?? [];
    list.push(index);
    byLine.set(token.start.line, list);
  }
  const physical = [...byLine].map(([number, tokens]) => ({
    number,
    indent: view.tokens[tokens[0]!]!.start.column,
    tokens,
  })).sort((left, right) => left.number - right.number);
  const logical: PythonLine[] = [];
  for (let index = 0; index < physical.length; index += 1) {
    const line = physical[index]!;
    const first = view.tokens[line.tokens[0]!]!.text;
    if (!['if', 'elif', 'while', 'match', 'case'].includes(first)) {
      logical.push(line);
      continue;
    }
    const tokens = [...line.tokens];
    let depth = 0;
    let complete = false;
    const consume = (tokenIndex: number): void => {
      const text = view.tokens[tokenIndex]!.text;
      if (text === '(' || text === '[' || text === '{') depth += 1;
      else if (text === ')' || text === ']' || text === '}') depth = Math.max(0, depth - 1);
      else if (text === ':' && depth === 0) complete = true;
    };
    for (const token of tokens) consume(token);
    while (!complete && index + 1 < physical.length) {
      const next = physical[index + 1]!;
      if (next.indent <= line.indent && depth === 0) break;
      index += 1;
      tokens.push(...next.tokens);
      for (const token of next.tokens) consume(token);
    }
    logical.push({ ...line, tokens });
  }
  return logical;
}

function pythonLineText(view: NativeView, line: PythonLine, from = 0, to = line.tokens.length): string {
  const first = line.tokens[from];
  const last = line.tokens[to - 1];
  if (first === undefined || last === undefined) return '';
  return collapse(view.source.slice(view.tokens[first]!.start.offset, view.tokens[last]!.end.offset));
}

function pythonHeader(view: NativeView, line: PythonLine): string {
  return view.tokens[line.tokens[0] ?? -1]?.text ?? '';
}

function pythonHeaderCondition(view: NativeView, line: PythonLine): string {
  let from = 1;
  let to = line.tokens.length;
  while (to > from && view.tokens[line.tokens[to - 1]!]!.text === ':') to -= 1;
  if (pythonHeader(view, line) === 'elif') from = 1;
  return pythonLineText(view, line, from, to);
}

function pythonBlockEnd(lines: readonly PythonLine[], index: number): number {
  const header = lines[index]!;
  let cursor = index + 1;
  while (cursor < lines.length && lines[cursor]!.indent > header.indent) cursor += 1;
  return cursor;
}

function pythonContains(lines: readonly PythonLine[], index: number, siteLine: number): boolean {
  return lines[index]!.number < siteLine && (lines[pythonBlockEnd(lines, index)]?.number ?? Number.POSITIVE_INFINITY) > siteLine;
}

function pythonExit(view: NativeView, lines: readonly PythonLine[], index: number): GuardExit | null {
  const end = pythonBlockEnd(lines, index);
  const last = lines[end - 1];
  if (!last || last.indent <= lines[index]!.indent) return null;
  const first = pythonHeader(view, last);
  if (first === 'raise') return 'throw';
  if (['return', 'break', 'continue', 'yield'].includes(first)) return 'return';
  return null;
}

function pythonBoundary(view: NativeView, lines: readonly PythonLine[], siteLine: number): number {
  let boundary = -1;
  for (let index = 0; index < lines.length && lines[index]!.number < siteLine; index += 1) {
    const header = pythonHeader(view, lines[index]!);
    if (header !== 'def' && header !== 'class') continue;
    if (pythonContains(lines, index, siteLine)) boundary = index;
  }
  return boundary;
}

function pythonGuard(
  view: NativeView,
  line: PythonLine,
  form: GuardForm,
  text: string,
  negated: boolean,
  options: { branchLine?: PythonLine; branchToken?: number; line?: number; armExit?: GuardExit | null; exit?: GuardExit | null } = {},
): BranchGuard | null {
  const token = view.tokens[options.branchToken ?? (options.branchLine ?? line).tokens[0] ?? -1];
  const value = collapse(text);
  if (!token || !value) return null;
  return {
    text: value,
    negated,
    form,
    line: options.line ?? line.number,
    branch: branchKey(token),
    ...(options.armExit ? { armExit: options.armExit } : {}),
    ...(options.exit ? { exit: options.exit } : {}),
  };
}

function pythonChain(lines: readonly PythonLine[], view: NativeView, index: number): { first: number; arms: number[] } {
  const indent = lines[index]!.indent;
  const arms = [index];
  let cursor = index - 1;
  while (cursor >= 0) {
    const line = lines[cursor]!;
    if (line.indent < indent) break;
    if (line.indent === indent) {
      const header = pythonHeader(view, line);
      if (header === 'if' || header === 'elif') {
        arms.unshift(cursor);
        if (header === 'if') return { first: cursor, arms };
      } else if (header !== 'else') break;
    }
    cursor -= 1;
  }
  return { first: index, arms };
}

function pythonStructuralGuards(view: NativeView, lines: readonly PythonLine[], siteLine: number, boundary: number): BranchGuard[] {
  const found: BranchGuard[] = [];
  const site = lines.find((line) => line.number === siteLine);
  if (!site) return found;
  for (let index = boundary + 1; index < lines.length && lines[index]!.number < siteLine; index += 1) {
    const line = lines[index]!;
    const header = pythonHeader(view, line);
    if (!pythonContains(lines, index, siteLine)) continue;
    if (header === 'if') {
      const item = pythonGuard(view, line, 'if', pythonHeaderCondition(view, line), false, { armExit: pythonExit(view, lines, index) });
      if (item) found.push(item);
    } else if (header === 'elif' || header === 'else') {
      const chain = pythonChain(lines, view, index);
      const branchLine = lines[chain.first]!;
      const priorArms = header === 'else' ? [...chain.arms].reverse() : chain.arms;
      for (const armIndex of priorArms) {
        if (armIndex === index && header === 'elif') continue;
        const arm = lines[armIndex]!;
        const item = pythonGuard(view, arm, 'else', pythonHeaderCondition(view, arm), true, { branchLine });
        if (item) found.push(item);
      }
      if (header === 'elif') {
        const item = pythonGuard(view, line, 'if', pythonHeaderCondition(view, line), false, {
          armExit: pythonExit(view, lines, index),
        });
        if (item) found.push(item);
      }
    } else if (header === 'case') {
      let matchIndex = index - 1;
      while (matchIndex > boundary && !(lines[matchIndex]!.indent < line.indent && pythonHeader(view, lines[matchIndex]!) === 'match')) matchIndex -= 1;
      const matchLine = lines[matchIndex];
      if (!matchLine) continue;
      const subject = pythonHeaderCondition(view, matchLine);
      const value = pythonHeaderCondition(view, line);
      const text = value === '_' ? `${subject}: default` : `${subject} == ${value}`;
      const item = pythonGuard(view, line, 'case', text, false, { branchLine: matchLine });
      if (item) found.push(item);
    } else if (header === 'except' || header === 'except*') {
      const item = pythonGuard(view, line, 'catch', 'on error', false, { line: 0, armExit: pythonExit(view, lines, index) });
      if (item) found.push(item);
    }
  }
  return found;
}

function pythonPriorExits(view: NativeView, lines: readonly PythonLine[], siteLine: number, boundary: number): BranchGuard[] {
  const found: BranchGuard[] = [];
  const site = lines.find((line) => line.number === siteLine);
  if (!site) return found;
  for (let index = boundary + 1; index < lines.length && lines[index]!.number < siteLine; index += 1) {
    const line = lines[index]!;
    if (pythonHeader(view, line) !== 'if' || line.indent > site.indent || pythonContains(lines, index, siteLine)) continue;
    const end = pythonBlockEnd(lines, index);
    const next = lines[end];
    if (next && next.indent === line.indent && ['elif', 'else'].includes(pythonHeader(view, next))) continue;
    const exit = pythonExit(view, lines, index);
    if (!exit) continue;
    let crossedOuterBoundary = false;
    for (let cursor = end; cursor < lines.length && lines[cursor]!.number < siteLine; cursor += 1) {
      if (lines[cursor]!.indent < line.indent) { crossedOuterBoundary = true; break; }
    }
    if (crossedOuterBoundary) continue;
    const item = pythonGuard(view, line, 'guard', pythonHeaderCondition(view, line), true, { exit });
    if (item) found.push(item);
  }
  return found;
}

function pythonInlineGuards(view: NativeView, line: PythonLine, siteToken: number): BranchGuard[] {
  const found: BranchGuard[] = [];
  const local = line.tokens;
  const siteLocal = local.indexOf(siteToken);
  if (siteLocal < 0) return found;
  const ifLocal = local.findIndex((token) => view.tokens[token]!.text === 'if');
  const elseLocal = local.findIndex((token, index) => index > ifLocal && view.tokens[token]!.text === 'else');
  if (ifLocal > 0 && elseLocal > ifLocal) {
    const condition = pythonLineText(view, line, ifLocal + 1, elseLocal);
    let expressionStart = 0;
    for (let index = 0; index < ifLocal; index += 1) {
      if (view.tokens[local[index]!]!.text === '=') expressionStart = index + 1;
    }
    const item = pythonGuard(view, line, 'ternary', condition, siteLocal > elseLocal, { branchToken: local[expressionStart] });
    if (item) found.push(item);
  }
  for (let index = 0; index < siteLocal; index += 1) {
    const operator = view.tokens[local[index]!]!.text;
    if (operator !== 'and' && operator !== 'or') continue;
    const item = pythonGuard(view, line, operator, pythonLineText(view, line, 0, index), operator === 'or');
    if (item) found.push(item);
  }
  return found;
}

function pythonGuardsInView(view: NativeView, line: number, column: number | null): BranchGuard[] {
  const lines = pythonLines(view);
  const sourceLine = view.source.split('\n')[line - 1] ?? '';
  const offset = (view.lineOffsets[line - 1] ?? 0) + (column ?? Math.max(0, sourceLine.search(/\S/)));
  const siteToken = tokenAtOffset(view, offset);
  const site = lines.find((item) => item.number === line);
  if (!site) return [];
  const localSite = site.tokens.indexOf(siteToken);
  const lambda = site.tokens.findIndex((token, index) => index < localSite && view.tokens[token]!.text === 'lambda');
  const assignedLambda = lambda >= 0 && site.tokens.some((token, index) => index < lambda && view.tokens[token]!.text === '=');
  const boundary = pythonBoundary(view, lines, line);
  return dedupeAndOrder([
    ...(assignedLambda ? [] : pythonPriorExits(view, lines, line, boundary)),
    ...(assignedLambda ? [] : pythonStructuralGuards(view, lines, line, boundary)),
    ...pythonInlineGuards(view, site, siteToken),
  ]);
}

function guardsInView(view: NativeView, language: Language, line: number, column: number | null): BranchGuard[] {
  if (line < 1) return [];
  const lineStart = view.lineOffsets[line - 1];
  if (lineStart === undefined) return [];
  const lineEnd = view.source.indexOf('\n', lineStart);
  const sourceLine = view.source.slice(lineStart, lineEnd < 0 ? view.source.length : lineEnd);
  const resolvedColumn = column ?? Math.max(0, sourceLine.search(/\S/));
  const offset = lineStart + resolvedColumn;
  if (view.tokens.length === 0) return [];
  const siteToken = tokenAtOffset(view, offset);
  const boundary = functionBoundary(view, siteToken, language);
  return dedupeAndOrder([
    ...ifGuards(view, offset, siteToken, boundary, language),
    ...(language === 'swift' ? swiftGuardGuards(view, offset, siteToken, boundary) : []),
    ...catchGuards(view, offset, boundary, language),
    ...switchGuards(view, siteToken, boundary, language),
    ...(language === 'kotlin' ? kotlinWhenGuards(view, siteToken, boundary) : []),
    ...ternaryGuards(view, siteToken, boundary),
    ...logicalGuards(view, siteToken, boundary),
  ]);
}

export function createNativeBranchGuardReader(
  source: string,
  language: Language,
): (line: number, column: number | null) => BranchGuard[] {
  if (!supportsNativeBranchGuards(language)) return () => [];
  const view = viewOf(source, language);
  if (language === 'python') return (line, column) => pythonGuardsInView(view, line, column);
  return (line, column) => guardsInView(view, language, line, column);
}

export function nativeGuardsInSource(source: string, language: Language, line: number, column: number | null): BranchGuard[] {
  return createNativeBranchGuardReader(source, language)(line, column);
}
