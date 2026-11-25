/** Copyright (c) 2026 Afyx */
import { compressContextItems, estimateBytes, estimateTokens } from './budget.js';

export const CONTRACT_EVIDENCE_DIGEST = 'AfyxContractEvidenceDigest/v1';

/** Pack whole location records. Never turn a partial slice into a citation. */
export function packContractEvidence(evidence, budget = {}) {
  if (evidence?.contract !== 'AfyxCrossRepoContractImpact/v1' || !evidence.producer ||
      !Array.isArray(evidence.links) || evidence.links.length > 128) {
    throw new TypeError('Invalid Graph contract impact evidence');
  }
  const cite = value => {
    if (!value || typeof value.repository !== 'string' || !/^[\w.-]{1,64}$/.test(value.repository) ||
        typeof value.file !== 'string' || value.file.length > 240 || !/^[\w./-]+$/.test(value.file) ||
        value.file.split('/').some(part => !part || part === '..' || part === '.') ||
        !Number.isSafeInteger(value.line) || value.line < 1 ||
        typeof value.symbol !== 'string' || value.symbol.length > 512 || /[\r\n\0]/.test(value.symbol)) {
      throw new TypeError('Invalid source citation');
    }
    return value.repository + '/' + value.file + ':' + value.line;
  };
  const producerRef = cite(evidence.producer);
  const links = evidence.links.map(link => {
    const references = [cite(link.from), cite(link.to)];
    if (!['cross-repo-contract', 'indexed-call'].includes(link.provenance) ||
        !Number.isSafeInteger(link.depth) || link.depth < 1 || link.depth > 10) throw new TypeError('Invalid contract link');
    return { link, references, text: JSON.stringify(link) };
  }).sort((a, b) => a.link.depth - b.link.depth || (a.text < b.text ? -1 : a.text > b.text ? 1 : 0));
  const represented = new Set();
  const items = [
    { id: 'producer', text: JSON.stringify(evidence.producer), references: [producerRef], priority: 11 },
    ...links.map(({ link, references, text }, index) => {
      const firstConsumer = link.provenance === 'cross-repo-contract' && !represented.has(link.to.repository);
      if (firstConsumer) represented.add(link.to.repository);
      return { id: String(index), text, references, priority: firstConsumer ? 10 : 10 - link.depth };
    }),
  ];
  const packed = compressContextItems(items, budget, { allowPartial: false });
  const kept = packed.admitted;
  const acceptedLinks = kept.filter(item => item.id !== 'producer').map(item => links[Number(item.id)].link);
  const input = items.map(item => item.text).join('\n\n');
  const retained = kept.map(item => item.text).join('\n\n');
  return {
    contract: CONTRACT_EVIDENCE_DIGEST,
    producer: kept.some(item => item.id === 'producer') ? evidence.producer : null,
    links: acceptedLinks,
    citations: [...new Set(kept.flatMap(item => item.references))],
    truncated: evidence.truncated === true || links.length !== acceptedLinks.length || kept.length === 0,
    omittedLinks: links.length - acceptedLinks.length,
    coverageIncomplete: evidence.coverageIncomplete === true || Object.keys(evidence.skipped ?? {}).length > 0,
    telemetry: {
      budget: packed.budget,
      inputBytes: estimateBytes(input), outputBytes: estimateBytes(retained),
      inputEstimatedTokens: estimateTokens(input), outputEstimatedTokens: estimateTokens(retained),
    },
  };
}
