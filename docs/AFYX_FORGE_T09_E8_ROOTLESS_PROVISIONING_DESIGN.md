# AFYX Forge T09.E8.P1 ordinary WSL reconciliation and rootless design

Version: **0.1.0-proposed**

Status: **DESIGN COMPLETE / PROVISIONING NOT AUTHORIZED / RUNTIME ACCEPTANCE BLOCKED — 0/36**

Date: 2026-10-18 (Asia/Jakarta)

Baseline: `84c558e392f53ad5385144107fb5619e1e6d01da` (PR #67 merge)

Branch: `afyx/t09-e8-p1-rootless-design`

Jira: AFYX-285

## 1. Scope and authority

This document reconciles the accepted
[T09.E8.P0 Codex-sandbox snapshot](AFYX_FORGE_T09_E8_RUNTIME_PREFLIGHT.md)
with owner-supplied observations from an ordinary interactive Ubuntu WSL
terminal. It selects pinned rootless Docker as the **proposed design target**
because T09.E6 and T09.E7 currently use Docker-specific argv, inspection, and
cleanup semantics.

Selection for design does not authorize installation, configuration, daemon
startup, service creation, source implementation, image build/import/pull,
container execution, runtime acceptance, or formal promotion. T09.E5 remains
unapproved and the native-Windows T09.E1 contract remains authoritative.

No host command was used to supplement the supplied P1 observations. No
accepted T09.E4-T09.E7 test was rerun.

## 2. Evidence reconciliation

The two snapshots describe different process boundaries and are both retained.

| Property | P0 managed Codex session | P1 owner ordinary WSL terminal | Reconciled classification |
|---|---|---|---|
| Distribution/kernel | Ubuntu 26.04 WSL2, `6.6.114.1-microsoft-standard-WSL2`, x86-64 | Same | OBSERVED CONSISTENT |
| PID 1/service manager | PID 1 was `codex`; system bus unavailable | PID 1 `systemd`; service manager `running` | P0 is sandbox-local; ordinary WSL systemd availability is OWNER-OBSERVED, not runtime-accepted |
| Identity | Non-root UID/GID 1000 | UID/GID 1000 | OBSERVED CONSISTENT; not role separation |
| Cgroup v2 | Mounted read-only to the sandbox, no delegation visible | Mounted `rw,nsdelegate`; root `test -w` returned 1 | Kernel substrate present. Root non-writability is expected and does not decide user-service delegation; daemon subtree remains NOT VERIFIED |
| User namespaces | Kernel support and nonzero limits visible | Limit 62525 | OWNER-OBSERVED AVAILABLE; actual rootless mapping/enforcement NOT VERIFIED |
| Engine/tooling | Docker/Podman/Buildah and rootless/OCI helpers absent | Same, including `/usr/bin/docker` | BLOCKED, host-wide evidence mutually corroborating within observed scope |
| Session security state | `NoNewPrivs=1`, `Seccomp=2` | `NoNewPrivs=0`, `Seccomp=0` | Context-specific only. Neither value proves or disproves future daemon/container enforcement |
| Repository filesystem | ext4 writable in repository mount | ext4 `rw` | OBSERVED CONSISTENT; proposed runtime paths still require explicit mount verification |

P1 corrects only the ordinary-terminal context. It does not retroactively turn
P0 sandbox observations into host-wide findings, and it is owner-supplied
readiness evidence rather than independent acceptance evidence.

## 3. Selected target and alternatives

| Option | Contract fit | Additional trusted code/change | Decision |
|---|---|---|---|
| Pinned rootless Docker | Closest fit to T09.E6/T09.E7 Docker CLI semantics | Two narrow source changes identified in section 8 plus deployment configuration | **SELECTED DESIGN TARGET, conditional** |
| Rootless Podman/Buildah | Docker compatibility and exact cleanup/build semantics unproven | New adapter/compatibility evidence | DEFERRED; not a transparent substitute |
| Rootful Docker | Source-compatible but daemon/socket conveys host-equivalent authority | Stronger custody and denial controls | REJECTED by default; explicit exception required |
| Native namespace launcher | Avoids Docker but enlarges the trusted computing base | New launcher/policy compiler | REJECTED for minimum scope |

Rootless Docker isolates the public synthetic workload from ordinary host
resources. It does not isolate the evaluator from the Windows/WSL owner, make
raw evidence immutable, or move credentials outside the personal distro.

## 4. Minimum dependency and provenance contract

No package version or repository availability was established by this task.
The following names are a **candidate package closure to resolve**, not an
installation command or availability claim:

- Docker client and engine: `docker-ce-cli`, `docker-ce`;
- low-level runtime closure: `containerd.io` and its reviewed `runc` dependency;
- T09.E7 build support: `docker-buildx-plugin`;
- rootless launcher/network assets: `docker-ce-rootless-extras`;
- subordinate-ID helpers: `uidmap` providing `newuidmap` and `newgidmap`;
- user-service support: `dbus-user-session` if not already satisfied;
- rootless networking: the package-provided helper, with `slirp4netns` as the
  preferred separately packaged fallback if required;
- storage fallback: `fuse-overlayfs` only if native rootless `overlay2` fails
  the later controlled compatibility test; and
- workspace mapping: `acl` providing `setfacl`/`getfacl` if the ACL design in
  section 7 is approved.

Docker Compose, Kubernetes, a rootful daemon, the `docker` group, desktop
integration, and unrelated plugins are outside the minimum set.

Before any separately authorized installation, the owner must produce and
approve one lock record containing:

1. Ubuntu release and architecture; selected repository origin and HTTPS URL;
2. repository signing-key fingerprint verified through an independent channel;
3. signed `InRelease`/`Release` identity and digest;
4. exact `name=epoch:version-revision` for every direct package and resolved
   dependency, including Docker CLI, daemon, Buildx, containerd, runc,
   rootlesskit/network helper, uidmap, and any storage/ACL helper;
5. package SHA-256 values matched to the signed package index;
6. an installation simulation showing no removals, unrelated upgrades, or
   replacement of WSL/systemd components; and
7. an explicit pin/hold and change-control rule for the complete closure.

Mixing Ubuntu and Docker package sources without a reviewed dependency closure,
using `curl | sh`, accepting an unsigned repository, resolving `latest`, or
allowing unattended version drift is a STOP condition. Package versions must
be discovered from signed metadata in the authorized provisioning window; this
proposal intentionally invents none.

## 5. Rootless daemon and cgroup design

### 5.1 Identity and supervision

The trusted WSL workload gateway runs as the existing non-root UID/GID 1000.
It must use a dedicated, reviewed systemd **user** unit for a rootless Docker
daemon. The unit is task-owned, has no automatic restart during an acceptance
run, and uses package-owned binaries whose resolved paths and hashes are in the
lock record. A daemon crash aborts the run rather than triggering a transparent
retry.

The proposed socket is exactly:

```text
unix:///run/user/1000/afyx-forge/docker.sock
```

Its parent is mode `0700`, the socket is owned by UID/GID 1000, and neither the
socket nor its parent is mounted into the workload. The gateway must not use
`/var/run/docker.sock`, a rootful daemon, TCP Docker API, inherited Docker
contexts, or a socket selected from personal shell configuration.

Systemd user-manager availability is still NOT VERIFIED. Enabling linger is
not part of the minimum design; if unattended lifecycle across logout is later
required, it needs a separate owner decision and evidence.

### 5.2 Delegation acceptance

`test -w /sys/fs/cgroup` against the cgroup root is not an acceptance test.
After authorized provisioning, the evidence must show:

- unified cgroup v2 and `cpu`, `memory`, and `pids` controllers available;
- the user daemon unit has `Delegate=yes` and an exact systemd control-group
  path under the UID 1000 user slice;
- the daemon can create/remove only descendants of that delegated subtree;
- Docker reports rootless mode, cgroup v2, and the reviewed cgroup driver;
- actual test containers receive the requested PID, memory, and CPU limits in
  their own cgroups, with no ignored-limit warning;
- timeout/interrupt kills the whole workload cgroup and a post-kill check finds
  it empty before cleanup is reported; and
- the gateway cannot write the cgroup root or unrelated service subtrees.

Missing delegation, an unavailable controller, fallback to unconstrained
execution, or an unverifiable empty-cgroup result is fail-closed.

## 6. Linux-ext4-only layout

Owner provisioning creates one dedicated tree on the verified WSL ext4
filesystem, never under `/mnt`, DrvFS/9p, a Windows share, or the repository:

```text
/var/lib/afyx-forge-public-runtime/       root-owned boundary, 0755
  engine/                                 UID 1000, 0700; Docker data-root
  build/                                  UID 1000, 0700; disposable build context
  workspaces/                             UID 1000, 0700; controller lease root
  artifacts/                              UID 1000, 0700; public OCI staging only
```

Runtime-only state uses:

```text
/run/user/1000/afyx-forge/                UID 1000, 0700
  docker.sock
  exec/
  docker.pid
```

The systemd user unit binds its reviewed `data-root`, `exec-root`, PID file,
and Unix socket to those paths. Startup fails if any persistent path is not
ext4, is a symlink/reparse point, has unexpected ownership/mode, is under a
forbidden root, or resolves outside the approved tree. Raw/private evaluator
evidence is never stored in this layout. `artifacts/` may hold only public
synthetic OCI material and its public digest manifest.

`/usr/bin/docker` must exist as the package-owned Docker CLI, resolve only to a
root-owned, non-user-writable package file, and match the frozen version/hash.
It must support every exact T09.E6 run/kill/rm/inspect flag and T09.E7
build/image-inspect flag. A compatibility wrapper, shell function, alias,
Podman shim, personal PATH entry, or silent CLI behavior difference is not
accepted.

## 7. Workspace UID mapping

Rootless Docker maps container UID 65532 to a subordinate host UID. The current
controller creates the lease as UID 1000 and does not prepare that mapped UID
to write the bind-mounted files. A writable bind declaration alone therefore
does not prove a writable workspace.

The minimum proposed resolution is a controller-owned POSIX ACL step:

1. read and record the daemon's actual UID/GID maps; never infer the subuid
   offset from an assumed default;
2. map container UID/GID 65532 through those recorded maps;
3. create the per-run lease below the approved `workspaces/` root;
4. apply access/default ACLs only to that lease, granting the mapped workload
   identity the required read/write/traverse permissions and retaining gateway
   read/write/cleanup access;
5. verify the effective ACL before launch and inventory it in evidence; and
6. remove the entire correlated lease after evidence finalization, reporting
   cleanup independently.

World-writable workspaces, recursive ownership changes outside the lease,
hard-coded subuid arithmetic, and privileged mutation from inside the
container are forbidden. If ext4 ACL inheritance cannot preserve both workload
write access and gateway evidence/cleanup access, acceptance stops pending a
separately reviewed alternative such as proven idmapped mounts.

## 8. Required source compatibility changes before acceptance

Provisioning alone cannot make the current source safely target rootless
Docker. Two specific, bounded engineering changes require separate review and
tests before any runtime acceptance:

1. **Explicit daemon endpoint.** `DockerCliRuntime` and the T09.E7 build helper
   currently execute with a stripped environment containing no `DOCKER_HOST`
   or `DOCKER_CONTEXT`; Docker therefore defaults to `/var/run/docker.sock`.
   They must generate an immutable global CLI prefix equivalent to
   `/usr/bin/docker --host unix:///run/user/1000/afyx-forge/docker.sock` for
   every build, run, kill, remove, and inspect operation. The absolute socket
   must be validated; environment or personal-context selection remains
   forbidden.
2. **Mapped workspace access.** The controller/runtime boundary needs the
   lease-local UID/GID-map and ACL preparation/verification described in
   section 7 without changing public controller schemas or weakening path/tree
   validation.

These are identified changes, not implementations in T09.E8.P1. Any broader
launcher redesign is outside this proposal.

## 9. Immutable image-reference flow

The selected minimum design uses an owner-approved controlled OCI registry for
promotion. Registry access is allowed only to the trusted build/promotion
identity before the acceptance run; the evaluated container remains
network-disabled.

The controlled sequence is:

1. reproduce and verify the T09.E7 executable and exact source identities;
2. build the `linux/amd64` scratch image with the reviewed rootless daemon and
   a mutable local staging tag;
3. verify image config, platform, file inventory, layer/config/manifest
   digests, absence of credentials, and two-build reproducibility;
4. push to the approved TLS registry using credentials supplied only to the
   trusted promotion process through a separate Docker config directory;
5. obtain the canonical manifest digest from both Docker output and the
   registry API, and have an independent verifier compare them;
6. remove ambiguity by pulling or resolving the exact
   `repository@sha256:<manifest-digest>` into the acceptance daemon before the
   window, then verify that exact value appears in `RepoDigests` and resolves
   to the approved config/layers;
7. remove registry credentials from the runtime process boundary and disable
   network-dependent resolution; and
8. provide only the exact digest reference to the T09.E6 launcher, which keeps
   `--pull never`.

An image ID, local tag, push tag, source hash, executable hash, or digest copied
from only one unverified channel is insufficient.

An offline OCI archive remains a contingency, not the selected minimum flow.
It would require pinned OCI tooling, an independently signed archive/index
digest, and a proven Docker import procedure that preserves or establishes the
exact engine-local `repository@sha256` identity. Because that behavior is not
implemented or evidenced, an offline archive cannot currently feed the
launcher.

## 10. Workload isolation versus evaluator independence

The rootless daemon, namespaces, cgroups, seccomp, capabilities, read-only
image, network denial, and mount policy constrain the public synthetic
workload. The trusted UID 1000 gateway still controls the daemon, image store,
workspace, and process evidence. The Windows user/WSL administrator still
controls the distro and kernel boundary.

Therefore runtime PASS would prove only the reviewed workload-isolation
envelope. Formal evaluator independence still requires an external operator,
authenticated control channel, evaluator-owned append-only raw-evidence store,
signing keys, recovery procedure, and approved host custody outside developer
control. No registry or rootless-Docker success can substitute for those gates.

## 11. Provisioning checklist

Every item requires separate owner authorization and retained sanitized
evidence:

- [ ] Approve rootless Docker and the exact repository/provenance policy.
- [ ] Resolve and freeze the complete signed package/dependency lock.
- [ ] Confirm systemd user manager and decide explicitly against/for linger.
- [ ] Provision the dedicated ext4 persistent/runtime paths with exact modes.
- [ ] Provision the reviewed user unit, explicit socket, data-root, and
      `Delegate=yes`; keep rootful Docker and TCP API absent.
- [ ] Verify subordinate-ID maps and approve the lease-local ACL design.
- [ ] Implement and review the two bounded source changes in section 8.
- [ ] Select the controlled registry, credential boundary, retention, and
      independent digest verifier.
- [ ] Freeze CLI/daemon/containerd/runc/Buildx/rootless-helper identities and
      the unchanged T09.E6 seccomp digest.
- [ ] Authorize one public synthetic acceptance window and execute the complete
      T09.E5 positive, negative, and adversarial suite.
- [ ] Keep formal promotion and every B0-B5 campaign cell separately blocked.

## 12. Acceptance criteria

### Provisioning PASS

- all packages and dependencies match the signed lock with no unexpected host
  changes;
- daemon is conclusively rootless, systemd-user supervised, explicitly
  socket-bound, and uses only the approved ext4 state;
- `/usr/bin/docker`, Buildx, daemon, containerd, runc, helpers, configuration,
  unit, kernel, WSL, cgroup, and seccomp identities are recorded;
- cgroup delegation and actual resource enforcement pass without warnings;
- the exact immutable registry digest is present locally before network-off
  acceptance; and
- workspace mapped-UID access and gateway cleanup both pass under the frozen
  ACL/mapping plan.

### Runtime PASS

- T09.E6 launches only the digest-pinned public image through the explicit
  rootless socket and fixed executable/arguments;
- non-root identity, empty supplementary groups, zero capabilities,
  `no_new_privileges`, seccomp, namespaces, read-only root, mount exclusions,
  network denial, and resource limits are observed from the actual workload;
- readiness precedes launch, original stdout/stderr and process state are
  complete, finalization precedes success, and cleanup is independently
  conclusive;
- timeout, orphan/double-fork, daemon interruption, capture/truncation,
  tamper/replay, mount/network/socket/credential probes, and cleanup failure all
  fail closed; and
- no test result is promoted beyond public synthetic workload isolation.

### Still NOT VERIFIED after workload runtime PASS

- independent evaluator identity and host custody;
- evaluator-storage and private-bundle denial under formal identities;
- append-only raw-evidence durability, signing, restore, and recovery;
- provider/control-plane separation; and
- owner approval of T09.E5 or any formal campaign gate.

## 13. Rollback boundary and STOP conditions

Provisioning must be confined to the locked packages, dedicated user unit,
runtime socket, and `/var/lib/afyx-forge-public-runtime` tree. Rollback stops
and disables only the task-owned user service, removes its runtime socket, and
restores only task-owned configuration from recorded backups. Package removal
is allowed only after dependency ownership is reviewed. Persistent engine,
workspace, or public artifact data is not deleted until required evidence is
finalized and the owner explicitly authorizes disposal. Private/historical
evidence and unrelated WSL configuration are never rollback targets.

Stop before or during provisioning/acceptance if any of these occurs:

- package/repository signature, digest, version, or dependency closure is
  unavailable, mutable, or mismatched;
- the daemon is rootful, uses an unexpected socket/path, or requires Docker
  group/TCP access;
- the explicit socket or mapped-workspace source changes are unapproved;
- user-service supervision or delegated `cpu`/`memory`/`pids` cgroups cannot be
  proven;
- state/workspace/build paths are non-ext4, symlinked, on DrvFS, or have
  unexpected ownership/permissions;
- native overlay2 fails and no separately approved fuse-overlayfs fallback is
  frozen;
- resource limits, seccomp, capability removal, namespaces, network denial,
  bind-mount exclusions, process-tree termination, or cleanup are ignored or
  inconclusive;
- immutable registry identity cannot be independently reproduced or exact
  `RepoDigests` evidence is absent;
- any Docker socket, host home, `/mnt`, credential, private marker, evaluator
  path, or undeclared route is visible to the workload; or
- evidence readiness/capture/finalization/recovery fails.

Owner decision required: approve or reject this pinned rootless-Docker target,
the two bounded source changes, the controlled-registry flow, and the dedicated
ext4/socket/cgroup layout. Approval authorizes none of them automatically.

Formal Forge remains **BLOCKED — 0/36**.
