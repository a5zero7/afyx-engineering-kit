# Afyx Graph UI Architecture Contract

Status: Phase 3B.12A architecture freeze  
Baseline: `c8eac7c8b743284905fc17d93bbf1741a2584882`  
Decision: `ARCHITECTURE_READY_WITH_GAPS`

This document freezes the boundary for a future Afyx Graph UI before further
product work. It describes the repository as it exists at the baseline and
separates verified capability from proposed contracts. It does not authorize a
semantic rewrite of the engine.

## Goals and non-goals

The UI is an optional, local-first adapter over the same public domain APIs used
by the CLI and MCP. The engine, CLI, headless operation, and optional MCP must
continue to work without a browser or frontend runtime. Installation and
provider integration must remain modular, observable, and ownership-safe on
Windows, Linux, and macOS.

This phase does not build a dashboard or setup wizard, change graph semantics,
add remote access, implement Engineering Assurance, add Odoo semantics, or
change the completed Search, Context, Graph/DB/WAL, Impact/Affected Tests,
Watcher, Daemon/Proxy, MCP, CLI, Extraction, or Resolution subsystems.

If future UI work appears to require those subsystems to change, classify it
before editing:

- `MISSING_API`: an existing domain result is not publicly reachable.
- `MISSING_PRESENTATION_CONTRACT`: domain data exists, but a bounded wire shape
  or composition is absent.
- `CORE_FEATURE_GAP`: the requested fact or explanation is not computed.
- `CORE_BUG`: established domain behavior is incorrect.

Only the first two belong in a thin UI/application adapter. A core feature gap
or bug requires a separately scoped core phase.

## Current architecture inventory

The inventory below groups closely related files; “public contract” means the
observable contract at the named boundary, not necessarily an exported package
API.

| File/module | Owner | Public contract | Caller | Dependencies | Current purpose |
|---|---|---|---|---|---|
| `src/index.ts` / `AfyxGraph` | Core | Open/init/sync, status, search/query, graph traversal, impact, context, files, unresolved references | CLI, MCP, UI session, library consumers | DB, extraction, resolution, graph, search, context, watcher | Stable domain facade |
| `src/cli/**` | CLI adapter | `afyx-graph` commands, including `ui` | Shell/user | `AfyxGraph`, MCP/UI launchers | Headless and interactive command surface |
| `src/mcp/**` | MCP adapter | `afyx_graph_*` MCP tools and resources | MCP providers | `AfyxGraph` and MCP session | Agent-facing bounded serialization |
| `src/ui-server/index.ts` | UI application adapter | Local HTTP server lifecycle | `afyx-graph ui` | API router, static server, security, browser opener | Owns a UI adapter process, not graph semantics |
| `src/ui-server/api/index.ts` | UI application adapter | `/api/*` dispatch and method policy | Browser adapter | Endpoint modules, security, event hub | Routes bounded HTTP requests |
| `src/ui-server/api/session.ts` | UI application adapter | Read session refresh and disposal | UI endpoints | `AfyxGraph.openSync`, index revision | Reopens on DB replacement and invalidates read caches |
| `src/ui-server/api/{stats,search,node,nodes,file,filecode}.ts` | UI presentation | Status/search/symbol/file wire models | Browser adapter | Public `AfyxGraph` APIs, source reader | Serializes core results for current views |
| `src/ui-server/api/{flow,map,screens,steps,deadcode,entrypoints,routes}.ts` | UI presentation | Bounded derived view models | Browser adapter | Public graph/query APIs | Presentation composition; must not become alternate semantics |
| `src/ui-server/api/{events,trails,trail-store}.ts` | UI presentation | SSE updates and saved navigation trails | Browser | Watch notifications; `.afyx-graph/ui/trails/` | Live refresh and the only current UI-owned persisted state |
| `src/ui-server/{assets,static,security,open-browser}.ts` | UI transport | Static assets, loopback request policy, optional browser open | UI server | Filesystem, HTTP, OS browser commands | Local delivery and transport hardening |
| `ui/src/lib/{adapter,api,wire,models}.ts` | Browser UI | `GraphAdapter` and typed wire models | Svelte views | Local `/api` | Keeps browser code behind an adapter |
| `ui/src/views/**`, `ui/src/components/**` | Browser UI | Project/search/symbol/file/flow/map/screens/steps/entry/dead-code views | Browser user | `GraphAdapter`, Svelte, `@xyflow/svelte` | Existing interactive presentation |
| `src/daemon/**`, `src/proxy/**` | Core service | Single writer/service lifecycle | CLI/MCP | DB writer lock, watcher | Owns indexing lifecycle; not a UI server |
| `src/installer/targets/{types,registry}.ts` | Integration | Provider target lookup, detection, install/remove contracts | Afyx Graph installer CLI | Target adapters | Current provider registry foundation |
| `src/installer/targets/{codex,claude,opencode}.ts` | Integration | Provider-specific detection and config merge | Installer registry | Provider config formats | Verified initial provider integrations |

