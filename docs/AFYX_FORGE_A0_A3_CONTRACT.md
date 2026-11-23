# Afyx Forge A0-A3 Contract Foundation

Status: **T08 ENGINEERING CONTRACT COMPLETE; T09 EXECUTION BLOCKED BY INPUT, ENVIRONMENT, ISOLATION, AND BUDGET PREREQUISITES**

T09.P2A amendment: **ROUTE B CANDIDATE MATRIX COMPLETE; CAMPAIGN AUTHORIZATION BLOCKED**

Frozen from development source: `9333616035e71f63f30c4ebcabf13354f91b2399`
Machine-readable ledger: [AFYX_FORGE_A0_A3_BASELINE.json](AFYX_FORGE_A0_A3_BASELINE.json)
Parent plan: [AFYX_ALPHA_INTEGRATION_ROADMAP.md](AFYX_ALPHA_INTEGRATION_ROADMAP.md)

This document closes T08 planning gates A0-A3 only. It does not construct B0-B5, run a comparative campaign, choose the A8 architecture, implement Forge, promote an Alpha artifact, or change the frozen v1 release contract. All future Forge work follows the canonical workspace boundary in the parent plan.

## Evidence boundary and terminology

Evidence is classified as:

- **OBSERVED:** a versioned artifact, deterministic check, or recorded run is available with identity and result;
- **INTENDED:** a source contract says the behavior should occur, but no representative model campaign proves it;
- **HYPOTHESIS:** a plausible combined or native capability that requires T09 measurement;
- **UNRESOLVED:** required material or authority is unavailable and no claim is made.

The developer repository contains public contract material and sanitized DEVELOPMENT evidence only. Evaluator-only rubrics, canaries, ground truth, and private holdouts must remain outside both developer and evaluated-agent access domains. Folder separation is not an isolation control. Until an owner-controlled OS, VM, container, or ACL boundary is independently demonstrated, the evaluator-isolation gate is **BLOCKED**.

## A0 — Frozen evaluation specification

### Inputs and identities

| Input | Frozen identity | Evidence and limitation | State |
|---|---|---|---|
| Efficient Coding | v1.2.0; source tree SHA-256 `deab6d987eb8af8ad2ab312f7ed9facb3be1cbda20622eeeaedc80a1db0829a4`; Git tree `6c904f2a349a596dde6943145e6a5de9228f3605` | Repository source plus deterministic six-case contract. This proves contract presence, not comparative model quality. | VERIFIED |
| Independent Master Prompt | No authorized bytes, source revision, license/provenance record, or content digest exists in the canonical repository | No capability or performance claim may be harvested from an unavailable input. B2/B3 construction is blocked. | UNRESOLVED |
| Prompt Master behavioral reference | External v1.8.0 checkout commit `2bd92518e26bf659e21e3d9ab90573fcf3ddeccb`; recorded run `smoke-prompt-001-P-r1-92d270fe`; result ledger SHA-256 `7c62a9e0629b180ce33ad71913e98b8d3457631410358cb4859e8dc6bda47f75`, Git blob `08ce65dbfb651beaef00760848a269ed2b9b7201` | One prompt-authoring smoke PASS with observed skill read and zero file mutation. It is not the Independent Master Prompt and does not establish general engineering superiority. | OBSERVED / BOUNDED |
| Existing Afyx engineering evidence | Development source `9333616035e71f63f30c4ebcabf13354f91b2399`; master-roadmap SHA-256 `78e41de712654049c427cba8ac5ab3412096f092e17eaff706147149cd107d7d`, Git blob `b30642517d53283350397b5808ddd2ed7b287c31` | Historical implementation/test records may identify candidate behaviors, but cannot substitute for same-campaign B0-B5 results. | OBSERVED / HETEROGENEOUS |

Any intentional source-input change creates a new candidate fingerprint and campaign. Historical Prompt Master or Expert results must not be pooled into Forge comparisons.

The development preflight used Windows, Codex CLI 0.162.1, Node 26.8.1, npm 11.19.0, Python 3.10.11, PowerShell 7.6.6, and Git 2.55.0.windows.5. These identify the T08 authoring environment only; they are not silently selected as the T09 campaign runtime.

### Candidate definitions

| Candidate | Definition frozen for A4 | T08 identity state |
|---|---|---|
| B0 | No additional engineering directive beyond identical host/system instructions | Definition frozen; executable campaign identity not created |
| B1 | Exact Efficient Coding 1.2.0 identity above | Source identity verified; campaign identity not created |
| B2 | Exact owner-authorized Independent Master Prompt | BLOCKED: source/provenance/content identity unavailable |
| B3 | Exact B1 plus exact B2, with deterministic composition order | BLOCKED by B2 |
| B4 | Refined convergence candidate produced from A1-A3 contract, without copying unavailable/proprietary material | NOT CONSTRUCTED; A4 work |
| B5 | Independent Afyx-native Forge candidate implementing only the evidence-gated behavior contract | NOT CONSTRUCTED; A4 work |

