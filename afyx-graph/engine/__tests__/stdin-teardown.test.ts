/**
 * #799 — a socket-backed stdin that fails must shut the server down, not
 * orphan/busy-spin. treatStdinFailureAsShutdown is the shared guard.
 */
import { describe, it, expect } from 'vitest';
import { PassThrough } from 'stream';
import * as net from 'net';
import { treatStdinFailureAsShutdown } from '../src/mcp/stdin-teardown';

describe('treatStdinFailureAsShutdown (#799)', () => {
  it("treats a stdin 'error' (ECONNRESET/hangup) as a shutdown signal", () => {
    const s = new PassThrough();
    let calls = 0;
    treatStdinFailureAsShutdown(() => { calls++; }, s);

    // No extra 'error' listener would throw here — the guard registers one.
    s.emit('error', new Error('read ECONNRESET'));
    expect(calls).toBe(1);
  });

  it("also fires on 'end' and on 'close'", () => {
    for (const ev of ['end', 'close'] as const) {
      const s = new PassThrough();
      let calls = 0;
      treatStdinFailureAsShutdown(() => { calls++; }, s);
      s.emit(ev);
      expect(calls, `event ${ev}`).toBe(1);
    }
  });

  it('destroys the stream so a hung fd leaves epoll', () => {
    const s = new PassThrough();
    treatStdinFailureAsShutdown(() => { /* noop */ }, s);
    s.emit('error', new Error('boom'));
    expect(s.destroyed).toBe(true);
  });

  it('fires onTerminal at most once, even across error → close', () => {
    const s = new PassThrough();
    let calls = 0;
    treatStdinFailureAsShutdown(() => { calls++; }, s);
    s.emit('error', new Error('boom')); // fire() also destroys → emits 'close'
    s.emit('close');                    // must not double-fire
    s.emit('end');
    expect(calls).toBe(1);
  });

  it('removes all terminal listeners after settlement', () => {
    const s = new PassThrough();
    treatStdinFailureAsShutdown(() => { /* noop */ }, s);
    s.emit('end');
    for (const event of ['end', 'close', 'error'] as const) {
      expect(s.listenerCount(event), event).toBe(0);
    }
  });

  it('still terminates once when destroy throws', () => {
    const s = new PassThrough();
    s.destroy = (() => { throw new Error('destroy failed'); }) as typeof s.destroy;
    let calls = 0;
    treatStdinFailureAsShutdown(() => { calls++; }, s);
    expect(() => s.emit('error', new Error('socket failed'))).not.toThrow();
    s.emit('close');
    expect(calls).toBe(1);
  });

  it('handles an already-destroyed stream', () => {
    const s = new PassThrough();
    s.destroy();
    let calls = 0;
    treatStdinFailureAsShutdown(() => { calls++; }, s);
    s.emit('close');
    expect(calls).toBe(1);
  });

  it('settles a real socket-backed stream failure without leaking listeners', async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing TCP address');

    const accepted = new Promise<net.Socket>((resolve) => server.once('connection', resolve));
    const client = net.createConnection(address.port, '127.0.0.1');
    const socket = await accepted;
    const baselineListeners = Object.fromEntries(
      (['end', 'close', 'error'] as const).map((event) => [event, socket.listenerCount(event)]),
    );
    let calls = 0;
    treatStdinFailureAsShutdown(() => { calls++; }, socket);
    socket.destroy(new Error('read ECONNRESET'));
    await new Promise((resolve) => setImmediate(resolve));

    expect(calls).toBe(1);
    for (const event of ['end', 'close', 'error'] as const) {
      expect(socket.listenerCount(event), event).toBe(baselineListeners[event]);
    }
    client.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});
