/**
 * AFYX Engineering Kit - Object Literal Lexical Scanner
 *
 * Provides bracket matching and depth-aware field extraction for JavaScript/TypeScript object literals.
 * Used by declarative routing engines (Vue Router, TanStack Router) to parse configuration
 * objects while correctly respecting nested arrays, closures, string literals, and template substitutions.
 */

/**
 * Finds the index of the matching closing delimiter (`)`, `]`, `}`) for an opening bracket at `openIndex`.
 * Returns -1 if unbalanced or malformed.
 */
export function matchBracket(content: string, openIndex: number): number {
  let nestingDepth = 0;
  for (let idx = openIndex; idx < content.length; idx++) {
    const char = content[idx]!;

    if (char === '"' || char === "'" || char === '`') {
      const quoteEnd = skipString(content, idx);
      if (quoteEnd < 0) return -1;
      idx = quoteEnd;
      continue;
    }

    if (char === '[' || char === '{' || char === '(') {
      nestingDepth++;
    } else if (char === ']' || char === '}' || char === ')') {
      nestingDepth--;
      if (nestingDepth === 0) return idx;
    }
  }

  return -1;
}

/**
 * Finds the closing quote position for a string literal or template string opened at `atIndex`.
 * Handles escaped characters and `${...}` expressions inside template literals.
 */
export function skipString(content: string, atIndex: number): number {
  const quoteChar = content[atIndex]!;

  for (let idx = atIndex + 1; idx < content.length; idx++) {
    const char = content[idx]!;
    if (char === '\\') {
      idx++;
      continue;
    }

    if (char === quoteChar) {
      return idx;
    }

    if (quoteChar === '`' && char === '$' && content[idx + 1] === '{') {
      const expressionEnd = matchBracket(content, idx + 1);
      if (expressionEnd < 0) return -1;
      idx = expressionEnd;
    }
  }

  return -1;
}

/**
 * Yields range spans `{ start, end }` for every top-level curly-brace object literal `{ ... }` within `[from, to)`.
 */
export function* topLevelObjects(
  content: string,
  from: number,
  to: number
): Generator<{ start: number; end: number }> {
  for (let idx = from; idx < to; idx++) {
    const char = content[idx]!;

    if (char === '"' || char === "'" || char === '`') {
      const stringEnd = skipString(content, idx);
      if (stringEnd < 0) return;
      idx = stringEnd;
      continue;
    }

    if (char === '{') {
      const objectEnd = matchBracket(content, idx);
      if (objectEnd < 0) return;
      yield { start: idx, end: objectEnd };
      idx = objectEnd;
    }
  }
}

/**
 * Parses direct key-value property assignments within `{ ... }` located at `[start, end]`.
 * Stepping over nested structures, returning a map of property keys to their text values and character offsets.
 */
export function readFields(
  content: string,
  start: number,
  end: number
): Map<string, { text: string; at: number }> {
  const propertyMap = new Map<string, { text: string; at: number }>();
  let cursor = start + 1;

  while (cursor < end) {
    const char = content[cursor]!;

    if (char === '"' || char === "'" || char === '`') {
      const stringClose = skipString(content, cursor);
      if (stringClose < 0) return propertyMap;
      cursor = stringClose + 1;
      continue;
    }

    if (char === '{' || char === '[' || char === '(') {
      const bracketClose = matchBracket(content, cursor);
      if (bracketClose < 0) return propertyMap;
      cursor = bracketClose + 1;
      continue;
    }

    const keyMatch = /^([A-Za-z_$][\w$]*)\s*:/.exec(content.slice(cursor, cursor + 64));
    if (!keyMatch) {
      cursor++;
      continue;
    }

    const propertyKey = keyMatch[1]!;
    let valueCursor = cursor + keyMatch[0].length;
    const valueStartPos = valueCursor;

    while (valueCursor < end) {
      const valChar = content[valueCursor]!;

      if (valChar === '"' || valChar === "'" || valChar === '`') {
        const valStringClose = skipString(content, valueCursor);
        if (valStringClose < 0) return propertyMap;
        valueCursor = valStringClose + 1;
        continue;
      }

      if (valChar === '{' || valChar === '[' || valChar === '(') {
        const valBracketClose = matchBracket(content, valueCursor);
        if (valBracketClose < 0) return propertyMap;
        valueCursor = valBracketClose + 1;
        continue;
      }

      if (valChar === ',') break;
      valueCursor++;
    }

    if (!propertyMap.has(propertyKey)) {
      propertyMap.set(propertyKey, {
        text: content.slice(valueStartPos, valueCursor),
        at: cursor,
      });
    }

    cursor = valueCursor + 1;
  }

  return propertyMap;
}
