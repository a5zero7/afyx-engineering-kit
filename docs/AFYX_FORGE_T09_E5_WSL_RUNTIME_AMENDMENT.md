# AFYX Forge T09.E5 proposed WSL formal-runtime amendment

Version: **0.1.0-proposed**

Date: 2026-10-17 (Asia/Jakarta)

Status: **CONDITIONAL FEASIBILITY / NOT APPROVED / CAMPAIGN BLOCKED — 0/36**

Baseline: `7d933bf1d9ead89ff7052ef7ca0e7680ee1f3dd7` (PR #63 merge)

Jira: AFYX-285

## 1. Scope and authority

This document proposes, but does not approve, an amendment to the
[T09.E1 secure evaluator handoff](AFYX_FORGE_T09_E1_SECURE_HANDOFF.md). Until
the owner and independent evaluator approve a final amendment, T09.E1 remains
authoritative: formal cells are native-Windows only and WSL is excluded.

The proposal assesses whether the existing Ubuntu WSL2 environment could host
the formal evaluated workload. It does not implement a runner, install Docker,
change WSL or Windows configuration, access private evidence, invoke a model,
or execute any B0-B5 cell. The frozen manifest, candidate and fixture
identities, 36-cell order, result schemas, and historical evidence are not
changed.

Feasibility verdict: **CONDITIONAL**. WSL2 can provide the Linux substrate for
a formally constrained evaluated workload, but the existing personal distro
cannot become the entire trust boundary unchanged. Linux accounts inside a
personal WSL distro do not isolate data from the controlling Windows user or
WSL administrator. A container adds useful workload isolation but does not
make the evaluator independent of that host administrator. Formal use is
therefore feasible only with the split-plane architecture and all acceptance
evidence below. Otherwise the proposal is rejected and T09.E1 remains in
force.

## 2. Evidence reused and host observations

The following accepted public evidence remains valid within its original
identity and scope:

- PR #61 public controller interfaces and fail-closed lifecycle behavior;
- PR #62 [evidence-readiness, finalization, receipt, replay, and sanitized
  public-result contracts](AFYX_FORGE_AFYX_285_EVIDENCE_RETENTION.md);
- PR #63 [T09.E4 actual WSL subprocess and raw-stream retention
  evidence](AFYX_FORGE_T09_E4_WSL_LAB.md), including its focused negative
  cases;
- the accepted `178/178` deterministic repository result and frozen public
  identities recorded by AFYX-285.

T09.E4 proves same-user subprocess execution and local synthetic retention
only. It does not prove an independent evaluator, restricted identity,
protected-storage denial, credential/network containment, immutable retention,
or formal runtime acceptance. None of its `NOT_TESTED` hard gates is promoted
by this proposal.

A read-only feasibility snapshot of the current shell observed WSL2 kernel
`6.6.114.1-microsoft-standard-WSL2`, cgroup v2, a nonzero user-namespace limit,
and `/mnt/c` exposed to the distro. Docker and Podman executables were not
found. The current shell reported `NoNewPrivs=1` and seccomp mode 2, but those
are properties of this developer session, not a future evaluated process.
This snapshot is not acceptance evidence and is not a frozen environment
fingerprint.

## 3. Windows-to-WSL requirement reconciliation

