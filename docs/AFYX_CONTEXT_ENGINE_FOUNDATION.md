# AFYX-290 — Native Afyx Context Engine Foundation

Status: **REVIEW CORRECTIONS IMPLEMENTED; NEW EXACT-HEAD CI PENDING**

## Architecture decision

ACE follows **Standalone by Design, Integrated by Contract**. The MVP is a
dependency-free Node.js package in `afyx-context/`. It owns classification,
selection, exact-repeat reduction, content-addressed originals, retrieval, and
owner/session boundaries. It imports no Graph, Forge, skill, Headroom, provider,
or Kit lifecycle code.

The optional boundary is `ace.integration/v1`. A consumer supplies ordinary
segments and remains responsible for its own lifecycle. The adapter returns the
original rendered context if ACE is absent, refuses the request, or fails. The
foundation deliberately does not register MCP, alter provider routing, or add a
new default Kit component.

## Capability matrix

| Capability | Native ACE MVP | Standalone | Optional contract |
|---|---|---:|---:|
| Conservative classification | Explicit hints plus protected diagnostic/security/exact-source detection | Yes | Inputs preserved |
| Exact repeated-content reduction | Content SHA-256 and shorter stable reference | Yes | Yes |
| Context budget | Protected-content reservation and fail-safe passthrough | Yes | Yes |
| Original retrieval | Content-addressed store with hash verification | Yes | Yes |
| Ownership/session boundary | State owner binding and session-scoped references | Yes | Yes |
| CLI/API | `afyx-context reduce/get`; `AfyxContextEngine` | Yes | N/A |
| Graph | No dependency | Yes | `graph` consumer identifier |
| Engineering Expert | No dependency | Yes | `engineering-expert` identifier |
| Forge | No dependency | Yes | `forge` identifier |
| Kit | No lifecycle takeover or preset membership | Yes | Descriptor and `kit` identifier |
| Headroom | External behavioral comparator only | Yes | None |

### External behavioral reference

Public Headroom v0.37.0 documentation describes proxy, library/sidecar, and MCP
surfaces; session-aware compression; content-type routing; and recoverable
originals through CCR. Its proxy documentation also distinguishes token-saving
and prefix-cache modes and protects selected reads from lossy handling. These
behaviors informed only the capability questions above—standalone operation,
classification, session boundaries, and recovery—not ACE source or algorithms.
Primary references: [Headroom proxy documentation](https://github.com/headroomlabs-ai/headroom/blob/main/wiki/proxy.md),
[Headroom quickstart](https://github.com/headroomlabs-ai/headroom/blob/main/docs/content/docs/quickstart.mdx),
and [v0.37.0 release record](https://github.com/headroomlabs-ai/headroom/releases/tag/v0.37.0).

## Correctness and failure behavior

- `diagnostic`, `security`, and `source-evidence` are never replaced by a
  reference. Conservative automatic classification may retain more content but
  never removes protected bytes.
- Input is fully validated before content writes. State without an ACE owner
  manifest, a foreign owner, an aliased state root, malformed references,
  cross-session references, missing originals, and digest mismatch fail closed.
- If protected content exceeds the budget, or the remaining budget cannot carry
  a useful original/reference selection, the result is byte-complete
  `passthrough`; there is no silent truncation.
- Every item retains its digest, provenance object, classification, disposition,
  and stable recovery reference. Originals are verified during retrieval.

- Optional-adapter validation is inside the failure boundary. Malformed input,
  unavailable ACE, and engine failure return a bounded fallback rather than a
  raw exception; `originalInput` preserves the supplied input and
  `originalComplete` identifies whether its rendered form is complete.
- Explicit request, identity, CLI, metadata, blob, session-content, and
  observation limits bound the standalone surface. Invalid CLI input is
  rejected before any state directory is created.
- Original blobs and metadata use owned temporary files, `fsync`, and rename.
  Existing blobs are integrity-preflighted before new writes. A complete orphan
  blob from an interrupted metadata commit is adopted on retry; truncated
  metadata remains unchanged and fails closed.

## Verification baseline

The deterministic synthetic fixture contains one exact security diagnostic and
twelve identical large tool-output segments. The raw rendered baseline is
34,242 characters. Native ACE produces 4,289 characters, saving 29,953
characters (87.4744%), while every reduced original is recovered byte-for-byte.
The post-review single Windows run completed in 26.9226 ms with process RSS
62,963,712 bytes. RSS is a process snapshot that includes Node startup/runtime;
it is not incremental ACE memory or a cross-host performance claim.

The focused suite contains 22 passing tests for standalone behavior,
ownership/session/integrity boundaries, malformed-adapter fallback, resource
limits, CLI prevalidation, interrupted metadata commit and retry, corrupt-blob
preflight, and truncated-metadata fail-closed behavior. Exact-head CI for
`4f5abc1` predates these corrections and is historical only.

External Headroom A/B is **NOT_RUN**: the live installation uses existing
provider/proxy routing, and no equivalent isolated API/harness was available
without touching excluded configuration. No comparative superiority claim is
made.

## Provenance and independence inventory

| Item | Source/owner | Runtime dependency | License/evidence |
|---|---|---|---|
| ACE source, tests, schemas, docs | New Afyx implementation in this repository | Node.js built-ins only | MIT (`afyx-context/LICENSE`) |
| SHA-256, filesystem, CLI, test runner | Node.js standard library | Node.js >=22.5 | Node.js runtime supplied externally |
| Integration schema | New Afyx contract | None | Repository source |
| Synthetic benchmark fixture | Generated by `scripts/benchmark.mjs` | None | No third-party content |
| Headroom | External; behavior/reference comparator only | None | Not copied, linked, bundled, or modified |
| Afyx Graph session reduction | Separate Afyx product behavior | None | Not imported or copied into ACE |

This inventory supports implementation independence for the shipped MVP. It is
not a complete legal audit of every development-environment artifact, so no
broader legal-independence claim is made.

## Known limitations

- State is local plaintext; the caller owns filesystem ACLs and retention.
- The v1 store is single-writer. Concurrent process coordination and stale-lock
  recovery are not implemented.
- Reduction is exact-match only; semantic compression is intentionally absent.
- Kit lifecycle installation and real Graph/Forge/Expert adapters are deferred;
  only their versioned optional boundary exists.
- Headroom comparative behavior, model tokenization, and incremental memory are
  `NOT_RUN`. Character reduction is measured, not estimated token savings.

## Acceptance targets

- `ACE_STANDALONE`: working API/CLI, local state, reduction and retrieval.
- `ACE_OPTIONAL_INTEGRATION`: one versioned adapter contract with original fallback.
- `ACE_FAILURE_ISOLATION`: consumer test remains functional when ACE throws.
- `ACE_INDEPENDENCE`: no mandatory Afyx/external runtime dependency and explicit provenance.

The next engineering action after review is a separately scoped single-writer
coordination design before any multi-process or MCP integration.
