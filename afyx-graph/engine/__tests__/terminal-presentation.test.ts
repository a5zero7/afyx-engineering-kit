import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const workerHarness = vi.hoisted(() => ({
  instances: [] as Array<{
    options: { workerData: { colors: boolean; startTime: number } };
    messages: unknown[];
    terminate: ReturnType<typeof vi.fn>;
    emit: (event: string, value?: unknown) => void;
  }>,
}));

vi.mock('worker_threads', () => ({
  Worker: class FakeWorker {
    readonly options: { workerData: { colors: boolean; startTime: number } };
    readonly messages: unknown[] = [];
    readonly terminate = vi.fn(() => Promise.resolve(0));
    private readonly listeners = new Map<string, Array<(value?: unknown) => void>>();

    constructor(_filename: string, options: { workerData: { colors: boolean; startTime: number } }) {
      this.options = options;
      workerHarness.instances.push(this);
    }

    on(event: string, listener: (value?: unknown) => void): this {
      const listeners = this.listeners.get(event) ?? [];
      listeners.push(listener);
      this.listeners.set(event, listeners);
      return this;
    }

    postMessage(message: unknown): void {
      this.messages.push(message);
      if ((message as { type?: string }).type === 'stop') {
        queueMicrotask(() => this.emit('message', { type: 'stopped' }));
      }
    }

    emit(event: string, value?: unknown): void {
      for (const listener of this.listeners.get(event) ?? []) listener(value);
    }
  },
}));

import { ansiColorsEnabled } from '../src/ui/color';
import { _resetGlyphsCache } from '../src/ui/glyphs';
import { createShimmerProgress } from '../src/ui/shimmer-progress';

const ORIGINAL_ARGV = [...process.argv];
const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_IS_TTY = process.stdout.isTTY;

function setTTY(value: boolean | undefined): void {
  Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value });
}

describe('terminal presentation ground truth', () => {
  beforeEach(() => {
    workerHarness.instances.length = 0;
    process.argv = ['node', 'afyx-graph'];
    process.env = { ...ORIGINAL_ENV };
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
    delete process.env.CI;
    delete process.env.AFYX_GRAPH_ASCII;
    delete process.env.AFYX_GRAPH_UNICODE;
    process.env.TERM = 'xterm-256color';
    setTTY(false);
    _resetGlyphsCache();
  });

  afterEach(() => {
    process.argv = [...ORIGINAL_ARGV];
    process.env = { ...ORIGINAL_ENV };
    setTTY(ORIGINAL_IS_TTY);
    _resetGlyphsCache();
    vi.restoreAllMocks();
  });

  it('applies explicit color controls before environment and TTY defaults', () => {
    process.env.FORCE_COLOR = '1';
    process.argv.push('--no-color');
    expect(ansiColorsEnabled()).toBe(false);

    process.argv = ['node', 'afyx-graph', '--color'];
    process.env.NO_COLOR = '1';
    expect(ansiColorsEnabled()).toBe(true);

    process.argv = ['node', 'afyx-graph'];
    expect(ansiColorsEnabled()).toBe(false);
    delete process.env.NO_COLOR;
    process.env.FORCE_COLOR = 'false';
    expect(ansiColorsEnabled()).toBe(false);
    process.env.FORCE_COLOR = '1';
    expect(ansiColorsEnabled()).toBe(true);
  });

  it('uses TTY and CI fallbacks without enabling dumb terminals', () => {
    setTTY(true);
    expect(ansiColorsEnabled()).toBe(true);
    process.env.TERM = 'dumb';
    expect(ansiColorsEnabled()).toBe(false);
    process.env.CI = '1';
    expect(ansiColorsEnabled()).toBe(true);
  });

  it('uses one plain line per phase and never starts a worker for non-TTY output', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const progress = createShimmerProgress();
    progress.onProgress({ phase: 'scanning', current: 1, total: 4 });
    progress.onProgress({ phase: 'scanning', current: 2, total: 4 });
    progress.onProgress({ phase: 'parsing', current: 1, total: 0 });
    await progress.stop();

    expect(workerHarness.instances).toHaveLength(0);
    expect(write.mock.calls.map(([value]) => value)).toEqual([
      'Scanning files...\n',
      'Parsing code...\n',
    ]);
  });

  it('sends bounded updates and tears down the worker after cancellation', async () => {
    setTTY(true);
    process.env.NO_COLOR = '1';
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const progress = createShimmerProgress();
    const worker = workerHarness.instances[0];
    expect(worker).toBeDefined();
    expect(worker?.options.workerData.colors).toBe(false);

    progress.onProgress({ phase: 'scanning', current: 1, total: 4 });
    progress.onProgress({ phase: 'parsing', current: 1200, total: 0 });
    await progress.stop();

    expect(worker?.messages).toEqual([
      { type: 'update', phase: 'scanning', phaseName: 'Scanning files', percent: 25, count: 0 },
      { type: 'update', phase: 'parsing', phaseName: 'Parsing code', percent: -1, count: 1200 },
      { type: 'stop' },
    ]);
    expect(worker?.terminate).toHaveBeenCalledTimes(1);
    expect(write.mock.calls.map(([value]) => String(value)).join('')).toMatch(/1[.,]200 found/);
  });

  it('makes repeated teardown idempotent and contains worker errors', async () => {
    setTTY(true);
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const progress = createShimmerProgress();
    const worker = workerHarness.instances[0];
    expect(worker).toBeDefined();

    worker?.emit('error', new Error('synthetic worker failure'));
    const firstStop = progress.stop();
    const secondStop = progress.stop();

    expect(secondStop).toBe(firstStop);
    await firstStop;
    expect(worker?.terminate).toHaveBeenCalledTimes(1);
    expect(worker?.messages).not.toContainEqual({ type: 'stop' });
  });
});
