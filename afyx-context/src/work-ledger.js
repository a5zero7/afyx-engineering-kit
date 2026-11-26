/**
 * AFYX Universal Work & Evidence Ledger (AfyxWorkLedger/v1).
 *
 * Universal task, decision, and evidence tracking engine.
 * - Works standalone in any workspace, directory, or document tree without Git or Jira.
 * - Uses a shared SHA-256 digest for local integrity checks.
 * - Records actual evidence only; never stores secrets or raw user prompts by default.
 * - Atomic file writes, deterministic receipt generation, idempotent updates.
 */

import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { sha256Bytes as sha256 } from './artifact-lineage.js';
import { StateCoordinator } from './coordination.js';
import { checkPathContainment } from './path-containment.js';
import { atomicText } from './storage.js';

export const WORK_LEDGER_CONTRACT = 'AfyxWorkLedger/v1';
export const WORK_LEDGER_RECEIPT_CONTRACT = 'AfyxWorkLedgerReceipt/v1';

const SECRET_KEY = /^(?:password|passwd|secret|token|credential|access[_-]?token|refresh[_-]?token|api[_-]?key|authorization|cookie|private[_-]?key)$/i;
const SECRET_HEADER = /\b(?:Bearer|Basic)\s+[^\s,;"']+/gi;
const SECRET_ASSIGNMENT = /(\b(?:password|passwd|secret|token|credential|access[_-]?token|refresh[_-]?token|api[_-]?key|authorization|cookie|private[_-]?key)\s*["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi;

function sanitizeText(value) {
  return typeof value === 'string'
    ? value.replace(SECRET_HEADER, '[REDACTED]').replace(SECRET_ASSIGNMENT, '$1[REDACTED]')
    : '';
}

function sanitizeRecord(value) {
  if (typeof value === 'string') return sanitizeText(value);
  if (Array.isArray(value)) return value.map(sanitizeRecord);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) =>
      [sanitizeText(key), SECRET_KEY.test(key) ? '[REDACTED]' : sanitizeRecord(entry)]));
  }
  return value;
}

function hashFileContent(filePath) {
  try {
    if (!existsSync(filePath)) return null;
    const content = readFileSync(filePath);
    return {
      path: filePath.replace(/\\/g, '/'),
      sizeBytes: content.length,
      sha256: sha256(content),
    };
  } catch {
    return null;
  }
}

export class WorkLedger {
  /**
   * @param {string} workspaceRoot
   * @param {object} [options]
   * @param {string} [options.ledgerDir] Custom storage directory (.afyx-ledger by default)
   */
  constructor(workspaceRoot, options = {}) {
    this.workspaceRoot = resolve(workspaceRoot);
    this.ledgerDir = resolve(options.ledgerDir || join(this.workspaceRoot, '.afyx-ledger'));
  }

