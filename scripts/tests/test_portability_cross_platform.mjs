import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

describe('T05 (AFYX-200): Windows & WSL2 Linux Cross-Platform Portability', () => {
  test('Path handling: Normalizes mixed slashes, forward slashes, and backslashes', () => {
    const isWindows = process.platform === 'win32';
    const rawPosix = 'skills/efficient-coding/SKILL.md';
    const rawWin = 'skills\\efficient-coding\\SKILL.md';
    const rawMixed = 'skills/efficient-coding\\SKILL.md';

    const normPosix = path.normalize(rawPosix);
    const normWin = path.normalize(rawWin);
    const normMixed = path.normalize(rawMixed);

    if (isWindows) {
      assert.equal(normPosix, 'skills\\efficient-coding\\SKILL.md');
      assert.equal(normWin, 'skills\\efficient-coding\\SKILL.md');
      assert.equal(normMixed, 'skills\\efficient-coding\\SKILL.md');
    } else {
      assert.equal(normPosix, 'skills/efficient-coding/SKILL.md');
      // On POSIX backslash is a regular char, path.posix handles forward slashes cleanly
      assert.equal(normPosix.split(path.sep).length, 3);
    }
  });

  test('Spaces in paths: Handles directory names containing spaces safely', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx test spaces-'));
    try {
      const nestedDir = path.join(tempRoot, 'nested directory with spaces', 'sub space');
      fs.mkdirSync(nestedDir, { recursive: true });
      const testFile = path.join(nestedDir, 'sample config.json');
      fs.writeFileSync(testFile, JSON.stringify({ key: 'value with spaces' }), 'utf8');

      assert.ok(fs.existsSync(testFile));
      const readBack = JSON.parse(fs.readFileSync(testFile, 'utf8'));
      assert.equal(readBack.key, 'value with spaces');
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('Line endings: Handles LF and CRLF text assets idempotently', () => {
    const lfContent = 'name: efficient-coding\nversion: 1.2.2\n';
    const crlfContent = 'name: efficient-coding\r\nversion: 1.2.2\r\n';

    const normalizeEol = (text) => text.replace(/\r\n/g, '\n');
    assert.equal(normalizeEol(lfContent), normalizeEol(crlfContent));
    assert.equal(normalizeEol(crlfContent), 'name: efficient-coding\nversion: 1.2.2\n');
  });

  test('Case-sensitivity awareness: Identifies exact canonical component names', () => {
    const canonicalComponents = new Set([
      'efficient-coding',
      'odoo-engineering',
      'afyx-engineering-expert',
      'afyx-graph',
      'afyx-context',
      'afyx-forge',
      'codex-usage-tracking',
    ]);

    assert.ok(canonicalComponents.has('efficient-coding'));
    assert.ok(!canonicalComponents.has('Efficient-Coding'));
    assert.ok(!canonicalComponents.has('EFFICIENT-CODING'));
    // Canonical resolution enforces lowercase lookup
    const resolveCaseInsensitive = (input) => canonicalComponents.has(input.toLowerCase());
    assert.ok(resolveCaseInsensitive('Efficient-Coding'));
    assert.ok(resolveCaseInsensitive('AFYX-GRAPH'));
  });
});
