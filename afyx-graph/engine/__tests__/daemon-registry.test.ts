import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import {
  getRegistryDir,
  isProcessAlive,
  registerDaemon,
  deregisterDaemon,
  listDaemons,
  listVerifiedDaemons,
  clearStaleDaemonArtifacts,
  stopDaemonAt,
  type DaemonRecord,
} from '../src/mcp/daemon-registry';
import {
  canonicalDaemonProjectRoot,
  daemonProjectComparisonKey,
  encodeLockInfo,
  getDaemonPidPath,
  getDaemonSocketPath,
} from '../src/mcp/daemon-paths';
import { releaseWriterLock, tryAcquireWriterLock } from '../src/mcp/writer-lock';

/** A pid that's guaranteed dead: spawn a trivial process, let it exit, reap it. */
async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ['-e', 'process.exit(0)']);
  const pid = child.pid!;
  await new Promise<void>((r) => child.on('exit', () => r()));
  await new Promise((r) => setTimeout(r, 50)); // let the OS reap it
  return pid;
}

function rec(root: string, pid: number, startedAt = Date.now()): DaemonRecord {
  return { root, pid, version: '1.0.0', socketPath: `${root}/.afyx-graph/daemon.sock`, startedAt };
}

describe('daemon-registry', () => {
  let tmpHome: string;
  let prevHome: string | undefined;
  let prevUserProfile: string | undefined;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-reg-home-'));
    prevHome = process.env.HOME;
    prevUserProfile = process.env.USERPROFILE;
    process.env.HOME = tmpHome; // os.homedir() honors HOME (POSIX) ...
    process.env.USERPROFILE = tmpHome; // ... and USERPROFILE (Windows)
    // Sanity: the registry must resolve under our temp home, or the test would
    // pollute the real ~/.afyx-graph.
    expect(getRegistryDir().startsWith(tmpHome)).toBe(true);
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    if (prevUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = prevUserProfile;
    try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('isProcessAlive', () => {
    it('is true for our own process and false for junk/dead pids', async () => {
      expect(isProcessAlive(process.pid)).toBe(true);
      expect(isProcessAlive(0)).toBe(false);
      expect(isProcessAlive(-1)).toBe(false);
      expect(isProcessAlive(NaN)).toBe(false);
      expect(isProcessAlive(await deadPid())).toBe(false);
    });
  });

  it('listDaemons returns [] when nothing is registered (no dir yet)', () => {
    expect(listDaemons()).toEqual([]);
  });

  it('register → list shows a live daemon; deregister removes it', () => {
    registerDaemon(rec('/proj/a', process.pid));
    const live = listDaemons();
    expect(live).toHaveLength(1);
    expect(live[0].root).toBe('/proj/a');
    expect(live[0].pid).toBe(process.pid);

    deregisterDaemon('/proj/a');
    expect(listDaemons()).toEqual([]);
  });

  it('prunes records whose process is dead', async () => {
    const dead = await deadPid();
    registerDaemon(rec('/proj/dead', dead));
    registerDaemon(rec('/proj/live', process.pid));

    const live = listDaemons();
    expect(live).toHaveLength(1);
    expect(live[0].root).toBe('/proj/live');

    // The dead record's file was deleted as a side effect.
    const remaining = fs.readdirSync(getRegistryDir()).filter((f) => f.endsWith('.json'));
    expect(remaining).toHaveLength(1);
  });

  it('peeking with prune:false leaves dead records on disk', async () => {
    const dead = await deadPid();
    registerDaemon(rec('/proj/dead', dead));
    expect(listDaemons({ prune: false })).toEqual([]); // dead is filtered from results
    // ...but the file survives for the caller to inspect.
    expect(fs.readdirSync(getRegistryDir()).filter((f) => f.endsWith('.json'))).toHaveLength(1);
  });

  it('lists multiple live daemons newest-first', () => {
    registerDaemon(rec('/proj/old', process.pid, 1000));
    registerDaemon(rec('/proj/new', process.pid, 2000));
    const live = listDaemons();
    expect(live.map((d) => d.root)).toEqual(['/proj/new', '/proj/old']);
  });

  it('keeps a registry entry whose socket hello matches its PID and version', async () => {
    const root = fs.mkdtempSync(path.join(tmpHome, 'verified-'));
    const socketPath = process.platform === 'win32'
      ? `\\\\.\\pipe\\cg-reg-${process.pid}-${Date.now()}`
      : path.join(tmpHome, 'verified.sock');
    const server = net.createServer((socket) => {
      socket.end(JSON.stringify({
        protocol: 1,
        pid: process.pid,
        afyxGraph: '1.5.0',
        socketPath,
      }) + '\n');
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });
    try {
      registerDaemon({ root, pid: process.pid, version: '1.5.0', socketPath, startedAt: 1 });
      expect((await listVerifiedDaemons()).map((d) => d.root)).toEqual([root]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('never signals or deletes ownership for a reused live PID when no matching daemon answers (#1553)', async () => {
    const root = fs.mkdtempSync(path.join(tmpHome, 'project-'));
    const pidPath = getDaemonPidPath(root);
    fs.mkdirSync(path.dirname(pidPath), { recursive: true });
    fs.writeFileSync(pidPath, encodeLockInfo({
      pid: process.pid,
      version: '1.5.0',
      socketPath: path.join(root, '.afyx-graph', 'missing.sock'),
      startedAt: Date.now() - 60_000,
    }));

    registerDaemon({
      root,
      pid: process.pid,
      version: '1.5.0',
      socketPath: path.join(root, '.afyx-graph', 'missing.sock'),
      startedAt: Date.now() - 60_000,
    });

    expect(await listVerifiedDaemons()).toEqual([]);
    const result = await stopDaemonAt(root);
    expect(result).toMatchObject({ pid: process.pid, outcome: 'unverified' });
    expect(isProcessAlive(process.pid)).toBe(true);
    expect(fs.readFileSync(pidPath, 'utf8')).toContain(`"pid": ${process.pid}`);
    expect(listDaemons({ prune: false })).toHaveLength(1);
  });

  it('preserves live discovery after a temporary identity-probe failure', async () => {
    const root = fs.mkdtempSync(path.join(tmpHome, 'probe-failure-'));
    registerDaemon({
      root,
      pid: process.pid,
      version: '1.5.0',
      socketPath: process.platform === 'win32'
        ? `\\\\.\\pipe\\afyx-missing-${process.pid}-${Date.now()}`
        : path.join(root, 'missing.sock'),
      startedAt: Date.now(),
    });

    expect(await listVerifiedDaemons()).toEqual([]);
    expect(listDaemons({ prune: false })).toHaveLength(1);
  });

  it('preserves a live legacy lock when stop cannot verify daemon identity', async () => {
    const root = fs.mkdtempSync(path.join(tmpHome, 'legacy-stop-'));
    const pidPath = getDaemonPidPath(root);
    fs.mkdirSync(path.dirname(pidPath), { recursive: true });
    fs.writeFileSync(pidPath, `${process.pid}\n`);

    const result = await stopDaemonAt(root);

    expect(result).toMatchObject({ pid: process.pid, outcome: 'unverified' });
    expect(fs.readFileSync(pidPath, 'utf8')).toBe(`${process.pid}\n`);
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it('preserves a replacement lock written while stale identity is probed', async () => {
    const root = fs.mkdtempSync(path.join(tmpHome, 'probe-race-'));
    const pidPath = getDaemonPidPath(root);
    const socketPath = process.platform === 'win32'
      ? `\\\\.\\pipe\\cg-race-old-${process.pid}-${Date.now()}`
      : path.join(tmpHome, 'probe-race-old.sock');
    const replacementSocketPath = process.platform === 'win32'
      ? `\\\\.\\pipe\\cg-race-new-${process.pid}-${Date.now()}`
      : path.join(tmpHome, 'probe-race-new.sock');
    let acceptConnection!: () => void;
    const connected = new Promise<void>((resolve) => { acceptConnection = resolve; });
    let acceptedSocket: net.Socket | null = null;
    const server = net.createServer((socket) => {
      acceptedSocket = socket;
      acceptConnection();
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });
    const original = encodeLockInfo({
      pid: process.pid,
      version: '1.5.0',
      socketPath,
      startedAt: 1,
    });
    const replacement = encodeLockInfo({
      pid: process.pid,
      version: '1.5.0',
      socketPath: replacementSocketPath,
      startedAt: 2,
    });
    fs.mkdirSync(path.dirname(pidPath), { recursive: true });
    fs.writeFileSync(pidPath, original);

    try {
      const clearing = clearStaleDaemonArtifacts(root);
      await connected;
      fs.writeFileSync(pidPath, replacement);
      acceptedSocket!.end('{"protocol":0}\n');

      expect(await clearing).toBe(false);
      expect(fs.readFileSync(pidPath, 'utf8')).toBe(replacement);
    } finally {
      acceptedSocket?.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('does not clean daemon artifacts while another writer owns the project', async () => {
    const root = fs.mkdtempSync(path.join(tmpHome, 'writer-claim-'));
    const pidPath = getDaemonPidPath(root);
    const lock = encodeLockInfo({
      pid: process.pid,
      version: '1.5.0',
      socketPath: path.join(root, '.afyx-graph', 'not-listening.sock'),
      startedAt: 1,
    });
    fs.mkdirSync(path.dirname(pidPath), { recursive: true });
    fs.writeFileSync(pidPath, lock);
    expect(tryAcquireWriterLock(root, 'daemon').kind).toBe('acquired');

    try {
      expect(await clearStaleDaemonArtifacts(root)).toBe(false);
      expect(fs.readFileSync(pidPath, 'utf8')).toBe(lock);
    } finally {
      releaseWriterLock(root);
    }
  });
});

describe.skipIf(process.platform !== 'win32')('Windows daemon registry project identity', () => {
  let tmpHome: string;
  let prevHome: string | undefined;
  let prevUserProfile: string | undefined;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-reg-win-home-'));
    prevHome = process.env.HOME;
    prevUserProfile = process.env.USERPROFILE;
    process.env.HOME = tmpHome;
    process.env.USERPROFILE = tmpHome;
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.HOME; else process.env.HOME = prevHome;
    if (prevUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = prevUserProfile;
    try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  function roots(): { root: string; alias: string } {
    const root = fs.mkdtempSync(path.join(tmpHome, 'CaseProject-'));
    const alias = root.replace(/^([A-Z]):/, (_, drive: string) => `${drive.toLowerCase()}:`);
    expect(alias).not.toBe(root);
    return { root, alias };
  }

  it('maps drive-case aliases to one registry identity for register, list, and deregister', () => {
    const { root, alias } = roots();
    expect(canonicalDaemonProjectRoot(alias)).toBe(canonicalDaemonProjectRoot(root));
    expect(daemonProjectComparisonKey(alias)).toBe(daemonProjectComparisonKey(root));

    const record = rec(root, process.pid, 101);
    registerDaemon(record);
    registerDaemon({ ...record, root: alias });

    expect(fs.readdirSync(getRegistryDir()).filter((name) => name.endsWith('.json'))).toHaveLength(1);
    expect(listDaemons()).toHaveLength(1);
    deregisterDaemon(alias);
    expect(listDaemons()).toEqual([]);
  });

  it('collapses duplicate legacy files only after their complete daemon identity agrees', async () => {
    const { root, alias } = roots();
    const socketPath = getDaemonSocketPath(root);
    const record = { root, pid: process.pid, version: '1.5.0', socketPath, startedAt: 202 };
    const server = net.createServer((socket) => {
      socket.end(JSON.stringify({
        protocol: 1,
        pid: record.pid,
        afyxGraph: record.version,
        socketPath,
      }) + '\n');
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });
    try {
      fs.mkdirSync(getRegistryDir(), { recursive: true });
      fs.writeFileSync(path.join(getRegistryDir(), 'legacy-upper.json'), JSON.stringify(record));
      fs.writeFileSync(path.join(getRegistryDir(), 'legacy-lower.json'), JSON.stringify({ ...record, root: alias }));

      expect(listDaemons({ prune: false })).toHaveLength(1);
      const verified = await listVerifiedDaemons({ prune: false, roots: [alias] });
      expect(verified).toHaveLength(1);
      expect(verified[0]).toMatchObject({ pid: record.pid, startedAt: record.startedAt, socketPath });
      // Legacy duplicates are discovery-only and are not broadly deleted.
      expect(fs.readdirSync(getRegistryDir()).filter((name) => name.endsWith('.json'))).toHaveLength(2);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('does not grant shutdown authority to a newer forged case-alias record', async () => {
    const { root, alias } = roots();
    const socketPath = getDaemonSocketPath(root);
    const valid = { root, pid: process.pid, version: '1.5.0', socketPath, startedAt: 303 };
    const forged = {
      ...valid,
      root: alias,
      socketPath: `\\\\.\\pipe\\afyx-forged-${process.pid}-${Date.now()}`,
      startedAt: 304,
    };
    const server = net.createServer((socket) => {
      socket.end(JSON.stringify({
        protocol: 1,
        pid: valid.pid,
        afyxGraph: valid.version,
        socketPath,
      }) + '\n');
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });
    try {
      fs.mkdirSync(getRegistryDir(), { recursive: true });
      fs.writeFileSync(path.join(getRegistryDir(), 'valid.json'), JSON.stringify(valid));
      fs.writeFileSync(path.join(getRegistryDir(), 'forged.json'), JSON.stringify(forged));

      expect(listDaemons({ prune: false })).toHaveLength(2);
      expect(await listVerifiedDaemons({ prune: false })).toHaveLength(1);
      expect(await stopDaemonAt(alias)).toMatchObject({ outcome: 'unverified', pid: process.pid });
      expect(isProcessAlive(process.pid)).toBe(true);
      expect(await listVerifiedDaemons({ prune: false })).toHaveLength(1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('keeps distinct real project identities separate', () => {
    const first = roots().root;
    const second = roots().root;
    registerDaemon(rec(first, process.pid, 1));
    registerDaemon(rec(second, process.pid, 2));
    expect(listDaemons().map((record) => daemonProjectComparisonKey(record.root))).toEqual([
      daemonProjectComparisonKey(second),
      daemonProjectComparisonKey(first),
    ]);
  });
});