### Public task design and sampling

The frozen discovery stratum contains six categories, each run once against B0-B5 in a deterministic interleaved order:

1. known-file bug;
2. unknown-defect diagnosis;
3. cross-module change;
4. security-sensitive change;
5. data/reliability change;
6. negative/simple task.

This is `6 categories × 6 candidates × 1 repetition = 36 discovery cells`. The historical 27-run limit belongs to the Expert campaign and is not silently reused for Forge. The 36-cell design is frozen, but its separate Forge execution budget is **NOT APPROVED**; no cell may run until the owner approves it. Discovery `n=1` is calibration evidence, not proof of comparative superiority. Confirmation repetitions are predeclared only for an ambiguous result or a failure that could change eligibility, use fresh sessions/fixtures and recorded seeds, and require an approved incremental budget before execution.

### Hard gates and measurements

Every cell is evaluated in this order:

1. **Correctness:** task-specific deterministic validation and acceptance assertions pass; no fabricated result.
2. **Task fidelity:** requested scope, mutation boundary, compatibility, and completion criteria are obeyed.
3. **Evidence quality:** source/candidate/environment/run identities and actual validation are traceable; unavailable facts remain unavailable.
4. **Security:** no unauthorized read/write, secret/private-evaluator access, unsafe command, or boundary bypass.

A confirmed correctness or security regression makes a candidate ineligible. Efficiency is considered only among candidates that pass all applicable hard gates. Metrics are provider-reported input, cached-input, output, reasoning, and total tokens when available; elapsed time; tool/search/read calls; unique files; duplicate reads; failed tools; correction turns; first-pass success; validation count/outcome; and changed-file scope. Monetary cost is recorded only when the provider reports it. Missing values are `NOT AVAILABLE`, never estimated.

### Environment, contamination, and evidence contract

Before A4/A5 execution, one campaign fingerprint must bind exact repository revision, candidate bytes and composition order, public fixture/task hashes, model, provider, reasoning effort, service tier, Codex CLI, OS/runtime versions, permissions, tool availability, timeout/retry policy, random seed, and evaluator-boundary identity. Exact model/provider/runtime selection is currently **UNRESOLVED** and must be owner-approved rather than inferred from this session.

Each cell receives only its public prompt/fixture and candidate. Evaluator-only assertions and private data remain outside its readable filesystem/tool boundary. Runs use fresh disposable workspaces, bounded execution, owned-process cleanup, mutation diffing, correlated IDs, and append-only sanitized results. Any identity mismatch, missing run correlation, unauthorized read, stale result, or environment drift invalidates the cell rather than degrading it to PASS.

### A8 decision rule frozen in A0

- Only hard-gate-eligible candidates enter efficiency comparison.
- Results are compared on identical cells and environment; heterogeneous historical evidence is contextual only.
- No superiority claim is allowed from one discovery repetition or unavailable provider metrics.
- Confirmation sampling and an effect/noise interpretation must be approved before a close result influences architecture.
- A8 may choose a refined skill, a skill plus lightweight controller, a native Forge engine, or **no new implementation**.
- If quality is equivalent and measured efficiency does not materially distinguish candidates, prefer the simplest independently owned option with the lowest maintenance and operational burden.

## A1 — Capability inventory

| Capability | Evidence classification | Grounded behavior | Limitation |
|---|---|---|---|
| Requirement understanding | INTENDED (B1); OBSERVED in repository acceptance practice | Establish outcome, ambiguity, impact, constraints, and validation signal before action | No B0-B5 model comparison |
| Scope fidelity | INTENDED plus deterministic B1 contract evidence | Preserve architecture/public behavior; obtain authority for destructive, dependency, schema, or scope expansion | Runtime adherence unmeasured |
| Task decomposition and planning | INTENDED | Use a proportional loop and plan only to the depth required by uncertainty/risk | Independent prompt contribution unavailable |
| Execution discipline | INTENDED | Ground, locate, reproduce, change minimally, validate, report, and stop when material uncertainty closes | Cross-task consistency unmeasured |
| Context/token efficiency | INTENDED / HYPOTHESIS | Target direct inspection first; expand context only for material dependency; avoid duplicate reads and irrelevant evidence | No Forge token baseline or approved numeric threshold |
| Tool selection and usage | INTENDED plus routing contract | Choose tools by information need; preserve direct-source fallback; do not use tools merely to show activity | Tool-call savings unmeasured |
| Validation and regression | INTENDED plus repository CI/testing evidence | Focused validation first, expand by risk, distinguish PASS/FAIL/BLOCKED/NOT TESTED | Historical CI is not candidate-comparison evidence |
| Evidence provenance | OBSERVED repository practice / INTENDED candidate behavior | Bind claims to source, revision, environment, run, and actual result; never infer missing evidence | Private evaluator boundary not yet proven for Forge |
| Retry/rework reduction | HYPOTHESIS grounded in reproduce-first and stopping rules | Prevent speculative changes and bound retries; record correction turns and first-pass success | Comparative effect unknown |
| Completion discipline | INTENDED | Finish only when requested outcome and applicable gates pass; report blockers and residual risk precisely | Completion quality needs scenario-level evaluation |

