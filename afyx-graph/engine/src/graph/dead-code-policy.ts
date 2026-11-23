import fs from 'fs';
import path from 'path';
import type AfyxGraph from '../index';
import type { Node, NodeKind } from '../types';
import { isTestFile } from '../search/query-utils';

export const DEAD_CODE_KINDS: readonly NodeKind[] = [
  'function', 'method', 'class', 'component', 'interface', 'struct', 'trait',
  'protocol', 'enum', 'union', 'type_alias',
];
export const DEAD_CODE_ALLOWED_KINDS: ReadonlySet<NodeKind> = new Set([
  ...DEAD_CODE_KINDS, 'variable', 'constant', 'property', 'field',
  'enum_member', 'namespace', 'module',
]);
export const MAX_DEAD_CODE_CANDIDATES = 20_000;
export const MAX_OVERRIDE_ANCESTOR_DEPTH = 8;
export const MAX_CORROBORATION_FILES = 600;
export const MAX_CORROBORATION_BYTES = 2_000_000;

const MEMBER_CONTAINERS = new Set<NodeKind>([
  'class', 'interface', 'struct', 'trait', 'protocol', 'enum', 'union', 'type_alias',
]);
const DECLARATION_CONTAINERS = new Set<NodeKind>(['interface', 'trait', 'protocol']);
const OVERRIDABLE = new Set<NodeKind>(['method', 'function', 'property', 'field']);
const IMPLICIT_NAMES = new Set([
  'constructor', 'main', 'init', 'deinit', 'finalize', 'destructor', 'dispose',
  'drop', 'default', 'tostring', 'equals', 'gethashcode', 'hashcode',
]);
const TEST_SEGMENTS = new Set(['test', 'tests', '__tests__', 'spec', 'specs', 'testing']);
const MARKUP_LANGUAGES = new Set([
  'svelte', 'vue', 'astro', 'liquid', 'html', 'razor', 'twig', 'blade', 'erb',
  'handlebars',
]);
const HEADER_SUFFIXES = [
  '.h', '.hh', '.hpp', '.hxx', '.h++', '.inc', '.d.ts', '.d.mts', '.d.cts',
  '.pyi', '.pxd',
];
const VENDOR_SEGMENTS = new Set([
  'vendor', 'vendored', 'third_party', 'third-party', 'thirdparty', 'external',
  'externals', 'node_modules', 'bower_components', 'site-packages', 'godeps',
  'pods', '.venv', 'venv',
]);
const DUNDER_NAME = /^__[a-z0-9_]+__$/i;

export interface DeadCodeEntry {
  node: Node;
  members: Node[];
  lines: number;
  exported: boolean;
}
export interface DeadCodeExclusions {
  tests: number;
  generated: number;
  exported: number;
  exportsUnknown: number;
  declarations: number;
  decorated: number;
  overriding: number;
  implicit: number;
  vendored: number;
  testScope: number;
  markup: number;
  unreachableFile: number;
  unresolvedName: number;
  ambiguousName: number;
  mentioned: number;
  unreadable: number;
  nested: number;
}
export interface DeadCodeReport {
  entries: DeadCodeEntry[];
  total: number;
  candidates: number;
  excluded: DeadCodeExclusions;
  kinds: NodeKind[];
  includeExported: boolean;
  bounded: boolean;
  corroborated: boolean;
}
export interface DeadCodeQuery {
  kinds?: readonly NodeKind[];
  includeExported?: boolean;
  includeTests?: boolean;
  includeGenerated?: boolean;
  limit?: number;
  readSource?: ((filePath: string) => string | null) | null;
}

type Candidate = { node: Node; generated: boolean };
type Exclusion = keyof DeadCodeExclusions;

function emptyLedger(): DeadCodeExclusions {
  return {
    tests: 0, generated: 0, exported: 0, exportsUnknown: 0, declarations: 0,
    decorated: 0, overriding: 0, implicit: 0, vendored: 0, testScope: 0,
    markup: 0, unreachableFile: 0, unresolvedName: 0, ambiguousName: 0,
    mentioned: 0, unreadable: 0, nested: 0,
  };
}

function reject(
  rows: readonly Candidate[],
  ledger: DeadCodeExclusions,
  reasonFor: (row: Candidate) => Exclusion | undefined
): Candidate[] {
  const accepted: Candidate[] = [];
  for (const row of rows) {
    const reason = reasonFor(row);
    if (reason === undefined) accepted.push(row);
    else ledger[reason] += 1;
  }
  return accepted;
}

