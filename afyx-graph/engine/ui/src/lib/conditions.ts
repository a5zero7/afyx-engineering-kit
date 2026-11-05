/**
 * AFYX Graph Engine - UI Condition Tokenizer & Scenario Formatter
 *
 * Deconstructs boolean guard expressions into bracket-aware top-level clauses,
 * tokenizes logical operators (WHEN, AND, OR, NOT) for human-readable rendering,
 * and extracts common condition prefixes across multi-site edge links.
 */

export function splitTop(text: string, sep: ' && ' | ' || '): string[] {
  const result: string[] = [];
  let bracketDepth = 0;
  let activeQuote: string | null = null;
  let sliceStart = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;

    if (activeQuote !== null) {
      if (ch === '\\') {
        i++;
      } else if (ch === activeQuote) {
        activeQuote = null;
      }
      continue;
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      activeQuote = ch;
      continue;
    }

    if (ch === '(' || ch === '[' || ch === '{') {
      bracketDepth++;
      continue;
    }

    if (ch === ')' || ch === ']' || ch === '}') {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }

    if (bracketDepth === 0 && text.startsWith(sep, i)) {
      result.push(text.slice(sliceStart, i).trim());
      sliceStart = i + sep.length;
      i += sep.length - 1;
    }
  }

  result.push(text.slice(sliceStart).trim());
  return result.filter((item) => item.length > 0);
}

export function clauses(when: string): string[] {
  if (splitTop(when, ' || ').length > 1) {
    return [when.trim()];
  }
  return splitTop(when, ' && ');
}

export type WordToken =
  | { kw: true; text: 'WHEN' | 'AND' | 'OR' | 'NOT' }
  | { kw: false; text: string };

const createKwToken = (text: 'WHEN' | 'AND' | 'OR' | 'NOT'): WordToken => ({ kw: true, text });
const createCodeToken = (text: string): WordToken => ({ kw: false, text });

export function clauseTokens(clause: string): WordToken[] {
  const trimmed = clause.trim();
  if (trimmed.startsWith('!(') && isBracketEnclosing(trimmed, 1)) {
    return [createKwToken('NOT'), createCodeToken(trimmed.slice(1))];
  }
  if (/^![A-Za-z_$][\w$.?]*$/.test(trimmed)) {
    return [createKwToken('NOT'), createCodeToken(trimmed.slice(1))];
  }
  return [createCodeToken(trimmed)];
}

export function clauseWords(clause: string): string {
  return joinTokens(clauseTokens(clause));
}

function joinGroupsWithKeyword(groups: readonly WordToken[][], kw: 'AND' | 'OR'): WordToken[] {
  const combined: WordToken[] = [];
  groups.forEach((group, idx) => {
    if (idx > 0) {
      combined.push(createKwToken(kw));
    }
    combined.push(...group);
  });
  return combined;
}

export function joinTokens(tokens: readonly WordToken[]): string {
  return tokens.map((token) => token.text).join(' ');
}

function isBracketEnclosing(text: string, openIndex: number): boolean {
  let depth = 0;
  let quoteChar: string | null = null;

  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i]!;

    if (quoteChar !== null) {
      if (ch === '\\') {
        i++;
      } else if (ch === quoteChar) {
        quoteChar = null;
      }
      continue;
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      quoteChar = ch;
    } else if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
      if (depth === 0) {
        return i === text.length - 1;
      }
    }
  }

  return false;
}

function uniqueClauses(items: readonly string[]): string[] {
  return items.filter((val, idx) => items.indexOf(val) === idx);
}

export function whenTokens(when: string): WordToken[] {
  if (!when) {
    return [];
  }
  return joinGroupsWithKeyword(
    splitTop(when, ' || ').map((scenario) =>
      joinGroupsWithKeyword(uniqueClauses(splitTop(scenario, ' && ')).map(clauseTokens), 'AND'),
    ),
    'OR',
  );
}

export function conditionTokens(when: string): WordToken[] {
  const tokens = whenTokens(when);
  return tokens.length === 0 ? [createCodeToken('always')] : [createKwToken('WHEN'), ...tokens];
}

export function whenWords(when: string): string {
  return joinTokens(whenTokens(when));
}

export function commonTokens(common: readonly string[]): WordToken[] {
  return common.length === 0 ? [] : [createKwToken('WHEN'), ...joinGroupsWithKeyword(common.map(clauseTokens), 'AND')];
}

export interface ScenarioRows<T> {
  common: string[];
  rows: Array<{ site: T; rest: string[] }>;
}

export function scenarios<T extends { when: string }>(sites: readonly T[]): ScenarioRows<T> {
  const mapped = sites.map((site) => ({
    site,
    all: site.when ? uniqueClauses(clauses(site.when)) : [],
  }));

  if (mapped.length === 0) {
    return { common: [], rows: [] };
  }

  let sharedPrefix = mapped[0]!.all.slice();
  for (const { all } of mapped.slice(1)) {
    let matchIdx = 0;
    while (matchIdx < sharedPrefix.length && matchIdx < all.length && sharedPrefix[matchIdx] === all[matchIdx]) {
      matchIdx++;
    }
    sharedPrefix = sharedPrefix.slice(0, matchIdx);
  }

  return {
    common: sharedPrefix,
    rows: mapped.map(({ site, all }) => ({
      site,
      rest: all.slice(sharedPrefix.length),
    })),
  };
}

export function restTokens(rest: readonly string[], hasCommon: boolean): WordToken[] {
  if (rest.length === 0) {
    return [createCodeToken('always')];
  }
  return [createKwToken(hasCommon ? 'AND' : 'WHEN'), ...joinGroupsWithKeyword(rest.map(clauseTokens), 'AND')];
}

export function restWords(rest: readonly string[], hasCommon: boolean): string {
  return joinTokens(restTokens(rest, hasCommon));
}
