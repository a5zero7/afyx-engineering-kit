# AFYX Forge T09.E8.P4 official Docker CE provenance and package lock

Version: **0.1.0-assessment**

Classification: **PARTIAL — DOCKER CE PROVENANCE VERIFIED / COMPLETE INSTALLATION LOCK BLOCKED**

Status: **ACQUISITION AND STATIC INSPECTION COMPLETE / INSTALLATION NOT AUTHORIZED / FORMAL CAMPAIGN BLOCKED — 0/36**

Date: 2026-10-18 (Asia/Jakarta)

Baseline: `8284933515e9ed5790b05eff05758bf6262ed788`

Branch: `afyx/t09-e8-p4-docker-ce-package-lock`

Jira: AFYX-285

## 1. Authorization and execution boundary

The owner authorized retrieval of public Docker CE signing metadata and the
minimum official Docker CE `.deb` set into one private, user-owned temporary
directory. The only artifact origin used was:

```text
https://download.docker.com/linux/ubuntu/
```

Acquisition was limited to Ubuntu `resolute`, `amd64`, component `stable`.
Every request used HTTPS only, TLS 1.2 or newer, no redirect, a 10-second
connection timeout and a bounded total timeout. No convenience script,
alternate distribution/channel/mirror or unrelated Docker package was fetched.

The evidence workspace is:

```text
/tmp/afyx-t09-e8-p4.ZyN2PtT3
```

It is UID/GID 1000, mode `0700`; artifacts are mode `0600`. The directory is
outside the repository and system APT directories. It retains public binary
artifacts and extracted inspection material for this review session only; it is
temporary storage, not durable evidence custody. No artifact from it is tracked
by Git.

No `sudo`, `apt update`, install, package hook, daemon, container engine,
systemd mutation, OCI operation or formal Forge cell ran. Maintainer and
rootless setup scripts were read as untrusted text and never executed or
sourced.

## 2. Observation provenance

| Observation | Result | Scope/classification |
|---|---|---|
| Repository baseline and branch | Exact baseline and requested new branch | PASS |
| Host | Ubuntu 26.04 `resolute`, WSL2 kernel `6.6.114.1-microsoft-standard-WSL2`, `x86_64`, UID/GID 1000 | OBSERVED IN MANAGED SESSION |
| System manager | System-bus query denied by the managed boundary | Active unit state NOT VERIFIED |
| Relevant installed packages | Docker CE family, Ubuntu `docker.io`, `containerd`, `runc`, `rootlesskit`, `uidmap`, `acl`, `iptables`, and `nftables` absent | DPKG STATE VERIFIED |
| Relevant installed files | `/usr/bin/docker`, dockerd, containerd, runc, RootlessKit, UID-map helpers and ACL tools absent | FILE ABSENCE VERIFIED |
| Existing package-owned units/group | No Docker/containerd unit file found in inspected system paths; `docker` group absent | FILE/GROUP ABSENCE VERIFIED; active state still NOT VERIFIED |
| AppArmor rootless sysctl | `/proc/sys/kernel/apparmor_restrict_unprivileged_userns` absent in this managed view | ORDINARY-WSL PROPERTY NOT VERIFIED |

Accepted P3 signed-Ubuntu snapshot evidence is reused and not reclassified as
fresh P4 provenance. P3 recorded Ubuntu archive metadata no newer than
2026-08-10; the same local list timestamps remain visible.

## 3. Acquisition manifest

Acquisition occurred from 16:07–16:08 +07:00 on 2026-10-18.

