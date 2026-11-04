import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { describe, expect, it, vi } from 'vitest';
import { spawn, type ChildProcess } from 'child_process';
import { startWatchdogRuntime, type WatchdogRuntimeConfig } from '../src/mcp/watchdog-runtime';

const config: WatchdogRuntimeConfig = {
  childSource: 'process.exit(0)',
  timeoutMs: 100,
  checkMs: 20,
  capMs: 1_000,
  progressPaths: [],
};

function fakeChild(withStdin = true): {
  child: ChildProcess;
  stdin: PassThrough | null;
  kill: ReturnType<typeof vi.fn>;
  unref: ReturnType<typeof vi.fn>;
} {
  const child = new EventEmitter() as ChildProcess;
  const stdin = withStdin ? new PassThrough() : null;
  const kill = vi.fn(() => true);
  const unref = vi.fn();
  Object.assign(child, { stdin, kill, unref, pid: 12345 });
  return { child, stdin, kill, unref };
}

describe('watchdog runtime adapter', () => {
  it('degrades safely when spawn throws', () => {
    const spawnProcess = (() => { throw new Error('blocked'); }) as typeof spawn;
    expect(startWatchdogRuntime(config, { spawnProcess })).toBeNull();
  });

  it('kills an unusable child that has no heartbeat pipe', () => {
    const fake = fakeChild(false);
    const spawnProcess = (() => fake.child) as typeof spawn;
    expect(startWatchdogRuntime(config, { spawnProcess })).toBeNull();
    expect(fake.kill).toHaveBeenCalledOnce();
  });

  it('owns one unref heartbeat and tears child/stream down exactly once', () => {
    const fake = fakeChild();
    const spawnProcess = (() => fake.child) as typeof spawn;
    let tick: (() => void) | undefined;
    const timer = { unref: vi.fn() } as unknown as NodeJS.Timeout;
    const setIntervalFn = ((fn: () => void) => { tick = fn; return timer; }) as typeof setInterval;
    const clearIntervalFn = vi.fn() as unknown as typeof clearInterval;
    const write = vi.spyOn(fake.stdin!, 'write');
    const end = vi.spyOn(fake.stdin!, 'end');

    const handle = startWatchdogRuntime(config, { spawnProcess, setIntervalFn, clearIntervalFn });
    expect(handle).not.toBeNull();
    tick?.();
    expect(write).toHaveBeenCalledWith('\n');
    expect(timer.unref).toHaveBeenCalledOnce();
    expect(fake.unref).toHaveBeenCalledOnce();

    handle?.stop();
    handle?.stop();
    expect(clearIntervalFn).toHaveBeenCalledOnce();
    expect(end).toHaveBeenCalledOnce();
    expect(fake.kill).toHaveBeenCalledOnce();
  });

  it('absorbs heartbeat-stream errors after child death', () => {
    const fake = fakeChild();
    const spawnProcess = (() => fake.child) as typeof spawn;
    const handle = startWatchdogRuntime(config, { spawnProcess });
    expect(() => fake.stdin!.emit('error', new Error('EPIPE'))).not.toThrow();
    handle?.stop();
  });
});
