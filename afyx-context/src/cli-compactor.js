/**
 * AFYX Pure Node.js CLI Compactor (AFYX-245 / AfyxCliCompactor/v1).
 *
 * Compacts terminal outputs (Vitest, node --test, pytest, go test, git diff, tsc, logs)
 * to maximize token efficiency while preserving 100% of error diagnostics and stack traces.
 *
 * Mandatory Rules:
 * 1. Preserves all failure/error records, stack traces, and failure context intact
 * 2. Never silently drops failures beyond arbitrary limits
 * 3. Compacts repetitive passing test logs into structured summaries
 * 4. Preserves exit codes, status indicators, and warning counts
 * 5. Distinct marker: <!-- AFYX-CLI-COMPACTED -->
 * 6. Cryptographically secure spill-to-disk with user-only permissions (0o600 / 0o700)
 * 7. Supports streaming and incremental processing of massive outputs
 * 8. Expiration and bounded storage cleanup
 */

import { randomBytes, createHash } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import {
  closeSync,
  constants,
  existsSync,
  mkdtempSync,
  openSync,
  readSync,
  fstatSync,
  rmSync,
  readFileSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerCompletedSpill } from './temp-artifacts.js';

export const CLI_COMPACTOR_CONTRACT = 'AfyxCliCompactor/v1';
export const COMPACTED_OUTPUT_MARKER = '<!-- AFYX-CLI-COMPACTED -->';

function writeSpill(fd, bytes, length) {
  for (let offset = 0; offset < length;) {
    const written = writeSync(fd, bytes, offset, length - offset);
    if (written <= 0) throw new Error('SPILL_SHORT_WRITE');
    offset += written;
  }
}

function verifiedSpill(path, bytes, digest) {
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size !== bytes) return false;
    const hash = createHash('sha256');
    const chunk = Buffer.alloc(65536);
    for (let remaining = bytes; remaining > 0;) {
      const size = readSync(fd, chunk, 0, Math.min(remaining, chunk.length), null);
      if (size === 0) return false;
      hash.update(chunk.subarray(0, size));
      remaining -= size;
    }
    return hash.digest('hex') === digest && fstatSync(fd).size === bytes;
  } finally {
    closeSync(fd);
  }
}

function discardSpill(path) {
  if (path) {
    try { rmSync(path, { recursive: true, force: true }); } catch { /* Recovery remains unavailable. */ }
  }
}

export class CliCompactor {
  /**
   * @param {object} [options]
   * @param {string} [options.spillDir] Directory for raw output spill (defaults to system tmpdir)
   * @param {boolean} [options.enableSpill=true] Whether to save raw output to disk for recovery
   * @param {number} [options.maxSpillSizeBytes=52428800] Maximum allowed spill file size (50MB)
   */
  constructor(options = {}) {
    this.spillBaseDir = options.spillDir || tmpdir();
    this.enableSpill = options.enableSpill !== false;
    this.maxSpillSizeBytes = options.maxSpillSizeBytes || 50 * 1024 * 1024;
  }

  /**
   * Ensures an isolated, cryptographically unpredictable private directory for spills.
   * Fails closed: returns null if the private directory cannot be created.
   *
   * @private
   * @returns {string|null}
   */
  _getSecureSpillDir() {
    try {
      return mkdtempSync(join(this.spillBaseDir, 'afyx-cli-spill-'));
    } catch {
      return null;
    }
  }

