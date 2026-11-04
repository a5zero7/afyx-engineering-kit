import { describe, expect, it } from 'vitest';
import { ProgressSilencePolicy } from '../src/mcp/watchdog-policy';
import { SettlementGate } from '../src/mcp/supervision-policy';

describe('Afyx supervision policy', () => {
  it('settles a terminal fan-in exactly once', () => {
    const gate = new SettlementGate();
    expect(gate.claim()).toBe(true);
    expect(gate.claim()).toBe(false);
  });

  it.each([0, 1, 2])('makes deterministic progress decisions (repetition %i)', () => {
    const policy = new ProgressSilencePolicy(100, 1_000, 'a', 0);
    expect(policy.deadline(100, 'b')).toBe('defer');
    expect(policy.deadline(200, 'b')).toBe('terminate-stalled');
  });

  it('resets the silence episode and healthy baseline on heartbeat', () => {
    const policy = new ProgressSilencePolicy(100, 1_000, 'a', 0);
    expect(policy.deadline(100, 'b')).toBe('defer');
    policy.heartbeat(150, 'c');
    expect(policy.deadline(250, 'd')).toBe('defer');
    expect(policy.deadline(350, 'd')).toBe('terminate-stalled');
  });

  it('terminates at the hard cap despite continuously changing samples', () => {
    const policy = new ProgressSilencePolicy(100, 300, 'a', 0);
    expect(policy.deadline(100, 'b')).toBe('defer');
    expect(policy.deadline(200, 'c')).toBe('defer');
    expect(policy.deadline(300, 'd')).toBe('terminate-hard-cap');
  });
});
