import { writeSync } from 'fs';
import { parentPort, workerData } from 'worker_threads';
import { getRawWriteGlyphs, type Glyphs } from './glyphs';
import type { ShimmerWorkerMessage } from './types';

const FRAME_INTERVAL_MS = 50;
const ANIMATION_STEP_MS = 150;
const BAR_WIDTH = 25;

interface WorkerOptions {
  startTime: number;
  colors?: boolean;
}

interface ProgressFrame {
  label: string;
  percent: number;
  count: number;
}

class TerminalPainter {
  private frame: ProgressFrame | undefined;

  constructor(
    private readonly glyphs: Glyphs,
    private readonly startedAt: number,
    private readonly colors: boolean,
  ) {}

  update(message: Extract<ShimmerWorkerMessage, { type: 'update' }>): void {
    this.frame = { label: message.phaseName, percent: message.percent, count: message.count };
  }

  draw(): void {
    if (!this.frame) return;
    const animationFrame = Math.floor((Date.now() - this.startedAt) / ANIMATION_STEP_MS);
    const spinnerIndex = Math.floor(animationFrame / 3) % this.glyphs.spinner.length;
    const spinner = this.glyphs.spinner[spinnerIndex] ?? this.glyphs.spinner[0] ?? '.';
    const dim = this.colors ? '\x1b[2m' : '';
    const reset = this.colors ? '\x1b[0m' : '';
    const accent = this.accent(animationFrame);
    const prefix = `${dim}${this.glyphs.rail}${reset}  ${accent}${spinner}${reset} ${this.frame.label}`;

    let body: string;
    if (this.frame.percent >= 0) {
      body = `${prefix}  ${this.progressBar(animationFrame, this.frame.percent)}  ${this.frame.percent}%`;
    } else if (this.frame.count > 0) {
      body = `${prefix}... ${this.frame.count.toLocaleString()} found`;
    } else {
      body = `${prefix}...`;
    }
    writeSync(1, `\r\x1b[K${body}`);
  }

  erase(): void {
    if (!this.frame) return;
    writeSync(1, '\r\x1b[K');
    this.frame = undefined;
  }

  private accent(frame: number): string {
    if (!this.colors) return '';
    const pulse = (Math.sin(frame * 2 * Math.PI / 13) + 1) / 2;
    return `${this.rgb(160, 100, 9, 251, 191, 36, pulse)}\x1b[1m`;
  }

  private progressBar(frame: number, percent: number): string {
    const filled = Math.round(BAR_WIDTH * percent / 100);
    const empty = BAR_WIDTH - filled;
    const dim = this.colors ? '\x1b[2m' : '';
    const reset = this.colors ? '\x1b[0m' : '';
    if (filled === 0) return `${dim}${this.glyphs.barEmpty.repeat(empty)}${reset}`;

    const shimmer = ((frame % 24) / 24) * (filled + 6) - 3;
    let result = '';
    for (let column = 0; column < filled; column += 1) {
      if (!this.colors) {
        result += this.glyphs.barFilled;
        continue;
      }
      const intensity = Math.max(0, 1 - Math.abs(column - shimmer) / 3);
      result += `${this.rgb(160, 100, 9, 251, 191, 36, intensity)}\x1b[1m${this.glyphs.barFilled}`;
    }
    return `${result}${reset}${dim}${this.glyphs.barEmpty.repeat(empty)}${reset}`;
  }

  private rgb(
    redStart: number,
    greenStart: number,
    blueStart: number,
    redEnd: number,
    greenEnd: number,
    blueEnd: number,
    position: number,
  ): string {
    const blend = (start: number, end: number): number => Math.round(start + (end - start) * position);
    return `\x1b[38;2;${blend(redStart, redEnd)};${blend(greenStart, greenEnd)};${blend(blueStart, blueEnd)}m`;
  }
}

if (!parentPort) throw new Error('shimmer worker requires a parent message port');
const channel = parentPort;

const options = workerData as WorkerOptions;
const painter = new TerminalPainter(
  getRawWriteGlyphs(),
  options.startTime,
  options.colors !== false,
);
let stopped = false;
const ticker = setInterval(() => painter.draw(), FRAME_INTERVAL_MS);

const shutdown = (): void => {
  if (stopped) return;
  stopped = true;
  clearInterval(ticker);
  painter.erase();
  channel.postMessage({ type: 'stopped' });
  channel.close();
};

channel.on('message', (message: ShimmerWorkerMessage) => {
  if (message.type === 'update') painter.update(message);
  else shutdown();
});
channel.on('close', () => {
  clearInterval(ticker);
  stopped = true;
});
