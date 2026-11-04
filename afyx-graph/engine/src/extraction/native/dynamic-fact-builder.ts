import * as path from 'path';
import type { Edge, ExtractionError, ExtractionResult, Language, Node, NodeKind, UnresolvedReference } from '../../types';
import { generateNodeId } from '../node-id';
import type { NativeScanResult, NativeToken } from './scanner';

export interface NativeDeclaration {
  kind: NodeKind;
  name: string;
  start: number;
  end: number;
  bodyStart?: number;
  bodyEnd?: number;
  parent?: NativeDeclaration;
  qualifiedPrefix?: string;
  /** Exact public identity for languages whose separator is not `::`. */
  qualifiedName?: string;
  /** Language-specific identity suffix kept out of the display name (for example Erlang `/arity`). */
  qualifiedSuffix?: string;
  signature?: string;
  docstring?: string;
  returnType?: string;
  visibility?: Node['visibility'];
  exported?: boolean;
  static?: boolean;
  async?: boolean;
  abstract?: boolean;
}

export interface NativeReference {
  owner?: NativeDeclaration;
  directTarget?: NativeDeclaration;
  token: NativeToken;
  name: string;
  kind: UnresolvedReference['referenceKind'];
}

export function unquote(text: string): string {
  if ((text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("'") && text.endsWith("'")) ||
      (text.startsWith('`') && text.endsWith('`'))) return text.slice(1, -1);
  return text;
}

export function tokenText(source: string, tokens: readonly NativeToken[], start: number, end: number): string {
  if (!tokens[start] || !tokens[end]) return '';
  return source.slice(tokens[start]!.start.offset, tokens[end]!.end.offset);
}

export function narrowestOwner(
  declarations: readonly NativeDeclaration[],
  index: number,
  kinds?: ReadonlySet<NodeKind>
): NativeDeclaration | undefined {
  return declarations.filter((item) =>
    item.bodyStart !== undefined && item.bodyEnd !== undefined &&
    item.bodyStart <= index && item.bodyEnd >= index && (!kinds || kinds.has(item.kind)))
    .sort((left, right) => (left.bodyEnd! - left.bodyStart!) - (right.bodyEnd! - right.bodyStart!))[0];
}

export function nextToken(tokens: readonly NativeToken[], from: number, text: string, limit = tokens.length): number {
  for (let index = from; index < limit; index += 1) if (tokens[index]?.text === text) return index;
  return -1;
}

export function finishDynamicFacts(
  filePath: string,
  source: string,
  language: Language,
  scan: NativeScanResult,
  declarations: NativeDeclaration[],
  references: NativeReference[],
  started: number
): ExtractionResult {
  declarations.sort((left, right) => left.start - right.start || right.end - left.end || left.kind.localeCompare(right.kind));
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const fileNode: Node = {
    id: `file:${filePath}`,
    kind: 'file',
    name: path.basename(filePath),
    qualifiedName: filePath,
    filePath,
    language,
    startLine: 1,
    endLine: source.split('\n').length,
    startColumn: 0,
    endColumn: 0,
    isExported: false,
    updatedAt: Date.now(),
  };
  nodes.push(fileNode);
  const nodeByDeclaration = new Map<NativeDeclaration, Node>();
  for (const declaration of declarations) {
    const start = scan.tokens[declaration.start];
    if (!start) continue;
    const end = scan.tokens[declaration.end] ?? start;
    const parentNode = declaration.parent ? nodeByDeclaration.get(declaration.parent) : undefined;
    const qualifiedBase = declaration.qualifiedName ?? (parentNode
      ? `${parentNode.qualifiedName}::${declaration.name}`
      : declaration.qualifiedPrefix
        ? `${declaration.qualifiedPrefix}::${declaration.name}`
        : declaration.name);
    const qualifiedName = `${qualifiedBase}${declaration.qualifiedSuffix ?? ''}`;
    const node: Node = {
      id: generateNodeId(filePath, declaration.kind, qualifiedName, start.start.line),
      kind: declaration.kind,
      name: declaration.name,
      qualifiedName,
      filePath,
      language,
      startLine: start.start.line,
      endLine: end.end.line,
      startColumn: start.start.column,
      endColumn: end.end.column,
      signature: declaration.signature,
      docstring: declaration.docstring,
      returnType: declaration.returnType,
      visibility: declaration.visibility,
      isExported: declaration.exported,
      isStatic: declaration.static,
      isAsync: declaration.async,
      isAbstract: declaration.abstract,
      updatedAt: Date.now(),
    };
    nodes.push(node);
    nodeByDeclaration.set(declaration, node);
    edges.push({ source: parentNode?.id ?? fileNode.id, target: node.id, kind: 'contains' });
  }
  for (const reference of references) {
    if (!reference.directTarget) continue;
    const sourceNode = reference.owner ? nodeByDeclaration.get(reference.owner) : fileNode;
    const targetNode = nodeByDeclaration.get(reference.directTarget);
    if (sourceNode && targetNode && sourceNode.id !== targetNode.id) {
      edges.push({ source: sourceNode.id, target: targetNode.id, kind: 'references', metadata: { valueRef: true } });
    }
  }
  const unresolvedReferences: UnresolvedReference[] = references.filter((reference) => !reference.directTarget).map((reference) => ({
    fromNodeId: reference.owner ? nodeByDeclaration.get(reference.owner)?.id ?? fileNode.id : fileNode.id,
    referenceName: reference.name,
    referenceKind: reference.kind,
    line: reference.token.start.line,
    column: reference.token.start.column,
  }));
  unresolvedReferences.sort((left, right) => left.line - right.line || left.column - right.column || left.referenceName.localeCompare(right.referenceName));
  const errors: ExtractionError[] = scan.unterminated.map((kind) => ({
    message: `Incomplete ${kind} while scanning ${filePath}`,
    filePath,
    severity: 'warning',
    code: 'native_incomplete_source',
  }));
  return { nodes, edges, unresolvedReferences, errors, durationMs: Date.now() - started };
}
