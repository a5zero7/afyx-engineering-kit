/**
 * Project writer lock (#1740) — unit coverage for acquire / re-entrant /
 * stale-dead-pid / live-holder refusal.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MCPEngine } from '../src/mcp/engine';
import {
  decodeWriterLockInfo,
  getWriterPidPath,
  releaseWriterLockClaim,
  releaseWriterLock,
  tryAcquireFullReindexWriterLock,
  tryAcquireWriterLock,
  withFullReindexWriterLock,
  writerLockHeldMessage,
} from '../src/mcp/writer-lock';

describe('writer lock (#1740)', () => {
  let dir: string;
  let holder: ChildProcess | null = null;

  afterEach(() => {
    try { holder?.kill('SIGKILL'); } catch { /* already gone */ }
    holder = null;
    if (dir) {
      releaseWriterLock(dir);
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  function makeProject(): string {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg1740-lock-'));
    fs.mkdirSync(path.join(dir, '.afyx-graph'), { recursive: true });
    return dir;
  }

  it('acquires and releases writer.pid', () => {
    const root = makeProject();
    const r = tryAcquireWriterLock(root, 'direct');
    expect(r.kind).toBe('acquired');
    expect(fs.existsSync(getWriterPidPath(root))).toBe(true);
    const info = decodeWriterLockInfo(fs.readFileSync(getWriterPidPath(root), 'utf8'));
    expect(info?.pid).toBe(process.pid);
    expect(info?.mode).toBe('direct');
    releaseWriterLock(root);
    expect(fs.existsSync(getWriterPidPath(root))).toBe(false);
  });

  it('is re-entrant for the same pid', () => {
    const root = makeProject();
    expect(tryAcquireWriterLock(root, 'daemon').kind).toBe('acquired');
    const again = tryAcquireWriterLock(root, 'fallback');
    expect(again.kind).toBe('acquired');
    releaseWriterLock(root);
  });

  it('reports taken when a live foreign pid holds the lock', () => {
    const root = makeProject();
    // A controlled child is portable; PID 1 is not reliably probeable on
    // Windows or inside restricted process namespaces.
    holder = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    if (!holder.pid) throw new Error('Failed to spawn writer-lock holder');
    fs.writeFileSync(
      getWriterPidPath(root),
      JSON.stringify({ pid: holder.pid, mode: 'direct', startedAt: Date.now() }) + '\n',
      { flag: 'wx' },
    );
    const r = tryAcquireWriterLock(root, 'direct');
    expect(r.kind).toBe('taken');
    if (r.kind === 'taken') {
      expect(r.existing?.pid).toBe(holder.pid);
      const msg = writerLockHeldMessage(r.existing, r.pidPath);
      expect(msg).toMatch(/writer lock held/i);
      expect(msg).toMatch(/AFYX_GRAPH_NO_DAEMON/);
      expect(msg).toMatch(/daemon stop/);
    }
  });

  it('clears a stale dead-pid lock and acquires', () => {
    const root = makeProject();
    // Pick a pid that is extremely unlikely to be alive.
    const deadPid = 2147483646;
    fs.writeFileSync(
      getWriterPidPath(root),
      JSON.stringify({ pid: deadPid, mode: 'direct', startedAt: Date.now() }) + '\n',
    );
    const r = tryAcquireWriterLock(root, 'direct');
    expect(r.kind).toBe('acquired');
    releaseWriterLock(root);
  });

  it('lets a fallback engine atomically claim and release writer ownership', () => {
    const root = makeProject();
    const engine = new MCPEngine({ writerLockRoot: root });

    expect(decodeWriterLockInfo(fs.readFileSync(getWriterPidPath(root), 'utf8'))).toMatchObject({
      pid: process.pid,
      mode: 'fallback',
    });

    engine.stop();
    expect(fs.existsSync(getWriterPidPath(root))).toBe(false);
  });

  it('rejects a fallback engine before opening when another process owns writer.pid', () => {
    const root = makeProject();
    holder = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    if (!holder.pid) throw new Error('Failed to spawn writer-lock holder');
    fs.writeFileSync(
      getWriterPidPath(root),
      JSON.stringify({ pid: holder.pid, mode: 'daemon', startedAt: Date.now() }) + '\n',
    );

    expect(() => new MCPEngine({ writerLockRoot: root })).toThrow(/writer lock held/i);
  });

  it('full reindex refuses live same-process and malformed ownership conservatively', () => {
    const root = makeProject();
    const pidPath = getWriterPidPath(root);
    const liveRecord = JSON.stringify({ pid: process.pid, mode: 'daemon', startedAt: 123 }) + '\n';
    fs.writeFileSync(pidPath, liveRecord);

    expect(tryAcquireFullReindexWriterLock(root)).toMatchObject({ kind: 'taken' });
    expect(fs.readFileSync(pidPath, 'utf8')).toBe(liveRecord);

    fs.writeFileSync(pidPath, '{ambiguous-owner}\n');
    expect(tryAcquireFullReindexWriterLock(root)).toMatchObject({ kind: 'taken', existing: null });
    expect(fs.readFileSync(pidPath, 'utf8')).toBe('{ambiguous-owner}\n');
  });

  it('full reindex only recovers a valid demonstrably-dead owner', () => {
    const root = makeProject();
    fs.writeFileSync(
      getWriterPidPath(root),
      JSON.stringify({ pid: 2147483646, mode: 'daemon', startedAt: 123 }) + '\n',
    );

    const claim = tryAcquireFullReindexWriterLock(root);
    expect(claim.kind).toBe('acquired');
    if (claim.kind === 'acquired') releaseWriterLockClaim(root, claim.info);
    expect(fs.existsSync(getWriterPidPath(root))).toBe(false);
  });

  it('full reindex releases its exact claim when the protected action throws', async () => {
    const root = makeProject();

    await expect(withFullReindexWriterLock(root, async () => {
      throw new Error('fixture failure');
    })).rejects.toThrow('fixture failure');

    expect(fs.existsSync(getWriterPidPath(root))).toBe(false);
    const next = tryAcquireFullReindexWriterLock(root);
    expect(next.kind).toBe('acquired');
    if (next.kind === 'acquired') releaseWriterLockClaim(root, next.info);
  });
});
