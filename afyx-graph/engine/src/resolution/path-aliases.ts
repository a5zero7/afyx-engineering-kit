/**
 * AFYX Engineering Kit - Project Import Path Aliases
 *
 * Parses tsconfig.json / jsconfig.json configurations, supports multi-hop `extends`
 * hierarchies, extracts compilerOptions.paths patterns, and maps alias specifiers to concrete filesystem paths.
 */

import * as fs from 'fs';
import * as path from 'path';
import { logDebug } from '../errors';

/** A parsed alias mapping pattern. */
export interface AliasPattern {
  prefix: string;
  suffix: string;
  hasWildcard: boolean;
  replacements: string[];
  baseDir?: string;
}

/** Complete path aliases mapping associated with a project baseUrl. */
export interface AliasMap {
  baseUrl: string;
  patterns: AliasPattern[];
}

/**
 * Removes JSON with Comments (JSONC) line and block comments while preserving string literals,
 * and strips trailing object/array commas.
 */
function stripJsoncComments(content: string): string {
  let cleaned = '';
  let cursor = 0;
  let insideString = false;

  while (cursor < content.length) {
    const ch = content[cursor]!;

    if (insideString) {
      cleaned += ch;
      if (ch === '\\' && cursor + 1 < content.length) {
        cleaned += content[cursor + 1]!;
        cursor += 2;
        continue;
      }
      if (ch === '"') {
        insideString = false;
      }
      cursor++;
      continue;
    }

    if (ch === '"') {
      insideString = true;
      cleaned += ch;
      cursor++;
      continue;
    }

    if (ch === '/' && content[cursor + 1] === '/') {
      while (cursor < content.length && content[cursor] !== '\n') {
        cursor++;
      }
      continue;
    }

    if (ch === '/' && content[cursor + 1] === '*') {
      cursor += 2;
      while (cursor < content.length && !(content[cursor] === '*' && content[cursor + 1] === '/')) {
        cursor++;
      }
      cursor += 2;
      continue;
    }

    cleaned += ch;
    cursor++;
  }

  return cleaned.replace(/,(\s*[}\]])/g, '$1');
}

interface RawTsconfigFormat {
  extends?: string | string[];
  references?: Array<{ path?: string }>;
  compilerOptions?: {
    baseUrl?: string;
    paths?: Record<string, string[]>;
  };
}

interface MergedConfigOptions {
  baseUrl?: string;
  paths?: Record<string, string[]>;
  pathsDir?: string;
}

const MAX_CONFIG_EXTENDS_DEPTH = 32;

function locateExtendsFile(specifier: string, originDirectory: string): string | null {
  const checkRegularFile = (targetPath: string): boolean => {
    try {
      return fs.statSync(targetPath).isFile();
    } catch {
      return false;
    }
  };

  if (specifier.startsWith('./') || specifier.startsWith('../') || path.isAbsolute(specifier)) {
    const resolvedPath = path.resolve(originDirectory, specifier);
    const candidateVariants = [resolvedPath, `${resolvedPath}.json`, path.join(resolvedPath, 'tsconfig.json')];
    for (const cand of candidateVariants) {
      if (checkRegularFile(cand)) return cand;
    }
    return null;
  }

  let currentDir = originDirectory;
  while (true) {
    const nodeModulesCandidate = path.join(currentDir, 'node_modules', specifier);
    const candidateVariants = [
      nodeModulesCandidate,
      `${nodeModulesCandidate}.json`,
      path.join(nodeModulesCandidate, 'tsconfig.json'),
    ];
    for (const cand of candidateVariants) {
      if (checkRegularFile(cand)) return cand;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) return null;
    currentDir = parentDir;
  }
}

