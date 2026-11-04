/**
 * File references inside explore queries.
 *
 * Agents name files by path ("the scroll logic in src/routes/[id]/+page.svelte").
 * If such a span reaches the tokenizers it is shredded into fragments that mint
 * spurious symbol seeds and full-text hits. This module lifts path-like spans out
 * of the query first, resolving each against the INDEXED file list — resolution is
 * the detector, so `and/or` or `gen_server:call/2` resolve to nothing and stay put.
 *
 * Result: files to pin (first-class, in order of appearance, deduplicated), the
 * query with consumed spans removed, and the unambiguously path-shaped spans that
 * resolved to nothing usable (reported instead of silently dropped).
 *
 * Pure string work: no database, no file system.
 */

export interface QueryPathExtraction {
  /** The query with consumed spans removed, joined by single spaces. */
  strippedQuery: string;
  /** Indexed paths the query named. */
  pinnedFiles: string[];
  /** Path-shaped spans that matched no file (or too many) and were stripped. */
  unresolvedPathSpans: string[];
}

const MAX_SUFFIX_DROPS = 8;
const MAX_EXPLICIT_SPANS = 8;
const MAX_REPORTED_UNRESOLVED = 4;
const MIN_SPAN_LENGTH = 4;

const DOTTED_BASENAME = /^[^\s/\\]+\.[A-Za-z][A-Za-z0-9]{0,7}$/;
const KEBAB_BASENAME = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+$/;
const FINAL_EXTENSION = /\.[A-Za-z][A-Za-z0-9]{0,7}$/;
const DIRECT_SOURCE_BASENAME = /\.(?:ps1|psm1|psd1)$/i;