function requestedKinds(kinds: readonly NodeKind[] | undefined): NodeKind[] {
  const valid = kinds?.filter((kind) => DEAD_CODE_ALLOWED_KINDS.has(kind)) ?? [];
  return valid.length === 0 ? [...DEAD_CODE_KINDS] : [...new Set(valid)];
}

function cheapReason(
  row: Candidate,
  options: { tests: boolean; generated: boolean; exported: boolean },
  exportLanguages: ReadonlySet<string>
): Exclusion | undefined {
  const node = row.node;
  if (!options.tests && isTestFile(node.filePath)) return 'tests';
  if (!options.generated && row.generated) return 'generated';
  if (!options.exported && (node.isExported || isHeaderFile(node.filePath))) return 'exported';
  if (!options.exported && !exportLanguages.has(node.language)) return 'exportsUnknown';
  if (node.isAbstract) return 'declarations';
  if (isImplicitEntryName(node.name)) return 'implicit';
  if (isVendoredPath(node.filePath)) return 'vendored';
  if (!options.tests && isTestScope(node.qualifiedName)) return 'testScope';
  if (MARKUP_LANGUAGES.has(node.language)) return 'markup';
  return undefined;
}

function candidateContainers(cg: AfyxGraph, rows: readonly Candidate[]): Map<string, Node> {
  const memberIds = rows.filter(({ node }) => OVERRIDABLE.has(node.kind)).map(({ node }) => node.id);
  if (memberIds.length === 0) return new Map();
  const ownerByMember = new Map<string, string>();
  for (const edge of cg.getIncomingEdgesTo(memberIds, ['contains'])) {
    if (!ownerByMember.has(edge.target)) ownerByMember.set(edge.target, edge.source);
  }
  const owners = cg.getNodesByIds([...new Set(ownerByMember.values())]);
  const result = new Map<string, Node>();
  for (const [memberId, ownerId] of ownerByMember) {
    const owner = owners.get(ownerId);
    if (owner && MEMBER_CONTAINERS.has(owner.kind)) result.set(memberId, owner);
  }
  return result;
}

interface AncestorEvidence {
  namesByRoot: Map<string, Set<string>>;
  uncertainRoots: Set<string>;
}

function ancestorEvidence(cg: AfyxGraph, rootIds: readonly string[]): AncestorEvidence {
  const namesByRoot = new Map<string, Set<string>>();
  const uncertainRoots = new Set<string>();
  if (rootIds.length === 0) return { namesByRoot, uncertainRoots };
  const ancestors = new Map<string, Set<string>>();
  const seen = new Set(rootIds);
  let wave = rootIds.map((id) => ({ id, roots: new Set([id]) }));

  for (let level = 0; level < MAX_OVERRIDE_ANCESTOR_DEPTH && wave.length > 0; level += 1) {
    const rootsAt = new Map(wave.map(({ id, roots }) => [id, roots]));
    const next = new Map<string, Set<string>>();
    for (const edge of cg.getOutgoingEdgesFrom(wave.map(({ id }) => id), ['extends', 'implements'])) {
      const roots = rootsAt.get(edge.source);
      if (!roots || edge.source === edge.target) continue;
      const reached = next.get(edge.target) ?? new Set<string>();
      const known = ancestors.get(edge.target) ?? new Set<string>();
      for (const root of roots) {
        reached.add(root);
        known.add(root);
      }
      next.set(edge.target, reached);
      ancestors.set(edge.target, known);
    }
    wave = [];
    for (const [id, roots] of next) {
      if (!seen.has(id)) {
        seen.add(id);
        wave.push({ id, roots });
      }
    }
  }

  // The look-ahead only detects unresolved ancestry; it does not traverse it.
  if (wave.length > 0) {
    const rootsAt = new Map(wave.map(({ id, roots }) => [id, roots]));
    for (const edge of cg.getOutgoingEdgesFrom(wave.map(({ id }) => id), ['extends', 'implements'])) {
      if (edge.source === edge.target || seen.has(edge.target)) continue;
      for (const root of rootsAt.get(edge.source) ?? []) uncertainRoots.add(root);
    }
  }

  if (ancestors.size === 0) return { namesByRoot, uncertainRoots };
  const ancestorIds = [...ancestors.keys()];
  const contains = cg.getOutgoingEdgesFrom(ancestorIds, ['contains']);
  const membersByOwner = new Map<string, string[]>();
  for (const edge of contains) {
    const bucket = membersByOwner.get(edge.source) ?? [];
    bucket.push(edge.target);
    membersByOwner.set(edge.source, bucket);
  }
  const members = cg.getNodesByIds(contains.map(({ target }) => target));
  for (const ancestorId of ancestorIds) {
    const names = (membersByOwner.get(ancestorId) ?? [])
      .map((id) => members.get(id))
      .filter((node): node is Node => node !== undefined && OVERRIDABLE.has(node.kind))
      .map((node) => node.name);
    for (const root of ancestors.get(ancestorId) ?? []) {
      if (names.length === 0) uncertainRoots.add(root);
      else {
        const known = namesByRoot.get(root) ?? new Set<string>();
        for (const name of names) known.add(name);
        namesByRoot.set(root, known);
      }
    }
  }
  return { namesByRoot, uncertainRoots };
}

