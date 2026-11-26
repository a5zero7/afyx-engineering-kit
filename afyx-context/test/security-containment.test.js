import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
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
    // The native realpath oracle resolves Windows 8.3 aliases as well as symlinks.
    assert.equal(valid.canonicalPath, fs.realpathSync.native(insideFile));

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

test('Authorized workspace aliases preserve one physical index and exact UTF-8 slices', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-root-alias-'));
  try {
    const physical = path.join(fs.realpathSync.native(temp), 'workspace');
    const alias = path.join(temp, 'authorized');
    const linkType = process.platform === 'win32' ? 'junction' : 'dir';
    fs.mkdirSync(path.join(physical, 'docs'), { recursive: true });
    fs.symlinkSync(physical, alias, linkType);
    fs.symlinkSync(path.join(physical, 'docs'), path.join(physical, 'alias-docs'), linkType);
    const bytes = Buffer.from('# AliasEvidence\r\nCafé 🚀\nMixed newline\r\n');
    const file = path.join(physical, 'docs', 'evidence.md');
    fs.writeFileSync(file, bytes);
    for (const target of ['docs/evidence.md', path.join(alias, 'docs', 'evidence.md'), file]) {
      assert.deepEqual(checkPathContainment(target, alias, { expectFile: true, mustExist: true }),
        { contained: true, canonicalPath: file });
    }

    const navigator = new MassiveContextNavigator(alias);
    const result = navigator.indexWorkspace({ includeDirs: ['docs', path.join(alias, 'alias-docs'), path.join(physical, 'docs')] });
    assert.equal(result.indexedFiles, 1);
    assert.deepEqual([...navigator.index.keys()], ['docs/evidence.md']);
    const segments = navigator.retrieveContext('AliasEvidence').segments;
    assert.ok(segments.length > 0);
    for (const segment of segments) {
      assert.equal(segment.file, 'docs/evidence.md');
      assert.equal(segment.content, bytes.subarray(segment.startByte, segment.endByte).toString('utf8'));
    }
    assert.equal(navigator._readSlice(path.join(alias, 'docs', 'evidence.md'), 0, bytes.length), bytes.toString('utf8'));

    fs.unlinkSync(file);
    assert.equal(navigator.indexWorkspace().indexedFiles, 0);
    assert.equal(navigator.retrieveContext('AliasEvidence').segments.length, 0);
    fs.writeFileSync(file, bytes);
    assert.equal(navigator.indexWorkspace().indexedFiles, 1);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('Path probes fail closed on dangling links, cycles and escaped directories', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-probe-boundary-'));
  try {
    const root = path.join(temp, 'root');
    const sibling = path.join(temp, 'root-sibling');
    const linkType = process.platform === 'win32' ? 'junction' : 'dir';
    fs.mkdirSync(root);
    fs.mkdirSync(sibling);
    fs.writeFileSync(path.join(sibling, 'file.txt'), 'fixture');
    fs.symlinkSync(sibling, path.join(root, 'outside-dir'), linkType);
    fs.symlinkSync(path.join(temp, 'missing-directory'), path.join(root, 'broken'), linkType);
    fs.symlinkSync(path.join(root, 'cycle-b'), path.join(root, 'cycle-a'), linkType);
    fs.symlinkSync(path.join(root, 'cycle-a'), path.join(root, 'cycle-b'), linkType);
    assert.equal(checkPathContainment('outside-dir/file.txt', root).reason, 'SYMLINK_ESCAPE');
    assert.equal(checkPathContainment('outside-dir/missing.txt', root).reason, 'ANCESTOR_ESCAPE');
    for (const target of ['broken', 'broken/missing', 'cycle-a', 'cycle-a/missing']) {
      assert.equal(checkPathContainment(target, root).contained, false);
    }
    assert.equal(checkPathContainment(path.join(sibling, 'file.txt'), root).reason, 'PATH_TRAVERSAL_ESCAPE');
    assert.equal(checkPathContainment('folder/new.txt', root, { mustExist: true }).reason, 'TARGET_NOT_FOUND');
    assert.equal(checkPathContainment('folder/new.txt', root).canonicalPath,
      path.join(canonicalizePath(root), 'folder', 'new.txt'));
    assert.equal(new DbInspector(root).inspectDataset('broken/missing.csv').status, 'ACCESS_DENIED');
    if (process.platform !== 'win32') {
      fs.symlinkSync(path.join(sibling, 'file.txt'), path.join(root, 'outside-file'));
      assert.equal(checkPathContainment('outside-file', root).reason, 'SYMLINK_ESCAPE');
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

if (process.platform === 'darwin') test('Darwin /var and /private/var use the same contained file identity', () => {
  const logical = fs.mkdtempSync('/var/tmp/afyx-context-alias-');
  try {
    const canonical = fs.realpathSync.native(logical);
    const absPath = path.join(logical, 'evidence.txt');
    fs.writeFileSync(absPath, 'AFYX Darwin fixture\n');
    const lexicalMismatch = path.relative(canonical, absPath).startsWith('..' + path.sep);
    console.log(JSON.stringify({ fixtureRoots: ['/var/tmp/<fixture>', '/private/var/tmp/<fixture>'],
      tmpdirAlias: os.tmpdir() !== fs.realpathSync.native(os.tmpdir()), lexicalMismatch }));
    assert.equal(canonical, '/private' + logical);
    assert.equal(lexicalMismatch, true);
    assert.equal(checkPathContainment(absPath, logical).canonicalPath, path.join(canonical, 'evidence.txt'));
    const navigator = new MassiveContextNavigator(logical);
    assert.equal(navigator.indexWorkspace().indexedFiles, 1);
    assert.deepEqual([...navigator.index.keys()], ['evidence.txt']);
  } finally {
    fs.rmSync(logical, { recursive: true, force: true });
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
    CREATE TABLE "weird""table" (id INTEGER PRIMARY KEY, "strange""col" TEXT);
    INSERT INTO "weird""table" VALUES (1, 'custom_value');
    CREATE VIEW user_orders AS SELECT u.username, o.amount FROM users u JOIN orders o ON u.id = o.user_id;
  `);
  setupDb.close();

  try {
    const inspector = new DbInspector(tempDir);

    // 1. Inspect valid database
    const result = inspector.inspectDataset('test.db', { sampleLimit: 5 });
    assert.equal(result.status, 'SCHEMA_INSPECTED');
    assert.equal(result.format, 'sqlite');
    assert.equal(result.readOnly, true);
    assert.ok(result.tables.some((t) => t.name === 'users'));
    assert.ok(result.tables.some((t) => t.name === 'orders'));
    assert.ok(result.tables.some((t) => t.name === 'weird"table'));
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

test('CliCompactor: Fail-closed spill directory failure, multi-MB streaming compaction, and honest truncation', async () => {
  // 1. Fail-closed spill directory failure
  const unwritableDir = path.join(os.tmpdir(), 'nonexistent-dir-' + Date.now(), 'deep-sub');
  const compactorFailClosed = new CliCompactor({
    spillDir: unwritableDir,
  });
  const resFailClosed = compactorFailClosed.compact('Some standard output from tests');
  assert.equal(resFailClosed.spillFilePath, null, 'Must fail-closed to null when private spill dir cannot be secured');
  assert.equal(resFailClosed.losslessRecovery, false);

  // 2. Truncated spill recovery flags
  const compactorTruncated = new CliCompactor({
    maxSpillSizeBytes: 200,
  });
  const longOutput = 'A'.repeat(500);
  const resTruncated = compactorTruncated.compact(longOutput);
  assert.equal(resTruncated.truncated, true, 'Output exceeding maxSpillSizeBytes must have truncated: true');
  assert.equal(resTruncated.losslessRecovery, false, 'Truncated spill must report losslessRecovery: false');
  assert.equal(resTruncated.spillBytes, 200);
  if (resTruncated.spillFilePath) {
    fs.rmSync(path.dirname(resTruncated.spillFilePath), { recursive: true, force: true });
  }

  // 3. True multi-MB streaming compaction via Readable stream without full buffering
  const compactorStreaming = new CliCompactor({
    maxSpillSizeBytes: 10 * 1024 * 1024,
  });

  async function* generateChunks() {
    for (let i = 1; i <= 200; i++) {
      if (i === 50) yield Buffer.from('FAIL test/worker.spec.js (Worker crashed unexpectedly)\n');
      else if (i === 150) yield Buffer.from('Error: Redis pool exhausted on worker node 3\n');
      else yield Buffer.from(`[INFO] Worker task batch #${i} completed successfully in 12ms\n`);
    }
  }

  const stream = Readable.from(generateChunks());
  const streamResult = await compactorStreaming.compactStream(stream, { command: 'vitest run' });

  assert.ok(streamResult.rawBytes > 5000);
  assert.ok(streamResult.spillFilePath);
  assert.ok(fs.existsSync(streamResult.spillFilePath));
  assert.equal(streamResult.truncated, false);
  assert.equal(streamResult.losslessRecovery, true);
  assert.ok(streamResult.spillHash);
  assert.ok(streamResult.compactedOutput.includes('PRESERVED FAILURE DIAGNOSTICS'));
  assert.ok(streamResult.compactedOutput.includes('Worker crashed unexpectedly'));

  // Clean up
  fs.rmSync(path.dirname(streamResult.spillFilePath), { recursive: true, force: true });
});

test('MassiveContextNavigator: Byte-accurate offsets, repeated lines with CRLF/LF, and multibyte UTF-8 boundary crossing', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-byte-boundary-test-'));
  const testFile = path.join(tempDir, 'boundary-test.txt');

  // Build a test file where:
  // 1. Repeated identical lines with mixed CRLF and LF exist
  // 2. Padding is exactly 65534 bytes, followed by a 4-byte UTF-8 emoji (🚀 = 0xF0 0x9F 0x99 0x80)
  // crossing the 64KB (65536 byte) streaming chunk boundary
  const parts = [];
  parts.push('Repeated line header\r\n');
  parts.push('Repeated line header\r\n');
  parts.push('Repeated line header\n');

  let currentLen = parts.reduce((acc, p) => acc + Buffer.byteLength(p, 'utf8'), 0);
  const targetOffset = 65534;
  const paddingNeeded = targetOffset - currentLen;
  assert.ok(paddingNeeded > 0);
  parts.push('X'.repeat(paddingNeeded)); // reaches exactly byte 65534

  // Now append 4-byte UTF-8 emoji crossing byte 65536
  parts.push('🚀 Rocket launch across chunk boundary\r\n');
  parts.push('Final trailing line after boundary\n');

  const fullContent = parts.join('');
  const fullBuffer = Buffer.from(fullContent, 'utf8');
  assert.equal(fullBuffer[65534], 0xf0);
  assert.equal(fullBuffer[65535], 0x9f);
  assert.equal(fullBuffer[65536], 0x9a);
  assert.equal(fullBuffer[65537], 0x80);

  fs.writeFileSync(testFile, fullBuffer);

  try {
    const navigator = new MassiveContextNavigator(tempDir, {
      chunkSizeBytes: 16 * 1024,
    });

    const index = navigator.indexWorkspace();
    assert.equal(index.status, 'INDEXED');

    // Verify each indexed segment's startByte and endByte read exact content
    const fileEntry = navigator.index.get('boundary-test.txt');
    assert.ok(fileEntry);
    assert.ok(fileEntry.segments.length > 1);

    for (const seg of fileEntry.segments) {
      const slice = navigator._readSlice(testFile, seg.startByte, seg.endByte);
      const expectedSlice = fullBuffer.subarray(seg.startByte, seg.endByte).toString('utf8');
      assert.equal(slice, expectedSlice, `Slice ${seg.id} must match exact byte-for-byte slice`);
    }

    // Verify retrieveContext retrieves the emoji intact
    const result = navigator.retrieveContext('Rocket launch');
    assert.equal(result.status, 'RETRIEVED');
    assert.ok(result.segments.some((s) => s.content.includes('🚀 Rocket launch')));

  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('CliCompactor preserves native test diagnostics and complete short streams', async () => {
  const { Readable } = await import('node:stream');
  const compactor = new CliCompactor({ enableSpill: false });
  const terminal = '\u2714 passed\n\u2716 fixture failed\n  decoder payload mismatch\n\u2139 tests 2\n\u2139 fail 1';
  const context = { command: 'node --test', exitCode: 1 };
  for (const report of [compactor.compact(terminal, context), await compactor.compactStream(Readable.from([Buffer.from(terminal)]), context)]) {
    assert.equal(report.exitCode, 1);
    assert.equal(report.failuresPreserved, 1);
    assert.match(report.compactedOutput, /decoder payload mismatch/);
    assert.match(report.compactedOutput, /fail 1/);
    assert.equal(report.losslessRecovery, false);
  }
  const plain = Array.from({ length: 40 }, (_, index) => 'line-' + index).join('\r\n');
  const stream = await compactor.compactStream(Readable.from([Buffer.from(plain)]));
  for (let index = 0; index < 40; index++) assert.match(stream.compactedOutput, new RegExp('(?:^|\\n)line-' + index + '(?:\\n|$)'));
});
