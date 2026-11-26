import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const symbols = ['\u2139', '\u2714', '\u2716', '\u2713', '\u00d7', '\u23af', '\u2014'];
const decoder = new TextDecoder('windows-1252');
const patterns = symbols.map((symbol) => Buffer.from(decoder.decode(Buffer.from(symbol))));

function damage(bytes) {
  return patterns.some((pattern) => bytes.includes(pattern));
}

test('encoding guard distinguishes valid Unicode from the known double-encoded markers', () => {
  assert.equal(damage(Buffer.from('Portugu\u00eas, Fran\u00e7ais, 日本語 \u2714 \u2014')), false);
  for (const pattern of patterns) assert.equal(damage(pattern), true);
});

test('tracked runtime and installer source contains no known double-encoded markers', () => {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0');
  const failures = files.filter((file) => /\.(?:js|mjs|cjs|ts|ps1|psm1|sh)$/.test(file) &&
    !/(?:^|\/)(?:tests?|__tests__|fixtures|test-fixtures|evals|archive)(?:\/|$)|\.(?:test|spec)\.[^.]+$/.test(file) &&
    damage(readFileSync(new URL('../../' + file.split('/').map(encodeURIComponent).join('/'), import.meta.url))));
  assert.deepEqual(failures, []);
});
