# AFYX Forge T09.E7 public synthetic OCI image readiness

Status: **SOURCE PASS / IMAGE BUILD NOT TESTED / RUNTIME NOT TESTED / FORMAL CAMPAIGN BLOCKED — 0/36**

Date: 2026-10-18 (Asia/Jakarta)

Baseline: `2c0a7d7e87e28b348c1be620686da86b4d2788d8` (PR #65 merge)

Jira: AFYX-285

## Scope and integration boundary

This bounded public development fixture supplies the executable and OCI build
inputs required by the accepted T09.E6 launcher. It does not change the
launcher, controller, recorder/verifier, seccomp profile, frozen manifest,
B0-B5 candidates, fixtures, identities, or historical evidence.

The executable contract remains exactly:

```text
/opt/afyx/bin/forge-synthetic-cell --mode public-synthetic
```

No model, provider, credential, network service, private material, container,
or campaign cell is used. T09.E4-T09.E6 evidence is reused and not recreated.

## Deterministic executable

`evals/forge/synthetic_image/cell_x86_64.S` is an independently authored,
standalone Linux x86-64 ELF entry point. It has no libc, dynamic loader,
configuration, filesystem, clock, randomness, environment, or network
dependency. The accepted arguments emit these exact bounded byte streams:

```text
stdout: AFYX_FORGE_SYNTHETIC_STDOUT_V1\n
stderr: AFYX_FORGE_SYNTHETIC_STDERR_V1\n
exit:   0
```

Missing, additional, or changed arguments emit only
`AFYX_FORGE_SYNTHETIC_ARGUMENT_ERROR_V1\n` on stderr and exit `64`. A short
write exits `74`. The implementation invokes only Linux x86-64 `write` and
`exit_group`; both appear in the unchanged T09.E6 default-deny seccomp
allowlist. Actual execution under that seccomp profile remains `NOT TESTED`.

The build helper uses a fixed shell-free GCC argv, empty bounded environment,
`SOURCE_DATE_EPOCH=0`, static non-PIE linking, no build ID, non-executable
stack, and stripped symbols. Two builds with distinct output names produced
identical bytes. On the observed source-validation host:

```text
architecture: linux/amd64 (uname x86_64)
compiler: gcc (Ubuntu 15.2.0-16ubuntu1) 15.2.0
ELF: x86-64, statically linked, stripped, no PT_INTERP
SHA-256: 170db91db351a47ac6b45c5a1f88763bed25d457cd11ff534fd24ce6d53b42b0
```

This SHA-256 identifies only the locally built executable under that observed
toolchain. It is not an OCI image digest and is not a launcher image reference.
A future acceptance build must freeze and record its compiler/linker identity,
then independently reproduce and compare the executable bytes.

## OCI recipe and digest handling

`evals/forge/synthetic_image/Containerfile` has one `FROM scratch` stage and
copies only the verified executable to the fixed path with mode `0555` and
ownership `65532:65532`. It declares the non-root user, `/workspace`, fixed
entrypoint, and fixed default arguments. It contains no package manager,
runtime library, shell, mutable base image, network build step, volume,
credential, or implicit runtime dependency.

`scripts/build_forge_synthetic_image.py` validates the exact seven logical
instructions, in order, before use. It rejects extra stages or copies,
duplicate or overridden runtime directives, inline comments, parser
directives, and malformed continuations. Blank lines and ordinary full-line
comments are allowed only between instructions. An actual image build is
requested explicitly with `--runtime`; its command uses
`--platform linux/amd64`, build network `none`, `--pull=false`, and
`--no-cache`. Build-context file timestamps and `SOURCE_DATE_EPOCH` are fixed
at zero. After a successful build the helper inspects and requires:

- Linux `amd64` metadata;
- exact UID/GID `65532:65532`;
- the fixed entrypoint and arguments; and
- a syntactically valid `sha256:` image ID.

Only an engine-reported repository digest matching
`repository@sha256:<64 lowercase hex>` is emitted in `launcher_references`.
An image ID, local tag, missing `RepoDigests`, unbuilt recipe, or fabricated
value is never treated as the T09.E6 digest-pinned launcher reference. Registry
promotion is outside this task and requires an approved immutable registry or
offline OCI artifact plus independent digest verification.

Source-only reproduction command:

```text
python scripts/build_forge_synthetic_image.py \
  --compiler /usr/bin/gcc \
  --output /tmp/forge-synthetic-cell
```

Later approved image-build form:

```text
python scripts/build_forge_synthetic_image.py \
  --compiler /approved/toolchain/gcc \
  --output /approved/output/forge-synthetic-cell \
  --runtime /approved/bin/docker \
  --image-tag afyx/forge-synthetic:t09-e7-local
```

The mutable local tag is build staging only. It must never be supplied to the
launcher.

## Validation

### SOURCE PASS

```text
python -m unittest \
  scripts.tests.test_forge_synthetic_image \
  scripts.tests.test_forge_wsl_container -v
```

Result: `24/24 PASS` comprising `11/11` fixture/image-contract tests and
`13/13` directly impacted T09.E6 launcher regressions.

The tests prove byte-identical repeated builds, static x86-64 ELF validation,
exact positive streams, negative argument handling, scratch/non-root/fixed
recipe validation, rejection of recipe drift, acceptance of a well-formed
mocked image identity, and fail-closed rejection of architecture, OS, image-ID,
or root-user drift. Python compilation also passes.

### IMAGE BUILD NOT TESTED

Docker, Podman, and Buildah executables were absent. No engine was installed,
configured, or invoked. Therefore there is no OCI image ID, repository digest,
manifest, layer digest, or image reproducibility evidence from this task.

### RUNTIME NOT TESTED

No container ran. Non-root identity, read-only root, seccomp, namespaces,
capability removal, network denial, resource limits, mounted-workspace access,
stream capture, timeout, whole-workload termination, and cleanup are not
runtime-proven here. Independent evaluator separation, protected evidence
denial, credential containment, durability/recovery, and host custody remain
unproven T09.E5 hard gates.

## Minimum next acceptance prerequisites

An owner/evaluator-approved synthetic host must provide a frozen compiler and
linker, reviewed rootless container engine/version, immutable registry or OCI
artifact storage, and the unchanged T09.E6 seccomp digest. The independent
evaluator must then:

1. reproduce the executable and record toolchain plus byte digest;
2. build for `linux/amd64` with network disabled and retain the build record;
3. inspect manifest/config/layers and scan for unexpected files or secrets;
4. publish or import immutably, discover the real repository/manifest digest,
   and independently verify it before configuring the launcher;
5. run the T09.E5 public positive, negative, and adversarial container controls
   while retaining raw evidence outside the workload boundary.

None of these steps authorizes formal-runtime promotion. The WSL amendment
remains unapproved and the formal campaign remains **BLOCKED — 0/36**.
