/** Bounded direct-source fallback for explicitly named, unindexed files. */
import * as fs from 'fs';
import * as path from 'path';
import { buildScopeIgnore, type ScopeIgnore } from '../extraction';
import { lexicalPathWithinRoot, normalizePath, validatePathWithinRoot } from '../utils';

const DIRECT_SOURCE_EXTENSIONS = new Set(['.ps1', '.psm1', '.psd1']);
const MAX_DIRECT_FILES = 4;
const MAX_SOURCE_CHARS = 6_000;
const MAX_WALK_ENTRIES = 10_000;

export type ExactFileDiagnosticKind = 'ambiguous' | 'ignored' | 'missing' | 'refused' | 'unsupported';

export interface DirectSourceTarget {
  path: string;
  content: string;
  truncated: boolean;
}

export interface ExactFileDiagnostic {
  span: string;
  kind: ExactFileDiagnosticKind;
  message: string;
}

export interface ExactFileResolution {
  direct: DirectSourceTarget[];
  diagnostics: ExactFileDiagnostic[];
  resolvedSpans: string[];
}

function normalizedRelative(span: string): string {
  return normalizePath(span).replace(/^(?:\.\/)+/, '').replace(/\/{2,}/g, '/').replace(/\/+$/, '');
}

function diagnostic(span: string, kind: ExactFileDiagnosticKind, message: string): ExactFileDiagnostic {
  return { span, kind, message };
}

function findByBasename(root: string, basename: string, ignore: ScopeIgnore): string[] {
  const matches: string[] = [];
  const queue: Array<{ absolute: string; relative: string }> = [{ absolute: root, relative: '' }];
  let examined = 0;
  while (queue.length > 0 && examined < MAX_WALK_ENTRIES && matches.length <= MAX_DIRECT_FILES) {
    const current = queue.shift()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current.absolute, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (++examined > MAX_WALK_ENTRIES) break;
      const relative = current.relative ? `${current.relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!ignore.ignores(`${relative}/`)) queue.push({ absolute: path.join(current.absolute, entry.name), relative });
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase() === basename.toLowerCase() && !ignore.ignores(relative)) {
        matches.push(relative);
      }
    }
  }
  return matches;
}

/**
 * Resolve only path-shaped spans that failed the semantic index catalog.
 * Contents are served solely for a small source allowlist; no graph facts are
 * inferred from them and all reads retain the normal ignore/containment gates.
 */
export function resolveExactUnindexedFiles(
  projectRoot: string,
  spans: readonly string[],
): ExactFileResolution {
  const direct: DirectSourceTarget[] = [];
  const diagnostics: ExactFileDiagnostic[] = [];
  const resolvedSpans: string[] = [];
  let ignore: ScopeIgnore;
  try {
    ignore = buildScopeIgnore(projectRoot);
  } catch {
    return {
      direct,
      diagnostics: spans.map((span) => diagnostic(span, 'refused', 'Project ignore policy could not be evaluated safely.')),
      resolvedSpans,
    };
  }

  for (const span of spans.slice(0, MAX_DIRECT_FILES)) {
    const relative = normalizedRelative(span);
    if (!relative || path.isAbsolute(relative) || /^[A-Za-z]:\//.test(relative) || relative.split('/').includes('..')) {
      diagnostics.push(diagnostic(span, 'refused', 'Path is absolute or escapes the authorized project root.'));
      continue;
    }

    let candidates: string[] = [];
    const lexicalExact = lexicalPathWithinRoot(projectRoot, relative);
    const exact = validatePathWithinRoot(projectRoot, relative);
    try {
      if (exact && fs.statSync(exact).isFile()) candidates = [relative];
      else if (lexicalExact && fs.statSync(lexicalExact).isFile()) {
        diagnostics.push(diagnostic(span, 'refused', 'The requested path escapes the project through a symlink.'));
        continue;
      }
    } catch {
      // A bare basename may still identify one file below the root.
    }
    if (candidates.length === 0 && !relative.includes('/')) {
      candidates = findByBasename(projectRoot, relative, ignore);
    }
    if (candidates.length === 0) {
      diagnostics.push(diagnostic(span, 'missing', 'No indexed file uniquely matches this path, and no visible project file is available for direct inspection.'));
      continue;
    }
    if (candidates.length > 1) {
      diagnostics.push(diagnostic(span, 'ambiguous', `Path matches multiple visible files: ${candidates.slice(0, MAX_DIRECT_FILES).join(', ')}.`));
      continue;
    }

    const candidate = candidates[0]!;
    if (ignore.ignores(candidate)) {
      diagnostics.push(diagnostic(span, 'ignored', 'The requested path is excluded by project ignore policy; source was not read.'));
      continue;
    }
    const absolute = validatePathWithinRoot(projectRoot, candidate);
    if (!absolute) {
      diagnostics.push(diagnostic(span, 'refused', 'The requested path escapes the project through traversal or a symlink.'));
      continue;
    }
    const extension = path.extname(candidate).toLowerCase();
    if (!DIRECT_SOURCE_EXTENSIONS.has(extension)) {
      diagnostics.push(diagnostic(span, 'unsupported', `The file exists but direct-source inspection is not enabled for ${extension || 'extensionless'} files.`));
      continue;
    }

    try {
      const buffer = fs.readFileSync(absolute);
      if (buffer.subarray(0, Math.min(buffer.length, 8_192)).includes(0)) {
        diagnostics.push(diagnostic(span, 'unsupported', 'The file is not safe UTF-8-like text; source was not read.'));
        continue;
      }
      const source = buffer.toString('utf8');
      direct.push({ path: normalizePath(candidate), content: source.slice(0, MAX_SOURCE_CHARS), truncated: source.length > MAX_SOURCE_CHARS });
      resolvedSpans.push(span);
    } catch {
      diagnostics.push(diagnostic(span, 'refused', 'The requested file could not be read safely.'));
    }
  }
  return { direct, diagnostics, resolvedSpans };
}

export function renderExactFileResolution(
  resolution: ExactFileResolution,
  numberLines: (source: string, firstLine: number) => string,
): string {
  const lines = ['**Exact-file retrieval**', ''];
  if (resolution.direct.length > 0) {
    lines.push(
      'Afyx Graph does not semantically index PowerShell source. The sections below are **bounded direct-source inspection**, not graph-derived nodes, edges, call relationships, or semantic certainty.',
      '',
    );
    for (const target of resolution.direct) {
      const suffix = target.truncated ? ' · truncated to bounded source window' : ' · complete bounded source';
      lines.push(`**\`${target.path}\`** — direct source inspection${suffix}`, '', '```powershell', numberLines(target.content.replace(/\n+$/, ''), 1), '```', '');
    }
  }
  if (resolution.diagnostics.length > 0) {
    lines.push('**Path diagnostics**', '');
    for (const item of resolution.diagnostics) lines.push(`- \`${item.span}\`: ${item.message}`);
    lines.push('');
  }
  if (resolution.direct.length === 0) {
    lines.push('No semantic result was substituted. Use a unique, visible, project-relative path or inspect the named file through an authorized source-reading tool.');
  }
  return lines.join('\n').trimEnd();
}
