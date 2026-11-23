# Phase 5E — Native Optimization & Simplification

Task: `AFYX-84627`  
Date: 2026-10-03  
Canonical baseline: `f683b0225ee8e805fcd7b9ea98bea88574cf61f4`  
Branch: `afyx/native-phase5e-optimization`

## Method

Phase 5E measured the merged Afyx-native runtime, domain core, and product
surfaces before considering changes. Product behavior was not changed to win a
benchmark. Raw artifacts are scratch data under the local temporary directory;
this document keeps only commands, environment, contract digests, and decisions.

Environment:

- Windows x64, Node `v26.7.0`, Git `2.55.0.windows.3`;
- 12 logical CPUs;
- `AFYX_GRAPH_NO_WATCH=1`, `AFYX_GRAPH_NO_DAEMON=1`, and
  `AFYX_GRAPH_ALLOW_UNSAFE_NODE=1` are set by the broad/context harnesses;
- no local release archive existed, so bundle size is `NOT AVAILABLE` rather
  than synthesized or downloaded.

Commands:

```text
npx tsc --noEmit
npm run build:clean
node scripts/benchmark.mjs --files 300 --runs 5 --out <scratch>/baseline-broad-controlled.json
node scripts/benchmark-context.mjs --files 240 --rounds 9 --out <scratch>/baseline-context-controlled.json
node scripts/benchmark-extraction.mjs --rounds 15 --out <scratch>/baseline-extraction.json
node scripts/benchmark-mcp.mjs --bin <dist-cli> --project <indexed-repository> --rounds 5 --out <scratch>/baseline-mcp.json
```

Broad and context runs are sequential. A parallel trial was rejected because
the two SQLite/CPU workloads contended and produced uniformly inflated latency.

## Baseline

The controlled broad fixture contained 301 files, 2,373 nodes, and 5,435 edges.
The database was 3.49 MB and built `dist/` was 74.89 MB.

| Metric | Median | Contract evidence |
| --- | ---: | --- |
| Cold index | 2,470.80 ms | 301 files / 2,373 nodes / 5,435 edges |
| Cold index peak RSS | 351.60 MB | same fixture |
| Warm sync, five files | 1,020.87 ms | same indexed fixture |
| Search | 6.28 ms | 20 results |
| Callers | 0.05 ms | 2 results |
| Callees | 0.04 ms | 2 results |
| Impact | 0.06 ms | 5 nodes |
| Dependents | 0.02 ms | 2 results |
| Context | 40.75 ms | stable result counts |
| MCP initialize | 509.26 ms | protocol contract unchanged |
| MCP first result | 1,501.11 ms | tool result contract unchanged |

The repository MCP fixture separated cold readiness from steady state: initialize
452.17 ms, tools/list 1,162.15 ms, first valid call 589.70 ms, repeated valid
call 1.08 ms, and shutdown 12.63 ms (five-run medians). Payloads were 6,664,
3,743, 230, 93, 127, and 230 bytes for initialize, tools/list, valid call,
invalid tool, invalid arguments, and repeated call respectively.

Extraction reconciliation was already bounded: the 2,000-file cases measured
2.39–5.91 ms median and retained stable result digests.

## Optimization inventory

| Candidate | Observed cost or complexity | Correctness invariant | Measurement | Decision |
| --- | --- | --- | --- | --- |
| Broad harness MCP shutdown | Windows resolved the sample before the child released SQLite, causing `ERR_SQLITE_ERROR` in warm sync | every MCP child is closed before the next DB owner opens | 30×1 smoke and 300×5 broad run | **KEEP** |
| Broad benchmark spread | Only medians hid variance | no workload or result change | report p95 beside median | **KEEP** |
| Context payload observability | Response/source/range duplication was not recorded | digest and selected context unchanged | context harness digest and byte/range fields | **KEEP** |
| Context infix-channel query consolidation | SQLite reads dominate long prose/dedup cases | type/callable fairness and prefix/compound ranking | CPU profile plus context digests | **NO_CHANGE** |
| Cross-request context cache | repeated identical calls are measurable | explicit invalidation after every index mutation | architecture review | **NO_CHANGE** |
| MCP readiness/catch-up | cold list/first call dominate; repeat call is ~1 ms | never serve known-stale rows, bounded first-call wait | MCP five-round lifecycle | **NO_CHANGE** |
| Extraction, graph point reads, installer/UI plan paths | already bounded or off the material hot path | existing semantic/public contracts | broad and focused measurements | **NO_CHANGE** |
| Node/runtime, parser dependencies, WASM grammars, optional kernel | dominate distribution footprint | parser/language coverage and cross-platform runtime | artifact inventory | **DEFER_5F** |

No production cache, concurrency, DB, graph, context, MCP, installer, or UI
change survived this inventory. The tempting context query merge was rejected
before code mutation: its separate result pools protect ranking fairness, and a
generic cross-request cache would add invalidation complexity for benchmark-only
gain. This is a deliberate small optimization phase, not a manufactured diff.

## Accepted simplifications

The broad harness now waits for the MCP child's `close` event instead of treating
`kill()` as synchronous. Spawn errors, early exits, timeout, and successful
shutdown share a single-settlement lifecycle, so no late event can change an
already completed sample. This removes a platform race and makes the broad
campaign reproducible on Windows. The same harness reports p95 for the repeated
end-to-end measurements.

The context harness records UTF-8 response bytes and, for structured results,
source bytes, distinct files, ranges, and duplicate ranges. These are
observability additions only; selection, ranking, rendering, and digests are
unchanged.

## Context efficiency

The controlled structured case returned five ranges across two files, 564
source bytes, and zero duplicate ranges. Digests remained:

