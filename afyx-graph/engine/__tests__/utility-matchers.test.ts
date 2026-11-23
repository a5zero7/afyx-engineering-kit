import { describe, expect, it } from 'vitest';
import { createIgnoreMatcher } from '../src/runtime/ignore-matcher';
import { matchesPathPattern } from '../src/runtime/path-pattern';

describe('Afyx ignore matcher contract', () => {
  const cases: Array<{
    patterns: string[];
    expected: Record<string, boolean>;
  }> = [
    {
      patterns: ['# comment', '', 'dist/'],
      expected: { 'dist/': true, 'dist/a.ts': true, 'src/dist/a.ts': true, 'dist.ts': false },
    },
    {
      patterns: ['*.log', '!keep.log'],
      expected: { 'a.log': true, 'x/a.log': true, 'keep.log': false, 'x/keep.log': false },
    },
    {
      patterns: ['/root.txt', 'docs/*.md', 'docs/**/gen?.ts'],
      expected: {
        'root.txt': true,
        'x/root.txt': false,
        'docs/a.md': true,
        'x/docs/a.md': false,
        'docs/a/gen1.ts': true,
        'docs/gen2.ts': true,
      },
    },
    {
      patterns: ['\\!literal', '\\#hash', 'build/', '!build/keep.ts'],
      expected: {
        '!literal': true,
        '#hash': true,
        'build/': true,
        'build/x.ts': true,
        'build/keep.ts': true,
      },
    },
    {
      patterns: ['src/?est.[jt]s'],
      expected: { 'src/test.js': true, 'src/best.ts': true, 'src/nest.cs': false },
    },
    {
      patterns: ['foo/*', '!foo/keep.ts'],
      expected: { 'foo/drop.ts': true, 'foo/keep.ts': false },
    },
    {
      patterns: ['foo/', '!foo/keep.ts'],
      expected: { 'foo/drop.ts': true, 'foo/keep.ts': true },
    },
  ];

  for (const [index, contract] of cases.entries()) {
    it(`preserves ordered ignore contract ${index + 1}`, () => {
      const matcher = createIgnoreMatcher().add(contract.patterns);
      for (const [candidate, expected] of Object.entries(contract.expected)) {
        expect(matcher.ignores(candidate), candidate).toBe(expected);
        expect(matcher.ignores(candidate.replace(/\//g, '\\')), `Windows ${candidate}`).toBe(expected);
      }
    });
  }

  it('treats traversal-like candidates as outside repository scope', () => {
    const matcher = createIgnoreMatcher().add(['*.ts']);
    expect(matcher.ignores('../outside.ts')).toBe(false);
    expect(matcher.ignores('src/../../outside.ts')).toBe(false);
  });

  it('rejects malformed patterns before repository traversal', () => {
    expect(() => createIgnoreMatcher().add('broken-[')).toThrow(/unterminated character class/);
  });
});

describe('Afyx path-pattern contract', () => {
  const cases: Array<[string, Record<string, boolean>]> = [
    ['crates/*', { 'crates/a': true, 'crates/a/b': false }],
    ['helix-*', { 'helix-core': true, 'x/helix-core': false }],
    ['packages/**/core', { 'packages/x/core': true, 'packages/x/y/core': true }],
    ['a/?/c', { 'a/b/c': true, 'a/bb/c': false }],
  ];

  for (const [pattern, expected] of cases) {
    it(`matches observed glob subset: ${pattern}`, () => {
      for (const [candidate, result] of Object.entries(expected)) {
        expect(matchesPathPattern(pattern, candidate), candidate).toBe(result);
        expect(matchesPathPattern(pattern, candidate.replace(/\//g, '\\')), `Windows ${candidate}`).toBe(result);
      }
    });
  }

  it('rejects unsupported syntax and traversal-like candidates', () => {
    expect(() => matchesPathPattern('crates/{a,b}', 'crates/a')).toThrow(/unsupported/);
    expect(matchesPathPattern('**/*.ts', '../outside.ts')).toBe(false);
  });
});
