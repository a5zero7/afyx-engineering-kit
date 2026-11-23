# Afyx Universal Component Interoperability Contract

**Contract:** `AfyxUniversalInterop/v1`

**AFYX-307 implementation boundary (2026-11-02):** the native source candidate
implements deterministic capability discovery and selection, bounded lazy adapter
execution, duplicate/cycle prevention, and the versioned
`AfyxCapabilityRequest/v1` / `AfyxCapabilityResult/v1` envelopes. This is source
and deterministic-test evidence only. Installed-host and provider acceptance remain
AFYX-308/309 work; Forge autonomous execution remains blocked pending A8 GO.
**Decision date:** 2026-11-02
**Status:** **OWNER-APPROVED TARGET CONTRACT / IMPLEMENTATION PENDING**, not a claim of shipped full-mesh runtime integration.
**Scope:** Afyx Graph (`afyx-graph`), Afyx Context Engine (`afyx-context`), Afyx Forge (`afyx-forge`), Afyx Engineering Expert (`afyx-engineering-expert`), Afyx Odoo Engineering (`odoo-engineering`), Afyx Efficient Coding (`efficient-coding`). Afyx Codex Usage Tracking (`codex-usage-tracking`) is a seventh **optional passive observability** tool, not a mandatory orchestrator or decision owner.

This is an **additive** extension to [AfyxModularIntegration/v1](AFYX_MODULAR_INTEGRATION_CONTRACT.md), [AfyxToolFamilyRouting/v1](AFYX_TOOL_FAMILY_ROUTING.md), ProviderAdapter/v1 and the [canonical v1 roadmap](AFYX_V1_MASTER_ROADMAP.md). It supersedes only future-looking *fixed-pair-only* integration assumptions; preserves historical statuses, actual installed behavior, user settings, component identities, legal provenance and formal Forge A8 gating.

## 0. Owner amendment — default-enabled registry-wide interoperability

**Effective target decision: 2026-11-02. Applies to every Afyx-owned component registered by the Kit, now and in future; not limited to the original six collaboration examples.**

- **Install => enabled for discovery and integration by default:** after a component has been explicitly installed and registered in an approved provider/workspace scope, its safe interoperability capabilities default to `enabled=true` (unless the user explicitly disabled them). A health/compatibility/authorization check determines `AVAILABLE`; installation alone is not proof that a host MCP/skill API is actually reachable. No additional per-pair opt-in is required for **ordinary, non-sensitive, authorized** interoperability.
- **Enabled does NOT mean invoked or resident:** enabled capabilities remain **idle and lazy**. `INSTALLED -> ENABLED -> AVAILABLE -> ELIGIBLE -> SELECTED -> ACTIVATED -> EXECUTED` are distinct facts. Only task-appropriate capabilities may activate; direct-source is the intended zero-Afyx-tool route for an exact known edit. Do not auto-start six runtimes, pre-index repositories, inject all skills, create hidden model calls or let independent components independently select the same action.
- **All registered components, all relevant directions:** use the live `scripts/components.json` registry and capability metadata as the source of truth, including `codex-usage-tracking` and future Afyx-owned products, not a hard-coded six-name allow-list. Six primary engineering products are the initial functional baseline: `2^6-1=63` nonempty subsets, `C(6,2)=15` pairs. The current seven-component inventory adds passive Usage Tracking: `2^7-1=127` presence masks and `C(7,2)=21` pairs for deterministic availability/routing tests. Meaningful exchange is defined **per capability**, not an obligation for all pair directions to invoke or for a passive consumer to become an active decision authority.
- **Two-way by common envelopes:** any eligible producer may supply a result to any eligible consumer; a consumer may return scoped constraints, feedback, telemetry or authorized requests if meaningful. Skills participate through real provider skill/instruction handoffs, not imaginary callable APIs. Explicit `NOT_APPLICABLE` for a direction with no legitimate capability; no circular tool calling, duplicated domain owners or 42 mandatory physical adapters.
- **User controls and safety supersede default enablement:** explicit OFF (including `AFYX_CONTEXT_OPT_IN=0`), provider permissions, privacy/telemetry consent, runtime capability gates and workspace ownership must be honored. No automatic global MCP configuration mutation or cross-provider permission bypass. Usage Tracking may publish already-authorized, redacted Codex telemetry through a passive capability, **not** start collection without required permission or assert it supports other providers. Forge Core may provide installable assistive advice; A8-gated formal evaluation/production autonomous control stays blocked.
- **Standalone contract:** when only one component is installed, that component's advertised core functions and output correctness remain intact; optional enrichments are absent with transparent `UNAVAILABLE`/`NOT_APPLICABLE`. User may install one, several or every component; no whole-kit dependency.
- **Bounded, measurable activation:** one task-level arbiter selects minimal capabilities via intent, domain authority, source freshness, bounded cost and explicit reason codes; enforce deadlines, request deduplication and cycle prevention. Correctness and safety override optimization; never overclaim provider token savings or L3 acceptance.
- **Existing sections below:** references to "six components", "63 subsets", optional Context "default-OFF" and fixed examples describe the **historical six-component baseline**, not a forward limit or a requirement for per-pair opt-in. In current forward target, Context integration is default **available/on-demand when installed and healthy**, with explicit OFF having priority. `codex-usage-tracking` is now within the registry-wide interoperability scope as a passive/permission-gated component. Provider-specific unsupported paths remain honest.

