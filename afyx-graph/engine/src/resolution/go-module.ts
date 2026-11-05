/**
 * AFYX Engineering Kit - Go Module Path Extraction
 *
 * Detects and parses project-level go.mod manifests to resolve cross-package
 * imports belonging to the internal module namespace rather than external dependencies.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface GoModule {
  /** Declared module namespace path from go.mod */
  modulePath: string;
  /** Root directory housing go.mod */
  rootDir: string;
}

/**
 * Parses `go.mod` at projectRoot to determine the root module declaration.
 */
export function loadGoModule(projectRoot: string): GoModule | null {
  const manifestPath = path.join(projectRoot, 'go.mod');
  let rawContent: string;

  try {
    rawContent = fs.readFileSync(manifestPath, 'utf-8');
  } catch {
    return null;
  }

  // Remove comment lines starting with //
  const sanitized = rawContent.replace(/\/\/[^\n]*/g, '');
  const moduleMatch = sanitized.match(/^\s*module\s+(\S+)\s*$/m);
  if (!moduleMatch) return null;

  const rawModule = moduleMatch[1]!.replace(/^["']|["']$/g, '').trim();
  if (!rawModule) return null;

  return {
    modulePath: rawModule,
    rootDir: projectRoot,
  };
}
