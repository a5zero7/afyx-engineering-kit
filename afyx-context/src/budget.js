/**
 * AFYX Context Engine - Deterministic Context Budgeting & Compression
 *
 * Provides deterministic token and byte estimation, redundancy detection,
 * and adaptive evidence compression without external model telemetry.
 * Ensures critical source references (file paths, symbol names, error spans)
 * remain recoverable when trimming oversized tool outputs.
 */

export const DEFAULT_CONTEXT_BUDGET = Object.freeze({
  maxTokens: 4000,
  maxBytes: 16000,
  maxLines: 250,
});

/**
 * Deterministic token counter heuristic (provider-agnostic: ~4 chars per token).
 */
export function estimateTokens(text) {
  if (!text) return 0;
  const str = typeof text === 'string' ? text : JSON.stringify(text);
  // Accurate code token heuristic: words + punctuation chunks
  const wordTokens = str.split(/\s+/).filter(Boolean).length;
  const charTokens = Math.ceil(str.length / 4);
  return Math.max(wordTokens, charTokens);
}

/**
 * Calculates byte size in UTF-8.
 */
export function estimateBytes(text) {
  if (!text) return 0;
  const str = typeof text === 'string' ? text : JSON.stringify(text);
  return Buffer.byteLength(str, 'utf8');
}

/**
 * Detects repetitive / redundant lines across text blocks.
 */
export function detectRedundancy(lines, { minRepeatCount = 3 } = {}) {
  const lineCounts = new Map();
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 10) {
      lineCounts.set(trimmed, (lineCounts.get(trimmed) || 0) + 1);
    }
  }
  const redundant = new Set();
  for (const [line, count] of lineCounts.entries()) {
    if (count >= minRepeatCount) {
      redundant.add(line);
    }
  }
  return redundant;
}

/**
 * Compresses an array of text sections or source files within a bounded budget,
 * preserving critical references and recording exact truncation metadata.
 *
 * @param {Array<{ id: string, text: string, priority?: number, references?: string[] }>} items
 * @param {Object} [budget]
 * @param {number} [budget.maxTokens]
 * @param {number} [budget.maxBytes]
 * @param {number} [budget.maxLines]
 * @returns {Object} Compressed result with retained items and truncation receipts
 */
export function compressContextItems(items, budget = {}) {
  const maxBytes = budget.maxBytes || DEFAULT_CONTEXT_BUDGET.maxBytes;
  const maxTokens = budget.maxTokens || DEFAULT_CONTEXT_BUDGET.maxTokens;
  const maxLines = budget.maxLines || DEFAULT_CONTEXT_BUDGET.maxLines;

  // Sort by priority descending (higher priority admitted first)
  const sorted = [...items].sort((a, b) => (b.priority || 0) - (a.priority || 0));

  let currentBytes = 0;
  let currentTokens = 0;
  let currentLines = 0;

  const admitted = [];
  const truncated = [];
  const omitted = [];
  const preservedReferences = new Set();

  for (const item of sorted) {
    const itemBytes = estimateBytes(item.text);
    const itemTokens = estimateTokens(item.text);
    const itemLinesList = item.text.split('\n');
    const itemLinesCount = itemLinesList.length;

    // Register references
    if (Array.isArray(item.references)) {
      for (const ref of item.references) preservedReferences.add(ref);
    }

    // Check if item fits fully
    if (
      currentBytes + itemBytes <= maxBytes &&
      currentTokens + itemTokens <= maxTokens &&
      currentLines + itemLinesCount <= maxLines
    ) {
      admitted.push({
        id: item.id,
        text: item.text,
        status: 'FULL',
        originalBytes: itemBytes,
        originalTokens: itemTokens,
      });
      currentBytes += itemBytes;
      currentTokens += itemTokens;
      currentLines += itemLinesCount;
      continue;
    }

    // Partial budget remaining: try bounded slice
    const remainingBytes = Math.max(0, maxBytes - currentBytes);
    const remainingLines = Math.max(0, maxLines - currentLines);

    if (remainingBytes > 300 && remainingLines > 5) {
      const halfLines = Math.floor(remainingLines / 2);
      const head = itemLinesList.slice(0, halfLines);
      const tail = itemLinesList.slice(-halfLines);
      const omittedLineCount = itemLinesCount - head.length - tail.length;

      const marker = `\n<!-- AFYX-TRUNCATED: [id=${item.id}] original=${itemLinesCount} lines, omitted=${omittedLineCount} lines; full evidence recoverable on disk -->\n`;
      const compressedText = [...head, marker, ...tail].join('\n');

      admitted.push({
        id: item.id,
        text: compressedText,
        status: 'PARTIAL',
        originalBytes: itemBytes,
        compressedBytes: estimateBytes(compressedText),
        omittedLines: omittedLineCount,
      });
      truncated.push(item.id);
      currentBytes += estimateBytes(compressedText);
      currentLines += remainingLines;
      break;
    } else {
      omitted.push({
        id: item.id,
        originalBytes: itemBytes,
        references: item.references || [],
      });
    }
  }

  return {
    contract: 'afyx-context-budget-v1',
    budget: { maxBytes, maxTokens, maxLines },
    metrics: {
      totalOriginalItems: items.length,
      admittedItemsCount: admitted.length,
      truncatedItemsCount: truncated.length,
      omittedItemsCount: omitted.length,
      consumedBytes: currentBytes,
      consumedTokens: currentTokens,
      consumedLines: currentLines,
    },
    admitted,
    truncated,
    omitted,
    preservedReferences: Array.from(preservedReferences),
  };
}
