# Native capability integration — MB12

AFYX Context owns documentation selection, observed usage aggregation, engineering
memory and context budgets. Forge owns dependency execution and verification.
Engineering Expert owns skill specification and conflict validation. The existing
Universal Runtime selects these capabilities lazily; it does not create a second
workflow engine. Reference projects were inspected for requirements, without
importing their implementation, prompts, assets or pricing snapshots.

## Runtime boundaries

`invokeHostWorkflow` and `createInstalledAfyxRuntime` accept `trustedCapabilities`
only from host configuration. MCP task JSON cannot supply that configuration.
Task types include `documentation-search`, `usage-analytics`, `github-operation`,
`cli-automation`, `security-audit`, `workflow-execution`, `skill-discovery`,
`skill-refinement` and `skill-composition`. `payload` contains operation data;
`manualSelection` may request an installed capability but cannot enable OFF or
grant permissions. Known-source edits continue to invoke zero optional tools.

Host configuration supplies approved documentation catalogs, observed usage events,
CLI specifications, Forge adapters, and GitHub repository scopes. Documentation
defaults to the project README. Nothing indexes in the background, installs tools
automatically, or reads provider logs for analytics. Unknown usage/cost remains
`null`; token-budget counts are estimates, not observed provider usage.

Memory remains available through the explicit Context API. Recording is explicit,
and `AFYX_CONTEXT_MEMORY=0` or `enabled:false` disables persistence. The store is
bound to its canonical project, sensitive credential patterns are rejected, and
retention is bounded by item/byte limits. Optional TTL defaults to zero to preserve
existing owner notes. Sensitive classification is not a comprehensive PII detector.
Foreign/corrupt stores are preserved and rejected, never silently replaced.

## Native execution and verification

Native Execution compiles trusted declarative catalogs. Tasks select a capability
ID and validated arguments, never a shell command. The default catalog exposes
only the pinned Node version command. Mutations/privileged actions need a trusted
approval callback. Environment, timeout, cancellation and output are bounded.
These controls are not an OS CPU/RAM sandbox or a process-tree isolation guarantee.

Forge read-only independent steps may execute in parallel; mutations are exclusive
within the host process. Cross-process exclusion requires a trusted lock callback.
Checkpoint resume requires trusted verification and matching plan identity.
The historical refiner text matcher is labeled `TEXT_HEURISTIC_ONLY` and never
claims `verifiedComplete`. The versioned completion v2 requires source-bound
evidence validated by the host. Autonomous/campaign A8 gates remain separate.

## GitHub MCP

`scripts/afyx-native-github.mjs --mcp --repositories owner/repo` exposes one
read-only `afyx_github_read` tool. Public requests use fixed GitHub GET endpoints;
`--gh-executable <absolute-path> --project-root <root>` uses an existing native gh
session through the validated execution boundary. No credential store or token
retrieval tool is introduced. Repository scope is launch configuration, not tool
input. Mutations are unsupported. Pagination is explicit and bounded; redirects
requiring another origin fail closed unless handled by a trusted host client.
Redacted file content is marked as modified evidence rather than byte-exact source.

The Universal Host Bridge accepts `--github-repositories owner/repo` and optional
`--github-gh-executable <absolute-path>` with its normal `--authorize` launch policy.
No global provider configuration is changed by discovery.

## Distribution and platform evidence

New Kit Graph manifests use schema 2 for Windows x64, Linux x64, Darwin arm64 and
Darwin x64. Schema 1 remains readable for the published Alpha.7 Windows/Linux pair.
Darwin archives require the same external Node >=22.5 runtime and contain no new
third-party parser/runtime dependency. macOS CI uses native ARM64 and Intel runners
to exercise Full install, verify, Graph MCP, update and uninstall with Bash 3.2.
Support claims require the actual exact-source CI result; mocks are not evidence
of native platform execution. Interactive visual acceptance and fresh IDE-agent
acceptance remain separate from deterministic runtime/MCP tests.
