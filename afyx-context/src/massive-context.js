/**
 * AFYX Out-of-Core Massive Context Navigator (AFYX-241 / AFYX-244 / AfyxMassiveContext/v1).
 *
 * Provides scalable, out-of-core context indexing and progressive coarse-to-fine
 * retrieval for large document archives, research notes, datasets, and monorepos.
 *
 * Hardened Capabilities:
 * - Strict workspace path containment and symlink escape prevention
 * - Bounded streaming indexing via chunked buffer reads (no full-file readFileSync)
 * - Byte-accurate offset reads using direct handle readSync for minimal memory footprint
 * - Proper multibyte UTF-8 boundary and LF/CRLF handling
 * - Stale-index invalidation on file modification or deletion
 * - Content-addressed segment identity (SHA-256 chunk hash)
 * - Strict per-task byte and token budgeting (default 16KB / ~4000 tokens)
 * - Clean-room original AFYX-native JavaScript implementation
 */

import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readSync,
  statSync,
} from 'node:fs';
import { basename, extname, join, relative, resolve } from 'node:path';
import { assertPathContained, checkPathContainment } from './path-containment.js';

export const MASSIVE_CONTEXT_CONTRACT = 'AfyxMassiveContext/v1';

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.zip', '.tar', '.gz',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.iso', '.woff', '.woff2', '.ttf'
]);

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

export class MassiveContextNavigator {
  /**
   * @param {string} workspaceRoot
   * @param {object} [options]
   * @param {number} [options.chunkSizeBytes=2048] Target slice size
   * @param {number} [options.maxFileSizeBytes=10485760] Skip files larger than 10MB
   */
  constructor(workspaceRoot, options = {}) {
    this.logicalRoot = resolve(workspaceRoot);
    this.workspaceRoot = assertPathContained('.', this.logicalRoot, { expectDirectory: true, mustExist: true });
    this.chunkSizeBytes = options.chunkSizeBytes || 2048;
    this.maxFileSizeBytes = options.maxFileSizeBytes || 10 * 1024 * 1024;
    // In-memory coarse segment index: Map<fileRelPath, FileIndexEntry>
    this.index = new Map();
  }