function resolveEffectiveOptions(
  filePath: string,
  ancestorStack: Set<string>,
  depth: number
): MergedConfigOptions | null {
  const absolutePath = path.resolve(filePath);
  if (ancestorStack.has(absolutePath) || depth > MAX_CONFIG_EXTENDS_DEPTH) {
    logDebug('path-aliases: circular extends or max depth exceeded', { filePath: absolutePath, depth });
    return null;
  }

  const rawConfig = parseConfigFile(absolutePath);
  if (!rawConfig) return null;

  ancestorStack.add(absolutePath);
  const configDir = path.dirname(absolutePath);
  const effective: MergedConfigOptions = {};

  const extendsDirectives =
    typeof rawConfig.extends === 'string' ? [rawConfig.extends] : rawConfig.extends ?? [];

  for (const item of extendsDirectives) {
    if (typeof item !== 'string') continue;
    const resolvedTarget = locateExtendsFile(item, configDir);
    if (!resolvedTarget) {
      logDebug('path-aliases: cannot resolve extends target', { from: absolutePath, specifier: item });
      continue;
    }

    const parentConfig = resolveEffectiveOptions(resolvedTarget, ancestorStack, depth + 1);
    if (!parentConfig) continue;

    if (parentConfig.baseUrl !== undefined) {
      effective.baseUrl = parentConfig.baseUrl;
    }
    if (parentConfig.paths !== undefined) {
      effective.paths = parentConfig.paths;
      effective.pathsDir = parentConfig.pathsDir;
    }
  }

  ancestorStack.delete(absolutePath);

  const compilerOpts = rawConfig.compilerOptions ?? {};
  if (typeof compilerOpts.baseUrl === 'string') {
    effective.baseUrl = path.resolve(configDir, compilerOpts.baseUrl);
  }
  if (compilerOpts.paths && typeof compilerOpts.paths === 'object') {
    effective.paths = compilerOpts.paths;
    effective.pathsDir = configDir;
  }

  return effective;
}

