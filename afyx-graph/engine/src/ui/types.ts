/**
 * AFYX Graph Engine - UI Worker Messaging Contracts
 *
 * Defines inter-thread messaging schemas between the main process and UI
 * background workers (such as progress and shimmer indicators).
 */

/** IPC messages dispatched from the main thread to a UI shimmer worker. */
export type ShimmerWorkerMessage =
  | {
      type: 'update';
      phase: string;
      phaseName: string;
      percent: number;
      count: number;
    }
  | {
      type: 'stop';
    };

/** IPC messages transmitted from a UI shimmer worker back to the main thread. */
export type ShimmerMainMessage =
  | {
      type: 'stopped';
    };