  /**
   * Builds or updates the coarse metadata index across workspace files.
   *
   * @param {object} [options]
   * @param {Array<string>} [options.includeDirs] Specific subdirectories to scan
   * @returns {object} Indexing statistics
   */
  indexWorkspace(options = {}) {
    const startTime = Date.now();
    let indexedFiles = 0;
    let indexedSegments = 0;
    let totalBytesScanned = 0;

    const files = this._scanFiles(options.includeDirs);

    // Track active paths to handle file deletions
    const activePaths = new Set();

    for (const file of files) {
      activePaths.add(file.relPath);
      totalBytesScanned += file.size;

      const existing = this.index.get(file.relPath);
      if (existing && existing.mtimeMs === file.mtimeMs && existing.size === file.size) {
        // Unchanged file - reuse indexed segments
        indexedFiles++;
        indexedSegments += existing.segments.length;
        continue;
      }

      // Stream-index file without full-file in-memory loading
      const segments = this._indexFileStreaming(file.absPath, file.relPath);
      this.index.set(file.relPath, {
        relPath: file.relPath,
        size: file.size,
        mtimeMs: file.mtimeMs,
        segments,
      });

      indexedFiles++;
      indexedSegments += segments.length;
    }

    // Invalidation: remove deleted files from index
    for (const cachedPath of this.index.keys()) {
      if (!activePaths.has(cachedPath)) {
        this.index.delete(cachedPath);
      }
    }

    return {
      contract: MASSIVE_CONTEXT_CONTRACT,
      status: 'INDEXED',
      indexedFiles,
      indexedSegments,
      totalBytesScanned,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Performs progressive coarse-to-fine context retrieval bounded by token/byte budget.
   *
   * @param {string} query Search terms or natural language query
   * @param {object} [options]
   * @param {number} [options.maxContextBytes=16384] Strict max context byte budget (default 16KB)
   * @param {number} [options.maxSegments=8] Maximum segments to return
   * @returns {object} Budget-bounded, evidence-grounded retrieved context
   */
  retrieveContext(query, options = {}) {
    if (!query || typeof query !== 'string') {
      throw new TypeError('Query must be a non-empty string.');
    }

    const startTime = Date.now();
    const maxBytes = options.maxContextBytes || 16384;
    const maxSegments = options.maxSegments || 8;
    const queryTerms = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);

    if (this.index.size === 0) {
      this.indexWorkspace();
    }

    // Stage 1: Coarse Segment Scoring
    const scoredSegments = [];

    for (const [relPath, fileEntry] of this.index.entries()) {
      for (const seg of fileEntry.segments) {
        let score = 0;
        const textSample = seg.preview.toLowerCase();

        for (const term of queryTerms) {
          if (seg.keywords && seg.keywords.has(term)) {
            score += 30; // Direct full-chunk keyword match
          } else if (textSample.includes(term)) {
            score += 10;
          }
          if (relPath.toLowerCase().includes(term)) {
            score += 15; // Path match bonus
          }
          if (seg.heading && seg.heading.toLowerCase().includes(term)) {
            score += 25; // Heading match bonus
          }
        }

        if (score > 0) {
          scoredSegments.push({
            relPath,
            segmentId: seg.id,
            startLine: seg.startLine,
            endLine: seg.endLine,
            startByte: seg.startByte,
            endByte: seg.endByte,
            heading: seg.heading,
            score,
            sha256: seg.sha256,
          });
        }
      }
    }

    // Sort by descending relevance score
    scoredSegments.sort((a, b) => b.score - a.score);

    // Stage 2: Fine Retrieval within strict Byte/Token Budget via Byte-Offset Reads
    const selectedSegments = [];
    let accumulatedBytes = 0;
    const visitedContentHashes = new Set(); // Deduplication

    for (const cand of scoredSegments) {
      if (selectedSegments.length >= maxSegments) break;
      if (visitedContentHashes.has(cand.sha256)) continue;

      const fullPath = resolve(this.workspaceRoot, cand.relPath);
      // Byte-offset streaming read - reads only the requested slice
      const text = this._readSlice(fullPath, cand.startByte, cand.endByte);
      const sliceBytes = Buffer.byteLength(text, 'utf8');

      if (accumulatedBytes + sliceBytes > maxBytes && selectedSegments.length > 0) {
        continue; // Exceeds budget, try smaller candidate or stop
      }

      visitedContentHashes.add(cand.sha256);
      accumulatedBytes += sliceBytes;

      selectedSegments.push({
        file: cand.relPath,
        segmentId: cand.segmentId,
        startLine: cand.startLine,
        endLine: cand.endLine,
        heading: cand.heading,
        score: cand.score,
        bytes: sliceBytes,
        content: text,
      });

      if (accumulatedBytes >= maxBytes) break;
    }

    // Stage 3: Grounded Synthesis Assembly
    const estimatedTokens = Math.ceil(accumulatedBytes / 4);

    return {
      contract: MASSIVE_CONTEXT_CONTRACT,
      query,
      status: 'RETRIEVED',
      segmentsCount: selectedSegments.length,
      totalBytesReturned: accumulatedBytes,
      estimatedTokens,
      budgetBytes: maxBytes,
      withinBudget: accumulatedBytes <= maxBytes,
      durationMs: Date.now() - startTime,
      segments: selectedSegments,
    };
  }

  _scanFiles(includeDirs) {
    const files = [];
    const visited = new Set();
    const traverse = (dir) => {
      // Validate directory containment
      const dirCheck = checkPathContainment(dir, this.workspaceRoot, { expectDirectory: true, mustExist: true });
      if (!dirCheck.contained || visited.has(dirCheck.canonicalPath)) return;
      dir = dirCheck.canonicalPath;
      visited.add(dir);

      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const full = join(dir, entry.name);

          if (entry.isDirectory()) {
            if (!['.git', 'node_modules', '.afyx-graph', '.afyx-backup', 'dist', 'build'].includes(entry.name)) {
              traverse(full);
            }
          } else if (entry.isFile()) {
            const ext = extname(entry.name).toLowerCase();
            if (BINARY_EXTENSIONS.has(ext)) continue;

            // Enforce file-level path containment
            const fileCheck = checkPathContainment(full, this.workspaceRoot, { expectFile: true, mustExist: true });
            if (!fileCheck.contained) continue;

            const stat = statSync(fileCheck.canonicalPath);
            if (stat.size <= this.maxFileSizeBytes) {
              files.push({
                absPath: fileCheck.canonicalPath,
                relPath: relative(this.workspaceRoot, fileCheck.canonicalPath).replace(/\\/g, '/'),
                size: stat.size,
                mtimeMs: stat.mtimeMs,
              });
            }
          }
        }
      } catch {
        // Skip unreadable
      }
    };

    if (Array.isArray(includeDirs) && includeDirs.length > 0) {
      for (const d of includeDirs) {
        const check = checkPathContainment(d, this.logicalRoot, { expectDirectory: true, mustExist: true });
        if (check.contained) {
          traverse(check.canonicalPath);
        }
      }
    } else {
      traverse(this.workspaceRoot);
    }

