import assert from 'node:assert/strict';
import test from 'node:test';
import { packContractEvidence } from '../src/index.js';

test('retains exact whole citations deterministically within byte and token bounds', () => {
  const producer = { repository: 'api', file: 'schema.graphql', line: 2, symbol: 'Query.get' };
  const links = Array.from({ length: 60 }, (_, i) => ({
    from: producer, to: { repository: 'consumer', file: 'src/use' + i + '.ts', line: i + 1, symbol: 'load' + i },
    depth: 1, provenance: 'cross-repo-contract',
  }));
  const evidence = { contract: 'AfyxCrossRepoContractImpact/v1', producer, links };
  const budget = { maxBytes: 1300, maxTokens: 360, maxLines: 20 };
  const digest = packContractEvidence(evidence, budget);
  assert.deepEqual(digest, packContractEvidence({ ...evidence, links: [...links].reverse() }, budget));
  assert.ok(digest.truncated && digest.omittedLinks > 0);
  assert.ok(digest.links.length > 0);
  assert.ok(digest.telemetry.outputBytes <= budget.maxBytes);
  assert.ok(digest.telemetry.outputEstimatedTokens <= budget.maxTokens);
  for (const link of digest.links) assert.ok(digest.citations.includes(link.to.repository + '/' + link.to.file + ':' + link.to.line));
  assert.throws(() => packContractEvidence({ ...evidence, producer: { ...producer, file: '../secret' } }), /citation/);
});