function overridingCandidates(
  cg: AfyxGraph,
  rows: readonly Candidate[],
  containers: ReadonlyMap<string, Node>
): Set<string> {
  const roots = [...new Set([...containers.values()].map(({ id }) => id))];
  const evidence = ancestorEvidence(cg, roots);
  const result = new Set<string>();
  for (const { node } of rows) {
    const owner = containers.get(node.id);
    if (!owner) continue;
    if (evidence.uncertainRoots.has(owner.id) || evidence.namesByRoot.get(owner.id)?.has(node.name)) {
      result.add(node.id);
    }
  }
  return result;
}

function unreachedFiles(cg: AfyxGraph, rows: readonly Candidate[]): Set<string> {
  const files = [...new Set(rows.map(({ node }) => node.filePath))];
  if (files.length === 0) return new Set();
  const counts = cg.getFileDependentCounts(files);
  return new Set(files.filter((file) => (counts.get(file) ?? 0) === 0));
}

function corroborate(
  cg: AfyxGraph,
  rows: readonly Candidate[],
  readSource: (filePath: string) => string | null,
  ledger: DeadCodeExclusions
): Candidate[] {
  const cache = new Map<string, string | null>();
  const load = (file: string): string | null => {
    if (!cache.has(file)) {
      cache.set(file, cache.size < MAX_CORROBORATION_FILES ? readSource(file) : null);
    }
    return cache.get(file) ?? null;
  };
  const scopeByFile = new Map<string, string[]>();
  for (const { node } of rows) {
    if (!scopeByFile.has(node.filePath)) {
      scopeByFile.set(node.filePath, [node.filePath, ...cg.getFileDependents(node.filePath)]);
    }
  }
  return reject(rows, ledger, ({ node }) => {
    let own: string | null = null;
    let mentions = 0;
    for (const file of scopeByFile.get(node.filePath) ?? [node.filePath]) {
      const source = load(file);
      if (file === node.filePath) own = source;
      if (source !== null) mentions += mentionCount(source, node.name, 2 - mentions);
      if (mentions >= 2) break;
    }
    if (own === null) return 'unreadable';
    return mentions >= 2 ? 'mentioned' : undefined;
  });
}

function assemble(
  rows: readonly Candidate[],
  containers: ReadonlyMap<string, Node>,
  ledger: DeadCodeExclusions
): DeadCodeEntry[] {
  const survivingIds = new Set(rows.map(({ node }) => node.id));
  const entries = new Map<string, DeadCodeEntry>();
  const children: Array<{ node: Node; owner: string }> = [];
  for (const { node } of rows) {
    const owner = containers.get(node.id);
    if (owner && survivingIds.has(owner.id)) {
      children.push({ node, owner: owner.id });
      ledger.nested += 1;
    } else {
      entries.set(node.id, {
        node,
        members: [],
        lines: Math.max(1, node.endLine - node.startLine + 1),
        exported: node.isExported === true,
      });
    }
  }
  for (const child of children) entries.get(child.owner)?.members.push(child.node);
  for (const entry of entries.values()) {
    entry.members.sort((a, b) => a.startLine - b.startLine || a.name.localeCompare(b.name));
  }
  return [...entries.values()].sort((a, b) =>
    b.lines - a.lines ||
    a.node.filePath.localeCompare(b.node.filePath) ||
    a.node.startLine - b.node.startLine
  );
}

