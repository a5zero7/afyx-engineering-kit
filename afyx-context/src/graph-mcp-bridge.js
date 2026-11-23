#!/usr/bin/env node
// Installed ACE runtime entrypoint for an optional Graph MCP consumer.
// It is invoked only for substantial reducible output or explicit recovery.
// No network, provider, shell, or Graph code is loaded by this process.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createGraphAceConsumer, deriveGraphAceIdentity } from './graph-integration.js';
import { createOptionalIntegrationAdapter } from './integrations.js';
import { AfyxContextEngine } from './engine.js';

const MAX_INPUT_BYTES = 1_100_000;
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

function readInput() {
  return new Promise((resolve, reject) => {
    const parts = [];
    let size = 0;
    process.stdin.on('data', (part) => {
      size += part.length;
      if (size > MAX_INPUT_BYTES) {
        reject(new Error('input too large'));
        process.stdin.destroy();
        return;
      }
      parts.push(part);
    });
    process.stdin.once('end', () => {
      try { resolve(JSON.parse(Buffer.concat(parts).toString('utf8'))); }
      catch { reject(new Error('invalid request')); }
    });
    process.stdin.once('error', reject);
  });
}

function verifyShape(message) {
  if (!message || typeof message !== 'object' || !['reduce', 'recover'].includes(message.operation)
      || typeof message.projectRoot !== 'string' || typeof message.sourceIdentity !== 'string'
      || typeof message.stateDir !== 'string') throw new Error('invalid bridge identity');
  if (message.operation === 'reduce' && (
      typeof message.toolName !== 'string' || !message.graphResult
      || !Array.isArray(message.graphResult.content))) throw new Error('invalid Graph result');
  if (message.operation === 'recover'
      && (typeof message.reference !== 'string' || !/^ace:v1:[0-9a-f]{16}:[0-9a-f]{16}:[0-9a-f]{64}$/.test(message.reference))) {
    throw new Error('invalid ACE reference');
  }
}

function inlineRunner(message) {
  if (message.operation === 'reduce') {
    return Promise.resolve(createOptionalIntegrationAdapter({ component: 'graph' }).process(message.request));
  }
  if (message.operation === 'retrieve') {
    const engine = new AfyxContextEngine({
      stateDir: message.stateDir,
      ownerId: message.ownerId,
      sessionId: message.sessionId,
    });
    return Promise.resolve({ status: 'recovered', record: engine.retrieveRecord(message.reference) });
  }
  throw new Error('unsupported operation');
}

async function main() {
  const request = await readInput();
  verifyShape(request);
  const identity = deriveGraphAceIdentity({
    projectRoot: request.projectRoot,
    sourceIdentity: request.sourceIdentity,
    consumerId: 'afyx-graph-native-mcp',
  });
  const consumer = createGraphAceConsumer({
    enabled: true, stateDir: request.stateDir,
    ownerId: identity.ownerId, sessionId: identity.sessionId,
    aceRunner: inlineRunner, timeoutMs: 3_000,
  });
  if (request.operation === 'recover') {
    const record = await consumer.recover(request.reference);
    if (sha256(record.content) !== record.digest) throw new Error('recovery integrity mismatch');
    return { status: 'recovered', content: record.content };
  }
  const result = await consumer.execute({
    executeGraph: async () => request.graphResult,
    toolName: request.toolName,
    args: {},
    projectRoot: request.projectRoot,
    sourceIdentity: request.sourceIdentity,
    budgetChars: 12_000,
  });
  if (result.status !== 'optimized' || !result.ace || result.ace.mode !== 'optimized') {
    return { status: 'fallback' };
  }
  const savedChars = result.ace.metrics?.savedChars;
  if (!Number.isSafeInteger(savedChars) || savedChars <= 0) return { status: 'fallback' };
  return { status: 'optimized', savedChars, result: result.consumerResult };
}

try {
  const output = await main();
  process.stdout.write(JSON.stringify(output));
} catch {
  // Do not leak project-root paths, state paths, original contents or internals.
  process.stdout.write(JSON.stringify({ status: 'fallback' }));
}
