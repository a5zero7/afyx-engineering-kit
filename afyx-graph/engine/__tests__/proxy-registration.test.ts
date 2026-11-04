import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { connectWithHello } from '../src/mcp/proxy';
import { AfyxGraphPackageVersion } from '../src/mcp/version';

interface RegistrationHarness {
  endpoint: string;
  server: net.Server;
  clientHello: Promise<Record<string, unknown>>;
  acknowledge(overrides?: Record<string, unknown>): void;
  closeClient(): void;
}

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    try { cleanups.pop()!(); } catch { /* best-effort */ }
  }
});

async function registrationHarness(protocol: 1 | 2 = 2): Promise<RegistrationHarness> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-proxy-registration-'));
  const endpoint = process.platform === 'win32'
    ? `\\\\.\\pipe\\afyx-proxy-registration-${process.pid}-${randomUUID()}`
    : path.join(dir, 'daemon.sock');
  let resolveHello!: (value: Record<string, unknown>) => void;
  const clientHello = new Promise<Record<string, unknown>>((resolve) => { resolveHello = resolve; });
  let accepted: net.Socket | null = null;
  let hello: Record<string, unknown> | null = null;
  const server = net.createServer((socket) => {
    accepted = socket;
    socket.setEncoding('utf8');
    socket.write(JSON.stringify({
      afyxGraph: AfyxGraphPackageVersion,
      pid: process.pid,
      socketPath: endpoint,
      protocol,
    }) + '\n');
    let buffered = '';
    socket.on('data', (chunk: string) => {
      buffered += chunk;
      const newlineAt = buffered.indexOf('\n');
      if (newlineAt === -1 || hello) return;
      hello = JSON.parse(buffered.slice(0, newlineAt)) as Record<string, unknown>;
      resolveHello(hello);
    });
  });
  await new Promise<void>((resolve) => server.listen(endpoint, resolve));

  cleanups.push(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ } });
  cleanups.push(() => { try { server.close(); } catch { /* best-effort */ } });
  cleanups.push(() => { try { accepted?.destroy(); } catch { /* best-effort */ } });

  return {
    endpoint,
    server,
    clientHello,
    acknowledge(overrides = {}) {
      if (!accepted || !hello) throw new Error('client hello not received');
      accepted.write(JSON.stringify({
        afyx_graph_client_ready: 1,
        sessionId: hello.sessionId,
        daemonPid: process.pid,
        daemonStartedAt: 123456,
        activeClients: 1,
        ...overrides,
      }) + '\n');
    },
    closeClient() {
      accepted?.destroy();
    },
  };
}

describe('protocol-v2 daemon client registration', () => {
  it('preserves protocol-v1 compatibility without waiting for an acknowledgement', async () => {
    const harness = await registrationHarness(1);
    const result = await connectWithHello(harness.endpoint);
    expect(result).not.toBeNull();
    expect(result).not.toBe('version-mismatch');
    const hello = await harness.clientHello;
    expect(hello.afyx_graph_client).toBe(1);
    (result as net.Socket).destroy();
  });

  it('does not report attachment until the daemon acknowledges server-side registration', async () => {
    const harness = await registrationHarness();
    let settled = false;
    const connecting = connectWithHello(harness.endpoint).finally(() => { settled = true; });
    const hello = await harness.clientHello;

    expect(hello.afyx_graph_client).toBe(1);
    expect(hello.pid).toBe(process.pid);
    expect(typeof hello.sessionId).toBe('string');
    expect(settled).toBe(false);

    harness.acknowledge();
    const result = await connecting;
    expect(result).not.toBeNull();
    expect(result).not.toBe('version-mismatch');
    (result as net.Socket).destroy();
  });

  it('fails closed when the acknowledgement names another session', async () => {
    const harness = await registrationHarness();
    const connecting = connectWithHello(harness.endpoint);
    await harness.clientHello;
    harness.acknowledge({ sessionId: 'forged-other-session' });
    expect(await connecting).toBeNull();
  });

  it('fails closed when the connection disappears before registration completes', async () => {
    const harness = await registrationHarness();
    const connecting = connectWithHello(harness.endpoint);
    await harness.clientHello;
    harness.closeClient();
    expect(await connecting).toBeNull();
  });

  it('fails closed on a malformed registration acknowledgement', async () => {
    const harness = await registrationHarness();
    const connecting = connectWithHello(harness.endpoint);
    await harness.clientHello;
    harness.acknowledge({ activeClients: 0 });
    expect(await connecting).toBeNull();
  });
});
