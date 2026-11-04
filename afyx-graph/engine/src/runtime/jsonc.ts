/**
 * Afyx-owned JSONC reader/editor for provider configuration.
 *
 * This deliberately implements only JSON values plus comments/trailing commas,
 * and one mutation operation: set or remove an object property path. Edits are
 * range-local so unrelated user text is never reserialized.
 */

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type TokenKind = '{' | '}' | '[' | ']' | ':' | ',' | 'string' | 'number' | 'literal' | 'eof';

interface Token {
  kind: TokenKind;
  start: number;
  end: number;
  value?: JsonValue;
}

interface JsonNode {
  type: 'object' | 'array' | 'value';
  start: number;
  end: number;
  value: JsonValue;
  properties?: JsonProperty[];
}

interface JsonProperty {
  key: string;
  start: number;
  end: number;
  value: JsonNode;
  commaAfter?: Token;
  commaBefore?: Token;
}

class JsoncSyntaxError extends Error {}

class Scanner {
  private at = 0;

  constructor(private readonly text: string) {}

  private skipTrivia(): void {
    while (this.at < this.text.length) {
      const character = this.text[this.at]!;
      if (/\s/.test(character)) {
        this.at++;
      } else if (character === '/' && this.text[this.at + 1] === '/') {
        this.at += 2;
        while (this.at < this.text.length && !/[\r\n]/.test(this.text[this.at]!)) this.at++;
      } else if (character === '/' && this.text[this.at + 1] === '*') {
        const end = this.text.indexOf('*/', this.at + 2);
        if (end < 0) throw new JsoncSyntaxError('unterminated block comment');
        this.at = end + 2;
      } else {
        break;
      }
    }
  }

  next(): Token {
    this.skipTrivia();
    const start = this.at;
    if (start >= this.text.length) return { kind: 'eof', start, end: start };
    const character = this.text[this.at++]!;
    if ('{}[]:,'.includes(character)) {
      return { kind: character as TokenKind, start, end: this.at };
    }
    if (character === '"') {
      let escaped = false;
      while (this.at < this.text.length) {
        const current = this.text[this.at++]!;
        if (!escaped && current === '"') {
          const raw = this.text.slice(start, this.at);
          try {
            return { kind: 'string', start, end: this.at, value: JSON.parse(raw) as string };
          } catch {
            throw new JsoncSyntaxError('invalid JSON string');
          }
        }
        if (!escaped && /[\r\n]/.test(current)) throw new JsoncSyntaxError('newline in JSON string');
        escaped = !escaped && current === '\\';
        if (current !== '\\') escaped = false;
      }
      throw new JsoncSyntaxError('unterminated JSON string');
    }
    if (character === '-' || /[0-9]/.test(character)) {
      while (this.at < this.text.length && /[0-9eE+\-.]/.test(this.text[this.at]!)) this.at++;
      const raw = this.text.slice(start, this.at);
      const value = Number(raw);
      if (!Number.isFinite(value) || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(raw)) {
        throw new JsoncSyntaxError('invalid JSON number');
      }
      return { kind: 'number', start, end: this.at, value };
    }
    for (const [word, value] of [['true', true], ['false', false], ['null', null]] as const) {
      if (this.text.startsWith(word, start)) {
        this.at = start + word.length;
        return { kind: 'literal', start, end: this.at, value };
      }
    }
    throw new JsoncSyntaxError(`unexpected token at offset ${start}`);
  }
}

class Parser {
  private current: Token;

  constructor(private readonly scanner: Scanner) {
    this.current = scanner.next();
  }

  private consume(kind: TokenKind): Token {
    if (this.current.kind !== kind) throw new JsoncSyntaxError(`expected ${kind} at offset ${this.current.start}`);
    const token = this.current;
    this.current = this.scanner.next();
    return token;
  }

  parseDocument(): JsonNode {
    const node = this.parseValue();
    if (this.current.kind !== 'eof') throw new JsoncSyntaxError(`unexpected content at offset ${this.current.start}`);
    return node;
  }

  private parseValue(): JsonNode {
    if (this.current.kind === '{') return this.parseObject();
    if (this.current.kind === '[') return this.parseArray();
    if (this.current.kind === 'string' || this.current.kind === 'number' || this.current.kind === 'literal') {
      const token = this.current;
      this.current = this.scanner.next();
      return { type: 'value', start: token.start, end: token.end, value: token.value! };
    }
    throw new JsoncSyntaxError(`expected JSON value at offset ${this.current.start}`);
  }

  private parseObject(): JsonNode {
    const open = this.consume('{');
    const value: { [key: string]: JsonValue } = {};
    const properties: JsonProperty[] = [];
    let previousComma: Token | undefined;
    while (this.current.kind !== '}') {
      if (this.current.kind === 'eof') throw new JsoncSyntaxError('unterminated object');
      const key = this.consume('string');
      this.consume(':');
      const child = this.parseValue();
      const property: JsonProperty = {
        key: key.value as string,
        start: key.start,
        end: child.end,
        value: child,
        commaBefore: previousComma,
      };
      value[property.key] = child.value;
      properties.push(property);
      if (this.current.kind === ',') {
        const comma = this.consume(',');
        property.commaAfter = comma;
        previousComma = comma;
        if ((this.current.kind as TokenKind) === '}') break;
      } else {
        previousComma = undefined;
        break;
      }
    }
    const close = this.consume('}');
    return { type: 'object', start: open.start, end: close.end, value, properties };
  }

