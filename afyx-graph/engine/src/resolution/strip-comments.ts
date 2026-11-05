/**
 * AFYX Engineering Kit - Comment & String Content Neutralization
 *
 * Provides offset-preserving comment and string literal blanking across supported programming languages,
 * ensuring regular expression extractors operate on code statements without false positives from comments or docstrings.
 */

/**
 * Replaces non-newline characters within string literals with whitespace, preserving source offsets.
 */
export function blankStringContents(text: string): string {
  const characters = text.split('');
  let idx = 0;
  const len = text.length;

  while (idx < len) {
    const ch = text[idx]!;

    // Distinguish JavaScript regular expression literals from division operator
    if (
      ch === '/' &&
      /(?:^|[=(:,)!&|?;{}\[\]+*%~^<>-]|\b(?:return|throw|case|yield|await|else|do|typeof|void|delete|new|in|of|instanceof))\s*$/.test(
        text.slice(Math.max(0, idx - 32), idx)
      )
    ) {
      let scanEnd = idx + 1;
      let inCharClass = false;

      for (; scanEnd < len && text[scanEnd] !== '\n'; scanEnd++) {
        if (text[scanEnd] === '\\') {
          scanEnd++;
          continue;
        }
        if (text[scanEnd] === '[') inCharClass = true;
        if (text[scanEnd] === ']') inCharClass = false;
        if (text[scanEnd] === '/' && !inCharClass) break;
      }

      if (scanEnd < len && text[scanEnd] === '/') {
        idx = scanEnd + 1;
        continue;
      }
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      const quoteType = ch;
      idx++;

      while (idx < len && text[idx] !== quoteType) {
        if (text[idx] === '\\' && idx + 1 < len) {
          characters[idx] = ' ';
          characters[idx + 1] = ' ';
          idx += 2;
          continue;
        }
        if (quoteType !== '`' && text[idx] === '\n') break;
        if (text[idx] !== '\n') {
          characters[idx] = ' ';
        }
        idx++;
      }

      if (idx < len && text[idx] === quoteType) {
        idx++;
      }
      continue;
    }

    idx++;
  }

  return characters.join('');
}

export type CommentLang =
  | 'python'
  | 'javascript'
  | 'typescript'
  | 'php'
  | 'ruby'
  | 'java'
  | 'csharp'
  | 'swift'
  | 'go'
  | 'rust'
  | 'c'
  | 'cpp'
  | 'erlang';

/**
 * Replaces comments with spaces while retaining exact character offsets and newlines.
 */
export function stripCommentsForRegex(content: string, lang: CommentLang): string {
  switch (lang) {
    case 'python':
      return maskPythonComments(content);
    case 'ruby':
      return maskRubyComments(content);
    case 'rust':
      return maskRustComments(content);
    case 'erlang':
      return maskErlangComments(content);
    case 'php':
      return maskPhpComments(content);
    case 'go':
      return maskGoComments(content);
    case 'javascript':
    case 'typescript':
    case 'java':
    case 'csharp':
    case 'swift':
    case 'c':
    case 'cpp':
      return maskCStyleComments(content, lang === 'javascript' || lang === 'typescript');
    default:
      return content;
  }
}

function fillSpacesPreservingNewlines(
  buffer: string[],
  startIndex: number,
  endIndex: number,
  originalText: string
): void {
  for (let pos = startIndex; pos < endIndex; pos++) {
    buffer[pos] = originalText[pos] === '\n' ? '\n' : ' ';
  }
}

/* ------------------------------------------------------------- Python -- */

function maskPythonComments(source: string): string {
  const chars = source.split('');
  let idx = 0;
  const len = source.length;

  while (idx < len) {
    const c1 = source[idx]!;
    const c2 = source[idx + 1] ?? '';
    const c3 = source[idx + 2] ?? '';

    // Triple-quoted multi-line strings / docstrings
    if ((c1 === '"' || c1 === "'") && c2 === c1 && c3 === c1) {
      const quoteChar = c1;
      const startPos = idx;
      idx += 3;

      while (idx < len) {
        if (source[idx] === '\\' && idx + 1 < len) {
          idx += 2;
          continue;
        }
        if (source[idx] === quoteChar && source[idx + 1] === quoteChar && source[idx + 2] === quoteChar) {
          idx += 3;
          break;
        }
        idx++;
      }

      fillSpacesPreservingNewlines(chars, startPos, idx, source);
      continue;
    }

    // Standard single-line strings
    if (c1 === '"' || c1 === "'") {
      const quoteChar = c1;
      idx++;
      while (idx < len && source[idx] !== quoteChar) {
        if (source[idx] === '\\' && idx + 1 < len) {
          idx += 2;
          continue;
        }
        if (source[idx] === '\n') break;
        idx++;
      }
      if (idx < len && source[idx] === quoteChar) idx++;
      continue;
    }

    // Hash comment
    if (c1 === '#') {
      const startPos = idx;
      while (idx < len && source[idx] !== '\n') idx++;
      fillSpacesPreservingNewlines(chars, startPos, idx, source);
      continue;
    }

    idx++;
  }

  return chars.join('');
}

