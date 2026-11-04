# Afyx Forge T09.P0 Benchmark Readiness

Status: **T09.P0 PREPARATION COMPLETE / BENCHMARK EXECUTION BLOCKED**
T09.P1 checkpoint: **PREPARATION COMPLETE / EXTERNAL GATES BLOCKED**
T09.P2A checkpoint: **CANDIDATE MATRIX COMPLETE / CAMPAIGN AUTHORIZATION BLOCKED**

Starting revision: `b2c1d1016b2a1401a651e2b539e9a029ee0606c5`

Normative inputs:

- [A0-A3 contract](AFYX_FORGE_A0_A3_CONTRACT.md)
- [A0-A3 machine baseline](AFYX_FORGE_A0_A3_BASELINE.json)
- [Forge candidate and campaign manifest](../evals/forge/manifest.json)
- [Proposed environment](../evals/forge/environment.proposed.json)

T09.P0 prepares public candidates, fixtures, identities, controls, and owner decisions. It does not run a model cell, approve the 36-cell budget, prove Forge evaluator isolation, select the A8 architecture, or create production Forge.

## P0.1 — Evidence reconciliation

The canonical repository was clean and synchronized on `dev` at the starting revision. Authoring runtime: Windows, Codex CLI 0.162.1, Node 26.8.1, npm 11.19.0, Python 3.10.11, PowerShell 7.6.6, and Git 2.55.0.windows.5. These values are observations, not campaign approval.

The existing `evals/harness` provides bounded child execution, fresh external workspaces, correlation, fail-closed synthetic controls, atomic result publication, and process-tree cleanup for the Expert campaign. That infrastructure is reusable design evidence, but its historical isolation result and Expert aliases do not prove Forge isolation or authorize Forge execution. Existing Expert environments, results, and private-material boundaries remain unchanged.

## P0.2 — Independent Master Prompt

No executable, owner-authorized Independent Master Prompt was found in tracked canonical source or the currently supplied attachment set. The only matching attachment text is this task's warning that the earlier `Independent master prompt - afyx forge.txt` is a historical conversation/decision summary, not B2.

B2 therefore remains **UNRESOLVED**. No historical summary, Prompt Master source, Expert source, or guessed prompt was substituted. B2 requires an owner-provided exact artifact with source/revision, SHA-256, ownership, provenance, license/usage disposition, explicit evaluation authorization, and approved injection mechanism. B3 remains blocked by B2.

## P0.3 — Candidate identities

| Candidate | Identity/readiness | Entry point | Disposition |
|---|---|---|---|
| B0 | `b43d351e...15e64f`; PREPARED EXECUTABLE / NOT RUN | No additional directive or Afyx skill | Ready for later frozen campaign |
| B1 | Efficient Coding 1.2.0 tree `deab6d98...29a4`; PREPARED EXECUTABLE / NOT RUN | Repository-local `.agents/skills/efficient-coding/SKILL.md`; successful read must be observed | Ready for later frozen campaign |
| B2 | No identity | Owner-authorized prompt injection | BLOCKED: content, provenance, authorization, and injection unresolved |
| B3 | Ordered composition `[B1, B2]`; no combined hash | Materialize B1, then inject exact B2 | BLOCKED by B2 |
| B4 | No identity | To be chosen during reviewed convergence construction | BLOCKED by B2; not constructed |
| B5 | Tree `0b4e610c...e8cb58`; PREPARED EVALUATION-ONLY / NOT RUN | Copy `evals/forge/candidates/B5/AGENTS.md` to evaluated workspace root | Prototype only; not production Forge or A8 approval |

B5 is an original, compact derivative of the public A3 behavior contract. Prompt Master was used only as authoring guidance for the Codex-targeted directive; no external or unavailable prompt text was copied into it.

File and tree identities use normalized project-relative POSIX paths and canonical UTF-8/LF content, so Git checkout line-ending policy cannot change an otherwise identical candidate fingerprint.

All executable identities must be reverified and bound into one approved campaign fingerprint immediately before the first cell. An intentional byte, loading-order, or activation-rule change creates a new candidate identity.

## P0.4 — Proposed campaign environment

`evals/forge/environment.proposed.json` fixes a reviewable proposal: Windows 11, Codex CLI 0.162.1, `gpt-5.6-sol`, OpenAI provider, medium reasoning, priority service tier, current recorded runtimes, root-deny evaluation permission profile, network disabled, no Graph/Headroom/external MCP, 300-second cell timeout, 45-second control timeout, zero model retries, fresh session/workspace, seed `16102026`, and owned-process cleanup.

