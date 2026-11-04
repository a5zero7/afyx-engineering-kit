import type { FileRecord, Node } from '../types';
import type { IndexAccounting } from '../index-health';
import { parsePythonStaticStringValues } from '../extraction/native/python-class-assignments';
import { errorToolResult, textToolResult, type ToolResult } from './tool-results';

export interface InventoryToolSource {
  getNodesByName(name: string): Node[];
  getFiles(): FileRecord[];
  getIndexState(): 'indexing' | 'complete' | 'partial' | 'failed' | null;
  getIndexAccounting(): IndexAccounting | null;
  getIndexBuildInfo(): { version: string | null; extractionVersion: number | null };
  isIndexStale(): boolean;
}

export interface InventoryToolRequest {
  declaration: string;
  value: string;
  path?: string;
  offset?: unknown;
  limit?: unknown;
}

interface InventoryRow {
  node: Node;
  values: string[];
  className: string;
  moduleName: string;
}

const MAX_PAGE = 200;

/** Exact, bounded enumeration over indexed Python class-assignment facts. */
export function executeInventoryTool(source: InventoryToolSource, request: InventoryToolRequest): ToolResult {
  const declaration = request.declaration.trim();
  const value = request.value.trim();
  if (!declaration) return errorToolResult('declaration must not be empty');
  if (!value) return errorToolResult('value must not be empty');

  const offset = integer(request.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  if (offset === null) return errorToolResult('offset must be a non-negative integer');
  const limit = integer(request.limit, 100, 1, MAX_PAGE);
  if (limit === null) return errorToolResult(`limit must be an integer between 1 and ${MAX_PAGE}`);
  const scope = normalizeScope(request.path);
  if (scope === null) return errorToolResult('path must be a project-relative scope without parent traversal');

  const candidates = source.getNodesByName(declaration)
    .filter((node) => node.kind === 'property' && node.language === 'python' && inScope(node.filePath, scope));
  const unresolved = candidates.filter((node) => literalValues(node) === null);
  const matches: InventoryRow[] = [];
  for (const node of candidates) {
    const values = literalValues(node);
    if (!values || !values.includes(value)) continue;
    matches.push({
      node,
      values,
      className: declaringClass(node),
      moduleName: moduleName(node.filePath, scope),
    });
  }
  matches.sort((left, right) => left.node.filePath.localeCompare(right.node.filePath) ||
    left.node.startLine - right.node.startLine || left.className.localeCompare(right.className));

  const page = matches.slice(offset, offset + limit);
  const pageComplete = offset + page.length >= matches.length;
  const accounting = source.getIndexAccounting();
  const diagnosticFiles = source.getFiles().filter((file) => (file.errors?.length ?? 0) > 0);
  const errorFiles = diagnosticFiles.filter(hasErrorSeverity);
  const scopedPythonDiagnosticFiles = diagnosticFiles.filter((file) =>
    file.language === 'python' && inScope(file.path, scope));
  const scopedPythonErrorFiles = scopedPythonDiagnosticFiles.filter(hasErrorSeverity);
  // Full-index accounting normally has a persisted marker for every failed file.
  // If an older/incomplete index lacks one, its location cannot be proven outside
  // this query scope, so retain the conservative LIMITED verdict.
  const unlocatedFailures = Math.max(0, (accounting?.failed ?? 0) - errorFiles.length);
  const build = source.getIndexBuildInfo();
  const indexComplete = source.getIndexState() === 'complete' && !source.isIndexStale() &&
    scopedPythonDiagnosticFiles.length === 0 && unlocatedFailures === 0;
  const status = !pageComplete
    ? 'PARTIAL PAGE — DO NOT TREAT AS COMPLETE INVENTORY'
    : indexComplete
      ? 'COMPLETE FOR SUPPORTED LITERAL DECLARATIONS IN THE INDEXED SCOPE'
      : 'LIMITED INDEX COVERAGE — DO NOT TREAT AS COMPLETE INVENTORY';

  const files = new Set(matches.map((row) => row.node.filePath));
  const modules = new Set(matches.map((row) => row.moduleName));
  const lines = [
    '# Exact structural inventory',
    '',
    `**Status:** ${status}`,
    `**Query:** Python class assignment \`${declaration}\` contains exact literal \`${value}\``,
    `**Scope:** \`${scope || '.'}\``,
    `**Matches:** ${matches.length} declarations; ${files.size} files; ${modules.size} modules`,
    `**Page:** offset ${offset}, showing ${page.length}, limit ${limit}`,
    '',
  ];
  for (const row of page) {
    lines.push(`- \`${row.className}\` — \`${row.node.filePath}:${row.node.startLine}\` — module \`${row.moduleName}\` — values ${row.values.map((item) => `\`${item}\``).join(', ')}`);
  }
  if (page.length === 0) lines.push('- No matching supported literal declarations.');
  if (!pageComplete) lines.push('', `> ${matches.length - offset - page.length} matching declarations remain; increase offset for the next bounded page.`);

  lines.push(
    '',
    '**Coverage:**',
    `- Index state: ${(source.getIndexState() ?? 'unknown').toUpperCase()}`,
    `- Extraction version: ${build.extractionVersion ?? 'unknown'}${source.isIndexStale() ? ' (stale; re-index required)' : ''}`,
    `- Unresolved/unsupported \`${declaration}\` expressions in scope: ${unresolved.length} (excluded from literal matches, never inferred)`,
    `- Scoped Python files with extraction diagnostics: ${scopedPythonDiagnosticFiles.length} ` +
      `(${scopedPythonErrorFiles.length} error-severity, ` +
      `${scopedPythonDiagnosticFiles.length - scopedPythonErrorFiles.length} warning-only)`,
    `- Global file records with extraction diagnostics: ${diagnosticFiles.length} ` +
      `(${errorFiles.length} error-severity, ${diagnosticFiles.length - errorFiles.length} warning-only)`,
  );
  if (accounting) {
    lines.push(`- Last full index: ${accounting.indexed} indexed, ${accounting.skipped} skipped, ${accounting.unsupported} unsupported, ${accounting.failed} failed`);
    if (accounting.metadataIndexed !== null) {
      lines.push(`- Catalog depth: ${accounting.metadataIndexed} metadata-indexed, ${accounting.contentIndexed ?? 0} content-indexed, ${accounting.structurallyIndexed ?? 0} structurally indexed`);
    }
    if (accounting.skippedReasons && Object.keys(accounting.skippedReasons).length > 0) {
      lines.push(`- Skipped reasons: ${Object.entries(accounting.skippedReasons).map(([reason, count]) => `${reason}=${count}`).join(', ')}`);
    }
  } else {
    lines.push('- Last full index accounting: unavailable');
  }
  lines.push('- Ignored/excluded paths are outside the indexed scope and are not enumerated. This is static source evidence, not the Odoo runtime registry.');
  return textToolResult(lines.join('\n'));
}

