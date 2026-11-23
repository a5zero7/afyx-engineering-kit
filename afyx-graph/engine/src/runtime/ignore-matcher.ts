import { compilePathPattern } from './path-pattern';

export interface AfyxIgnoreMatcher {
  add(patterns: string | readonly string[]): AfyxIgnoreMatcher;
  ignores(candidate: string): boolean;
}

interface IgnoreRule {
  negative: boolean;
  directoryOnly: boolean;
  hasSlash: boolean;
  matcher: RegExp;
}

function trimUnescapedTrailingSpaces(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === ' ') {
    let slashes = 0;
    for (let at = end - 2; at >= 0 && value[at] === '\\'; at--) slashes++;
    if (slashes % 2 === 1) break;
    end--;
  }
  return value.slice(0, end).replace(/\\ /g, ' ');
}

function parseRule(source: string): IgnoreRule | null {
  let pattern = trimUnescapedTrailingSpaces(source.replace(/\r$/, ''));
  if (!pattern || pattern[0] === '#') return null;

  let negative = false;
  if (pattern[0] === '!') {
    negative = true;
    pattern = pattern.slice(1);
  } else if (pattern.startsWith('\\!') || pattern.startsWith('\\#')) {
    pattern = pattern.slice(1);
  }
  if (!pattern) return null;

  const directoryOnly = pattern.endsWith('/');
  if (directoryOnly) pattern = pattern.slice(0, -1);
  const rooted = pattern.startsWith('/');
  if (rooted) pattern = pattern.slice(1);
  const hasSlash = rooted || pattern.includes('/');
  const core = compilePathPattern(pattern).source.slice(1, -1);
  return {
    negative,
    directoryOnly,
    hasSlash,
    matcher: new RegExp(hasSlash ? `^${core}(?:/|$)` : `(?:^|/)${core}(?:/|$)`),
  };
}

function ruleMatches(rule: IgnoreRule, candidate: string, isDirectory: boolean): boolean {
  const match = rule.matcher.exec(candidate);
  if (!match) return false;
  if (!rule.directoryOnly) return true;
  const matched = match[0].replace(/^\//, '');
  return matched.endsWith('/') || isDirectory || matched.length < candidate.length;
}

class Matcher implements AfyxIgnoreMatcher {
  private readonly rules: IgnoreRule[] = [];

  add(patterns: string | readonly string[]): AfyxIgnoreMatcher {
    const lines = typeof patterns === 'string' ? patterns.split(/\n/) : patterns;
    for (const line of lines) {
      const rule = parseRule(line);
      if (rule) this.rules.push(rule);
    }
    return this;
  }

  private directlyIgnored(candidate: string, isDirectory: boolean): boolean {
    let ignored = false;
    for (const rule of this.rules) {
      if (ruleMatches(rule, candidate, isDirectory)) ignored = !rule.negative;
    }
    return ignored;
  }

  ignores(candidate: string): boolean {
    const isDirectory = /[\\/]$/.test(candidate);
    const normalized = candidate.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+|\/+$/g, '');
    if (!normalized || normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
      return false;
    }
    if (this.directlyIgnored(normalized, isDirectory)) return true;

    // Git cannot re-include an entry below a directory that remains ignored.
    const segments = normalized.split('/');
    for (let end = 1; end < segments.length; end++) {
      if (this.directlyIgnored(segments.slice(0, end).join('/'), true)) return true;
    }
    return false;
  }
}

export function createIgnoreMatcher(): AfyxIgnoreMatcher {
  return new Matcher();
}
