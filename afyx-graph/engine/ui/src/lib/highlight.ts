/**
 * AFYX Graph Engine - UI Source Token Decoding & Highlighting
 *
 * Decodes compressed syntax highlight token streams received from the server,
 * computes exact character column offsets, provides lexical fallbacks for unparsed
 * lines, and maps semantic tokens to design system CSS classes.
 */

export type TokenClass =
  | 'other'
  | 'ident'
  | 'comment'
  | 'string'
  | 'keyword'
  | 'number'
  | 'type'
  | 'def';

export interface Token {
  cls: TokenClass;
  text: string;
  col: number;
}

export type WireToken = [number, string];

export interface WireHighlight {
  engine: 'tree-sitter' | 'plain';
  grammar: string | null;
  classes: string[];
  lines: WireToken[][];
  reason?: string;
}

const VALID_CLASSES: ReadonlySet<string> = new Set<TokenClass>([
  'other',
  'ident',
  'comment',
  'string',
  'keyword',
  'number',
  'type',
  'def',
]);

export function decodeLine(wire: readonly WireToken[], classes: readonly string[]): Token[] {
  const result: Token[] = [];
  let currentColumn = 0;

  for (const [classId, text] of wire) {
    const className = classes[classId];
    const resolvedClass: TokenClass = VALID_CLASSES.has(className as string)
      ? (className as TokenClass)
      : 'other';

    result.push({
      cls: resolvedClass,
      text,
      col: currentColumn,
    });
    currentColumn += text.length;
  }

  return result;
}

export function plainLine(text: string): Token[] {
  const tokens: Token[] = [];
  const identifierPattern = /[\p{L}_$][\p{L}\p{N}_$]*/gu;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = identifierPattern.exec(text)) !== null) {
    if (match.index > cursor) {
      tokens.push({
        cls: 'other',
        text: text.slice(cursor, match.index),
        col: cursor,
      });
    }
    tokens.push({
      cls: 'ident',
      text: match[0],
      col: match.index,
    });
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) {
    tokens.push({
      cls: 'other',
      text: text.slice(cursor),
      col: cursor,
    });
  }

  return tokens;
}

export function tokensByLine(
  lines: readonly string[],
  from: number,
  highlight: WireHighlight | undefined,
): Map<number, Token[]> {
  const tokenMap = new Map<number, Token[]>();

  for (let i = 0; i < lines.length; i++) {
    const wireTokens = highlight?.lines[i];
    tokenMap.set(
      from + i,
      wireTokens ? decodeLine(wireTokens, highlight.classes) : plainLine(lines[i] as string),
    );
  }

  return tokenMap;
}

export function tokenClass(cls: TokenClass): string | null {
  switch (cls) {
    case 'comment':
      return 't-c';
    case 'string':
      return 't-s';
    case 'keyword':
      return 't-k';
    case 'number':
      return 't-n';
    case 'def':
      return 't-def';
    default:
      return null;
  }
}
