/**
 * Deterministic WAL / durability-policy contract: every state, threshold boundary,
 * checkpoint mode, error/failure path and shutdown case `WalCheckpointValve` can reach,
 * driven against a fake connection + vitest fake timers (see `wal-policy-contract/`) so
 * the result is exact and takes no wall-clock time. Golden recorded from the
 * implementation before replacement (Phase 3B.4C, main @ 7b50682); never regenerated to
 * make a change pass — only extended when a genuinely new case is added
 * (AFYX_WAL_POLICY_CONTRACT_WRITE=1).
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as walValve from '../src/db/wal-valve';
import { run } from './wal-policy-contract/scenarios';

const GOLDEN_PATH = path.join(__dirname, 'fixtures', 'wal-policy-contract.golden.json');

describe('WAL / durability policy contract', () => {
  it('matches the recorded contract across every state, threshold and failure scenario', async () => {
    const actual = await run({
      WalCheckpointValve: walValve.WalCheckpointValve,
      WalValveAbortError: walValve.WalValveAbortError,
      resolveWalValveMb: walValve.resolveWalValveMb,
    });

    if (process.env.AFYX_WAL_POLICY_CONTRACT_WRITE === '1') {
      fs.mkdirSync(path.dirname(GOLDEN_PATH), { recursive: true });
      fs.writeFileSync(GOLDEN_PATH, JSON.stringify(actual, null, 2) + '\n');
      return;
    }
    const golden = JSON.parse(fs.readFileSync(GOLDEN_PATH, 'utf8'));
    expect(actual).toEqual(golden);
  });
});