**Implementation state:** AFYX-307 local source router is reported ready for review, but actual installed auto-enabled registry-wide two-way execution remains **AFYX-308 implementation pending** and **AFYX-309 real-installed acceptance pending**. This amendment is a design contract, not runtime acceptance.

---

## 1. Product rule: stand alone, compose with any available subset, invoke by need

1. **Standalone fidelity:** Any one of the six components must continue to provide its **own advertised standalone function and truthful, correct core output** with the other five absent. An unavailable *additional* capability must be disclosed, not fabricated; optional composition is an enhancement, not a silent change to the component's correctness contract.
2. **All subsets composable:** Any non-empty installed subset (six components => 63 possible subsets) is eligible for contract-based collaboration where the installed, enabled, compatible, healthy, fresh **and authorized** capabilities exist. No required pair, trilogy, full-kit installation, central daemon, Forge availability or Graph index prerequisite.
3. **Bidirectional potential:** For **every pair A/B**, A may request an eligible capability or consume an authorized result from B, and B may request/consume an eligible capability/result from A. That is **logical two-way interoperability through a common contract**, not a requirement for 30 eager direct adapters, unconditional A->B->A calls, cyclic network requests or shared code ownership. Capabilities without a meaningful reciprocal action report `NOT_APPLICABLE` (not fake PASS).
4. **Role ownership:** One authoritative owner per capability and fact domain. Other components may advise, request evidence or propose constraints, but must not independently publish conflicting final decisions. Result authority always follows source evidence and task requirements.
5. **No activation by installation:** `INSTALLED != AVAILABLE != ELIGIBLE != SELECTED != ACTIVATED != EXECUTED`. Discovery and planning must not launch large indexes, background agents, context workers, test suites or paid model jobs.
6. **Direct first where sufficient:** A known-file edit, exact identifier replacement (e.g. `company`->`Company`), small localized fix, or clear single-source question uses direct-source/native editor actions. Do not load all six skill contexts, route through Graph/ACE/Forge or create a token-expensive orchestration plan.
7. **Explicit user settings and formal gates win:** Disabled/disallowed capability is never silently reenabled via CLI, different provider or adjacent component. Forge Core remains an **assistive, bounded alpha**; formal Forge candidate evaluation, autonomy, adaptive policy control and A9+ production behavior remain gated at A8. Optional ACE Graph MCP runtime may be **default available/on-demand** on the current *candidate* if healthy, with `AFYX_CONTEXT_OPT_IN=0` hard OFF; this does not waive other user-level OFF settings or imply all providers support ACE interception.
8. **Correctness over perceived efficiency:** No context truncation, cross-user data leakage, unsupported version inference, license/source inheritance or false savings. No claims of token, cost or latency improvement without comparable empirical measurement.

## 2. Common interaction model

