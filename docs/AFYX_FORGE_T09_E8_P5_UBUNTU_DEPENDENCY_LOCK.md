# AFYX Forge T09.E8.P5 Ubuntu dependency closure and host-relative lock

Version: **1.0.0-assessment**

Classification: **VERIFIED HOST-RELATIVE TRANSACTION LOCK**

Status: **PUBLIC PACKAGE EVIDENCE COMPLETE FOR THE RECORDED HOST / INSTALLATION NOT AUTHORIZED / FORMAL CAMPAIGN BLOCKED — 0/36**

Date: 2026-10-18 (Asia/Jakarta)

Baseline: `40488e36bff4489f25ce32561075fa52459d7fe5`

Branch: `afyx/t09-e8-p5-ubuntu-dependency-lock`

Jira: AFYX-285

Machine-readable evidence: [AFYX_FORGE_T09_E8_P5_LOCK_MANIFEST.json](AFYX_FORGE_T09_E8_P5_LOCK_MANIFEST.json)

## 1. Authorization and boundary

P5 closes only the Ubuntu archive and installed-baseline evidence gap identified
by accepted T09.E8.P4. The owner authorized acquisition of public Ubuntu
metadata and the exact required Ubuntu archives into a private temporary
workspace, read-only host attestation, and an offline simulation. No package was
installed or configured.

The private workspace was created with `umask 077` at:

```text
/tmp/afyx-t09-e8-p5.f9RyT8pF
```

It is owned by UID/GID 1000, mode `0700`; retained files are mode `0600`. It is
not durable evidence custody and no file from it is tracked by Git. No `sudo`,
`apt update`, host APT mutation, package hook, daemon, systemd operation, OCI
operation, container, model, private evaluator source, or campaign cell ran.

## 2. Identity and P4 continuity

`origin/dev` was fetched and resolved exactly to the required baseline before
the new branch was created. The worktree was clean and the P5 branch did not
exist locally or remotely.

The accepted P4 workspace `/tmp/afyx-t09-e8-p4.ZyN2PtT3` remains owned by
UID/GID 1000 with directory mode `0700` and artifact mode `0600`. All five
Docker CE archives remain present with the accepted identities:

| Package | Version | Bytes | SHA-256 |
|---|---|---:|---|
| `containerd.io` | `2.4.2-2~ubuntu.26.04~resolute` | 23,265,404 | `6bb52a00ac068d78f0fc090b69bb8e5efe355d2069b9f90d2ebbae23b9d5b36b` |
| `docker-buildx-plugin` | `0.38.0-1~ubuntu.26.04~resolute` | 17,784,024 | `c1c3fe824d9425d247e99a61b0bb52e1d591fb4d95c5607563a857e7dd49b6be` |
| `docker-ce-cli` | `5:29.9.1-1~ubuntu.26.04~resolute` | 17,593,804 | `3a72d12eccd38f5e0e7b4752ea1912ff36de7238acf7344badebe1c58ae36c82` |
| `docker-ce-rootless-extras` | `5:29.9.1-1~ubuntu.26.04~resolute` | 10,178,784 | `448fef742446752e878bdbc322a1ea0fbfa3e65b980612bb35fec70918bd73d1` |
| `docker-ce` | `5:29.9.1-1~ubuntu.26.04~resolute` | 24,584,460 | `cb283f77ac1a9e010d1dbe656be58063617e1360ca9f48e5ebe61cf72d2ac96b` |

P4's Docker key, `InRelease`, and package index hashes also match its report.
No Docker artifact was downloaded, replaced, upgraded, or re-audited in P5.

## 3. Ubuntu source identity and authenticated metadata

### 3.1 Configured authority

Read-only inspection found `/etc/apt/sources.list.d/ubuntu.sources` with:

- `http://archive.ubuntu.com/ubuntu/`: `resolute`, `resolute-updates`, and
  `resolute-backports`;
- `http://security.ubuntu.com/ubuntu/`: `resolute-security`;
- components `main universe restricted multiverse`; and
- `Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg`.

The source-definition SHA-256 is
`d848e90ed2dd1696138929943c7f403cdcd6698f1d6bd615b8808508d1d0db5f`.
The trusted keyring SHA-256 is
`80a36b0a6de2f69f49d2df75ef473ccde121e9e190b9ea01d20a4f63778d5c31`.
The relevant trusted signer is Ubuntu Archive Automatic Signing Key (2018),
fingerprint `F6ECB3762474EDA9D21B7022871920D1991BC93C`.

