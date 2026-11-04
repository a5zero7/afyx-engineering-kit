import { describe, expect, it } from 'vitest';
import { afyxTerminal, TERMINAL_CANCEL } from '../src/runtime/terminal';

describe('Afyx terminal non-interactive contract', () => {
  it('uses explicit defaults without waiting for redirected input', async () => {
    expect(await afyxTerminal.select({
      message: 'pick',
      options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }],
      initialValue: 'b',
    })).toBe('b');
    expect(await afyxTerminal.multiselect({
      message: 'pick many',
      options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }],
      initialValues: ['a'],
    })).toEqual([]);
    expect(await afyxTerminal.confirm({ message: 'continue?', initialValue: true })).toBe(true);
  });

  it('uses the first choice only when no explicit select default exists', async () => {
    expect(await afyxTerminal.select({
      message: 'pick',
      options: [{ value: 'safe', label: 'Safe' }],
    })).toBe('safe');
  });

  it('recognizes only the private cancellation sentinel', () => {
    expect(afyxTerminal.isCancel(TERMINAL_CANCEL)).toBe(true);
    expect(afyxTerminal.isCancel(Symbol('other'))).toBe(false);
    expect(afyxTerminal.isCancel('cancel')).toBe(false);
  });
});
