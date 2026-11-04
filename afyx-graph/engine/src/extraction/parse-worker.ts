/**
 * Native Extraction Worker
 *
 * Runs Afyx-native extraction in a separate thread so the main thread
 * stays unblocked and the UI animation renders smoothly.
 */

// Compile cache FIRST: the worker's boot cost is dominated by re-requiring
// the extraction module graph; the persistent V8 cache (Node ≥22.8) makes
// that a bytecode load instead of a recompile. Safe no-op when unavailable.
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  (require('node:module') as { enableCompileCache?: () => void }).enableCompileCache?.();
} catch { /* cache is best-effort */ }

import { parentPort } from 'worker_threads';
import { extractFromSource } from './extract';
import { detectLanguage } from './grammars';
import type { Language, ExtractionResult } from '../types';

parentPort!.on('message', async (msg: { type: string; id?: number; filePath?: string; content?: string; frameworkNames?: string[]; language?: Language }) => {
  if (msg.type === 'parse') {
    const { id, filePath, content, frameworkNames } = msg;
    // Worker-side parse clock: reported back with the result so the pool can
    // tell a genuinely slow parse from a result whose delivery was delayed by
    // a stalled main thread (issue #1231 false timeouts).
    const t0 = performance.now();
    try {
      // The main thread resolves the language (it holds the project's
      // afyx-graph.json extension overrides) and sends it; fall back to detection
      // for older callers / safety.
      const language = msg.language ?? detectLanguage(filePath!, content);

      const result = extractFromSource(filePath!, content!, language, frameworkNames);

      parentPort!.postMessage({ type: 'parse-result', id, result, parseMs: performance.now() - t0 });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      parentPort!.postMessage({
        type: 'parse-result',
        id,
        parseMs: performance.now() - t0,
        result: {
          nodes: [],
          edges: [],
          unresolvedReferences: [],
          errors: [{ message: `Parse worker error: ${message}`, filePath: filePath!, severity: 'error', code: 'parse_error' }],
          durationMs: 0,
        } satisfies ExtractionResult,
      });
    }
  } else if (msg.type === 'shutdown') {
    parentPort!.postMessage({ type: 'shutdown-ack' });
  }
});

// Readiness is generic: module loading and handler registration are complete.
// No parser initialization or grammar transfer participates in worker startup.
parentPort!.postMessage({ type: 'ready' });
