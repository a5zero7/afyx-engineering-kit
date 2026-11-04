/** Afyx-owned path-pattern support for product patterns actually accepted by Afyx. */

export interface PathPatternOptions {
  /** Match ASCII case-insensitively. Defaults to the current case-sensitive contract. */
  nocase?: boolean;
}

function regexLiteral(character: string): string {
  return /[\\^$.*+?()[\]{}|]/.test(character) ? `\\${character}` : character;
}

/**
 * Compile the bounded glob grammar used by Cargo workspace members and Afyx
 * path configuration: `*`, `**`, `?`, character classes, and backslash escapes.
 * Braces and extglobs are deliberately rejected instead of being guessed.
 */
export function compilePathPattern(pattern: string, options: PathPatternOptions = {}): RegExp {
  if (pattern.includes('\0')) throw new Error('path pattern contains NUL');
  if (/[{}]/.test(pattern) || /[+@?!*]\(/.test(pattern)) {
    throw new Error(`unsupported path pattern construct: ${pattern}`);
  }

  const normalized = pattern.replace(/\\/g, '/').replace(/^\.\//, '');
  let expression = '^';
  for (let index = 0; index < normalized.length; index++) {
    const character = normalized[index]!;
    if (character === '*') {
      if (normalized[index + 1] === '*') {
        while (normalized[index + 1] === '*') index++;
        if (normalized[index + 1] === '/') {
          index++;
          expression += '(?:[^/]+/)*';
        } else {
          expression += '.*';
        }
      } else {
        expression += '[^/]*';
      }
      continue;
    }
    if (character === '?') {
      expression += '[^/]';
      continue;
    }
    if (character === '[') {
      const end = normalized.indexOf(']', index + 1);
      if (end < 0) throw new Error(`unterminated character class: ${pattern}`);
      let body = normalized.slice(index + 1, end);
      if (!body) throw new Error(`empty character class: ${pattern}`);
      if (body[0] === '!') body = `^${body.slice(1)}`;
      body = body.replace(/\\/g, '\\\\');
      expression += `[${body}]`;
      index = end;
      continue;
    }
    expression += regexLiteral(character);
  }
  expression += '$';
  return new RegExp(expression, options.nocase ? 'i' : '');
}

export function matchesPathPattern(
  pattern: string,
  candidate: string,
  options: PathPatternOptions = {},
): boolean {
  const normalized = candidate.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
  if (!normalized || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    return false;
  }
  return compilePathPattern(pattern, options).test(normalized);
}