function parseConfigFile(filePath: string): RawTsconfigFormat | null {
  try {
    const rawContent = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(stripJsoncComments(rawContent)) as RawTsconfigFormat;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (err) {
    logDebug('path-aliases: parsing failure', { filePath, err: String(err) });
    return null;
  }
}

function parseWildcardPattern(pattern: string): { prefix: string; suffix: string; hasWildcard: boolean } {
  const wildcardIndex = pattern.indexOf('*');
  if (wildcardIndex === -1) {
    return { prefix: pattern, suffix: '', hasWildcard: false };
  }
  return {
    prefix: pattern.slice(0, wildcardIndex),
    suffix: pattern.slice(wildcardIndex + 1),
    hasWildcard: true,
  };
}

/**
 * Loads project-level TypeScript / JavaScript import path aliases from root configuration.
 */
export function loadProjectAliases(projectRoot: string): AliasMap | null {
  const configCandidates = ['tsconfig.json', 'jsconfig.json', 'tsconfig.base.json'];
  let effectiveOptions: MergedConfigOptions | null = null;
  let matchedConfigName: string | null = null;

  for (const filename of configCandidates) {
    const fullPath = path.join(projectRoot, filename);
    if (!fs.existsSync(fullPath)) continue;

    const resolved = resolveEffectiveOptions(fullPath, new Set(), 0);
    if (!resolved) continue;

    if (!effectiveOptions) {
      effectiveOptions = resolved;
      matchedConfigName = filename;
    }
    if (resolved.paths) {
      effectiveOptions = resolved;
      matchedConfigName = filename;
      break;
    }
  }

  if (!effectiveOptions) return null;

  const resolvedBaseUrl = effectiveOptions.baseUrl ?? effectiveOptions.pathsDir ?? projectRoot;
  const pathsObject = effectiveOptions.paths;

  const parsedPatterns: AliasPattern[] = [];
  if (pathsObject && typeof pathsObject === 'object') {
    for (const [patternKey, targetPaths] of Object.entries(pathsObject)) {
      if (!Array.isArray(targetPaths) || targetPaths.length === 0) continue;
      const validTargets = targetPaths.filter((t): t is string => typeof t === 'string');
      if (validTargets.length === 0) continue;

      const { prefix, suffix, hasWildcard } = parseWildcardPattern(patternKey);
      parsedPatterns.push({
        prefix,
        suffix,
        hasWildcard,
        replacements: validTargets,
        baseDir: resolvedBaseUrl,
      });
    }
  }

  // Also collect paths from referenced project tsconfigs (TypeScript Project References)
  for (const filename of configCandidates) {
    const fullPath = path.join(projectRoot, filename);
    if (!fs.existsSync(fullPath)) continue;
    const rawConfig = parseConfigFile(fullPath);
    if (Array.isArray(rawConfig?.references)) {
      const configDir = path.dirname(fullPath);
      for (const ref of rawConfig.references) {
        if (!ref || typeof ref.path !== 'string') continue;
        const refPath = locateExtendsFile(ref.path, configDir);
        if (!refPath) continue;
        const refDir = path.dirname(refPath);
        const refOptions = resolveEffectiveOptions(refPath, new Set([fullPath]), 0);
        if (refOptions?.paths && typeof refOptions.paths === 'object') {
          const refBase = refOptions.baseUrl ?? refOptions.pathsDir ?? refDir;
          for (const [patternKey, targetPaths] of Object.entries(refOptions.paths)) {
            if (!Array.isArray(targetPaths) || targetPaths.length === 0) continue;
            const validTargets = targetPaths.filter((t): t is string => typeof t === 'string');
            if (validTargets.length === 0) continue;
            const { prefix, suffix, hasWildcard } = parseWildcardPattern(patternKey);
            if (!parsedPatterns.some((p) => p.prefix === prefix && p.suffix === suffix)) {
              parsedPatterns.push({
                prefix,
                suffix,
                hasWildcard,
                replacements: validTargets,
                baseDir: refBase,
              });
            }
          }
        }
      }
    }
  }

  if (parsedPatterns.length === 0) return null;

  // Specificity sort: longest prefix first, literal before wildcard
  parsedPatterns.sort((a, b) => {
    if (a.prefix.length !== b.prefix.length) {
      return b.prefix.length - a.prefix.length;
    }
    if (a.hasWildcard !== b.hasWildcard) {
      return a.hasWildcard ? 1 : -1;
    }
    return 0;
  });

  logDebug('path-aliases loaded', {
    file: matchedConfigName,
    baseUrl: resolvedBaseUrl,
    patternCount: parsedPatterns.length,
  });

  return { baseUrl: resolvedBaseUrl, patterns: parsedPatterns };
}

/** Directory-level cache for enclosing tsconfig aliases. */
const dirAliasCache = new Map<string, AliasMap | null>();

/**
 * Reset directory-level alias cache.
 */
export function clearFileAliasCache(): void {
  dirAliasCache.clear();
}

/**
 * Loads import path aliases for a specific file by searching for the nearest
 * enclosing tsconfig/jsconfig between the file's directory and the project root.
 */
export function loadFileAliases(filePath: string, projectRoot: string): AliasMap | null {
  const normFile = path.resolve(projectRoot, filePath);
  let currentDir = path.dirname(normFile);
  const resolvedRoot = path.resolve(projectRoot);

  while (currentDir.startsWith(resolvedRoot)) {
    let aliases: AliasMap | null | undefined = dirAliasCache.get(currentDir);
    if (aliases === undefined) {
      aliases = loadProjectAliases(currentDir);
      dirAliasCache.set(currentDir, aliases);
    }
    if (aliases !== null) {
      return aliases;
    }

    if (currentDir === resolvedRoot) break;
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }

  return loadProjectAliases(resolvedRoot);
}

/**
 * Maps an import path specifier to candidate filesystem paths according to configured aliases.
 */
export function applyAliases(
  importPath: string,
  aliases: AliasMap,
  projectRoot: string
): string[] {
  for (const pat of aliases.patterns) {
    if (!importPath.startsWith(pat.prefix)) continue;
    if (pat.suffix && !importPath.endsWith(pat.suffix)) continue;

    let wildcardCapture = '';
    if (pat.hasWildcard) {
      wildcardCapture = importPath.slice(pat.prefix.length, importPath.length - pat.suffix.length);
    } else if (importPath !== pat.prefix) {
      continue;
    }

    const candidateResults: string[] = [];
    const baseDir = pat.baseDir ?? aliases.baseUrl;
    for (const replacementTemplate of pat.replacements) {
      const substituted = pat.hasWildcard
        ? replacementTemplate.replace('*', wildcardCapture)
        : replacementTemplate;

      const absoluteTarget = path.resolve(baseDir, substituted);
      const relativeToRoot = path.relative(projectRoot, absoluteTarget);

      if (relativeToRoot.startsWith('..')) continue;
      candidateResults.push(relativeToRoot.replace(/\\/g, '/'));
    }

    return candidateResults;
  }

  return [];
}