| Artifact | Exact URL suffix under approved origin | Local evidence path | Bytes | SHA-256 |
|---|---|---|---:|---|
| Docker key | `gpg` | `docker.asc` | 3,817 | `1500c1f56fa9e26b9b8f42452a553675796ade0807cdce11975eb98170b3a570` |
| Signed repository metadata | `dists/resolute/InRelease` | `InRelease` | 32,482 | `de71c8b74943ae250d567f84ad7b72b07d0b5b8098772be88a5163a3a90a787e` |
| Stable amd64 index | `dists/resolute/stable/binary-amd64/Packages.gz` | `Packages.gz` | 34,656 | `60c0230e076751e0da1040a7f854a7b4a3099edafeefe9f807496a3032926da5` |
| containerd.io | `dists/resolute/pool/stable/amd64/containerd.io_2.4.2-2~ubuntu.26.04~resolute_amd64.deb` | same basename | 23,265,404 | `6bb52a00ac068d78f0fc090b69bb8e5efe355d2069b9f90d2ebbae23b9d5b36b` |
| Buildx | `dists/resolute/pool/stable/amd64/docker-buildx-plugin_0.38.0-1~ubuntu.26.04~resolute_amd64.deb` | same basename | 17,784,024 | `c1c3fe824d9425d247e99a61b0bb52e1d591fb4d95c5607563a857e7dd49b6be` |
| Docker CLI | `dists/resolute/pool/stable/amd64/docker-ce-cli_29.9.1-1~ubuntu.26.04~resolute_amd64.deb` | same basename | 17,593,804 | `3a72d12eccd38f5e0e7b4752ea1912ff36de7238acf7344badebe1c58ae36c82` |
| Rootless extras | `dists/resolute/pool/stable/amd64/docker-ce-rootless-extras_29.9.1-1~ubuntu.26.04~resolute_amd64.deb` | same basename | 10,178,784 | `448fef742446752e878bdbc322a1ea0fbfa3e65b980612bb35fec70918bd73d1` |
| Docker engine | `dists/resolute/pool/stable/amd64/docker-ce_29.9.1-1~ubuntu.26.04~resolute_amd64.deb` | same basename | 24,584,460 | `cb283f77ac1a9e010d1dbe656be58063617e1360ca9f48e5ebe61cf72d2ac96b` |

The full local path for each basename is the evidence-workspace path in section
1 plus that basename. Extracted control and payload trees are under `control/`
and `payload/`; they are inspection derivatives, not additional trust anchors.

## 4. Cryptographic provenance

### 4.1 Signing identity and independent corroboration

An isolated `GNUPGHOME` and keyring produced:

```text
Primary: 9DC858229FC7DD38854AE2D88D81803C0EBFCD88
UID:     Docker Release (CE deb) <docker@docker.com>
Subkey:  D3306A018370199E527AE7997EA0A9C3F273FCD8
```

