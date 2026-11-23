import { describe, it, expect } from 'vitest';
import { buildNodeTooOldBanner, isSupportedNodeVersion, MIN_NODE_VERSION } from '../src/bin/node-version-check';

describe('buildNodeTooOldBanner', () => {
  it('embeds the reported Node version in the header', () => {
    expect(buildNodeTooOldBanner('18.20.0')).toContain(
      'Unsupported Node.js version: 18.20.0'
    );
  });

  it('states the supported node:sqlite floor', () => {
    expect(MIN_NODE_VERSION).toBe('22.5.0');
    expect(buildNodeTooOldBanner('18.0.0')).toContain(
      `requires Node.js ${MIN_NODE_VERSION} or newer`
    );
  });

  it.each([
    ['20.19.0', false],
    ['22.4.1', false],
    ['22.5.0', true],
    ['22.12.0', true],
    ['24.0.0', true],
    ['invalid', false],
  ])('classifies %s deterministically', (version, supported) => {
    expect(isSupportedNodeVersion(version)).toBe(supported);
  });

  it('points users to Node 22 LTS via nvm and Homebrew', () => {
    const banner = buildNodeTooOldBanner('16.0.0');
    expect(banner).toContain('Node.js 22 LTS');
    expect(banner).toContain('nvm install 22');
    expect(banner).toContain('brew install node@22');
  });

  it('documents the AFYX_GRAPH_ALLOW_UNSAFE_NODE override', () => {
    expect(buildNodeTooOldBanner('18.0.0')).toContain('AFYX_GRAPH_ALLOW_UNSAFE_NODE=1');
  });
});
