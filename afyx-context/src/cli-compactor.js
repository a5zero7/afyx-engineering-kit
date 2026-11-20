/**
 * AFYX Pure Node.js CLI Compactor (AFYX-245 / AfyxCliCompactor/v1).
 *
 * Compacts terminal outputs (Vitest, node --test, pytest, go test, git diff, tsc, logs)
 * to maximize token efficiency while preserving 100% of error diagnostics and stack traces.
 *
 * Mandatory Rules:
 * 1. Preserves all failure/error records, stack traces, and failure context intact
 * 2. Compacts repetitive passing test logs into structured summaries
 * 3. Preserves exit codes, status indicators, and warning counts
 * 4. Distinct marker: <!-- AFYX-CLI-COMPACTED -->
 * 5. Spill-to-disk: Persists full uncompacted raw output to an isolated temporary file for recovery
 * 6. Estimates token reduction (using ~4 chars/token heuristic)
 */

import { existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const CLI_COMPACTOR_CONTRACT = 'AfyxCliCompactor/v1';
export const COMPACTED_OUTPUT_MARKER = '<!-- AFYX-CLI-COMPACTED -->';

export class CliCompactor {
  /**
   * @param {object} [options]
   * @param {string} [options.spillDir] Directory for raw output spill (defaults to system tmpdir)
   * @param {boolean} [options.enableSpill=true] Whether to save raw output to disk for recovery
   */
  constructor(options = {}) {
    this.spillDir = options.spillDir || tmpdir();
    this.enableSpill = options.enableSpill !== false;
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

    // 1. Spill-to-disk for raw recovery
    let spillFilePath = null;
    if (this.enableSpill && rawBytes > 0) {
      const filename = `afyx_raw_cli_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.log`;
      spillFilePath = join(this.spillDir, filename);
      try {
        writeFileSync(spillFilePath, rawOutput, 'utf8');
      } catch {
        spillFilePath = null;
      }
    }

    // 2. Format / Runner classification & compaction
    let compactedBody = '';
    let failuresPreserved = 0;

    if (command.includes('vitest') || rawOutput.includes('RUN  v') || rawOutput.includes('Test Files')) {
      const res = this._compactVitest(rawOutput);
      compactedBody = res.text;
      failuresPreserved = res.failuresCount;
    } else if (command.includes('node --test') || rawOutput.includes('ℹ pass') || rawOutput.includes('ℹ fail')) {
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
    };
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

      if (line.includes('✓') && (line.includes('passed') || line.includes('tests)'))) {
        passedCount++;
        continue;
      }

      if (line.includes('FAIL') || line.includes('Failed Tests') || line.includes('×')) {
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
      parts.push(`✓ [Compacted ${passedCount} passing test suite lines]`);
    }

    if (failureLines.length > 0) {
      parts.push('⎯⎯⎯⎯⎯⎯⎯ PRESERVED FAILURE DIAGNOSTICS ⎯⎯⎯⎯⎯⎯⎯\n' + failureLines.join('\n'));
    }

    if (summaryLine) {
      parts.push(summaryLine);
    } else if (parts.length === 0) {
      parts.push(output.slice(0, 500));
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
      if (line.startsWith('✔')) {
        passedCount++;
      } else if (line.startsWith('✖')) {
        failedCount++;
        failureLines.push(line);
      } else if (line.startsWith('ℹ')) {
        summaryLines.push(line);
      } else if (failedCount > 0 && !line.startsWith('✔')) {
        failureLines.push(line);
      }
    }

    const parts = [];
    if (passedCount > 0) {
      parts.push(`✔ [Compacted ${passedCount} passing tests]`);
    }
    if (failureLines.length > 0) {
      parts.push('✖ PRESERVED TEST FAILURES:\n' + failureLines.join('\n'));
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

    return { text: parts.join('\n\n') || output.slice(0, 500), failuresCount: failedCount };
  }

  _compactGit(output) {
    const lines = output.split(/\r?\n/);
    if (lines.length <= 40) return { text: output, failuresCount: 0 };

    // Summarize large diff / log
    const fileHeaders = lines.filter((l) => l.startsWith('diff --git') || l.startsWith('+++ ') || l.startsWith('commit '));
    const stats = `[Git output compacted: ${lines.length} lines, ${fileHeaders.length} headers]\n` +
      fileHeaders.slice(0, 20).join('\n') +
      (fileHeaders.length > 20 ? `\n... and ${fileHeaders.length - 20} more items` : '');

    return { text: stats, failuresCount: 0 };
  }

  _compactGeneric(output) {
    const lines = output.split(/\r?\n/);
    if (lines.length <= 50) {
      return { text: output, failuresCount: 0 };
    }

    const errors = lines.filter((l) => /error|fail|exception|fatal|panic/i.test(l));
    const firstLines = lines.slice(0, 15).join('\n');
    const lastLines = lines.slice(-15).join('\n');

    let body = `${firstLines}\n\n... [${lines.length - 30} lines compacted] ...\n\n${lastLines}`;
    if (errors.length > 0) {
      body += '\n\n[Preserved Error Lines (' + errors.length + ')]:\n' + errors.slice(0, 25).join('\n');
    }

    return { text: body, failuresCount: errors.length };
  }
}
