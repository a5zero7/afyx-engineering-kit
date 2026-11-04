import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync, spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { AfyxGraph } from '../src';
import { listVerifiedDaemons, stopDaemonAt } from '../src/mcp/daemon-registry';
import { classifyDaemonIpcError, decodeLockInfo, getDaemonPidPath, probeDaemonIdentity, type DaemonLockInfo } from '../src/mcp/daemon-paths';

const BIN = path.resolve(__dirname, '../dist/bin/afyx-graph.js');

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor<T>(read: () => T | null | false | Promise<T | null | false>, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await sleep(25);
  }
  throw new Error(`timed out after ${timeoutMs}ms`);
}

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function readLock(root: string): DaemonLockInfo | null {
  try { return decodeLockInfo(fs.readFileSync(getDaemonPidPath(root), 'utf8')); }
  catch { return null; }
}

async function connectActiveClient(lock: DaemonLockInfo): Promise<net.Socket> {
  const socket = net.createConnection(lock.socketPath);
  socket.setEncoding('utf8');
  await new Promise<void>((resolve, reject) => {
    let received = '';
    const timer = setTimeout(() => reject(new Error('daemon hello timeout')), 5_000);
    socket.on('data', (chunk: string) => {
      received += chunk;
      if (!received.includes('\n')) return;
      clearTimeout(timer);
      socket.write(JSON.stringify({ afyx_graph_client: 1, pid: process.pid, hostPid: process.pid }) + '\n');
      resolve();
    });
    socket.once('error', reject);
  });
  return socket;
}

