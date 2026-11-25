/** Copyright (c) 2026 Afyx */

const GRAPH = 'AfyxCrossRepoContractImpact/v1';
const DIGEST = 'AfyxContractEvidenceDigest/v1';

function reference(node) {
  if (!node || typeof node.repository !== 'string' || !/^[\w.-]{1,64}$/.test(node.repository) ||
      typeof node.file !== 'string' || node.file.length > 240 || !/^[\w./-]+$/.test(node.file) ||
      node.file.split('/').some(part => !part || part === '.' || part === '..') ||
      !Number.isSafeInteger(node.line) || node.line < 1) throw new TypeError('Invalid contract citation');
  return node.repository + '/' + node.file + ':' + node.line;
}

/** A bounded advisory plan based on observed locations, without command execution. */
export function createContractImpactPlan(evidence, budget = {}) {
  if (![GRAPH, DIGEST].includes(evidence?.contract) || !evidence.producer ||
      !Array.isArray(evidence.links) || evidence.links.length > 128) {
    throw new TypeError('Invalid contract evidence for Forge');
  }
  const producer = reference(evidence.producer);
  const reviews = new Map();
  for (const link of evidence.links) {
    const source = reference(link.from);
    const location = reference(link.to);
    if (link.provenance !== 'cross-repo-contract' || source !== producer || link.depth !== 1 ||
        link.to.repository === evidence.producer.repository) continue;
    const citations = reviews.get(link.to.repository) ?? new Set();
    citations.add(location);
    reviews.set(link.to.repository, citations);
  }
  const maxConsumers = 8;
  const maxCitationsPerConsumer = 3;
  const consumerReviews = [...reviews].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const affected = consumerReviews.slice(0, maxConsumers).map(([repository, paths]) => ({
    repository, citations: [...paths].sort().slice(0, maxCitationsPerConsumer),
  }));
  const incomplete = evidence.truncated === true || evidence.coverageIncomplete === true ||
    Object.keys(evidence.skipped ?? {}).length > 0 || consumerReviews.length > maxConsumers ||
    consumerReviews.some(([, citations]) => citations.size > maxCitationsPerConsumer);
  const maxExecutionMs = Math.min(30000, Number.isSafeInteger(budget.maxExecutionMs) && budget.maxExecutionMs > 0
    ? budget.maxExecutionMs : 5000);
  return {
    contract: 'AfyxForgeContractImpactPlan/v1',
    mode: evidence.contract === DIGEST ? 'CONTEXT_DIGEST' : 'BOUNDED_GRAPH_EVIDENCE',
    risk: incomplete || affected.length > 0 ? 'HIGH' : 'MEDIUM',
    evidenceCoverage: incomplete ? 'PARTIAL' : 'BOUNDED',
    budget: { maxExecutionMs, maxConsumers, maxCitationsPerConsumer, maxValidationStages: 3 },
    stages: [
      { phase: 'producer', action: 'Review and update the producer contract and compatibility expectations.', citations: [producer] },
      { phase: 'consumers', action: 'Review observed consumers after the producer contract is settled.', scope: affected },
      { phase: 'verification', action: 'Run producer contract checks, consumer compatibility tests, and the cross-service regression suite.' },
    ],
  };
}
