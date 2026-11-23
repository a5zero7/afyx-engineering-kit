/**
 * Deterministic WAL-policy scenarios, driven with vitest's fake timers so every scenario
 * is exact and takes no wall-clock time — the valve's only real-time dependency is a
 * `setInterval` tick, which fake timers replace with a controlled clock. Fake timers do
 * NOT fake the microtask queue, so a directly-invoked `check()`/`backpressure()`/`foldNow()`
 * (not run through the timer) is settled with `v.drain()`, not a timer advance; only the
 * `start()`-driven scenarios use `vi.advanceTimersByTimeAsync`, which does flush the
 * promises a fired timer callback creates.
 *
 * Every scenario returns a plain record: the call trace against the fake connection (see
 * `fake-connection.ts`), whether the returned promise settled and how, and any error
 * thrown — enough to pin the exact sequence of checkpoint decisions the old implementation
 * makes, not just its final answer.
 */
import { vi } from 'vitest';
import { FakeWalConnection, type Call } from './fake-connection';

const MB = 1024 * 1024;

/** Trace entries reduced to a compact, comparable shape. */
function callShape(call: Call): unknown {
  if (call.kind === 'getWalSizeBytes') return ['size', call.result];
  return [call.kind === 'checkpointWalPassive' ? 'passive' : 'truncate', call.result, call.walBytesAfter];
}

async function settle<T>(promise: Promise<T> | null): Promise<{ state: 'null' } | { state: 'resolved'; value: T } | { state: 'rejected'; error: string }> {
  if (promise === null) return { state: 'null' };
  try {
    const value = await promise;
    return { state: 'resolved', value };
  } catch (error) {
    return { state: 'rejected', error: (error as Error).message };
  }
}

/** Advance the fake clock by whole ticks, flushing the microtasks each tick's async work schedules. */
async function ticks(n: number, intervalMs: number): Promise<void> {
  for (let i = 0; i < n; i++) await vi.advanceTimersByTimeAsync(intervalMs);
}

export interface ScenarioResult {
  trace: unknown[];
  walBytesFinal: number;
  [key: string]: unknown;
}

/** Build a valve with a 1 MB soft threshold (hard = 2 MB, file cap = 4 MB) and a 100 ms tick. */
function makeValve(WalCheckpointValve: any, conn: FakeWalConnection, opts: { softMb?: number; intervalMs?: number; log?: (m: string) => void } = {}) {
  return new WalCheckpointValve(conn, opts.softMb ?? 1, opts.intervalMs ?? 100, opts.log ?? (() => {}));
}

