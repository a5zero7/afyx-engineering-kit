import { describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AfyxGraph } from '../src';

describe('async initialization ownership', () => {
  it('closes an unpublished instance when initial indexing rejects', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-init-reject-'));
    const failure = new Error('initial indexing failed');
    let unpublished: AfyxGraph | undefined;
    const close = vi.spyOn(AfyxGraph.prototype, 'close');
    const index = vi.spyOn(AfyxGraph.prototype, 'indexAll').mockImplementationOnce(async function (this: AfyxGraph) {
      unpublished = this;
      throw failure;
    });
    try {
      await expect(AfyxGraph.init(root, { index: true })).rejects.toBe(failure);
      expect(close).toHaveBeenCalledExactlyOnceWith();
      // An open SQLite handle prevents this removal on Windows.
      fs.rmSync(root, { recursive: true });
      expect(fs.existsSync(root)).toBe(false);
    } finally {
      unpublished?.close();
      index.mockRestore();
      close.mockRestore();
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it('keeps a successfully initialized instance owned by the caller', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-init-owned-'));
    const close = vi.spyOn(AfyxGraph.prototype, 'close');
    let graph: AfyxGraph | undefined;
    try {
      graph = await AfyxGraph.init(root);
      expect(close).not.toHaveBeenCalled();
      expect(graph.getProjectRoot()).toBe(root);
    } finally {
      graph?.close();
      close.mockRestore();
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });
});