    return files;
  }

  /**
   * Reads a file in streaming chunks without loading the entire file into memory.
   *
   * @private
   * @param {string} absPath
   * @param {string} relPath
   * @returns {Array<object>}
   */
  _indexFileStreaming(absPath, relPath) {
    const segments = [];
    let fd = null;
    try {
      absPath = assertPathContained(absPath, this.workspaceRoot, { expectFile: true, mustExist: true });

      const stat = statSync(absPath);
      const totalBytes = stat.size;
      if (totalBytes === 0) return [];

      fd = openSync(absPath, 'r');
      const bufferSize = 64 * 1024; // 64KB bounded streaming chunk
      const buffer = Buffer.alloc(bufferSize);

      let fileReadOffset = 0;
      let carriedBuffer = Buffer.alloc(0);
      let currentLineNumber = 1;

      let sliceStartByte = 0;
      let sliceStartLine = 1;
      let sliceLines = [];
      let currentHeading = '';

      // Cumulative byte offset of the current line start in the file
      let currentLineStartByte = 0;

      while (fileReadOffset < totalBytes) {
        const readLength = Math.min(bufferSize, totalBytes - fileReadOffset);
        const bytesRead = readSync(fd, buffer, 0, readLength, fileReadOffset);
        if (bytesRead === 0) break;

        const currentChunk = carriedBuffer.length > 0
          ? Buffer.concat([carriedBuffer, buffer.subarray(0, bytesRead)])
          : buffer.subarray(0, bytesRead);

        let lineStart = 0;
        let nlPos = -1;

        while ((nlPos = currentChunk.indexOf(0x0a, lineStart)) !== -1) {
          // Check for CRLF (\r\n) vs LF (\n)
          const isCrLf = nlPos > lineStart && currentChunk[nlPos - 1] === 0x0d;
          const lineBytes = isCrLf
            ? currentChunk.subarray(lineStart, nlPos - 1)
            : currentChunk.subarray(lineStart, nlPos);
          const nlLen = isCrLf ? 2 : 1;

          const line = lineBytes.toString('utf8');
          const fullLineByteLength = lineBytes.length + nlLen;
          const currentLineEndByte = currentLineStartByte + fullLineByteLength;

          if (line.startsWith('#') || line.startsWith('//') || line.startsWith('/*')) {
            currentHeading = line.replace(/^[#\s\/*]+/, '').trim();
          }

          sliceLines.push(line);
          const currentSliceBytes = currentLineEndByte - sliceStartByte;

          if (currentSliceBytes >= this.chunkSizeBytes) {
            const sliceText = sliceLines.join('\n');
            const sliceHash = sha256(sliceText);
            const endLine = currentLineNumber;

            const words = sliceText.toLowerCase().match(/[a-z0-9_]{3,}/g) || [];
            const keywords = new Set(words);

            segments.push({
              id: `seg_${sliceHash.slice(0, 12)}`,
              startLine: sliceStartLine,
              endLine,
              startByte: sliceStartByte,
              endByte: currentLineEndByte,
              heading: currentHeading || basename(relPath),
              preview: sliceText.slice(0, 300),
              keywords,
              sha256: sliceHash,
            });

            sliceStartByte = currentLineEndByte;
            sliceStartLine = endLine + 1;
            sliceLines = [];
          }

          currentLineNumber++;
          currentLineStartByte = currentLineEndByte;
          lineStart = nlPos + 1;
        }

        // Remaining unparsed bytes in currentChunk after the last \n
        carriedBuffer = currentChunk.subarray(lineStart);
        fileReadOffset += bytesRead;
      }

      // Handle any trailing bytes without newline at EOF
      if (carriedBuffer.length > 0) {
        const line = carriedBuffer.toString('utf8');
        sliceLines.push(line);
        currentLineStartByte += carriedBuffer.length;
      }

      if (sliceLines.length > 0) {
        const sliceText = sliceLines.join('\n');
        const sliceHash = sha256(sliceText);

        const words = sliceText.toLowerCase().match(/[a-z0-9_]{3,}/g) || [];
        const keywords = new Set(words);

        segments.push({
          id: `seg_${sliceHash.slice(0, 12)}`,
          startLine: sliceStartLine,
          endLine: currentLineNumber,
          startByte: sliceStartByte,
          endByte: totalBytes,
          heading: currentHeading || basename(relPath),
          preview: sliceText.slice(0, 300),
          keywords,
          sha256: sliceHash,
        });
      }
    } catch {
      // Return empty segments if unreadable or access denied
    } finally {
      if (fd !== null) {
        try { closeSync(fd); } catch { /* ignore */ }
      }
    }

    return segments;
  }

  /**
   * Reads only the exact byte-offset slice from disk without loading the whole file.
   *
   * @private
   * @param {string} absPath
   * @param {number} startByte
   * @param {number} endByte
   * @returns {string}
   */
  _readSlice(absPath, startByte, endByte) {
    let fd = null;
    try {
      const options = { expectFile: true, mustExist: true };
      const canonical = assertPathContained(absPath, this.logicalRoot, options);
      absPath = assertPathContained(canonical, this.workspaceRoot, options);

      const length = Math.max(0, endByte - startByte);
      if (length === 0) return '';

      fd = openSync(absPath, 'r');
      const buffer = Buffer.alloc(length);
      const bytesRead = readSync(fd, buffer, 0, length, startByte);
      return buffer.toString('utf8', 0, bytesRead);
    } catch {
      return '';
    } finally {
      if (fd !== null) {
        try { closeSync(fd); } catch { /* ignore */ }
      }
    }
  }
}
