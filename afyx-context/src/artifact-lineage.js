// Copyright (c) 2026 Afyx
import { createHash } from 'node:crypto';

export function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

const LINEAGE_CONTRACT = 'AfyxArtifactLineage/v1';

export function createArtifactLineage(source, derived, transformation, { sourceRevision = 'UNKNOWN' } = {}) {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(transformation) ||
      !/^(?:UNKNOWN|[a-f0-9]{40}|[a-f0-9]{64})$/.test(sourceRevision)) {
    throw new TypeError('INVALID_LINEAGE_METADATA');
  }
  return Object.freeze({
    contract: LINEAGE_CONTRACT,
    sourceRevision,
    transformation,
    sourceSha256: sha256Bytes(source),
    derivedSha256: sha256Bytes(derived),
    authenticity: 'UNKNOWN',
  });
}

export function verifyArtifactLineage(lineage, source, derived) {
  if (lineage?.contract !== LINEAGE_CONTRACT) {
    return { integrity: 'UNVERIFIED', lineage: 'MISSING_OR_UNSUPPORTED', authenticity: 'UNKNOWN' };
  }
  let expected;
  try {
    expected = createArtifactLineage(source, derived, lineage.transformation, lineage);
  } catch {
    return { integrity: 'UNVERIFIED', lineage: 'INVALID', authenticity: 'UNKNOWN' };
  }
  const matches = expected.sourceSha256 === lineage.sourceSha256 &&
    expected.derivedSha256 === lineage.derivedSha256;
  return {
    integrity: matches ? 'VERIFIED' : 'MISMATCH',
    lineage: matches ? 'CONTENT_MATCH' : 'CONTENT_MISMATCH',
    authenticity: 'UNKNOWN',
  };
}
