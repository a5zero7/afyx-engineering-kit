# AFYX-64 Phase 8 real-engineering dogfood

Date: 2026-10-24

This increment evaluates engineering outcomes, not Graph availability alone. It
uses one public Afyx task and one owner-private application task. Private source,
repository identity, business data, and the full patch remain local-only.

## Product increment

The optional Graph–ACE consumer now bypasses ACE for source-bearing and
diagnostic Graph tools after validating project/source identity and state-path
separation. The authoritative Graph result is cloned and returned byte-for-byte;
the ACE runner is not called and no ACE state is created. Normal reducible
content keeps the existing explicit opt-in behavior, recovery integrity,
owner/session boundaries, bounded worker lifecycle, and exact-result fallback.
ACE remains default OFF and Graph remains standalone.

## Engineering cases

### Case A — Afyx Graph–ACE protected-output optimization

The task was to locate the smallest safe change and its affected validation for
removing useless ACE worker/state overhead from protected Graph output.

- CONTROL used two targeted searches and one source-range read on the clean
  integration baseline. Discovery command time was 222.884 ms.
- TREATMENT used one Afyx Graph exploration. It returned 60 symbols across six
  files, the consumer/fallback/classification relationships, script callers, and
  the focused test path in one response. Observed tool wall time was 1.9 s.
- Both conditions reached the same five-file implementation boundary. Treatment
  made the caller/test blast radius explicit but was slower and returned more
  context than the direct known-symbol route.
- The resulting regression proves zero ACE calls, no ACE state directory,
  exact Graph result preservation, and unchanged failure fallback behavior.

### Case B — owner-private Next.js/SQLite build failure

The task started from a reproducible production build failure during parallel
page-data collection. The source worktree was never modified; CONTROL and
TREATMENT used clean task-owned clones at the same revision and independent
database files.

- Root cause: parallel build workers evaluated module-level SQLite WAL/schema
  initialization without a busy timeout, causing immediate lock failure.
- Both conditions produced the same one-file correction: configure a bounded
  SQLite busy timeout before WAL/schema initialization.
- CONTROL used three targeted searches and one file-range read.
- TREATMENT used a task-local Afyx Graph 1.0.0 index (34 files, 443 nodes,
  857 edges), two explore calls, and one affected-test call. It reported 12
  dependents and no existing affected tests. One irrelevant module was returned,
  so a second focused exploration was required.
- CONTROL validation: lint PASS; production build PASS with nine workers in
  21,008.357 ms.
- TREATMENT validation: lint PASS; production build PASS with nine workers in
  21,232.803 ms.

The private case's raw identity and patch evidence remains local-only. Its local
evidence manifest SHA-256 is
`33C59769E5500D6E17E0C6D2CE68D8C079FFC264E4DA42236C141D016F90CE6C`.

## Findings

- Correctness and task completion were equivalent in both conditions.
- Graph materially improved explicit impact awareness for unfamiliar cross-file
  code. It did not improve validation duration and did not outperform direct
  inspection for the known-symbol Afyx task.
- Graph retrieval on the private case contained one irrelevant file and needed
  query refinement. This is an optimization signal, not a demonstrated
  correctness defect.
- After indexing an uncommitted patch, Graph truthfully reported filesystem
  content CURRENT while the Git snapshot remained STALE. No stale content was
  used for the engineering decision.
- Provider/billing token counts were unavailable. No token-saving or superiority
  claim is made. Tool-call counts and observed command durations are the measured
  cost evidence.
- Human intervention was zero. Agent-only lab setup required replacing an
  unsupported dependency junction with a task-local dependency copy; this did
  not affect either source result.

This is one historical Phase 8 increment. Full representative workload
closure is documented below.

## Phase 8 representative workload closure increment

Date: 2026-10-31

Baseline: `65576c82000fabe6760a6113546c3540fd3eaa63` (`dev`)

Evidence: `docs/evidence/afyx-64/phase8-representative-dogfood-closure-20261031.json`

Deterministic fixture identity:
`sha256:d10af6b6bea7ff3f5973b7dbc071cd25dbe397fa5b4bbbfae8c4f0a0049deb33` (20 files)

### Representative workload cases