export function buildDeadCodeReport(cg: AfyxGraph, query: DeadCodeQuery = {}): DeadCodeReport {
  const kinds = requestedKinds(query.kinds);
  const options = {
    exported: query.includeExported === true,
    tests: query.includeTests === true,
    generated: query.includeGenerated === true,
  };
  const limit = Math.max(1, query.limit ?? 200);
  const sourceReader = query.readSource === undefined ? projectSourceReader(cg) : query.readSource;
  const ledger = emptyLedger();
  const raw = cg.getUnreferencedNodes(kinds, MAX_DEAD_CODE_CANDIDATES + 1);
  const bounded = raw.length > MAX_DEAD_CODE_CANDIDATES;
  const candidates = raw.slice(0, MAX_DEAD_CODE_CANDIDATES);
  const exportLanguages = options.exported
    ? new Set<string>()
    : cg.getLanguagesWithExports(candidates.map(({ node }) => node.language));
  let remaining = reject(candidates, ledger, (row) => cheapReason(row, options, exportLanguages));
  const decorated = new Set(
    cg.getOutgoingEdgesFrom(remaining.map(({ node }) => node.id), ['decorates'])
      .map(({ source }) => source)
  );
  const containers = candidateContainers(cg, remaining);
  const overriding = overridingCandidates(cg, remaining, containers);
  const islands = unreachedFiles(cg, remaining);
  remaining = reject(remaining, ledger, ({ node }) =>
    islands.has(node.filePath) ? 'unreachableFile' : undefined
  );
  const names = remaining.map(({ node }) => node.name);
  const unresolved = cg.getUnresolvedNamesAmong(names);
  const ambiguous = cg.getAmbiguousReferencedNames(names);
  remaining = reject(remaining, ledger, ({ node }) => {
    if (decorated.has(node.id) || (node.decorators?.length ?? 0) > 0) return 'decorated';
    const owner = containers.get(node.id);
    if (owner && DECLARATION_CONTAINERS.has(owner.kind)) return 'declarations';
    if (overriding.has(node.id)) return 'overriding';
    if (unresolved.has(node.name)) return 'unresolvedName';
    if (ambiguous.has(node.name)) return 'ambiguousName';
    return undefined;
  });
  if (sourceReader) remaining = corroborate(cg, remaining, sourceReader, ledger);
  const ranked = assemble(remaining, containers, ledger);
  return {
    entries: ranked.slice(0, limit),
    total: ranked.length,
    candidates: candidates.length,
    excluded: ledger,
    kinds,
    includeExported: options.exported,
    bounded,
    corroborated: sourceReader !== null,
  };
}

function projectSourceReader(cg: AfyxGraph): (filePath: string) => string | null {
  const root = path.resolve(cg.getProjectRoot());
  return (filePath) => {
    try {
      const absolute = path.resolve(root, filePath);
      if (absolute !== root && !absolute.startsWith(root + path.sep)) return null;
      const stat = fs.statSync(absolute);
      if (!stat.isFile() || stat.size > MAX_CORROBORATION_BYTES) return null;
      return fs.readFileSync(absolute, 'utf8');
    } catch {
      return null;
    }
  };
}

export function mentionCount(source: string, name: string, stopAt = Number.MAX_SAFE_INTEGER): number {
  if (name.length === 0) return 0;
  let count = 0;
  let cursor = 0;
  while (cursor <= source.length) {
    const found = source.indexOf(name, cursor);
    if (found < 0) break;
    cursor = found + name.length;
    if (!identifierChar(source[found - 1]) && !identifierChar(source[cursor])) {
      count += 1;
      if (count >= stopAt) break;
    }
  }
  return count;
}

function identifierChar(char: string | undefined): boolean {
  return char !== undefined && (char === '_' || char === '$' || /[\p{L}\p{N}]/u.test(char));
}

export function isHeaderFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return HEADER_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}
export function isTestScope(qualifiedName: string): boolean {
  return qualifiedName.split(/[.:/\\#>]+/).some((part) => TEST_SEGMENTS.has(part.toLowerCase()));
}
export function isVendoredPath(filePath: string): boolean {
  return filePath.replace(/\\/g, '/').split('/').some((part) => VENDOR_SEGMENTS.has(part.toLowerCase()));
}
export function isImplicitEntryName(name: string): boolean {
  return DUNDER_NAME.test(name) || IMPLICIT_NAMES.has(name.toLowerCase());
}
