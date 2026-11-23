/**
 * Parse the intentionally small Python literal subset used by indexed class
 * assignments. This is not a Python evaluator: dynamic expressions, aliases,
 * concatenation, interpolation, escapes, dictionaries, and mixed containers
 * stay unresolved instead of being guessed.
 */
export function parsePythonStaticStringValues(expression: string): string[] | null {
  const value = expression.trim();
  const scalar = parsePlainString(value);
  if (scalar !== null) return [scalar];

  const bracketed = value.match(/^([\[(])([\s\S]*)([\])])$/u);
  if (!bracketed) return null;
  if ((bracketed[1] === '[' && bracketed[3] !== ']') ||
      (bracketed[1] === '(' && bracketed[3] !== ')')) return null;

  const body = bracketed[2]!.trim();
  if (!body) return [];
  const values: string[] = [];
  let cursor = 0;
  while (cursor < body.length) {
    while (/\s/u.test(body[cursor] ?? '')) cursor += 1;
    const quote = body[cursor];
    if (quote !== "'" && quote !== '"') return null;
    const end = body.indexOf(quote, cursor + 1);
    if (end < 0) return null;
    const item = body.slice(cursor, end + 1);
    const parsed = parsePlainString(item);
    if (parsed === null) return null;
    values.push(parsed);
    cursor = end + 1;
    while (/\s/u.test(body[cursor] ?? '')) cursor += 1;
    if (cursor >= body.length) break;
    if (body[cursor] !== ',') return null;
    cursor += 1;
    while (/\s/u.test(body[cursor] ?? '')) cursor += 1;
    if (cursor >= body.length) break; // trailing comma
  }
  return values;
}

function parsePlainString(value: string): string | null {
  if (value.length < 2) return null;
  const quote = value[0];
  if ((quote !== "'" && quote !== '"') || value.at(-1) !== quote) return null;
  const body = value.slice(1, -1);
  return body.includes('\\') || body.includes('\n') || body.includes('\r') ? null : body;
}