export async function run(api: { WalCheckpointValve: any; WalValveAbortError: any; resolveWalValveMb: (env: string | undefined, dbSizeBytes?: number) => number }): Promise<Record<string, ScenarioResult>> {
  const { WalCheckpointValve } = api;
  const out: Record<string, ScenarioResult> = {};
  let current: FakeWalConnection;
  const record = async (name: string, fn: (c: FakeWalConnection) => Promise<Partial<ScenarioResult>>): Promise<void> => {
    vi.useFakeTimers();
    try {
      current = new FakeWalConnection();
      const extra = await fn(current);
      out[name] = { trace: current.calls.map(callShape), walBytesFinal: current.walBytes, ...extra };
    } finally {
      vi.useRealTimers();
    }
  };
  const passiveCalls = (c: FakeWalConnection) => c.calls.filter((x) => x.kind === 'checkpointWalPassive').length;
  const truncateCalls = (c: FakeWalConnection) => c.calls.filter((x) => x.kind === 'checkpointWalTruncate').length;

  // ---- resolveWalValveMb: env-var and dbSize-derived boundaries --------------------------------
  const mbCase = (name: string, env: string | undefined, dbSize?: number) => {
    out[name] = { trace: [], walBytesFinal: 0, value: api.resolveWalValveMb(env, dbSize) };
  };
  mbCase('resolveWalValveMb undefined', undefined);
  mbCase('resolveWalValveMb empty', '');
  mbCase('resolveWalValveMb zero', '0');
  mbCase('resolveWalValveMb negative', '-5');
  mbCase('resolveWalValveMb nan', 'not-a-number');
  mbCase('resolveWalValveMb one', '1');
  mbCase('resolveWalValveMb fractional', '12.9');
  mbCase('resolveWalValveMb large', '9999');
  mbCase('resolveWalValveMb dbSize small (below the 256 floor)', undefined, 10 * MB);
  mbCase('resolveWalValveMb dbSize mid (500)', undefined, 2000 * MB);
  mbCase('resolveWalValveMb dbSize huge (clamped to 2048)', undefined, 100_000 * MB);
  mbCase('resolveWalValveMb dbSize zero', undefined, 0);
  mbCase('resolveWalValveMb env overrides dbSize', '7', 100_000 * MB);

  // ---- check(): the soft-threshold fire decision, at the exact boundary ------------------------
  await record('check: WAL absent', async (c) => {
    c.walBytes = 0;
    makeValve(WalCheckpointValve, c).check();
    return { fired: passiveCalls(c) > 0 };
  });
  await record('check: growth below soft (soft-1)', async (c) => {
    c.walBytes = 1 * MB - 1;
    makeValve(WalCheckpointValve, c).check();
    return { fired: passiveCalls(c) > 0 };
  });
  await record('check: growth exactly at soft (not strictly greater — no fire)', async (c) => {
    c.walBytes = 1 * MB;
    makeValve(WalCheckpointValve, c).check();
    return { fired: passiveCalls(c) > 0 };
  });
  await record('check: growth soft+1 fires a passive checkpoint', async (c) => {
    c.walBytes = 1 * MB + 1;
    const v = makeValve(WalCheckpointValve, c);
    v.check();
    await v.drain();
    return { fired: passiveCalls(c) > 0 };
  });
  await record('check: a full passive backfill resets the baseline (growth back to 0)', async (c) => {
    c.walBytes = 2 * MB;
    const v = makeValve(WalCheckpointValve, c);
    v.check();
    await v.drain();
    v.check(); // immediately after: growth should now be 0 relative to the new baseline
    await v.drain();
    return { passiveCallsTotal: passiveCalls(c) };
  });
  await record('check: no second fire while one is inflight', async (c) => {
    c.walBytes = 3 * MB;
    c.queuePassive(() => new Promise(() => {})); // never resolves: stays "inflight" forever
    const v = makeValve(WalCheckpointValve, c);
    v.check();
    v.check(); // same tick, still inflight
    v.check();
    return { passiveCallsTotal: passiveCalls(c) };
  });
  await record('check: PASSIVE never truncates on its own (deliberate — would block an active writer)', async (c) => {
    c.walBytes = 5 * MB;
    const v = makeValve(WalCheckpointValve, c);
    v.check();
    await v.drain();
    return { truncateCallsTotal: truncateCalls(c), walAfter: c.walBytes };
  });

  // ---- start()/stop(): the timer, idempotency, and how ticks accumulate pressure ----------------
  await record('start: idempotent (a second start does not add a second timer)', async (c) => {
    c.walBytes = 2 * MB;
    const v = makeValve(WalCheckpointValve, c);
    v.start();
    v.start();
    await ticks(1, 100);
    v.stop();
    return { passiveCallsTotal: passiveCalls(c) };
  });
  await record('start: repeated pressure across several ticks, each above soft', async (c) => {
    c.walBytes = 3 * MB;
    const v = makeValve(WalCheckpointValve, c);
    v.start();
    await ticks(1, 100); // fires, fully backfills (default), baseline resets
    c.walBytes += 1 * MB + 500_000; // grows past soft again relative to the new baseline
    await ticks(1, 100);
    v.stop();
    return { passiveCallsTotal: passiveCalls(c) };
  });
  await record('start: below soft never fires across many ticks (idle database)', async (c) => {
    c.walBytes = 500_000;
    const v = makeValve(WalCheckpointValve, c);
    v.start();
    await ticks(10, 100);
    v.stop();
    return { passiveCallsTotal: passiveCalls(c) };
  });
  await record('stop: clears the timer so no further ticks fire', async (c) => {
    c.walBytes = 3 * MB;
    const v = makeValve(WalCheckpointValve, c);
    v.start();
    v.stop();
    await ticks(5, 100);
    return { passiveCallsTotal: passiveCalls(c) };
  });

  // ---- backpressure(): the two-dimensional hard-cap / file-cap gate, at exact boundaries --------
  const HARD = 2 * MB; const FILECAP = 4 * MB;
  await record('backpressure: under both caps returns null (no wait)', async (c) => {
    c.walBytes = 1.5 * MB;
    const v = makeValve(WalCheckpointValve, c);
    return { result: await settle(v.backpressure()) };
  });
  await record('backpressure: growth exactly at hard cap (inclusive) still returns null', async (c) => {
    c.walBytes = HARD; // growth == hardBytes, walBytes under file cap
    const v = makeValve(WalCheckpointValve, c);
    return { result: await settle(v.backpressure()) };
  });
  await record('backpressure: growth one byte over the hard cap pauses the writer', async (c) => {
    c.walBytes = HARD + 1;
    const v = makeValve(WalCheckpointValve, c);
    return { result: await settle(v.backpressure()) };
  });
  await record('backpressure: walBytes exactly at the file cap (inclusive) still returns null', async (c) => {
    // Establish a precise baseline first (an explicit, non-mutating truncate result so the
    // default truncate-shrinks-the-file behavior doesn't move walBytes out from under us),
    // then grow by a small amount so growth is far under hard while walBytes lands exactly
    // on the file cap — isolating the file-cap arm of the gate from the hard-cap arm.
    c.walBytes = FILECAP - 10_000;
    c.queueTruncate({ busy: 0, log: 1, checkpointed: 1 });
    const v = makeValve(WalCheckpointValve, c);
    await v.foldNow(); // baseline == FILECAP - 10_000 exactly; walBytes unchanged
    c.walBytes = FILECAP; // growth = 10_000 (well under hard); walBytes itself == FILECAP exactly
    return { result: await settle(v.backpressure()) };
  });
  await record('backpressure: walBytes one byte over the file cap pauses even though growth is small', async (c) => {
    c.walBytes = FILECAP - 10_000;
    c.queueTruncate({ busy: 0, log: 1, checkpointed: 1 });
    const v = makeValve(WalCheckpointValve, c);
    await v.foldNow();
    c.walBytes = FILECAP + 1; // growth still tiny; walBytes alone trips the file-cap arm
    return { result: await settle(v.backpressure()), passiveCallsTotal: passiveCalls(c), truncateCallsTotal: truncateCalls(c) };
  });
  await record('backpressure: a second call while already paused returns the SAME pending promise', async (c) => {
    c.walBytes = HARD + 1;
    c.queuePassive(() => new Promise(() => {})); // hang the first backfill pass
    const v = makeValve(WalCheckpointValve, c);
    const p1 = v.backpressure();
    const p2 = v.backpressure();
    return { samePromise: p1 === p2 };
  });
  await record('backpressure: resolves once the backfill drains (reader releases mid-wait)', async (c) => {
    c.walBytes = HARD + 1;
    c.queuePassive({ busy: 1, log: 10, checkpointed: 4 }); // pass 1: a reader still pins frames (partial)
    // pass 2 uses the default (full backfill) — the reader has "left".
    const v = makeValve(WalCheckpointValve, c);
    const result = await settle(v.backpressure());
    return { result, passiveCallsTotal: passiveCalls(c), truncateCallsTotal: truncateCalls(c) };
  });

  // ---- backfillFully via backpressure(): the bounded retry loop and its throwing outcomes -------
  await record('backfillFully (via backpressure): 19 partial passes then a full one on pass 20 succeeds', async (c) => {
    c.walBytes = HARD + 1; // over hard, so backpressure actually pauses
    for (let i = 0; i < 19; i++) c.queuePassive({ busy: 1, log: 10, checkpointed: 3 });
    // pass 20 uses the default full-backfill result.
    const v = makeValve(WalCheckpointValve, c);
    const result = await settle(v.backpressure());
    return { result, passiveCallsTotal: passiveCalls(c), truncateCallsTotal: truncateCalls(c) };
  });
  await record('backfillFully (via backpressure): fails closed after 20 give-ups over the hard cap alone', async (c) => {
    c.walBytes = HARD + 1; // over hard; under file cap (2MB+1 < 4MB) — isolates the hard-cap arm
    for (let i = 0; i < 25; i++) c.queuePassive({ busy: 1, log: 10, checkpointed: 3 }); // never a full backfill; only 20 are consumed
    const v = makeValve(WalCheckpointValve, c);
    const result = await settle(v.backpressure());
    return { result, passiveCallsTotal: passiveCalls(c) };
  });
  await record('backfillFully (via backpressure): fails closed after 20 give-ups over the file cap alone', async (c) => {
    // Baseline close to walBytes (via a controlled, non-mutating foldNow) so growth stays
    // well under the hard cap while walBytes alone stays over the file cap throughout.
    c.walBytes = FILECAP - 500_000;
    c.queueTruncate({ busy: 0, log: 1, checkpointed: 1 });
    const v = makeValve(WalCheckpointValve, c);
    await v.foldNow(); // baseline == FILECAP - 500_000
    c.walBytes = FILECAP + 1; // growth == 500_001 (well under hard = 2MB); walBytes alone over file cap
    for (let i = 0; i < 25; i++) c.queuePassive({ busy: 1, log: 10, checkpointed: 3 });
    const result = await settle(v.backpressure());
    return { result, passiveCallsTotal: passiveCalls(c) };
  });
  await record('backfillFully (via backpressure): machinery unavailable over the file cap fails closed immediately', async (c) => {
    c.walBytes = FILECAP + 1;
    c.queuePassive(null);
    const v = makeValve(WalCheckpointValve, c);
    const result = await settle(v.backpressure());
    return { result, passiveCallsTotal: passiveCalls(c) };
  });
  await record('backfillFully (via backpressure): machinery unavailable, file cap alone breached (growth stays small) still fails closed', async (c) => {
    // Isolates the `||` in the machinery-unavailable fail-closed check: growth alone would
    // NOT trip an `&&` version of that check, only the walBytes-over-file-cap arm does.
    c.walBytes = FILECAP - 500_000;
    c.queueTruncate({ busy: 0, log: 1, checkpointed: 1 });
    const v = makeValve(WalCheckpointValve, c);
    await v.foldNow(); // baseline == FILECAP - 500_000
    c.walBytes = FILECAP + 1; // growth == 500_001 (well under hard = 2MB); walBytes alone over file cap
    c.queuePassive(null); // machinery unavailable on the very first pass
    const result = await settle(v.backpressure());
    return { result, passiveCallsTotal: passiveCalls(c) };
  });
  await record('check: never fires while a backpressure pause is in flight', async (c) => {
    c.walBytes = HARD + 1;
    let release!: (r: unknown) => void;
    c.queuePassive(() => new Promise((resolve) => { release = resolve; }));
    const v = makeValve(WalCheckpointValve, c);
    const bp = v.backpressure(); // enters backfillFully; its first pass is the hung promise (pause is now set)
    v.check(); // must be a no-op: pause is set, even though inflight (a distinct field) is not
    const passiveAfterCheck = passiveCalls(c);
    release({ busy: 0, log: 5, checkpointed: 5 });
    await bp;
    return { passiveAfterCheck, passiveCallsTotal: passiveCalls(c) };
  });
  await record('backfillFully (via backpressure): an in-flight timer checkpoint is folded into the first pass', async (c) => {
    c.walBytes = 3 * MB;
    let releaseInflight!: (r: unknown) => void;
    c.queuePassive(() => new Promise((resolve) => { releaseInflight = resolve; }));
    const v = makeValve(WalCheckpointValve, c);
    v.check(); // starts the inflight pass (never resolves until we release it)
    const p = v.backpressure(); // growth (3MB) > hard (2MB): must enter backfillFully
    releaseInflight({ busy: 0, log: 5, checkpointed: 5 }); // let the stale inflight pass settle
    const result = await settle(p);
    return { result, passiveCallsTotal: passiveCalls(c), truncateCallsTotal: truncateCalls(c) };
  });

  // ---- backfillFully via foldNow(): the ONLY path a soft (non-throwing) give-up can occur, ------
  // since foldNow enters on any growth > 0 rather than growth/size already over a cap — see
  // the header comment on backfillFully ("soft give-up ... reserved for foldNow").
  await record('backfillFully (via foldNow): gives up softly after 20 partial passes on a modest backlog', async (c) => {
    c.walBytes = 500_000; // modest backlog: > 0 (so foldNow enters) but nowhere near hard/file caps
    for (let i = 0; i < 25; i++) c.queuePassive({ busy: 1, log: 10, checkpointed: 3 }); // never a full backfill
    const v = makeValve(WalCheckpointValve, c);
    const result = await settle(v.foldNow());
    return { result, passiveCallsTotal: passiveCalls(c) };
  });
  await record('backfillFully (via foldNow): machinery unavailable on a modest backlog softly returns, no throw', async (c) => {
    c.walBytes = 500_000;
    c.queuePassive(null);
    const v = makeValve(WalCheckpointValve, c);
    const result = await settle(v.foldNow());
    return { result, passiveCallsTotal: passiveCalls(c) };
  });
  await record('backfillFully (via foldNow): busy=0 but log!=checkpointed is NOT a false full-backfill', async (c) => {
    // Distinguishes the full-backfill test's two conjuncts: busy=0 alone is not enough —
    // every log frame must also be checkpointed, or this must keep looping (no truncate,
    // no baseline reset), not be treated as done after a single pass.
    c.walBytes = 500_000; // modest backlog: well under hard/file caps for the whole give-up loop
    for (let i = 0; i < 25; i++) c.queuePassive({ busy: 0, log: 10, checkpointed: 5 });
    const v = makeValve(WalCheckpointValve, c);
    const result = await settle(v.foldNow());
    return { result, passiveCallsTotal: passiveCalls(c), truncateCallsTotal: truncateCalls(c) };
  });
  await record('backfillFully (via foldNow): a backlog that IS over the hard cap still fails closed', async (c) => {
    c.walBytes = HARD + 1;
    for (let i = 0; i < 25; i++) c.queuePassive({ busy: 1, log: 10, checkpointed: 3 });
    const v = makeValve(WalCheckpointValve, c);
    const result = await settle(v.foldNow());
    return { result, passiveCallsTotal: passiveCalls(c) };
  });

  // ---- drain(): waiting out both pause and inflight -------------------------------------------
  await record('drain: resolves immediately when nothing is running', async (c) => {
    const v = makeValve(WalCheckpointValve, c);
    await v.drain();
    return { drained: true };
  });
  await record('drain: waits for an in-flight timer checkpoint', async (c) => {
    c.walBytes = 3 * MB;
    let release!: (r: unknown) => void;
    c.queuePassive(() => new Promise((resolve) => { release = resolve; }));
    const v = makeValve(WalCheckpointValve, c);
    v.check();
    let drained = false;
    const p = v.drain().then(() => { drained = true; });
    const stillWaiting = !drained;
    release({ busy: 0, log: 1, checkpointed: 1 });
    await p;
    return { stillWaiting, drainedAfterRelease: drained };
  });
  await record('drain: waits for a paused backpressure backfill (close-while-pressure-exists)', async (c) => {
    c.walBytes = HARD + 1;
    let release!: (r: unknown) => void;
    c.queuePassive(() => new Promise((resolve) => { release = resolve; }));
    const v = makeValve(WalCheckpointValve, c);
    const bp = v.backpressure();
    v.stop(); // "close while pressure exists": stop the timer without waiting
    let drained = false;
    const d = v.drain().then(() => { drained = true; });
    const stillWaiting = !drained;
    release({ busy: 0, log: 1, checkpointed: 1 });
    await Promise.all([bp, d]);
    return { stillWaiting, drainedAfterRelease: drained };
  });

  // ---- foldNow(): the phase-boundary fold ------------------------------------------------------
  await record('foldNow: no growth is a no-op (no checkpoint calls at all)', async (c) => {
    c.walBytes = 0;
    await makeValve(WalCheckpointValve, c).foldNow();
    return { passiveCallsTotal: passiveCalls(c) };
  });
  await record('foldNow: any growth (even under soft) triggers a full backfill', async (c) => {
    c.walBytes = 100; // far under the 1MB soft threshold
    await makeValve(WalCheckpointValve, c).foldNow();
    return { passiveCallsTotal: passiveCalls(c), truncateCallsTotal: truncateCalls(c) };
  });
  await record('foldNow: drains a prior in-flight timer pass first', async (c) => {
    c.walBytes = 3 * MB;
    let release!: (r: unknown) => void;
    c.queuePassive(() => new Promise((resolve) => { release = resolve; }));
    const v = makeValve(WalCheckpointValve, c);
    v.check();
    const f = v.foldNow();
    let done = false;
    f.then(() => { done = true; });
    const stillWaiting = !done;
    release({ busy: 0, log: 1, checkpointed: 1 });
    await f;
    return { stillWaiting, doneAfterRelease: done };
  });

  // ---- logging: the verbose/debug hooks are called, not required to be silent -------------------
  await record('log: a supplied log callback is invoked on a fired checkpoint', async (c) => {
    c.walBytes = 2 * MB;
    const messages: string[] = [];
    const v = makeValve(WalCheckpointValve, c, { log: (m) => messages.push(m) });
    v.check();
    await v.drain();
    return { anyLogged: messages.length > 0 };
  });

  return out;
}
