/**
 * AFYX Graph Engine - UI Symbol Kind Representation
 *
 * Provides visual kind badge representations, glyph abbreviations, container/type
 * classification rules, and human-readable kind labels for the UI viewer.
 */

/** Canonical symbol glyph abbreviations by node kind. */
export const KIND_LETTER: Record<string, string> = {
  function: 'ƒ',
  method: 'm',
  class: 'C',
  interface: 'I',
  struct: 'S',
  type_alias: 'T',
  enum: 'E',
  enum_member: 'e',
  constant: 'k',
  variable: 'v',
  property: 'p',
  field: 'p',
  file: '≡',
  route: 'R',
  component: '⟨⟩',
  namespace: 'N',
  module: 'M',
  trait: 'Tr',
  union: 'U',
  protocol: 'P',
  parameter: 'pm',
  import: 'im',
  export: 'ex',
};

/** Kinds rendered with background fill styling (types and structural containers). */
export const FILLED_KINDS: ReadonlySet<string> = new Set([
  'class',
  'interface',
  'struct',
  'type_alias',
  'trait',
  'protocol',
  'union',
  'enum',
]);

/** Returns badge glyph representation for a given symbol kind. */
export function kindLetter(kind: string | null | undefined): string {
  if (!kind) {
    return '';
  }
  return KIND_LETTER[kind] ?? kind.slice(0, 1).toUpperCase();
}

/** Returns formatted descriptive text for a given symbol kind. */
export function kindWord(kind: string | null | undefined): string {
  if (!kind) {
    return 'symbol';
  }
  return kind.replace(/_/g, ' ');
}
