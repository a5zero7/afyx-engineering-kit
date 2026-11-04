import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import AfyxGraph from '../src';
import { CURRENT_SCHEMA_VERSION, getCurrentVersion, runMigrations } from '../src/db/migrations';
import { createDatabase } from '../src/db/sqlite-adapter';
import { ExtractionAdmission } from '../src/extraction/extraction-admission';

describe('universal file catalog foundation', () => {
  let root: string;
  let graph: AfyxGraph | null;

  const write = (relativePath: string, content: string): void => {
    const absolutePath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content);
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-catalog-'));
    graph = null;
    write('.gitignore', 'evaluator-private/\n');
    write('src/service.ts', 'export function catalogPositive(): number { return 1; }\n');
    write('src/empty.ts', '// Valid structural source with no declarations.\n');
    write('README.md', '# Catalog\nCode generated; DO NOT EDIT.\nprivateMarkdownToken must not enter search\n');
    write('config.json', '{"privateJsonToken": true}\n');
    write('scripts/install.ps1', 'Write-Output "unsupportedPowerShellToken"\n');
    write('scripts/install.sh', 'echo unsupportedShellToken\n');
    write('evaluator-private/holdout.md', '# evaluatorCanaryMustStayOut\n');
    write('evaluator-private/rubric.json', '{"evaluatorRubricMustStayOut": true}\n');
  });

  afterEach(() => {
    graph?.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('catalogs Markdown/JSON metadata while preserving structural, ignore, and unsupported boundaries', async () => {
    graph = AfyxGraph.initSync(root);
    const first = await graph.indexAll();

    const files = new Map(graph.getFiles().map((file) => [file.path, file]));
    expect(files.get('README.md')).toMatchObject({
      language: 'markdown', nodeCount: 0, indexingLevel: 'metadata', generated: false,
    });
    expect(files.get('config.json')).toMatchObject({
      language: 'json', nodeCount: 0, indexingLevel: 'metadata',
    });
    expect(files.get('src/service.ts')).toMatchObject({
      language: 'typescript', indexingLevel: 'structural',
    });
    expect(files.get('src/empty.ts')).toMatchObject({
      language: 'typescript', indexingLevel: 'structural',
    });
    expect(files.has('scripts/install.ps1')).toBe(false);
    expect(files.has('scripts/install.sh')).toBe(false);
    expect([...files.keys()].some((file) => file.startsWith('evaluator-private/'))).toBe(false);

    expect(first.filesMetadataIndexed).toBe(2);
    expect(first.filesContentIndexed).toBe(0);
    expect(first.filesStructurallyIndexed).toBe(2);
    expect(first.filesSkipped).toBe(0);
    expect(first.topUnsupportedExtensions).toEqual(expect.arrayContaining([
      expect.objectContaining({ ext: '.ps1', count: 1 }),
      expect.objectContaining({ ext: '.sh', count: 1 }),
    ]));
    expect(graph.searchNodes('catalogPositive').length).toBeGreaterThan(0);
    for (const token of [
      'privateMarkdownToken', 'privateJsonToken', 'unsupportedPowerShellToken',
      'unsupportedShellToken', 'evaluatorCanaryMustStayOut', 'evaluatorRubricMustStayOut',
    ]) {
      expect(graph.searchNodes(token)).toEqual([]);
    }

    const originalHash = files.get('README.md')!.contentHash;
    write('README.md', '# Catalog changed\n');
    expect(await graph.sync({ paths: ['README.md'] })).toMatchObject({ filesModified: 1 });
    expect(graph.getFile('README.md')?.contentHash).not.toBe(originalHash);
    expect(graph.getFile('README.md')?.indexingLevel).toBe('metadata');

    write('docs/new.json', '{"added": true}\n');
    expect(await graph.sync({ paths: ['docs/new.json'] })).toMatchObject({ filesAdded: 1 });
    fs.renameSync(path.join(root, 'config.json'), path.join(root, 'renamed.json'));
    expect(await graph.sync({ paths: ['config.json', 'renamed.json'] })).toMatchObject({
      filesAdded: 1, filesRemoved: 1,
    });
    fs.rmSync(path.join(root, 'README.md'));
    expect(await graph.sync({ paths: ['README.md'] })).toMatchObject({ filesRemoved: 1 });

    write('evaluator-private/late.md', '# lateEvaluatorCanary\n');
    expect(await graph.sync({ paths: ['evaluator-private/late.md'] })).toMatchObject({
      filesAdded: 0, filesModified: 0, filesRemoved: 0,
    });
    expect(graph.getFiles().some((file) => file.path.startsWith('evaluator-private/'))).toBe(false);

    graph.close();
    graph = AfyxGraph.openSync(root);
    expect(graph.getFile('docs/new.json')?.indexingLevel).toBe('metadata');
    expect(graph.getFile('renamed.json')?.indexingLevel).toBe('metadata');
    expect(graph.getFile('README.md')).toBeNull();
    expect(graph.getFile('src/empty.ts')).toMatchObject({ indexingLevel: 'structural' });
    expect(await graph.sync()).toMatchObject({ filesAdded: 0, filesModified: 0, filesRemoved: 0 });
    expect(graph.getFile('src/empty.ts')).toMatchObject({ indexingLevel: 'structural' });

    const rebuilt = await graph.indexAll();
    const repeated = await graph.indexAll();
    const accounting = (result: typeof rebuilt) => ({
      indexed: result.filesIndexed,
      skipped: result.filesSkipped,
      unsupported: result.filesSkippedUnsupported,
      metadata: result.filesMetadataIndexed,
      content: result.filesContentIndexed,
      structural: result.filesStructurallyIndexed,
    });
    expect(accounting(repeated)).toEqual(accounting(rebuilt));
    expect(accounting(repeated)).toMatchObject({ metadata: 2, content: 0, structural: 2 });
  });

  it('classifies a successful zero-symbol structural parse by parser capability, not node count', () => {
    const admission = new ExtractionAdmission(null as never);
    expect(admission.fileRecord(
      'src/empty.ts',
      '',
      'typescript',
      { size: 0, mtimeMs: 0 },
      0,
      [],
    )).toMatchObject({ indexingLevel: 'structural', nodeCount: 0 });
  });

  it('migrates v9 file rows to explicit catalog depth without refreezing structural data', () => {
    const db = createDatabase(path.join(root, 'migration.db')).db;
    try {
      db.exec(`
        CREATE TABLE schema_versions (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL, description TEXT);
        INSERT INTO schema_versions VALUES (9, 0, 'legacy v9');
        CREATE TABLE files (
          path TEXT PRIMARY KEY, content_hash TEXT NOT NULL, language TEXT NOT NULL,
          size INTEGER NOT NULL, modified_at INTEGER NOT NULL, indexed_at INTEGER NOT NULL,
          node_count INTEGER DEFAULT 0, errors TEXT, generated INTEGER NOT NULL DEFAULT 0
        );
        INSERT INTO files VALUES ('application.yaml', 'yaml-hash', 'yaml', 1, 0, 0, 0, NULL, 0);
        INSERT INTO files VALUES ('src/app.ts', 'ts-hash', 'typescript', 1, 0, 0, 1, NULL, 0);
        INSERT INTO files VALUES ('src/legacy-empty.ts', 'empty-hash', 'typescript', 1, 0, 0, 0, NULL, 0);
      `);

      runMigrations(db, 9);

      expect(getCurrentVersion(db)).toBe(CURRENT_SCHEMA_VERSION);
      expect(db.prepare('SELECT path, indexing_level FROM files ORDER BY path').all()).toEqual([
        { path: 'application.yaml', indexing_level: 'metadata' },
        { path: 'src/app.ts', indexing_level: 'structural' },
      ]);
    } finally {
      db.close();
    }
  });
});