  _ensureDir() {
    mkdirSync(this.ledgerDir, { recursive: true, mode: 0o700 });
    const stat = lstatSync(this.ledgerDir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('LEDGER_DIRECTORY_UNSAFE');
  }

  _getLedgerPath(ledgerId) {
    const safeId = ledgerId.replace(/[^a-zA-Z0-9_\-]/g, '_');
    return join(this.ledgerDir, `ledger_${safeId}.json`);
  }

  /**
   * Records or updates a work ledger entry.
   *
   * @param {object} params
   * @param {string} params.ledgerId Unique ledger/task ID
   * @param {string} params.taskObjective Primary goal
   * @param {string} params.scope Boundaries and components
   * @param {Array<object>} [params.decisions] Rationale and architectural choices
   * @param {Array<string>} [params.affectedFiles] Files modified or verified
   * @param {string} [params.verificationState='PENDING'] PENDING | VERIFIED | FAILED
   * @param {Array<object>} [params.evidence] Test results, measurements, diagnostics
   * @param {string} [params.gitCommit] Optional Git commit SHA
   * @param {string} [params.jiraIssue] Optional Jira issue key
   * @returns {object} Updated ledger record
   */
  recordEntry(params) {
    if (!params || !params.ledgerId || !params.taskObjective) {
      throw new TypeError('ledgerId and taskObjective are required.');
    }

    this._ensureDir();
    const stateDir = realpathSync(this.ledgerDir);
    const lock = new StateCoordinator({ stateDir, ownerHash: sha256(stateDir) });
    return lock.withLock(() => this._recordEntry(params));
  }

  _recordEntry(params) {
    const filePath = this._getLedgerPath(params.ledgerId);
    const existing = this.getLedger(params.ledgerId);

    const now = new Date().toISOString();
    const affectedFilesHashes = [];

    if (Array.isArray(params.affectedFiles)) {
      for (const relOrAbs of params.affectedFiles) {
        const target = checkPathContainment(relOrAbs, this.workspaceRoot, { mustExist: true, expectFile: true });
        const fileInfo = target.contained ? hashFileContent(target.canonicalPath) : null;
        if (fileInfo) fileInfo.path = relative(this.workspaceRoot, resolve(this.workspaceRoot, relOrAbs)).replace(/\\/g, '/');
        if (fileInfo) {
          affectedFilesHashes.push(fileInfo);
        } else {
          affectedFilesHashes.push({
            path: relOrAbs.replace(/\\/g, '/'),
            sizeBytes: 0,
            sha256: 'FILE_NOT_FOUND_OR_UNREADABLE',
          });
        }
      }
    }

    // Merge decisions idempotently
    const combinedDecisions = existing?.decisions ? [...existing.decisions] : [];
    if (Array.isArray(params.decisions)) {
      for (const d of params.decisions) {
        const textDec = sanitizeText(d.decision || String(d));
        if (!combinedDecisions.some((cd) => cd.decision === textDec)) {
          combinedDecisions.push({
            decision: textDec,
            rationale: sanitizeText(d.rationale || ''),
            timestamp: d.timestamp || now,
          });
        }
      }
    }

    // Merge evidence idempotently
    const combinedEvidence = existing?.evidence ? [...existing.evidence] : [];
    if (Array.isArray(params.evidence)) {
      for (const ev of params.evidence) {
        const summary = sanitizeText(ev.summary || String(ev));
        combinedEvidence.push({
          type: ev.type || 'observation',
          summary,
          detail: typeof ev.detail === 'object' ? ev.detail : sanitizeText(String(ev.detail || '')),
          timestamp: ev.timestamp || now,
        });
      }
    }

    const record = sanitizeRecord({
      contract: WORK_LEDGER_CONTRACT,
      ledgerId: params.ledgerId,
      workspace: {
        root: this.workspaceRoot.replace(/\\/g, '/'),
        name: basename(this.workspaceRoot),
      },
      taskObjective: sanitizeText(params.taskObjective),
      scope: sanitizeText(params.scope || 'universal'),
      verificationState: params.verificationState || existing?.verificationState || 'PENDING',
      decisions: combinedDecisions,
      affectedFiles: affectedFilesHashes.length > 0 ? affectedFilesHashes : (existing?.affectedFiles || []),
      evidence: combinedEvidence,
      gitCommit: params.gitCommit || existing?.gitCommit || null,
      jiraIssue: params.jiraIssue || existing?.jiraIssue || null,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    });

    atomicText(filePath, JSON.stringify(record, null, 2));

    return record;
  }

  /**
   * Retrieves an existing ledger entry.
   *
   * @param {string} ledgerId
   * @returns {object|null}
   */
  getLedger(ledgerId) {
    const filePath = this._getLedgerPath(ledgerId);
    let stat;
    try { stat = lstatSync(filePath); } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 16 * 1024 * 1024) {
      throw new Error('LEDGER_FILE_UNSAFE');
    }
    const record = JSON.parse(readFileSync(filePath, 'utf8'));
    if (record?.contract !== WORK_LEDGER_CONTRACT || !Array.isArray(record.evidence) ||
        !Array.isArray(record.decisions) || !Array.isArray(record.affectedFiles)) {
      throw new Error('LEDGER_CORRUPTED');
    }
    return record;
  }

  /**
   * Generates a deterministic integrity digest for a ledger entry.
   *
   * @param {string} ledgerId
   * @returns {object} Receipt with cryptographic hash
   */
  createReceipt(ledgerId) {
    const ledger = this.getLedger(ledgerId);
    if (!ledger) {
      throw new Error(`Ledger entry '${ledgerId}' does not exist.`);
    }

    const payload = JSON.stringify({
      ledgerId: ledger.ledgerId,
      workspace: ledger.workspace,
      verificationState: ledger.verificationState,
      affectedFiles: ledger.affectedFiles,
      gitCommit: ledger.gitCommit,
      jiraIssue: ledger.jiraIssue,
      updatedAt: ledger.updatedAt,
    });

    const receiptHash = sha256(payload);

    return {
      contract: WORK_LEDGER_RECEIPT_CONTRACT,
      receiptId: `rcpt_${ledger.ledgerId}_${receiptHash.slice(0, 16)}`,
      ledgerId: ledger.ledgerId,
      verificationState: ledger.verificationState,
      filesCount: ledger.affectedFiles.length,
      receiptHash,
      issuedAt: new Date().toISOString(),
      provenancePayload: payload,
    };
  }

  /**
   * Validates a receipt against its provenance payload.
   *
   * @param {object} receipt
   * @returns {boolean}
   */
  static verifyReceipt(receipt) {
    if (!receipt || !receipt.provenancePayload || !receipt.receiptHash) return false;
    const computed = sha256(receipt.provenancePayload);
    return computed === receipt.receiptHash;
  }
}