The current UI API exposes `/api/stats`, `/api/search`, `/api/node`,
`/api/nodes`, `/api/source`, `/api/file`, `/api/filecode`, `/api/routes`,
`/api/map`, `/api/screens`, `/api/steps`, `/api/flow`, `/api/events`,
`/api/deadcode`, `/api/entrypoints`, and `/api/trails`. Trail create/delete is
the only UI write. There is no current UI endpoint dedicated to full context,
generic impact, affected tests, result provenance, repository-vs-index SHA,
daemon/writer state, or provider integration health.

The public `AfyxGraph` facade already exposes index state/revision/build info,
statistics, files, nodes, edges, callers, callees, impact radius, relevant
context, changed/pending files, unresolved references, and framework/routing
data. UI work must prefer this facade over SQLite or internal query builders.

## Frozen adapter architecture

```text
Browser
   |
   v
Afyx Graph UI (presentation)
   |
   v
UI HTTP/application adapter (validation, limits, wire models)
   |
   v
AfyxGraph public/domain APIs
   |
   +-- Search
   +-- Context
   +-- Graph / Impact
   `-- DB read model

                AfyxGraph core
                     |
          +----------+----------+
          v          v          v
         CLI        MCP         UI
```

CLI, MCP, and UI are peer adapters. None may define a competing traversal,
resolution, affected-test, or search-ranking algorithm. A UI adapter may
validate input, call one or more public domain methods, impose bounds, paginate,
serialize, and map errors. It must not read SQLite internals when an equivalent
domain API exists.

The existing view-specific `flow`, `map`, `screens`, and `steps` modules are
presentation compositions. Their contract is frozen as bounded visualization,
not a new source of domain truth. A result differing from the core must be
treated as a bug or explicitly labeled presentation filtering.

## Optional UI and Afyx Graph subcomponents

Supported installation states are:

| State | Engine | CLI | MCP | UI |
|---|---:|---:|---:|---:|
| Core only | required | required | optional/off | absent |
| Headless agent | required | required | required | absent |
| Full interactive | required | required | required | required |

Dependency rules:

- Engine is required by CLI, MCP, and UI.
- CLI remains a first-class administration and query surface.
- MCP and UI are independent optional adapters; neither depends on the other.
- UI may read an existing index but does not own indexing or the writer lock.
- Core-only and headless states must not require Svelte, Vite, a browser, or a
  frontend runtime.

Today the compiled static viewer is bundled into the Afyx Graph distribution
and the root build builds the UI workspace. Serving it requires no frontend
runtime, and a missing viewer fails only the `ui` command, so runtime
optionality already exists. Independently selecting/installing the UI artifact
does not yet exist. Splitting packaging without changing semantics is a
Phase 3B.12B gap.

## Product installation model

Future installation plans may select these major products independently:

- Efficient Coding
- Odoo Engineering
- Afyx Graph
- Prompt Master
- Headroom

`Minimal`, `Recommended`, `Full`, and `Custom` may be named presets, but a
preset must resolve into the same explicit immutable plan as manual selection.
Selecting Afyx Graph expands to Engine, CLI, optional MCP, and optional UI.
Prompt Master and Headroom remain externally owned unless their integration
contract explicitly says otherwise.

The repository installer currently treats Efficient Coding, Odoo Engineering,
and Prompt Master as core while Afyx Graph is optional. This proposed selectable
product model is therefore a target contract, not a claim about current setup
UX.

### Installation plan contract

The setup frontends should consume and display a serializable, immutable plan:

```ts
type Owner = 'AFYX' | 'EXTERNAL' | 'USER';
type Location = 'user-global' | 'project-local';

