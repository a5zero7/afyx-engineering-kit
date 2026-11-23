import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createViewport } from '../ui/src/native/viewport';
import { HomeView } from '../ui/src/native/views';
import type { WireStats } from '../ui/src/lib/wire';
import type { WireDeadCode } from '../ui/src/lib/wire';
import {
  deadCodeHeadline,
  deadCodeScale,
  emptyMessage,
  summarizeDeadCode,
} from '../ui/src/lib/deadcode-model';
import { svgPixelSize } from '../ui/src/lib/export-image';

describe('native UI viewport', () => {
  let host: HTMLDivElement;
  let group: SVGGElement;

  beforeEach(() => {
    host = document.createElement('div');
    Object.defineProperty(host, 'getBoundingClientRect', {
      value: () => ({ width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600, x: 0, y: 0, toJSON() {} }),
    });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    svg.append(group);
    host.append(svg);
    document.body.append(host);
  });

  afterEach(() => host.remove());

  it('fits, resets and clamps wheel zoom to finite bounds', () => {
    const viewport = createViewport(host, group, { width: 1600, height: 900 }, { minScale: 0.4, maxScale: 2 });
    viewport.fit();
    expect(viewport.state.scale).toBeGreaterThanOrEqual(0.4);
    expect(viewport.state.scale).toBeLessThanOrEqual(2);
    host.dispatchEvent(new WheelEvent('wheel', { deltaY: -100_000, clientX: 400, clientY: 300, bubbles: true, cancelable: true }));
    expect(viewport.state.scale).toBe(2);
    expect(group.getAttribute('transform')).not.toContain('NaN');
    expect(group.getAttribute('transform')).not.toContain('Infinity');
    viewport.reset();
    expect(viewport.state).toEqual({ x: 0, y: 0, scale: 1 });
    viewport.dispose();
  });
});

describe('native UI index health', () => {
  it('renders independent health dimensions and aggregate skip reasons', () => {
    const host = document.createElement('div');
    const stats = {
      health: {
        gitFreshness: { state: 'UNKNOWN', detail: 'not a git working tree' },
        pendingChanges: { state: 'CURRENT', count: 0, source: 'watcher', added: null, modified: null, removed: null },
        extraction: { state: 'complete', accounting: {
          discovered: 9, eligible: 7, indexed: 6, skipped: 1, unsupported: 2, failed: 0,
          ignored: null, retry: { attemptedFiles: 0, recoveredFiles: 0, failedFiles: 0 },
          skippedReasons: { size_exceeded: 1 }, unsupportedExtensions: [{ ext: '.txt', count: 2 }],
          completedAt: 1_700_000_000_000,
          timings: { scanMs: 2, parseStoreMs: 3, resolutionLinkMs: 4, maintenanceMs: 5, totalMs: 14 },
        } },
        compatibility: { builtWithVersion: '1.0.0', builtWithExtractionVersion: 27, currentExtractionVersion: 27, reindexRecommended: false },
        pendingReferences: 0,
        watcher: { state: 'ENABLED', reason: null },
      },
    } as WireStats;

    const mounted = HomeView(host, stats);
    const text = host.textContent ?? '';
    expect(text).toContain('Index Health');
    expect(text).toContain('Git snapshotUNKNOWN');
    expect(text).toContain('6 indexed · 1 skipped · 2 unsupported · 0 failed');
    expect(text).toContain('Ignored pathsNOT ENUMERATED');
    expect(text).toContain('size_exceeded1');
    expect(text).toContain('parse/store 3ms');
    mounted.dispose();
  });
});

describe('native presentation models', () => {
  const deadCode = {
    rows: { total: 4, shown: 2, truncated: true, items: [] },
    groups: [
      { file: 'src/a.ts', generated: false, test: false, lines: 8, rows: [] },
      { file: 'src/b.ts', generated: false, test: false, lines: 5, rows: [] },
    ],
    candidates: 10,
    excluded: [{ reason: 'exported', count: 6, label: 'exported symbols' }],
    excludedTotal: 6,
    kinds: [],
    includeExported: false,
    includeTests: false,
    includeGenerated: false,
    bounded: false,
    corroborated: true,
    timing: { elapsedMs: 2 },
  } satisfies WireDeadCode;

  it('summarises dead-code arithmetic without changing public wording', () => {
    expect(summarizeDeadCode(deadCode)).toMatchObject({
      candidateCount: 10,
      excludedCount: 6,
      fileCount: 2,
      lineCount: 13,
      shownCount: 2,
      totalCount: 4,
      truncated: true,
    });
    expect(deadCodeHeadline(deadCode)).toBe('2 of 4 symbols in 2 files · 13 lines');
    expect(deadCodeScale(deadCode)).toBe(
      '10 symbols in this index carry no incoming reference at all; 6 of them were left off this list.',
    );
    expect(emptyMessage(deadCode)).toContain('Turn on "including exported"');
  });

  it('derives safe raster dimensions from explicit dimensions or viewBox', () => {
    expect(svgPixelSize('<svg width="320px" height="180"/>')).toEqual({ width: 320, height: 180 });
    expect(svgPixelSize('<svg viewBox="0 0 640 360"/>')).toEqual({ width: 640, height: 360 });
    expect(svgPixelSize('<not-svg width="999" height="999"/>')).toEqual({ width: 1, height: 1 });
    expect(svgPixelSize('<svg width="-4" height="NaN"/>')).toEqual({ width: 1, height: 1 });
  });
});
