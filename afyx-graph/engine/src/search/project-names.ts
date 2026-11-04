/**
 * Names that identify the project itself.
 *
 * A project name in a query ("MyApp backend routes") is context, not a signal: when
 * it also appears in a path or symbol it inflates that part of the tree. The tokens
 * returned here let ranking ignore such words. They come from `go.mod`, the
 * `package.json` name (scope removed) and the root directory name, normalized to
 * lowercase alphanumerics; only names of at least five characters qualify, because
 * shorter ones (`api`, `core`, `web`) collide with real query words.
 */

import * as fs from 'fs';
import * as path from 'path';

const MIN_PROJECT_TOKEN = 5;

/** Lowercase alphanumerics only: the comparable form of a name. */
export function normalizeNameToken(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function readText(file: string): string | undefined {
  try {
    return fs.readFileSync(file, 'utf-8');
  } catch {
    return undefined;
  }
}

function lastPathPart(value: string): string {
  const parts = value.split('/');
  return parts[parts.length - 1] ?? '';
}

function nameFromPackageJson(root: string): string | undefined {
  const source = readText(path.join(root, 'package.json'));
  if (source === undefined) return undefined;
  try {
    const candidate: unknown = JSON.parse(source).name;
    return typeof candidate === 'string' ? candidate.replace(/^@[^/]+\//, '') : undefined;
  } catch {
    return undefined;
  }
}

function nameFromGoModule(root: string): string | undefined {
  const declaration = readText(path.join(root, 'go.mod'))?.match(/^\s*module\s+(\S+)/m);
  return declaration ? lastPathPart(declaration[1]!) : undefined;
}

export function deriveProjectNameTokens(projectRoot: string): Set<string> {
  const candidates = [
    nameFromGoModule(projectRoot),
    nameFromPackageJson(projectRoot),
    path.basename(path.resolve(projectRoot)),
  ];
  return new Set(candidates
    .filter((candidate): candidate is string => candidate !== undefined)
    .map(normalizeNameToken)
    .filter((candidate) => candidate.length >= MIN_PROJECT_TOKEN));
}