interface InstallationPlan {
  schemaVersion: 1;
  generatedAt: string;
  preset: 'minimal' | 'recommended' | 'full' | 'custom' | null;
  components: Array<{
    id: string;
    owner: Owner;
    selected: boolean;
    currentVersion: string | null;
    targetVersion: string | null;
    subcomponents: Array<{ id: 'engine' | 'cli' | 'mcp' | 'ui'; selected: boolean }>;
  }>;
  providerIntegrations: Array<{
    providerId: string;
    location: Location;
    state: ProviderState;
    selected: boolean;
    capabilities: ProviderCapability[];
    operations: PlannedOperation[];
  }>;
  configurationWrites: Array<{
    path: string;
    owner: Owner;
    operation: 'create' | 'merge' | 'remove-owned-section' | 'none';
    ownedKeysOrMarkers: string[];
  }>;
  warnings: string[];
}
```

Generating a plan is side-effect free. Applying requires a separately confirmed
plan identity/digest so the GUI, PowerShell, and Bash frontends execute the same
intent rather than reinterpreting selections.

## Provider registry and capabilities

Provider lifecycle states are independent facts:

- `DETECTED`: provider installation/config evidence exists.
- `SUPPORTED`: an Afyx adapter with verified behavior exists.
- `INTEGRATABLE`: required location and capabilities permit a plan now.
- `INTEGRATED`: actual provider configuration contains a valid Afyx-owned
  integration.

Absence is not unsupported, and detected is not integrated. The long-term
adapter boundary is:

```ts
interface ProviderAdapter {
  readonly id: string;
  readonly displayName: string;
  detect(location: Location): Promise<ProviderDetection>;
  getVersion(): Promise<string | null>;
  getCapabilities(location: Location): ProviderCapability[];
  getConfigLocation(location: Location): string[];
  isIntegrationInstalled(location: Location): Promise<boolean>;
  planIntegration(request: IntegrationRequest): Promise<PlannedOperation[]>;
  installIntegration(plan: PlannedOperation[]): Promise<ApplyResult>;
  verifyIntegration(location: Location): Promise<VerificationResult>;
  removeIntegration(plan: PlannedOperation[]): Promise<ApplyResult>;
}
```

Mutating methods need not be exposed to the UI directly. The current
`AgentTarget` interface already provides detection, location support,
install/uninstall, config printing, and path description for eleven registered
target IDs. It does not yet expose version, an explicit capability set, pure
planning, or separately named verification. Those are presentation/installer
contract gaps, not reasons to replace the registry.

Verified capability inventory from current adapters:

| Provider | Registry support | Instructions | MCP | Hooks | Permissions | Project local | User global |
|---|---|---:|---:|---:|---:|---:|---:|
| Codex | implemented | yes (`AGENTS.md`) | yes | no | no | yes | yes |
| Claude Code | implemented | yes (`CLAUDE.md`) | yes | opt-in prompt hook | opt-in MCP allow list | yes | yes |
| OpenCode | implemented | yes (`AGENTS.md`) | yes | no | no | yes | yes |

The registry also contains Cursor, Hermes, Gemini, Antigravity, Kiro, and three
Copilot target IDs. Their presence proves an adapter exists, but this document
does not expand their capability claims without a separately verified matrix.

Future selection UX offers `All detected`, `Custom`, and `None`. **All means all
detected, supported, and currently integratable providers**, never every registry
entry. The current CLI registry's `all` flag resolves every registered target;
that behavior must not be reused as the future UI meaning of “All detected.”

## Configuration ownership

Every planned operation records `AFYX`, `EXTERNAL`, or `USER` ownership and the
specific owned keys/marker ranges. Provider configuration follows:

```text
read -> parse -> merge/remove Afyx-owned section -> validate -> atomic write
```

It must preserve unrelated MCP servers, hooks, permissions, comments where the
format permits, and provider preferences. Removal deletes only Afyx-owned
entries. External applications and content such as Prompt Master and Headroom
are not uninstalled or overwritten by default. Existing provider writers
already implement targeted merge/removal patterns; future shared planning must
retain that behavior.

## Declared and actual install state

A versioned state document under `~/.afyx/` may record selected components and
subcomponents, versions, provider observations/integrations, ownership,
configuration paths, and timestamps. It is a receipt, not authority.

- `DECLARED_STATE`: last successfully requested and applied plan.
- `ACTUAL_STATE`: read-only detection of files, binaries, versions, config
  entries, process/health state, and project index state now.

Verification compares both. Missing declared artifacts are `DRIFT_MISSING`;
unexpected Afyx artifacts are `DRIFT_UNDECLARED`; changed Afyx-owned config is
`DRIFT_MODIFIED`; external/user differences are reported but not adopted or
deleted. Doctor explains drift, repair creates a new reviewable plan, and apply
updates the receipt only after verification succeeds.

Lifecycle rules:

- `install` and `configure` apply explicitly selected additions.
- `update` updates only declared/selected installed components. It never adds
  Odoo Engineering, Prompt Master, Headroom, UI, or provider integrations.
- `verify`/`doctor` are read-only and inspect actual state.
- `repair` plans restoration of Afyx-owned declared state and requires consent.
- `uninstall` removes selected Afyx-owned artifacts only; external software is
  retained unless an external-specific removal is separately requested.

Installation semantics belong in a headless installation engine with
plan/detect/apply/verify operations. PowerShell, Bash, and a future setup UI are
frontends over it. GUI handlers must never be the only implementation path.

## UI information architecture

Minimal primary navigation should be `Project`, `Search`, `Explore`, `Impact`,
`Diagnostics`, and `Status`. Existing specialized views can remain subordinate
routes rather than top-level architecture.

| Surface | Purpose | Data/domain API | Expected size | Limit strategy | Empty state | Error state |
|---|---|---|---|---|---|---|
| Project | Identify project and index summary | stats, files, index state/revision | one summary + bounded recent files | recent/page cursor | no index with init guidance | unavailable/partial/failed shown distinctly |
| Search | Find symbols/files | search facade | tens; potentially thousands | default 60, hard max 200, page/cursor later | no matches and query retained | invalid query vs index unavailable |
| Explore | Node, callers/callees, source, neighborhood | node/batch node, callers/callees, source | one node + bounded relations | group limits and expand on demand | node absent/deleted | stale ID vs read failure |
| Impact | Impact paths and affected tests | impact and affected-test domain services | tens to hundreds | bounded depth, paths, tests; paginate lists | no known impact, not “safe” | incomplete/stale evidence explicit |
| Diagnostics | unresolved/ambiguity/framework diagnostics | unresolved/reference and build APIs | potentially large | filters, counts, pages; never all rows | healthy/no findings | partial scan vs adapter failure |
| Status | Engine/index/provider health | status/freshness plus provider detection | small structured records | no bulk graph | not installed/not integrated states | each health plane fails independently |

Evidence-driven priority is: project/index health; index freshness; source and
baseline SHA; impact chain; affected tests; why-this-result; query provenance;
evidence freshness; then search, node detail, callers/callees, ambiguity,
unresolved diagnostics, and graph neighborhood. Priority does not imply current
availability.

## API sufficiency matrix

| UI action | Classification | Basis / required adapter work |
|---|---|---|
| Stats, search, node/batch node, file/source | `READY` | Existing bounded UI endpoints over public APIs |
| Callers/callees and node neighborhood | `READY` | Existing node/flow/map presentations; retain explicit bounds |
| Existing routes/screens/steps/entry/dead-code views | `READY` | Existing presentation APIs; never elevate heuristics to domain truth |
| Generic impact chain | `NEEDS_THIN_ADAPTER` | `getImpactRadius` exists; add bounded wire shape and error mapping |
| Relevant context | `NEEDS_THIN_ADAPTER` | `findRelevantContext` exists; add bounded UI endpoint |
| Unresolved-reference diagnostics | `NEEDS_THIN_ADAPTER` | Domain queries exist; add filters/pagination and safe wire shape |
| Affected tests | `MISSING_PRESENTATION_API` | Established Impact/CLI behavior needs a dedicated bounded UI contract |
| Index freshness including current Git SHA | `MISSING_PRESENTATION_API` | Index data exists; repository SHA comparison/composition is absent from UI API |
| Daemon/writer lifecycle status | `MISSING_PRESENTATION_API` | Must observe existing ownership without acquiring a writer |
| Provider detection/integration health | `MISSING_PRESENTATION_API` | Registry exists; side-effect-free normalized status endpoint is absent |
| Search ranking explanation | `CORE_GAP` | Current search result does not expose a complete scoring explanation |
| Provenance path for every relation/affected result | `CORE_GAP` | Some edges/paths exist, but universal evidence/reason metadata does not |
| Exact-query mode | `CORE_GAP` | Known core backlog; UI must not emulate it |

`CORE_GAP` here means missing requested capability, not authorization to alter
the frozen core.

## Why-this-result and provenance contract

Future result envelopes should identify query, normalized inputs, bounded
parameters, index revision/build version, indexed source SHA when recorded,
current source SHA when independently observed, freshness, result identifiers,
path/edge evidence, and warnings about truncation or ambiguity.

| Desired field | Availability |
|---|---|
| Node/file identity, edge kind, source locations | `AVAILABLE_NOW` |
| Traversed path returned by current graph/impact methods | `AVAILABLE_NOW` |
| Index timestamp/revision/build version and counts | `AVAILABLE_NOW` |
| Query text, adapter limits, truncation, request duration | `DERIVABLE_WITHOUT_SEMANTIC_CHANGE` |
| Current repository SHA and comparison with recorded indexed SHA | `REQUIRES_NEW_PRESENTATION_API` |
| Affected-test result envelope and evidence status | `REQUIRES_NEW_PRESENTATION_API` |
| Provider/integration observation source | `REQUIRES_NEW_PRESENTATION_API` |
| Complete search rank factor explanation | `REQUIRES_CORE_FEATURE` |
| Universal reason/evidence chain for every inferred relation | `REQUIRES_CORE_FEATURE` |

The UI must render unavailable evidence as unavailable, not synthesize a
plausible explanation.

## Health and freshness contract

Health is three independent records:

- **Engine health:** engine/library version, API compatibility, process health,
  and last error.
- **Index health:** project path, index existence/state, index revision, indexed
  source SHA if available, current Git SHA, fresh/stale/unknown, file/node/edge
  counts, unresolved/pending counts, DB/WAL size, build/extraction version, last
  sync, daemon observation, and writer ownership observation.
- **Provider integration health:** provider lifecycle state, version if known,
  config location, location scope, installed Afyx-owned entries, verification
  result, and observed-at timestamp.

One plane cannot turn another green. An integrated provider with a stale index
is still stale; an absent provider does not make the engine unhealthy. Unknown
SHA is not fresh. Current Git SHA collection is read-only and must tolerate a
non-Git project.

## Large-result safety

The browser never receives or renders the entire repository graph. Every list
and graph response has a default limit, hard limit, truncation flag, and stable
continuation contract where paging is meaningful. Prefer progressive disclosure
and explicit expansion of neighborhoods and paths.

Existing safeguards include search hard max 200; node incoming/outgoing group
bounds; map depth max 4 and at most 60 modules; steps max 400/depth max 14;
source max 8 MiB/4000 lines; event batches max 200 files; trails max 200 with 64
hops; dead-code max 300; and bounded flow/screens/hierarchy work. They remain
safety ceilings, not evidence that cursor pagination is complete. Phase 3B.12B
should standardize `items`, `total`, `limit`, `truncated`, and `nextCursor`
without changing core results.

## Local security model

Current serving is local-only on `127.0.0.1`; remote bind is not configurable.
Host and optional Origin must be loopback, CORS is not enabled, framing is
denied, content sniffing is disabled, referrers are suppressed, and CSP is
applied. Mutating `/api` requests require the UI marker and JSON content. Query
and body sizes are bounded, and project/static paths are containment-checked,
including symlink handling.

There is no authentication token because the trust boundary is loopback plus
Host/Origin/method controls. This is acceptable only while remote exposure is
unavailable. Any future remote mode is a separate security design requiring
explicit opt-in, authentication, authorization, TLS/reverse-proxy guidance,
and threat-model tests. It must not become the default.

## Server, daemon, and writer lifecycle

`afyx-graph ui` currently starts a separate loopback HTTP adapter and optionally
opens a browser. It opens an existing graph for reading and refreshes sessions
on index replacement/content changes. SSE observation activates while browser
subscribers exist. The MCP daemon remains the writer/index/watcher owner; the UI
does not start a second writer. UI-owned saved trails live under
`.afyx-graph/ui/trails/` and are disabled by read-only mode.

This separate adapter process is the frozen near-term model. Directly attaching
the UI to the MCP protocol or moving UI lifecycle into the writer daemon is not
required. A later shared proxy is acceptable only if it preserves one writer,
the same public domain boundary, and optional UI lifecycle.

## Cross-platform and framework decision

Paths use platform APIs and wire paths use normalized project-relative forms.
Process launch, config locations, URL opening, and signal handling require
Windows/Linux/macOS tests. Browser auto-open stays optional (`--no-open` and
headless behavior); failure to open a browser must not terminate the server.
Loopback checks must cover the platform representations the server accepts.

The existing frontend is Svelte 5 with Vite and `@xyflow/svelte`, compiled to
static assets served by Node. It already supports offline/local-first delivery
and graph visualization without a browser runtime dependency in core use.
There is no evidence justifying a migration. Phase 3B.12B should retain this
stack and focus on contracts, lazy loading, and separable packaging.

## Preliminary performance budgets

These are initial engineering envelopes, not measured acceptance claims. Each
measurement must label engine time, process startup, local HTTP time, and browser
render time separately; CLI startup must not be attributed to graph algorithms.

| Layer | Preliminary target on the reference campaign machine |
|---|---|
| UI server bind after engine/session readiness | p95 <= 500 ms |
| Static shell response after bind | p95 <= 100 ms |
| Warm bounded search/node HTTP response | p95 <= 300 ms |
| Warm bounded impact/affected-test response | p95 <= 1.5 s |
| First meaningful browser render after server is ready | p95 <= 1.0 s |
| Neighborhood render | <= 500 visible elements initially; expand on demand |
| Initial compressed browser payload | target <= 1.5 MiB; measure before gating |
| Memory | record server and browser separately; set a hard budget only after 3B.12B baseline |

Timeout, cancellation, limit, and payload-size telemetry accompany latency.
Dataset, hardware, cold/warm state, and repetition method are mandatory in any
claim.

## Known gaps and extension points

| Known gap | Backlog classification | UI rule |
|---|---|---|
| Context ranking omission | `CORE_BACKLOG` | Show available evidence; do not re-rank in UI |
| Relation-aware node presentation | `UI_PRESENTATION_BACKLOG` | Improve wire/presentation using existing relation truth |
| Exact-query mode | `CORE_BACKLOG` | Do not simulate exactness client-side |
| Odoo semantics | `ODOO_BACKLOG` | Do not claim Odoo-specific relations yet |
| Token benchmark inconclusive | `PERFORMANCE_BACKLOG` | Label evidence inconclusive, never infer savings |
| Selectable UI artifact | `UI_PRESENTATION_BACKLOG` | Split packaging while preserving core-only runtime |
| Install plan/state/capability contracts not implemented | `UI_PRESENTATION_BACKLOG` | Build headless contracts before setup screens |

Future Odoo display uses generic typed entities and typed relations with
source/evidence metadata. This can later represent models, `_inherit`,
`_inherits`, relation fields, XML views, external IDs, security, and server
actions without hardcoding them into the base graph renderer. Until the engine
supplies those facts, the UI displays none of them.

Future Engineering Assurance can add a separately versioned evidence/status
surface for baseline SHA, evidence SHA, `VALID`/`STALE`, scope, ground truth,
regression classification, performance gate, CI state, and merge readiness.
Those fields remain evidence records, not engine health or semantic results.

## Testable architecture rules

Existing tests already cover the UI command/server/API, security, packaging,
events, bounded UI view models, trails, provider targets, and installer merge
behavior (`cli-ui-command.test.ts`, `ui-server*.test.ts`, `security.test.ts`,
`ui-package.test.ts`, `ui-*-api.test.ts`, `ui-*-model.test.ts`,
`installer-targets.test.ts`, and `installer.test.ts`).

Phase 3B.12B should add narrow static/contract tests that prove:

1. Core modules do not import `ui/` or `ui-server/`.
2. Core/CLI/MCP operate when viewer assets and UI dependencies are absent.
3. UI adapters import the public facade, not DB/SQLite implementation modules.
4. Every collection response is bounded and reports truncation/continuation.
5. UI presentation does not introduce traversal, resolution, search ranking,
   or affected-test algorithms.
6. Provider detection and plan generation are side-effect free.
7. `All detected` selects only detected + supported + integratable providers.
8. Apply uses the reviewed immutable plan and atomically merges owned entries.
9. Config merge/removal preserves unrelated user/external keys.
10. Update never adds unselected components or integrations.
11. UI lifecycle never acquires a competing writer.

No new executable test is needed for this documentation-only freeze.

## Decisions and Phase 3B.12B boundary

Frozen decisions:

- Retain the peer-adapter model and current Svelte/static HTTP architecture.
- Keep UI optional, loopback-only, and separate from writer ownership.
- Use public `AfyxGraph` APIs; add only bounded presentation adapters where
  domain facts already exist.
- Put installation semantics in a shared headless engine and treat UI/PowerShell/
  Bash as frontends.
- Model provider state, capability, ownership, declared/actual state, and plan
  immutability explicitly.
- Never compensate for known semantic gaps in UI code.

Recommended Phase 3B.12B scope is deliberately narrow: make UI packaging truly
selectable; introduce side-effect-free provider capability/detection and
immutable installation-plan types; add presentation endpoints for health,
freshness, generic impact/context, affected tests, unresolved diagnostics, and
available provenance; standardize bounded wire pagination; and add the static
boundary/ownership tests above. It must not change core semantics, implement a
full setup dashboard, enable remote serving, or add Odoo/Assurance semantics.

Because the architecture is implementable over the accepted core but those
presentation, packaging, and installer contracts are not yet complete, the
Phase 3B.12A classification is `ARCHITECTURE_READY_WITH_GAPS`.
