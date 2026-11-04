import type { ExtractionResult, Language, Node } from '../types';
import { extractNativeFacts } from './native/fact-extractor';
import { scanSource } from './native/scanner';

const CALL_EXCLUSIONS = new Set([
  'catch', 'class', 'for', 'function', 'if', 'import', 'new', 'return', 'switch', 'throw', 'while', 'with',
]);

/**
 * Object-literal methods (notably Vue Options API methods/setup) are not
 * declarations in the bounded native JS fact model, but calls inside them are
 * part of the established SFC contract. Complete only otherwise-unseen calls;
 * ordinary function/initializer calls remain owned by extractNativeFacts.
 */
function preserveEmbeddedObjectCalls(result: ExtractionResult, source: string): void {
  const scan = scanSource(source, { hashComments: false });
  const tokens = scan.tokens;
  const seen = new Set(result.unresolvedReferences
    .filter((reference) => reference.referenceKind === 'calls')
    .map((reference) => `${reference.referenceName}\0${reference.line}\0${reference.column}`));
  const fileNode = result.nodes.find((node) => node.kind === 'file');
  if (!fileNode) return;
  const owners = result.nodes.filter((node) =>
    ['function', 'method', 'constant', 'variable'].includes(node.kind));
  const ownerAt = (line: number, column: number): Node => owners.filter((node) =>
    (line > node.startLine || (line === node.startLine && column >= node.startColumn)) &&
    (line < node.endLine || (line === node.endLine && column <= node.endColumn)))
    .sort((left, right) => (left.endLine - left.startLine) - (right.endLine - right.startLine))[0] ?? fileNode;

  for (let index = 0; index < tokens.length - 1; index += 1) {
    const callee = tokens[index]!;
    if (callee.kind !== 'identifier' || tokens[index + 1]?.text !== '(' || CALL_EXCLUSIONS.has(callee.text)) continue;
    if (tokens[index - 1]?.text === 'function') continue;
    const close = scan.pairs.get(index + 1);
    if (close !== undefined && tokens[close + 1]?.text === '{' && ['{', ',', '}'].includes(tokens[index - 1]?.text ?? '')) continue;
    const receiver = tokens[index - 2]?.kind === 'identifier' && tokens[index - 1]?.text === '.' ? tokens[index - 2] : undefined;
    const referenceName = receiver ? `${receiver.text}.${callee.text}` : callee.text;
    const column = receiver?.start.column ?? callee.start.column;
    const key = `${referenceName}\0${callee.start.line}\0${column}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.unresolvedReferences.push({
      fromNodeId: ownerAt(callee.start.line, column).id,
      referenceName,
      referenceKind: 'calls',
      line: callee.start.line,
      column,
    });
  }
}

export interface EmbeddedScriptOrigin {
  /** Zero-based source line containing the first character of the region. */
  startLine: number;
  /** UTF-16 column of the first character of the region. */
  startColumn: number;
}

/**
 * Shared SFC delegation seam. Production embedded scripts always use the
 * Afyx-native JS/TS fact extractor.
 */
export function extractEmbeddedScriptFacts(
  filePath: string,
  content: string,
  language: Extract<Language, 'javascript' | 'typescript'>,
): ExtractionResult {
  const result = extractNativeFacts(filePath, content, language);
  preserveEmbeddedObjectCalls(result, content);
  return result;
}

/** Map region-local fact coordinates back to the original container source. */
export function remapEmbeddedScriptResult(
  result: ExtractionResult,
  origin: EmbeddedScriptOrigin,
  filePath: string,
  outerLanguage: Extract<Language, 'svelte' | 'vue' | 'astro'>,
): void {
  const columnOffset = origin.startColumn;
  for (const node of result.nodes) {
    const localStartLine = node.startLine;
    const localEndLine = node.endLine;
    node.startLine += origin.startLine;
    node.endLine += origin.startLine;
    if (localStartLine === 1) node.startColumn += columnOffset;
    if (localEndLine === 1) node.endColumn += columnOffset;
    node.language = outerLanguage;
  }
  for (const edge of result.edges) {
    if (edge.line) edge.line += origin.startLine;
  }
  for (const reference of result.unresolvedReferences) {
    const localLine = reference.line;
    reference.line += origin.startLine;
    if (localLine === 1) reference.column += columnOffset;
    reference.filePath = filePath;
    reference.language = outerLanguage;
  }
  for (const error of result.errors) {
    const localLine = error.line;
    if (error.line) error.line += origin.startLine;
    if (localLine === 1 && error.column !== undefined) error.column += columnOffset;
  }
}
