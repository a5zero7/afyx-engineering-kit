/**
 * WAL / durability policy — facade.
 *
 * The implementation is split into a pure-math half and a stateful-orchestration half:
 *
 * - `wal-pressure.ts`: {@link resolveWalValveMb} and `WalPressure`, the soft/hard/file-cap
 *   threshold math and the growth-past-last-full-backfill baseline it's measured against.
 * - `wal-checkpoint-coordinator.ts`: `WalCheckpointCoordinator` (exported here as
 *   {@link WalCheckpointValve} — the name every caller already imports), the timer,
 *   in-flight/pause bookkeeping and the bounded backfill retry loop that decides WHEN and
 *   HOW to checkpoint.
 * - `wal-valve-errors.ts`: {@link WalValveAbortError}, the fail-closed signal (#1539).
 *
 * This module re-exports all three under their original names so nothing importing from
 * `./db/wal-valve` (or, outside this package, `./db` re-exporting it) needs to change.
 */

export { resolveWalValveMb } from './wal-pressure';
export { WalValveAbortError } from './wal-valve-errors';
export { WalCheckpointCoordinator as WalCheckpointValve } from './wal-checkpoint-coordinator';
