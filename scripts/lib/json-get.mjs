#!/usr/bin/env node
/**
 * Safe, zero-dependency JSON property extractor.
 * Replaces brittle grep/sed regex parsing across installation scripts.
 *
 * Usage: node json-get.mjs <file.json> <property.path>
 */
import { readFileSync } from 'node:fs';

const [filePath, propPath] = process.argv.slice(2);
if (!filePath || !propPath) {
  process.stderr.write('Usage: node json-get.mjs <file.json> <property.path>\n');
  process.exit(1);
}

try {
  const content = readFileSync(filePath, 'utf8');
  const obj = JSON.parse(content);
  const parts = propPath.split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null) {
      current = undefined;
      break;
    }
    current = current[part];
  }
  if (current !== undefined && current !== null) {
    process.stdout.write(typeof current === 'object' ? JSON.stringify(current) : String(current));
  }
} catch (err) {
  process.stderr.write(`Failed to extract "${propPath}" from "${filePath}": ${err.message}\n`);
  process.exit(1);
}