A capability is an explicitly versioned operation advertised by one installed component and mediated by a *small optional host-embeddable routing library*, not by a permanently running seventh agent.

```text
                      User request + actual provider permissions
                                         |
                         Low-cost intent / scope inspection
                                         |
                      Need-based router / ownership arbiter
                           /                   \
                   DIRECT SOURCE          Capability registry
                    (default when        (only installed, healthy,
                     sufficient)          compatible, authorized)
                                                 |
                              Lazy, bounded capability plan (0..N)
                                /       |           |        \
                           skills     Graph        ACE    Forge Core*
                          Expert/Odoo/Efficient     |
                                \       |           /         /
                                     One result contract
                               authoritative evidence + provenance
                                               |
                                minimal validation / final answer

           *Forge Core = assistive only until formal A8 GO.
```

**Request envelope** (`AfyxCapabilityRequest/v1` design target): `taskId`, `intent`, `capability`, `callerComponentId`, `candidateProviders`, `workspaceIdentity`, `sourceRevision`, `evidenceScope`, `permissions`, `budgetLimits`, `hopCount` and `invocationReason`. No raw credentials, unrestricted user source text or silent network fetches in registry/telemetry.

**Response envelope** (`AfyxCapabilityResult/v1` design target): `producerComponentId`, `capability`, `status` (`COMPLETE|PARTIAL|UNAVAILABLE|BLOCKED|FALLBACK`), `facts`, `sourceRefs`, `identity`, `coverage`, `limitations`, `resourceMetrics` when actually measured, and `recoveryRef` when valid. Keep source facts unmodified and distinguish advice from verified evidence.

**Provider contract:** Adapter maps these intents/capabilities to **supported** MCP/CLI/skills/instructions/hooks. A pure prompt-based skill is not falsely advertised as a callable background service: its participation may be through an authorized instruction selection/result handoff inside an actual host agent. A Graph process should not directly execute a skill by pretending it has a skill API; a skill may provide intent that the router can use to select Graph or ACE.

**Single authority / no cycles:** Stable task-scoped plan; capability owner resolves conflict; deduplicate equivalent requests by task+source+capability+scope; bounded fan-out, depth and time; detect loops and return a transparent `CYCLE_AVOIDED` result. Shared evidence may be consumed by several components without repeating source reads. Never let Forge, Expert and the provider agent independently command the same tools for one action.

## 3. Six-component capability and collaboration matrix

| Component | Authority and standalone output | Available collaborations when *relevant* (logical requests both directions) |
|---|---|---|
| **Graph** | Repository symbols, dependencies, impact and source-grounded evidence | ACE reduces eligible large Graph results; Expert/Odoo/Efficient request Graph facts; Forge Core can consume compact evidence; Graph may accept Odoo-specific intent/validation hints, task bounds and evidence-quality constraints without losing source authority |
| **Context Engine** | Bounded context classification/reduction and byte-exact original retrieval | Any approved component may submit eligible large context; ACE can accept priorities/budget/protected-content constraints from Expert/Odoo/Efficient/Forge and provenance supplied by Graph; no forced compression |
| **Forge Core** | Standalone bounded planning/diagnostics and assistive guidance | Can consume domain hints, engineering workflows, Graph evidence, ACE suggestions; can offer *advisory* plan/budget to any component where authorized; **not** an autonomous runtime conductor or A8-approved optimizer |
| **Engineering Expert** | Cross-domain task interpretation and scoped engineering guidance | May request Odoo domain authority, Efficient implementation discipline, Graph facts, ACE context budgets or Forge Core advisory; may supply requirements/validation criteria back to those consumers |
| **Odoo Engineering** | Odoo version-specific ORM, model, view, security, migration decisions | May request Graph inheritance/dependency evidence, Expert cross-domain support, Efficient coding discipline, ACE filtered Odoo context, bounded Forge advisory; may provide framework-specific constraints to all |
| **Efficient Coding** | Focused inspect/reproduce/change/validate engineering workflow | May request relevant Graph/ACE/Expert/Odoo/Forge capabilities; may supply scope, validation limits, stop conditions and correctness checks back to each without taking their domain authority |