/* -------------------------------------------------------------- Ruby -- */

function maskRubyComments(source: string): string {
  const chars = source.split('');
  let idx = 0;
  const len = source.length;
  let isLineStart = true;

  while (idx < len) {
    const ch = source[idx]!;

    // =begin ... =end block comments
    if (isLineStart && ch === '=' && source.startsWith('=begin', idx)) {
      const startPos = idx;
      idx += '=begin'.length;

      while (idx < len) {
        if (source[idx] === '\n') {
          let lookahead = idx + 1;
          while (lookahead < len && (source[lookahead] === ' ' || source[lookahead] === '\t')) {
            lookahead++;
          }
          if (source.startsWith('=end', lookahead)) {
            idx = lookahead + '=end'.length;
            while (idx < len && source[idx] !== '\n') idx++;
            break;
          }
        }
        idx++;
      }

      fillSpacesPreservingNewlines(chars, startPos, idx, source);
      isLineStart = idx > 0 && source[idx - 1] === '\n';
      continue;
    }

    if (ch === '"' || ch === "'") {
      const quoteChar = ch;
      idx++;
      while (idx < len && source[idx] !== quoteChar) {
        if (source[idx] === '\\' && idx + 1 < len) {
          idx += 2;
          continue;
        }
        if (source[idx] === '\n') break;
        idx++;
      }
      if (idx < len && source[idx] === quoteChar) idx++;
      isLineStart = false;
      continue;
    }

    if (ch === '#') {
      const startPos = idx;
      while (idx < len && source[idx] !== '\n') idx++;
      fillSpacesPreservingNewlines(chars, startPos, idx, source);
      isLineStart = false;
      continue;
    }

    if (ch === '\n') {
      isLineStart = true;
      idx++;
      continue;
    }
    if (ch === ' ' || ch === '\t') {
      idx++;
      continue;
    }

    isLineStart = false;
    idx++;
  }

  return chars.join('');
}

/* ------------------------------------------------------------ C-Style -- */

function maskCStyleComments(source: string, allowSingleQuoteString: boolean): string {
  const chars = source.split('');
  let idx = 0;
  const len = source.length;

  while (idx < len) {
    const c1 = source[idx]!;
    const c2 = source[idx + 1] ?? '';

    // Block comments /* ... */
    if (c1 === '/' && c2 === '*') {
      const startPos = idx;
      idx += 2;
      while (idx < len && !(source[idx] === '*' && source[idx + 1] === '/')) {
        idx++;
      }
      if (idx < len) idx += 2;
      fillSpacesPreservingNewlines(chars, startPos, idx, source);
      continue;
    }

    // Line comments // ...
    if (c1 === '/' && c2 === '/') {
      const startPos = idx;
      while (idx < len && source[idx] !== '\n') idx++;
      fillSpacesPreservingNewlines(chars, startPos, idx, source);
      continue;
    }

    // String / template literals
    if (c1 === '"' || (allowSingleQuoteString && c1 === "'") || c1 === '`') {
      const quoteChar = c1;
      idx++;
      while (idx < len && source[idx] !== quoteChar) {
        if (source[idx] === '\\' && idx + 1 < len) {
          idx += 2;
          continue;
        }
        if (quoteChar !== '`' && source[idx] === '\n') break;
        idx++;
      }
      if (idx < len && source[idx] === quoteChar) idx++;
      continue;
    }

    idx++;
  }

  return chars.join('');
}

/* --------------------------------------------------------------- PHP -- */

function maskPhpComments(source: string): string {
  const chars = source.split('');
  let idx = 0;
  const len = source.length;

  while (idx < len) {
    const c1 = source[idx]!;
    const c2 = source[idx + 1] ?? '';

    // Block comment
    if (c1 === '/' && c2 === '*') {
      const startPos = idx;
      idx += 2;
      while (idx < len && !(source[idx] === '*' && source[idx + 1] === '/')) {
        idx++;
      }
      if (idx < len) idx += 2;
      fillSpacesPreservingNewlines(chars, startPos, idx, source);
      continue;
    }

    // // line comment
    if (c1 === '/' && c2 === '/') {
      const startPos = idx;
      while (idx < len && source[idx] !== '\n') idx++;
      fillSpacesPreservingNewlines(chars, startPos, idx, source);
      continue;
    }

    // # line comment
    if (c1 === '#') {
      const startPos = idx;
      while (idx < len && source[idx] !== '\n') idx++;
      fillSpacesPreservingNewlines(chars, startPos, idx, source);
      continue;
    }

    // String literals
    if (c1 === '"' || c1 === "'" || c1 === '`') {
      const quoteChar = c1;
      idx++;
      while (idx < len && source[idx] !== quoteChar) {
        if (source[idx] === '\\' && idx + 1 < len) {
          idx += 2;
          continue;
        }
        if (source[idx] === '\n') break;
        idx++;
      }
      if (idx < len && source[idx] === quoteChar) idx++;
      continue;
    }

    idx++;
  }

  return chars.join('');
}

