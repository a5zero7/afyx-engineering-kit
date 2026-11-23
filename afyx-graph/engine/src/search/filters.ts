/**
 * Field-qualified search queries.
 *
 *     kind:function name:auth path:src/api authenticate
 *
 * splits into structured filters plus the remaining free text. Filters of the
 * same field are alternatives (OR); different fields narrow together (AND).
 *
 *   kind:   an exact node kind                       lang: / language:  a language id (any case)
 *   path:   substring of the file path               name:              substring of the symbol name
 *
 * A field prefix that is unknown, has an unrecognised kind/language value or an
 * empty value is ordinary text. Double quotes keep whitespace inside one token
 * (`path:"my dir/file"`); an unterminated quote swallows the rest of the input.
 * Parsing never throws.
 */

import { NODE_KINDS, LANGUAGES } from '../types';
import type { NodeKind, Language } from '../types';

export interface ParsedQuery {
  /** Free-text remainder for full-text search; may be empty. */
  text: string;
  kinds: NodeKind[];
  languages: Language[];
  /** Case-insensitive substrings of the file path. */
  pathFilters: string[];
  /** Case-insensitive substrings of the symbol name. */
  nameFilters: string[];
}

const KINDS: ReadonlySet<string> = new Set(NODE_KINDS);
const LANGUAGE_IDS: ReadonlySet<string> = new Set(LANGUAGES);

/** Split on whitespace except while a double-quoted span is open. */
function queryTokens(raw: string): string[] {
  const tokens: string[] = [];
  let start = -1;
  let quoted = false;
  for (let index = 0; index < raw.length; index++) {
    const char = raw[index]!;
    if (char === '"') quoted = !quoted;
    if (/\s/.test(char) && !quoted) {
      if (start >= 0) tokens.push(raw.slice(start, index));
      start = -1;
    } else if (start < 0) {
      start = index;
    }
  }
  if (start >= 0) tokens.push(raw.slice(start));
  return tokens;
}

function fieldValue(token: string, colon: number): string {
  const value = token.slice(colon + 1);
  return value.length >= 2 && value[0] === '"' && value[value.length - 1] === '"'
    ? value.slice(1, -1)
    : value;
}

function consumeField(field: string, value: string, parsed: ParsedQuery): boolean {
  switch (field) {
    case 'kind':
      if (!KINDS.has(value)) return false;
      parsed.kinds.push(value as NodeKind);
      return true;
    case 'lang':
    case 'language': {
      const normalized = value.toLowerCase();
      if (!LANGUAGE_IDS.has(normalized)) return false;
      parsed.languages.push(normalized as Language);
      return true;
    }
    case 'path':
      parsed.pathFilters.push(value);
      return true;
    case 'name':
      parsed.nameFilters.push(value);
      return true;
    default:
      return false;
  }
}

export function parseQuery(raw: string): ParsedQuery {
  const parsed: ParsedQuery = { text: '', kinds: [], languages: [], pathFilters: [], nameFilters: [] };
  const freeText: string[] = [];

  for (const token of queryTokens(raw)) {
    const colon = token.indexOf(':');
    if (colon <= 0 || colon === token.length - 1) {
      freeText.push(token);
      continue;
    }
    const value = fieldValue(token, colon);
    if (!value || !consumeField(token.slice(0, colon).toLowerCase(), value, parsed)) freeText.push(token);
  }

  parsed.text = freeText.join(' ').trim();
  return parsed;
}