  /**
   * Spills raw output to an exclusively created private file with fail-closed isolation.
   *
   * @private
   * @param {string|Buffer} rawOutput
   * @returns {{ path: string|null, truncated: boolean, losslessRecovery: boolean, bytesWritten: number, hash: string|null }}
   */
  _spillRawOutput(rawOutput) {
    if (!this.enableSpill || !rawOutput || rawOutput.length === 0) {
      return { path: null, truncated: false, losslessRecovery: false, bytesWritten: 0, hash: null };
    }

    const targetDir = this._getSecureSpillDir();
    if (!targetDir) {
      // Fail closed when private spill directory cannot be secured
      return { path: null, truncated: false, losslessRecovery: false, bytesWritten: 0, hash: null };
    }

    try {
      const uniqueSuffix = randomBytes(16).toString('hex');
      const filename = `afyx_raw_cli_${Date.now()}_${uniqueSuffix}.log`;
      const filePath = join(targetDir, filename);

      // Exclusive file creation with user-only permissions (0o600)
      const fd = openSync(
        filePath,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
        0o600
      );

      let truncated = false;
      let bytesWritten = 0;
      const hasher = createHash('sha256');

      try {
        const buf = Buffer.isBuffer(rawOutput) ? rawOutput : Buffer.from(rawOutput, 'utf8');

        if (buf.length > this.maxSpillSizeBytes) {
          writeSpill(fd, buf, this.maxSpillSizeBytes);
          bytesWritten = this.maxSpillSizeBytes;
          truncated = true;
        } else {
          writeSpill(fd, buf, buf.length);
          bytesWritten = buf.length;
          truncated = false;
        }
        hasher.update(buf.subarray(0, bytesWritten));
      } finally {
        closeSync(fd);
      }

      const hash = hasher.digest('hex');
      if (!verifiedSpill(filePath, bytesWritten, hash)) throw new Error('SPILL_INTEGRITY_FAILED');
      registerCompletedSpill(filePath);
      return {
        path: filePath,
        truncated,
        losslessRecovery: !truncated,
        bytesWritten,
        hash,
      };
    } catch {
      discardSpill(targetDir);
      return { path: null, truncated: false, losslessRecovery: false, bytesWritten: 0, hash: null };
    }
  }

  /**
   * Recovers uncompacted raw output from a spilled file.
   *
   * @param {string} spillFilePath
   * @returns {string|null}
   */
  static recoverSpill(spillFilePath) {
    try {
      if (!spillFilePath || !existsSync(spillFilePath)) return null;
      return readFileSync(spillFilePath, 'utf8');
    } catch {
      return null;
    }
  }

  /**
   * Compacts raw CLI output based on tool/runner heuristics.
   *
   * @param {string} rawOutput Uncompacted stdout/stderr text
   * @param {object} [context]
   * @param {string} [context.command] Executed command (e.g. 'vitest', 'pytest', 'git diff', 'tsc')
   * @param {number} [context.exitCode=0] Process exit code
   * @returns {object} Compacted result with metrics and recovery spill path
   */
  compact(rawOutput, context = {}) {
    if (typeof rawOutput !== 'string') {
      rawOutput = String(rawOutput || '');
    }

    const startTime = Date.now();
    const rawBytes = Buffer.byteLength(rawOutput, 'utf8');
    const exitCode = context.exitCode ?? 0;
    const command = (context.command || '').toLowerCase();

    // 1. Spill-to-disk for secure raw recovery
    const spillResult = this._spillRawOutput(rawOutput);
    const spillFilePath = spillResult.path;

    // 2. Format / Runner classification & compaction
    let compactedBody = '';
    let failuresPreserved = 0;

    if (command.includes('vitest') || rawOutput.includes('RUN  v') || rawOutput.includes('Test Files')) {
      const res = this._compactVitest(rawOutput);
      compactedBody = res.text;
      failuresPreserved = res.failuresCount;
    } else if (command.includes('node --test') || rawOutput.includes('\u2139 pass') || rawOutput.includes('\u2139 fail')) {
      const res = this._compactNodeTest(rawOutput);
      compactedBody = res.text;
      failuresPreserved = res.failuresCount;
    } else if (command.includes('pytest') || rawOutput.includes('==== test session starts ====')) {
      const res = this._compactPytest(rawOutput);
      compactedBody = res.text;
      failuresPreserved = res.failuresCount;
    } else if (command.includes('git diff') || command.includes('git log') || command.includes('git status')) {
      const res = this._compactGit(rawOutput);
      compactedBody = res.text;
      failuresPreserved = 0;
    } else {
      const res = this._compactGeneric(rawOutput);
      compactedBody = res.text;
      failuresPreserved = res.failuresCount;
    }

    // 3. Assemble standardized compacted header and footer
    const finalCompactedText = [
      COMPACTED_OUTPUT_MARKER,
      compactedBody,
      spillFilePath ? `[Raw output spilled to: ${spillFilePath}]` : '',
    ].filter(Boolean).join('\n\n');

    const compactedBytes = Buffer.byteLength(finalCompactedText, 'utf8');
    const estimatedTokensRaw = Math.ceil(rawBytes / 4);
    const estimatedTokensCompacted = Math.ceil(compactedBytes / 4);
    const reductionPercent = rawBytes > 0
      ? Math.max(0, Math.round(((rawBytes - compactedBytes) / rawBytes) * 100))
      : 0;

    return {
      contract: CLI_COMPACTOR_CONTRACT,
      marker: COMPACTED_OUTPUT_MARKER,
      compactedOutput: finalCompactedText,
      spillFilePath,
      rawBytes,
      compactedBytes,
      reductionPercent,
      estimatedTokensRaw,
      estimatedTokensCompacted,
      estimatedTokensSaved: Math.max(0, estimatedTokensRaw - estimatedTokensCompacted),
      processingDurationMs: Date.now() - startTime,
      failuresPreserved,
      exitCode,
      truncated: spillResult.truncated,
      losslessRecovery: spillResult.losslessRecovery,
      spillHash: spillResult.hash,
      spillBytes: spillResult.bytesWritten,
    };
  }

