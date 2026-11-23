import { describe, expect, it } from 'vitest';
import {
  executeFilesTool,
  type FilesToolFile,
  type FilesToolSource,
} from '../src/mcp/files-tool';

const FILES: FilesToolFile[] = [
  { path: 'src/z.ts', language: 'typescript', nodeCount: 3 },
  { path: 'src/a.ts', language: 'typescript', nodeCount: 1 },
  { path: 'src/deep/a.test.ts', language: 'typescript', nodeCount: 2 },
  { path: 'src-utils/helper.ts', language: 'typescript', nodeCount: 4 },
  { path: 'web/App.tsx', language: 'tsx', nodeCount: 5 },
  { path: 'docs/a+b.md', language: 'markdown', nodeCount: 0, indexingLevel: 'metadata' },
];

function fixture(files: FilesToolFile[] = FILES) {
  let calls = 0;
  const source: FilesToolSource = {
    getFiles() {
      calls += 1;
      return files.map((file) => ({ ...file }));
    },
  };
  return { source, calls: () => calls };
}

const text = (source: FilesToolSource, request: Parameters<typeof executeFilesTool>[1] = {}): string =>
  executeFilesTool(source, request).content[0]!.text;

describe('MCP Files adapter', () => {
  it('invokes getFiles exactly once and returns the exact empty-index result', () => {
    const empty = fixture([]);
    expect(executeFilesTool(empty.source, {})).toEqual({
      content: [{ type: 'text', text: 'No files indexed. Run `afyx-graph index` first.' }],
    });
    expect(empty.calls()).toBe(1);

    const populated = fixture();
    executeFilesTool(populated.source, { format: 'flat' });
    expect(populated.calls()).toBe(1);
  });

  it.each([undefined, '', '/', '.', './', '\\', '//', './/'])
  ('treats root-ish path %p as the whole project', (path) => {
    const { source } = fixture();
    const output = text(source, { path, format: 'flat', includeMetadata: false });
    expect(output).toContain('src/a.ts');
    expect(output).toContain('src-utils/helper.ts');
  });

  it.each(['src', '/src', './src', 'src/'])
  ('normalizes subtree path %p and enforces the segment boundary', (path) => {
    const { source } = fixture();
    const output = text(source, { path, format: 'flat', includeMetadata: false });
    expect(output).toContain('src/a.ts');
    expect(output).not.toContain('src-utils/helper.ts');
  });

  it('normalizes Windows separators and supports an exact-file filter', () => {
    const windows = fixture();
    expect(text(windows.source, {
      path: 'src\\deep', format: 'flat', includeMetadata: false,
    })).toContain('src/deep/a.test.ts');

    const exact = fixture();
    expect(text(exact.source, {
      path: 'src/a.ts', format: 'flat', includeMetadata: false,
    })).toBe('**Files (1)**\n\n- src/a.ts');
  });

  it('preserves the unanchored *, cross-segment **, ?, and regex-literal glob behavior', () => {
    const star = fixture();
    const starOutput = text(star.source, { pattern: '*.ts', format: 'flat', includeMetadata: false });
    expect(starOutput).toContain('src/deep/a.test.ts');
    expect(starOutput).toContain('web/App.tsx');

    const segmentStar = fixture();
    const segmentStarOutput = text(segmentStar.source, {
      pattern: 'src/*.ts', format: 'flat', includeMetadata: false,
    });
    expect(segmentStarOutput).toContain('src/a.ts');
    expect(segmentStarOutput).not.toContain('src/deep/a.test.ts');

    const globstar = fixture();
    expect(text(globstar.source, {
      pattern: '**/*.test.ts', format: 'flat', includeMetadata: false,
    })).toContain('src/deep/a.test.ts');

    const deepGlobstar = fixture([
      { path: 'src/deep/nested/a.test.ts', language: 'typescript', nodeCount: 1 },
    ]);
    expect(text(deepGlobstar.source, {
      pattern: 'src/**/a.test.ts', format: 'flat', includeMetadata: false,
    })).toContain('src/deep/nested/a.test.ts');

    const question = fixture();
    expect(text(question.source, {
      pattern: 'src/?.ts', format: 'flat', includeMetadata: false,
    })).toContain('src/a.ts');

    const questionSlash = fixture();
    expect(text(questionSlash.source, {
      pattern: 'src?deep/a.test.ts', format: 'flat', includeMetadata: false,
    })).toBe('No files found matching the criteria.');

    const literal = fixture();
    expect(text(literal.source, {
      pattern: 'a+b.md', format: 'flat', includeMetadata: false,
    })).toContain('docs/a+b.md');
  });

  it('combines subtree and glob filters and returns the exact no-match result', () => {
    const matched = fixture();
    const output = text(matched.source, {
      path: 'src', pattern: '**/*.test.ts', format: 'flat', includeMetadata: false,
    });
    expect(output).toContain('src/deep/a.test.ts');
    expect(output).not.toContain('src-utils/helper.ts');

    const missing = fixture();
    expect(executeFilesTool(missing.source, { pattern: '*.rs' })).toEqual({
      content: [{ type: 'text', text: 'No files found matching the criteria.' }],
    });
  });

  it('defaults and unknown runtime formats to tree', () => {
    const omitted = fixture();
    const tree = text(omitted.source);
    expect(tree).toContain('**Project Structure (6 files)**');

    const unknown = fixture();
    expect(text(unknown.source, { format: 'unknown' })).toBe(tree);
  });

  it('enables metadata unless the value is literal false', () => {
    const omitted = fixture();
    expect(text(omitted.source, { format: 'flat' })).toContain('(typescript, structural-indexed, 1 symbols)');
    expect(text(omitted.source, { format: 'flat' })).toContain('(markdown, metadata-indexed, 0 symbols)');

    const disabled = fixture();
    expect(text(disabled.source, { format: 'flat', includeMetadata: false })).not.toContain('symbols)');

    const unusual = fixture();
    expect(text(unusual.source, { format: 'flat', includeMetadata: 0 })).toContain('(typescript, structural-indexed, 1 symbols)');
  });

  it('preserves maxDepth lower/upper clamps and rendering levels', () => {
    const zero = fixture();
    const depthZero = text(zero.source, { format: 'tree', maxDepth: 0 });
    const one = fixture();
    expect(depthZero).toBe(text(one.source, { format: 'tree', maxDepth: 1 }));
    expect(depthZero).toContain('└── web');
    expect(depthZero).not.toContain('App.tsx');

    const two = fixture();
    expect(text(two.source, { format: 'tree', maxDepth: 2 })).toContain('App.tsx');

    const deep = [{
      path: `${'d/'.repeat(20)}file.ts`, language: 'typescript', nodeCount: 1,
    }];
    const over = fixture(deep);
    const twenty = fixture(deep);
    const twentyText = text(twenty.source, { format: 'tree', maxDepth: 20 });
    expect(text(over.source, { format: 'tree', maxDepth: 99 })).toBe(twentyText);
    expect(twentyText.split('\n')).toHaveLength(22);
    expect(twentyText).not.toContain('file.ts');
  });

  it('renders exact flat output in deterministic path order', () => {
    const { source } = fixture([
      { path: 'z.ts', language: 'typescript', nodeCount: 1 },
      { path: 'a.ts', language: 'typescript', nodeCount: 2 },
    ]);
    expect(text(source, { format: 'flat' })).toBe(
      '**Files (2)**\n\n' +
      '- a.ts (typescript, structural-indexed, 2 symbols)\n' +
      '- z.ts (typescript, structural-indexed, 1 symbols)',
    );
  });

  it('renders grouped output by descending count with stable ties and sorted paths', () => {
    const { source } = fixture([
      { path: 'z.ts', language: 'typescript', nodeCount: 1 },
      { path: 'a.ts', language: 'typescript', nodeCount: 2 },
      { path: 'b.py', language: 'python', nodeCount: 3 },
      { path: 'c.rs', language: 'rust', nodeCount: 4 },
    ]);
    expect(text(source, { format: 'grouped' })).toBe(
      '**Files by Language (4 total)**\n\n' +
      '**typescript (2)**\n- a.ts (structural-indexed, 2 symbols)\n- z.ts (structural-indexed, 1 symbols)\n\n' +
      '**python (1)**\n- b.py (structural-indexed, 3 symbols)\n\n' +
      '**rust (1)**\n- c.rs (structural-indexed, 4 symbols)\n',
    );
  });

  it('renders the exact tree connectors, directory-first order, and file metadata', () => {
    const { source } = fixture([
      { path: 'z.ts', language: 'typescript', nodeCount: 1 },
      { path: 'src/b.ts', language: 'typescript', nodeCount: 2 },
      { path: 'src/a.ts', language: 'typescript', nodeCount: 3 },
    ]);
    expect(text(source, { format: 'tree' })).toBe(
      '**Project Structure (3 files)**\n\n' +
      '├── src\n│   ├── a.ts (typescript, structural-indexed, 3 symbols)\n│   └── b.ts (typescript, structural-indexed, 2 symbols)\n' +
      '└── z.ts (typescript, structural-indexed, 1 symbols)',
    );
  });

  it('consumes the frozen shared output bound deterministically', () => {
    const files = Array.from({ length: 260 }, (_, index) => ({
      path: `src/${'deep/'.repeat(6)}${index}-${'x'.repeat(50)}.ts`,
      language: 'typescript',
      nodeCount: index,
    }));
    const first = fixture(files);
    const firstText = text(first.source, { format: 'flat' });
    const second = fixture(files);
    expect(text(second.source, { format: 'flat' })).toBe(firstText);
    expect(firstText.endsWith('\n\n... (output truncated)')).toBe(true);
    expect(firstText.length).toBeLessThanOrEqual(15_024);
  });
});
