/**
 * Symbol-shaped words in a free-text query.
 *
 * A query is prose that sometimes names code. Recognisers run in a fixed order and
 * contribute candidates in that order (first sighting wins); words that are merely
 * common English, or common programming vocabulary matching thousands of unrelated
 * symbols, are dropped at the end.
 */

interface Recogniser {
  pattern: RegExp;
  /** Candidates a match contributes. */
  take: (match: RegExpMatchArray) => string[];
}

const wholeMatch = (minLength: number) => (match: RegExpMatchArray): string[] =>
  match[1] && match[1].length >= minLength ? [match[1]] : [];

const RECOGNISERS: readonly Recogniser[] = [
  // camelCase / PascalCase words
  { pattern: /\b([A-Z][a-z]+(?:[A-Z][a-z]*)*|[a-z]+(?:[A-Z][a-z]*)+)\b/g, take: wholeMatch(2) },
  // snake_case
  { pattern: /\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b/gi, take: wholeMatch(3) },
  // SCREAMING_SNAKE_CASE
  { pattern: /\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b/g, take: wholeMatch(1) },
  // acronyms such as REST, HTTP, LRU
  { pattern: /\b([A-Z]{2,})\b/g, take: wholeMatch(1) },
  // dotted access ("app.isPackaged"): the whole path and each part of two or more characters
  {
    pattern: /\b([a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)+)\b/g,
    take: (match) => (match[1] ? [match[1], ...match[1].split('.').filter((part) => part.length >= 2)] : []),
  },
  // plain lowercase identifiers of three or more characters ("undo", "render", "parse")
  { pattern: /\b([a-z][a-z0-9]{2,})\b/g, take: wholeMatch(1) },
];

const words = (list: string): string[] => list.split(/\s+/).filter(Boolean);

/** Everyday words and programming vocabulary too generic to name a symbol. */
const ORDINARY_WORDS: ReadonlySet<string> = new Set([
  ...words('the and for with from this that have been will would could should does done make made use used using work works find found show call called calling get set add all any'),
  ...words('how what when where which who why not but are was were has had its can did may also into than then them each other some such only same about'),
  ...words('after before between through during without again further once here there both just more most very being having doing system need needs want wants like look change changes changed changing'),
  // Nouns and verbs that match thousands of unrelated symbols.
  ...words('layer handle handles handling incoming outgoing data flow flows level levels request requests response responses implement implements implementation interface interfaces class classes method methods'),
  ...words('trigger triggers affected affect affects else code failing failed silently decide decides return returns returned take takes taken check checks checked create creates created'),
  ...words('read reads write writes written start starts stop stops run runs running'),
]);

export function symbolsNamedIn(query: string): string[] {
  const found = new Set<string>();
  for (const { pattern, take } of RECOGNISERS) {
    for (const match of query.matchAll(pattern)) {
      for (const candidate of take(match)) found.add(candidate);
    }
  }
  return [...found].filter((symbol) => !ORDINARY_WORDS.has(symbol.toLowerCase()));
}
