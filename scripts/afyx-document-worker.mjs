import { parentPort, workerData } from 'node:worker_threads';
import { convertBytes, detectFormat } from './afyx-document-formats.mjs';

const started = performance.now();
const check = () => { if (performance.now() - started > workerData.limits.maxTimeMs) throw new Error('DOCUMENT_TIME_LIMIT'); };
try {
  const bytes = Buffer.from(workerData.bytes);
  const format = detectFormat(bytes, workerData.name, workerData.mime);
  const converted = convertBytes(bytes, format, workerData.limits, check);
  check();
  if (Buffer.byteLength(converted.markdown, 'utf8') > workerData.limits.maxOutputBytes) throw new Error('DOCUMENT_OUTPUT_LIMIT');
  parentPort.postMessage({ ok: true, format, ...converted });
} catch (error) {
  parentPort.postMessage({ ok: false, unsupported: error.unsupported === true,
    error: String(error.message || error).slice(0, 500) });
}