describe('native daemon shutdown control', () => {
  let root: string;
  let home: string;
  let previousHome: string | undefined;
  let previousUserProfile: string | undefined;
  const children: ChildProcess[] = [];

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-daemon-shutdown-'));
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-daemon-home-'));
    previousHome = process.env.HOME;
    previousUserProfile = process.env.USERPROFILE;
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    const graph = await AfyxGraph.init(root);
    graph.close();
  });

  afterEach(async () => {
    for (const child of children) {
      if (child.exitCode === null && child.pid && isAlive(child.pid)) {
        try { child.kill('SIGKILL'); } catch { /* test cleanup only */ }
      }
    }
    children.length = 0;
    await sleep(50);
    if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
    if (previousUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = previousUserProfile;
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  });

  async function startDaemon(): Promise<{ child: ChildProcess; lock: DaemonLockInfo }> {
    const child = spawn(process.execPath, [BIN, 'serve', '--mcp', '--path', root], {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        AFYX_GRAPH_DAEMON_INTERNAL: '1',
        AFYX_GRAPH_DAEMON_IDLE_TIMEOUT_MS: '30000',
      },
    });
    children.push(child);
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    try {
      await waitFor(() => readLock(root), 20_000);
      const boundLock = await waitFor(async () => {
        const current = readLock(root);
        const lifecycleEndpointPublished = process.platform !== 'win32' || Boolean(current?.controlSocketPath);
        return current && lifecycleEndpointPublished && await probeDaemonIdentity(current) ? current : null;
      }, 20_000);
      return { child, lock: boundLock };
    } catch (err) {
      throw new Error(
        `${err instanceof Error ? err.message : String(err)}; childPid=${String(child.pid)}; ` +
        `exitCode=${String(child.exitCode)}; lock=${JSON.stringify(readLock(root))}; stderr=${stderr}`,
      );
    }
  }

  it('gracefully stops with an active MCP client, verifies exit, and reopens cleanly', async () => {
    const first = await startDaemon();
    if (process.platform === 'win32') {
      expect(first.lock.controlSocketPath).toMatch(/^\\\\\.\\pipe\\afyx-graph-[0-9a-f]+-control$/);
      expect(first.lock.controlSocketPath).not.toBe(first.lock.socketPath);
    } else {
      expect(first.lock.controlSocketPath).toBeUndefined();
    }
    const client = await connectActiveClient(first.lock);

    const stopped = await stopDaemonAt(root);
    expect(stopped).toMatchObject({ pid: first.lock.pid, outcome: 'term' });
    await waitFor(() => !isAlive(first.lock.pid));
    expect(fs.existsSync(getDaemonPidPath(root))).toBe(false);
    expect(client.destroyed).toBe(true);

    const db = new DatabaseSync(path.join(root, '.afyx-graph', 'afyx-graph.db'), { readOnly: true });
    try { expect(db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' }); }
    finally { db.close(); }

    const second = await startDaemon();
    expect(second.lock.pid).not.toBe(first.lock.pid);
    expect((await listVerifiedDaemons({ roots: [root] })).map((item) => item.pid)).toContain(second.lock.pid);
    expect((await stopDaemonAt(root)).outcome).toBe('term');
    await waitFor(() => !isAlive(second.lock.pid));
  }, 30_000);

  it('recovers current-root discovery when the global registry entry is missing', async () => {
    const running = await startDaemon();
    const registry = path.join(home, '.afyx-graph', 'daemons');
    fs.rmSync(registry, { recursive: true, force: true });

    const recovered = await listVerifiedDaemons({ roots: [root] });
    expect(recovered).toHaveLength(1);
    expect(recovered[0]?.pid).toBe(running.lock.pid);
    const listed = execFileSync(process.execPath, [BIN, 'daemon'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, HOME: home, USERPROFILE: home },
    });
    expect(listed).toContain(`pid ${running.lock.pid}`);
    expect((await stopDaemonAt(root)).outcome).toBe('term');
  }, 20_000);

  it('does not list a live PID whose daemon identity cannot be verified', () => {
    const pidPath = getDaemonPidPath(root);
    const missingSocket = process.platform === 'win32'
      ? `\\\\.\\pipe\\afyx-unverified-${process.pid}-${Date.now()}`
      : path.join(root, 'missing.sock');
    fs.writeFileSync(pidPath, JSON.stringify({
      pid: process.pid,
      version: '1.0.0',
      socketPath: missingSocket,
      startedAt: Date.now(),
    }));

    const listed = execFileSync(process.execPath, [BIN, 'daemon'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, HOME: home, USERPROFILE: home },
    });

    expect(listed).toContain('No verified Afyx Graph daemons are available.');
    expect(listed).toContain('ownership artifacts intact');
    expect(listed).not.toContain(`pid ${process.pid}`);
    expect(fs.existsSync(pidPath)).toBe(true);
  });

  it('classifies Windows permission refusal without treating the process as stopped', () => {
    const error = Object.assign(new Error('access denied'), { code: 'EPERM' });
    expect(classifyDaemonIpcError(error)).toEqual({
      outcome: 'permission-denied',
      detail: 'EPERM: access denied',
    });
  });

  it('does not report success or delete ownership when an acknowledged daemon stays alive', async () => {
    const socketPath = process.platform === 'win32'
      ? `\\\\.\\pipe\\afyx-stubborn-${process.pid}-${Date.now()}`
      : path.join(root, 'stubborn.sock');
    const startedAt = Date.now();
    const source = `
      const net = require('node:net');
      const socketPath = process.argv[1];
      const startedAt = Number(process.argv[2]);
      net.createServer((socket) => {
        socket.write(JSON.stringify({ afyxGraph: '1.0.0', pid: process.pid, socketPath, protocol: 1 }) + '\\n');
        socket.on('data', () => socket.write(JSON.stringify({ afyx_graph_control: 1, status: 'accepted', pid: process.pid, startedAt }) + '\\n'));
      }).listen(socketPath);
      setInterval(() => {}, 1000);
    `;
    const child = spawn(process.execPath, ['-e', source, socketPath, String(startedAt)], {
      stdio: 'ignore',
      windowsHide: true,
    });
    children.push(child);
    const lock: DaemonLockInfo = { pid: child.pid!, version: '1.0.0', socketPath, startedAt };
    fs.writeFileSync(getDaemonPidPath(root), JSON.stringify(lock));
    await waitFor(() => probeDaemonIdentity(lock));

    const result = await stopDaemonAt(root);
    expect(result).toMatchObject({ pid: child.pid, outcome: 'shutdown-failed' });
    expect(isAlive(child.pid!)).toBe(true);
    expect(decodeLockInfo(fs.readFileSync(getDaemonPidPath(root), 'utf8'))?.pid).toBe(child.pid);
  }, 15_000);
});