Status remains **OWNER_APPROVAL_REQUIRED**. `campaign_source_revision` is deliberately `null`; it must be set only when the owner approves the environment and every candidate/evaluator identity is frozen. Historical Expert runtime values are proposal evidence, not inherited authority.

## P0.5 — Isolation and contamination

Required topology:

```text
developer identity -> public source, public fixtures, sanitized verdicts only
evaluated identity -> disposable scenario workspace and exact candidate only
trusted evaluator  -> approved public inputs plus evaluator-only bundle/output
evaluator-only root -> rubric, canary, ground truth, private holdout; denied to both agents
```

The controller must enforce separation using independently controlled OS accounts, a VM/container, or equivalent ACL boundary. Synthetic positive workspace read/write plus negative evaluator read/write/traversal tests must pass from the actual evaluated identity. Shared profiles, mounts, attachments, transcripts, logs, and tool endpoints must not expose evaluator material. Unauthorized read or marker exposure is FAIL regardless of another BLOCKED result.

No independent Forge host was available to this developer session. Isolation is **NOT TESTED / BLOCKED**, no real private material was accessed, and historical Expert canary results were not reused as Forge acceptance.

## P0.6 — Fixture, harness, and budget

The public synthetic fixture covers the exact six frozen categories. Five coding scenarios have focused deterministic baseline tests that fail with exit `1` on pristine copies and target exit `0`; the negative/simple scenario permits no file mutation or tool call. The fixture tree SHA-256 is `02947fd6e29d0517cc5e0d768aa91ea3ec88b483aed42d7fc3a853bd3f12720e`.

The manifest produces 36 unique deterministically shuffled cell IDs (`6 candidates × 6 categories × 1 repetition`) with order SHA-256 `e5bda9785e3570611753737ef9b75e931220b21c304e10d78fe02162d154603a`. It specifies fresh sessions/workspaces, run/control correlation, candidate/fixture/environment fingerprints, timeout/cleanup/exclusion records, four ordered hard gates, and nullable provider metrics. Monetary cost remains `NOT AVAILABLE` unless directly reported.

The separate 36-cell budget and any confirmation budget are **NOT APPROVED**. Discovery `n=1` is calibration, not comparative superiority. No benchmark cell was run.

## P0.7 — Progress and decisions

| Concern | Result |
|---|---|
| Public candidate/fixture identities | PASS for B0, B1, B5; B2-B4 explicitly blocked |
| Schema, containment, deterministic order | PASS |
| Pristine fixture reproduction | PASS; five expected failing baselines, canonical tree unchanged |
| Public contamination scan | PASS; no evaluator marker in candidate/fixture content |
| Independent Forge isolation | NOT TESTED / BLOCKED |
| Runtime approval | NOT APPROVED |
| 36-cell budget | NOT APPROVED |
| Evaluator-only bundle | NOT FROZEN / inaccessible to developer |
| Model benchmark/performance/A8 | NOT RUN / NOT CLAIMED |

Externally supplied Jira state for this task says AFYX-12, AFYX-88, and AFYX-171 are In Progress; AFYX-172 and A1-A3 issues are Done within their documented contract scope. No Jira connector or CLI was available here, so no live transition/comment is claimed. A0 methodology remains complete while A0 input completion stays open.

## Owner decision register and exact handoff

Benchmark execution remains blocked until an authorized owner/evaluator supplies and approves all items:

1. exact B2 artifact, provenance/license/authorization, digest, and injection mechanism;
2. reviewed B4 executable candidate and final B0-B5 immutable fingerprints;
3. exact approved campaign source revision and runtime configuration;
4. independent Forge isolation with fresh synthetic control evidence;
5. explicit 36-cell and confirmation budgets;
6. evaluator-only bundle identities and freeze confirmation outside both agent roots.

The P0 handoff designated **T09.P1 — Candidate Freeze, Independent Isolation Acceptance, and Campaign Authorization** and required these checks first:

```text
python evals/forge/validate.py --check-fixtures
python scripts/tests/test_forge_readiness.py
```

P1 was expected to bind approved repository/environment/evaluator identities, verify actual host controls, and stop for authorization. The checkpoint below records the work that was possible with the inputs actually supplied. Only a subsequent authorized T09 benchmark execution may run the 36 cells. A8 remains blocked until independently evaluated results pass the frozen decision rule.

## T09.P1 checkpoint — fail-closed campaign gate