| Existing requirement | Classification | Proposed WSL treatment |
|---|---|---|
| Four roles: developer, evaluator, restricted agent, controller | Unchanged and reusable | Preserve distinct authority and data visibility; a UID label alone is insufficient. |
| Frozen input, candidate, fixture, environment, and cell identities | Unchanged and reusable | Preserve exact schemas and public digests; add a separately approved WSL runtime-envelope digest. |
| Zero retries, bounded timeout, fail-closed results, and ordered lifecycle | Unchanged and reusable | Preserve without weakening. |
| Readiness before launch; finalization before success; cleanup recorded separately | Unchanged and reusable | Reuse controller/retention protocols; replace the lab recorder with an evaluator-owned implementation. |
| Private rubric, holdout, canary, credentials, and raw evidence never enter the agent workspace | Unchanged and reusable | Keep all protected material outside the WSL workload plane. |
| Native-Windows restricted account and non-admin token | Platform amendment required | Replace with a non-root container UID, user namespace mapping, empty supplementary groups, zero effective capabilities, `no_new_privileges`, and seccomp enforcement. |
| Windows ACL denial for evaluator storage | New enforcement and evidence | Evaluator storage must be outside the personal distro and not mounted or addressable from the workload container; denial must be tested from the actual agent identity. |
| Windows Job Object/process-tree termination | Platform amendment required | Use a dedicated PID namespace plus cgroup v2; timeout kills the entire cgroup and verifies it is empty before cleanup. |
| Task Scheduler/deployment suitability | Not applicable | No scheduled Windows task exists in the proposed lifecycle; replace it with a reviewed, one-cell controller invocation. |
| Windows path, alternate drive/share, junction, and reparse tests | Platform amendment required | Replace with Linux absolute/traversal, symlink, hard-link, bind-mount, mount namespace, `/proc`, `/sys`, `/dev`, socket, DrvFS/9P, and Unix permission tests. |
| Windows-only execution and total WSL exclusion | Requires explicit owner amendment | Replace only after approval with a WSL2-only workload envelope that excludes Windows interop, DrvFS, host shares, and other WSL distributions from the agent container. |
| No owner profile, clipboard, shared folder, or credential inheritance | Unchanged objective; new evidence | Start from an allowlisted empty environment; mount only the cell workspace; provide no home, agents, keyrings, sockets, clipboard bridge, or Windows path. |
| Provider connectivity terminates at the trusted controller | Unchanged and reusable | Agent network namespace remains disconnected. Any provider client and credential stay in the external trusted control plane. |
| Immutable raw evidence, recovery, independent verification, and sanitized publication | Unchanged objective; new enforcement | Use evaluator-owned append-only storage and keys outside WSL; test interruption, restore, tamper, replay, and recovery. |
| Independently reviewed runner and final owner authorization | Unchanged and reusable | Require a frozen container image, launcher policy, recorder/verifier, and signed acceptance attestation before any campaign cell. |

Windows-specific checks are replaced only by controls that defend the same
property. They are not silently removed. Windows-specific historical PASS or
FAIL observations do not transfer to the WSL amendment.

## 4. Proposed minimum formal architecture

```text
owner approval plane
  -> approves immutable campaign and WSL runtime envelopes

independent evaluator/control plane (outside the personal WSL distro)
  -> owns private bundle, scoring, provider credentials, recorder/verifier keys
  -> issues one signed cell request and receives raw streams/process state
  -> writes append-only evidence and emits only sanitized attestation metadata

WSL workload gateway (no private material or provider credential)
  -> accepts only a frozen signed request through a narrow authenticated channel
  -> launches one digest-pinned, hardened container and supervises its cgroup

restricted evaluated-agent container
  -> non-root user in user/PID/mount/network/IPC namespaces
  -> read-only image; one disposable workspace mount; bounded tmpfs
  -> no network, Docker socket, host home, /mnt, Windows interop, or evidence mount
```

### 4.1 OS-enforced controls

The acceptance environment must enforce, not merely document:

- a digest-pinned Linux image with no mutable tag resolution during a cell;
- user namespace mapping, non-root runtime UID/GID, no supplementary groups,
  all capabilities dropped, `no_new_privileges`, and a reviewed seccomp policy;
- separate PID, mount, network, IPC, and UTS namespaces;
- read-only root filesystem, bounded tmpfs, and exactly one workspace bind
  mount with canonical source and destination;
- no `/mnt/*`, Windows executable interop, host home, SSH/GPG agent, keyring,
  Docker/container socket, controller socket, or evaluator path in the mount
  table;
- cgroup v2 CPU, memory, PID, and wall-time bounds, followed by whole-cgroup
  termination and an empty-cgroup/orphan check;
- a network namespace with no external, host, gateway, metadata, DNS, or
  loopback service route except a specifically reviewed one-way protocol if the
  controller design proves it necessary;
- per-cell container and workspace creation from an empty state, then removal
  after finalization with cleanup outcome reported independently.

The Windows host and WSL administrator remain able to control the distro.
Therefore these controls isolate the evaluated workload from ordinary host
resources; they do not establish evaluator independence from the host owner.

### 4.2 Application-level controls

The existing public controller continues to validate frozen inputs,
materialize exact public content, inventory mutations, sanitize public output,
and enforce receipt semantics. A new owner/evaluator implementation must:

- verify the signed runtime and cell envelopes before allocating a workspace;
- allowlist an empty process environment and a fixed executable/argument plan;
- capture original stdout/stderr at the container boundary without truncation;
- record container/image/config, process, cgroup, mount, network, workspace,
  timeout, termination, and cleanup state;