P5 acquired the minimum relevant `main/binary-amd64` indexes. Every member of
the resolved transaction and installed baseline is in `main`; `universe` and
`resolute-backports` contain no selected member and were therefore not fetched.
There was no alternate mirror or unsigned fallback.

### 3.2 Signature and hash chain

| Suite | Authenticated publication | InRelease SHA-256 | `main/binary-amd64/Packages.xz` SHA-256 | Result |
|---|---|---|---|---|
| `resolute` | 2026-04-23 17:07:15 UTC | `45f95ce276cdba3e41870516a130e03c58b8b7a79e9546b0efe9e526d255740c` | `ed9ac41cb263efaecc5a06a0742dc56570e2fb5ff94c4f2e4b2fbdcddd73cf24` | PASS |
| `resolute-updates` | 2026-10-18 07:02:20 UTC | `dd12a96cebed6b07a7209127af2af65d0e49f4e27294f8289b8b370d2cb78ff4` | `c8df5691b931838a76ad3a732dc89ce35279d620b4aa8fa5a5df26f6364bf6c0` | PASS |
| `resolute-security` | 2026-10-17 23:34:23 UTC | `3ce187a5bb2a15221be6553f99268bd7494948dacba8835c711f7f1f4e9ce890` | `52c862536ffe7b896e6d48304c950125eb5f6f1ae7ec075a114a4ca3e8b8fcae` | PASS |

For each suite, isolated `gpgv` returned `GOODSIG` and `VALIDSIG` for the
fingerprint above. Origin, label, suite/codename, architecture, and component
matched Ubuntu Resolute. Each compressed index matched the size and SHA-256 in
its signed `InRelease`, and `xz --test` passed.

Ubuntu's three acquired `InRelease` files omit `Valid-Until`. The updates and
security publications were current on acquisition day; the immutable base
publication is the release snapshot. This establishes freshness for this
assessment but not an indefinite future lock. Future installation review must
revalidate metadata and STOP on drift.

The trust chain is:

```text
installed Ubuntu archive keyring
  -> valid Resolute InRelease signature
  -> exact amd64/main index size and SHA-256
  -> exact package filename, size and SHA-256
  -> downloaded Ubuntu archive bytes
```

## 4. Ubuntu transaction closure

Fresh authenticated candidates are unchanged from P4. Exactly these eleven
Ubuntu archives were necessary and acquired; no unrelated upgrade package was
downloaded.

| Package | Exact version | Bytes | SHA-256 | Principal dependency constraints |
|---|---|---:|---|---|
| `acl` | `2.3.2-2` | 39,366 | `74bb8008be63c1deb1cd9e9ebde8189a762962a6cc4e0a36d4943380ed46a15f` | exact `libacl1`; `libc6 >= 2.38` |
| `iptables` | `1.8.11-2ubuntu3` | 381,074 | `187b16f9375f53ce6a1618a29de52bb177b620589ada29e4a3e25de5d594e66f` | exact `libip4tc2`, `libip6tc2`, `libxtables12`; bounded libc/netfilter libraries and `netbase` |
| `libip4tc2` | `1.8.11-2ubuntu3` | 24,182 | `be25148d60125f6866dfa7940f3f1371fff4b0e8a1a9500780ad50cb8aaa0895` | `libc6 >= 2.4` |
| `libip6tc2` | `1.8.11-2ubuntu3` | 24,446 | `3d9fdb3171f1167ab3f5182de11db63bcd27aae71838618f3d46806b3134428e` | `libc6 >= 2.4` |
| `libnetfilter-conntrack3` | `1.1.1-1` | 47,520 | `facfd45a7cf6bab8ef30adbe693d6486f22e5253263f9d53b4e70b53f768970e` | `libc6 >= 2.38`, `libmnl0`, `libnfnetlink0` |
| `libnfnetlink0` | `1.0.2-3build1` | 15,078 | `e76b638fef2c1ebf78260972a52c4716df5752b29a952aeddc0c091a74f179c2` | `libc6 >= 2.14` |
| `libnftables1` | `1.1.6-1` | 390,468 | `0e5abb5719052d9f12aadf91a3f3d5192a2e85d035ee81d07c3055a0f79d8b8f` | libc, GMP, Jansson, MNL, exact-or-newer nftnl and xtables constraints |
| `libnftnl11` | `1.3.1-1` | 72,288 | `a2f4d4a4ce3fac7e473c8de60a3d8948a58e9850cd8e2ced17263aa73dda7199` | `libc6 >= 2.34`, `libmnl0` |
| `libsubid5` | `1:4.17.4-2ubuntu3` | 27,980 | `d05f5f5bda0288dffa12f01f1edbc934c477e915f6cb6d85ee5f995c75947993` | audit, libc and SELinux libraries |
| `nftables` | `1.1.6-1` | 76,202 | `fcdeae9ed9761550619d062f8ae87a2399c84ab87f4535bcb9ab0d3649aba59a` | exact `libnftables1`, libc, `libedit2` |
| `uidmap` | `1:4.17.4-2ubuntu3` | 38,958 | `b4942df2976de17739887a170d51060c30ae5433fd7123b444c9ec5cef9490ff` | exact `libsubid5`, audit, libc and SELinux libraries |