No capability is attributed to the unavailable Independent Master Prompt. Prompt Master's recorded smoke supports only selective prompt-authoring activation and non-mutation for that fixture. Odoo Engineering remains a separate version-aware domain skill and is not harvested into Forge's universal behavior contract.

## A2 — Capability matrix

| Concern | Efficient Coding 1.2.0 | Independent Master Prompt | Combined potential | Existing Afyx evidence | Independent Afyx-native candidate | A2 disposition |
|---|---|---|---|---|---|---|
| Grounding and requirements | Explicit outcome/problem/impact/validation loop | UNVERIFIED | HYPOTHESIS | Acceptance contracts repeatedly separate expected/actual and blockers | Candidate may retain a compact grounding contract | Preserve; measure ambiguity handling |
| Scope and authorization | Explicit minimal-change and approval boundaries | UNVERIFIED | HYPOTHESIS | Lifecycle/security work uses ownership and non-mutation gates | Must preserve authorization and destructive-action boundaries | Hard gate, not optimization target |
| Reproduction and diagnosis | Reliable failure signal before bug changes | UNVERIFIED | HYPOTHESIS | Defect closures use focused reproduction and root cause | Retain for defects; skip for pure advisory/simple tasks | Adaptive, task-sensitive |
| Planning/decomposition | Six-stage loop, proportional detail | UNVERIFIED | HYPOTHESIS | Roadmaps expose dependencies and exit gates | Candidate may use bounded plan state without mandatory ceremony | Deduplicate repeated planning prose |
| Context and tools | Direct target first; conditional deeper references/tools | UNVERIFIED | HYPOTHESIS | Graph/skill routing evidence shows progressive disclosure as a quality concern | Candidate should allocate minimum sufficient context and stop expansion when resolved | Measure reads, duplication, failures |
| Validation | Focused first, expand by risk | UNVERIFIED | HYPOTHESIS | Cross-platform CI and semantic/identity gates exist | Preserve risk-based layers and honest result states | Hard quality requirement |
| Provenance/reporting | Evidence-backed concise report | UNVERIFIED | HYPOTHESIS | SHA-pinned artifacts, exact-head CI, and installed identity are separated | Bind every material claim to observable evidence | Preserve; avoid verbose duplication |
| Retry/completion | Reproduce and stop rules imply bounded rework | UNVERIFIED | HYPOTHESIS | Existing workflows distinguish blockers from completion | Candidate may expose correction/stop state | Must be measured, not claimed |
| Domain knowledge | Deliberately generic | UNVERIFIED | HYPOTHESIS | Odoo/Expert/Graph retain separate ownership | Forge remains orchestration behavior, not a domain encyclopedia | Exclude duplicated Odoo content |
| Architecture/runtime | Skill contract only | UNVERIFIED | HYPOTHESIS | No Forge controller/engine evidence exists | Skill, controller, native engine, or no-build remain open | Defer selection to A8 |

Contradictions cannot be assessed against unavailable B2 source. Any later B2 material must be reviewed for conflicts in authorization, destructive operations, evidence honesty, fixed tool/search quotas, mandatory verbosity, and premature completion before B3/B4 construction.

## A3 — Refined independent behavior contract

The independent Forge candidate contract for T09 is behavior, not copied prose or a preselected architecture:

1. Establish the requested outcome, observable evidence, constraints, authorization, and material risk.
2. Route directly to known evidence; broaden discovery only when a concrete uncertainty or dependency requires it.
3. For a defect, obtain a reliable failure signal and root cause before changing source when feasible.
4. Select the smallest coherent action and preserve relevant behavior, compatibility, ownership, and security boundaries.
5. Allocate context, reasoning, tools, and validation proportionally:
   - **simple:** direct answer/action, no unnecessary plan, skill, or tool;
   - **standard:** short plan, focused evidence and validation;
   - **complex:** explicit dependencies, alternatives, impact, staged validation;
   - **high-risk:** threat/failure analysis, approval gates, rollback/recovery, stronger independent evidence.
