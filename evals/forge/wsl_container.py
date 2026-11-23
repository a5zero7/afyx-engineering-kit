#!/usr/bin/env python3
"""Source-level WSL container isolation prototype for synthetic workloads.

The module preserves the public ``RestrictedProcessLauncher`` boundary.  It
does not install a container engine, approve a formal runtime, or provide an
independent evaluator/evidence boundary.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import stat
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol, Sequence

from evals.forge import controller


DIGEST_PINNED_IMAGE = re.compile(
    r"^[a-z0-9][a-z0-9._:/-]*@sha256:[0-9a-f]{64}$"
)
FIXED_ENTRYPOINT = "/opt/afyx/bin/forge-synthetic-cell"
FIXED_ARGUMENTS = ("--mode", "public-synthetic")
WORKSPACE_TARGET = "/workspace"
ROOTLESS_DOCKER_ENDPOINT = "unix:///run/user/1000/afyx-forge/docker.sock"
FORBIDDEN_MOUNT_SOURCES = (
    Path("/home"),
    Path("/mnt"),
    Path("/root"),
    Path("/run"),
    Path("/var/run"),
)
FORBIDDEN_CONTAINER_TARGETS = {
    "/",
    "/home",
    "/mnt",
    "/root",
    "/run",
    "/var/run",
    "/var/run/docker.sock",
}
FORBIDDEN_SYSCALLS = {
    "add_key",
    "bpf",
    "clone",
    "clone3",
    "connect",
    "init_module",
    "keyctl",
    "kexec_load",
    "mount",
    "open_by_handle_at",
    "ptrace",
    "reboot",
    "request_key",
    "setns",
    "socket",
    "swapon",
    "umount2",
    "unshare",
}


class ContainerPolicyViolation(ValueError):
    """A launch policy is unsafe or cannot be verified."""


@dataclass(frozen=True)
class IdentityMapRange:
    container_start: int
    host_start: int
    length: int


@dataclass(frozen=True)
class RuntimeIdentityMaps:
    uid_ranges: tuple[IdentityMapRange, ...]
    gid_ranges: tuple[IdentityMapRange, ...]


@dataclass(frozen=True)
class AclEntry:
    default: bool
    kind: str
    qualifier: int | None
    permissions: str


@dataclass(frozen=True)
class WorkspaceAclObservation:
    workspace: Path
    entries: tuple[AclEntry, ...]


@dataclass(frozen=True)
class WorkspaceAccessReceipt:
    workspace: Path
    container_uid: int
    container_gid: int
    host_uid: int
    host_gid: int
    gateway_uid: int
    gateway_gid: int
    acl_verified: bool


class RuntimeIdentityMapSource(Protocol):
    def observe(self) -> RuntimeIdentityMaps:
        ...


class WorkspaceAclBackend(Protocol):
    def apply(
        self,
        workspace: Path,
        *,
        host_uid: int,
        host_gid: int,
        gateway_uid: int,
    ) -> None:
        ...

    def observe(self, workspace: Path) -> WorkspaceAclObservation:
        ...


class WorkspaceAccessPreparer(Protocol):
    def prepare(
        self,
        workspace: Path,
        *,
        workspace_root: Path,
        container_uid: int,
        container_gid: int,
    ) -> WorkspaceAccessReceipt:
        ...


@dataclass(frozen=True)
class ContainerMount:
    source: Path
    target: str
    read_only: bool


@dataclass(frozen=True)
class ContainerIsolationPolicy:
    schema_version: int
    correlation_id: str
    image: str
    uid: int
    gid: int
    read_only_root: bool
    mounts: tuple[ContainerMount, ...]
    network_mode: str
    cap_drop: tuple[str, ...]
    no_new_privileges: bool
    privileged: bool
    seccomp_profile: Path
    seccomp_sha256: str
    pids_limit: int
    memory_bytes: int
    cpus: float
    tmpfs_bytes: int
    max_timeout_seconds: int
    entrypoint: str
    arguments: tuple[str, ...]


@dataclass(frozen=True)
class ContainerExecution:
    exit_code: int | None
    stdout: bytes
    stderr: bytes
    timed_out: bool
    workload_terminated: bool
    cleanup_observed: bool
    stdout_complete: bool
    stderr_complete: bool


class ContainerRuntime(Protocol):
    def execute(
        self, policy: ContainerIsolationPolicy, timeout_seconds: int
    ) -> ContainerExecution:
        ...


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(64 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _is_within(path: Path, parent: Path) -> bool:
    return path == parent or parent in path.parents


def _assert_safe_workspace_path(path: Path, *, inspect_tree: bool = False) -> None:
    try:
        controller.assert_safe_ancestry(path)
        if inspect_tree:
            controller.assert_safe_tree(path)
    except controller.ContractViolation as error:
        raise ContainerPolicyViolation("workspace lease boundary is unsafe") from error


def _docker_cli_prefix(executable: str, endpoint: str) -> tuple[str, ...]:
    executable_path = Path(executable)
    if not executable_path.is_absolute() or ".." in executable_path.parts:
        raise ContainerPolicyViolation("container executable path is invalid")
    if endpoint != ROOTLESS_DOCKER_ENDPOINT:
        raise ContainerPolicyViolation("rootless Docker endpoint is invalid")
    return (str(executable_path), "--host", endpoint)


def _validate_identity_ranges(
    ranges: tuple[IdentityMapRange, ...], label: str
) -> tuple[IdentityMapRange, ...]:
    if not ranges or any(type(item) is not IdentityMapRange for item in ranges):
        raise ContainerPolicyViolation(f"runtime {label} map is missing")
    container_intervals: list[tuple[int, int]] = []
    host_intervals: list[tuple[int, int]] = []
    maximum = 2**32
    for item in ranges:
        if (
            type(item.container_start) is not int
            or type(item.host_start) is not int
            or type(item.length) is not int
            or item.container_start < 0
            or item.host_start < 0
            or item.length <= 0
            or item.container_start + item.length > maximum
            or item.host_start + item.length > maximum
        ):
            raise ContainerPolicyViolation(f"runtime {label} map is invalid")
        container_intervals.append(
            (item.container_start, item.container_start + item.length)
        )
        host_intervals.append((item.host_start, item.host_start + item.length))
    for intervals in (container_intervals, host_intervals):
        ordered = sorted(intervals)
        if any(left[1] > right[0] for left, right in zip(ordered, ordered[1:])):
            raise ContainerPolicyViolation(f"runtime {label} map is ambiguous")
    return ranges


def _mapped_host_id(
    identifier: int, ranges: tuple[IdentityMapRange, ...], label: str
) -> int:
    _validate_identity_ranges(ranges, label)
    matches = [
        item.host_start + identifier - item.container_start
        for item in ranges
        if item.container_start <= identifier < item.container_start + item.length
    ]
    if len(matches) != 1 or matches[0] == 0:
        raise ContainerPolicyViolation(f"container {label} mapping is unverifiable")
    return matches[0]


class PosixAclBackend:
    """Apply and re-read a lease-local ACL without recursive mutation."""

    def __init__(
        self,
        *,
        setfacl: str = "/usr/bin/setfacl",
        getfacl: str = "/usr/bin/getfacl",
    ) -> None:
        for executable in (setfacl, getfacl):
            path = Path(executable)
            if not path.is_absolute() or ".." in path.parts:
                raise ContainerPolicyViolation("ACL executable path is invalid")
        self.setfacl = setfacl
        self.getfacl = getfacl

    @staticmethod
    def _run(argv: tuple[str, ...]) -> subprocess.CompletedProcess[bytes]:
        try:
            completed = subprocess.run(
                argv,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
                timeout=10,
                env={"PATH": "/usr/bin:/bin", "LC_ALL": "C"},
            )
        except (OSError, subprocess.TimeoutExpired) as error:
            raise ContainerPolicyViolation("workspace ACL operation failed") from error
        if completed.returncode != 0:
            raise ContainerPolicyViolation("workspace ACL operation failed")
        return completed

    def apply(
        self,
        workspace: Path,
        *,
        host_uid: int,
        host_gid: int,
        gateway_uid: int,
    ) -> None:
        self._run(
            (
                self.setfacl,
                "--physical",
                "--remove-all",
                "--remove-default",
                "--",
                str(workspace),
            )
        )
        entries = ",".join(
            (
                "u::rwx",
                f"u:{host_uid}:rwx",
                f"u:{gateway_uid}:rwx",
                "g::---",
                f"g:{host_gid}:rwx",
                "m::rwx",
                "o::---",
                "d:u::rwx",
                f"d:u:{host_uid}:rwx",
                f"d:u:{gateway_uid}:rwx",
                "d:g::---",
                f"d:g:{host_gid}:rwx",
                "d:m::rwx",
                "d:o::---",
            )
        )
        self._run(
            (
                self.setfacl,
                "--physical",
                "--modify",
                entries,
                "--",
                str(workspace),
            )
        )

    def observe(self, workspace: Path) -> WorkspaceAclObservation:
        completed = self._run(
            (
                self.getfacl,
                "--absolute-names",
                "--numeric",
                "--omit-header",
                "--physical",
                "--",
                str(workspace),
            )
        )
        try:
            text = completed.stdout.decode("utf-8", errors="strict")
        except UnicodeDecodeError as error:
            raise ContainerPolicyViolation("workspace ACL output is invalid") from error
        entries: list[AclEntry] = []
        pattern = re.compile(
            r"^(default:)?(user|group|mask|other):([^:]*):([r-][w-][x-])$"
        )
        for raw_line in text.splitlines():
            if not raw_line:
                continue
            match = pattern.fullmatch(raw_line)
            if match is None:
                raise ContainerPolicyViolation("workspace ACL output is invalid")
            default, kind, raw_qualifier, permissions = match.groups()
            if kind in {"mask", "other"} and raw_qualifier:
                raise ContainerPolicyViolation("workspace ACL output is invalid")
            qualifier = None
            if raw_qualifier:
                if not raw_qualifier.isascii() or not raw_qualifier.isdecimal():
                    raise ContainerPolicyViolation("workspace ACL is not numeric")
                qualifier = int(raw_qualifier)
            entries.append(
                AclEntry(bool(default), kind, qualifier, permissions)
            )
        return WorkspaceAclObservation(workspace=workspace, entries=tuple(entries))


class MappedUidWorkspacePreparer:
    """Prepare one controller lease from verified runtime identity maps."""

    def __init__(
        self,
        *,
        identity_maps: RuntimeIdentityMapSource,
        acl_backend: WorkspaceAclBackend,
        gateway_uid: int | None = None,
        gateway_gid: int | None = None,
    ) -> None:
        self.identity_maps = identity_maps
        self.acl_backend = acl_backend
        self.gateway_uid = os.getuid() if gateway_uid is None else gateway_uid
        self.gateway_gid = os.getgid() if gateway_gid is None else gateway_gid
        if (
            type(self.gateway_uid) is not int
            or type(self.gateway_gid) is not int
            or self.gateway_uid <= 0
            or self.gateway_gid <= 0
        ):
            raise ContainerPolicyViolation("gateway identity must be non-root")

    @staticmethod
    def _approved_entries(
        *, host_uid: int, host_gid: int, gateway_uid: int
    ) -> set[AclEntry]:
        entries: set[AclEntry] = set()
        for default in (False, True):
            entries.update(
                {
                    AclEntry(default, "user", None, "rwx"),
                    AclEntry(default, "user", host_uid, "rwx"),
                    AclEntry(default, "user", gateway_uid, "rwx"),
                    AclEntry(default, "group", None, "---"),
                    AclEntry(default, "group", host_gid, "rwx"),
                    AclEntry(default, "mask", None, "rwx"),
                    AclEntry(default, "other", None, "---"),
                }
            )
        return entries

    def prepare(
        self,
        workspace: Path,
        *,
        workspace_root: Path,
        container_uid: int,
        container_gid: int,
    ) -> WorkspaceAccessReceipt:
        if type(container_uid) is not int or type(container_gid) is not int:
            raise ContainerPolicyViolation("container workspace identity is invalid")
        unresolved_root = workspace_root.absolute()
        unresolved_workspace = workspace.absolute()
        _assert_safe_workspace_path(unresolved_root)
        _assert_safe_workspace_path(unresolved_workspace)
        root = unresolved_root.resolve(strict=True)
        resolved = unresolved_workspace.resolve(strict=True)
        if (
            unresolved_workspace.is_symlink()
            or resolved.name != "work"
            or resolved.parent.parent != root
            or resolved.parent.is_symlink()
            or not resolved.is_dir()
        ):
            raise ContainerPolicyViolation("workspace lease boundary is invalid")
        _assert_safe_workspace_path(resolved, inspect_tree=True)
        before = resolved.stat(follow_symlinks=False)
        if (
            before.st_uid != self.gateway_uid
            or before.st_gid != self.gateway_gid
            or stat.S_IMODE(before.st_mode) & stat.S_IWOTH
        ):
            raise ContainerPolicyViolation("workspace ownership is invalid")

        maps = self.identity_maps.observe()
        if type(maps) is not RuntimeIdentityMaps:
            raise ContainerPolicyViolation("runtime identity maps are invalid")
        host_uid = _mapped_host_id(container_uid, maps.uid_ranges, "UID")
        host_gid = _mapped_host_id(container_gid, maps.gid_ranges, "GID")
        if host_uid == self.gateway_uid or host_gid == self.gateway_gid:
            raise ContainerPolicyViolation(
                "container workspace identity is not subordinate"
            )
        self.acl_backend.apply(
            resolved,
            host_uid=host_uid,
            host_gid=host_gid,
            gateway_uid=self.gateway_uid,
        )
        observation = self.acl_backend.observe(resolved)
        after = resolved.stat(follow_symlinks=False)
        observed_entries = (
            observation.entries
            if type(observation) is WorkspaceAclObservation
            else ()
        )
        approved_entries = self._approved_entries(
            host_uid=host_uid,
            host_gid=host_gid,
            gateway_uid=self.gateway_uid,
        )
        if (
            type(observation) is not WorkspaceAclObservation
            or observation.workspace != resolved
            or any(type(entry) is not AclEntry for entry in observed_entries)
            or len(observed_entries) != len(set(observed_entries))
            or (before.st_dev, before.st_ino) != (after.st_dev, after.st_ino)
            or after.st_uid != self.gateway_uid
            or after.st_gid != self.gateway_gid
            or stat.S_IMODE(after.st_mode) & stat.S_IWOTH
            or set(observed_entries) != approved_entries
        ):
            raise ContainerPolicyViolation("workspace ACL verification failed")
        _assert_safe_workspace_path(resolved, inspect_tree=True)
        return WorkspaceAccessReceipt(
            workspace=resolved,
            container_uid=container_uid,
            container_gid=container_gid,
            host_uid=host_uid,
            host_gid=host_gid,
            gateway_uid=self.gateway_uid,
            gateway_gid=self.gateway_gid,
            acl_verified=True,
        )


def _validate_seccomp(path: Path, expected_sha256: str) -> None:
    if not controller.HEX_SHA256.fullmatch(expected_sha256):
        raise ContainerPolicyViolation("seccomp digest is invalid")
    if path.is_symlink() or not path.is_file():
        raise ContainerPolicyViolation("seccomp profile must be a regular file")
    if _sha256_file(path) != expected_sha256:
        raise ContainerPolicyViolation("seccomp profile digest mismatch")
    try:
        profile = json.loads(path.read_text("utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ContainerPolicyViolation("seccomp profile is unreadable") from error
    if not isinstance(profile, dict) or profile.get("defaultAction") != "SCMP_ACT_ERRNO":
        raise ContainerPolicyViolation("seccomp profile must default-deny")
    syscalls = profile.get("syscalls")
    if not isinstance(syscalls, list) or not syscalls:
        raise ContainerPolicyViolation("seccomp syscall allowlist is missing")
    allowed: set[str] = set()
    for rule in syscalls:
        if (
            not isinstance(rule, dict)
            or rule.get("action") != "SCMP_ACT_ALLOW"
            or not isinstance(rule.get("names"), list)
            or any(not isinstance(name, str) for name in rule["names"])
        ):
            raise ContainerPolicyViolation("seccomp allowlist rule is invalid")
        allowed.update(rule["names"])
    if allowed & FORBIDDEN_SYSCALLS:
        raise ContainerPolicyViolation("seccomp profile allows forbidden syscalls")


def validate_policy(
    policy: ContainerIsolationPolicy, *, workspace_root: Path
) -> ContainerIsolationPolicy:
    """Validate the complete launch policy before any runtime interaction."""

    if type(policy) is not ContainerIsolationPolicy or policy.schema_version != 1:
        raise ContainerPolicyViolation("container policy schema is invalid")
    if not controller.SAFE_CORRELATION.fullmatch(policy.correlation_id):
        raise ContainerPolicyViolation("container correlation is invalid")
    if not DIGEST_PINNED_IMAGE.fullmatch(policy.image):
        raise ContainerPolicyViolation("container image must be digest-pinned")
    if (
        type(policy.uid) is not int
        or type(policy.gid) is not int
        or not 1 <= policy.uid <= 65_535
        or not 1 <= policy.gid <= 65_535
    ):
        raise ContainerPolicyViolation("container identity must be non-root")
    if type(policy.read_only_root) is not bool or not policy.read_only_root:
        raise ContainerPolicyViolation("container root filesystem must be read-only")
    if type(policy.privileged) is not bool or policy.privileged:
        raise ContainerPolicyViolation("privileged containers are forbidden")
    if policy.network_mode != "none":
        raise ContainerPolicyViolation("container networking must be disabled")
    if policy.cap_drop != ("ALL",):
        raise ContainerPolicyViolation("all Linux capabilities must be dropped")
    if type(policy.no_new_privileges) is not bool or not policy.no_new_privileges:
        raise ContainerPolicyViolation("no_new_privileges is required")
    if len(policy.mounts) != 1:
        raise ContainerPolicyViolation("exactly one workspace mount is required")

    workspace_root = workspace_root.resolve(strict=True)
    mount = policy.mounts[0]
    source = mount.source.resolve(strict=True)
    if (
        mount.target != WORKSPACE_TARGET
        or type(mount.read_only) is not bool
        or mount.read_only
        or not source.is_dir()
        or not _is_within(source, workspace_root)
        or source == workspace_root
    ):
        raise ContainerPolicyViolation("workspace mount is invalid")
    if any(_is_within(source, forbidden) for forbidden in FORBIDDEN_MOUNT_SOURCES):
        raise ContainerPolicyViolation("workspace source is in a forbidden host root")
    if mount.target in FORBIDDEN_CONTAINER_TARGETS:
        raise ContainerPolicyViolation("workspace target is forbidden")
    if any(character in str(source) for character in (",", "\n", "\r")):
        raise ContainerPolicyViolation("workspace path is unsafe for runtime argv")
    controller.assert_safe_ancestry(source)
    controller.assert_safe_tree(source)

    if policy.seccomp_profile.is_symlink():
        raise ContainerPolicyViolation("seccomp profile cannot be a symlink")
    profile = policy.seccomp_profile.resolve(strict=True)
    if _is_within(profile, source):
        raise ContainerPolicyViolation("seccomp policy cannot come from the workspace")
    _validate_seccomp(policy.seccomp_profile, policy.seccomp_sha256)

    if (
        type(policy.pids_limit) is not int
        or not 1 <= policy.pids_limit <= 128
        or type(policy.memory_bytes) is not int
        or not 64 * 1024 * 1024 <= policy.memory_bytes <= 512 * 1024 * 1024
        or type(policy.cpus) not in {int, float}
        or not math.isfinite(policy.cpus)
        or not 0 < policy.cpus <= 2
        or type(policy.tmpfs_bytes) is not int
        or not 1 * 1024 * 1024 <= policy.tmpfs_bytes <= 64 * 1024 * 1024
        or type(policy.max_timeout_seconds) is not int
        or not 1 <= policy.max_timeout_seconds <= 600
    ):
        raise ContainerPolicyViolation("container resource bounds are invalid")
    if policy.entrypoint != FIXED_ENTRYPOINT or policy.arguments != FIXED_ARGUMENTS:
        raise ContainerPolicyViolation("container executable boundary is invalid")
    return policy


def build_synthetic_policy(
    *,
    image: str,
    workspace: Path,
    seccomp_profile: Path,
    seccomp_sha256: str,
    correlation_id: str,
) -> ContainerIsolationPolicy:
    """Generate the one supported synthetic workload policy."""

    return ContainerIsolationPolicy(
        schema_version=1,
        correlation_id=correlation_id,
        image=image,
        uid=65_532,
        gid=65_532,
        read_only_root=True,
        mounts=(ContainerMount(workspace, WORKSPACE_TARGET, False),),
        network_mode="none",
        cap_drop=("ALL",),
        no_new_privileges=True,
        privileged=False,
        seccomp_profile=seccomp_profile,
        seccomp_sha256=seccomp_sha256,
        pids_limit=32,
        memory_bytes=256 * 1024 * 1024,
        cpus=1.0,
        tmpfs_bytes=16 * 1024 * 1024,
        max_timeout_seconds=300,
        entrypoint=FIXED_ENTRYPOINT,
        arguments=FIXED_ARGUMENTS,
    )


def _container_name(policy: ContainerIsolationPolicy) -> str:
    identity = hashlib.sha256(
        (
            policy.correlation_id
            + "\0"
            + policy.image
            + "\0"
            + str(policy.mounts[0].source)
        ).encode("utf-8")
    ).hexdigest()[:24]
    return f"afyx-forge-{identity}"


def build_docker_run_argv(
    policy: ContainerIsolationPolicy,
    *,
    executable: str = "/usr/bin/docker",
    endpoint: str = ROOTLESS_DOCKER_ENDPOINT,
) -> tuple[str, ...]:
    """Build shell-free Docker argv from an already validated policy."""

    mount = policy.mounts[0]
    return (
        *_docker_cli_prefix(executable, endpoint),
        "run",
        "--pull",
        "never",
        "--name",
        _container_name(policy),
        "--read-only",
        "--init",
        "--pid",
        "private",
        "--ipc",
        "private",
        "--network",
        "none",
        "--user",
        f"{policy.uid}:{policy.gid}",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges:true",
        "--security-opt",
        f"seccomp={policy.seccomp_profile.resolve(strict=True)}",
        "--pids-limit",
        str(policy.pids_limit),
        "--memory",
        str(policy.memory_bytes),
        "--cpus",
        str(policy.cpus),
        "--mount",
        f"type=bind,src={mount.source.resolve(strict=True)},dst={mount.target}",
        "--workdir",
        WORKSPACE_TARGET,
        "--tmpfs",
        f"/tmp:rw,noexec,nosuid,nodev,size={policy.tmpfs_bytes}",
        "--env",
        "HOME=/nonexistent",
        "--env",
        "PATH=/usr/bin:/bin",
        "--entrypoint",
        policy.entrypoint,
        policy.image,
        *policy.arguments,
    )


class DockerCliRuntime:
    """Optional Docker CLI backend; unavailable engines fail closed."""

    def __init__(
        self,
        executable: str = "/usr/bin/docker",
        endpoint: str = ROOTLESS_DOCKER_ENDPOINT,
    ) -> None:
        prefix = _docker_cli_prefix(executable, endpoint)
        self.executable = prefix[0]
        self.endpoint = prefix[2]

    @property
    def command_prefix(self) -> tuple[str, ...]:
        return _docker_cli_prefix(self.executable, self.endpoint)

    def _control(
        self, arguments: Sequence[str]
    ) -> subprocess.CompletedProcess[bytes] | None:
        try:
            result = subprocess.run(
                (*self.command_prefix, *arguments),
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
                timeout=10,
                env={"PATH": os.environ.get("PATH", "/usr/bin:/bin")},
            )
        except (OSError, subprocess.TimeoutExpired):
            return None
        return result

    @staticmethod
    def _inspection_confirms_absence(
        inspection: subprocess.CompletedProcess[bytes] | None, name: str
    ) -> bool:
        if (
            inspection is None
            or inspection.returncode == 0
            or inspection.stdout != b""
            or not isinstance(inspection.stderr, bytes)
        ):
            return False
        try:
            message = inspection.stderr.decode("utf-8", errors="strict").strip()
        except UnicodeDecodeError:
            return False
        return message in {
            f"Error: No such object: {name}",
            f"Error response from daemon: No such container: {name}",
        }

    def execute(
        self, policy: ContainerIsolationPolicy, timeout_seconds: int
    ) -> ContainerExecution:
        name = _container_name(policy)
        process = subprocess.Popen(
            build_docker_run_argv(
                policy, executable=self.executable, endpoint=self.endpoint
            ),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env={"PATH": os.environ.get("PATH", "/usr/bin:/bin")},
        )
        timed_out = False
        capture_complete = True
        try:
            stdout, stderr = process.communicate(timeout=timeout_seconds)
        except subprocess.TimeoutExpired:
            timed_out = True
            self._control(("kill", name))
            try:
                stdout, stderr = process.communicate(timeout=10)
            except subprocess.TimeoutExpired:
                capture_complete = False
                process.kill()
                stdout, stderr = process.communicate()

        removal = self._control(("rm", "--force", name))
        inspection = self._control(("inspect", name))
        cleanup_observed = (
            removal is not None
            and removal.returncode == 0
            and self._inspection_confirms_absence(inspection, name)
        )
        return ContainerExecution(
            exit_code=process.returncode,
            stdout=stdout,
            stderr=stderr,
            timed_out=timed_out,
            workload_terminated=cleanup_observed,
            cleanup_observed=cleanup_observed,
            stdout_complete=capture_complete,
            stderr_complete=capture_complete,
        )


class WslContainerLauncher:
    """RestrictedProcessLauncher implementation for the synthetic container."""

    def __init__(
        self,
        *,
        runtime: ContainerRuntime,
        workspace_preparer: WorkspaceAccessPreparer,
        workspace_root: Path,
        image: str,
        seccomp_profile: Path,
        seccomp_sha256: str,
    ) -> None:
        self.runtime = runtime
        self.workspace_preparer = workspace_preparer
        self.workspace_root = workspace_root.resolve(strict=True)
        self.image = image
        if seccomp_profile.is_symlink():
            raise ContainerPolicyViolation("seccomp profile cannot be a symlink")
        self.seccomp_profile = seccomp_profile.resolve(strict=True)
        self.seccomp_sha256 = seccomp_sha256

    @property
    def expected_identity(self) -> str:
        return "container-uid:65532:65532"

    def launch(self, request: controller.LaunchRequest) -> controller.ProcessOutcome:
        policy = build_synthetic_policy(
            image=self.image,
            workspace=request.workspace,
            seccomp_profile=self.seccomp_profile,
            seccomp_sha256=self.seccomp_sha256,
            correlation_id=request.evidence_session_id,
        )
        validate_policy(policy, workspace_root=self.workspace_root)
        if request.timeout_seconds > policy.max_timeout_seconds:
            raise ContainerPolicyViolation("requested timeout exceeds container policy")
        receipt = self.workspace_preparer.prepare(
            request.workspace,
            workspace_root=self.workspace_root,
            container_uid=policy.uid,
            container_gid=policy.gid,
        )
        if (
            type(receipt) is not WorkspaceAccessReceipt
            or receipt.workspace != request.workspace.resolve(strict=True)
            or receipt.container_uid != policy.uid
            or receipt.container_gid != policy.gid
            or receipt.host_uid <= 0
            or receipt.host_gid <= 0
            or receipt.host_uid == receipt.gateway_uid
            or receipt.host_gid == receipt.gateway_gid
            or receipt.gateway_uid != os.getuid()
            or receipt.gateway_gid != os.getgid()
            or receipt.acl_verified is not True
        ):
            raise ContainerPolicyViolation("workspace access receipt is invalid")
        validate_policy(policy, workspace_root=self.workspace_root)
        execution = self.runtime.execute(policy, request.timeout_seconds)
        if type(execution) is not ContainerExecution:
            raise ContainerPolicyViolation("container runtime result is invalid")
        if (
            execution.exit_code is not None
            and type(execution.exit_code) is not int
        ) or not isinstance(execution.stdout, bytes) or not isinstance(
            execution.stderr, bytes
        ):
            raise ContainerPolicyViolation("container process result is invalid")
        if any(
            type(value) is not bool
            for value in (
                execution.timed_out,
                execution.workload_terminated,
                execution.cleanup_observed,
                execution.stdout_complete,
                execution.stderr_complete,
            )
        ):
            raise ContainerPolicyViolation("container lifecycle result is invalid")
        stdout_complete = execution.stdout_complete
        stderr_complete = execution.stderr_complete
        terminated = execution.workload_terminated and execution.cleanup_observed
        return controller.ProcessOutcome(
            identity=self.expected_identity,
            exit_code=execution.exit_code,
            stdout=execution.stdout.decode("utf-8", errors="replace"),
            stderr=execution.stderr.decode("utf-8", errors="replace"),
            stdout_upstream_truncated=not stdout_complete,
            stderr_upstream_truncated=not stderr_complete,
            stdout_stream_scan_complete=False if not stdout_complete else None,
            stderr_stream_scan_complete=False if not stderr_complete else None,
            stdout_stream_forbidden_marker=False if not stdout_complete else None,
            stderr_stream_forbidden_marker=False if not stderr_complete else None,
            timed_out=execution.timed_out,
            process_tree_terminated=terminated,
        )
