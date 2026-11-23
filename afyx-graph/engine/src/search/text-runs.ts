/**
 * Small Unicode text helpers shared by the search modules.
 */

const LETTER_OR_DIGIT_RUN = /[\p{L}\p{N}]+/gu;
const DIGITS_ONLY = /^\p{N}+$/u;
const COMBINING_MARKS = /\p{M}+/gu;

/** Maximal runs of Unicode letters/digits, in order of appearance. */
export function alphanumericRuns(text: string): string[] {
  return text.match(LETTER_OR_DIGIT_RUN) ?? [];
}

export function isAllDigits(text: string): boolean {
  return DIGITS_ONLY.test(text);
}

/** Lowercase and strip diacritics so accented prose meets ASCII identifier segments. */
export function foldForLookup(word: string): string {
  return word.normalize('NFD').replace(COMBINING_MARKS, '').toLowerCase();
}
