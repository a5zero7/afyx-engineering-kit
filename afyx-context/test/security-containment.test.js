import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import {
  checkPathContainment,
  assertPathContained,
  canonicalizePath,
} from '../src/path-containment.js';
import { DbInspector } from '../src/db-inspector.js';
import { CliCompactor } from '../src/cli-compactor.js';
import { MassiveContextNavigator } from '../src/massive-context.js';

test('Path Containment: Rejects directory traversal and escapes outside workspace', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-containment-test-'));
  const workspaceRoot = path.join(tempDir, 'workspace');
  const insideDir = path.join(workspaceRoot, 'sub');
  const outsideDir = path.join(tempDir, 'outside');
  fs.mkdirSync(insideDir, { recursive: true });
  fs.mkdirSync(outsideDir, { recursive: true });

  const insideFile = path.join(insideDir, 'file.txt');
  const outsideFile = path.join(outsideDir, 'secret.txt');
  fs.writeFileSync(insideFile, 'hello inside');
  fs.writeFileSync(outsideFile, 'secret outside');

  try {
    // 1. Valid containment inside workspace
    const valid = checkPathContainment('sub/file.txt', workspaceRoot, { expectFile: true });
    assert.equal(valid.contained, true);
    assert.equal(valid.canonicalPath, fs.realpathSync(insideFile));

    // 2. Traversal rejection via ../
    const traversal = checkPathContainment('../outside/secret.txt', workspaceRoot);
    assert.equal(traversal.contained, false);
    assert.equal(traversal.reason, 'PATH_TRAVERSAL_ESCAPE');

    // 3. Absolute path outside workspace
    const absoluteEscape = checkPathContainment(outsideFile, workspaceRoot);
    assert.equal(absoluteEscape.contained, false);

    // 4. Regular file expectation failure when path is a directory
    const dirAsFile = checkPathContainment('sub', workspaceRoot, { expectFile: true });
    assert.equal(dirAsFile.contained, false);
    assert.equal(dirAsFile.reason, 'DIRECTORY_NOT_ALLOWED');

    // 5. assertPathContained throws on escape
    assert.throws(() => {
      assertPathContained('../../escape.txt', workspaceRoot);
    }, /resolves outside workspace/i);

  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('DbInspector: Strict read-only mode, schema extraction, and hash invariance', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-db-test-'));
  const dbPath = path.join(tempDir, 'test.db');

  // Create real test SQLite database
  const setupDb = new DatabaseSync(dbPath);
  setupDb.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, email TEXT, password_hash TEXT);
    INSERT INTO users VALUES (1, 'alice', 'alice@example.com', 'secret_hash_alice');
    INSERT INTO users VALUES (2, 'bob', 'bob@example.com', 'secret_hash_bob');
    CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER, amount REAL);
    INSERT INTO orders VALUES (101, 1, 99.50);
    CREATE VIEW user_orders AS SELECT u.username, o.amount FROM users u JOIN orders o ON u.id = o.user_id;
  `);
  setupDb.close();

  try {
    const inspector = new DbInspector(tempDir);

    // 1. Inspect valid database
    const result = inspector.inspectDataset('test.db', { sampleLimit: 5 });
    assert.equal(result.status, 'INSPECTED');
    assert.equal(result.format, 'sqlite');
    assert.equal(result.readOnly, true);
    assert.ok(result.tables.some((t) => t.name === 'users'));
    assert.ok(result.tables.some((t) => t.name === 'orders'));
    assert.ok(result.views.some((v) => v.name === 'user_orders'));
    assert.equal(result.hashVerifiedUnchanged, true);
    assert.ok(result.databaseHash);

    // 2. Reject path outside workspace
    const accessDenied = inspector.inspectDataset('../other.db');
    assert.equal(accessDenied.status, 'ACCESS_DENIED');
    assert.equal(accessDenied.reason, 'PATH_TRAVERSAL_ESCAPE');

    // 3. Reject non-existent database file
    const notFound = inspector.inspectDataset('nonexistent.db');
    assert.equal(notFound.status, 'FILE_NOT_FOUND');

  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('CliCompactor: Lossless error retention, private spill creation, and recovery', () => {
  const compactor = new CliCompactor({
    maxOutputLines: 15,
    maxErrorLines: 20,
    headLines: 5,
    tailLines: 5,
  });

  // Generate 200 lines with 5 distinct errors
  const lines = [];
  for (let i = 1; i <= 200; i++) {
    if (i === 30) lines.push('Error: Connection refused to redis at localhost:6379');
    else if (i === 60) lines.push('FAIL: src/api/user.test.ts (TypeError: undefined is not a function)');
    else if (i === 90) lines.push('AssertionError [ERR_ASSERTION]: expected 200 but got 500');
    else if (i === 120) lines.push('fatal: destination path already exists');
    else if (i === 150) lines.push('ERROR 1045 (28000): Access denied for user "root"');
    else lines.push(`[INFO] Step ${i}: Normal build step running successfully...`);
  }
  const rawText = lines.join('\n');

  const compacted = compactor.compact(rawText, {
    command: 'npm test',
    preserveFailures: true,
  });

  assert.ok(compacted.spillFilePath);
  assert.ok(fs.existsSync(compacted.spillFilePath));
  assert.ok(compacted.spillFilePath.includes('afyx-cli-spill-') || compacted.spillFilePath.includes('afyx_raw_cli_'));

  // All 5 error messages are preserved in the summary
  assert.equal(compacted.failuresPreserved, 5);
  for (const err of [
    'Connection refused to redis',
    'FAIL: src/api/user.test.ts',
    'AssertionError',
    'fatal: destination path already exists',
    'ERROR 1045 (28000)',
  ]) {
    assert.ok(compacted.compactedOutput.includes(err));
  }

  // Raw recovery works perfectly
  const recovered = CliCompactor.recoverSpill(compacted.spillFilePath);
  assert.equal(recovered, rawText);

  // Clean up spill
  fs.rmSync(path.dirname(compacted.spillFilePath), { recursive: true, force: true });
});

test('MassiveContextNavigator: Bounded streaming chunk index and slice extraction', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-massive-test-'));
  const testFile = path.join(tempDir, 'large-log.txt');

  // Generate 300KB file synchronously
  const lines = [];
  for (let i = 1; i <= 6000; i++) {
    lines.push(`Line ${String(i).padStart(5, '0')}: Simulated payload timestamp=2026-11-21 chunk data test`);
  }
  fs.writeFileSync(testFile, lines.join('\n') + '\n', 'utf8');

  try {
    const navigator = new MassiveContextNavigator(tempDir, {
      chunkSizeBytes: 64 * 1024, // 64KB
      maxMemoryBudgetBytes: 256 * 1024,
    });

    const index = navigator.indexWorkspace();
    assert.equal(index.status, 'INDEXED');
    assert.ok(index.indexedFiles >= 1);
    assert.ok(index.totalBytesScanned > 300_000);

    // Retrieve context bounded by token budget
    const retrieval = navigator.retrieveContext('Simulated payload', { maxTokens: 200 });
    assert.equal(retrieval.status, 'RETRIEVED');
    assert.ok(retrieval.segments.length > 0);
    assert.ok(retrieval.segments[0].content.includes('Line '));

    // Direct slice reading with byte offsets
    const slice = navigator._readSlice(testFile, 0, 500);
    assert.ok(slice.length > 0);
    assert.ok(slice.includes('Line 00001'));

    // Reject traversal in _readSlice
    const outsideSlice = navigator._readSlice(path.resolve(tempDir, '../outside.txt'), 0, 100);
    assert.equal(outsideSlice, '');

  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
