import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ExtractorRegistry } from '../src/extraction/extractor-registry';
import { definitionDelta, reconcileSources } from '../src/extraction/reconciliation';
import { hashContent } from '../src/extraction/content-hash';

import type { FileRecord } from '../src/types';


function tracked(path: string, content: string, modifiedAt = 1): FileRecord {
  return {
    path,
    contentHash: hashContent(content),
    language: 'typescript',
    size: Buffer.byteLength(content),
    modifiedAt,
    indexedAt: 1,
    nodeCount: 1,
  };
}

describe('Afyx-native extractor registry', () => {
  it('owns language selection and parser dispatch', () => {
    const registry = new ExtractorRegistry();
    const source = 'export function ready(): boolean { return true; }\n';
    expect(registry.languageFor('src/ready.ts', source)).toBe('typescript');
    expect(registry.supports('src/ready.ts', source)).toBe(true);
    expect(registry.extract('src/ready.ts', source).nodes).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'ready', kind: 'function' })]),
    );
  });

  it('returns an empty extraction result for unsupported input', () => {
    const registry = new ExtractorRegistry();
    expect(registry.supports('README.txt', 'plain text')).toBe(false);
    expect(registry.extract('README.txt', 'plain text')).toEqual({
      nodes: [], edges: [], unresolvedReferences: [], errors: [], durationMs: 0,
    });
  });
});

describe('Afyx-native source reconciliation', () => {
  it('classifies add/modify/remove while preserving unchanged files', async () => {
    const contents = new Map([
      ['same.ts', 'export const same = 1;\n'],
      ['changed.ts', 'export const changed = 2;\n'],
      ['added.ts', 'export const added = 3;\n'],
    ]);
    const records = [
      tracked('same.ts', contents.get('same.ts')!),
      tracked('changed.ts', 'export const changed = 1;\n'),
      tracked('removed.ts', 'export const removed = 1;\n'),
    ];
    const removed: string[] = [];
    const reads: string[] = [];

    const result = await reconcileSources({
      currentFiles: ['same.ts', 'changed.ts', 'added.ts'],
      trackedFiles: records,
      filesChecked: 3,
      hash: hashContent,
      io: {
        exists: (filePath) => contents.has(filePath),
        stat: (filePath) => ({
          size: Buffer.byteLength(contents.get(filePath)!),
          mtimeMs: filePath === 'same.ts' ? 1 : 2,
        }),
        read: (filePath) => {
          reads.push(filePath);
          return contents.get(filePath)!;
        },
      },
      onRemove: (file) => removed.push(file.path),
    });

    expect(result).toEqual({
      filesChecked: 3,
      filesAdded: 1,
      filesModified: 1,
      filesRemoved: 1,
      filesToIndex: ['changed.ts', 'added.ts'],
      changedFilePaths: ['changed.ts', 'added.ts'],
      failedFilePaths: [],
    });
    expect(removed).toEqual(['removed.ts']);
    expect(reads).toEqual(['changed.ts', 'added.ts']);
  });

  it('retains stat/read failures for retry without classifying a change', async () => {
    const onFailure = vi.fn();
    const result = await reconcileSources({
      currentFiles: ['stat.ts', 'read.ts'],
      trackedFiles: [tracked('stat.ts', 'old'), tracked('read.ts', 'old')],
      filesChecked: 2,
      hash: hashContent,
      io: {
        exists: () => true,
        stat: (filePath) => {
          if (filePath === 'stat.ts') throw new Error('stat failed');
          return { size: 9, mtimeMs: 2 };
        },
        read: () => { throw new Error('read failed'); },
      },
      onRemove: vi.fn(),
      onReadFailure: onFailure,
    });

    expect(result.failedFilePaths).toEqual(['stat.ts', 'read.ts']);
    expect(result.filesToIndex).toEqual([]);
    expect(onFailure.mock.calls.map((call) => call.slice(0, 2))).toEqual([
      ['stat.ts', 'stat'],
      ['read.ts', 'read'],
    ]);
  });

  it('computes per-file definition changes without cross-file cancellation', () => {
    const before = new Set(['a.ts\0keep', 'z.ts\0moved', 'z.ts\0shared']);
    const after = new Set(['a.ts\0keep', 'a.ts\0moved', 'z.ts\0shared']);
    expect(definitionDelta(before, after)).toEqual(['moved']);
  });
});
