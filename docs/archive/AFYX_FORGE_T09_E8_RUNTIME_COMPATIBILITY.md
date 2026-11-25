# AFYX Forge T09.E8.P2 rootless runtime compatibility

Version: **0.1.1-source**

Status: **SOURCE PASS / ROOTLESS RUNTIME NOT TESTED / FORMAL CAMPAIGN BLOCKED — 0/36**

Date: 2026-10-18 (Asia/Jakarta)

Baseline: `cdf9a3b96092378e4cd33c8fd4a91e1c26977f1e` (PR #68 merge)

Branch: `afyx/t09-e8-p2-runtime-compatibility`

Jira: AFYX-285

## Scope

This change implements only the two source-compatibility gaps accepted in the
[T09.E8.P1 rootless design](AFYX_FORGE_T09_E8_ROOTLESS_PROVISIONING_DESIGN.md):
an explicit Docker endpoint and lease-local mapped-identity workspace access.
It does not install or start Docker, configure the host, build or run an image,
approve T09.E5, or execute a Forge campaign cell.

The public controller `LaunchRequest`, `ProcessOutcome`, recorder, verifier,
raw-stream, finalization, cleanup-reporting, manifest, candidate, and evidence
schemas are unchanged. `WslContainerLauncher` still implements the existing
`RestrictedProcessLauncher` protocol.

## Expected versus actual source behavior

| Requirement | Expected | Actual source result | Classification |
|---|---|---|---|
| Docker endpoint | Every Docker operation names the approved rootless Unix socket | `run`, `kill`, `rm`, `inspect`, `build`, and `image inspect` use `/usr/bin/docker` or the explicitly supplied absolute CLI followed by `--host unix:///run/user/1000/afyx-forge/docker.sock` | SOURCE PASS |
| Context isolation | No inherited daemon selection | Runtime subprocess environments omit `DOCKER_HOST`, `DOCKER_CONTEXT`, and personal `HOME`; build helper uses `HOME=/nonexistent` | SOURCE PASS |
| Fallback denial | Rootful, TCP, relative, or altered endpoint fails before invocation | Only the exact frozen endpoint is accepted | SOURCE PASS |
| Identity mapping | Container UID/GID 65532 is translated from observed maps, never assumed offsets | Injected UID and GID range observations are validated for bounds, overlap, unique coverage, non-root host identity, and subordinate separation from the gateway | SOURCE PASS |
| Lease containment | ACL mutation affects only the current controller lease | The accepted shape is exactly `<approved-root>/<lease>/work`; ancestry, tree, symlinks, inode, owner, group, and world-write state are checked before and after ACL operations | SOURCE PASS |
| ACL access | Workload and gateway retain effective least-privilege access | Existing ACLs are cleared only on the lease directory. Access/default owner is `rwx`; approved named workload UID/GID and gateway UID entries are `rwx`; mask is `rwx`; base group and other are exactly `---` | SOURCE PASS |
| Fail closed | No launch on unverifiable preparation | The numeric observation must equal the complete 14-entry policy; missing, malformed, duplicate, additional, or permission-drifted entries prevent `runtime.execute()` | SOURCE PASS |
| OS enforcement | Real rootless daemon and kernel enforce the policy | No engine or container was invoked | NOT TESTED |

## Explicit Docker endpoint

The only supported endpoint value is:

```text
unix:///run/user/1000/afyx-forge/docker.sock
```

`DockerCliRuntime` constructs a shell-free immutable prefix and uses it for the
initial container process and all lifecycle controls. The T09.E7 helper uses
the same endpoint for build and image inspection. An absent endpoint does not
fall back to `/var/run/docker.sock`; callers receive the frozen default value,
while every supplied alternative is rejected. Absolute executable injection
is retained for the existing source-test/build boundary, but no alias or shell
resolution is used.

This proves command construction only. Socket ownership, daemon identity,
rootless mode, and rejection of a substituted socket remain runtime gates.

## Mapped-UID workspace preparation

`MappedUidWorkspacePreparer` is injected into `WslContainerLauncher`. Before
any runtime call it:

1. validates that the workspace is the `work` directory of exactly one lease
   below the approved root;
2. verifies safe ancestry/tree, gateway ownership and group, no symlink, and
   no world-writable mode;
3. obtains `RuntimeIdentityMaps` from an injected observation source;
4. uniquely translates container UID/GID 65532 without assumed subordinate-ID
   offsets and rejects root or gateway-identity results;
5. uses `PosixAclBackend` to clear and apply ACLs only on that lease directory,
   without recursive `chown`, `chmod`, or ACL traversal;
6. explicitly sets access/default `user::rwx`, base `group::---`,
   `other::---`, named workload UID/GID `rwx`, named gateway UID `rwx`, and
   `mask::rwx`;
7. reads the numeric ACL back and requires exact equality with those 14
   entries, rejecting inherited base-group/other permissions, missing,
   duplicated, malformed or additional entries, ineffective permissions,
   ownership drift, or inode replacement; and
8. returns a typed receipt which the launcher validates before executing.

Default named ACLs retain gateway access to files later created by the mapped
workload identity. The gateway remains the directory owner, preserving its
ability to inventory, retain evidence, and perform controller-owned cleanup.
Actual `setfacl`/`getfacl` behavior on the proposed ext4 runtime path remains
NOT TESTED.

Collection and authentication of a real daemon's `/proc/<pid>/uid_map` and
`gid_map` observations belongs to the separately authorized provisioning and
runtime wiring. This task deliberately accepts those observations only through
an explicit injected source and does not fabricate them from `/etc/subuid` or
an assumed offset.

## Focused validation

Commands executed:

```text
python3 -m py_compile \
  evals/forge/wsl_container.py \
  scripts/build_forge_synthetic_image.py \
  scripts/tests/test_forge_wsl_container.py \
  scripts/tests/test_forge_synthetic_image.py

python3 -m unittest \
  scripts.tests.test_forge_wsl_container \
  scripts.tests.test_forge_synthetic_image

python3 -m unittest \
  scripts.tests.test_forge_controller \
  scripts.tests.test_forge_wsl_lab
```

Results:

- focused least-privilege ACL cases: **6/6 PASS**;
- focused T09.E6/E7 compatibility: **35/35 PASS**;
- directly impacted controller/WSL-lab regression: **46/46 PASS**;
- Python compilation: **PASS**.

Negative coverage includes rootful/TCP/altered endpoint, missing and ambiguous
maps, inherited `other::r-x`, unexpected base-group permissions, malformed
access/default observations, unexpected ACL principals, world-write, symlink,
workspace escape, and invalid readiness receipt. The three focused ACL drift
cases explicitly verify that `runtime.execute()` is never reached. Mocked
subprocess and identity-map results are source evidence only. Accepted
T09.E4-E7 suites and the historical 178-test baseline were not rerun.

## Unchanged contracts and remaining blockers

The fixed executable/arguments, digest-pinned image, seccomp profile, network
denial, capabilities, read-only root, PID/resource limits, stream capture,
cleanup classification, evidence lifecycle, and controller schemas are
unchanged.

The following remain **NOT TESTED/BLOCKED**:

- package provenance and an installed pinned rootless Docker stack;
- authenticated daemon PID plus actual UID/GID-map observation wiring;
- rootless socket owner/mode and resistance to endpoint substitution;
- ext4 POSIX ACL support and effective read/write from UID/GID 65532;
- cgroup delegation, namespaces, seccomp, resource enforcement, timeout,
  process-tree termination, and cleanup under a real container;
- an actual immutable `repository@sha256` image and offline readiness;
- independent evaluator/control identity, protected evidence custody,
  credentials/network containment, durability, recovery, and formal approval.

No source-level PASS in this task is runtime acceptance. Formal Forge remains
**BLOCKED — 0/36**.
