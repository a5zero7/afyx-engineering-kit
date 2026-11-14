import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import configuration from '../ui/vite.config';

describe('native viewer build composition', () => {
  it('disables the build tool modulepreload runtime while retaining native modules', async () => {
    const previous = process.env.NODE_ENV;
    try {
      const config = await (typeof configuration === 'function'
        ? configuration({ command: 'build', mode: 'production' }) : configuration);
      expect(config.build?.modulePreload).toEqual({ polyfill: false });
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
    const html = readFileSync(join(import.meta.dirname, '../dist/viewer/index.html'), 'utf8');
    expect(html).toMatch(/<script\b[^>]*type="module"[^>]*src=/);
  });

  it('ships the viewer without the demonstrated Vite preload injection', () => {
    const assets = join(import.meta.dirname, '../dist/viewer/assets');
    const bundles = readdirSync(assets).filter(name => name.endsWith('.js'));
    expect(bundles).toHaveLength(1);
    const bundle = readFileSync(join(assets, bundles[0]), 'utf8');
    expect(bundle).not.toContain('document.createElement("link").relList');
    expect(bundle).not.toContain('vite/modulepreload-polyfill');
    expect(bundle).toContain('ApiFailure');
  });
});