1. **Known File or Symbol Lookup (`AccountMove` in `account_move.py`):**
   - Direct source: Cold 4.555 ms, Warm 1.227 ms, 107 tokens (CORRECT).
   - Afyx Graph: Cold 144.084 ms, Warm 1.263 ms, 98 tokens (CORRECT).
   - Routing verdict: **DIRECT_SOURCE_PREFERRED** (lowest latency and overhead; identical correctness).
2. **Cross-Module Dependency Analysis (`action_post` & `base_accounting` callers):**
   - Direct source: Cold 13.530 ms, Warm 12.821 ms, 58 tokens (HEURISTIC text search, prone to generic method false positives).
   - Afyx Graph: Cold 46.043 ms, Warm 21.718 ms, 891 tokens (STRUCTURALLY_EXACT caller graph).
   - Routing verdict: **GRAPH_PREFERRED** (eliminates false positives and maps architectural boundaries).
3. **Odoo-like Inheritance and Relationship Analysis (`_inherit = "sale.order"` and views):**
   - Direct source: Cold 10.313 ms, Warm 8.725 ms, 34 tokens (PARTIAL regex).
   - Afyx Graph: Cold 3.818 ms, Warm 1.644 ms, 292 tokens (COMPLETE_DECLARATION inventory guarantee).
   - Routing verdict: **GRAPH_PREFERRED** (authoritative declaration completeness guarantee).
4. **Impact Analysis and Affected-Test Selection (`SaleOrder` modification):**
   - Direct source: Cold 5.099 ms, Warm 2.371 ms, 19 tokens (MANUAL heuristic test guess).
   - Afyx Graph: Cold 22.022 ms, Warm 19.754 ms, 667 tokens (TRANSITIVE_IMPACT detects `test_sale_enterprise.py`).
   - Routing verdict: **GRAPH_PREFERRED** (targeted regression suite selection without manual guesswork).
5. **Stale, Incomplete, and Unsupported Index Coverage:**
   - Filesystem unindexed patch detected immediately by direct source; Graph truthfully refrains from hallucinating and preserves fail-closed integrity.
   - Routing verdict: **FAIL_CLOSED_CORRECT** (direct source ground truth remains authoritative on stale/unindexed content).

### Context Engine (ACE) independent evaluation

- **Default OFF policy:** PASS (zero worker spawned, zero state files, exact byte-for-byte Graph result).
- **Explicit opt-in:** PASS (repeated queries optimized with stable reference hashes).
- **Byte-exact recovery:** PASS (100% bit-for-bit exact original content recovered).
- **Safe fallback:** PASS (timeout, interruption, malformed input, and foreign sessions fall back cleanly without orphan locks).
- **Protected tool bypass:** PASS (`afyx_graph_explore` and diagnostic tools bypass ACE unconditionally).

### Acceptance matrix

| Gate | Verdict | Note |
|---|---|---|
| `P08-1_KNOWN_SYMBOL_ROUTING` | PASS | Direct source preferred for known location lookup |
| `P08-2_CROSS_MODULE_ANALYSIS` | PASS | Graph preferred for cross-module callers |
| `P08-3_ODOO_INHERITANCE_INVENTORY` | PASS | Graph preferred for Odoo literal inheritance |
| `P08-4_IMPACT_TEST_SELECTION` | PASS | Graph preferred for transitive test selection |
| `P08-5_STALE_COVERAGE_TRUTHFULNESS` | PASS | Direct source authoritative; Graph fail-closed |
| `P08-6_ACE_DEFAULT_OFF` | PASS | Zero overhead when disabled |
| `P08-7_ACE_EXPLICIT_OPTIN` | PASS | Deduplication on repeated queries |
| `P08-8_ACE_BYTE_EXACT_RECOVERY` | PASS | Exact original recovery verified |
| `P08-9_ACE_SAFE_FALLBACK` | PASS | Bounded fallback on timeout/interruption |
| `P08-10_ENGINEERING_CORRECTNESS_FIRST` | PASS | Correctness verified before cost accounting |
| `P08-11_OBSERVED_COST_INTEGRITY` | PASS | Measured wall time and context tokens; no speculative billing claims |
| `P08-12_CROSS_PLATFORM_CI` | NOT_RUN | Requires separately authorized public push |
| `P08-13_FORGE_PRODUCTION_BENCHMARK` | BLOCKED | Bounded by Forge A8 governance boundary |

