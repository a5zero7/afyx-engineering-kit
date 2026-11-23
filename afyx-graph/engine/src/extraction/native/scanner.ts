export type NativeTokenKind = 'identifier' | 'number' | 'string' | 'comment' | 'punctuation';

export interface NativePosition {
  readonly offset: number;
  readonly line: number;
  readonly column: number;
}

export interface NativeToken {
  readonly kind: NativeTokenKind;
  readonly text: string;
  readonly start: NativePosition;
  readonly end: NativePosition;
}

export interface NativeScanResult {
  readonly tokens: readonly NativeToken[];
  readonly pairs: ReadonlyMap<number, number>;
  readonly unterminated: readonly ('string' | 'comment' | 'delimiter')[];
}

export interface NativeScanOptions {
  /** Treat `#` through end-of-line as a comment (Python/Ruby/R-style). */
  readonly hashComments?: boolean;
  /** Recognize Rust lifetimes, raw strings, and nested block comments. */
  readonly rustSyntax?: boolean;
  /** Consume Kotlin/Scala-style triple-quoted strings as one opaque token. */
  readonly tripleQuotedStrings?: boolean;
  /** Treat Kotlin backtick-escaped names as identifier tokens. */
  readonly backtickIdentifiers?: boolean;
  /** Consume C++ raw string literals, including custom delimiters. */
  readonly cppRawStrings?: boolean;
  /** Consume C# verbatim/interpolated string prefixes and doubled quotes. */
  readonly csharpStrings?: boolean;
  /** Recognize Swift raw/multiline strings and nested block comments. */
  readonly swiftSyntax?: boolean;
  /** Recognize Lua/Luau line comments plus long-bracket comments and strings. */
  readonly luaSyntax?: boolean;
  /** Consume Dart raw and triple-quoted strings as opaque regions. */
  readonly dartSyntax?: boolean;
  /** Consume Nix indented strings (`''...''`) as opaque regions. */
  readonly nixSyntax?: boolean;
  /** Recognize Pascal brace/paren comments and doubled-quote strings. */
  readonly pascalSyntax?: boolean;
  /** Recognize VB.NET comments, doubled-quote strings, bracketed names, and XML literals. */
  readonly vbnetSyntax?: boolean;
  /** Recognize Erlang percent comments, quoted atoms, and character literals. */
  readonly erlangSyntax?: boolean;
  /** Recognize HCL heredocs and hyphenated identifiers. */
  readonly hclSyntax?: boolean;
  /** Consume JavaScript-family regular-expression literals as opaque regions. */
  readonly javascriptRegex?: boolean;
}

const OPEN_TO_CLOSE: Readonly<Record<string, string>> = { '(': ')', '[': ']', '{': '}' };
const CLOSE = new Set(Object.values(OPEN_TO_CLOSE));

function isIdentifierStart(char: string): boolean {
  return /[$_\p{ID_Start}]/u.test(char);
}

function isIdentifierContinue(char: string): boolean {
  return /[$\u200C\u200D_\p{ID_Continue}]/u.test(char);
}

/**
 * Dependency-free lexical scan used by Afyx-native fact recognizers.
 *
 * Offsets and columns use JavaScript string indexes (UTF-16 code units), which
 * preserves the graph's established browser/LSP-facing position contract.
 * Comments and strings are consumed as opaque regions so syntax-looking text
 * inside them cannot become declarations or references.
 */