  private parseArray(): JsonNode {
    const open = this.consume('[');
    const value: JsonValue[] = [];
    while (this.current.kind !== ']') {
      if (this.current.kind === 'eof') throw new JsoncSyntaxError('unterminated array');
      value.push(this.parseValue().value);
      if (this.current.kind === ',') {
        this.consume(',');
        if ((this.current.kind as TokenKind) === ']') break;
      } else {
        break;
      }
    }
    const close = this.consume(']');
    return { type: 'array', start: open.start, end: close.end, value };
  }
}

function parseNode(text: string): JsonNode {
  return new Parser(new Scanner(text)).parseDocument();
}

export function parseJsonc(text: string): JsonValue | undefined {
  try {
    return parseNode(text).value;
  } catch {
    return undefined;
  }
}

function property(node: JsonNode, key: string): JsonProperty | undefined {
  return node.type === 'object' ? node.properties?.find((entry) => entry.key === key) : undefined;
}

function lineIndent(text: string, offset: number): string {
  const start = Math.max(text.lastIndexOf('\n', offset - 1), text.lastIndexOf('\r', offset - 1)) + 1;
  return text.slice(start, offset).match(/^[\t ]*/)?.[0] ?? '';
}

function formattedValue(value: unknown, childIndent: string, indentUnit: string, eol: string): string {
  const raw = JSON.stringify(value, null, indentUnit);
  if (raw === undefined) throw new Error('Afyx JSONC cannot serialize this value');
  return raw.replace(/\n/g, eol + childIndent);
}

function nestedValue(path: readonly string[], value: unknown): unknown {
  let result = value;
  for (let index = path.length - 1; index >= 0; index--) result = { [path[index]!]: result };
  return result;
}

function insertProperty(text: string, object: JsonNode, key: string, value: unknown): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const close = object.end - 1;
  const baseIndent = lineIndent(text, close);
  const first = object.properties?.[0];
  const childIndent = first ? lineIndent(text, first.start) : `${baseIndent}  `;
  const indentUnit = childIndent.startsWith(baseIndent) && childIndent.length > baseIndent.length
    ? childIndent.slice(baseIndent.length)
    : '  ';
  const entry = `${JSON.stringify(key)}: ${formattedValue(value, childIndent, indentUnit, eol)}`;
  const properties = object.properties ?? [];
  if (properties.length === 0) {
    return text.slice(0, close) + `${eol}${childIndent}${entry}${eol}${baseIndent}` + text.slice(close);
  }
  const last = properties[properties.length - 1]!;
  const needsComma = !last.commaAfter;
  const insertionPoint = close - baseIndent.length;
  let prefix = text.slice(0, insertionPoint);
  if (needsComma) {
    prefix = text.slice(0, last.end) + ',' + text.slice(last.end, insertionPoint);
  }
  const separator = prefix.endsWith(eol) ? '' : eol;
  return prefix + separator + `${childIndent}${entry}${eol}` + text.slice(insertionPoint);
}

function removeProperty(text: string, entry: JsonProperty): string {
  if (entry.commaAfter) return text.slice(0, entry.start) + text.slice(entry.commaAfter.end);
  if (entry.commaBefore) return text.slice(0, entry.commaBefore.start) + text.slice(entry.end);
  return text.slice(0, entry.start) + text.slice(entry.end);
}

/** Set `value`, or remove the property when `value` is undefined. */
export function updateJsoncPath(text: string, path: readonly string[], value: unknown): string {
  if (path.length === 0) throw new Error('Afyx JSONC path must not be empty');
  let root: JsonNode;
  try {
    root = parseNode(text);
  } catch (error) {
    throw new Error(`Refusing to modify malformed JSONC: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (root.type !== 'object') throw new Error('Refusing to modify JSONC whose root is not an object');

  let node = root;
  for (let index = 0; index < path.length; index++) {
    const key = path[index]!;
    const entry = property(node, key);
    const final = index === path.length - 1;
    if (final) {
      if (value === undefined) return entry ? removeProperty(text, entry) : text;
      if (entry) {
        const replacement = formattedValue(value, lineIndent(text, entry.value.start), '  ', text.includes('\r\n') ? '\r\n' : '\n');
        return text.slice(0, entry.value.start) + replacement + text.slice(entry.value.end);
      }
      return insertProperty(text, node, key, value);
    }
    if (!entry) return insertProperty(text, node, key, nestedValue(path.slice(index + 1), value));
    if (entry.value.type !== 'object') {
      if (value === undefined) return text;
      const replacement = nestedValue(path.slice(index + 1), value);
      const serialized = formattedValue(replacement, lineIndent(text, entry.value.start), '  ', text.includes('\r\n') ? '\r\n' : '\n');
      return text.slice(0, entry.value.start) + serialized + text.slice(entry.value.end);
    }
    node = entry.value;
  }
  return text;
}