All are `amd64`, originate from signed `resolute/main`, and their embedded
package/version/architecture fields match the index. Downloaded size and
SHA-256 match 11/11. None of the selected Ubuntu packages declares
`Pre-Depends`, `Conflicts`, `Breaks`, `Replaces`, or `Provides` in the selected
record. Full filenames, hashes, and verbatim `Depends`/`Pre-Depends` values for
all 16 transaction packages are in the JSON manifest. This preserves exact
constraints rather than treating the abbreviated matrix above as authoritative.

Together with the five unchanged P4 Docker archives, all 16 transaction
archives are **VERIFIED ARCHIVE BYTES**.

## 5. Installed and virtual-provider baseline

P4's recursive baseline was reconciled to 68 names:

- 62 actual installed packages with exact name, architecture, version, and
  `install ok installed` status;
- four virtual requirements: `awk -> mawk`, `dbus-system-bus -> dbus-daemon`,
  `debconf-2.0 -> debconf`, and `systemd-sysusers -> systemd`; and
- two unselected alternatives: `cdebconf -> debconf` and
  `dbus-broker -> dbus-daemon`.

The exact 62-package inventory is in the JSON manifest. The host dpkg status
snapshot has SHA-256
`5b525a25544a1e32ca6268fc75892cdbb4b0565415876e4aff029c9e70089dea`.
`dpkg -V` returned no mismatch and exit zero for all 62 packages.

Fresh signed index records contain the exact installed version and archive
SHA-256 for 53/62 packages. Nine installed versions have been superseded and no
longer have an exact record in the current indexes:

| Installed package | Installed version | Evidence classification |
|---|---|---|
| `base-files` | `14ubuntu6.1` | INSTALLED-STATE ATTESTED; INSTALLED BYTES NOT INDEPENDENTLY VERIFIED |
| `libc-gconv-modules-extra` | `2.43-2ubuntu2.3` | same |
| `libc6` | `2.43-2ubuntu2.3` | same |
| `libpam-modules` | `1.7.0-5ubuntu3.1` | same |
| `libpam-modules-bin` | `1.7.0-5ubuntu3.1` | same |
| `libpam-runtime` | `1.7.0-5ubuntu3.1` | same |
| `libpam0g` | `1.7.0-5ubuntu3.1` | same |
| `libssl3t64` | `3.5.5-1ubuntu3.3` | same |
| `openssl-provider-legacy` | `3.5.5-1ubuntu3.3` | same |

For the other 53, the archive hash is **TRUSTED REPOSITORY METADATA ONLY**;
their archive bytes were deliberately not downloaded because they are already
installed and are not transaction members. No installed package is falsely
classified as independently byte-locked. `dpkg -V` verifies dpkg-recorded file
checksums, not equivalence to a separately acquired `.deb`. Read-only inspection
of `/var/cache/apt/archives` found 125 `.deb` files but zero exact
package/version matches for this 62-package installed baseline; newer cached
updates were not substituted for installed versions.

The exact direct constraints from Docker and the eleven Ubuntu transaction
records, plus every transitive dependency/alternative, were resolved against
this copied status database by APT. The key direct installed satisfiers were:

| Constraint | Installed satisfier |
|---|---|
| `init-system-helpers >= 1.54~` | `1.69` |
| `dbus-user-session` | `1.16.2-2ubuntu4` |
| `libc6 >= 2.38` (strongest selected requirement) | `2.43-2ubuntu2.3` |
| `libseccomp2 >= 2.6.0` | `2.6.0-2ubuntu5` |
| `libsystemd0` | `259.5-0ubuntu3` |
| `libacl1 = 2.3.2-2` | `2.3.2-2` |
| `libxtables12 = 1.8.11-2ubuntu3` | `1.8.11-2ubuntu3` |
| `libmnl0 >= 1.0.3-4~` | `1.0.5-3build1` |
| `libgmp10 >= 2:6.3.0+dfsg` | `2:6.3.0+dfsg-5ubuntu2` |
| `libjansson4 >= 2.14` | `2.14-2build4` |
| `libedit2 >= 3.1-20130611-0` | `3.1-20251016-1` |