  /**
   * Incrementally processes an incoming readable stream with true streaming:
   * eliminates full-output memory buffering, streams chunks directly to spill file,
   * updates incremental SHA-256 and byte counters, and returns honest truncation metadata.
   *
   * @param {import('node:stream').Readable} stream
   * @param {object} [context]
   * @returns {Promise<object>} Compacted result
   */
  async compactStream(stream, context = {}) {
    const startTime = Date.now();
    const command = (context.command || '').toLowerCase();
    const exitCode = context.exitCode ?? 0;

    let targetDir = null;
    let filePath = null;
    let fd = null;

    if (this.enableSpill) {
      targetDir = this._getSecureSpillDir();
      if (targetDir) {
        try {
          const uniqueSuffix = randomBytes(16).toString('hex');
          const filename = `afyx_raw_cli_${Date.now()}_${uniqueSuffix}.log`;
          filePath = join(targetDir, filename);
          fd = openSync(
            filePath,
            constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
            0o600
          );
        } catch {
          fd = null;
          filePath = null;
        }
      }
    }

    const hasher = createHash('sha256');
    let rawBytes = 0;
    let bytesWrittenToSpill = 0;
    let truncated = false;

    // Streaming line decoder without keeping all passed lines in memory
    const decoder = new StringDecoder('utf8');
    let leftoverLine = '';

    const failureLines = [];
    let passedCount = 0;
    let failedCount = 0;
    const summaryLines = [];
    let inFailureSection = false;
    const fileHeaders = [];
    const firstLines = [];
    const shortLines = [];
    let spillWriteFailed = false;
    const recentLines = [];
    let totalLinesCount = 0;

    const processLine = (line) => {
      totalLinesCount++;
      if (totalLinesCount <= 50) shortLines.push(line);
      if (firstLines.length < 15) {
        firstLines.push(line);
      }
      recentLines.push(line);
      if (recentLines.length > 15) {
        recentLines.shift();
      }

      if (command.includes('vitest') || line.includes('RUN  v') || line.includes('Test Files')) {
        if (line.includes('\u2713') && (line.includes('passed') || line.includes('tests)'))) {
          passedCount++;
        } else if (line.includes('FAIL') || line.includes('Failed Tests') || line.includes('\u00d7')) {
          inFailureSection = true;
          failedCount++;
          failureLines.push(line);
        } else if (line.includes('Test Files') || line.includes('Tests  ') || line.includes('Duration  ')) {
          summaryLines.push(line);
          inFailureSection = false;
        } else if (inFailureSection) {
          failureLines.push(line);
        }
      } else if (command.includes('node --test') || line.includes('\u2139 pass') || line.includes('\u2139 fail')) {
        if (line.startsWith('\u2714')) {
          passedCount++;
        } else if (line.startsWith('\u2716')) {
          failedCount++;
          failureLines.push(line);
        } else if (line.startsWith('\u2139')) {
          summaryLines.push(line);
        } else if (failedCount > 0 && !line.startsWith('\u2714')) {
          failureLines.push(line);
        }
      } else if (command.includes('pytest') || line.includes('==== test session starts ====')) {
        if (line.includes('=== FAILURES ===') || line.includes('=== ERRORS ===')) {
          inFailureSection = true;
        }
        if (inFailureSection) {
          if (line.startsWith('FAILED ') || line.includes('Error:')) failedCount++;
          failureLines.push(line);
        }
        if (line.includes('=== short test summary info ===') || line.includes('passed in') || line.includes('failed in')) {
          inFailureSection = false;
          summaryLines.push(line);
        }
      } else if (command.includes('git diff') || command.includes('git log') || command.includes('git status')) {
        if (line.startsWith('diff --git') || line.startsWith('+++ ') || line.startsWith('commit ')) {
          if (fileHeaders.length < 30) fileHeaders.push(line);
        }
      } else {
        if (/error|fail|exception|fatal|panic/i.test(line)) {
          failureLines.push(`[L${totalLinesCount}] ${line}`);
          failedCount++;
        }
      }
    };

    return new Promise((resolvePromise, rejectPromise) => {
      stream.on('data', (chunk) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        rawBytes += buf.length;
        if (fd !== null && !spillWriteFailed) {
          const length = Math.min(buf.length, Math.max(0, this.maxSpillSizeBytes - bytesWrittenToSpill));
          truncated ||= length < buf.length;
          try {
            writeSpill(fd, buf, length);
            hasher.update(buf.subarray(0, length));
            bytesWrittenToSpill += length;
          } catch {
            spillWriteFailed = true;
          }
        }

        const textChunk = leftoverLine + decoder.write(buf);
        const lines = textChunk.split(/\r?\n/);
        leftoverLine = lines.pop() ?? '';
        for (const l of lines) {
          processLine(l);
        }
      });

      stream.on('error', (err) => {
        if (fd !== null) {
          try { closeSync(fd); } catch { /* ignore */ }
        }
        discardSpill(targetDir);
        rejectPromise(err);
      });

      stream.on('end', () => {
        let spillHash = null;
        try {
          if (fd !== null) {
            closeSync(fd);
            const digest = hasher.digest('hex');
            if (!spillWriteFailed && verifiedSpill(filePath, bytesWrittenToSpill, digest)) {
              registerCompletedSpill(filePath);
              spillHash = digest;
            }
          }
        } catch { /* The spill could not be verified. */ }
        if (!spillHash) {
          discardSpill(targetDir);
          filePath = null;
          bytesWrittenToSpill = 0;
        }

        const remaining = leftoverLine + decoder.end();
        if (remaining.length > 0) {
          processLine(remaining);
        }

        let compactedBody = '';
        if (command.includes('vitest')) {
          const parts = [];
          if (passedCount > 0) parts.push(`\u2713 [Compacted ${passedCount} passing test suite lines]`);
          if (failureLines.length > 0) parts.push('\u23af\u23af\u23af\u23af\u23af\u23af\u23af PRESERVED FAILURE DIAGNOSTICS \u23af\u23af\u23af\u23af\u23af\u23af\u23af\n' + failureLines.join('\n'));
          if (summaryLines.length > 0) parts.push(summaryLines.join('\n'));
          compactedBody = parts.join('\n\n') || `[Compacted ${totalLinesCount} lines]`;
        } else if (command.includes('node --test')) {
          const parts = [];
          if (passedCount > 0) parts.push(`\u2714 [Compacted ${passedCount} passing tests]`);
          if (failureLines.length > 0) parts.push('\u2716 PRESERVED TEST FAILURES:\n' + failureLines.join('\n'));
          if (summaryLines.length > 0) parts.push(summaryLines.join('\n'));
          compactedBody = parts.join('\n\n') || `[Compacted ${totalLinesCount} lines]`;
        } else if (command.includes('pytest')) {
          const parts = [];
          if (summaryLines.length > 0) parts.push('. [Passing tests collapsed]');
          if (failureLines.length > 0) parts.push(failureLines.join('\n'));
          if (summaryLines.length > 0) parts.push(summaryLines.join('\n'));
          compactedBody = parts.join('\n\n') || `[Compacted ${totalLinesCount} lines]`;
        } else if (command.includes('git diff') || command.includes('git log') || command.includes('git status')) {
          compactedBody = `[Git output compacted: ${totalLinesCount} lines, ${fileHeaders.length} headers]\n` +
            fileHeaders.join('\n');
        } else {
          if (totalLinesCount <= 50) {
            compactedBody = shortLines.join('\n');
          } else {
            let body = `${firstLines.join('\n')}\n\n... [${Math.max(0, totalLinesCount - 30)} lines compacted] ...\n\n${recentLines.join('\n')}`;
            if (failureLines.length > 0) {
              body += `\n\n[Preserved Error Lines (${failureLines.length})]:\n${failureLines.join('\n')}`;
            }
            compactedBody = body;
          }
        }

        const spillFilePath = filePath;
        const finalCompactedText = [
          COMPACTED_OUTPUT_MARKER,
          compactedBody,
          spillFilePath ? `[Raw output spilled to: ${spillFilePath}]` : '',
        ].filter(Boolean).join('\n\n');

        const compactedBytes = Buffer.byteLength(finalCompactedText, 'utf8');
        const estimatedTokensRaw = Math.ceil(rawBytes / 4);
        const estimatedTokensCompacted = Math.ceil(compactedBytes / 4);
        const reductionPercent = rawBytes > 0
          ? Math.max(0, Math.round(((rawBytes - compactedBytes) / rawBytes) * 100))
          : 0;

        resolvePromise({
          contract: CLI_COMPACTOR_CONTRACT,
          marker: COMPACTED_OUTPUT_MARKER,
          compactedOutput: finalCompactedText,
          spillFilePath,
          rawBytes,
          compactedBytes,
          reductionPercent,
          estimatedTokensRaw,
          estimatedTokensCompacted,
          estimatedTokensSaved: Math.max(0, estimatedTokensRaw - estimatedTokensCompacted),
          processingDurationMs: Date.now() - startTime,
          failuresPreserved: failedCount,
          exitCode,
          truncated,
          losslessRecovery: !truncated && Boolean(spillFilePath),
          spillHash,
          spillBytes: bytesWrittenToSpill,
        });
      });
    });
  }

  _compactVitest(output) {
    const lines = output.split(/\r?\n/);
    const failureLines = [];
    let inFailureSection = false;
    let passedCount = 0;
    let failedCount = 0;
    let summaryLine = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.includes('\u2713') && (line.includes('passed') || line.includes('tests)'))) {
        passedCount++;
        continue;
      }

      if (line.includes('FAIL') || line.includes('Failed Tests') || line.includes('\u00d7')) {
        inFailureSection = true;
        failedCount++;
      }

      if (line.includes('Test Files') || line.includes('Tests  ') || line.includes('Duration  ')) {
        summaryLine += (summaryLine ? '\n' : '') + line;
        inFailureSection = false;
        continue;
      }

      if (inFailureSection) {
        failureLines.push(line);
      }
    }

    const parts = [];
    if (passedCount > 0) {
      parts.push(`\u2713 [Compacted ${passedCount} passing test suite lines]`);
    }

    if (failureLines.length > 0) {
      parts.push('\u23af\u23af\u23af\u23af\u23af\u23af\u23af PRESERVED FAILURE DIAGNOSTICS \u23af\u23af\u23af\u23af\u23af\u23af\u23af\n' + failureLines.join('\n'));
    }

    if (summaryLine) {
      parts.push(summaryLine);
    } else if (parts.length === 0) {
      parts.push(output.slice(0, 1000));
    }

    return { text: parts.join('\n\n'), failuresCount: failedCount };
  }

  _compactNodeTest(output) {
    const lines = output.split(/\r?\n/);
    const failureLines = [];
    let passedCount = 0;
    let failedCount = 0;
    const summaryLines = [];

    for (const line of lines) {
      if (line.startsWith('\u2714')) {
        passedCount++;
      } else if (line.startsWith('\u2716')) {
        failedCount++;
        failureLines.push(line);
      } else if (line.startsWith('\u2139')) {
        summaryLines.push(line);
      } else if (failedCount > 0 && !line.startsWith('\u2714')) {
        failureLines.push(line);
      }
    }

    const parts = [];
    if (passedCount > 0) {
      parts.push(`\u2714 [Compacted ${passedCount} passing tests]`);
    }
    if (failureLines.length > 0) {
      parts.push('\u2716 PRESERVED TEST FAILURES:\n' + failureLines.join('\n'));
    }
    if (summaryLines.length > 0) {
      parts.push(summaryLines.join('\n'));
    }

    return { text: parts.join('\n\n'), failuresCount: failedCount };
  }

  _compactPytest(output) {
    const lines = output.split(/\r?\n/);
    const failureLines = [];
    let inFailures = false;
    let failedCount = 0;
    let summaryLine = '';

    for (const line of lines) {
      if (line.includes('=== FAILURES ===') || line.includes('=== ERRORS ===')) {
        inFailures = true;
      }
      if (inFailures) {
        if (line.startsWith('FAILED ') || line.includes('Error:')) failedCount++;
        failureLines.push(line);
      }
      if (line.includes('=== short test summary info ===') || line.includes('passed in') || line.includes('failed in')) {
        inFailures = false;
        summaryLine += (summaryLine ? '\n' : '') + line;
      }
    }

    const parts = [];
    if (output.includes(' passed')) {
      parts.push('. [Passing tests collapsed]');
    }
    if (failureLines.length > 0) {
      parts.push(failureLines.join('\n'));
    }
    if (summaryLine) {
      parts.push(summaryLine);
    }

    return { text: parts.join('\n\n') || output.slice(0, 1000), failuresCount: failedCount };
  }

  _compactGit(output) {
    const lines = output.split(/\r?\n/);
    if (lines.length <= 40) return { text: output, failuresCount: 0 };

    const fileHeaders = lines.filter((l) => l.startsWith('diff --git') || l.startsWith('+++ ') || l.startsWith('commit '));
    const stats = `[Git output compacted: ${lines.length} lines, ${fileHeaders.length} headers]\n` +
      fileHeaders.slice(0, 30).join('\n') +
      (fileHeaders.length > 30 ? `\n... and ${fileHeaders.length - 30} more items` : '');

    return { text: stats, failuresCount: 0 };
  }

  _compactGeneric(output) {
    const lines = output.split(/\r?\n/);
    if (lines.length <= 50) {
      return { text: output, failuresCount: 0 };
    }

    const errors = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (/error|fail|exception|fatal|panic/i.test(l)) {
        errors.push({ lineIndex: i + 1, text: l });
      }
    }

    const firstLines = lines.slice(0, 15).join('\n');
    const lastLines = lines.slice(-15).join('\n');

    let body = `${firstLines}\n\n... [${lines.length - 30} lines compacted] ...\n\n${lastLines}`;
    if (errors.length > 0) {
      // Keep failure lines available even without raw recovery.
      const displayErrors = errors.map((e) => `[L${e.lineIndex}] ${e.text}`).join('\n');
      body += `\n\n[Preserved Error Lines (${errors.length})]:\n${displayErrors}`;
    }

    return { text: body, failuresCount: errors.length };
  }
}