- structured: `e78654b9990b`;
- markdown with code: `bce970d4fb44`, 1,487 UTF-8 bytes;
- markdown without code: `e8d2093479b3`, 434 UTF-8 bytes;
- JSON: `9ed1ad78f504`, 12,089 UTF-8 bytes.

No context was removed. Semantic sufficiency and the adaptive small/large
repository behavior therefore remain unchanged.

## Phase 5F handoff

Sizes below are unpacked local installation/build measurements, not compressed
release sizes.

| Dependency / asset | Purpose and load site | Shipped | Approximate cost | Replacement direction | Difficulty / risk |
| --- | --- | --- | ---: | --- | --- |
| `@clack/prompts` | interactive installer presentation | yes | 0.21 MB | small Afyx terminal prompt layer | medium; terminal behavior/accessibility |
| `commander` | CLI parsing/help | yes | 0.20 MB | Afyx argument parser over Node primitives | high; public CLI compatibility |
| `fast-string-width`, `fast-wrap-ansi`, `sisteransi` | prompt width/wrapping/ANSI support | yes | ~0.03 MB combined | consolidate with prompt replacement | medium; Unicode/terminal correctness |
| `ignore` | Git-compatible ignore matching | yes | 0.06 MB | bounded Afyx matcher only with parity corpus | high; indexing scope correctness |
| `jsonc-parser` | comment-preserving provider configuration | yes | 0.20 MB | Afyx lossless JSONC editor | high; user-config preservation |
| `picomatch` | glob/path matching | yes | 0.09 MB | constrained Afyx glob matcher | high; cross-platform path semantics |
| `web-tree-sitter` | WASM parser runtime | yes | 5.51 MB installed | Afyx-native parser/runtime boundary | very high; extraction parity |
| `tree-sitter-wasms` | language grammars | yes | 49.37 MB installed | independently owned grammar strategy | very high; language coverage/legal provenance |
| built grammar/runtime WASM | parser assets in `dist/` | yes | 65.03 MB / 29 files | remove only after replacement passes parity | very high; largest artifact impact |
| bundled Node runtime | self-contained six-target execution | release bundle | `NOT AVAILABLE` locally | native launcher/runtime strategy | very high; six-platform installation |
| optional Rust kernel | accelerated optional extraction | when built/available | `NOT AVAILABLE` locally | retain, replace, or make canonical from evidence | high; parity/platform toolchains |

Phase 5E adds zero production dependencies, bundled assets, runtimes, or license
obligations. Phase 5F must remeasure actual staged archives before choosing a
replacement order; no bundle was downloaded or created merely to fill a metric.

## Final comparison

No product implementation changed between baseline and final measurement. The
table therefore classifies timing deltas as host/runtime spread, not an Afyx
speedup. All values use the same fixture, runtime, configuration, and commands.

| Metric | Baseline | Final | Absolute delta | Relative delta | Final p95 | Decision |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Cold index | 2,470.80 ms | 2,422.55 ms | -48.25 ms | -1.95% | 2,467.21 ms | NO_CHANGE |
| Cold peak RSS | 351.60 MB | 351.52 MB | -0.08 MB | -0.02% | 353.88 MB | NO_CHANGE |
| Warm sync, five files | 1,020.87 ms | 994.37 ms | -26.50 ms | -2.60% | 1,043.61 ms | NO_CHANGE |
| Search | 6.28 ms | 6.00 ms | -0.28 ms | -4.46% | — | NO_CHANGE |
| Context | 40.75 ms | 41.53 ms | +0.78 ms | +1.91% | — | NO_CHANGE |
| MCP initialize | 509.26 ms | 494.17 ms | -15.09 ms | -2.96% | 504.99 ms | NO_CHANGE |
| MCP first result | 1,501.11 ms | 1,473.84 ms | -27.27 ms | -1.82% | 1,481.09 ms | NO_CHANGE |

An additional confirmation pass showed why percentages are not treated as
product evidence: without any product-code change, cold index ranged down to
1,981.26 ms, warm sync up to 1,400.30 ms, and context up to 81.83 ms. Counts,
database size, dist size, and semantic digests did not move.

Focused context comparison was stable enough to reject a regression:

| Case | Baseline | Final | Delta | Relative | Digest |
| --- | ---: | ---: | ---: | ---: | --- |
| Dedup-heavy | 47,576.5 µs | 48,580.8 µs | +1,004.3 µs | +2.11% | `b3f166986ffb` |
| Prose architecture | 46,506.1 µs | 50,578.2 µs | +4,072.1 µs | +8.76% | `b07bb4a9524d` |
| Markdown with code | 20,964.0 µs | 18,878.0 µs | -2,086.0 µs | -9.95% | `bce970d4fb44` |
| Structured | 23,712.1 µs | 25,188.9 µs | +1,476.8 µs | +6.23% | `e78654b9990b` |

The final structured payload still contains 564 source bytes, five ranges from
two files, and zero duplicate ranges. Markdown/JSON byte counts and every
context digest are unchanged.

## Validation

- TypeScript `npx tsc --noEmit`: PASS.
- Clean production/UI build via `npm run build:clean`: PASS.
- Semantic baseline: 6/6 fixtures PASS.
- CLI/MCP smoke: 21/21 checks PASS.
- Context contract, MCP semantic contract, and session-context focused suites:
  91/91 tests PASS.
- Broad harness 30×1 smoke, broad 300×5 final run, and context 240×9 final run:
  PASS.
- `mcp-initialize.test.ts`: all behavior assertions completed, but the three
  Windows cases failed while removing their temporary directory with the known
  host-local `EPERM`; no Phase 5E production or test file participates in that
  cleanup failure. Supported-platform exact-head CI remains the acceptance gate.

Phase 5E does not claim final Afyx independence and does not perform third-party
runtime/source removal. Those remain Phase 5F–5H.
