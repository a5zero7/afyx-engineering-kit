/** AFYX bounded context selection. Token counts are estimates, not provider telemetry. */
export const DEFAULT_CONTEXT_BUDGET = Object.freeze({ maxTokens: 4000, maxBytes: 16000, maxLines: 250 });
export function estimateTokens(text) {
  if (!text) return 0;
  const value = typeof text === 'string' ? text : JSON.stringify(text);
  return Math.max(value.split(/\s+/).filter(Boolean).length, Math.ceil(value.length / 4));
}
export function estimateBytes(text) {
  if (!text) return 0;
  return Buffer.byteLength(typeof text === 'string' ? text : JSON.stringify(text), 'utf8');
}
export function detectRedundancy(lines, { minRepeatCount = 3 } = {}) {
  const counts = new Map();
  for (const line of lines) { const value = line.trim(); if (value.length > 10) counts.set(value, (counts.get(value) || 0) + 1); }
  return new Set([...counts].filter(([, count]) => count >= minRepeatCount).map(([line]) => line));
}
export function compressContextItems(items, budget = {}) {
  const limits = {};
  for (const [key, fallback] of Object.entries(DEFAULT_CONTEXT_BUDGET)) {
    limits[key] = budget[key] ?? fallback;
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1) throw new Error(`Invalid context budget: ${key}`);
  }
  if (!Array.isArray(items) || items.some((item) => !item || typeof item.id !== 'string' || !item.id || typeof item.text !== 'string')) throw new Error('Context items require a non-empty id and text string');
  const admitted = [], truncated = [], omitted = [];
  const preservedReferences = new Set();
  let rendered = '';
  const measure = (text) => ({ bytes: estimateBytes(text), tokens: estimateTokens(text), lines: text ? text.split('\n').length : 0 });
  const fits = (text) => { const size = measure((admitted.length ? `${rendered}\n\n` : '') + text); return size.bytes <= limits.maxBytes && size.tokens <= limits.maxTokens && size.lines <= limits.maxLines; };
  for (const item of [...items].sort((a, b) => (b.priority || 0) - (a.priority || 0))) {
    let text = item.text, status = 'FULL';
    if (!fits(text)) {
      const chars = Array.from(text);
      let low = 0, high = chars.length - 1, selected = null;
      // Slice code points so UTF-8 never contains a split surrogate.
      while (low <= high) {
        const keep = Math.floor((low + high) / 2), head = Math.ceil(keep / 2), tail = Math.floor(keep / 2);
        const candidate = chars.slice(0, head).join('') + `\n<!-- AFYX-TRUNCATED: ${chars.length - keep} characters omitted -->\n` + (tail ? chars.slice(-tail).join('') : '');
        if (fits(candidate)) { selected = candidate; low = keep + 1; } else high = keep - 1;
      }
      if (selected === null) { omitted.push({ id: item.id, originalBytes: estimateBytes(item.text), references: item.references || [] }); continue; }
      text = selected; status = 'PARTIAL'; truncated.push(item.id);
    }
    const references = Array.isArray(item.references) ? [...new Set(item.references.filter((ref) => typeof ref === 'string'))] : [];
    admitted.push({ id: item.id, text, status, references, originalBytes: estimateBytes(item.text), originalTokens: estimateTokens(item.text), ...(status === 'PARTIAL' ? { compressedBytes: estimateBytes(text) } : {}) });
    for (const reference of references) preservedReferences.add(reference);
    rendered += (admitted.length > 1 ? '\n\n' : '') + text;
  }
  const size = measure(rendered);
  return { contract: 'afyx-context-budget-v1', budget: limits,
    metrics: { totalOriginalItems: items.length, admittedItemsCount: admitted.length, truncatedItemsCount: truncated.length, omittedItemsCount: omitted.length, consumedBytes: size.bytes, consumedTokens: size.tokens, consumedLines: size.lines },
    admitted, truncated, omitted, preservedReferences: [...preservedReferences] };
}