There is no observed baseline drift that changes satisfiability relative to
P4. Current indexes do expose newer unrelated candidates, but the simulation
leaves them unchanged.

## 6. Isolated offline simulation

The simulation used:

- a private copy of `/var/lib/dpkg/status`;
- only the three verified Ubuntu amd64/main indexes;
- the five verified P4 Docker archives and eleven verified P5 Ubuntu archives
  passed as exact local `.deb` operands;
- `--simulate --no-download --no-install-recommends`;
- isolated state, lists, cache, archives, and source-definition paths; and
- `Debug::NoLocking=true` so no host package lock was touched.

No network-backed resolution was possible during the final solver invocation.
No maintainer script or package configuration hook ran.

Result:

```text
0 upgraded, 16 newly installed, 0 to remove and 160 not upgraded
```

The exact new set is the accepted Docker five plus the Ubuntu eleven. There is
zero removal, unrelated upgrade, downgrade, undeclared replacement, Ubuntu
`docker.io`, distribution `containerd`, or distribution `runc`. The unchanged
160 count reflects fresher metadata relative to the host; those packages are
not selected.

## 7. Reproducibility boundary

This is a **VERIFIED HOST-RELATIVE TRANSACTION LOCK** because:

1. all 16 transaction archive bytes are bound to trusted signed metadata;
2. all required dependencies and virtual providers are present in the recorded
   installed baseline;
3. all 62 actual baseline packages have exact installed state and clean
   dpkg-recorded integrity observations; and
4. the isolated final solver selects exactly the intended transaction with no
   destructive or unrelated change.

It is not a clean-machine lock. Nine installed baseline versions lack a current
archive record, none of the 62 installed archives was independently acquired,
and `/tmp` is not durable custody. Reproduction on another machine requires a
fresh full resolution or acquisition of an independently verified clean-base
snapshot; P5 does not authorize that expansion.

## 8. Expected versus actual

| Gate | Expected | Actual | Classification |
|---|---|---|---|
| Baseline | Exact fetched `dev`, clean new branch | `40488e36...fa52459d7fe5`; clean; branch created once | PASS |
| P4 continuity | Exact Docker five, no redownload | 5/5 identity, size, and hash match | PASS / REUSED |
| Ubuntu trust | Configured authority, trusted signer | Ubuntu archive key fingerprint matches; 3/3 signatures valid | PASS |
| Index binding | Signed Release size/hash | 3/3 amd64/main indexes exact and decompress cleanly | PASS |
| Ubuntu candidates | Reconcile P4 eleven | 11/11 unchanged | PASS |
| Ubuntu bytes | Exact downloaded archives | 11/11 size, hash, and embedded identity match | PASS |
| Baseline | Resolve P4 68 names | 62 installed plus 6 virtual/alternative mappings | PASS |
| Baseline integrity | Honest evidence levels | 62/62 dpkg verification pass; 53 index hashes; 9 installed-only | PASS / HOST-RELATIVE |
| Offline solver | Exact 16; no harmful drift | 16 new, 0 upgrade/removal/downgrade/replacement | PASS |
| Clean-machine reproducibility | Independent complete base archives | Not established | NOT VERIFIED |
| Installation/runtime | Real package and isolation enforcement | Not authorized or executed | NOT TESTED |
| Formal independence | Independent evaluator/evidence custody | Same-user WSL does not establish it | BLOCKED |

## 9. Remaining owner decisions and STOP conditions

Before T09.E8.P6 or any installation, the owner must separately decide whether
to accept this host-relative baseline, require a clean-base archive lock, and
authorize a fresh last-moment provenance/simulation check. P4's service-start
guard, unit impact, AppArmor/user-namespace, rootless networking/storage,
cgroup delegation, credential handling, registry, and evidence-custody gates
remain unchanged and unapproved.

STOP if any Docker or Ubuntu version/hash/source changes; the installed status
digest or provider map drifts; the solver adds an upgrade, removal, downgrade,
replacement, or distribution Docker/containerd/runc; any archive becomes
unavailable; an unsigned/alternate source is required; or installation/runtime
authority is inferred from this assessment.

T09.E8.P6 installation safety review remains separate. T09.E1 native Windows
remains authoritative, T09.E5 remains unapproved, and Formal Forge remains
**BLOCKED — 0/36**.