export function scanSource(source: string, options: NativeScanOptions = {}): NativeScanResult {
  const tokens: NativeToken[] = [];
  const pairs = new Map<number, number>();
  const stack: Array<{ token: number; close: string }> = [];
  const unterminated: Array<'string' | 'comment' | 'delimiter'> = [];
  let offset = 0;
  let line = 1;
  let column = 0;

  const position = (): NativePosition => ({ offset, line, column });
  const advance = (): string => {
    const char = source[offset++] ?? '';
    if (char === '\n') {
      line += 1;
      column = 0;
    } else {
      column += 1;
    }
    return char;
  };
  const emit = (kind: NativeTokenKind, start: NativePosition): void => {
    tokens.push({ kind, text: source.slice(start.offset, offset), start, end: position() });
  };

  while (offset < source.length) {
    const char = source[offset]!;
    const next = source[offset + 1];

    if (/\s/u.test(char)) {
      advance();
      continue;
    }

    if (options.erlangSyntax && char === '%') {
      const start = position();
      while (offset < source.length && source[offset] !== '\n') advance();
      emit('comment', start);
      continue;
    }

    // Erlang character literals are values, not identifier/punctuation input.
    // Consume the optional escape and its payload without trying to interpret it.
    if (options.erlangSyntax && char === '$') {
      const start = position();
      advance();
      if (offset < source.length) {
        if (source[offset] === '\\') advance();
        if (offset < source.length) advance();
      }
      emit('string', start);
      continue;
    }

    if (options.hclSyntax && char === '<' && next === '<') {
      const opening = /^<<-?([A-Za-z_][\w-]*)[ \t]*\r?\n/u.exec(source.slice(offset));
      if (opening) {
        const start = position();
        const delimiter = opening[1]!;
        for (let index = 0; index < opening[0].length; index += 1) advance();
        const closing = new RegExp(`^[ \\t]*${delimiter}[ \\t]*(?:\\r?$)`, 'mu').exec(source.slice(offset));
        if (!closing) {
          while (offset < source.length) advance();
          emit('string', start);
          unterminated.push('string');
          continue;
        }
        const end = offset + closing.index + closing[0].length;
        while (offset < end) advance();
        if (source[offset] === '\r') advance();
        if (source[offset] === '\n') advance();
        emit('string', start);
        continue;
      }
    }

    if (char === '/' && next === '/') {
      const start = position();
      advance();
      advance();
      while (offset < source.length && source[offset] !== '\n') advance();
      emit('comment', start);
      continue;
    }

    if (char === '/' && next === '*') {
      const start = position();
      advance();
      advance();
      let closed = false;
      let depth = 1;
      while (offset < source.length) {
        if ((options.rustSyntax || options.swiftSyntax) && source[offset] === '/' && source[offset + 1] === '*') {
          advance();
          advance();
          depth += 1;
          continue;
        }
        if (source[offset] === '*' && source[offset + 1] === '/') {
          advance();
          advance();
          depth -= 1;
          if (depth === 0) {
            closed = true;
            break;
          }
          continue;
        }
        advance();
      }
      emit('comment', start);
      if (!closed) unterminated.push('comment');
      continue;
    }

    if (options.pascalSyntax && (char === '{' || (char === '(' && next === '*'))) {
      const start = position();
      const parenComment = char === '(';
      advance();
      if (parenComment) advance();
      let closed = false;
      while (offset < source.length) {
        if ((!parenComment && source[offset] === '}') ||
            (parenComment && source[offset] === '*' && source[offset + 1] === ')')) {
          advance();
          if (parenComment) advance();
          closed = true;
          break;
        }
        advance();
      }
      emit('comment', start);
      if (!closed) unterminated.push('comment');
      continue;
    }

    if (options.vbnetSyntax && char === "'") {
      const start = position();
      while (offset < source.length && source[offset] !== '\n') advance();
      emit('comment', start);
      continue;
    }

    if (options.vbnetSyntax && /^rem(?:\s|$)/i.test(source.slice(offset))) {
      const previous = tokens.at(-1);
      if (!previous || previous.end.line < line || previous.text === ':') {
        const start = position();
        while (offset < source.length && source[offset] !== '\n') advance();
        emit('comment', start);
        continue;
      }
    }

    // Afyx does not consume XML-literal internals. Keep a well-formed root
    // literal opaque, while bounding incomplete editor input to one line.
    if (options.vbnetSyntax && char === '<') {
      const opening = /^<([A-Za-z_][\w.-]*)(?:\s[^<>]*?)?>/.exec(source.slice(offset));
      if (opening) {
        const start = position();
        const closePattern = new RegExp(`<\\/${opening[1]}\\s*>`, 'i');
        const tail = source.slice(offset + opening[0].length);
        const close = closePattern.exec(tail);
        const selfClosing = /\/\s*>$/.test(opening[0]);
        const end = selfClosing
          ? offset + opening[0].length
          : close
          ? offset + opening[0].length + close.index + close[0].length
          : source.indexOf('\n', offset) >= 0 ? source.indexOf('\n', offset) : source.length;
        while (offset < end) advance();
        emit('string', start);
        if (!close && !selfClosing) unterminated.push('string');
        continue;
      }
    }

    if (options.luaSyntax && char === '-' && next === '-') {
      const start = position();
      advance();
      advance();
      if (source[offset] === '[') {
        const long = /^\[(=*)\[/.exec(source.slice(offset));
        if (long) {
          for (let index = 0; index < long[0].length; index += 1) advance();
          const close = `]${long[1]}]`;
          const end = source.indexOf(close, offset);
          if (end < 0) {
            while (offset < source.length) advance();
            unterminated.push('comment');
          } else {
            while (offset < end + close.length) advance();
          }
          emit('comment', start);
          continue;
        }
      }
      while (offset < source.length && source[offset] !== '\n') advance();
      emit('comment', start);
      continue;
    }

    if (char === '#' && options.hashComments !== false) {
      const start = position();
      while (offset < source.length && source[offset] !== '\n') advance();
      emit('comment', start);
      continue;
    }

    if (options.rustSyntax && char === 'r' && (next === '"' || next === '#')) {
      let hashCount = 0;
      let quoteOffset = offset + 1;
      while (source[quoteOffset] === '#') {
        hashCount += 1;
        quoteOffset += 1;
      }
      if (source[quoteOffset] === '"') {
        const start = position();
        while (offset <= quoteOffset) advance();
        let closed = false;
        const suffix = `"${'#'.repeat(hashCount)}`;
        while (offset < source.length) {
          if (source.startsWith(suffix, offset)) {
            for (let i = 0; i < suffix.length; i += 1) advance();
            closed = true;
            break;
          }
          advance();
        }
        emit('string', start);
        if (!closed) unterminated.push('string');
        continue;
      }
    }

    if (options.tripleQuotedStrings && char === '"' && source.startsWith('"""', offset)) {
      const start = position();
      advance();
      advance();
      advance();
      let closed = false;
      while (offset < source.length) {
        if (source.startsWith('"""', offset)) {
          advance();
          advance();
          advance();
          closed = true;
          break;
        }
        advance();
      }
      emit('string', start);
      if (!closed) unterminated.push('string');
      continue;
    }

    if (options.swiftSyntax && (char === '"' || char === '#')) {
      let hashCount = 0;
      while (source[offset + hashCount] === '#') hashCount += 1;
      const quoteOffset = offset + hashCount;
      const triple = source.startsWith('"""', quoteOffset);
      if (source[quoteOffset] === '"') {
        const start = position();
        const opening = hashCount + (triple ? 3 : 1);
        for (let i = 0; i < opening; i += 1) advance();
        const suffix = `${triple ? '"""' : '"'}${'#'.repeat(hashCount)}`;
        let closed = false;
        while (offset < source.length) {
          if (source.startsWith(suffix, offset)) {
            for (let i = 0; i < suffix.length; i += 1) advance();
            closed = true;
            break;
          }
          if (hashCount === 0 && !triple && source[offset] === '\\' && offset + 1 < source.length) {
            advance();
            advance();
            continue;
          }
          advance();
        }
        emit('string', start);
        if (!closed) unterminated.push('string');
        continue;
      }
    }

    if (options.dartSyntax) {
      const raw = (char === 'r' || char === 'R') && (next === '"' || next === "'");
      const quoteOffset = raw ? offset + 1 : offset;
      const quote = source[quoteOffset];
      const triple = quote && source.startsWith(quote.repeat(3), quoteOffset);
      if (quote === '"' || quote === "'") {
        const start = position();
        if (raw) advance();
        const opening = triple ? 3 : 1;
        for (let index = 0; index < opening; index += 1) advance();
        const suffix = quote.repeat(opening);
        let closed = false;
        while (offset < source.length) {
          if (source.startsWith(suffix, offset)) {
            for (let index = 0; index < suffix.length; index += 1) advance();
            closed = true;
            break;
          }
          if (!raw && !triple && source[offset] === '\\' && offset + 1 < source.length) {
            advance();
            advance();
          } else {
            advance();
          }
        }
        emit('string', start);
        if (!closed) unterminated.push('string');
        continue;
      }
    }

    if (options.nixSyntax && char === "'" && next === "'") {
      const start = position();
      advance();
      advance();
      let closed = false;
      while (offset < source.length) {
        if (source[offset] === "'" && source[offset + 1] === "'") {
          advance();
          advance();
          closed = true;
          break;
        }
        advance();
      }
      emit('string', start);
      if (!closed) unterminated.push('string');
      continue;
    }

    if (options.cppRawStrings) {
      const raw = /^(?:u8|u|U|L)?R"([^ ()\\\t\r\n]{0,16})\(/.exec(source.slice(offset));
      if (raw) {
        const start = position();
        const prefixLength = raw[0].length;
        for (let i = 0; i < prefixLength; i += 1) advance();
        const terminator = `)${raw[1] ?? ''}"`;
        const end = source.indexOf(terminator, offset);
        if (end < 0) {
          while (offset < source.length) advance();
          emit('string', start);
          unterminated.push('string');
        } else {
          while (offset < end + terminator.length) advance();
          emit('string', start);
        }
        continue;
      }
    }

    if (options.csharpStrings) {
      const prefix = source.startsWith('$@"', offset) || source.startsWith('@$"', offset)
        ? 3
        : source.startsWith('@"', offset) || source.startsWith('$"', offset)
          ? 2
          : 0;
      if (prefix > 0) {
        const start = position();
        const verbatim = source.slice(offset, offset + prefix).includes('@');
        for (let i = 0; i < prefix; i += 1) advance();
        let closed = false;
        while (offset < source.length) {
          if (source[offset] === '"') {
            if (verbatim && source[offset + 1] === '"') {
              advance();
              advance();
              continue;
            }
            advance();
            closed = true;
            break;
          }
          if (!verbatim && source[offset] === '\\' && offset + 1 < source.length) {
            advance();
            advance();
            continue;
          }
          advance();
        }
        emit('string', start);
        if (!closed) unterminated.push('string');
        continue;
      }
    }

    if (options.rustSyntax && char === "'" && next && isIdentifierStart(next)) {
      let cursor = offset + 2;
      while (cursor < source.length && isIdentifierContinue(source[cursor]!)) cursor += 1;
      if (source[cursor] !== "'") {
        const start = position();
        advance();
        emit('punctuation', start);
        continue;
      }
    }

    if (options.backtickIdentifiers && char === '`') {
      const start = position();
      advance();
      let closed = false;
      while (offset < source.length) {
        if (advance() === '`') {
          closed = true;
          break;
        }
      }
      emit('identifier', start);
      if (!closed) unterminated.push('string');
      continue;
    }

    if (options.pascalSyntax && char === "'") {
      const start = position();
      advance();
      let closed = false;
      while (offset < source.length) {
        if (source[offset] === "'") {
          advance();
          if (source[offset] === "'") {
            advance();
            continue;
          }
          closed = true;
          break;
        }
        advance();
      }
      emit('string', start);
      if (!closed) unterminated.push('string');
      continue;
    }

    if (options.vbnetSyntax && (char === '"' || (char === '$' && next === '"'))) {
      const start = position();
      if (char === '$') advance();
      advance();
      let closed = false;
      while (offset < source.length) {
        if (source[offset] === '"') {
          advance();
          if (source[offset] === '"') {
            advance();
            continue;
          }
          closed = true;
          break;
        }
        advance();
      }
      emit('string', start);
      if (!closed) unterminated.push('string');
      continue;
    }

    if (options.vbnetSyntax && char === '[') {
      const start = position();
      advance();
      let closed = false;
      while (offset < source.length && source[offset] !== '\n') {
        if (advance() === ']') {
          closed = true;
          break;
        }
      }
      emit('identifier', start);
      if (!closed) unterminated.push('delimiter');
      continue;
    }

    if (options.javascriptRegex && char === '/') {
      const previous = tokens.at(-1);
      const previousText = previous?.text;
      let startsRegex = previous === undefined ||
        ['=', '(', '[', '{', ',', ':', ';', '!', '?', '&&', '||', '=>', 'return', 'case', 'throw', 'else'].includes(previousText ?? '');
      if (!startsRegex && previousText === ')') {
        const pair = [...pairs.entries()].find(([, close]) => close === tokens.length - 1);
        const beforeOpen = pair === undefined ? undefined : tokens[pair[0] - 1]?.text;
        startsRegex = beforeOpen === 'if' || beforeOpen === 'while';
      }
      if (startsRegex) {
        const start = position();
        advance();
        let escaped = false;
        let inClass = false;
        let closed = false;
        while (offset < source.length && source[offset] !== '\n') {
          const current = advance();
          if (escaped) { escaped = false; continue; }
          if (current === '\\') { escaped = true; continue; }
          if (current === '[') { inClass = true; continue; }
          if (current === ']' && inClass) { inClass = false; continue; }
          if (current === '/' && !inClass) { closed = true; break; }
        }
        if (closed) while (offset < source.length && /[A-Za-z]/.test(source[offset]!)) advance();
        emit('string', start);
        if (!closed) unterminated.push('string');
        continue;
      }
    }

    if (char === '"' || char === "'" || char === '`') {
      const start = position();
      const quote = advance();
      let closed = false;
      while (offset < source.length) {
        const current = advance();
        if (options.erlangSyntax && quote === "'" && current === "'" && source[offset] === "'") {
          advance();
          continue;
        }
        if (current === '\\' && offset < source.length) {
          advance();
          continue;
        }
        if (current === quote) {
          closed = true;
          break;
        }
      }
      emit('string', start);
      if (!closed) unterminated.push('string');
      continue;
    }

    if (options.luaSyntax && char === '[') {
      const long = /^\[(=*)\[/.exec(source.slice(offset));
      if (long) {
        const start = position();
        for (let index = 0; index < long[0].length; index += 1) advance();
        const close = `]${long[1]}]`;
        const end = source.indexOf(close, offset);
        if (end < 0) {
          while (offset < source.length) advance();
          unterminated.push('string');
        } else {
          while (offset < end + close.length) advance();
        }
        emit('string', start);
        continue;
      }
    }

    if (isIdentifierStart(char)) {
      const start = position();
      advance();
      while (offset < source.length) {
        if (isIdentifierContinue(source[offset]!)) {
          advance();
          continue;
        }
        if (options.hclSyntax && source[offset] === '-' && isIdentifierContinue(source[offset + 1] ?? '')) {
          advance();
          continue;
        }
        break;
      }
      emit('identifier', start);
      continue;
    }

    if (/\d/u.test(char)) {
      const start = position();
      advance();
      while (offset < source.length) {
        const current = source[offset]!;
        if (options.erlangSyntax && current === '.' && !/\d/u.test(source[offset + 1] ?? '')) break;
        if (!/[\p{ID_Continue}.]/u.test(current)) break;
        advance();
      }
      emit('number', start);
      continue;
    }

    const start = position();
    const compound = source.slice(offset, offset + 3);
    const compound2 = source.slice(offset, offset + 2);
    const operator = ['>>=', '<<=', '===', '!==', '...', '??=', '&&=', '||=', '<<-', '->>', ':::'].includes(compound)
      ? compound
      : ['=>', '->', '<-', '::', '?.', '??', '&&', '||', '==', '!=', '<=', '>=', '++', '--', '+=', '-=', '*=', '/=', '**', '<<', '>>', ':=', '<>'].includes(compound2)
        ? compound2
        : undefined;
    if (operator) {
      for (let i = 0; i < operator.length; i += 1) advance();
      emit('punctuation', start);
      continue;
    }
    advance();
    emit('punctuation', start);
    const tokenIndex = tokens.length - 1;
    if (char in OPEN_TO_CLOSE) {
      stack.push({ token: tokenIndex, close: OPEN_TO_CLOSE[char]! });
    } else if (CLOSE.has(char)) {
      const opener = stack.at(-1);
      if (opener?.close === char) {
        stack.pop();
        pairs.set(opener.token, tokenIndex);
        pairs.set(tokenIndex, opener.token);
      }
    }
  }

  if (stack.length > 0) unterminated.push('delimiter');
  return { tokens, pairs, unterminated };
}
