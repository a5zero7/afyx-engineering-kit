/**
 * AFYX Engineering Kit - Memory Headroom and Worker Pool Budgeting
 *
 * Provides accurate operating-system memory metrics across platforms:
 * - Linux: Inspects cgroup v1 & v2 quotas, deducting working-set usage and crediting inactive page cache.
 * - Darwin (macOS): Reads vm_stat statistics accounting for free, inactive, speculative, and purgeable pages.
 * - Windows/Generic: Falls back to os.freemem().
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';

function parseCgroupMetricFile(filePath: string): number | null {
  try {
    const rawText = fs.readFileSync(filePath, 'utf8').trim();
    if (rawText === 'max') return null;
    const value = Number.parseInt(rawText, 10);
    return Number.isFinite(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

function extractInactiveFileCache(statPath: string): number {
  try {
    const match = /^inactive_file (\d+)$/m.exec(fs.readFileSync(statPath, 'utf8'));
    return match ? Number.parseInt(match[1]!, 10) : 0;
  } catch {
    return 0;
  }
}

/**
 * Returns available memory headroom under Linux cgroup limits, or null if unconfined/non-Linux.
 */
export function cgroupMemoryAvailable(): number | null {
  if (process.platform !== 'linux') return null;

  // cgroup v2
  const v2MemoryMax = parseCgroupMetricFile('/sys/fs/cgroup/memory.max');
  if (v2MemoryMax !== null) {
    const currentUsage = parseCgroupMetricFile('/sys/fs/cgroup/memory.current') ?? 0;
    const reclaimableCache = extractInactiveFileCache('/sys/fs/cgroup/memory.stat');
    const netUsage = Math.max(0, currentUsage - reclaimableCache);
    return Math.max(0, v2MemoryMax - netUsage);
  }

  // cgroup v1
  const v1MemoryLimit = parseCgroupMetricFile('/sys/fs/cgroup/memory/memory.limit_in_bytes');
  if (v1MemoryLimit !== null && v1MemoryLimit < 2 ** 60) {
    const currentUsage = parseCgroupMetricFile('/sys/fs/cgroup/memory/memory.usage_in_bytes') ?? 0;
    const reclaimableCache = extractInactiveFileCache('/sys/fs/cgroup/memory/memory.stat');
    const netUsage = Math.max(0, currentUsage - reclaimableCache);
    return Math.max(0, v1MemoryLimit - netUsage);
  }

  return null;
}

/**
 * Returns available physical memory on Darwin using vm_stat, or null if unsupported.
 */
export function darwinMemoryAvailable(): number | null {
  if (process.platform !== 'darwin') return null;

  try {
    const vmStatOutput = execFileSync('/usr/bin/vm_stat', { encoding: 'utf8', timeout: 2000 });
    const pageSizeMatch = /page size of (\d+) bytes/.exec(vmStatOutput);
    const pageSize = pageSizeMatch ? Number.parseInt(pageSizeMatch[1]!, 10) : 16384;

    const parsePageCount = (metricName: string): number => {
      const regex = new RegExp(`^${metricName}:\\s+(\\d+)`, 'm');
      const match = regex.exec(vmStatOutput);
      return match ? Number.parseInt(match[1]!, 10) : 0;
    };

    const totalAvailablePages =
      parsePageCount('Pages free') +
      parsePageCount('Pages inactive') +
      parsePageCount('Pages speculative') +
      parsePageCount('Pages purgeable');

    const totalBytes = totalAvailablePages * pageSize;
    return totalBytes > 0 && Number.isFinite(totalBytes) ? totalBytes : null;
  } catch {
    return null;
  }
}

/**
 * Calculates conservative usable memory headroom for sizing asynchronous worker pools.
 */
export function memoryBudgetBytes(): number {
  const osFreeBytes = os.freemem();
  const cgroupBytes = cgroupMemoryAvailable();

  if (cgroupBytes !== null) {
    return Math.min(osFreeBytes, cgroupBytes);
  }

  const darwinBytes = darwinMemoryAvailable();
  return darwinBytes === null ? osFreeBytes : Math.max(osFreeBytes, darwinBytes);
}