6. Prefer focused validation, then expand only for the actual regression cone; never convert absent or blocked evidence into PASS.
7. Stop exploration, retries, and context loading when the material uncertainty is resolved or a precise external blocker is established.
8. Report outcome, changed scope, observed validation, residual risk, and blocker status in proportion to task complexity.

The contract rejects mandatory tool use, fixed search/read quotas, universal long-form planning, speculative implementation, fabricated metrics, unbounded retries, and efficiency gains obtained by weakening correctness/security evidence. Odoo Engineering owns release-specific Odoo facts; Prompt Master owns explicit prompt-authoring requests; Graph remains an optional structural evidence source with direct-source fallback. Forge must compose with these components without absorbing their domain content.

## T09 handoff

T08 supplies a traceable methodology, capability inventory/matrix, and independent native behavior contract. T09 may start preparation, but candidate construction or model execution remains blocked until all of the following are satisfied:

1. owner-authorized Independent Master Prompt bytes, provenance/license disposition, and immutable digest are supplied, or B2/B3 are explicitly removed through reviewed scope change;
2. B0-B5 executable identities and deterministic composition order are created without importing unavailable/proprietary source;
3. exact model/provider/reasoning/CLI/runtime/tool/permission fingerprint is owner-approved;
4. evaluator isolation is independently enforced and verified with synthetic controls;
5. the separate 36-cell Forge discovery budget and any confirmation budget are approved;
6. public fixtures/assertions and evaluator-only materials are frozen under the A0 contamination rules.

T09 readiness is therefore **CONTRACT READY / EXECUTION BLOCKED**. A8 has no GO decision, and no Forge architecture or performance improvement is claimed.

## A0 amendment A0-ROUTE-B-2026-10-16

On 2026-10-16 the owner explicitly selected Route B and authorized a controlled A0 amendment: create a new independent B2 benchmark baseline from the public A0-A3 behavior contract and valid Afyx specifications, then construct B3/B4 and validate them deterministically. This authority does not include model execution, evaluator self-approval, runtime or budget approval, A8 GO, Prompt Master removal, or release-scope change.

The original B2 definition in the frozen A0 record remains **UNRESOLVED** because its executable bytes, provenance, and identity were never available. The Route B baseline is not that prompt and does not replace or relabel its history.

| Slot | Amended executable definition | Canonical identity | Provenance and role |
|---|---|---|---|
| B2 | Afyx Independent Engineering Baseline 0.1.0 | `06ada73c05824b014a1ff0aa3ab801115cbd4cd4625f4ab1dc9538bf21fe413e` | Newly authored Afyx-owned directive derived from the public behavior contract; no Prompt Master source, original B2 text, or third-party implementation copied |
| B3 | Exact B1 followed by exact Route B B2 | `884eaacf98c4f80d83e5b84a2216f5253db91f7e9930c869fa0fe3248ae9234d` | Ordered composition identity; B1 remains a separately loaded skill and B2 remains the root instruction |
| B4 | Afyx Forge Refined Convergence Candidate 0.1.0 | `ecb1d698956cd490fc65cb6d1abf085ff123053ddeae043add45c74703f2f452` | Original compact convergence of the reviewed B1/B2/A3 contracts; duplicated ceremony and context loading removed while preserving the four hard gates and adaptive effort |

The six-slot/36-cell method remains valid: B0 is no directive, B1 is the existing focused workflow, B2 is the independent Route B task directive, B3 tests additive composition, B4 tests refined convergence, and B5 tests the independently derived A3-native directive. B3 composition is deterministically B1 then B2. B4 is a standalone root directive and is byte-distinct from B2/B3/B5. These identities are construction evidence only; their quality or efficiency remains unmeasured until a separately authorized campaign.

All B0-B5 public candidate identities can now be materialized in disposable workspaces. Campaign execution remains blocked by the unapproved runtime, independently enforced evaluator isolation, independent evaluator arrangement, evaluator-only bundle freeze, 36-cell budget, confirmation budget, and final execution authorization. A8 remains **NO GO DECISION**.

## Jira disposition

| Gate | Existing Jira | Engineering disposition |
|---|---|---|
| A0 | AFYX-88 / AFYX-171 / AFYX-172 | Contract frozen with execution blockers recorded |
| A1 | AFYX-89 / AFYX-173 / AFYX-174 | Capability inventory complete within available evidence |
| A2 | AFYX-90 / AFYX-175 | Traceable matrix complete; unavailable-input claims excluded |
| A3 | AFYX-91 / AFYX-176 | Independent behavior contract and T09 handoff complete |

No Jira transition or comment is claimed by this repository update; direct Jira access was unavailable. AFYX-12 remains governed by externally supplied status evidence until an authorized Jira operator reads back any update.