This table enumerates **collaboration eligibility, not current pairwise runtime coverage**. Every pair must have a documented, safe interaction or an explicit capability-level `NOT_APPLICABLE` reason. Full-mesh **discoverability** does not justify full-mesh **invocation**.

`codex-usage-tracking` observes approved Codex usage on its supported surface only; it may report trustworthy telemetry to the result/evidence collector and can work alone. It must not change routing or claim cross-provider counters it cannot observe.

## 4. Selection and anti-overlap policy

```text
inspect intent -> (direct source sufficient? YES: choose DIRECT_SOURCE; STOP routing)
              -> list actual installed+enabled+healthy+supported capabilities
              -> enforce explicit OFF/consent/security/source freshness
              -> assign ONE primary domain owner
              -> choose zero or minimal complementary capabilities based on
                 demonstrable reduction in uncertainty / correctness risk
              -> estimate bounded latency/token/I/O cost, avoid cycles and duplicates
              -> execute selected capabilities lazily and record observed calls
              -> validate authoritative facts / report missing support
```

| Task | Expected minimal plan (illustrative) |
|---|---|
| Exact known-file one-string replacement | **DIRECT_SOURCE** + minimal relevant check; zero Graph/ACE/Expert/Forge runtime calls |
| Simple Python bug with precise location | Efficient Coding discipline / direct source; Graph only when relationships are materially needed |
| Odoo 17 multi-module inheritance / security | Odoo Engineering owns framework correctness; Graph if healthy and fresh; Expert only for real cross-domain need; ACE only for eligible large content |
| Large multi-repository impact | Graph primary evidence; ACE selective recovery; Efficient disciplined implementation if edits are authorized; no forced Odoo |
| Architecture/security incident | Expert primary analysis; Graph for concrete impact; Context if output large; Forge Core may provide advisory plan within gate |
| Installed single component | That component alone; absence of others never blocks its own valid functionality |

Explicit request by user may override performance preference but cannot override safety/authorization or component formal gates. Unknown intent should use cheap direct inspection before speculative planner or model calls.

## 5. Standalone, interoperability and installed-product acceptance

**Delivery gates, not new layers of reviews:** implement incremental production behavior first; run focused tests once per material change and reuse stable source/CI/installed evidence. Failures create a fix, not a validation-of-validation chain.

- **Singleton:** six standalone test paths with five peers absent; preserve supported correctness, rollback and honest `UNAVAILABLE` for extra features.
- **Pairwise:** 15 unordered pairs / 30 logical directions, tested at **capability contract level** for meaningful exchange, explicit OFF, unavailable/degraded, ownership and conflict. No mandated 30 physical adapters or 30 model calls.
- **Subsets:** representative 2/3/4/5/6-component combinations plus deterministic/property-based test coverage of all 63 presence/absence masks for routing consistency. Choose few **live** scenarios based on risk, not exhaustive paid host permutations.
- **Routing negatives:** exact known string => no Afyx runtime calls; missing Graph => source fallback; disabled Context => no ACE; Forge A8 blocked => no production policy override; stale index => no unverified graph facts; conflicting providers => no illicit CLI bypass; repeated prompt => no duplicate calls; cycle => bounded stop.
- **Real installed host:** same tested source SHA, supported Codex/Antigravity/Claude surfaces *when available*, actual tool/skill invocation when claimed, after restart/readback, no foreign config drift. L1 presence and L2 harness do not establish L3 agent invocation.
- **Quality/performance:** correctness and safety first; measure incremental latency, token/context, tool calls, CPU/memory, index/recovery overhead and human rework only where real counters exist. Preserve output source fidelity. An absent optional feature may reduce *additional capabilities* but cannot silently degrade the installed component's advertised output.

## 6. Implementation agenda (not yet shipped)

