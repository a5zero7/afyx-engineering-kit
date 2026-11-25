# AFYX Forge T09.E6 WSL workload-isolation prototype

Status: **SOURCE PASS / RUNTIME NOT TESTED / FORMAL CAMPAIGN BLOCKED — 0/36**

Date: 2026-10-17 (Asia/Jakarta)

Baseline: `da0f26597686013b9c15dcae0667aa78e4f8c759` (PR #64 merge)

Jira: AFYX-285

## Scope

This public synthetic development prototype implements the minimum container
workload adapter proposed by the unapproved
[T09.E5 WSL runtime amendment](AFYX_FORGE_T09_E5_WSL_RUNTIME_AMENDMENT.md).
It reuses the accepted public controller `RestrictedProcessLauncher` protocol
and does not change the controller, recorder, verifier, public schemas, frozen
manifest, B0-B5 candidates, fixtures, or historical evidence.

No container runtime was available in the development environment. Docker or
Podman was not installed, no host configuration changed, and no container,
model, private evaluation, or campaign cell was executed. Source-level success
does not establish operating-system isolation.

## Implementation boundary

`evals/forge/wsl_container.py` separates three responsibilities:

1. `build_synthetic_policy()` generates the one supported policy from an
   independently supplied image digest, workspace, and seccomp identity.
2. `validate_policy()` rejects unsafe or unverifiable policy before any
   runtime interaction. `build_docker_run_argv()` then produces an immutable
   argv tuple without a shell.
3. `WslContainerLauncher` implements `RestrictedProcessLauncher` and maps a
   dependency-injected `ContainerRuntime` result to the existing
   `ProcessOutcome`. `DockerCliRuntime` is an optional backend for later
   acceptance and fails naturally when Docker is unavailable.

Evidence readiness, finalization, verification, sanitization, workspace
cleanup, and public result construction remain owned by the existing
controller and recorder/verifier interfaces. This adapter neither duplicates
nor bypasses them. A later real backend must connect complete container-boundary
streams to the evaluator-owned recorder; that integration is not proven here.

## Exact generated policy

The supported policy requires:

- image reference ending in `@sha256:` plus exactly 64 lowercase hex digits;
- pull policy `never`, so an absent pinned image fails instead of using network;
- UID/GID `65532:65532`, never root;
- read-only root filesystem;
- exactly one writable bind mount: the controller-created workspace to
  `/workspace`;
- workspace below the approved workspace root and outside `/home`, `/root`,
  `/mnt`, `/run`, and `/var/run`;
- network mode `none`;
- private PID and IPC modes with an injected init process for child reaping;
- `--cap-drop ALL`, no added capabilities, and no privileged mode;
- `no-new-privileges:true`;
- repository-owned default-deny seccomp profile
  `synthetic-seccomp-v1.json`, SHA-256
  `f2fe79d3ab15935ab4651c7ee51fa79662d650752c9024dcfb752fa4fa1452a0`;
- at most 32 PIDs, 256 MiB memory, 1 CPU, 16 MiB `/tmp` tmpfs, and a
  300-second maximum request timeout;
- fixed `/opt/afyx/bin/forge-synthetic-cell --mode public-synthetic`
  executable boundary;
- fixed workdir `/workspace`, `HOME=/nonexistent`, and
  `PATH=/usr/bin:/bin`;
- named-container removal followed by an inspect result that explicitly names
  that container as not found before reporting the workload terminated;
  daemon, authorization, malformed-output, timeout, and other inconclusive
  inspection failures remain fail-closed. The name is derived from the fresh
  evidence-session correlation, image, and disposable workspace.

The seccomp profile defaults to `SCMP_ACT_ERRNO` and allowlists only the
syscalls required by the proposed fixed synthetic executable. It explicitly
rejects profiles that allow networking, namespace creation, mount operations,
ptrace, kernel/keyring administration, raw BPF, reboot, or similar forbidden
operations. Runtime compatibility of this allowlist remains `NOT TESTED`.

## Fail-closed configurations

Policy validation rejects:

- mutable tags, missing digests, malformed digests, or uppercase image names;
- root UID/GID, privileged mode, writable root filesystem, host networking,
  capability retention, or disabled `no_new_privileges`;
- extra mounts, host root mounts, workspace outside its approved root, Docker
  socket exposure, unsafe mount syntax, and seccomp sourced from the workspace;
- missing, symlinked, malformed, digest-mismatched, non-default-deny, or
  forbidden-syscall seccomp profiles;
- PID, memory, CPU, tmpfs, or timeout values above the bounded policy;
- executable or argument drift;
- malformed runtime results, incomplete capture, or incomplete
  termination/cleanup observation.

The Docker backend uses argv-only `subprocess` calls. On timeout it requests
container kill through an explicit absolute Docker executable path, bounds its
wait, force-removes the named container, and requires a subsequent inspection
to return a recognized not-found result for that exact name. Any other nonzero
inspection result does not prove absence. Failure to conclusively observe
removal reports
`process_tree_terminated=False`; the existing controller then fails closed.

## Validation evidence

### SOURCE PASS

Command:

```text
python -m unittest scripts.tests.test_forge_wsl_container -v
```

Result: `13/13 PASS`.

The tests cover exact shell-free command construction, digest pinning,
privilege/network/root-filesystem/capability drift, extra and Docker-socket
mounts, workspace containment, resource bounds, seccomp identity and forbidden
syscalls, controller outcome mapping, timeout bounds, incomplete capture, and
incomplete termination/cleanup. The optional Docker backend is mocked to prove
that removal plus an exact, container-bound not-found inspection are both
required before it reports cleanup and whole-workload termination; daemon,
authorization, and unknown inspection failures remain inconclusive.

Python compilation, document reference checks, frozen-scope inspection, and
`git diff --check` are required at closure. T09.E4 tests and the accepted
`178/178` baseline are reused and were not rerun.

### RUNTIME PASS

None. No Docker/Podman executable was present and no actual container command
was run.

### NOT TESTED

- image existence, provenance, pull policy, or executable compatibility;
- actual non-root identity, user/PID/mount/network/IPC namespace enforcement;
- read-only root, mount visibility, seccomp, capability, and resource
  enforcement by a container engine;
- whole-cgroup termination, orphan resistance, container cleanup, and complete
  original-stream capture under real interruption;
- denial of host home, Windows mounts/interop, Docker socket, credentials,
  evaluator storage, private material, and undeclared network routes;
- evaluator independence, host custody, durable evidence recovery, signing,
  provider boundary, or any formal hard gate.

## Owner handoff

The minimum next real acceptance step requires owner/evaluator approval of an
isolated synthetic host, a specific rootless container engine/version, a
real digest-pinned synthetic image containing only the fixed executable, and
the exact seccomp-profile digest. The independent evaluator must then execute
the T09.E5 positive, negative, and adversarial controls while retaining raw
evidence outside WSL and publishing only a sanitized attestation.

Installing Docker, configuring WSL/Windows, provisioning identities, choosing
private storage, and approving any formal requirement remain owner/evaluator
actions. This prototype is not runtime acceptance or approval of the T09.E5
amendment. The native-Windows T09.E1 contract remains authoritative and the
campaign remains **BLOCKED — 0/36**.
