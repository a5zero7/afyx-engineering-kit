/**
 * Identifier segmentation and prose-to-symbol lookup words.
 *
 * Contract:
 *  - `splitIdentifierSegments` turns a symbol or file name into the lowercase
 *    words a person would say for it (camelCase humps, acronym tails, any
 *    non-alphanumeric separator; digits stay attached to their word).
 *  - `extractProseCandidates` / `extractSegmentSearchWords` turn a prompt or a
 *    search query into words worth looking up against those segments.
 *  - `segmentLookupVariants` adds conservative singular forms of a plural word.
 * All functions are pure and deterministic; results keep first-seen order.
 */

import { PROSE_STOP_WORDS } from './vocabulary';
import { alphanumericRuns, foldForLookup, isAllDigits } from './text-runs';

const SEGMENT_MIN = 2;
const SEGMENT_MAX = 32;
const SEGMENTS_PER_NAME = 12;

const PROSE_WORD_MIN = 4;
const PROSE_WORD_MAX = 24;
const PROSE_WORDS_PER_PROMPT = 16;

const enum Glyph { Other, Lower, Upper, Number }

const LOWERCASE = /\p{Ll}/u;
const UPPERCASE = /\p{Lu}/u;
const NUMBER = /\p{N}/u;

function glyphOf(character: string): Glyph {
  if (LOWERCASE.test(character)) return Glyph.Lower;
  if (UPPERCASE.test(character)) return Glyph.Upper;
  if (NUMBER.test(character)) return Glyph.Number;
  return Glyph.Other;
}

const PLAIN_ASCII = /^[A-Za-z0-9]+$/;

function asciiGlyph(code: number): Glyph {
  if (code >= 97 && code <= 122) return Glyph.Lower;
  if (code >= 65 && code <= 90) return Glyph.Upper;
  return Glyph.Number;
}

/** Indexes where a new word starts inside a run: after a lower/digit before a capital, and before the last capital of an acronym. */
function wordStarts(glyphs: readonly Glyph[]): number[] {
  const starts: number[] = [];
  for (let at = 1; at < glyphs.length; at++) {
    if (glyphs[at] !== Glyph.Upper) continue;
    const previous = glyphs[at - 1];
    const acronymTail = previous === Glyph.Upper && glyphs[at + 1] === Glyph.Lower;
    if (previous === Glyph.Lower || previous === Glyph.Number || acronymTail) starts.push(at);
  }
  return starts;
}

function sliceAt<T extends string | string[]>(whole: T, starts: readonly number[], join: (part: T) => string): string[] {
  const words: string[] = [];
  let from = 0;
  for (const at of starts) {
    words.push(join(whole.slice(from, at) as T));
    from = at;
  }
  words.push(join(whole.slice(from) as T));
  return words;
}

/** Words of one alphanumeric run, cut at camel humps and at the end of acronym runs. */
function humpSplit(run: string): string[] {
  if (PLAIN_ASCII.test(run)) {
    // One UTF-16 unit per character: string indexes are character indexes.
    const glyphs = new Array<Glyph>(run.length);
    for (let at = 0; at < run.length; at++) glyphs[at] = asciiGlyph(run.charCodeAt(at));
    return sliceAt(run, wordStarts(glyphs), (part) => part);
  }
  const characters = Array.from(run);
  return sliceAt(characters, wordStarts(characters.map(glyphOf)), (part) => part.join(''));
}

export function splitIdentifierSegments(name: string): string[] {
  if (!name) return [];
  const segments = new Set<string>();
  for (const run of alphanumericRuns(name)) {
    for (const piece of humpSplit(run)) {
      if (segments.size >= SEGMENTS_PER_NAME) return [...segments];
      const segment = piece.toLowerCase();
      if (segment.length < SEGMENT_MIN || segment.length > SEGMENT_MAX || isAllDigits(segment)) continue;
      segments.add(segment);
    }
  }
  return [...segments];
}

export function normalizeProseWord(word: string): string {
  return foldForLookup(word);
}

function proseCandidate(run: string): string | null {
  if (run.length > PROSE_WORD_MAX) return null;
  const word = foldForLookup(run);
  if (word.length < PROSE_WORD_MIN || word.length > PROSE_WORD_MAX) return null;
  if (isAllDigits(word) || PROSE_STOP_WORDS.has(word)) return null;
  return word;
}

export function extractProseCandidates(prompt: string): string[] {
  if (!prompt) return [];
  const candidates = new Set<string>();
  for (const run of alphanumericRuns(prompt)) {
    if (candidates.size >= PROSE_WORDS_PER_PROMPT) break;
    const word = proseCandidate(run);
    if (word !== null) candidates.add(word);
  }
  return [...candidates];
}

const HAS_HUMP = /[\p{Ll}\p{N}]\p{Lu}/u;

export function extractSegmentSearchWords(query: string): string[] {
  if (!query) return [];
  const words = new Set(extractProseCandidates(query));
  const humped = alphanumericRuns(query).filter((run) => HAS_HUMP.test(run));
  if (humped.length > 0) {
    for (const word of extractProseCandidates(humped.flatMap(splitIdentifierSegments).join(' '))) words.add(word);
  }
  return [...words];
}

/**
 * Singular-form rules keyed on the plural ending, first match wins. `drops` lists the
 * character counts that may be removed, each only from words long enough to leave a
 * plausible stem.
 */
const PLURAL_RULES: ReadonlyArray<{ ending: RegExp; drops: ReadonlyArray<number> }> = [
  // -xes/-shes/-sses/-zzes are unambiguous: the singular loses "es".
  { ending: /(?:x|sh|ss|zz)es$/, drops: [2] },
  // -ches/-ses/-zes/-oes can be +es or +s (patches/caches): offer both, let the vocabulary decide.
  { ending: /(?:ch|s|z|o)es$/, drops: [2, 1] },
  // A bare -s plural; a trailing -ss is already singular.
  { ending: /(?<!s)s$/, drops: [1] },
];

export function segmentLookupVariants(word: string): string[] {
  const variants = [word];
  const rule = PLURAL_RULES.find((candidate) => candidate.ending.test(word));
  if (!rule) return variants;
  for (const drop of rule.drops) {
    if (word.length >= PROSE_WORD_MIN + drop) variants.push(word.slice(0, -drop));
  }
  return variants;
}
