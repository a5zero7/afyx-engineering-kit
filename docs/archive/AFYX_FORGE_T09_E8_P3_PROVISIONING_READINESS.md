# AFYX Forge T09.E8.P3 controlled rootless Docker provisioning readiness

Version: **0.1.0-readiness**

Addendum: **0.1.1-owner-decision — 2026-10-18**

Historical verdict: **BLOCKED — PACKAGE SOURCE/LOCK DECISION REQUIRED**

Current verdict: **BLOCKED — DOCKER CE PROVENANCE/PACKAGE LOCK NOT VERIFIED**

Status: **READ-ONLY AUDIT COMPLETE / PROVISIONING NOT AUTHORIZED / FORMAL CAMPAIGN BLOCKED — 0/36**

Date: 2026-10-18 (Asia/Jakarta)

Baseline: `f4d213ebaafaa004817715ff82437620d8e8860e` (PR #69 merge)

Branch: `afyx/t09-e8-p3-provisioning-readiness`

Jira: AFYX-285

## 1. Scope, authority and verdict

This is the final read-only decision package before any request to modify the
host. It reconciles the accepted
[P1 design](AFYX_FORGE_T09_E8_ROOTLESS_PROVISIONING_DESIGN.md) and
[P2 source compatibility](AFYX_FORGE_T09_E8_RUNTIME_COMPATIBILITY.md). It does
not repeat their source tests and does not install, download, configure, start,
build, import, pull or execute anything.

The provisioning verdict is **BLOCKED**, for these concrete reasons:

1. the P1-preferred Docker CE repository is not configured, its key is absent,
   and `docker-ce`, `docker-ce-cli`, `containerd.io`,
   `docker-buildx-plugin` and `docker-ce-rootless-extras` have no locally
   verifiable candidate, version or package hash;
2. Ubuntu's signed archive offers a coherent alternative stack, but selecting
   Ubuntu-maintained `docker.io`/`docker-buildx` instead of Docker CE is an
   owner support-model decision and the package payload/rootless helper files
   have not been inspected;
3. locally cached Ubuntu updates/security metadata is dated 2026-08-10, while
   this audit is 2026-10-18; its signatures and contained hashes are valid, but
   it is not a current installation lock; and
4. this managed session cannot reach either systemd bus or exercise delegated
   cgroups, `/run/user/1000`, `/var/lib`, ACLs or a rootless daemon. Those gates
   remain NOT VERIFIED, not inferred from P1 owner observations.

Readiness is not approval. T09.E1 remains authoritative, T09.E5 remains
unapproved, and the formal campaign remains blocked.

## Owner decision addendum — 2026-10-18

Focused review **#5562123629** is closed by recording the following bounded
owner decision:

- the official Docker CE repository is the **SELECTED SOURCE TARGET** for the
  next, separately authorized provenance and package-lock assessment;
- this selection does **not** authenticate or approve a repository, signing
  key, package, version, dependency, installation, service action or runtime;
- the exact Docker CE repository signing identity and fingerprint, fresh
  candidate versions, package hashes, dependency closure,
  conflicts/removals/upgrades and reproducible package lock remain **NOT
  VERIFIED**;
- the Ubuntu 26.04 archive observations below remain unchanged historical P3
  evidence, are not relabelled as Docker CE evidence and are no longer the
  selected source path; and
- the original `0.1.0-readiness` verdict remains historical evidence of the
  decision state at audit time. After this source-target decision, the narrower
  current verdict is **BLOCKED — DOCKER CE PROVENANCE/PACKAGE LOCK NOT
  VERIFIED**.

No provisioning authority follows from this addendum. Obtaining fresh metadata
or package payloads, adding a repository/key, installing packages or changing a
unit requires a later explicit authorization.

## 2. Audit boundary and commands

Only read operations and APT simulation were used. No `sudo`, `apt update`,
download, key/repository addition, daemon command or container command ran.
Command families were:

```text
git fetch origin dev
uname; /etc/os-release; id; ps; findmnt; stat
systemctl --version; systemctl/loginctl read-only show attempts
/proc and /sys/fs/cgroup reads; /etc/subuid and /etc/subgid reads
/etc/apt source/keyring reads; gpgv signature verification; sha256sum
apt-cache policy/show/search
apt-get --simulate --no-install-recommends install <exact candidates>
dpkg-query; apt-mark showhold; apt list --upgradable
command -v; /proc/filesystems; /sys/module and /dev/fuse existence checks
```

The APT simulation warning explicitly states that locking is disabled and the
result must not be assumed current. The simulation performed no download.

## 3. Host and prerequisite evidence

| Property | Observation | Classification |
|---|---|---|
| OS/kernel/architecture | Ubuntu 26.04 LTS `resolute`; WSL2 kernel `6.6.114.1-microsoft-standard-WSL2`; `x86_64`; APT `amd64`; 64-bit | VERIFIED IN SESSION |
| Identity | UID/GID 1000 | VERIFIED IN SESSION; not evaluator separation |
| Session boundary | PID 1 is `codex`; `NoNewPrivs=1`; `Seccomp=2`; system and user bus calls return `Operation not permitted` | VERIFIED SANDBOX FACT; not ordinary-WSL state |
| P1 ordinary WSL | Owner previously reported PID 1 `systemd` and service manager `running` | OWNER-SUPPLIED; not re-attested by P3 |
| systemd prerequisites | systemd `259.5`, `dbus-user-session 1.16.2-2ubuntu4`, `libpam-systemd 259.5-0ubuntu3` installed | PACKAGE STATE VERIFIED; user-manager operation NOT VERIFIED |
| cgroup | cgroup v2; root controllers include `cpu memory pids`; user-manager path exposes and enables `cpu memory pids` | VISIBLE; delegation/write enforcement NOT VERIFIED because mount is read-only here |
| User namespaces | `max_user_namespaces=2147483647`; subordinate UID and GID ranges each start at 100000 with length 65536 | CONFIG PRESENT; actual daemon map NOT VERIFIED |
| Filesystem | repository is ext4 and writable in its bind; sandbox view of `/var/lib` root is read-only | REPOSITORY PASS; proposed persistent layout NOT VERIFIED |
| Runtime directory | `/run/user/1000` is UID/GID 1000 mode 0700 but read-only in this session | METADATA PASS; daemon socket creation NOT VERIFIED |
| Storage substrate | kernel 6.6, overlay filesystem/module visible; `/dev/fuse` absent | overlay2 CANDIDATE; actual rootless mount NOT VERIFIED; fuse fallback BLOCKED here |
| Existing engines | Docker CLI/daemon, containerd, runc/crun, RootlessKit, slirp4netns and fuse-overlayfs executables absent | VERIFIED ABSENT |
| Required helpers | `newuidmap`, `newgidmap`, `setfacl`, `getfacl` absent | VERIFIED ABSENT |
| Fixed endpoint executable | `/usr/bin/docker` absent | BLOCKED until package-owned identity exists |

Official Docker documentation currently lists Ubuntu Resolute 26.04 LTS and
amd64 as supported for Docker Engine. It also requires `newuidmap`,
`newgidmap`, and at least 65,536 subordinate IDs for rootless operation. It
states that cgroup limits require cgroup v2 plus systemd and may otherwise be
silently ignored. See [Docker Engine on Ubuntu](https://docs.docker.com/engine/install/ubuntu/),
[rootless mode](https://docs.docker.com/engine/security/rootless/) and
[rootless cgroup guidance](https://docs.docker.com/engine/security/rootless/tips/).

These vendor statements establish platform support, not this host's runtime
acceptance.

## 4. APT provenance evidence

### 4.1 Configured source

Only Ubuntu sources are configured:

```text
http://archive.ubuntu.com/ubuntu/
  resolute resolute-updates resolute-backports
http://security.ubuntu.com/ubuntu/
  resolute-security
components: main universe restricted multiverse
signed-by: /usr/share/keyrings/ubuntu-archive-keyring.gpg
```

No `/etc/apt/keyrings` key and no Docker source exists. Insecure repository and
downgrade-to-insecure settings are both `0`.

The Ubuntu archive signing fingerprint observed through `gpgv VALIDSIG` is:

```text
F6ECB3762474EDA9D21B7022871920D1991BC93C
```

The keyring SHA-256 is
`80a36b0a6de2f69f49d2df75ef473ccde121e9e190b9ea01d20a4f63778d5c31`.
All four cached `InRelease` files verify with that key. Relevant snapshot
identities are:

| Suite | Metadata date | InRelease SHA-256 |
|---|---|---|
| resolute | 2026-04-23 UTC | `45f95ce276cdba3e41870516a130e03c58b8b7a79e9546b0efe9e526d255740c` |
| resolute-updates | 2026-08-10 UTC | `77ea4ee1261fd9dcbb000308fc38aba6581dd4222dfd7d21cc249c234ece98a4` |
| resolute-backports | 2026-07-23 UTC | `b5105f9b273e83dbaabe95cbbceb724264b375709b434af654023896dcc7f8ec` |
| resolute-security | 2026-08-10 UTC | `5c7ce79eb3e29188cae16f2e69e57aa293bf85986e98124c496e21f0c9fefa41` |

Valid signatures prove snapshot origin/integrity; they do not make the
two-month-old candidate set a current lock.

### 4.2 Package-source decision matrix

| Source option | Candidate evidence | Support/provenance | Contract fit | Decision |
|---|---|---|---|---|
| Docker official stable repository | Ubuntu 26.04 is vendor-supported, but repository/key/candidates are absent locally | Docker-maintained; exact key, versions, hashes and dependency closure NOT VERIFIED | Matches P1 names and rootless-extras design | **SELECTED SOURCE TARGET / NOT VERIFIED** |
| Ubuntu archive | Exact signed candidates and hashes below; clean simulation | Ubuntu/Canonical packages; Docker documentation says distribution packages are maintained separately and may differ | Likely compatible, but helper payload and exact CLI/daemon behavior NOT VERIFIED | **NOT SELECTED; HISTORICAL AUDIT RETAINED** |
| Convenience/static script | No controlled local provenance or lock | Script/binary flow outside APT closure | Violates reviewed provenance approach | **REJECTED** |
| Rootful Docker/Desktop/Podman shim | Not evaluated for this contract | Different authority/API boundary | Conflicts with rootless Docker target or P2 exact CLI semantics | **REJECTED** |

Docker's own installation page distinguishes its official packages from
distribution-maintained packages. Ubuntu's package catalog independently
confirms `docker.io 29.1.3-0ubuntu4.1` and `docker-buildx 0.30.1-0ubuntu1` for
Resolute; see [Ubuntu docker.io](https://packages.ubuntu.com/resolute-updates/docker.io)
and [Ubuntu docker-buildx](https://packages.ubuntu.com/resolute/docker-buildx).

## 5. Locally available dependency/version matrix

These are signed **snapshot candidates**, not approved installation pins.

| Role/package | Candidate | Origin | Package SHA-256 | Confidence |
|---|---|---|---|---|
| Docker engine/CLI `docker.io` | `29.1.3-0ubuntu4.1` | resolute-updates/security, universe | `7a77548bd669f232ec8852092623303be32c55538401ff047b4d1e0bb5ea721d` | VERIFIED SNAPSHOT |
| Buildx `docker-buildx` | `0.30.1-0ubuntu1` | resolute, universe | `96f1bf0fb16cefcd9063c2034b949383e46b1b47c26a376e3a569e42ffdf281e` | VERIFIED SNAPSHOT |
| containerd | `2.2.2-0ubuntu1.1` | resolute-updates/security, main | `25f1410e781533bf19d22aa9181c6b57043c005cc30b635edf8a2afebe590fc0` | VERIFIED SNAPSHOT |
| runc | `1.4.0-0ubuntu1` | resolute, main | `7282e0d92acb54eefb57f84849ab8b0102fdc5a64459a95194101718b283ceff` | VERIFIED SNAPSHOT |
| RootlessKit | `2.0.2-2build1` | resolute, universe | `3ab4a4d34148c991932906b6f50fc0ff23f8497ee5244096db4638911c504c84` | VERIFIED SNAPSHOT |
| slirp4netns | `1.3.3-1` | resolute, universe | `dda3ca5101c58e9585bfd6e7b9d26831090327120cfb5092172ead355f968dd4` | VERIFIED SNAPSHOT |
| uidmap | `1:4.17.4-2ubuntu3` | resolute, main | `b4942df2976de17739887a170d51060c30ae5433fd7123b444c9ec5cef9490ff` | VERIFIED SNAPSHOT |
| ACL tools `acl` | `2.3.2-2` | resolute, main | `74bb8008be63c1deb1cd9e9ebde8189a762962a6cc4e0a36d4943380ed46a15f` | VERIFIED SNAPSHOT |
| fuse-overlayfs fallback | `1.14-1build2` | resolute, universe | `281e0e4ca136d81948ef7bb2ebd68b32954dc8c66f5beb20f2ab134132bb712e` | OPTIONAL / NOT SELECTED |
| dbus-user-session | `1.16.2-2ubuntu4` | installed/resolute, main | `cf0b0c4d223f3465df0e057f1a0810d69643a4d3e64734d72ce5e5b488a9618c` | INSTALLED; operation NOT VERIFIED |
| Docker CE family | none | repository absent | none | BLOCKED |

The simulated minimal Ubuntu change closure contains exactly 17 new packages:

| Package | Version | Package SHA-256 |
|---|---|---|
| acl | `2.3.2-2` | `74bb8008be63c1deb1cd9e9ebde8189a762962a6cc4e0a36d4943380ed46a15f` |
| containerd | `2.2.2-0ubuntu1.1` | `25f1410e781533bf19d22aa9181c6b57043c005cc30b635edf8a2afebe590fc0` |
| docker-buildx | `0.30.1-0ubuntu1` | `96f1bf0fb16cefcd9063c2034b949383e46b1b47c26a376e3a569e42ffdf281e` |
| docker.io | `29.1.3-0ubuntu4.1` | `7a77548bd669f232ec8852092623303be32c55538401ff047b4d1e0bb5ea721d` |
| iptables | `1.8.11-2ubuntu3` | `187b16f9375f53ce6a1618a29de52bb177b620589ada29e4a3e25de5d594e66f` |
| libip4tc2 | `1.8.11-2ubuntu3` | `be25148d60125f6866dfa7940f3f1371fff4b0e8a1a9500780ad50cb8aaa0895` |
| libip6tc2 | `1.8.11-2ubuntu3` | `3d9fdb3171f1167ab3f5182de11db63bcd27aae71838618f3d46806b3134428e` |
| libnetfilter-conntrack3 | `1.1.1-1` | `facfd45a7cf6bab8ef30adbe693d6486f22e5253263f9d53b4e70b53f768970e` |
| libnfnetlink0 | `1.0.2-3build1` | `e76b638fef2c1ebf78260972a52c4716df5752b29a952aeddc0c091a74f179c2` |
| libnftables1 | `1.1.6-1` | `0e5abb5719052d9f12aadf91a3f3d5192a2e85d035ee81d07c3055a0f79d8b8f` |
| libnftnl11 | `1.3.1-1` | `a2f4d4a4ce3fac7e473c8de60a3d8948a58e9850cd8e2ced17263aa73dda7199` |
| libslirp0 | `4.9.1-1ubuntu1.1` | `bfc8e5afed3287ecd28675fd683913e6b3c9d73bd16a63bc8f45cc3b7e6f83fb` |
| libsubid5 | `1:4.17.4-2ubuntu3` | `d05f5f5bda0288dffa12f01f1edbc934c477e915f6cb6d85ee5f995c75947993` |
| rootlesskit | `2.0.2-2build1` | `3ab4a4d34148c991932906b6f50fc0ff23f8497ee5244096db4638911c504c84` |
| runc | `1.4.0-0ubuntu1` | `7282e0d92acb54eefb57f84849ab8b0102fdc5a64459a95194101718b283ceff` |
| slirp4netns | `1.3.3-1` | `dda3ca5101c58e9585bfd6e7b9d26831090327120cfb5092172ead355f968dd4` |
| uidmap | `1:4.17.4-2ubuntu3` | `b4942df2976de17739887a170d51060c30ae5433fd7123b444c9ec5cef9490ff` |

Simulation result: `0 upgraded, 17 newly installed, 0 to remove, 14 not
upgraded`. No held package was reported. The 14 pending unrelated upgrades,
including systemd and AppArmor updates, were not selected by the simulation.
This is a positive change-isolation signal only; it is not proof that the stale
versions remain downloadable.

`fuse-overlayfs` was simulated separately: one new package, zero upgrades and
zero removals because its libraries are already satisfied. It stays excluded
unless actual rootless overlay2 testing fails and the owner separately approves
the fallback.

## 6. Required owner decisions

The owner must resolve all of these before a provisioning request can be GO:

1. **Package authority:** official Docker CE is the selected source target.
   Mixing Docker CE and Ubuntu archive package authorities remains prohibited.
2. **Fresh lock:** authorize a later metadata-refresh window for only the
   selected source, independent key-fingerprint verification, package payload
   retrieval/inspection, exact version/hash freeze and a repeat simulation.
3. **Rootful auto-start prevention:** after Docker CE payloads and maintainer
   scripts plus current unit/dependency ownership are inspected, separately
   approve one exact, bounded and reversible strategy that prevents rootful
   Docker daemon/socket activation during the authorized transaction. No
   prevention mechanism is pre-approved by this document.
4. **Cgroup delegation:** decide whether an owner-controlled
   `user@.service.d` drop-in is acceptable if ordinary-WSL evidence does not
   already prove writable `cpu memory pids` delegation.
5. **Daemon supervision:** approve the dedicated user unit, no automatic
   restart, no linger by default, and abort-on-logout behavior.
6. **Registry:** select the controlled TLS registry, namespace, authentication,
   retention, independent digest verifier and offline/no-network acceptance
   window.
7. **Evidence custody:** identify the external evaluator/operator and
   evaluator-owned append-only store; the UID 1000 rootless stack cannot
   satisfy this property.

## 7. Exact proposed runtime and change-impact inventory

### 7.1 Identities and endpoint

- developer/owner: Windows/WSL owner, outside the acceptance identity claim;
- trusted gateway/controller: existing UID/GID 1000;
- rootless daemon: UID/GID 1000 in a dedicated systemd user unit;
- evaluated workload: container UID/GID 65532 mapped through observed daemon
  maps;
- evaluator/evidence custodian: external identity and store, still BLOCKED;
- controller endpoint: exactly
  `unix:///run/user/1000/afyx-forge/docker.sock`;
- CLI: package-owned `/usr/bin/docker`, root-owned and non-user-writable, with
  version, package and file SHA-256 recorded.

No Docker group membership, rootful/TCP socket, personal Docker context,
`DOCKER_HOST`, host home mount, Docker socket mount or Windows path is allowed.

### 7.2 Planned persistent/runtime layout

```text
/var/lib/afyx-forge-public-runtime/       root:root 0755, ext4 boundary
  engine/                                 1000:1000 0700
  build/                                  1000:1000 0700
  workspaces/                             1000:1000 0700
  artifacts/                              1000:1000 0700; public OCI only

/run/user/1000/afyx-forge/                1000:1000 0700, ephemeral
  docker.sock
  exec/
  docker.pid
```

Private evaluator evidence and registry credentials are forbidden from this
tree. Every path must be non-symlink ext4 (runtime directory may be the
systemd-managed tmpfs), have exact ownership/mode, and resolve outside `/mnt`,
host home, repository and evaluator storage.

### 7.3 Planned host changes — not executed

Depending on the source decision, the bounded authorization would affect:

- selected exact packages and their solver closure only;
- for Docker CE only, one task-approved source file and one independently
  verified key under `/etc/apt`; neither exists now;
- an exact, separately approved and reversible rootful auto-start prevention
  control, whose targets and effects are derived from verified Docker CE
  payload/maintainer-script inspection and current unit/dependency ownership;
- `/var/lib/afyx-forge-public-runtime` and its four children;
- one reviewed user unit named `afyx-forge-rootless-docker.service` and its
  task-owned configuration;
- optionally one systemd `user@.service.d` delegation drop-in, only if the
  ordinary-host checkpoint proves it necessary;
- `/run/user/1000/afyx-forge` at service start; and
- an ephemeral, isolated Docker client config used only for controlled
  registry promotion.

No change to `/etc/subuid` or `/etc/subgid` is proposed: each already has one
65,536-entry range. Package maintainer scripts may create units, sockets or a
`docker` group; their exact payload/scripts must be inspected after authorized
download and before installation. Any undeclared impact is a STOP condition.
Global masking of system `containerd.service` or any unrelated service is
explicitly prohibited without impact evidence and separate owner approval;
this document authorizes no masking.

## 8. Authenticated daemon map and ACL design

The P2 `RuntimeIdentityMapSource` must be populated from the running daemon,
not `/etc/subuid` arithmetic. The authorized runtime gateway must:

1. obtain the dedicated user unit's MainPID and exact cgroup from systemd;
2. verify package-owned RootlessKit/dockerd executable paths and file hashes;
3. find exactly one dockerd descendant in that cgroup and bind its PID,
   process start time and executable identity to the socket instance;
4. read that process's `/proc/<pid>/uid_map` and `gid_map` before each launch,
   re-read after preparation, and abort on PID/start-time/map change;
5. require one unique non-root mapping for UID/GID 65532; and
6. pass only that verified observation to `MappedUidWorkspacePreparer`.

P2 then enforces the exact 14-entry access/default ACL: base group and other
are `---`; only owner, approved named workload UID/GID, gateway UID and mask
receive `rwx`. Real ext4 ACL behavior and post-finalization cleanup remain
runtime acceptance tests.

## 9. Planned provisioning sequence — NOT EXECUTED

Every stage has an owner checkpoint and stops on drift:

1. **Use the selected source target.** Official Docker CE is selected; mixing
   package authorities is prohibited. This step records direction only and
   performs no repository action.
2. **Acquire fresh metadata under separate authorization.** Verify HTTPS
   endpoint, signing fingerprint through two channels, signed Release identity,
   candidate set and package SHA-256. Do not install.
3. **Inspect payload and maintainer scripts.** Require `/usr/bin/docker`,
   dockerd, RootlessKit launch assets and Buildx plugin; enumerate units, unit
   ownership, dependencies/reverse dependencies, accounts/groups, sockets,
   config, triggers and post-install actions. Capture the current
   installed/active/enabled/masked state for every potentially affected unit.
4. **Freeze closure.** Pin every direct/transitive version and hash; repeat
   `apt-get --simulate --no-install-recommends`; require zero removal,
   unrelated upgrade, downgrade or replacement.
5. **Design and separately approve rootful auto-start prevention.** Use the
   verified evidence from step 3 to propose the narrowest transaction-bounded,
   reversible control. State exact targets, duration, verification and
   rollback. Do not assume a mask, and do not globally mask system
   `containerd.service` or unrelated services without impact evidence and
   separate approval.
6. **Apply only the separately approved prevention control.** Immediately
   verify the recorded unit state and prove the rootful daemon/socket cannot
   activate through the planned transaction. Abort on any unreviewed unit or
   dependency effect.
7. **Install exact closure.** This step requires a new explicit authorization.
   Verify dpkg status and package/file hashes immediately; abort before service
   creation on mismatch.
8. **Create layout.** Establish only the approved ext4 paths and exact modes;
   reject symlinks, DrvFS/9p and unexpected mount boundaries.
9. **Verify cgroup/user manager.** Prove systemd user supervision and writable
   delegated `cpu memory pids`; apply an approved drop-in only if required.
10. **Install reviewed user unit.** Use the package-owned rootless launcher and
   explicit endpoint/data/exec/PID paths, `Delegate=yes`, `Restart=no`, no
   rootful socket, no TCP listener and no linger unless separately approved.
11. **Start only in an authorized acceptance window.** Verify socket
    owner/mode, daemon rootless state, package identities, maps, cgroup driver
    and empty stores before any image operation.
12. **Promote public image.** Build with the accepted T09.E7 recipe, use an
    isolated credential directory, independently verify the registry manifest,
    retain exact `repository@sha256`, remove credentials, disable resolution
    dependency, and retain `--pull never`.
13. **Run bounded public acceptance.** Execute only the separately authorized
    positive/negative checklist in section 11. No formal cell is included.

## 10. Rollback procedure — NOT EXECUTED

Rollback is evidence-preserving and explicit:

1. abort new launches, stop the dedicated user unit, and verify its cgroup is
   empty;
2. remove only its runtime socket/PID/exec paths after process absence is
   conclusive;
3. disable/remove only the task-owned user unit and delegation drop-in,
   restoring captured prior unit state;
4. preserve engine/workspace/public artifacts until evidence finalization and
   owner disposal approval;
5. simulate reverse dependencies, then remove only packages proven task-owned;
   never use an unreviewed broad `autoremove`;
6. remove a task-added Docker source/key only after package rollback and retain
   their identities in the audit record;
7. remove only the exact transaction-bounded auto-start prevention control
   that was separately approved, then restore and verify every recorded
   pre-change unit state; do not introduce or retain a global mask as a
   rollback shortcut; and
8. verify no socket, daemon, process, cgroup or credential directory remains.

Rollback stops if package ownership is shared, evidence is not finalized,
process absence is inconclusive or any target falls outside the inventory.

## 11. Subsequent authorized acceptance checklist

### Positive gates

- [ ] Fresh signed lock and every package/file hash match.
- [ ] Rootful services/sockets never start; the prevention control is
      evidence-derived, exact, reversible and separately approved; no Docker
      group authority is used.
- [ ] System `containerd.service` and unrelated services remain unchanged
      unless impact evidence and separate owner approval explicitly authorize
      a scoped action.
- [ ] Dedicated systemd user unit, socket and ext4 paths match the inventory.
- [ ] `docker info` proves rootless mode, cgroup v2 and systemd driver.
- [ ] `cpu`, `memory` and `pids` limits are observed in the workload cgroup.
- [ ] Authenticated live daemon maps uniquely translate UID/GID 65532.
- [ ] Exact P2 ACL is effective; workload and gateway can create/read/write as
      required, while base group/other cannot read, write or traverse.
- [ ] Fixed digest image executes with read-only root, zero capabilities,
      seccomp, no network, no forbidden mount and complete raw streams.
- [ ] Finalization precedes success; termination and cleanup are independently
      conclusive; registry credentials are absent from runtime/evidence.

### Negative/adversarial gates

- [ ] Reject substituted/rootful/TCP socket, inherited Docker context and
      unexpected daemon restart/PID/map change.
- [ ] Reject mutable tag, missing local digest, manifest mismatch and network
      resolution under `--pull never`.
- [ ] Reject host home, `/mnt`, Docker socket, credential or evaluator-evidence
      mount/probe.
- [ ] Reject missing/ambiguous maps, symlink/escape/inode swap, ACL drift,
      unexpected principal and base-group/other permission.
- [ ] Reject ignored cgroup limits, seccomp/capability/network drift, forked
      survivor, timeout/interrupt ambiguity and cleanup uncertainty.
- [ ] Reject global masking of `containerd.service` or an unrelated service
      without demonstrated impact and separate owner approval, and reject any
      unit action absent from the reviewed prevention/rollback record.
- [ ] Reject truncated capture, tamper/replay, recorder failure, durability or
      recovery failure.

No workload-isolation PASS can satisfy independent evaluator identity,
evaluator-owned evidence custody or formal T09.E1/T09.E5 approval.

## 12. STOP conditions and next owner gate

Stop before installation if any of these remains true:

- the selected Docker CE source cannot be authenticated and locked, its
  supportability is unresolved, or a different source is proposed without a
  new owner decision;
- metadata/key/version/hash/payload/maintainer-script evidence is stale,
  missing or mismatched;
- simulation proposes a removal, unrelated upgrade, downgrade or undeclared
  package/config/account/unit change;
- Docker CE payload/maintainer-script and current unit/dependency ownership
  inspection is incomplete;
- the rootful auto-start prevention and rollback plan lacks separate owner
  approval, is not reversible, or targets `containerd.service`/an unrelated
  service without impact evidence and separate approval;
- rootful unit startup cannot be prevented and proven absent;
- `/usr/bin/docker`, rootless launcher or Buildx identity is absent or not
  package-owned;
- systemd-user/cgroup delegation, ext4 path, overlay2, socket, live map or ACL
  prerequisite is inconclusive;
- controlled registry, credential isolation or independent digest verification
  is undecided; or
- evaluator/evidence claims exceed public synthetic workload isolation.

Owner decision recorded: official Docker CE is the selected source target. The
next possible authorization is limited to fresh provenance/metadata,
payload/maintainer-script and package-lock assessment. Registry/custody,
cgroup/lingering policy, the exact rootful auto-start prevention strategy,
installation and runtime acceptance remain separate decisions. Do not authorize
installation until the exact lock, unit/dependency impact inventory, reversible
prevention control and rollback plan have been independently reviewed.

Formal Forge remains **BLOCKED — 0/36**.