function hasErrorSeverity(file: FileRecord): boolean {
  return file.errors?.some((error) => error.severity === 'error') ?? false;
}

function literalValues(node: Node): string[] | null {
  const signature = node.signature?.match(/^\s*=\s*([\s\S]*)$/u)?.[1];
  return signature === undefined ? null : parsePythonStaticStringValues(signature);
}

function declaringClass(node: Node): string {
  const parts = node.qualifiedName.split('::');
  return parts.length > 1 ? parts.at(-2)! : '(unknown class)';
}

function normalizeScope(value: string | undefined): string | null {
  if (value === undefined || !value.trim() || value.trim() === '.') return '';
  const normalized = value.trim().replace(/\\/g, '/').replace(/^\.\//u, '').replace(/\/+$/u, '');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/u.test(normalized) ||
      normalized.split('/').some((part) => part === '..')) return null;
  return normalized;
}

function inScope(filePath: string, scope: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return !scope || normalized === scope || normalized.startsWith(`${scope}/`);
}

function moduleName(filePath: string, scope: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/');
  const addons = parts.lastIndexOf('addons');
  if (addons >= 0 && parts[addons + 1]) return parts[addons + 1]!;
  if (scope) {
    const scopeParts = scope.split('/');
    return parts[scopeParts.length] ?? parts.at(-2) ?? '.';
  }
  return parts[0] ?? '.';
}

function integer(value: unknown, fallback: number, minimum: number, maximum: number): number | null {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) return null;
  return value;
}
