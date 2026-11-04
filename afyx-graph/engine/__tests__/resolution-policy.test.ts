import { describe, expect, it } from 'vitest';
import type { Node } from '../src/types';
import type { UnresolvedRef } from '../src/resolution/types';
import { preferCallSiteFile, selectBestCandidate } from '../src/resolution/resolution-policy';

function node(id: string, filePath: string, overrides: Partial<Node> = {}): Node {
  return {
    id,
    kind: 'function',
    name: 'target',
    qualifiedName: 'target',
    filePath,
    language: 'typescript',
    startLine: 1,
    endLine: 1,
    startColumn: 0,
    endColumn: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function ref(overrides: Partial<UnresolvedRef> = {}): UnresolvedRef {
  return {
    fromNodeId: 'caller',
    referenceName: 'target',
    referenceKind: 'calls',
    line: 20,
    column: 2,
    filePath: 'feature/caller.ts',
    language: 'typescript',
    ...overrides,
  };
}

describe('resolution candidate policy', () => {
  it('promotes call-site-local candidates without disturbing remaining order', () => {
    const first = node('first', 'other/first.ts');
    const local = node('local', 'feature/caller.ts');
    const last = node('last', 'other/last.ts');
    expect(preferCallSiteFile([first, local, last], 'feature/caller.ts').map((entry) => entry.id))
      .toEqual(['local', 'first', 'last']);
  });

  it('selects a same-file candidate over otherwise stronger cross-file candidates', () => {
    const exported = node('exported', 'feature/exported.ts', { isExported: true });
    const local = node('local', 'feature/caller.ts', { kind: 'class', startLine: 100 });
    expect(selectBestCandidate(ref(), [exported, local])?.id).toBe('local');
  });

  it('retains the first candidate when all observable scores are equal', () => {
    const first = node('first', 'feature/a.ts', { isExported: true });
    const second = node('second', 'feature/b.ts', { isExported: true });
    expect(selectBestCandidate(ref(), [first, second])?.id).toBe('first');
  });

  it('prefers same-language candidates over cross-language candidates', () => {
    const crossLanguage = node('python', 'feature/a.py', { language: 'python', isExported: true });
    const sameLanguage = node('typescript', 'remote/b.ts');
    expect(selectBestCandidate(ref(), [crossLanguage, sameLanguage])?.id).toBe('typescript');
  });
});
