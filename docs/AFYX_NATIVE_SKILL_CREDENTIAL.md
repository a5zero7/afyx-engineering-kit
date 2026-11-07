# AFYX native skill and credential boundaries

Both modules are source-ready, on-demand capabilities in the existing AFYX runtime inventory. They do not add an installer component, provider registration, background process, or vault. The seven shipped components remain unchanged.

## Skill Engineering (`AfyxSkillEngineering/v1`)

`scripts/afyx-skill-engineering.mjs` owns skill creation, revision/repair, validation, deterministic package bytes and SHA-256 inventory, provider-scope negotiation, installation preview, host-approved install/update, integrity verification, interrupted-install reconciliation, and rollback. The caller must supply the provider skill root explicitly. `applySkillInstall`, `reviseSkill`, `rollbackSkillInstall`, and recovery require a trusted host callback returning `true` after reviewing the concrete proposal. A model-supplied task object is not approval.

The parser deliberately accepts a small scalar frontmatter subset. It stores declared AFYX triggers in the standard `metadata` field and requires each trigger to appear in the model-facing description. It rejects unsupported YAML, unsafe file types, traversal, broken local resource pointers, duplicate declared triggers, foreign target replacement, and stale previews. The package is a deterministic JSON byte payload, not a ZIP. Helper scripts are packaged as files but never executed during validation. Provider invocation after installation is a separate host acceptance surface.

Supported provider skill scopes are read from `scripts/components.json`; the host supplies the actual scoped path. The new capability can be selected through the existing orchestrator only when the host reports installed, healthy, compatible, authorized source identity and the task requests `skill-authoring-lifecycle`. It is not automatically selected for unrelated tasks.

## Credential Broker (`AfyxCredentialBroker/v1`)

`scripts/afyx-credential-broker.mjs` owns session-scoped authorization and consent for `inject-process` or `fill-host-field`. Trusted host code supplies adapters, authorization, consent, scope, credential aliases, target aliases, and a short lifetime. The model-facing request cannot supply backend code or additional fields. Adapter output and errors are never returned to the agent. There is no plaintext read operation, persistent secret cache, logging, or automatic provider fallback.

Only a synthetic adapter is exercised in tests. The official 1Password backend is **DEFERRED** because its supported CLI is unavailable in this environment and no authorized live credential-use acceptance was performed. A real host adapter must keep values outside agent output and obtain independent owner approval before use. AFYX-315 retirement cannot proceed on this source-level evidence.

## Reference provenance

The installed `skill-creator` and `1password` references were inspected read-only as behavior examples. Their `.skillfish.json` files identify OpenClaw source revisions `092ba55e2290bef5c06e6d47a83313839cc887a2` and `57066eb1fad4f39a9327e8980e4403fdcbdc9026`. The `skill-creator` installation contains Apache License 2.0 text. The inspected `1password` skill directory has no local license file; its license obligations cannot be concluded from that absence. No reference source, helper script, or asset is shipped by these new AFYX modules. REA 6.7.0 was available as a CLI, but these Markdown/Python reference trees did not present a relevant shipped binary or packaged application target for REA analysis.
