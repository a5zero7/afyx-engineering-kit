/**
 * AFYX Universal Environment Preflight (AfyxEnvPreflight/v1).
 *
 * Universal workspace and environment diagnostics.
 * - Runtime & tool availability (Node.js version >= 22.5.0, optional Git)
 * - Workspace permissions (read/write probe in disposable path)
 * - Stale lock detection (.git/index.lock, afyx-graph.lock) without deleting
 * - Environment key parity (.env vs .env.example) without leaking secret values
 * - Non-destructive port binding conflict inspection
 * - Platform identification (Windows, WSL2, Linux, macOS)
 */

import { existsSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { freemem, platform, release, totalmem } from 'node:os';
import { join, resolve } from 'node:path';

export const ENV_PREFLIGHT_CONTRACT = 'AfyxEnvPreflight/v1';

export class EnvPreflight {
  /**
   * @param {string} workspaceRoot
   */
  constructor(workspaceRoot) {
    this.workspaceRoot = resolve(workspaceRoot);
  }

  /**
   * Runs the full suite of non-destructive workspace diagnostics.
   *
   * @param {object} [options]
   * @param {Array<number>} [options.portsToCheck=[3000, 5432, 8080]]
   * @returns {Promise<object>} Diagnostic report
   */
  async runPreflight(options = {}) {
    const now = new Date().toISOString();
    const ports = options.portsToCheck || [3000, 5432, 8080];

    const runtimeCheck = this._checkRuntime();
    const permissionsCheck = this._checkPermissions();
    const staleLocksCheck = this._checkStaleLocks();
    const envParityCheck = this._checkEnvParity();
    const portChecks = await this._checkPorts(ports);
    const osCheck = this._identifyPlatform();

    const checks = [
      runtimeCheck,
      permissionsCheck,
      staleLocksCheck,
      envParityCheck,
      ...portChecks,
    ];

    const hasFailure = checks.some((c) => c.status === 'FAIL');
    const hasWarning = checks.some((c) => c.status === 'WARN');

    return {
      contract: ENV_PREFLIGHT_CONTRACT,
      status: hasFailure ? 'FAIL' : hasWarning ? 'WARN' : 'PASS',
      workspace: {
        root: this.workspaceRoot.replace(/\\/g, '/'),
        platform: osCheck.platform,
        isWsl2: osCheck.isWsl2,
        totalMemoryMb: Math.round(totalmem() / (1024 * 1024)),
        freeMemoryMb: Math.round(freemem() / (1024 * 1024)),
      },
      checks,
      timestamp: now,
    };
  }

  _checkRuntime() {
    const nodeVer = process.version; // e.g. v22.11.0
    const parts = nodeVer.slice(1).split('.');
    const major = parseInt(parts[0] || '0', 10);
    const minor = parseInt(parts[1] || '0', 10);
    const isSupported = major > 22 || (major === 22 && minor >= 5);

    return {
      name: 'node-runtime',
      status: isSupported ? 'PASS' : 'FAIL',
      detail: `Node.js ${nodeVer} (Required: >=22.5.0)`,
      critical: true,
    };
  }

  _checkPermissions() {
    // 1. Read test
    let canRead = false;
    try {
      readdirSync(this.workspaceRoot);
      canRead = true;
    } catch {
      canRead = false;
    }

    // 2. Write probe in disposable temporary file
    let canWrite = false;
    const probePath = join(this.workspaceRoot, `.afyx_probe_${Date.now()}.tmp`);
    try {
      writeFileSync(probePath, 'probe', 'utf8');
      unlinkSync(probePath);
      canWrite = true;
    } catch {
      canWrite = false;
    }

    const pass = canRead && canWrite;
    return {
      name: 'workspace-permissions',
      status: pass ? 'PASS' : canRead ? 'WARN' : 'FAIL',
      detail: `Read: ${canRead ? 'OK' : 'DENIED'}, Write: ${canWrite ? 'OK' : 'DENIED'}`,
      critical: true,
    };
  }

  _checkStaleLocks() {
    const lockCandidates = [
      join(this.workspaceRoot, '.git', 'index.lock'),
      join(this.workspaceRoot, '.afyx-graph', 'afyx-graph.lock'),
    ];

    const detectedLocks = [];
    for (const lockPath of lockCandidates) {
      if (existsSync(lockPath)) {
        try {
          const stat = statSync(lockPath);
          const ageSec = Math.round((Date.now() - stat.mtimeMs) / 1000);
          detectedLocks.push({
            path: lockPath.replace(/\\/g, '/'),
            ageSeconds: ageSec,
            isStale: ageSec > 300, // Older than 5 minutes
          });
        } catch {
          // Skip
        }
      }
    }

    const hasStale = detectedLocks.some((l) => l.isStale);
    return {
      name: 'stale-locks',
      status: hasStale ? 'WARN' : 'PASS',
      detail: detectedLocks.length > 0
        ? `Detected ${detectedLocks.length} active lock file(s): ${detectedLocks.map((l) => `${l.path} (${l.ageSeconds}s old)`).join(', ')}`
        : 'Zero active lock files detected',
      detectedLocks,
      critical: false,
    };
  }

  _checkEnvParity() {
    const envPath = join(this.workspaceRoot, '.env');
    const examplePath = join(this.workspaceRoot, '.env.example');

    if (!existsSync(examplePath)) {
      return {
        name: 'env-parity',
        status: 'PASS',
        detail: '.env.example not present in workspace (parity check skipped)',
        critical: false,
      };
    }

    if (!existsSync(envPath)) {
      return {
        name: 'env-parity',
        status: 'WARN',
        detail: '.env.example exists but active .env is missing',
        critical: false,
      };
    }

    const parseKeys = (p) => {
      try {
        const text = readFileSync(p, 'utf8');
        return text
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith('#') && l.includes('='))
          .map((l) => l.split('=')[0].trim());
      } catch {
        return [];
      }
    };

    const actualKeys = parseKeys(envPath);
    const exampleKeys = parseKeys(examplePath);
    const missingKeys = exampleKeys.filter((k) => !actualKeys.includes(k));

    return {
      name: 'env-parity',
      status: missingKeys.length > 0 ? 'WARN' : 'PASS',
      detail: missingKeys.length > 0
        ? `Missing ${missingKeys.length} key(s) in .env: ${missingKeys.join(', ')}`
        : 'All keys from .env.example are present in .env',
      missingKeys,
      critical: false,
    };
  }

  async _checkPorts(ports) {
    const results = [];
    for (const port of ports) {
      const isAvailable = await new Promise((resolve) => {
        const server = createServer();
        server.once('error', () => resolve(false));
        server.once('listening', () => {
          server.close(() => resolve(true));
        });
        server.listen(port, '127.0.0.1');
      });

      results.push({
        name: `port-check-${port}`,
        status: isAvailable ? 'PASS' : 'WARN',
        detail: `Port ${port} is ${isAvailable ? 'AVAILABLE' : 'OCCUPIED_OR_BLOCKED'}`,
        port,
        available: isAvailable,
        critical: false,
      });
    }
    return results;
  }

  _identifyPlatform() {
    const osPlat = platform();
    let isWsl2 = false;

    if (osPlat === 'linux') {
      try {
        const osRelease = release().toLowerCase();
        isWsl2 = osRelease.includes('microsoft') || osRelease.includes('wsl');
      } catch {
        isWsl2 = false;
      }
    }

    return {
      platform: osPlat,
      isWsl2,
    };
  }
}
