# AFYX Native Skill Host Adapter — Trusted Integration Contract

**Status:** source implementation and isolated test fixtures only, pending real owner/provider acceptance. This work is stacked on draft PR #12; it does not change the seven canonical installer components or enable a background process.

## Intent and threat model

`scripts/afyx-native-skill-host.mjs` bridges `AfyxSkillEngineering/v1` into the existing universal capability router. The agent may select `skill-authoring-lifecycle` for a relevant task, but an agent-supplied task/MCP payload must **never** supply a write plan, provider root, file content, or approval. They come solely from a trusted host that has already presented the proposed operation and scope to the owner.

The adapter is unavailable by default. The installed runtime creates `afyx-skill-engineering` as an observed, authorized capability **only** when an in-process caller supplies `trustedSkillEngineering` with a complete plan and a synchronous `authorize(proposal)` callback. `invokeHostWorkflow` passes this object from **host options**; the MCP `tools/call` accepts only model-controlled `task` (and existing bounded task budgets). It does not spread tool arguments into host options. Plain `node scripts/afyx-host-bridge.mjs serve --mcp` is intentionally still read-only with respect to skill creation.

## Host-owned integration API

A trusted application or provider extension may create an isolated host profile and invoke:

```js
import { invokeHostWorkflow } from './scripts/afyx-host-bridge.mjs';

const trustedSkillEngineering = {
  provider: 'codex',
  scope: 'workspace',
  draftsRoot: '/absolute/isolated/drafts',
  skillsRoot: '/absolute/isolated/provider-skills',
  peerRoots: [],
  spec: {
    name: 'afyx-workspace-reviewer',
    description: 'Review local workspace changes for workspace review requests.',
    triggers: ['workspace review'],
    body: '# Procedure\n\nInspect the requested repository evidence.\n',
  },
  // Never derive approval from the model or MCP arguments.
  // This callback must use the owner's trusted UI/approved host state.
  authorize: (proposal) => ownerHasApprovedExactProposal(proposal),
};
const result = await invokeHostWorkflow({
  task: { taskType: 'skill-authoring',
    needsCustomCapability: 'skill-authoring-lifecycle' },
  provider: 'codex',
  installRoot: '/absolute/isolated/kit',
  projectRoot: '/absolute/isolated/project',
  authorizations: { 'afyx-skill-engineering': true },
  trustedSkillEngineering,
});
```

The example is *illustrative*; `ownerHasApprovedExactProposal` is supplied by the trusted host application. It is not an AFYX implementation or a shortcut to owner consent. All roots must exist, be absolute and safe, and the draft root cannot overlap the provider skill root. No root is inferred from the user's daily Codex/Antigravity profile. The host must select an actual supported provider and scope.

## Exact lifecycle and rollback boundaries

1. Host selects exact immutable skill specification and target roots; it must obtain affirmative owner approval for `CREATE_DRAFT` before any source write.
2. Adapter creates a new draft only when the target draft does not exist, validates it, and packages it with deterministic content SHA-256.
3. Installer checks ownership, foreign skills, trigger conflicts, provider scope, stale preview and peer roots. This adapter's first release allows **INSTALL only**, not automatic UPDATE.
4. A **separate** host approval is required for the concrete `INSTALL` preview. Then `applySkillInstall` revalidates and writes atomically, and `verifySkillInstall` confirms the installed content.
5. The host adapter consumes its plan before any filesystem write; repeated or concurrent use of the same adapter is rejected. If installation approval is denied, the isolated draft remains as review evidence and the provider root is untouched. No automatic secret use, helper execution or vendor API call occurs.

The model-facing result reports only provider, scope, skill name, content digest and verification status. It does not expose OS file paths, source bodies, tokens or approval details. Other existing seven components remain independent.

## Negative cases / acceptance

Automated fixtures cover: explicit host authorization; missing trusted configuration; model-provided fake approval or paths; explicit OFF; denied draft/install approval; provider mismatch; one-shot semantics; foreign skill preservation; created-package-installed digest verification. This is an **in-process trusted host path**, not proof that the Codex or Antigravity IDE has listed or invoked the generated skill.

Real owner acceptance still requires a fresh authorized Codex or Antigravity session with the correct candidate launch path, actual provider skill discovery and final `RESULT_CONSUMED` evidence in the agent's answer. Generic MCP registry success is insufficient. No external `skill-creator` or `1password` removal is permitted until replacement parity and explicit owner consent. Credential Broker remains separate with mock-only backend and no real 1Password vault access.

### Build and test

```powershell
node --test --test-concurrency=1 scripts/tests/test_native_skill_host_adapter.mjs scripts/tests/test_native_skill_broker.mjs scripts/tests/test_native_universal_integration.mjs scripts/tests/test_capability_orchestrator.mjs scripts/tests/test_host_bridge.mjs scripts/tests/test_universal_runtime.mjs
python scripts/validate-components.py
```

Run on the exact candidate SHA in a clean disposable worktree. Do not interpret source-only tests as hosted CI or real IDE acceptance.
