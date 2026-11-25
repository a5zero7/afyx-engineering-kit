# AFYX-292 — Native ACE Multi-Process Coordination

Status: **IMPLEMENTED AND LOCALLY VALIDATED; EXACT-HEAD CI PENDING**

## Scope and source boundary

AFYX-292 is stacked directly on the accepted AFYX-291 benchmark HEAD
`c3d29fcdae020818370510d17286a80be686d649`. It changes only the standalone ACE
local-state implementation, its focused tests, descriptor, and documentation.
PR #84, PR #85, the ACE dogfood worktree, historical AFYX-291 evidence, Graph,
Headroom, Kit/runtime installations, and global configuration are unchanged.

The contract remains **Standalone by Design, Integrated by Contract**. No Graph,
MCP, Forge, provider, distributed-lock, authentication, or deployment adapter is
introduced.

## Root concurrency risks

The foundation used atomic temporary-file, `fsync`, and rename commits, but had
no exclusion between processes. Two constructors could race on the owner or
session manifest. Two writers could read one session revision and let the last
rename silently discard the other's content/provenance. Different sessions
could concurrently create the same shared content blob. A reader could also
observe contention between blob and session commits without a bounded policy.

Atomic replacement prevented truncated committed files; it did not prevent
lost updates or define abandoned-writer recovery.

## Coordination contract

ACE now uses one exclusive lock per absolute state root. This intentionally
serializes initialization, session metadata, shared content blobs, original
retrieval, and provenance reads. The synchronous public API remains unchanged;
`lockTimeoutMs` and `lockRetryMs` are optional bounded constructor controls with
defaults of 5,000 ms and 25 ms.

Acquisition creates `.ace-lock` atomically, then commits bounded `ace.lock/v1`
ownership metadata through a private temporary file inside that owned directory.
Metadata binds a random token to the canonical state-root hash, owner hash,
hostname, PID, and creation time. A concurrent process waits within the bounded
timeout while owner metadata is being committed. Release verifies the token and
exact artifact shape before removing only the owned lock files.

Contention returns deterministic `LOCK_TIMEOUT`. Recovery does not use age or a
PID-reuse guess. The portable Node process-presence check must prove that the
recorded PID is absent on the same host. If the host, metadata, or liveness
result is missing or inconclusive, ACE returns `LOCK_RECOVERY_UNSAFE` and
preserves the evidence for inspection. A present PID is treated as active even
when it may have been reused; reuse never authorizes automatic removal.

Recovery claim metadata is itself exclusive and process-bound, preventing two
reclaimers from removing a replacement owner's lock. Candidate and abandoned
artifacts are removed only after exact name, shape, state/owner binding, token,
and dead-process verification.

## Crash and integrity guarantees

- Session metadata remains last-commit-wins only inside the acquired lock; two
  cooperating writers cannot enter the mutation boundary together.
- A process killed before session rename leaves the prior session authoritative.
  Its new reference remains outside the session boundary and cannot be retrieved.
- Complete content temporaries are promoted only when their filename digest and
  bytes agree. A conflicting or corrupt artifact fails closed.
- Complete interrupted session temporaries are validated and removed; they are
  never promoted over committed metadata.
- Existing completed orphan blobs remain adoptable on retry after full content
  verification.
- Unknown, foreign, symlinked, malformed, or ambiguously owned artifacts are not
  silently removed.

## Focused evidence

`test/coordination.test.js` and its child-process fixture use deterministic file
barriers and actual OS processes. They cover:

1. simultaneous first initialization and two writers to one session;
2. different sessions sharing one content store;
3. retrieval blocked at the metadata-commit boundary;
4. bounded contention timeout;
5. hard-killed writer recovery, invisible uncommitted reference, and verified
   orphan adoption on retry;
6. release after an operation throws; and
7. invalid timeout bounds rejected before state creation; and
8. missing, malformed, and foreign lock metadata preserved fail-closed.

The focused coordination suite passed three consecutive local Windows runs
before the final input-bound regression was added; the final focused run passes
8/8. The complete ACE suite, clean build, original benchmark,
AFYX-291 comparative smoke, package smoke, and production dependency check also
pass locally. Exact-head three-OS CI remains the authoritative cross-platform
gate and is recorded on the Draft PR after execution.

## Acceptance state before exact-head CI

| Gate | Status | Evidence |
|---|---|---|
| `ACE_MULTI_PROCESS_EXCLUSION` | PASS | Concurrent initialization/session/shared-store child-process tests |
| `ACE_LOCK_LIFECYCLE` | PASS | Atomic lock creation, token-checked release, bounded timeout, fail-closed recovery |
| `ACE_CRASH_RECOVERY` | PASS | Killed writer at metadata boundary; prior commit intact; orphan verified on retry |
| `ACE_READ_INTEGRITY` | PASS | Contended read timeout, invisible uncommitted reference, exact recovery |
| `ACE_FOUNDATION_NONREGRESSION` | PASS | Complete local ACE suite and build |
| `ACE_BENCHMARK_NONREGRESSION` | PASS | Existing benchmark plus AFYX-291 smoke; historical evidence not regenerated |
| `ACE_CROSS_PLATFORM` | NOT_RUN | Exact-head Windows/Linux/macOS CI pending |

## Intentional limitations and next boundary

The lock is machine-local and exclusive; it is not a network/distributed lease.
A cross-host or unavailable/inconclusive PID presence check deliberately leaves
an abandoned lock blocked for operator inspection. Filesystem ACLs and
plaintext retention remain caller responsibilities. Real Graph–ACE/MCP integration still requires a
separate reviewed consumer lifecycle, state ownership, failure-isolation, and
rollout contract after this PR is accepted.