The independently established reference is Docker's separately hosted official
`docker/for-linux` GitHub record
[#1471](https://github.com/docker/for-linux/issues/1471). A Docker organization
member's closure record identifies the same primary fingerprint and signing
subkey after repository signature recovery. This is a separate trusted channel
from the downloaded key and `download.docker.com` metadata; it does not rely on
self-corroboration from the acquisition endpoint.

### 4.2 Release and index verification

`gpgv` against the isolated keyring returned `GOODSIG` and `VALIDSIG`. The
signature was made with subkey `7EA0A9C3F273FCD8`, chained to the corroborated
primary fingerprint. Authenticated Release fields are:

| Field | Authenticated value |
|---|---|
| Origin | `Docker` |
| Label | `Docker CE` |
| Suite | `resolute` |
| Components | `stable edge test nightly` |
| Architectures | `amd64 arm64 armhf s390x ppc64el` |
| Publication | `Fri, 16 Oct 2026 09:28:54 +0000` |
| Signature time | `2026-10-16 09:28:55 +0000` |
| Valid-Until | absent |

Only the authenticated `stable/binary-amd64` path was used. `Packages.gz`
matched the Release-declared size `34,656` and SHA-256
`60c0230e076751e0da1040a7f854a7b4a3099edafeefe9f807496a3032926da5`.
Every Docker `.deb` then matched its exact index size and SHA-256 in section 3.

This proves the chain:

```text
corroborated Docker signing identity
  -> valid signed resolute InRelease
  -> exact stable/amd64 Packages.gz digest
  -> exact .deb filename, size and SHA-256
```

The `.deb` files are not claimed to be individually signed. Their provenance is
the hash binding in the authenticated package index. The missing `Valid-Until`
field means future reuse must re-fetch and re-verify metadata; this snapshot is
not an indefinite lock.

## 5. Docker CE package matrix

All five archive bytes are independently verified through the chain above.
Blank relationship fields in the authenticated index are shown as `—`.

| Package | Exact version / arch | Depends / Pre-Depends | Conflicts / Breaks | Replaces / Provides |
|---|---|---|---|---|
| `docker-ce` | `5:29.9.1-1~ubuntu.26.04~resolute`, amd64 | `containerd.io (>= 2.1.5)`, `docker-ce-cli`, `iptables`, `nftables`, `libc6 (>= 2.34)`, `libsystemd0`; pre-depends `init-system-helpers (>= 1.54~)` | conflicts `docker.io` | replaces `docker-ce-cli (<< 5:28.0.0)` |
| `docker-ce-cli` | `5:29.9.1-1~ubuntu.26.04~resolute`, amd64 | `libc6 (>= 2.34)` | conflicts `docker-cli`, `docker.io`; breaks `docker-ce (<< 5:0)` | replaces `docker-ce (<< 5:0)` |
| `containerd.io` | `2.4.2-2~ubuntu.26.04~resolute`, amd64 | `libc6 (>= 2.38)`, `libseccomp2 (>= 2.6.0)` | conflicts `containerd`, `runc` | replaces/provides `containerd`, `runc` |
| `docker-buildx-plugin` | `0.38.0-1~ubuntu.26.04~resolute`, amd64 | — | — | replaces/enhances `docker-ce-cli` |
| `docker-ce-rootless-extras` | `5:29.9.1-1~ubuntu.26.04~resolute`, amd64 | `dbus-user-session`, `libc6 (>= 2.34)` | conflicts/breaks `rootlesskit` | replaces/provides `rootlesskit` |

`docker-ce` recommends but does not require `apparmor`, `ca-certificates`,
rootless extras, `git`, `pigz`, `procps` and `xz-utils`. The bounded simulation
used `--no-install-recommends`; rootless extras was included explicitly by the
accepted contract. Compose, model, secrets, sandbox and unrelated plugins are
excluded.

## 6. Dependency closure and package-lock manifest

### 6.1 Simulated new-package closure

A no-network, no-locking, read-only APT simulation used the five verified local
archives plus explicit P1/P2 prerequisites `uidmap` and `acl`. It selected
exactly 16 new packages, zero upgrade, zero removal and 14 unrelated packages
left not upgraded.

| Package | Version | Source/evidence | Bytes / SHA-256 | Lock status |
|---|---|---|---|---|
| `docker-ce` | `5:29.9.1-1~ubuntu.26.04~resolute` | Docker CE signed index | 24,584,460 / `cb283f77ac1a9e010d1dbe656be58063617e1360ca9f48e5ebe61cf72d2ac96b` | VERIFIED BYTES |
| `docker-ce-cli` | `5:29.9.1-1~ubuntu.26.04~resolute` | Docker CE signed index | 17,593,804 / `3a72d12eccd38f5e0e7b4752ea1912ff36de7238acf7344badebe1c58ae36c82` | VERIFIED BYTES |
| `containerd.io` | `2.4.2-2~ubuntu.26.04~resolute` | Docker CE signed index | 23,265,404 / `6bb52a00ac068d78f0fc090b69bb8e5efe355d2069b9f90d2ebbae23b9d5b36b` | VERIFIED BYTES |
| `docker-buildx-plugin` | `0.38.0-1~ubuntu.26.04~resolute` | Docker CE signed index | 17,784,024 / `c1c3fe824d9425d247e99a61b0bb52e1d591fb4d95c5607563a857e7dd49b6be` | VERIFIED BYTES |
| `docker-ce-rootless-extras` | `5:29.9.1-1~ubuntu.26.04~resolute` | Docker CE signed index | 10,178,784 / `448fef742446752e878bdbc322a1ea0fbfa3e65b980612bb35fec70918bd73d1` | VERIFIED BYTES |
| `acl` | `2.3.2-2` | accepted signed Ubuntu snapshot | 39,366 / `74bb8008be63c1deb1cd9e9ebde8189a762962a6cc4e0a36d4943380ed46a15f` | METADATA ONLY |
| `iptables` | `1.8.11-2ubuntu3` | accepted signed Ubuntu snapshot | 381,074 / `187b16f9375f53ce6a1618a29de52bb177b620589ada29e4a3e25de5d594e66f` | METADATA ONLY |
| `libip4tc2` | `1.8.11-2ubuntu3` | accepted signed Ubuntu snapshot | 24,182 / `be25148bd60125f6866dfa7940f3f1371fff4b0e8a1a9500780ad50cb8aaa0895` | METADATA ONLY |
| `libip6tc2` | `1.8.11-2ubuntu3` | accepted signed Ubuntu snapshot | 24,446 / `3d9fdb3171f1167ab3f5182de11db63bcd27aae71838618f3d46806b3134428e` | METADATA ONLY |
| `libnetfilter-conntrack3` | `1.1.1-1` | accepted signed Ubuntu snapshot | 47,520 / `facfd45a7cf6bab8ef30adbe693d6486f22e5253263f9d53b4e70b53f768970e` | METADATA ONLY |
| `libnfnetlink0` | `1.0.2-3build1` | accepted signed Ubuntu snapshot | 15,078 / `e76b638fef2c1ebf78260972a52c4716df5752b29a952aeddc0c091a74f179c2` | METADATA ONLY |
| `libnftables1` | `1.1.6-1` | accepted signed Ubuntu snapshot | 390,468 / `0e5abb5719052d9f12aadf91a3f3d5192a2e85d035ee81d07c3055a0f79d8b8f` | METADATA ONLY |
| `libnftnl11` | `1.3.1-1` | accepted signed Ubuntu snapshot | 72,288 / `a2f4d4a4ce3fac7e473c8de60a3d8948a58e9850cd8e2ced17263aa73dda7199` | METADATA ONLY |
| `libsubid5` | `1:4.17.4-2ubuntu3` | accepted signed Ubuntu snapshot | 27,980 / `d05f5f5bda0288dffa12f01f1edbc934c477e915f6cb6d85ee5f995c75947993` | METADATA ONLY |
| `nftables` | `1.1.6-1` | accepted signed Ubuntu snapshot | 76,202 / `fcdeae9ed9761550619d062f8ae87a2399c84ab87f4535bcb9ab0d3649aba59a` | METADATA ONLY |
| `uidmap` | `1:4.17.4-2ubuntu3` | accepted signed Ubuntu snapshot | 38,958 / `b4942df2976de17739887a170d51060c30ae5433fd7123b444c9ec5cef9490ff` | METADATA ONLY |

All entries above are `amd64`. The five Docker entries were absent before P4
and their archive filenames are recorded in section 3. The 11 Ubuntu entries
were also absent; their exact local signed-snapshot metadata is:

| Package | Archive filename | Depends | Other package relationships |
|---|---|---|---|
| `acl` | `pool/main/a/acl/acl_2.3.2-2_amd64.deb` | `libacl1 (= 2.3.2-2)`, `libc6 (>= 2.38)` | none |
| `iptables` | `pool/main/i/iptables/iptables_1.8.11-2ubuntu3_amd64.deb` | exact `libip4tc2`, `libip6tc2`, `libxtables12`; `netbase (>= 6.0)`, `libc6 (>= 2.42)`, `libmnl0`, `libnetfilter-conntrack3`, `libnfnetlink0`, `libnftnl11` with indexed minimums | none |
| `libip4tc2` | `pool/main/i/iptables/libip4tc2_1.8.11-2ubuntu3_amd64.deb` | `libc6 (>= 2.4)` | none |
| `libip6tc2` | `pool/main/i/iptables/libip6tc2_1.8.11-2ubuntu3_amd64.deb` | `libc6 (>= 2.4)` | none |
| `libnetfilter-conntrack3` | `pool/main/libn/libnetfilter-conntrack/libnetfilter-conntrack3_1.1.1-1_amd64.deb` | `libc6 (>= 2.38)`, `libmnl0 (>= 1.0.3-4~)`, `libnfnetlink0 (>= 1.0.2)` | none |
| `libnfnetlink0` | `pool/main/libn/libnfnetlink/libnfnetlink0_1.0.2-3build1_amd64.deb` | `libc6 (>= 2.14)` | none |
| `libnftables1` | `pool/main/n/nftables/libnftables1_1.1.6-1_amd64.deb` | `libc6 (>= 2.38)`, `libgmp10 (>= 2:6.3.0+dfsg)`, `libjansson4 (>= 2.14)`, `libmnl0`, `libnftnl11`, `libxtables12` with indexed minimums | none |
| `libnftnl11` | `pool/main/libn/libnftnl/libnftnl11_1.3.1-1_amd64.deb` | `libc6 (>= 2.34)`, `libmnl0 (>= 1.0.3-4~)` | none |
| `libsubid5` | `pool/main/s/shadow/libsubid5_4.17.4-2ubuntu3_amd64.deb` | `libaudit1 (>= 1:2.2.1)`, `libc6 (>= 2.38)`, `libselinux1 (>= 3.1~)` | none |
| `nftables` | `pool/main/n/nftables/nftables_1.1.6-1_amd64.deb` | `libnftables1 (= 1.1.6-1)`, `libc6 (>= 2.34)`, `libedit2 (>= 3.1-20130611-0)` | none |
| `uidmap` | `pool/main/s/shadow/uidmap_4.17.4-2ubuntu3_amd64.deb` | `libaudit1 (>= 1:2.2.1)`, `libc6 (>= 2.38)`, `libselinux1 (>= 3.1~)`, `libsubid5 (= 1:4.17.4-2ubuntu3)` | none |

None declares `Pre-Depends`, `Conflicts`, `Breaks`, `Replaces` or `Provides`
in the selected metadata. All remaining direct requirements were satisfied by
installed packages, including
`init-system-helpers 1.69`, `dbus-user-session 1.16.2-2ubuntu4`, `libc6
2.43-2ubuntu2.3`, `libseccomp2 2.6.0-2ubuntu5`, and `libsystemd0
259.5-0ubuntu3`.

Recursive APT inspection identified 68 dependency or virtual-package names in
the satisfied Ubuntu/system baseline. Their installed bytes and retrievable
archives were not independently locked. Eleven Ubuntu archives above were not
downloaded because P4 authorizes Docker CE package acquisition only. The local
Ubuntu snapshot is stale, and `libsystemd0` plus its systemd family have newer
local candidates that the simulation correctly left unselected.

Therefore this is not a complete reproducible or installable cross-repository
lock. A later authorization must acquire fresh signed Ubuntu metadata and the
exact Ubuntu archive closure into isolation, verify every byte, record the
complete satisfied-baseline lock, and repeat the zero-change simulation. No
Docker/Ubuntu engine or containerd alternative was mixed into the closure.

### 6.2 Networking and storage prerequisites

The rootless-extras archive provides RootlessKit, `dockerd-rootless.sh` and its
setup tool. It does not provide a separate slirp4netns binary. The launcher
prefers installed slirp4netns, then pasta/vpnkit, and otherwise selects
`gvisor-tap-vsock`. T09.E6 containers require `--network none`, so P4 does not
add an unverified network helper to the package lock. Actual daemon startup
must still prove that the selected rootless network backend is available and
does not broaden the no-network workload contract.

No FUSE device is visible in the accepted managed snapshot. `fuse-overlayfs`
remains an unselected fallback; rootless overlay2 and any fallback require
runtime evidence and separate approval.

## 7. Static payload and maintainer-script audit

Archive paths were checked before extraction: no absolute or parent-traversal
path was found. Across 215 regular payload files, no symlink and no setuid or
setgid mode was present. No maintainer script invokes `setcap`; extracted copies
show no file capability. This does not substitute for post-install filesystem
verification.

Key package-owned executable identities are:

| Package path | Payload SHA-256 |
|---|---|
| `/usr/bin/docker` | `32d26c4b23b14f4bd223338a10df671b8a247e69d959c2df01a01e94881705d1` |
| `/usr/bin/dockerd` | `d4e5b6fd43f7004bef5eb4c194f7c36a6ab15a6af70133300cb98bcf34f557c6` |
| `/usr/bin/rootlesskit` | `5f95ddebe326cd1dc220c33042e18e9176bc722f8ef1470e2dd3cd3c9de28a10` |
| `/usr/bin/dockerd-rootless.sh` | `200203633806081a401e60aefdf68a8fa73fc7dc80aa854c52a69d47710a3488` |
| `/usr/libexec/docker/cli-plugins/docker-buildx` | `5d20d03c2f9bfe7cbb249ee7ae75c4a77904a111e38ff1f7bccc317cb675c483` |
| `/usr/bin/containerd` | `7207380d89f14e8d46f7505d842a632250ab2b0588e4cb747bab7f3cf99b3931` |
| `/usr/bin/runc` | `446523987cb67583202323b787c569461fc8558ad1463aa571a3a5596bdbc11b` |

All inspected binaries are x86-64 ELF objects. `/usr/bin/docker` is owned by
the `docker-ce-cli` archive, satisfying the P2 fixed-path package-ownership
design if and only if future installation reproduces this lock and hash.

Static side effects are explicit:

- `docker-ce` installs `/usr/bin/dockerd`, SysV init content,
  `docker.service`, and `docker.socket`; its postinst creates system group
  `docker` when absent;
- `docker-ce` postinst calls helper logic that un-masks and enables both Docker
  units, then requests start/restart of both;
- `containerd.io` installs `containerd.service`; its postinst un-masks and
  enables it, then requests start/restart;
- `dockerd-rootless-setuptool.sh` can invoke the package manager for missing
  prerequisites, create a personal Docker context and user unit, then start and
  enable that unit. It is inspection evidence only and is forbidden as the P1
  provisioning mechanism; the reviewed task-owned user unit remains required;
- the Docker unit requires `/run/docker.sock`, wants system
  `containerd.service`, and starts rootful dockerd with the system containerd
  socket;
- the socket is root-owned, group `docker`, mode `0660`, and listens at
  `/run/docker.sock`; and
- the containerd unit has `Restart=always`, `Delegate=yes`, `KillMode=process`
  and `WantedBy=multi-user.target`.

The Docker postinst contains conditional AppArmor reload logic, but no AppArmor
profile path exists in these five payloads. Rootless setup explicitly warns
that `kernel.apparmor_restrict_unprivileged_userns` may block RootlessKit. The
ordinary WSL value and an approved Ubuntu 26.04 RootlessKit policy are therefore
NOT VERIFIED and remain a pre-install STOP gate.

## 8. Rootful activation and existing-unit impact

Package installation can automatically activate all three rootful units. The
maintainer scripts also explicitly un-mask them, so pre-install persistent
masking is neither sufficient nor a safe default. System containerd is a new
package-owned unit in the observed package state, but ordinary-host active
state and last-moment reverse dependencies must be re-attested outside this
managed session.

Expected impacts outside the proposed rootless runtime layout include package
files under `/usr`, `/etc/docker`, `/etc/default`, `/etc/init.d`, systemd unit
directories, `/etc/containerd`, dpkg state, systemd enablement symlinks, and the
new `docker` group. None is authorized by P4.

## 9. Proposed reversible auto-start prevention — NOT EXECUTED

The narrow proposal for a separately authorized installation is:

1. re-verify all package hashes, the complete fresh Ubuntu closure, ordinary
   host unit state, reverse dependencies, existing `docker` group and any
   existing `/usr/sbin/policy-rc.d`; STOP on drift or a pre-existing policy;
2. enter an owner-approved maintenance window and serialize package management;
3. install one transaction-scoped, root-owned `policy-rc.d` that returns 101
   for service start/restart actions; record its exact bytes, ownership and
   removal plan. This is a temporary system-wide effect and requires explicit
   approval even though the package transaction is bounded;
4. install only the exact locked closure with recommends disabled while
   independently observing that Docker, its socket and system containerd never
   start and `/run/docker.sock` never appears;
5. while the transaction guard remains active, disable the newly package-owned
   `docker.service`, `docker.socket` and `containerd.service`; verify they are
   inactive, disabled, have no wants/sockets/processes, and that no unrelated
   unit changed;
6. remove the temporary policy only after those checks, then repeat process,
   socket, unit, dependency and package-hash checks; and
7. create and start only the separately reviewed UID-1000 rootless user unit in
   a later runtime-acceptance window.

This proposal does **not** globally mask `containerd.service` or any unrelated
service. It must not overwrite an existing policy file, operate alongside
another package transaction, or proceed if a shared dependency/consumer is
found. The current managed snapshot shows `/usr/sbin/policy-rc.d` absent.
Package-owned `deb-systemd-invoke` and `invoke-rc.d` both consult that path, but
`deb-systemd-helper` enable/unmask state changes do not; that is why step 5 is
mandatory before removal. Exact commands and policy bytes require separate
review and owner approval.

Rollback must keep the transaction guard active, stop/verify absence of only
task-owned processes, remove only exact task packages after reverse-dependency
simulation, restore captured unit/group/file state, remove the task-created
policy last, and verify no daemon/socket/process remains. A pre-existing group,
unit, policy or shared package is preserved rather than deleted. Evidence is
finalized before any artifact disposal.

## 10. Remaining decisions and STOP conditions

Owner decisions still required:

1. authorize fresh Ubuntu metadata and exact Ubuntu dependency archive
   acquisition needed to complete the cross-repository byte lock;
2. accept or reject creation of the otherwise unnecessary system `docker`
   group and exact package files outside the rootless runtime tree;
3. approve the transaction-scoped service-start policy and exact post-install
   disable/rollback actions after ordinary-host re-attestation;
4. resolve Ubuntu 26.04 AppArmor/unprivileged-user-namespace requirements;
5. resolve rootless networking backend, overlay2/cgroup delegation, user-unit
   supervision, registry, credentials and evidence custody; and
6. separately authorize installation, then runtime acceptance. Neither is
   implied here.

STOP if metadata/key/hash/version drifts; any Docker artifact redirects or
leaves the approved origin; a dependency archive is unavailable; simulation
adds removal/upgrade/downgrade/replacement; a relevant unit/group/policy exists
unexpectedly; service-start suppression is not conclusive; an unrelated unit
would be changed; AppArmor/userns is unresolved; or any runtime/formal claim is
made from this static inspection.

## 11. Expected versus actual validation

| Gate | Expected | Actual | Classification |
|---|---|---|---|
| Official source | Resolute/stable/amd64 only | Exact authenticated path used; no redirects | PASS |
| Independent key trust | Separate trusted fingerprint reference | Official Docker GitHub record matches primary and signing subkey | PASS |
| Release signature | Isolated keyring and valid signature | `GOODSIG` and `VALIDSIG` | PASS |
| Index binding | Release size/hash match | Exact match | PASS |
| Docker package bytes | Five exact index size/hash matches | 5/5 match | PASS |
| Architecture | amd64 payloads | 5/5 metadata and key binaries are amd64/x86-64 | PASS |
| Dependency simulation | No removal/unrelated upgrade/downgrade | 16 new, 0 upgraded, 0 removed, 14 unrelated not upgraded | PASS FOR SNAPSHOT |
| Complete reproducible closure | Fresh, byte-verified Docker and Ubuntu closure | Docker 5/5 verified; Ubuntu archives and satisfied baseline not byte-locked | BLOCKED |
| Static audit | No script execution; exact side effects identified | Maintainer scripts/units/payloads inspected only | PASS |
| Auto-start safety | Exact reversible proposal, no blanket mask | Transaction guard and scoped disable proposal; not executed or approved | PROPOSED / NOT TESTED |
| Runtime isolation | Real rootless enforcement | No engine/container invoked | NOT TESTED |
| Formal independence | Independent evaluator/evidence custody | Not provided by same-user WSL | BLOCKED |

## 12. Final classification

**PARTIAL** is the only supportable result:

- **VERIFIED:** Docker signing identity corroboration, signed Resolute Release,
  stable amd64 index, five required official Docker CE archive bytes, exact
  Docker package metadata, payload identities and static activation behavior.
- **NOT VERIFIED/BLOCKED:** fresh byte-verified Ubuntu dependency closure,
  installed baseline archive lock, ordinary-host unit/AppArmor/userns state,
  approved auto-start controls, installation, rootless daemon and container
  enforcement, independent evaluator/evidence custody, and T09.E5 approval.

No package is approved for installation from this assessment. T09.E1 remains
authoritative, T09.E5 remains unapproved, and Formal Forge remains **BLOCKED —
0/36**.