- correlate every record to the existing evidence binding and fresh challenge;
- finalize evidence before public success and reject stale or replayed state;
- send raw evidence only to evaluator-owned storage and expose only the
  existing sanitized public schema.

These are application responsibilities backed by OS controls; declarations in
JSON or logs alone are not enforcement.

### 4.3 Docker decision

Native WSL primitives are technically capable of namespaces, cgroup v2, and
seccomp, but the repository has no independently reviewed native namespace
launcher or policy compiler. Building one would enlarge the trusted computing
base. A digest-pinned container runtime supplies a reviewable image, namespace,
mount, resource, and lifecycle envelope and is therefore the minimum justified
implementation dependency for this proposal.

Docker is not currently installed and must not be installed by this task. A
future implementation must prefer a dedicated rootless daemon controlled only
by the workload gateway, or document why a rootful daemon is necessary. The
agent must never receive a Docker socket; membership in a rootful `docker`
group is equivalent to host-level authority. `--privileged`, host PID/network,
host root mounts, device passthrough, and unreviewed image pulls are forbidden.

Docker does **not** solve host-administrator trust, kernel sharing, evaluator
independence, evidence durability, or Windows access to the distro. Those gaps
require the external evaluator/control plane, independently controlled storage,
and an owner-approved host custody model. If independent custody of the WSL
workload cannot be established for the campaign window, this amendment is
**NOT FEASIBLE** for formal use even if every container test passes.

## 5. Required acceptance evidence

All tests run under the exact proposed identities and frozen runtime envelope.
An error, missing observation, unverifiable denial, or substituted identity is
`BLOCKED`, never PASS.

### 5.1 Positive controls

1. Independently attest the controller, image digest, kernel/WSL/runtime
   versions, namespace/cgroup/seccomp policies, mount plan, network plan,
   public source revision, private-bundle digest, and recorder/verifier IDs.
2. Prove the restricted UID can read/write only the disposable workspace,
   execute the fixed toolchain, and complete a public synthetic control.
3. Prove readiness precedes container creation, complete originals are
   retained, finalization precedes public success, and cleanup follows as a
   separate result.
4. Restore a retained synthetic record from the approved archive and reproduce
   its original byte digests, process state, binding, receipt, and signature.

### 5.2 Negative and adversarial controls

1. From the actual agent identity, attempt enumeration/read/write of evaluator
   storage, private bundle, controller home, developer home, `/mnt`, other WSL
   distributions, Windows executables, host sockets, and credential locations;
   every attempt must be conclusively denied without disclosing a private path.
2. Attempt path traversal, absolute paths, symlinks, hard links, bind mounts,
   mount namespace escape, device access, `/proc` cross-process inspection, and
   Unix-socket access; deny and retain the terminal state.
3. Attempt DNS, TCP/UDP, loopback, WSL gateway, Windows host, link-local
   metadata, and undeclared controller endpoints; deny all undeclared routes.
4. Attempt capability gain, setuid/setgid execution, namespace creation outside
   policy, ptrace, raw sockets, keyring access, and writes to the read-only
   image; deny with zero effective capability afterward.
5. Exercise normal exit, nonzero exit, signal ignoring, double-fork/orphan,
   PID exhaustion, memory/CPU limits, timeout, controller interruption, and
   forced kill; verify the cgroup is empty before cleanup.
6. Exercise capture failure, stream truncation, evidence tampering, stale and
   replayed receipts, archive unavailability, partial write, disk-full, process
   crash, and recovery after forced interruption; no case may yield PASS.
7. Attempt environment, profile, Git helper, SSH/GPG agent, cloud metadata,
   provider token, clipboard, and inherited file-descriptor discovery; no
   secret or owner/evaluator value may be observable.

### 5.3 Independent review and transition controls

- The independent evaluator reviews and freezes the runner, container image,
  policies, storage, keys, and test implementation outside developer control.
- The evaluator publishes a signed, sanitized acceptance attestation with
  exact digests and PASS/FAIL/BLOCKED outcomes, never raw evidence.
- The owner verifies the attestation and separately decides whether the WSL
  threat model and custody are acceptable. Passing technical controls does not
  approve the amendment or campaign.
- After approval only, a later change may update the authoritative handoff and
  environment proposal. Any identity change invalidates acceptance and returns
  the runtime to BLOCKED.

## 6. Current disposition

### PASS — reusable only within recorded scope