/* ---------------------------------------------------------------- Go -- */

function maskGoComments(source: string): string {
  const chars = source.split('');
  let idx = 0;
  const len = source.length;

  while (idx < len) {
    const c1 = source[idx]!;
    const c2 = source[idx + 1] ?? '';

    // Block comment
    if (c1 === '/' && c2 === '*') {
      const startPos = idx;
      idx += 2;
      while (idx < len && !(source[idx] === '*' && source[idx + 1] === '/')) {
        idx++;
      }
      if (idx < len) idx += 2;
      fillSpacesPreservingNewlines(chars, startPos, idx, source);
      continue;
    }

    // Line comment
    if (c1 === '/' && c2 === '/') {
      const startPos = idx;
      while (idx < len && source[idx] !== '\n') idx++;
      fillSpacesPreservingNewlines(chars, startPos, idx, source);
      continue;
    }

    // Raw backtick string
    if (c1 === '`') {
      idx++;
      while (idx < len && source[idx] !== '`') idx++;
      if (idx < len) idx++;
      continue;
    }

    // Double quoted string
    if (c1 === '"') {
      idx++;
      while (idx < len && source[idx] !== '"') {
        if (source[idx] === '\\' && idx + 1 < len) {
          idx += 2;
          continue;
        }
        if (source[idx] === '\n') break;
        idx++;
      }
      if (idx < len && source[idx] === '"') idx++;
      continue;
    }

    // Rune literal
    if (c1 === "'") {
      idx++;
      while (idx < len && source[idx] !== "'") {
        if (source[idx] === '\\' && idx + 1 < len) {
          idx += 2;
          continue;
        }
        if (source[idx] === '\n') break;
        idx++;
      }
      if (idx < len && source[idx] === "'") idx++;
      continue;
    }

    idx++;
  }

  return chars.join('');
}

/* -------------------------------------------------------------- Rust -- */

function maskRustComments(source: string): string {
  const chars = source.split('');
  let idx = 0;
  const len = source.length;

  while (idx < len) {
    const c1 = source[idx]!;
    const c2 = source[idx + 1] ?? '';

    // Nested block comments /* ... /* ... */ ... */
    if (c1 === '/' && c2 === '*') {
      const startPos = idx;
      idx += 2;
      let nestDepth = 1;

      while (idx < len && nestDepth > 0) {
        if (source[idx] === '/' && source[idx + 1] === '*') {
          nestDepth++;
          idx += 2;
        } else if (source[idx] === '*' && source[idx + 1] === '/') {
          nestDepth--;
          idx += 2;
        } else {
          idx++;
        }
      }

      fillSpacesPreservingNewlines(chars, startPos, idx, source);
      continue;
    }

    // Line comment
    if (c1 === '/' && c2 === '/') {
      const startPos = idx;
      while (idx < len && source[idx] !== '\n') idx++;
      fillSpacesPreservingNewlines(chars, startPos, idx, source);
      continue;
    }

    // String literal
    if (c1 === '"') {
      idx++;
      while (idx < len && source[idx] !== '"') {
        if (source[idx] === '\\' && idx + 1 < len) {
          idx += 2;
          continue;
        }
        idx++;
      }
      if (idx < len && source[idx] === '"') idx++;
      continue;
    }

    // Char literal or lifetime
    if (c1 === "'") {
      idx++;
      while (idx < len && source[idx] !== "'") {
        if (source[idx] === '\\' && idx + 1 < len) {
          idx += 2;
          continue;
        }
        if (source[idx] === '\n') break;
        idx++;
      }
      if (idx < len && source[idx] === "'") idx++;
      continue;
    }

    idx++;
  }

  return chars.join('');
}

/* ------------------------------------------------------------ Erlang -- */

function maskErlangComments(source: string): string {
  const chars = source.split('');
  let idx = 0;
  const len = source.length;

  while (idx < len) {
    const ch = source[idx];

    if (ch === '"' || ch === "'") {
      const quoteChar = ch;
      idx++;
      while (idx < len && source[idx] !== quoteChar) {
        if (source[idx] === '\\' && idx + 1 < len) {
          idx += 2;
          continue;
        }
        idx++;
      }
      if (idx < len) idx++;
      continue;
    }

    // Character literal $x, $\n, $%
    if (ch === '$') {
      idx++;
      if (idx < len && source[idx] === '\\') idx++;
      idx++;
      continue;
    }

    if (ch === '%') {
      let lineEnd = idx;
      while (lineEnd < len && source[lineEnd] !== '\n') lineEnd++;
      fillSpacesPreservingNewlines(chars, idx, lineEnd, source);
      idx = lineEnd;
      continue;
    }

    idx++;
  }

  return chars.join('');
}
