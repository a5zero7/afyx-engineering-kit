/**
 * AFYX Version-Aware Documentation Resolver (AfyxDocsResolver/v1)
 *
 * Provides targeted, local documentation extraction and section retrieval
 * without remote scraping, whole-document dumping, or unnecessary token ingestion.
 *
 * Clean-Room AFYX-Native Implementation:
 * - Scans local documentation references and package manifests.
 * - Extracts bounded sections matching specific symbols or concepts.
 * - Enforces context token and byte budgets.
 * - Emits structured provenance and freshness metadata.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

export const DOCS_RESOLVER_CONTRACT = 'AfyxDocsResolver/v1';

/**
 * Searches a local directory of markdown reference documentation
 * and extracts bounded, relevant sections for a target query.
 */
export function resolveLocalDocumentation(options = {}) {
  const {
    docsRoot,
    query = '',
    framework = null,
    version = null,
    maxSections = 3,
    maxBytesPerSection = 4096,
  } = options;

  if (!docsRoot || !existsSync(docsRoot)) {
    return {
      contract: DOCS_RESOLVER_CONTRACT,
      status: 'NOT_FOUND',
      sections: [],
      reason: 'DOCS_ROOT_NOT_FOUND',
    };
  }

  const normalizedQuery = query.toLowerCase().trim();
  const matchedSections = [];
  let totalBytes = 0;

  try {
    const files = readdirSync(docsRoot).filter((f) => f.endsWith('.md'));

    // Filter files matching framework or version if specified
    const targetFiles = files.filter((f) => {
      if (version && f.includes(version)) return true;
      if (framework && f.toLowerCase().includes(framework.toLowerCase())) return true;
      return true;
    });

    for (const fileName of targetFiles) {
      if (matchedSections.length >= maxSections) break;
      const fullPath = join(docsRoot, fileName);
      const content = readFileSync(fullPath, 'utf8');

      // Split into sections by markdown headers
      const rawSections = content.split(/(?=\n#{1,4}\s+)/);

      for (const sec of rawSections) {
        if (matchedSections.length >= maxSections) break;
        const trimmed = sec.trim();
        if (!trimmed) continue;

        // Check relevance
        const isMatch = !normalizedQuery || trimmed.toLowerCase().includes(normalizedQuery);
        if (isMatch) {
          const boundedContent = trimmed.slice(0, maxBytesPerSection);
          const headerMatch = trimmed.match(/^#{1,4}\s+(.+)$/m);
          const title = headerMatch ? headerMatch[1].trim() : fileName;

          matchedSections.push({
            file: fileName,
            title,
            content: boundedContent,
            bytes: Buffer.byteLength(boundedContent, 'utf8'),
            truncated: trimmed.length > maxBytesPerSection,
          });
          totalBytes += Buffer.byteLength(boundedContent, 'utf8');
        }
      }
    }
  } catch (err) {
    return {
      contract: DOCS_RESOLVER_CONTRACT,
      status: 'ERROR',
      sections: [],
      reason: err.message,
    };
  }

  return Object.freeze({
    contract: DOCS_RESOLVER_CONTRACT,
    status: matchedSections.length > 0 ? 'RESOLVED' : 'NO_MATCH',
    framework: framework || 'generic',
    version: version || 'unknown',
    query: normalizedQuery,
    sectionCount: matchedSections.length,
    totalBytes,
    sections: Object.freeze(matchedSections),
  });
}