- PR #63 is merged at the stated baseline.
- Public controller and retention contracts are accepted developer-side.
- T09.E4 proves actual same-user WSL subprocess capture and local synthetic
  lifecycle behavior.
- Frozen public candidate, fixture, and 36-cell identities remain unchanged.
- The historical deterministic `178/178` result remains accepted and was not
  rerun for this proposal.

### NOT TESTED

- hardened container launch under a distinct restricted identity;
- namespace, capability, seccomp, mount, network, and cgroup policy;
- evaluator-storage and credential denial from the actual agent identity;
- external original-stream capture, append-only durability, signed integrity,
  restore, and interruption recovery;
- independent host custody and resistance to WSL/Windows administrator action;
- provider termination at the external trusted controller;
- the complete positive, negative, and adversarial acceptance suite.

### BLOCKED

- approval of this amendment and its threat model;
- an independently controlled evaluator/control plane and evidence store;
- exact container engine choice/version, image digest, and frozen policy;
- exact WSL/Windows host custody and reproducible environment fingerprint;
- all seven existing campaign gates: runtime, evaluator isolation, 36-cell
  budget, confirmation policy/budget, evaluator arrangement, final execution,
  and evaluator-only bundle freeze.

## 7. Minimum justified future implementation scope

No implementation is authorized by this proposal. If the owner approves the
architecture, the smallest justified engineering change is one independently
reviewed WSL container launcher/adapter plus an evaluator-owned recorder and
verifier integration. It must reuse the current public controller protocols
and must not change the manifest, candidates, fixtures, or result schema.

Minimum dependencies are a pinned container engine/runtime, cgroup v2,
user/PID/mount/network namespaces, seccomp, a digest-pinned image registry or
offline image artifact, an authenticated narrow control channel, and
evaluator-owned append-only storage and signing keys. Docker installation,
host hardening, account provisioning, storage selection, and key management
are owner/evaluator deployment actions, not repository implementation steps.

## 8. Owner/evaluator decisions and abort policy

Before implementation, the owner must explicitly decide:

1. whether a personal WSL host can ever satisfy campaign custody, or whether
   an evaluator-controlled host/distro is mandatory;
2. whether to approve Docker as the minimum workload-isolation dependency and
   whether rootless mode is mandatory;
3. the external evaluator/controller operator, evidence store, retention and
   recovery policy, signing authority, and provider-connectivity boundary;
4. the exact runtime/image/policy fingerprint and change-control rule;
5. whether the amendment replaces T09.E1 for all cells or is rejected;
6. each of the seven existing campaign gates, separately and only after fresh
   acceptance evidence.

Any unexpected mount or route, credential/private marker exposure, identity or
digest drift, incomplete capture/finalization, orphan process, cleanup failure,
archive/verification failure, host-custody ambiguity, or inconclusive negative
test aborts acceptance. No automatic retry, mixed Windows/WSL campaign,
partial-result promotion, or fallback execution is permitted. Rollback means
discarding the unapproved WSL envelope and returning to the unchanged T09.E1
native-Windows contract; it does not reinterpret historical results.

## 9. Jira-ready handoff

T09.E5 verdict is **CONDITIONAL**. PR #63 evidence is reused without rerunning
T09.E4 or the accepted 178-test baseline. WSL2 is suitable only as a hardened
evaluated-workload plane. The existing personal distro is not an independent
evaluator boundary; Docker is justified for reproducible namespace/cgroup/
mount/network containment but does not solve host-admin trust or evidence
independence. Approval requires an external evaluator/control and evidence
plane, frozen container/runtime policy, fresh adversarial acceptance, explicit
host-custody decision, and all seven existing owner gates. No runtime was
implemented and no campaign cell ran. Status remains **BLOCKED — 0/36**.

## 10. Non-normative technical references

- [Microsoft WSL configuration](https://learn.microsoft.com/windows/wsl/wsl-config)
- [Microsoft WSL command reference](https://learn.microsoft.com/windows/wsl/reference)
- [Microsoft WSL file permissions](https://learn.microsoft.com/windows/wsl/file-permissions)
- [Docker Engine security](https://docs.docker.com/engine/security/)
- [Docker user-namespace isolation](https://docs.docker.com/engine/security/userns-remap/)
- [Docker seccomp profiles](https://docs.docker.com/engine/security/seccomp/)
- [Linux kernel seccomp documentation](https://kernel.org/doc/html/latest/userspace-api/seccomp_filter.html)
