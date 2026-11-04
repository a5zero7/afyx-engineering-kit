/**
 * Suffix-stripping expansions for search terms.
 *
 * Variants feed prefix matching, so they only need to be plausible stems, not
 * dictionary words: "caching" → cach, cache; "eviction" → evict; "entries" → entry.
 * Each rule inspects the lowercased term and emits candidate stems; rules run in a
 * fixed order so the output order is deterministic.
 */

const MIN_STEM_LENGTH = 3;

const trimmed = (term: string, count: number): string => term.slice(0, term.length - count);

type Emit = (stem: string) => void;
type StemRule = (term: string, emit: Emit) => void;

/** A stem, its silent-e form, and the form without a doubled final letter (running → run). */
function emitVerbStems(stem: string, emit: Emit): void {
  emit(stem);
  emit(`${stem}e`);
  if (stem.length >= 2 && stem[stem.length - 1] === stem[stem.length - 2]) emit(stem.slice(0, -1));
}

const gerund: StemRule = (term, emit) => {
  if (term.endsWith('ing') && term.length > 5) emitVerbStems(trimmed(term, 3), emit);
};

const nounizer: StemRule = (term, emit) => {
  if ((term.endsWith('tion') || term.endsWith('sion')) && term.length > 5) emit(trimmed(term, 3));
};

const ment: StemRule = (term, emit) => {
  if (term.endsWith('ment') && term.length > 6) emit(trimmed(term, 4));
};

/** Plural endings are mutually exclusive: the first that applies wins. */
const plural: StemRule = (term, emit) => {
  if (term.length <= 4) return;
  if (term.endsWith('ies')) emit(`${trimmed(term, 3)}y`);
  else if (term.endsWith('es')) emit(trimmed(term, 2));
  else if (term.endsWith('s') && !term.endsWith('ss')) emit(trimmed(term, 1));
};

const pastTense: StemRule = (term, emit) => {
  if (!term.endsWith('ed') || term.endsWith('eed') || term.length <= 4) return;
  emit(trimmed(term, 1));
  emit(trimmed(term, 2));
  if (term.endsWith('ied') && term.length > 5) emit(`${trimmed(term, 3)}y`);
};

const agent: StemRule = (term, emit) => {
  if (term.endsWith('er') && term.length > 4) emitVerbStems(trimmed(term, 2), emit);
};

const RULES: readonly StemRule[] = [gerund, nounizer, ment, plural, pastTense, agent];

export function getStemVariants(term: string): string[] {
  const lowered = term.toLowerCase();
  const proposed = new Set<string>();
  const emit: Emit = (stem) => {
    if (stem.length >= MIN_STEM_LENGTH && stem !== lowered) proposed.add(stem);
  };
  for (const rule of RULES) rule(lowered, emit);
  return [...proposed];
}
