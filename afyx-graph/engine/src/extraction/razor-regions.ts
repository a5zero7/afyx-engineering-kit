export interface RazorCodeRegion {
  kind: 'code' | 'functions' | 'implicit';
  content: string;
  start: number;
  end: number;
  startLine: number;
  startColumn: number;
  complete: boolean;
}

function skipQuoted(source: string, start: number): number {
  const quote = source[start]!;
  if (quote === '"' && source.startsWith('"""', start)) {
    const close = source.indexOf('"""', start + 3);
    return close < 0 ? source.length : close + 3;
  }
  let cursor = start + 1;
  while (cursor < source.length) {
    if (source[cursor] === '\\' && quote !== '`') {
      cursor += 2;
      continue;
    }
    if (source[cursor] === quote) {
      // C# verbatim strings escape quotes by doubling them.
      if (quote === '"' && source[cursor + 1] === '"' && source[start - 1] === '@') {
        cursor += 2;
        continue;
      }
      return cursor + 1;
    }
    cursor += 1;
  }
  return source.length;
}

function matchingBrace(source: string, open: number): number | undefined {
  let depth = 0;
  for (let cursor = open; cursor < source.length; cursor += 1) {
    if (source.startsWith('//', cursor)) {
      const newline = source.indexOf('\n', cursor + 2);
      if (newline < 0) return undefined;
      cursor = newline;
      continue;
    }
    if (source.startsWith('/*', cursor)) {
      const close = source.indexOf('*/', cursor + 2);
      if (close < 0) return undefined;
      cursor = close + 1;
      continue;
    }
    const char = source[cursor]!;
    if (char === '"' || char === "'") {
      cursor = skipQuoted(source, cursor) - 1;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}' && --depth === 0) return cursor;
  }
  return undefined;
}

function locationAt(source: string, offset: number): { line: number; column: number } {
  const previousNewline = source.lastIndexOf('\n', offset - 1);
  return {
    line: (source.slice(0, offset).match(/\n/g) ?? []).length + 1,
    column: offset - previousNewline - 1,
  };
}

/** Bounded discovery for the C# block forms already supported by RazorExtractor. */
export function findRazorCodeRegions(source: string, includeIncomplete = false): RazorCodeRegion[] {
  const regions: RazorCodeRegion[] = [];
  let cursor = 0;
  let inTag = false;
  while (cursor < source.length) {
    if (source.startsWith('@*', cursor)) {
      const close = source.indexOf('*@', cursor + 2);
      cursor = close < 0 ? source.length : close + 2;
      continue;
    }
    if (source.startsWith('<!--', cursor)) {
      const close = source.indexOf('-->', cursor + 4);
      cursor = close < 0 ? source.length : close + 3;
      continue;
    }
    if (!inTag && source[cursor] === '<') {
      inTag = true;
      cursor += 1;
      continue;
    }
    if (inTag && (source[cursor] === '"' || source[cursor] === "'")) {
      cursor = skipQuoted(source, cursor);
      continue;
    }
    if (inTag) {
      inTag = source[cursor] !== '>';
      cursor += 1;
      continue;
    }
    if (source.startsWith('@@', cursor)) {
      cursor += 2;
      continue;
    }

    const tail = source.slice(cursor);
    const match = /^@(code|functions)\b\s*\{|^@\{/.exec(tail);
    if (!match) {
      cursor += 1;
      continue;
    }
    const open = cursor + match[0].lastIndexOf('{');
    const close = matchingBrace(source, open);
    if (close === undefined && !includeIncomplete) {
      cursor = open + 1;
      continue;
    }
    const start = open + 1;
    const end = close ?? source.length;
    const location = locationAt(source, start);
    regions.push({
      kind: match[1] === 'code' ? 'code' : match[1] === 'functions' ? 'functions' : 'implicit',
      content: source.slice(start, end),
      start,
      end,
      startLine: location.line,
      startColumn: location.column,
      complete: close !== undefined,
    });
    cursor = close === undefined ? source.length : close + 1;
  }
  return regions;
}
