# AFYX-295 — Actual worker interruption and safe lock recovery

Status: **IMPLEMENTED AND LOCALLY VALIDATED; EXACT-HEAD CI PENDING**

## Source and scope

AFYX-295 is stacked directly on AFYX-293 HEAD
`473e1efd3a3da4c926638e77ec898a3d66200cf9`. It changes only the optional
Graph–ACE execution boundary, deterministic interruption tests, focused lock
negative coverage, and current documentation. Graph remains standalone and ACE
remains explicit opt-in/default-OFF.

## Confirmed failure mechanism

AFYX-293 executed ACE in `worker_threads.Worker`, while AFYX-292 lock ownership
records `process.pid`. A worker thread and its parent have the same PID. A
deterministic real-worker test stopped execution after lock acquisition, before
session commit, and after session commit. In all three cases the Graph fallback
was exact, but the next ACE operation could not reclaim the stranded lock while
the parent remained alive and returned fallback instead of completing.

The old timeout path also started `worker.terminate()` without waiting for its
completion before reporting fallback. Therefore termination quiescence was not
independently established.

## Bounded correction

Optional ACE work now runs in an owned Node child process with a distinct OS
PID. Invocation uses the current trusted `process.execPath`, an argument array,
`shell: false`, hidden Windows console, and one bounded IPC channel. The parent
does not accept an operation result or timeout fallback until the child exits.
On timeout it force-terminates only that owned child and waits for the exit
event. If exit cannot be confirmed within the bounded termination grace period,
the consumer throws `ACE_TERMINATION_UNCONFIRMED` instead of claiming a safe
fallback while mutation might continue.

AFYX-292 recovery is otherwise unchanged: it reclaims only a same-host lock
whose distinct owner PID is proven absent. Live, foreign, malformed, cross-host,
and inconclusive ownership is not stolen. No lock age, TTL, PID-reuse guess, or
manual lock deletion is used.

## Deterministic evidence

The native integration test uses a dormant test-only checkpoint carried over
the owned IPC channel. It blocks the actual ACE child at three commit boundaries
without sleeps:

1. immediately after exclusive lock metadata is committed;
2. after original blob work but before session metadata rename; and
3. immediately after session metadata rename while the lock is still held.

Each case proves that the lock PID is the child PID and differs from the live
parent, timeout returns the exact Graph original, retry on the same state/owner/
session recovers the dead lock, prior committed content remains retrievable,
the interrupted original is exact, owned temporaries are reconciled, and no
lock remains. Existing process-level contention tests continue to prove that a
live owner is not stolen. Added negative cases preserve fully formed foreign and
cross-host/inconclusive lock evidence unchanged.

## Acceptance state

| Gate | Status | Evidence |
|---|---|---|
| `ACTUAL_WORKER_INTERRUPTION_REPRODUCTION` | PASS | Old worker-thread architecture failed deterministic retry at all three checkpoints |
| `LOCK_OWNER_TERMINATION_SAFETY` | PASS | Distinct child PID, confirmed exit, same-state recovery; live owner remains bounded by timeout |
| `TIMEOUT_QUIESCENCE_AND_FALLBACK` | PASS | Parent waits for child exit; exact Graph fallback; unconfirmed termination fails closed |
| `STATE_COMMIT_AND_EXACT_RECOVERY` | PASS | Pre/before/post-commit interruption retains previous commit and exact originals |
| `SECURITY_AND_NEGATIVE_CASES` | PASS | Foreign, malformed, cross-host, and inconclusive lock evidence preserved |
| `ACE_GRAPH_NONREGRESSION` | PASS | Focused and complete local suites plus real Graph E2E/build/package validation |
| `CROSS_PLATFORM_EXACT_HEAD` | NOT_RUN | Awaiting exact-head Windows/Linux/macOS Context Build and repository CI |

## Remaining boundary

Coordination remains local-machine only. Cross-host or unverifiable liveness
continues to require operator inspection. State remains local plaintext under
caller-owned filesystem access and retention. This work does not enable ACE by
default, alter Graph/MCP contracts, deploy an installed adapter, or authorize
merge or Alpha promotion.
