/**
 * AFYX Engineering Kit - Resolution Subsystem Type Definitions
 *
 * Core interfaces, contracts, context accessors, and utility predicates
 * for symbol reference extraction, strategy coordination, and edge resolution.
 */

import { EdgeKind, Language, Node, ReferenceKind } from '../types';

/**
 * An unresolved symbol reference captured during static extraction.
 */
export interface UnresolvedRef {
  /** Identifier of the enclosing source node */
  fromNodeId: string;
  /** Referenced symbol identifier or qualified name */
  referenceName: string;
  /** Semantic kind of the reference */
  referenceKind: ReferenceKind;
  /** Source code line number */
  line: number;
  /** Source code column number */
  column: number;
  /** Relative or absolute file path containing the reference */
  filePath: string;
  /** Source programming language */
  language: Language;
  /** Speculative qualified name targets for resolution */
  candidates?: string[];
  /** Database row identifier for persistent store reconciliation */
  rowId?: number;
}

/**
 * Successfully resolved symbol link connecting an unresolved reference to a graph node.
 */
export interface ResolvedRef {
  /** The origin unresolved reference */
  original: UnresolvedRef;
  /** Graph node identifier of the resolved target */
  targetNodeId: string;
  /** Confidence metric between 0 and 1 */
  confidence: number;
  /** Identification of the strategy establishing resolution */
  resolvedBy:
    | 'exact-match'
    | 'import'
    | 'qualified-name'
    | 'framework'
    | 'fuzzy'
    | 'instance-method'
    | 'file-path'
    | 'function-ref';
  /** Override edge kind if differing from the reference semantic */
  edgeKind?: EdgeKind;
  /** Additional edge properties or framework payloads */
  metadata?: Record<string, unknown>;
  /** Auxiliary target fan-outs originating from the same reference site */
  alsoTargets?: { targetNodeId: string; metadata?: Record<string, unknown> }[];
}

/**
 * Aggregated metrics and partitioned results of a reference resolution pass.
 */
export interface ResolutionResult {
  /** References mapped to concrete target nodes */
  resolved: ResolvedRef[];
  /** References that could not be resolved */
  unresolved: UnresolvedRef[];
  /** Operational statistics */
  stats: {
    total: number;
    resolved: number;
    unresolved: number;
    byMethod: Record<string, number>;
  };
}

/**
 * Graph querying and filesystem abstraction interface provided to resolution strategies.
 */
export interface ResolutionContext {
  getNodesInFile(filePath: string): Node[];
  getNodesByName(name: string): Node[];
  getNodesByQualifiedName(qualifiedName: string): Node[];
  getNodesByKind(kind: Node['kind']): Node[];
  iterateNodesByKind?(kind: Node['kind']): IterableIterator<Node>;
  fileExists(filePath: string): boolean;
  readFile(filePath: string): string | null;
  getFileLines?(filePath: string): string[] | null;
  getMethodMatches?(typeName: string, methodName: string, language: Language): Node[];
  getProjectRoot(): string;
  getAllFiles(): string[];
  getNodesByLowerName(lowerName: string): Node[];
  getSupertypes?(typeName: string, language: Language): string[];
  getNodeById?(id: string): Node | null;
  getImportMappings(filePath: string, language: Language): ImportMapping[];
  resolveImport?(ref: UnresolvedRef): ResolvedRef | null;
  getProjectAliases?(): import('./path-aliases').AliasMap | null;
  getFileAliases?(filePath: string): import('./path-aliases').AliasMap | null;
  getGoModule?(): import('./go-module').GoModule | null;
  getWorkspacePackages?(): import('./workspace-packages').WorkspacePackages | null;
  getReExports?(filePath: string, language: Language): ReExport[];
  listDirectories?(relativePath: string): string[];
  getCppIncludeDirs?(): string[];
}

/**
 * Synthesized nodes and references emitted by framework-specific extractors.
 */
export interface FrameworkExtractionResult {
  nodes: Node[];
  references: UnresolvedRef[];
}

/**
 * Custom framework resolution and extraction adapter contract.
 */
export interface FrameworkResolver {
  name: string;
  languages?: Language[];
  detect(context: ResolutionContext): boolean;
  resolve(ref: UnresolvedRef, context: ResolutionContext): ResolvedRef | null;
  claimsReference?(name: string): boolean;
  extract?(filePath: string, content: string): FrameworkExtractionResult;
  postExtract?(context: ResolutionContext): Node[];
}

/**
 * Captured module import declaration mapping imported aliases to module sources.
 */
export interface ImportMapping {
  localName: string;
  exportedName: string;
  source: string;
  isDefault: boolean;
  isNamespace: boolean;
  resolvedPath?: string;
}

/**
 * Barrel file re-export directive.
 */
export type ReExport =
  | {
      kind: 'named';
      exportedName: string;
      originalName: string;
      source: string;
    }
  | {
      kind: 'wildcard';
      source: string;
    };

/**
 * Valid target node kinds for inheritance (extends/implements) edges.
 */
export const SUPERTYPE_TARGET_KINDS = new Set<Node['kind']>([
  'class',
  'struct',
  'interface',
  'trait',
  'protocol',
  'enum',
  'union',
  'type_alias',
  'component',
  'module',
  'namespace',
]);

/**
 * Checks whether an unresolved reference asserts inheritance or protocol conformance.
 */
export function isInheritanceRef(ref: UnresolvedRef): boolean {
  return ref.referenceKind === 'extends' || ref.referenceKind === 'implements';
}

const FORBIDDEN_IMPORT_TARGET_KINDS = new Set<Node['kind']>([
  'property',
  'field',
  'method',
  'enum_member',
  'parameter',
]);

/**
 * Checks whether a node kind can legally be targeted by an import reference.
 */
export function isImportableKind(kind: Node['kind']): boolean {
  return !FORBIDDEN_IMPORT_TARGET_KINDS.has(kind);
}
