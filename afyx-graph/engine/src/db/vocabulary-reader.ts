/**
 * Reads over the name-segment vocabulary (writes live in `NameVocabulary`, Phase 3B.4A):
 * emptiness, paged rebuild candidates, and the prompt hook's segment lookups.
 */

import { placeholders, QuerySession } from './query-session';

interface VocabularyPresenceRow {
  populated: 0 | 1;
}

interface VocabularyNameRow {
  symbolName: string;
}

interface SegmentFrequencyRow {
  segment: string;
  frequency: number;
}

interface CoOccurrenceRow {
  symbolName: string;
  wordCount: number;
}

const VOCABULARY_QUERY = {
  presence: 'SELECT EXISTS(SELECT 1 FROM name_segment_vocab) AS populated',
  rebuildPage: "SELECT DISTINCT name AS symbolName FROM nodes WHERE kind NOT IN ('file', 'import') ORDER BY name LIMIT ? OFFSET ?",
  namesBySegment: 'SELECT name AS symbolName FROM name_segment_vocab WHERE segment = ? ORDER BY length(name) ASC LIMIT ?',
} as const;

function namesFrom(rows: readonly VocabularyNameRow[]): string[] {
  return rows.map(({ symbolName }) => symbolName);
}

function segmentFrequencies(rows: readonly SegmentFrequencyRow[]): Map<string, number> {
  return new Map(rows.map(({ segment, frequency }) => [segment, frequency]));
}

function coOccurrenceQuery(variantCount: number): string {
  const variantToWord = new Array(variantCount).fill('WHEN ? THEN ?').join(' ');
  return `
    SELECT name AS symbolName,
           COUNT(DISTINCT CASE segment ${variantToWord} END) AS wordCount
      FROM name_segment_vocab
     WHERE segment IN (${placeholders(variantCount)})
  GROUP BY name
    HAVING wordCount >= ?
  ORDER BY wordCount DESC, length(name) ASC
     LIMIT ?`;
}

function frequencyQuery(segmentCount: number): string {
  return `
    SELECT segment, COUNT(*) AS frequency
      FROM name_segment_vocab
     WHERE segment IN (${placeholders(segmentCount)})
  GROUP BY segment`;
}

export class VocabularyReader {
  constructor(private readonly session: QuerySession) {}

  /** True when the vocabulary has no rows — an index built before the table existed; `sync` uses this to heal such databases. */
  isNameSegmentVocabEmpty(): boolean {
    const row = this.session.statement(VOCABULARY_QUERY.presence).get() as VocabularyPresenceRow;
    return row.populated === 0;
  }

  /** One page of distinct segmentable node names, for batched vocab rebuilds (file basenames and import specifiers are excluded — see `NameVocabulary`). */
  getDistinctNodeNames(limit: number, offset: number): string[] {
    const rows = this.session.statement(VOCABULARY_QUERY.rebuildPage).all(limit, offset) as VocabularyNameRow[];
    return namesFrom(rows);
  }

  /**
   * Names whose segments cover at least `minWords` distinct prompt words — the
   * co-occurrence probe behind the prompt hook's medium tier. Variants (plural forms of
   * one word) are folded back to their word INSIDE the SQL so a name matching both
   * `service` and `services` counts one word, not two; counting raw variants would let a
   * plural pair tie with a genuine two-word match and, because ORDER BY/LIMIT run before
   * any JS re-check, crowd a real match past the limit on vocab-heavy repos (#1146).
   */
  getSegmentCoOccurrence(variants: Array<{ segment: string; word: string }>, minWords: number, limit: number): Array<{ name: string; matches: number }> {
    if (variants.length === 0) return [];
    const sql = coOccurrenceQuery(variants.length);
    const wordBindings = variants.flatMap(({ segment, word }) => [segment, word]);
    const segmentBindings = variants.map(({ segment }) => segment);
    const rows = this.session.statement(sql).all(...wordBindings, ...segmentBindings, minWords, limit) as CoOccurrenceRow[];
    return rows.map(({ symbolName, wordCount }) => ({ name: symbolName, matches: wordCount }));
  }

  /** How many distinct names each segment appears in — the rarity signal separating a discriminative word ("checkout") from a ubiquitous one ("state"). */
  getSegmentNameCounts(segments: string[]): Map<string, number> {
    if (segments.length === 0) return new Map();
    const rows = this.session.statement(frequencyQuery(segments.length)).all(...segments) as SegmentFrequencyRow[];
    return segmentFrequencies(rows);
  }

  /** Names containing the given segment (the rare-single-word tier), shortest first. */
  getNamesForSegment(segment: string, limit: number): string[] {
    const rows = this.session.statement(VOCABULARY_QUERY.namesBySegment).all(segment, limit) as VocabularyNameRow[];
    return namesFrom(rows);
  }
}
