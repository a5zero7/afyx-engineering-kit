import { describe, expect, it } from 'vitest';
import AfyxGraphDefault, { AfyxGraph } from '../src';

describe('Afyx Graph public API', () => {
  it('exposes AfyxGraph through the named and default package APIs', () => {
    expect(AfyxGraphDefault).toBe(AfyxGraph);
  });
});
