import { describe, expect, it } from 'vitest';
import { extractNativeFacts } from '../src/extraction/native/fact-extractor';

/**
 * Synthetic stand-in for a minified dashboard bundle: one outer variable
 * initializer owns thousands of nested function bodies and semicolons on one
 * line. No client or third-party source is embedded in this fixture.
 */
function syntheticOneLineBundle(bindings: number): string {
  const body = Array.from(
    { length: bindings },
    (_, index) => `const v${index}=(()=>{return ${index};})();`,
  ).join('');
  return `const dashboard=(()=>{${body}return v0;})();export function read(){return dashboard;}`;
}

function syntheticOneLineClass(members: number): string {
  const body = Array.from(
    { length: members },
    (_, index) => `m${index}(){return helper(${index});}`,
  ).join('');
  return `export class Dashboard{${body}}function helper(value){return value;}`;
}

describe('Afyx-native long single-line JavaScript extraction', () => {
  it('keeps nested initializer scanning bounded and preserves declarations', () => {
    const source = syntheticOneLineBundle(3_000);
    expect(source).not.toContain('\n');

    const started = performance.now();
    const result = extractNativeFacts('synthetic-dashboard.js', source, 'javascript');
    const elapsedMs = performance.now() - started;

    expect(result.errors).toEqual([]);
    expect(result.nodes.some((node) => node.name === 'dashboard')).toBe(true);
    expect(result.nodes.some((node) => node.name === 'v2999')).toBe(true);
    expect(result.nodes.some((node) => node.name === 'read')).toBe(true);
    // The pre-fix quadratic scan measured ~9.2s for this fixture locally.
    // Five seconds leaves broad CI headroom while still guarding the defect.
    expect(elapsedMs).toBeLessThan(5_000);
  }, 10_000);

  it('keeps direct-member classification bounded on a one-line class', () => {
    const source = syntheticOneLineClass(3_000);
    const started = performance.now();
    const result = extractNativeFacts('synthetic-class.js', source, 'javascript');
    const elapsedMs = performance.now() - started;

    expect(result.errors).toEqual([]);
    expect(result.nodes.some((node) => node.name === 'Dashboard')).toBe(true);
    expect(result.nodes.some((node) => node.name === 'm2999')).toBe(true);
    expect(result.nodes.some((node) => node.name === 'helper')).toBe(true);
    expect(elapsedMs).toBeLessThan(5_000);
  }, 10_000);

  it('classifies an incomplete pathological line instead of hanging or passing cleanly', () => {
    const source = `const broken=${'('.repeat(3_000)}value;`;
    const started = performance.now();
    const result = extractNativeFacts('synthetic-incomplete.js', source, 'javascript');

    expect(performance.now() - started).toBeLessThan(5_000);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'native_incomplete_source',
        severity: 'warning',
      }),
    ]));
  }, 10_000);
});
