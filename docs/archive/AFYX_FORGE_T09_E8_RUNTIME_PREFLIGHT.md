# AFYX Forge T09.E8.P0 public synthetic runtime preflight

Status: **SUBSTRATE PARTIAL PASS / PROVISIONING REQUIRED / RUNTIME ACCEPTANCE BLOCKED — 0/36**

Date: 2026-10-18 (Asia/Jakarta)

Baseline: `f1a3fe8da3bf00c55ce563e94f8014c9b8511eb4` (PR #66 merge)

Branch: `afyx/t09-e8-synthetic-runtime-acceptance`

Jira: AFYX-285

## Scope and authority

This is a read-only snapshot of the current Codex session inside Ubuntu WSL2.
It assesses prerequisites for a later, separately authorized public synthetic
OCI build and T09.E6 runtime acceptance. It did not install, initialize, start,
build, pull, import, or run a container runtime. It did not create namespaces,
accounts, services, images, or campaign workspaces and did not access private
evaluator material, credentials, holdouts, canaries, or protected evidence.

The accepted T09.E4-T09.E7 source and CI evidence is reused. No accepted test
was rerun. This snapshot is not independent evaluator evidence, does not
approve the proposed T09.E5 WSL amendment, and does not replace the
authoritative native-Windows T09.E1 contract.

## Inspected contract

The unchanged repository contract requires:

- Linux `amd64` and the fixed executable
  `/opt/afyx/bin/forge-synthetic-cell --mode public-synthetic`;
- a T09.E7 one-stage `scratch` image with UID/GID `65532:65532`;
- an engine-observed immutable launcher reference of the form
  `repository@sha256:<64 lowercase hex>`; a local tag, standalone image ID,
  absent `RepoDigests`, or unbuilt recipe is insufficient;
- the T09.E6 Docker argv contract, currently defaulting to the absolute client
  path `/usr/bin/docker`, with `--pull never` during workload launch;
- read-only root, one disposable workspace bind mount, network `none`, private
  PID/IPC namespaces, all capabilities dropped, `no_new_privileges`, the
  frozen default-deny seccomp profile, PID/memory/CPU bounds, timeout,
  whole-workload termination, and conclusive cleanup observation; and
- independent evaluator/control/evidence custody outside the personal WSL
  workload plane for any future formal use.

Observed repository identities:

```text
seccomp SHA-256:      f2fe79d3ab15935ab4651c7ee51fa79662d650752c9024dcfb752fa4fa1452a0
Containerfile SHA-256: 20440f8a40336ed458eddf9266b46c4b23a08e4b2c0442437a838638afc4c28c
assembly SHA-256:     7db4f297882a0fa416d45f878da9c57e777ad35778a6b939657771d341ce1736
```

These are source identities, not an OCI image digest.

## Sanitized host observations

| Area | Observation | Classification |
|---|---|---|
| Repository | Correct repository and task branch; clean worktree; HEAD exactly `f1a3fe8da3bf00c55ce563e94f8014c9b8511eb4`. | PASS |
| WSL/kernel | Ubuntu 26.04 LTS, WSL2 kernel `6.6.114.1-microsoft-standard-WSL2`, `x86_64`/`amd64`, 64-bit. | PASS for T09.E7 architecture compatibility |
| Session boundary | `systemd-detect-virt` reports `wsl`, but PID 1 in this managed session is `codex`, the root filesystem and cgroup mount are read-only, and the system bus is inaccessible. | NOT VERIFIED for the unsandboxed distro/gateway |
| Container engine | Docker, Podman, Buildah, nerdctl, containerd, Docker daemon, Podman service, runc, and crun executables are absent. `/usr/bin/docker` is not executable. | BLOCKED |
| Build toolchain | `/usr/bin/gcc` 15.2.0, GNU assembler/linker 2.46, GNU Make 4.4.1, and Python 3.11.13 are visible. | PASS for later source reproduction; toolchain freeze still required |
| Cgroup | Unified cgroup v2 is mounted with `cpuset cpu io memory hugetlb pids rdma`; root subtree enables `cpu memory pids`. The mount is read-only to this session and not delegated. | Kernel substrate PASS; operational delegation BLOCKED |
| Namespaces | Kernel config exposes cgroups, PID cgroups, namespaces, user namespaces, seccomp, and seccomp filters. Namespace limits are nonzero and `unshare` 2.41.3 is present. No namespace was created. | Capability visible; actual creation/enforcement NOT VERIFIED |
| Rootless identity | Current session UID/GID are non-root; subuid and subgid ranges exist for the current user. `newuidmap`, `newgidmap`, rootlesskit, slirp4netns, pasta, and fuse-overlayfs executables are absent. | Partial prerequisite PASS; provisioning BLOCKED |
| Seccomp/capabilities | Kernel seccomp/filter config is enabled; libseccomp 2.6.0 is installed; the current process reports seccomp-filter mode, `NoNewPrivs=1`, and zero capability sets. | Availability PASS; T09.E6 profile enforcement NOT VERIFIED |
| Storage driver substrate | Kernel lists overlay and fuse support. AppArmor reports disabled and SELinux is not mounted in this session. | Overlay/fuse capability visible; engine storage behavior NOT VERIFIED |
| WSL exposure | DrvFS/9p mounts exist and `/mnt/c` is visible read-only to this session. WSLInterop registration is not visible here. | Risk observed; container denial NOT VERIFIED |
| Workspace/artifact filesystem | Repository is on writable ext4 with approximately 948 GiB available; `/tmp` is a tmpfs with approximately 7.7 GiB available. GNU tar, gzip, bzip2, xz, split, flock, and SHA-256 tools are present. | PASS for ordinary local staging only |
| OCI transport/storage | skopeo, umoci, oras, and all engine import/export tools are absent. No immutable registry or evaluator-owned OCI archive was identified. | BLOCKED |
| External evaluator | No independent identity, external control channel, append-only evidence store, signing authority, or host-custody control was inspected. | NOT VERIFIED / formal gate BLOCKED |

The current process's zero capabilities, seccomp state, read-only mounts, and
missing system bus are properties of this managed Codex session. They must not
be projected onto a future gateway, daemon, container, or unrestricted WSL
login. Conversely, visible kernel features do not prove that an engine can
delegate and enforce them under the intended identity.

## P1 ordinary WSL reconciliation

Owner-supplied observations from a distinct ordinary interactive WSL terminal
reported the same Ubuntu/kernel/architecture, UID/GID 1000, absent engine and
rootless/OCI tooling, absent `/usr/bin/docker`, and writable ext4 repository.
Unlike this P0 sandbox, that terminal reported PID 1 `systemd`, service manager
`running`, cgroup v2 mounted `rw,nsdelegate`, and user-namespace limit 62525.
The cgroup root was not writable to UID 1000; this neither proves nor disproves
delegation to a future systemd user-service subtree.

The ordinary shell reported `NoNewPrivs=0` and `Seccomp=0`, while this managed
session reported `1` and `2`. Both are process-context observations only and
neither is future container-enforcement evidence. P0 remains the historical
sandbox snapshot; it is not relabeled as host-wide. The reconciled design and
rootless-Docker requirements are recorded in
[T09.E8.P1](AFYX_FORGE_T09_E8_ROOTLESS_PROVISIONING_DESIGN.md).

## Commands used

Only non-mutating inspection commands were used. The relevant command set was:

```text
git status --branch --short
git rev-parse --show-toplevel
git rev-parse HEAD
git branch --show-current
uname -s; uname -r; uname -m
cat /etc/os-release
systemd-detect-virt
ps -p 1 -o comm=
printenv WSL_DISTRO_NAME
getconf LONG_BIT
dpkg --print-architecture
type -a docker podman buildah nerdctl ctr containerd dockerd \
  podman-system-service rootlesskit slirp4netns fuse-overlayfs pasta \
  newuidmap newgidmap runc crun skopeo umoci oras
command -v gcc cc as ld python3 make tar gzip sha256sum
gcc -dumpfullversion -dumpversion
ld --version; as --version; python3 --version; make --version
tar --version; gzip --version
stat -fc %T /sys/fs/cgroup
findmnt -no TARGET,FSTYPE,OPTIONS /sys/fs/cgroup
findmnt -T /home/afif/workspace/afyx-forge-public -no TARGET,FSTYPE,OPTIONS
findmnt -T /tmp -no TARGET,FSTYPE,OPTIONS
findmnt -no TARGET,FSTYPE,OPTIONS /
findmnt -no TARGET,FSTYPE,OPTIONS /home
findmnt -no TARGET,FSTYPE,OPTIONS /mnt/c
cat /proc/self/cgroup
cat /sys/fs/cgroup/cgroup.controllers
cat /sys/fs/cgroup/cgroup.subtree_control
test -w /sys/fs/cgroup
cat /proc/sys/user/max_cgroup_namespaces
cat /proc/sys/user/max_pid_namespaces
cat /proc/sys/user/max_mnt_namespaces
cat /proc/sys/user/max_net_namespaces
cat /proc/sys/user/max_user_namespaces
cat /proc/sys/user/max_uts_namespaces
cat /proc/sys/kernel/unprivileged_userns_clone 2>/dev/null
unshare --version
lsns --output TYPE --noheadings
id -u; id -g; id -G
sanitized presence checks against /etc/subuid and /etc/subgid
rg '(^|[[:space:]])(overlay|fuse|fuseblk)$' /proc/filesystems
grep -E '^(NoNewPrivs|Seccomp|Seccomp_filters|Cap(Inh|Prm|Eff|Bnd|Amb)):' \
  /proc/self/status
cat /proc/sys/kernel/seccomp/actions_avail
cat /proc/sys/kernel/seccomp/actions_logged
ldconfig -p
dpkg-query -W libseccomp2 uidmap slirp4netns fuse-overlayfs rootlesskit \
  docker-ce docker.io podman buildah containerd runc crun
gzip -cd /proc/config.gz | rg \
  '^CONFIG_(SECCOMP|SECCOMP_FILTER|USER_NS|CGROUPS|CGROUP_PIDS|NAMESPACES)='
systemctl --version
systemctl is-system-running
test -S /run/user/1000/bus; test -d /run/user/1000; test -w /run/user/1000
cat /sys/module/apparmor/parameters/enabled
test -r /sys/fs/selinux/enforce
df -hP /home/afif/workspace/afyx-forge-public /tmp
stat -fc '%T %s' /home/afif/workspace/afyx-forge-public /tmp
findmnt -rn -t 9p,drvfs | wc -l
test -d /mnt/c; test -e /proc/sys/fs/binfmt_misc/WSLInterop
command -v zstd bzip2 xz split flock
sha256sum evals/forge/policies/synthetic-seccomp-v1.json \
  evals/forge/synthetic_image/Containerfile \
  evals/forge/synthetic_image/cell_x86_64.S
```

Version/help commands did not contact or start an engine because no engine
executable was present. `unshare` was queried for its version only; namespace
creation was deliberately not attempted.

## Compatibility analysis

### Present prerequisites

- WSL2 Linux `amd64` matches the T09.E7 fixture architecture.
- The accepted compiler/linker family needed to reproduce the static fixture
  is present at the path expected by the build helper.
- Kernel configuration exposes the namespace, cgroup v2, PID-controller, and
  seccomp primitives required by the proposed isolation model.
- A non-root user and subordinate UID/GID ranges exist.
- ext4 local storage, overlay/fuse kernel support, archive tools, and SHA-256
  tooling exist for a later controlled build and artifact handoff.

### Absent or blocked prerequisites

- There is no container engine, low-level runtime, or compatible client at the
  T09.E6 default `/usr/bin/docker` path.
- Rootless mapping, networking, daemon, and storage helpers are absent.
- The current session has no writable/delegated cgroup hierarchy and cannot
  reach the system service manager.
- There is no OCI copy/import/inspection tool and no approved immutable
  registry or offline artifact channel.
- There is no real `RepoDigest`, so no reference currently satisfies the
  launcher. The known executable and source hashes must not be substituted.

### Not verifiable read-only

- whether a selected engine can create all required namespaces, apply the
  frozen seccomp profile, drop all capabilities, enforce read-only root and
  resource bounds, deny every undeclared route/mount, and empty the complete
  workload cgroup;
- whether rootless cgroup delegation and daemon supervision work in the actual
  owner-approved gateway session rather than this managed sandbox;
- whether the fixed executable runs under the real container seccomp envelope;
- whether build output is reproducible at the OCI manifest/config/layer level;
- whether cleanup, timeout, capture, interruption, and recovery evidence is
  complete; and
- every evaluator-independence, protected-storage, credential, durability,
  signing, and host-custody property from T09.E5.

## Design assumptions requiring an owner decision

1. **Engine contract.** T09.E6 uses Docker-specific argv and cleanup evidence,
   and T09.E7 uses Docker build/inspect shapes. Rootless Docker is the closest
   no-source-change option. Podman is not a proven drop-in: choosing it would
   require a separately reviewed compatibility change and acceptance evidence.
2. **Cgroup supervision.** The owner must select a gateway context with a
   writable delegated cgroup v2 subtree and a deterministic daemon supervisor.
   The current sandbox cannot supply that evidence.
3. **Immutable reference flow.** A local Docker build normally has an image ID
   and mutable tag but may have no `RepoDigests`. The owner must choose either
   an approved immutable registry flow or an independently hashed offline OCI
   artifact plus a reviewed import procedure that results in the exact
   engine-local `repository@sha256:...` reference. The launcher remains
   `--pull never` during acceptance.
4. **Storage and mount boundary.** Engine data and the disposable workspace
   must remain on Linux ext4, never DrvFS. The selected workspace root must
   satisfy T09.E6 path policy and the actual container mount table must prove
   that `/mnt`, homes, sockets, and evaluator storage are absent.
5. **Trust split.** Rootless workload isolation does not make the personal WSL
   owner an independent evaluator. The external evaluator/control/evidence
   plane and host-custody decision remain separate formal blockers.

## Minimum future provisioning options

No option is selected or authorized by this preflight.

### Option A — pinned rootless Docker, closest to the current source contract

Owner-managed provisioning would need a reviewed and version-pinned Docker
client/daemon and low-level runtime, uidmap helpers, rootlesskit, a reviewed
rootless network helper, an approved storage driver/helper, a writable
delegated cgroup v2 subtree, and deterministic per-user daemon supervision.
The client must be available at the reviewed absolute path or that path must be
changed through a separate source review. Engine state belongs on ext4. The
daemon socket is controller-only and must never enter the workload container.

### Option B — pinned rootless Podman

This may reduce daemon coupling, but it does not currently satisfy the exact
Docker CLI/build/inspect/cleanup contract. It requires a specific, justified
adapter and test change before acceptance; installing a Docker-compatibility
wrapper alone is not evidence of semantic compatibility.

### Option C — dedicated rootful engine

This is not preferred by T09.E5. It requires explicit owner/evaluator approval,
a dedicated trusted gateway, narrow socket custody, and proof that no evaluated
identity can reach the socket or engine group. Rootful engine access is
host-equivalent authority and does not improve evaluator independence.

Every option still requires immutable image publication/import, independent
digest verification, a fresh runtime fingerprint, and the complete T09.E5
positive, negative, and adversarial public synthetic acceptance suite.

## Stop conditions and recommended owner decision

Runtime acceptance remains blocked until the owner explicitly selects:

1. the engine option and exact signed package/version provenance;
2. rootless cgroup delegation and daemon supervision design;
3. immutable registry or offline OCI identity/import flow;
4. ext4 engine/workspace locations and mount exclusions;
5. the independently controlled evaluator/evidence plane and host-custody
   model; and
6. a separately authorized public synthetic acceptance window.

Abort provisioning or later acceptance on mutable/unverifiable image identity,
unexpected DrvFS/home/socket mounts, missing cgroup delegation, engine-path or
CLI semantic mismatch, undeclared network access, incomplete process-tree
termination, inconclusive cleanup, capture/finalization failure, or any
credential/private marker exposure.

Recommended next owner decision: choose whether to provision a pinned rootless
Docker gateway matching the existing source contract, or authorize a separately
reviewed Podman compatibility change. Do not begin installation until the
immutable-reference flow and external evaluator boundary are also selected.

Formal Forge remains **BLOCKED — 0/36**.