No new owner-authorized B2 artifact accompanied T09.P1, and the tracked repository still contains no executable Independent Master Prompt. B2 therefore remains `UNRESOLVED`; B3 cannot be composed, and B4 cannot be reviewed as a genuine B1+B2 convergence candidate. B0, B1, and B5 now include deterministic materialization contracts. Disposable-workspace checks reproduce the exact B1 and B5 identities and verify that B0 contains neither directive.

The proposed runtime matches the observed developer host for Codex CLI 0.162.1, Python 3.10.11, Node 26.8.1, and PowerShell 7.6.6. This is static feasibility evidence only: the evaluation permission profile, independent evaluator identity, and private storage boundary were not available for actual acceptance. Independent isolation remains **NOT TESTED**.

`python evals/forge/validate.py --campaign-ready` is the machine-enforced authorization check. It exits `2` while any campaign prerequisite remains unresolved. The current gate rejects execution for nine recorded reasons: B2/B3 authorization, B4 identity, runtime approval, independently enforced isolation, 36-cell budget approval, evaluator-arrangement approval, final-execution approval, evaluator-bundle freeze, and the incomplete B0-B5 fingerprint set. Campaign identity, campaign source revision, environment fingerprint, evaluator identity, and private-bundle digest remain deliberately `null`; benchmark execution remains `false`.

T09.P1 therefore closes only as **PREPARATION COMPLETE / EXTERNAL GATES BLOCKED**. The next executable action belongs to the owner and independent evaluator: supply authorized B2 evidence, approve the proposed runtime/evaluator arrangement and budgets, then return sanitized isolation and bundle-manifest evidence. No model cell, Alpha promotion, A8 decision, or production Forge implementation was performed.

## T09.P2A checkpoint — controlled Route B candidate completion

The owner explicitly selected Route B on 2026-10-16. The original Independent Master Prompt remains historically `UNRESOLVED`; it was not recovered, replaced, or relabeled. Amendment `A0-ROUTE-B-2026-10-16` instead authorizes a distinct Afyx-owned baseline, **Afyx Independent Engineering Baseline 0.1.0**, derived only from the public A0-A3 behavior requirements and valid Afyx specifications.

The candidate matrix is now deterministic:

| Candidate | Identity | Result |
|---|---|---|
| B0 | `b43d351e73d703787e7da80d47c945f76e60094159cccfc3cf6052af8b15e64f` | PREPARED / NOT RUN |
| B1 | `deab6d987eb8af8ad2ab312f7ed9facb3be1cbda20622eeeaedc80a1db0829a4` | PREPARED / NOT RUN |
| B2 | `06ada73c05824b014a1ff0aa3ab801115cbd4cd4625f4ab1dc9538bf21fe413e` | PREPARED / NOT RUN; Route B baseline |
| B3 | `884eaacf98c4f80d83e5b84a2216f5253db91f7e9930c869fa0fe3248ae9234d` | PREPARED / NOT RUN; exact B1 then B2 composition |
| B4 | `ecb1d698956cd490fc65cb6d1abf085ff123053ddeae043add45c74703f2f452` | PREPARED / NOT RUN; refined convergence |
| B5 | `0b4e610c6772fa03dcce3d7f49e7a427bd97bded6abc2b1719f0e9a1b1e8cb58` | PREPARED / NOT RUN; evaluation-only native candidate |

Canonical LF-normalized fingerprints, ordered B3 composition, disposable materialization, activation contracts, candidate differentiation, fixture integrity, path containment, and public-material contamination checks are machine enforced. B2 and B4 contain no transplanted Prompt Master source, unavailable original B2 text, evaluator-only content, or third-party implementation dependency.

Route B authority did not approve runtime selection, evaluator arrangement or isolation, the evaluator-only bundle, either budget, final execution, A8, product implementation, or release changes. The fail-closed campaign check therefore remains expected to exit `2`. Status: **CANDIDATE MATRIX COMPLETE / CAMPAIGN AUTHORIZATION BLOCKED**.

## T09.E1.5 checkpoint — secure evaluator handoff

The public [T09.E1 secure handoff contract](AFYX_FORGE_T09_E1_SECURE_HANDOFF.md) now defines the independently controlled trust boundary, Windows-only per-cell lifecycle, public input/result schemas, sanitation, fail-closed security checks, cleanup, and precise owner handoff. The manifest binds its LF-normalized SHA-256. No private evaluator artifact, runner, credential, canary value, scoring material, or protected path is stored here. B0-B5, fixture and cell-order identities are unchanged; zero benchmark cells were run. WSL and the owner's personal Ubuntu are explicitly excluded from formal evaluated-agent execution. All seven campaign blockers remain; status is **CAMPAIGN BLOCKED**.
