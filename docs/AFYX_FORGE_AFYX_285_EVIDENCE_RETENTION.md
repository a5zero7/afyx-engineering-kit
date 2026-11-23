# AFYX-285 Forge evidence-retention gate

Status:

- **PUBLIC CONTRACT IMPLEMENTED**
- **OWNER RECORDER/VERIFIER INTEGRATION PENDING**
- **FORMAL CAMPAIGN BLOCKED — 0/36**

This follow-up is based on the reviewed PR #61 public controller at
`83eccc114c81df0bd646e6dcb876f2320ce668e1`. It adds only a public,
synthetic-testable retention contract. It does not open, enumerate, configure,
or administer an evaluator archive and contains no privileged recorder,
credentials, private evidence, model execution, or benchmark runner.

## Contract

`EvidenceRetentionRecorder` and the separately injected
`EvidenceReceiptVerifier` establish two fail-closed boundaries:

1. Before workspace creation or launch, `prepare()` must return a structurally
   valid readiness receipt and the independent verifier must accept it.
2. Before an execution result can qualify as `PASS`, `finalize()` must return a
   valid durable-capture receipt and the independent verifier must accept it.

Both receipts bind the evaluation run, control run, cell, scenario, candidate,
candidate content, fixture, and environment identities. They also bind an
opaque path-free evidence-session identifier and a fresh controller challenge
that prevents replay of a receipt from an earlier execution with otherwise
identical public inputs. Finalization additionally binds
the readiness receipt, terminal-state digest, and the fixed capture scope:
process state, raw stdout, raw stderr, and workspace state. The launcher sees
the evidence-session identifier so an independently implemented capture layer
can correlate the process without receiving an archive path from this code.

Receipt acceptance requires exact type, schema, stage, correlation, frozen
fingerprints, canonical digest, fixed scope, and independent verification. A
mapping or boolean such as `success=true` is not a receipt. Missing, stale,
mismatched, partial, unverified, or failed finalization therefore cannot yield
`PASS`. Verifier success has the strict return contract `None`; any other
return value is an invalid receipt verification and fails closed.

The retention-required public result is schema version 2. Version 1 remains
explicitly interpretable only through an opt-in historical compatibility path,
which classifies it as `HISTORICAL_ONLY`; it is rejected by default and cannot
qualify for current acceptance. Version 2 is classified as `CURRENT_SCHEMA`
and requires verified readiness and finalization for `PASS`. This public schema
transition does not change the frozen campaign manifest or authorize execution.

## Public output and failures

Only four bounded retention fields are public: readiness/finalization booleans
and their SHA-256 receipt identities. Evidence-session identifiers, archive
locations, raw output, exception text, credentials, and adapter-defined keys
are never published. New stable failure codes are:

- `evidence_archive_not_ready`
- `evidence_archive_finalize_failed`
- `evidence_receipt_invalid`

Cleanup remains independent. A valid finalization receipt cannot hide or
override `cleanup_failed`, nor can it convert any launcher, sanitization,
inventory, artifact, identity, timeout, or process-tree failure into `PASS`.
Finalization is attempted for a prepared session even after launcher failure so
the trusted boundary can retain failure/interruption state before workspace
cleanup.

## Owner integration boundary

The public fakes prove deterministic contract enforcement only. Before use,
the owner/evaluator must independently implement and review both the recorder
and verifier, prove archive durability and raw-stream capture at the actual
restricted launcher boundary, preserve private raw evidence outside developer
and evaluated-agent access, and adversarially test interruption and recovery.
The controller's bounded stdout/stderr digests remain sanitized publication
metadata; they are not proof that complete originals were durably archived.

Owner review must prove four separate properties without treating one as a
substitute for another:

1. public receipt metadata integrity: bounded public fields and canonical
   receipt digests match the declared controller binding;
2. private original-artifact integrity: retained originals are complete and
   their private integrity records are verified outside the public repository;
3. independent verifier authenticity and anti-replay persistence: the verifier
   is independently controlled and durably remembers challenges/session state;
4. actual archive durability and recovery: interruption, retention, restore,
   and recovery are demonstrated in the owner-controlled runtime.

Developer-side fake recorders and verifiers test only the public interface and
failure semantics. They are not evidence of owner-runtime acceptance for any
of these four properties.

Historical D1–D3 FAIL and all previously reported BLOCKED/INCONCLUSIVE states
remain unchanged. Unrecovered original evidence remains UNLOCATED/NOT VERIFIED.
No historical synthetic observation is relabeled as formal benchmark evidence.

## Validation

The deterministic tests cover ready/finalized success; no readiness; recorder
and independent-verifier failure; missing, boolean-only, stale, mismatched, and
partial receipts; failure-state finalization; cleanup precedence; path-free
public metadata; private-like exception suppression; canonical hashing; and all
prior controller regressions.

Observed developer-side validation for this change:

- controller unit tests: `39/39` PASS;
- controller plus Forge readiness tests: `51/51` PASS;
- deterministic repository suite: `178/178` PASS;
- static manifest and fixture/materialization validation: PASS;
- Python compilation and `git diff --check`: PASS;
- frozen manifest, B0–B5 candidates, public fixtures, and 36-cell order:
  unchanged.

The seven campaign authorization gates remain unresolved. This contract is not
privileged deployment, evidence attestation, security acceptance, A8 GO, or
formal benchmark authorization.

**Final campaign status: CAMPAIGN BLOCKED — 0/36.**
