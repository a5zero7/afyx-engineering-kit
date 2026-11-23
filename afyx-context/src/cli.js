#!/usr/bin/env node
import fs from 'node:fs';
import process from 'node:process';
import { ACE_LIMITS, AfyxContextEngine, validateContextRequest } from './engine.js';
import { AceError } from './errors.js';

const VERSION = '0.1.0';

function usage() {
  return `Afyx Context Engine ${VERSION}

Usage:
  afyx-context reduce --state <absolute-path> --owner <id> --session <id> --input <json-file|-> [--budget <chars>]
  afyx-context get --state <absolute-path> --owner <id> --session <id> --reference <ace:v1:...>
  afyx-context --version
`;
}

function options(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i += 1) {
    const current = args[i];
    if (!current.startsWith('--')) throw new AceError('INVALID_CLI', `unexpected argument: ${current}`);
    const value = args[++i];
    if (value === undefined || value.startsWith('--')) throw new AceError('INVALID_CLI', `missing value for ${current}`);
    parsed[current.slice(2)] = value;
  }
  return parsed;
}

function required(parsed, name) {
  if (!parsed[name]) throw new AceError('INVALID_CLI', `--${name} is required`);
  return parsed[name];
}

function engineFrom(parsed) {
  return new AfyxContextEngine({
    stateDir: required(parsed, 'state'),
    ownerId: required(parsed, 'owner'),
    sessionId: required(parsed, 'session'),
  });
}

function readBoundedInput(inputPath) {
  if (inputPath !== '-') {
    let stat;
    try {
      stat = fs.statSync(inputPath);
    } catch {
      throw new AceError('INVALID_INPUT', `input file is unavailable: ${inputPath}`);
    }
    if (!stat.isFile()) throw new AceError('INVALID_INPUT', `input path is not a file: ${inputPath}`);
    if (stat.size > ACE_LIMITS.maxCliInputBytes) {
      throw new AceError('RESOURCE_LIMIT', `input exceeds the ${ACE_LIMITS.maxCliInputBytes} byte CLI limit`);
    }
    return fs.readFileSync(inputPath, 'utf8');
  }
  const chunks = [];
  let size = 0;
  while (true) {
    const chunk = Buffer.allocUnsafe(65_536);
    const count = fs.readSync(0, chunk, 0, chunk.length, null);
    if (count === 0) break;
    size += count;
    if (size > ACE_LIMITS.maxCliInputBytes) {
      throw new AceError('RESOURCE_LIMIT', `stdin exceeds the ${ACE_LIMITS.maxCliInputBytes} byte CLI limit`);
    }
    chunks.push(chunk.subarray(0, count));
  }
  return Buffer.concat(chunks, size).toString('utf8');
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === '--help' || command === 'help') {
    process.stdout.write(usage());
    return;
  }
  if (command === '--version' || command === 'version') {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  const parsed = options(rest);
  if (command === 'reduce') {
    const inputPath = required(parsed, 'input');
    const source = readBoundedInput(inputPath);
    let request;
    try { request = JSON.parse(source); } catch { throw new AceError('INVALID_INPUT', 'input must be valid JSON'); }
    if (parsed.budget !== undefined) request.budgetChars = Number(parsed.budget);
    validateContextRequest(request);
    const engine = engineFrom(parsed);
    process.stdout.write(`${JSON.stringify(engine.reduce(request), null, 2)}\n`);
    return;
  }
  if (command === 'get') {
    const engine = engineFrom(parsed);
    process.stdout.write(engine.retrieve(required(parsed, 'reference')));
    return;
  }
  throw new AceError('INVALID_CLI', `unknown command: ${command}`);
}

try {
  main();
} catch (error) {
  const code = error instanceof AceError ? error.code : 'INTERNAL';
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`afyx-context: ${code}: ${message}\n`);
  process.exitCode = error instanceof AceError ? 2 : 1;
}
