import { Worker } from 'worker_threads';
import * as path from 'path';
import { ansiColorsEnabled } from './color';
import { getGlyphs, type Glyphs } from './glyphs';
import type { ShimmerMainMessage, ShimmerWorkerMessage } from './types';

const PHASE_LABELS: Readonly<Record<string, string>> = {
  scanning: 'Scanning files',
  parsing: 'Parsing code',
  storing: 'Storing data',
  resolving: 'Resolving refs',
  linking: 'Linking dynamic dispatch',
};

const STOP_TIMEOUT_MS = 2_000;

export interface IndexProgress {
  phase: string;
  current: number;
  total: number;
}

export interface ShimmerProgress {
  onProgress: (progress: IndexProgress) => void;
  stop: () => Promise<void>;
}

class PhaseJournal {
  private phase = '';
  private label = '';
  private percent = -1;
  private count = 0;

  constructor(
    private readonly glyphs: Glyphs,
    private readonly color: boolean,
  ) {}

  update(progress: IndexProgress): ShimmerWorkerMessage {
    if (this.phase && this.phase !== progress.phase) this.flush();
    this.phase = progress.phase;
    this.label = PHASE_LABELS[progress.phase] ?? progress.phase;
    this.percent = progress.total > 0
      ? Math.round((progress.current / progress.total) * 100)
      : -1;
    this.count = progress.total <= 0 && progress.current > 0 ? progress.current : 0;
    return {
      type: 'update',
      phase: this.phase,
      phaseName: this.label,
      percent: this.percent,
      count: this.count,
    };
  }

  flush(): void {
    if (!this.label) return;
    const dim = this.color ? '\x1b[2m' : '';
    const green = this.color ? '\x1b[32m' : '';
    const reset = this.color ? '\x1b[0m' : '';
    const detail = this.percent >= 0
      ? ` ${this.glyphs.dash} done`
      : this.count > 0
        ? ` ${this.glyphs.dash} ${this.count.toLocaleString()} found`
        : '';
    process.stdout.write(
      `\r\x1b[K${dim}${this.glyphs.rail}${reset}  ${green}${this.glyphs.phaseDone}${reset} ${this.label}${detail}\n`,
    );
    this.label = '';
    this.percent = -1;
    this.count = 0;
  }
}

class AnimationWorker {
  private closed = false;
  private stopRequested = false;
  private readonly completion: Promise<void>;
  private finish!: () => void;
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly worker: Worker) {
    this.completion = new Promise<void>((resolve) => {
      this.finish = resolve;
    });
    worker.on('message', (message: ShimmerMainMessage) => {
      if (message.type === 'stopped') void this.terminate();
    });
    worker.on('error', () => void this.terminate());
    worker.on('exit', () => this.settle());
  }

  send(message: ShimmerWorkerMessage): void {
    if (!this.closed && !this.stopRequested) this.worker.postMessage(message);
  }

  stop(): Promise<void> {
    if (this.closed || this.stopRequested) return this.completion;
    this.stopRequested = true;
    this.timer = setTimeout(() => void this.terminate(), STOP_TIMEOUT_MS);
    try {
      this.worker.postMessage({ type: 'stop' } satisfies ShimmerWorkerMessage);
    } catch {
      void this.terminate();
    }
    return this.completion;
  }

  private async terminate(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.worker.terminate();
    } finally {
      this.settle();
    }
  }

  private settle(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.closed = true;
    this.finish();
  }
}

function createInteractiveProgress(): ShimmerProgress {
  const color = ansiColorsEnabled();
  const journal = new PhaseJournal(getGlyphs(), color);
  const animation = new AnimationWorker(new Worker(path.join(__dirname, 'shimmer-worker.js'), {
    workerData: { startTime: Date.now(), colors: color },
  }));
  let stopResult: Promise<void> | undefined;

  return {
    onProgress(progress) {
      animation.send(journal.update(progress));
    },
    stop() {
      stopResult ??= animation.stop().then(() => journal.flush());
      return stopResult;
    },
  };
}

function createPlainProgress(): ShimmerProgress {
  let previousPhase = '';
  return {
    onProgress(progress) {
      if (progress.phase === previousPhase) return;
      previousPhase = progress.phase;
      process.stdout.write(`${PHASE_LABELS[progress.phase] ?? progress.phase}...\n`);
    },
    stop: async () => undefined,
  };
}

export function createShimmerProgress(): ShimmerProgress {
  return process.stdout.isTTY === true ? createInteractiveProgress() : createPlainProgress();
}