1. **Foundation and inventory:** version the request/result schemas and capability registry/discovery including supported surfaces and user OFF states; retain stable component IDs and existing v1 contracts.
2. **Selective orchestrator:** implement one low-overhead deterministic selector in the Kit/host adapter path; zero-tool direct-source default; one authority, budgets, dedupe, cycle guard and traced reasons; no mandatory resident service.
3. **Bidirectional component bridges:** adapt existing Graph/ACE/Forge Core/Expert/Odoo/Efficient contracts to common envelopes with optional result handoff; skills are host-mediated, not invented remote APIs. Respect Forge A8.
4. **Subset/conformance and real workflow:** verify singletons, all pairwise contract directions, all 63 subset presence masks, representative installed 2–6 real compositions; targeted provider differences and regression/performance. Reuse AFYX-305 L3 and PHASE8_PARTIAL evidence rather than re-running solved tests.
5. **Product decisions:** fix concrete quality/performance regressions; report `INTEGRATION_ACCEPTED` for a surface only on real invocation evidence. Fold accepted outcomes into Phase 8 and Track B/T12; maintain separate Expert/Forge/Release gates.

**Non-goals:** all-component eager initialization; mandatory Forge/Graph/ACE; universal autonomous agent; blind prompt aggregation; 30 hard-coded cyclic imports; synthetic claims of performance superiority; new paid evaluation without approval; touching global provider config; adding external reference implementation code.

**Source/CI truth:** this document records an owner-requested architecture target; it does not change the runtime or claim that current historical fixed-pair adapters meet this universal contract.

---

## 7. Provider-neutral task execution and host-specific acceptance

**Owner execution policy (2026-11-02):** Afyx engineering **task prompts are provider-neutral by default** and should be executable by *any actually supported and capable agent host*, rather than being hard-coded to Codex or requiring the user to execute the same task on every provider. Current operator usage: **Codex and Antigravity**. Claude Code belongs to the planned/supported provider family where the necessary capability exists, **but no Claude live acceptance may be inferred from compatibility intent**.

1. **Separate `compatibleWith` from `executeOn`:** a portable implementation prompt may say `Compatible: Codex / Antigravity / Claude Code (subject to actual capabilities)`. Execution defaults to **one selected available agent**, such as Codex **or** Antigravity, and is not automatically repeated on all hosts.
2. **Specify provider only where the provider is the test subject:** MCP L3, provider extension/CLI permissions, sandbox behavior, configuration paths, restart, performance/comparative measurements, or other host-specific bugs must identify exactly which host(s), version, editor/CLI surface and isolation level are being examined. Cross-provider conformance requires separate runs *only for the targeted surfaces*.
3. **Every actionable task prompt states**: (a) execution environment (`DEVELOPMENT_WORKTREE`, `ISOLATED_INSTALLED_PILOT`, or approved host), (b) compatible providers vs required execution provider(s), (c) number of executions, (d) deliverable/product code changes, (e) bounded relevant testing and evidence reuse, (f) safety and approval boundaries, and (g) Indonesian progress/final report. Task instructions may be English.
4. **Capability negotiation beats marketing labels:** lack of MCP/CLI/skills permission or an unsupported provider version must be `NOT_SUPPORTED`/`NOT_VERIFIED` as applicable, not success. A prompt does not assume a Codex-only `CODEX_HOME` layout on Antigravity or Claude. Provider-specific bootstrap is an adapter concern, not duplicated in feature logic.
5. **No validation of validation:** reuse exact-candidate source/CI/installed evidence that still covers the affected behavior. Run only changed/at-risk tests, do not require redundant second-agent reviews, and do not execute paid benchmark pairs without explicit approval. Real product implementation and precise correctness/performance evidence have priority over paperwork.

### AFYX-307 owner-local implementation handoff (not an upstream acceptance claim)

Owner reports source-only native selective router commit `567380988d6a32f9ab97f5ea020f963904896d19` on *unpublished local* branch `afyx/afyx-307-native-selective-capability-orchestrator`, based on the locally integrated contract commit `1a0e972c67c433395257357680f2ead3b3ede052`. Locally reported 115 focused/regression tests PASS, 63 component-presence masks x five task profiles deterministic, known-source 0 runtime calls and bounded 10k-route microbenchmark. **GitHub three-OS CI and actual provider adapter wiring at this commit have NOT_RUN/NOT_VERIFIED** because it is not pushed. This documentary note does **not** import or review that unpublished source or replace AFYX-308 real bridge work.