/** Cheap gate: could this query contain a path at all? */
const PATH_HINTS: readonly RegExp[] = [
  /[/\\]/,
  /\.[A-Za-z][A-Za-z0-9]{0,7}(?=[\s,;:)\]'"`]|$)/,
  /(?:^|[^-\w])[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+(?=[^-\w]|$)/,
];

export function queryMightContainPaths(query: string): boolean {
  return PATH_HINTS.some((hint) => hint.test(query));
}

const LEADING_ALWAYS = new Set(['\'', '"', '`', '<']);
const TRAILING_ALWAYS = new Set(['\'', '"', '`', '>', '.', ',', ';', '!', '?']);
const BRACKETS: ReadonlyArray<readonly [open: string, close: string]> = [['(', ')'], ['[', ']'], ['{', '}']];
const LINE_REFERENCE = /(?::\d+(?:-\d+)?|#L\d+(?:-L?\d+)?)$/;

/**
 * Remove prose punctuation around a token without touching punctuation that is
 * part of a path: quotes always go; a bracket goes only when its partner is
 * absent from the token (so `[id]` and `(group)` segments survive); a trailing
 * `:12`, `:12-40` or `#L88` line reference is dropped last.
 */
function unwrap(token: string): string {
  let text = token;
  for (let changed = true; changed;) {
    changed = false;
    const head = text[0];
    if (head === undefined) break;
    const closer = BRACKETS.find(([open]) => open === head)?.[1];
    if (LEADING_ALWAYS.has(head) || (closer !== undefined && !text.includes(closer))) {
      text = text.slice(1);
      changed = true;
    }
  }
  for (let changed = true; changed;) {
    changed = false;
    const tail = text[text.length - 1];
    if (tail === undefined) break;
    const opener = BRACKETS.find(([, close]) => close === tail)?.[0];
    if (TRAILING_ALWAYS.has(tail) || (opener !== undefined && !text.includes(opener))) {
      text = text.slice(0, -1);
      changed = true;
    }
  }
  return text.replace(LINE_REFERENCE, '');
}

/** Repo-relative, forward-slash form as stored in the file table. */
function toRepoRelative(span: string): string {
  return span
    .replace(/\\/g, '/')
    .replace(/^(?:\.\/)+/, '')
    .replace(/\/{2,}/g, '/')
    .replace(/\/+$/, '');
}

function isUnambiguouslyPath(normalized: string): boolean {
  const slash = normalized.lastIndexOf('/');
  return DIRECT_SOURCE_BASENAME.test(normalized)
    || (slash > 0 && DOTTED_BASENAME.test(normalized.slice(slash + 1)));
}

interface Resolution { matches: string[]; ambiguous: boolean }

interface PathCatalog {
  resolve(span: string, limit: number): Resolution;
  byStem(stem: string): readonly string[] | undefined;
}

/** Construct query-local lookup policy without exposing it as search state. */
function createPathCatalog(paths: readonly string[]): PathCatalog {
  let folded: Map<string, string> | undefined;
  let stems: Map<string, string[]> | undefined;

  const foldedPaths = (): Map<string, string> => {
    if (folded) return folded;
    folded = new Map();
    for (const file of paths) folded.set(file.toLowerCase(), file);
    return folded;
  };

  return {
    resolve(span, limit) {
      const available = foldedPaths();
      const exact = available.get(span);
      if (exact !== undefined) return { matches: [exact], ambiguous: false };

      const segments = span.split('/').filter(Boolean);
      for (let removed = 0; removed < Math.min(segments.length, MAX_SUFFIX_DROPS); removed++) {
        const suffix = segments.slice(removed).join('/');
        if (!suffix) break;
        const ending = `/${suffix}`;
        const matches: string[] = [];
        for (const [foldedPath, original] of available) {
          if (foldedPath !== suffix && !foldedPath.endsWith(ending)) continue;
          matches.push(original);
          if (matches.length > limit) return { matches: [], ambiguous: true };
        }
        if (matches.length) return { matches, ambiguous: false };
      }
      return { matches: [], ambiguous: false };
    },
    byStem(stem) {
      if (!stems) {
        stems = new Map();
        for (const file of paths) {
          const basename = file.slice(Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\')) + 1);
          if (!basename.includes('-')) continue;
          const key = basename.replace(FINAL_EXTENSION, '').toLowerCase();
          if (!key) continue;
          const matches = stems.get(key);
          if (matches) matches.push(file);
          else stems.set(key, [file]);
        }
      }
      return stems.get(stem);
    },
  };
}

export function extractQueryPaths(
  query: string,
  indexedPaths: readonly string[],
  options: { maxPins?: number; maxMatchesPerSpan?: number } = {},
): QueryPathExtraction {
  const maxPins = Math.max(1, options.maxPins ?? 8);
  const maxMatches = Math.max(1, options.maxMatchesPerSpan ?? 3);
  const untouched = (): QueryPathExtraction => ({ strippedQuery: query, pinnedFiles: [], unresolvedPathSpans: [] });
  if (!query.trim() || indexedPaths.length === 0) return untouched();

  const catalog = createPathCatalog(indexedPaths);
  const tokens = query.split(/\s+/).filter(Boolean);
  const consumed = new Set<number>();
  const pinned: string[] = [];
  const unresolved: string[] = [];
  const pinnedSet = new Set<string>();
  const pin = (files: readonly string[]): void => {
    for (const file of files) {
      if (pinned.length >= maxPins) return;
      if (pinnedSet.has(file)) continue;
      pinnedSet.add(file);
      pinned.push(file);
    }
  };

  // Pass 1: slashed or dotted spans, resolved against the index.
  let examined = 0;
  for (let at = 0; at < tokens.length && pinned.length < maxPins && examined < MAX_EXPLICIT_SPANS; at++) {
    const span = unwrap(tokens[at]!);
    if (span.length < MIN_SPAN_LENGTH) continue;
    if (!/[/\\]/.test(span) && !DOTTED_BASENAME.test(span)) continue;
    const normalized = toRepoRelative(span);
    if (!normalized) continue;
    examined++;

    const { matches, ambiguous } = catalog.resolve(normalized.toLowerCase(), maxMatches);
    if (matches.length > 0) {
      consumed.add(at);
      pin(matches);
    } else if (ambiguous || isUnambiguouslyPath(normalized)) {
      // Left in the query its fragments would mint junk matches, so strip and report.
      consumed.add(at);
      if (unresolved.length < MAX_REPORTED_UNRESOLVED) unresolved.push(normalized);
    }
  }

  // Pass 2: extension-less kebab names. Unlike pass 1, an unresolved or over-hot
  // name stays in the query: it may just be ordinary wording.
  for (let at = 0; at < tokens.length && pinned.length < maxPins; at++) {
    if (consumed.has(at)) continue;
    const span = unwrap(tokens[at]!);
    if (span.length < MIN_SPAN_LENGTH || !KEBAB_BASENAME.test(span)) continue;
    const matches = catalog.byStem(span.toLowerCase());
    if (!matches || matches.length > maxMatches) continue;
    consumed.add(at);
    pin(matches);
  }

  if (consumed.size === 0) return untouched();
  return {
    strippedQuery: tokens.filter((_, at) => !consumed.has(at)).join(' '),
    pinnedFiles: pinned,
    unresolvedPathSpans: unresolved,
  };
}
