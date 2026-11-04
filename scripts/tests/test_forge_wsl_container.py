#!/usr/bin/env python3
"""Source-level tests for the WSL container isolation prototype."""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from unittest import mock

from evals.forge import controller, wsl_container


ROOT = Path(__file__).resolve().parents[2]
SECCOMP = ROOT / "evals/forge/policies/synthetic-seccomp-v1.json"
SECCOMP_SHA256 = hashlib.sha256(SECCOMP.read_bytes()).hexdigest()
PINNED_IMAGE = "registry.example.invalid/afyx/forge-synthetic@sha256:" + "a" * 64


class FakeRuntime:
    def __init__(self, result: wsl_container.ContainerExecution | None = None) -> None:
        self.result = result or wsl_container.ContainerExecution(
            exit_code=0,
            stdout=b"container stdout\n",
            stderr=b"container stderr\n",
            timed_out=False,
            workload_terminated=True,
            cleanup_observed=True,
            stdout_complete=True,
            stderr_complete=True,
        )
        self.calls: list[tuple[wsl_container.ContainerIsolationPolicy, int]] = []

    def execute(self, policy, timeout_seconds):
        self.calls.append((policy, timeout_seconds))
        return self.result


class FakeWorkspacePreparer:
    def __init__(self, *, verified: bool = True) -> None:
        self.verified = verified
        self.calls: list[tuple[Path, Path, int, int]] = []

    def prepare(
        self, workspace, *, workspace_root, container_uid, container_gid
    ):
        self.calls.append(
            (workspace, workspace_root, container_uid, container_gid)
        )
        return wsl_container.WorkspaceAccessReceipt(
            workspace=workspace.resolve(strict=True),
            container_uid=container_uid,
            container_gid=container_gid,
            host_uid=265_531,
            host_gid=365_531,
            gateway_uid=os.getuid(),
            gateway_gid=os.getgid(),
            acl_verified=self.verified,
        )


class FakeIdentityMapSource:
    def __init__(self, maps: wsl_container.RuntimeIdentityMaps) -> None:
        self.maps = maps
        self.calls = 0

    def observe(self) -> wsl_container.RuntimeIdentityMaps:
        self.calls += 1
        return self.maps


class FakeAclBackend:
    def __init__(
        self,
        *,
        omit_required: bool = False,
        add_unexpected: bool = False,
        other_permissions: str = "---",
        base_group_permissions: str = "---",
        malformed_default: bool = False,
    ) -> None:
        self.omit_required = omit_required
        self.add_unexpected = add_unexpected
        self.other_permissions = other_permissions
        self.base_group_permissions = base_group_permissions
        self.malformed_default = malformed_default
        self.applied: list[tuple[Path, int, int, int]] = []

    def apply(self, workspace, *, host_uid, host_gid, gateway_uid):
        self.applied.append((workspace, host_uid, host_gid, gateway_uid))

    def observe(self, workspace):
        _, host_uid, host_gid, gateway_uid = self.applied[-1]
        entries = set()
        for default in (False, True):
            entries.update(
                {
                    wsl_container.AclEntry(default, "user", None, "rwx"),
                    wsl_container.AclEntry(default, "user", host_uid, "rwx"),
                    wsl_container.AclEntry(
                        default, "group", None, self.base_group_permissions
                    ),
                    wsl_container.AclEntry(default, "group", host_gid, "rwx"),
                    wsl_container.AclEntry(default, "user", gateway_uid, "rwx"),
                    wsl_container.AclEntry(default, "mask", None, "rwx"),
                    wsl_container.AclEntry(
                        default, "other", None, self.other_permissions
                    ),
                }
            )
        if self.omit_required:
            entries.remove(wsl_container.AclEntry(False, "user", host_uid, "rwx"))
        if self.add_unexpected:
            entries.add(wsl_container.AclEntry(False, "user", 999_999, "rwx"))
        if self.malformed_default:
            entries.remove(wsl_container.AclEntry(True, "mask", None, "rwx"))
        return wsl_container.WorkspaceAclObservation(
            workspace=workspace, entries=tuple(entries)
        )


class WslContainerPolicyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="afyx-container-policy-")
        self.workspace_root = Path(self.temporary.name) / "workspaces"
        self.workspace = self.workspace_root / "lease" / "work"
        self.workspace.mkdir(parents=True)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def policy(self) -> wsl_container.ContainerIsolationPolicy:
        return wsl_container.build_synthetic_policy(
            image=PINNED_IMAGE,
            workspace=self.workspace,
            seccomp_profile=SECCOMP,
            seccomp_sha256=SECCOMP_SHA256,
            correlation_id="container-evidence-001",
        )

    def request(self, timeout_seconds: int = 30) -> controller.LaunchRequest:
        return controller.LaunchRequest(
            evaluation_run_id="container-run-001",
            control_run_id="container-control-001",
            cell_id="forge-known-file-001::B0::r1",
            workspace=self.workspace,
            user_prompt="public synthetic prompt",
            timeout_seconds=timeout_seconds,
            forbidden_output_markers=(),
            evidence_session_id="container-evidence-001",
        )

    def test_policy_and_shell_free_docker_argv_are_exact(self) -> None:
        policy = wsl_container.validate_policy(
            self.policy(), workspace_root=self.workspace_root
        )
        argv = wsl_container.build_docker_run_argv(policy)
        self.assertEqual(
            argv[:4],
            (
                "/usr/bin/docker",
                "--host",
                wsl_container.ROOTLESS_DOCKER_ENDPOINT,
                "run",
            ),
        )
        self.assertEqual(argv[4:6], ("--pull", "never"))
        self.assertNotIn("--privileged", argv)
        self.assertEqual(argv.count("--mount"), 1)
        self.assertIn("--read-only", argv)
        self.assertIn("--init", argv)
        self.assertIn("--pid", argv)
        self.assertIn("--ipc", argv)
        self.assertIn("none", argv)
        self.assertIn("ALL", argv)
        self.assertIn("no-new-privileges:true", argv)
        self.assertIn(f"seccomp={SECCOMP}", argv)
        self.assertNotIn("--cap-add", argv)
        rendered = " ".join(argv)
        self.assertNotIn("/var/run/docker.sock", rendered)
        self.assertNotIn("/mnt", rendered)
        self.assertEqual(
            argv[-4:],
            (
                wsl_container.FIXED_ENTRYPOINT,
                PINNED_IMAGE,
                "--mode",
                "public-synthetic",
            ),
        )
        self.assertNotIn("sh", argv)
        self.assertNotIn("bash", argv)

    def test_invalid_or_fallback_docker_endpoint_is_rejected(self) -> None:
        for endpoint in (
            "unix:///var/run/docker.sock",
            "tcp://127.0.0.1:2375",
            "unix:///run/user/1000/afyx-forge/../docker.sock",
            "",
        ):
            with self.subTest(endpoint=endpoint), self.assertRaises(
                wsl_container.ContainerPolicyViolation
            ):
                wsl_container.DockerCliRuntime(endpoint=endpoint)
            with self.subTest(endpoint=endpoint), self.assertRaises(
                wsl_container.ContainerPolicyViolation
            ):
                wsl_container.build_docker_run_argv(
                    self.policy(), endpoint=endpoint
                )

    def test_mutable_or_malformed_image_is_rejected(self) -> None:
        for image in (
            "afyx/forge-synthetic:latest",
            "afyx/forge-synthetic@sha256:short",
            "Afyx/forge@sha256:" + "a" * 64,
        ):
            with self.subTest(image=image), self.assertRaises(
                wsl_container.ContainerPolicyViolation
            ):
                wsl_container.validate_policy(
                    replace(self.policy(), image=image),
                    workspace_root=self.workspace_root,
                )
        with self.assertRaises(wsl_container.ContainerPolicyViolation):
            wsl_container.validate_policy(
                replace(self.policy(), correlation_id="../stale-container"),
                workspace_root=self.workspace_root,
            )

    def test_privilege_network_rootfs_and_capability_drift_fail_closed(self) -> None:
        unsafe = (
            replace(self.policy(), privileged=True),
            replace(self.policy(), network_mode="host"),
            replace(self.policy(), read_only_root=False),
            replace(self.policy(), uid=0),
            replace(self.policy(), cap_drop=()),
            replace(self.policy(), no_new_privileges=False),
        )
        for policy in unsafe:
            with self.subTest(policy=policy), self.assertRaises(
                wsl_container.ContainerPolicyViolation
            ):
                wsl_container.validate_policy(
                    policy, workspace_root=self.workspace_root
                )

    def test_forbidden_extra_mount_and_docker_socket_fail_closed(self) -> None:
        base = self.policy()
        forbidden = (
            wsl_container.ContainerMount(Path("/"), "/host", True),
            wsl_container.ContainerMount(
                Path("/var/run/docker.sock"), "/var/run/docker.sock", False
            ),
        )
        for mount in forbidden:
            with self.subTest(mount=mount), self.assertRaises(
                wsl_container.ContainerPolicyViolation
            ):
                wsl_container.validate_policy(
                    replace(base, mounts=base.mounts + (mount,)),
                    workspace_root=self.workspace_root,
                )

    def test_workspace_outside_approved_root_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory(prefix="afyx-outside-workspace-") as outside:
            policy = replace(
                self.policy(),
                mounts=(
                    wsl_container.ContainerMount(
                        Path(outside), wsl_container.WORKSPACE_TARGET, False
                    ),
                ),
            )
            with self.assertRaises(wsl_container.ContainerPolicyViolation):
                wsl_container.validate_policy(
                    policy, workspace_root=self.workspace_root
                )

    def test_excessive_resource_or_timeout_policy_is_rejected(self) -> None:
        unsafe = (
            replace(self.policy(), pids_limit=129),
            replace(self.policy(), memory_bytes=1024 * 1024 * 1024),
            replace(self.policy(), cpus=4.0),
            replace(self.policy(), tmpfs_bytes=128 * 1024 * 1024),
            replace(self.policy(), max_timeout_seconds=601),
        )
        for policy in unsafe:
            with self.subTest(policy=policy), self.assertRaises(
                wsl_container.ContainerPolicyViolation
            ):
                wsl_container.validate_policy(
                    policy, workspace_root=self.workspace_root
                )

    def test_seccomp_digest_default_action_and_syscalls_are_enforced(self) -> None:
        with self.assertRaises(wsl_container.ContainerPolicyViolation):
            wsl_container.validate_policy(
                replace(self.policy(), seccomp_sha256="0" * 64),
                workspace_root=self.workspace_root,
            )
        symlink = Path(self.temporary.name) / "seccomp-link.json"
        symlink.symlink_to(SECCOMP)
        with self.assertRaises(wsl_container.ContainerPolicyViolation):
            wsl_container.validate_policy(
                replace(self.policy(), seccomp_profile=symlink),
                workspace_root=self.workspace_root,
            )

    @mock.patch("evals.forge.wsl_container.subprocess.run")
    @mock.patch("evals.forge.wsl_container.subprocess.Popen")
    def test_docker_backend_accepts_confirmed_container_absence(
        self, popen: mock.Mock, run: mock.Mock
    ) -> None:
        process = popen.return_value
        process.communicate.return_value = (b"stdout", b"stderr")
        process.returncode = 0
        name = wsl_container._container_name(self.policy())
        run.side_effect = (
            subprocess.CompletedProcess((), 0, b"", b""),
            subprocess.CompletedProcess(
                (), 1, b"", f"Error: No such object: {name}\n".encode()
            ),
        )
        result = wsl_container.DockerCliRuntime().execute(self.policy(), 30)
        self.assertTrue(result.workload_terminated)
        self.assertTrue(result.cleanup_observed)
        self.assertTrue(result.stdout_complete)
        self.assertIsInstance(popen.call_args.args[0], tuple)
        expected_prefix = (
            "/usr/bin/docker",
            "--host",
            wsl_container.ROOTLESS_DOCKER_ENDPOINT,
        )
        self.assertEqual(popen.call_args.args[0][:3], expected_prefix)
        self.assertEqual(run.call_args_list[0].args[0][:3], expected_prefix)
        self.assertEqual(run.call_args_list[0].args[0][3:5], ("rm", "--force"))
        self.assertEqual(run.call_args_list[1].args[0][:3], expected_prefix)
        self.assertEqual(run.call_args_list[1].args[0][3], "inspect")
        for invocation in (popen.call_args, *[item for item in run.call_args_list]):
            environment = invocation.kwargs["env"]
            self.assertNotIn("DOCKER_HOST", environment)
            self.assertNotIn("DOCKER_CONTEXT", environment)

    @mock.patch("evals.forge.wsl_container.subprocess.run")
    @mock.patch("evals.forge.wsl_container.subprocess.Popen")
    def test_docker_backend_rejects_inconclusive_inspection(
        self, popen: mock.Mock, run: mock.Mock
    ) -> None:
        process = popen.return_value
        process.communicate.return_value = (b"stdout", b"stderr")
        process.returncode = 0
        for error in (
            b"permission denied\n",
            b"Cannot connect to the Docker daemon\n",
            b"unexpected inspection failure\n",
        ):
            with self.subTest(error=error):
                run.reset_mock()
                run.side_effect = (
                    subprocess.CompletedProcess((), 0, b"", b""),
                    subprocess.CompletedProcess((), 1, b"", error),
                )
                result = wsl_container.DockerCliRuntime().execute(
                    self.policy(), 30
                )
                self.assertFalse(result.workload_terminated)
                self.assertFalse(result.cleanup_observed)

    def test_forbidden_seccomp_syscall_is_rejected(self) -> None:
        unsafe_profile = Path(self.temporary.name) / "unsafe-seccomp.json"
        unsafe_profile.write_text(
            json.dumps(
                {
                    "defaultAction": "SCMP_ACT_ERRNO",
                    "syscalls": [
                        {"action": "SCMP_ACT_ALLOW", "names": ["read", "socket"]}
                    ],
                }
            ),
            encoding="utf-8",
        )
        digest = hashlib.sha256(unsafe_profile.read_bytes()).hexdigest()
        with self.assertRaises(wsl_container.ContainerPolicyViolation):
            wsl_container.validate_policy(
                replace(
                    self.policy(),
                    seccomp_profile=unsafe_profile,
                    seccomp_sha256=digest,
                ),
                workspace_root=self.workspace_root,
            )

    def identity_maps(self) -> wsl_container.RuntimeIdentityMaps:
        return wsl_container.RuntimeIdentityMaps(
            uid_ranges=(
                wsl_container.IdentityMapRange(0, os.getuid(), 1),
                wsl_container.IdentityMapRange(1, 200_000, 65_536),
            ),
            gid_ranges=(
                wsl_container.IdentityMapRange(0, os.getgid(), 1),
                wsl_container.IdentityMapRange(1, 300_000, 65_536),
            ),
        )

    def test_workspace_preparation_uses_observed_maps_and_verified_acl(self) -> None:
        maps = FakeIdentityMapSource(self.identity_maps())
        acl = FakeAclBackend()
        preparer = wsl_container.MappedUidWorkspacePreparer(
            identity_maps=maps,
            acl_backend=acl,
            gateway_uid=os.getuid(),
            gateway_gid=os.getgid(),
        )
        receipt = preparer.prepare(
            self.workspace,
            workspace_root=self.workspace_root,
            container_uid=65_532,
            container_gid=65_532,
        )
        self.assertEqual(receipt.host_uid, 265_531)
        self.assertEqual(receipt.host_gid, 365_531)
        self.assertTrue(receipt.acl_verified)
        self.assertEqual(maps.calls, 1)
        self.assertEqual(
            acl.applied,
            [(self.workspace.resolve(), 265_531, 365_531, os.getuid())],
        )
        self.assertFalse(self.workspace.stat().st_mode & 0o002)

    @mock.patch("evals.forge.wsl_container.subprocess.run")
    def test_posix_acl_backend_is_lease_local_nonrecursive_and_numeric(
        self, run: mock.Mock
    ) -> None:
        acl = b"\n".join(
            (
                b"user::rwx",
                b"user:1000:rwx",
                b"user:265531:rwx",
                b"group::---",
                b"group:365531:rwx",
                b"mask::rwx",
                b"other::---",
                b"default:user::rwx",
                b"default:user:1000:rwx",
                b"default:user:265531:rwx",
                b"default:group::---",
                b"default:group:365531:rwx",
                b"default:mask::rwx",
                b"default:other::---",
                b"",
            )
        )
        run.side_effect = (
            subprocess.CompletedProcess((), 0, b"", b""),
            subprocess.CompletedProcess((), 0, b"", b""),
            subprocess.CompletedProcess((), 0, acl, b""),
        )
        backend = wsl_container.PosixAclBackend()
        backend.apply(
            self.workspace.resolve(),
            host_uid=265_531,
            host_gid=365_531,
            gateway_uid=1_000,
        )
        observation = backend.observe(self.workspace.resolve())
        self.assertEqual(len(observation.entries), 14)
        self.assertEqual(run.call_count, 3)
        clear, apply, inspect = (item.args[0] for item in run.call_args_list)
        self.assertIn("--remove-all", clear)
        self.assertIn("--remove-default", clear)
        self.assertIn("--modify", apply)
        applied_entries = set(apply[3].split(","))
        self.assertEqual(
            applied_entries,
            {
                "u::rwx",
                "u:265531:rwx",
                "u:1000:rwx",
                "g::---",
                "g:365531:rwx",
                "m::rwx",
                "o::---",
                "d:u::rwx",
                "d:u:265531:rwx",
                "d:u:1000:rwx",
                "d:g::---",
                "d:g:365531:rwx",
                "d:m::rwx",
                "d:o::---",
            },
        )
        self.assertIn("--numeric", inspect)
        for argv in (clear, apply, inspect):
            self.assertNotIn("--recursive", argv)
            self.assertEqual(argv[-1], str(self.workspace.resolve()))

    def test_workspace_preparation_rejects_unverifiable_maps_or_acl(self) -> None:
        missing = wsl_container.RuntimeIdentityMaps(
            uid_ranges=(wsl_container.IdentityMapRange(0, os.getuid(), 1),),
            gid_ranges=(wsl_container.IdentityMapRange(0, os.getgid(), 1),),
        )
        ambiguous = wsl_container.RuntimeIdentityMaps(
            uid_ranges=(
                wsl_container.IdentityMapRange(0, 200_000, 65_536),
                wsl_container.IdentityMapRange(65_000, 400_000, 1_000),
            ),
            gid_ranges=self.identity_maps().gid_ranges,
        )
        non_subordinate = wsl_container.RuntimeIdentityMaps(
            uid_ranges=(
                wsl_container.IdentityMapRange(65_532, os.getuid(), 1),
            ),
            gid_ranges=self.identity_maps().gid_ranges,
        )
        cases = (
            (missing, FakeAclBackend()),
            (ambiguous, FakeAclBackend()),
            (non_subordinate, FakeAclBackend()),
            (self.identity_maps(), FakeAclBackend(omit_required=True)),
            (self.identity_maps(), FakeAclBackend(add_unexpected=True)),
        )
        for maps, acl in cases:
            with self.subTest(maps=maps, acl=acl), self.assertRaises(
                wsl_container.ContainerPolicyViolation
            ):
                wsl_container.MappedUidWorkspacePreparer(
                    identity_maps=FakeIdentityMapSource(maps),
                    acl_backend=acl,
                    gateway_uid=os.getuid(),
                    gateway_gid=os.getgid(),
                ).prepare(
                    self.workspace,
                    workspace_root=self.workspace_root,
                    container_uid=65_532,
                    container_gid=65_532,
                )

    def assert_acl_drift_prevents_runtime(self, acl: FakeAclBackend) -> None:
        runtime = FakeRuntime()
        preparer = wsl_container.MappedUidWorkspacePreparer(
            identity_maps=FakeIdentityMapSource(self.identity_maps()),
            acl_backend=acl,
            gateway_uid=os.getuid(),
            gateway_gid=os.getgid(),
        )
        launcher = wsl_container.WslContainerLauncher(
            runtime=runtime,
            workspace_preparer=preparer,
            workspace_root=self.workspace_root,
            image=PINNED_IMAGE,
            seccomp_profile=SECCOMP,
            seccomp_sha256=SECCOMP_SHA256,
        )
        with self.assertRaises(wsl_container.ContainerPolicyViolation):
            launcher.launch(self.request())
        self.assertEqual(runtime.calls, [])

    def test_inherited_other_read_traverse_prevents_runtime(self) -> None:
        self.assert_acl_drift_prevents_runtime(
            FakeAclBackend(other_permissions="r-x")
        )

    def test_unexpected_base_group_permissions_prevent_runtime(self) -> None:
        self.assert_acl_drift_prevents_runtime(
            FakeAclBackend(base_group_permissions="r-x")
        )

    def test_malformed_access_default_observation_prevents_runtime(self) -> None:
        self.assert_acl_drift_prevents_runtime(
            FakeAclBackend(malformed_default=True)
        )

    def test_workspace_preparation_rejects_world_write_symlink_and_escape(self) -> None:
        preparer = wsl_container.MappedUidWorkspacePreparer(
            identity_maps=FakeIdentityMapSource(self.identity_maps()),
            acl_backend=FakeAclBackend(),
            gateway_uid=os.getuid(),
            gateway_gid=os.getgid(),
        )
        self.workspace.chmod(0o777)
        with self.assertRaises(wsl_container.ContainerPolicyViolation):
            preparer.prepare(
                self.workspace,
                workspace_root=self.workspace_root,
                container_uid=65_532,
                container_gid=65_532,
            )
        self.workspace.chmod(0o755)
        link = self.workspace.parent / "workspace-link"
        link.symlink_to(self.workspace, target_is_directory=True)
        with self.assertRaises(wsl_container.ContainerPolicyViolation):
            preparer.prepare(
                link,
                workspace_root=self.workspace_root,
                container_uid=65_532,
                container_gid=65_532,
            )
        with tempfile.TemporaryDirectory(prefix="afyx-workspace-escape-") as outside:
            outside_work = Path(outside) / "lease" / "work"
            outside_work.mkdir(parents=True)
            with self.assertRaises(wsl_container.ContainerPolicyViolation):
                preparer.prepare(
                    outside_work,
                    workspace_root=self.workspace_root,
                    container_uid=65_532,
                    container_gid=65_532,
                )

    def test_launcher_maps_complete_runtime_result_to_controller_protocol(self) -> None:
        runtime = FakeRuntime()
        preparer = FakeWorkspacePreparer()
        launcher = wsl_container.WslContainerLauncher(
            runtime=runtime,
            workspace_preparer=preparer,
            workspace_root=self.workspace_root,
            image=PINNED_IMAGE,
            seccomp_profile=SECCOMP,
            seccomp_sha256=SECCOMP_SHA256,
        )
        outcome = launcher.launch(self.request())
        self.assertEqual(outcome.identity, "container-uid:65532:65532")
        self.assertEqual(outcome.exit_code, 0)
        self.assertEqual(outcome.stdout, "container stdout\n")
        self.assertFalse(outcome.timed_out)
        self.assertTrue(outcome.process_tree_terminated)
        self.assertEqual(len(runtime.calls), 1)
        self.assertEqual(len(preparer.calls), 1)

    def test_incomplete_capture_or_termination_is_reported_fail_closed(self) -> None:
        result = wsl_container.ContainerExecution(
            exit_code=-9,
            stdout=b"partial",
            stderr=b"",
            timed_out=True,
            workload_terminated=False,
            cleanup_observed=False,
            stdout_complete=False,
            stderr_complete=True,
        )
        launcher = wsl_container.WslContainerLauncher(
            runtime=FakeRuntime(result),
            workspace_preparer=FakeWorkspacePreparer(),
            workspace_root=self.workspace_root,
            image=PINNED_IMAGE,
            seccomp_profile=SECCOMP,
            seccomp_sha256=SECCOMP_SHA256,
        )
        outcome = launcher.launch(self.request())
        self.assertTrue(outcome.timed_out)
        self.assertFalse(outcome.process_tree_terminated)
        self.assertTrue(outcome.stdout_upstream_truncated)
        self.assertFalse(outcome.stdout_stream_scan_complete)

    def test_requested_timeout_cannot_exceed_policy(self) -> None:
        runtime = FakeRuntime()
        launcher = wsl_container.WslContainerLauncher(
            runtime=runtime,
            workspace_preparer=FakeWorkspacePreparer(),
            workspace_root=self.workspace_root,
            image=PINNED_IMAGE,
            seccomp_profile=SECCOMP,
            seccomp_sha256=SECCOMP_SHA256,
        )
        with self.assertRaises(wsl_container.ContainerPolicyViolation):
            launcher.launch(self.request(timeout_seconds=301))
        self.assertEqual(runtime.calls, [])

    def test_invalid_workspace_receipt_prevents_runtime_execution(self) -> None:
        runtime = FakeRuntime()
        launcher = wsl_container.WslContainerLauncher(
            runtime=runtime,
            workspace_preparer=FakeWorkspacePreparer(verified=False),
            workspace_root=self.workspace_root,
            image=PINNED_IMAGE,
            seccomp_profile=SECCOMP,
            seccomp_sha256=SECCOMP_SHA256,
        )
        with self.assertRaises(wsl_container.ContainerPolicyViolation):
            launcher.launch(self.request())
        self.assertEqual(runtime.calls, [])


if __name__ == "__main__":
    unittest.main()
