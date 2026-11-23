#!/usr/bin/env python3
"""Native-Windows, zero-model Forge integration lab.

This developer-side adapter runs one fixed public synthetic child as the current
non-admin identity. It is not a privileged launcher or formal evaluator.
"""

from __future__ import annotations

import ctypes
import json
import os
import subprocess
import sys
from ctypes import wintypes
from dataclasses import dataclass
from pathlib import Path

from evals.forge import controller, wsl_lab


SYNTHETIC_STDOUT = b"afyx-windows-lab: profile-is-workspace=true\n"
SYNTHETIC_STDERR = b"afyx-windows-lab: stderr complete\n"
SYNTHETIC_ARTIFACT = wsl_lab.SYNTHETIC_ARTIFACT
SYNTHETIC_CHILD = r"""
import os
import pathlib
import subprocess
import sys
import time

mode = sys.argv[1]
workspace = pathlib.Path.cwd().resolve()
profile = pathlib.Path(os.environ["USERPROFILE"]).resolve()
if profile != workspace:
    raise SystemExit(91)
gate = pathlib.Path(os.environ["AFYX_JOB_GATE"])
gate_deadline = time.monotonic() + 10
while not gate.is_file():
    if time.monotonic() >= gate_deadline:
        raise SystemExit(92)
    time.sleep(0.01)
gate.unlink()
if mode == "timeout":
    child = subprocess.Popen(
        [getattr(sys, "_base_executable", sys.executable), "-I", "-c", "import time; time.sleep(60)"],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=subprocess.CREATE_NO_WINDOW,
    )
    print(f"child-pid={child.pid}", flush=True)
    time.sleep(60)
pathlib.Path("known_math.py").write_bytes(%r)
sys.stdout.buffer.write(%r)
sys.stdout.buffer.flush()
sys.stderr.buffer.write(%r)
sys.stderr.buffer.flush()
""" % (SYNTHETIC_ARTIFACT, SYNTHETIC_STDOUT, SYNTHETIC_STDERR)


WindowsLabFaults = wsl_lab.WslLabFaults
WindowsLabEvidenceRecorder = wsl_lab.WslLabEvidenceRecorder
WindowsLabEvidenceVerifier = wsl_lab.WslLabEvidenceVerifier


@dataclass(frozen=True)
class WindowsTokenIdentity:
    sid: str
    elevated: bool
    integrity_rid: int

    @property
    def public_identity(self) -> str:
        return f"windows-sid:{self.sid}"


class _SidAndAttributes(ctypes.Structure):
    _fields_ = [("Sid", ctypes.c_void_p), ("Attributes", wintypes.DWORD)]


class _TokenUser(ctypes.Structure):
    _fields_ = [("User", _SidAndAttributes)]


class _TokenMandatoryLabel(ctypes.Structure):
    _fields_ = [("Label", _SidAndAttributes)]


class _TokenElevation(ctypes.Structure):
    _fields_ = [("TokenIsElevated", wintypes.DWORD)]


def _token_information(token: wintypes.HANDLE, information_class: int) -> object:
    advapi32 = ctypes.WinDLL("advapi32", use_last_error=True)
    advapi32.GetTokenInformation.argtypes = [
        wintypes.HANDLE,
        ctypes.c_int,
        ctypes.c_void_p,
        wintypes.DWORD,
        ctypes.POINTER(wintypes.DWORD),
    ]
    advapi32.GetTokenInformation.restype = wintypes.BOOL
    size = wintypes.DWORD()
    advapi32.GetTokenInformation(token, information_class, None, 0, ctypes.byref(size))
    if size.value == 0:
        raise OSError("Windows token information sizing failed")
    buffer = ctypes.create_string_buffer(size.value)
    if not advapi32.GetTokenInformation(
        token,
        information_class,
        buffer,
        size,
        ctypes.byref(size),
    ):
        raise OSError("Windows token information query failed")
    return buffer


def _sid_string(sid: ctypes.c_void_p) -> str:
    advapi32 = ctypes.WinDLL("advapi32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    advapi32.ConvertSidToStringSidW.argtypes = [
        ctypes.c_void_p,
        ctypes.POINTER(wintypes.LPWSTR),
    ]
    advapi32.ConvertSidToStringSidW.restype = wintypes.BOOL
    kernel32.LocalFree.argtypes = [wintypes.HLOCAL]
    kernel32.LocalFree.restype = wintypes.HLOCAL
    value = wintypes.LPWSTR()
    if not advapi32.ConvertSidToStringSidW(sid, ctypes.byref(value)):
        raise OSError("Windows SID conversion failed")
    try:
        if not value.value:
            raise OSError("Windows SID is empty")
        return value.value
    finally:
        kernel32.LocalFree(value)


def _integrity_rid(sid: ctypes.c_void_p) -> int:
    advapi32 = ctypes.WinDLL("advapi32", use_last_error=True)
    advapi32.GetSidSubAuthorityCount.argtypes = [ctypes.c_void_p]
    advapi32.GetSidSubAuthorityCount.restype = ctypes.POINTER(ctypes.c_ubyte)
    advapi32.GetSidSubAuthority.argtypes = [ctypes.c_void_p, wintypes.DWORD]
    advapi32.GetSidSubAuthority.restype = ctypes.POINTER(wintypes.DWORD)
    count = advapi32.GetSidSubAuthorityCount(sid)
    if not count or count.contents.value == 0:
        raise OSError("Windows integrity SID is invalid")
    authority = advapi32.GetSidSubAuthority(sid, count.contents.value - 1)
    if not authority:
        raise OSError("Windows integrity RID is unavailable")
    return authority.contents.value


def _inspect_token(token: wintypes.HANDLE) -> WindowsTokenIdentity:
    user_buffer = _token_information(token, 1)
    elevation_buffer = _token_information(token, 20)
    integrity_buffer = _token_information(token, 25)
    user = ctypes.cast(user_buffer, ctypes.POINTER(_TokenUser)).contents
    elevation = ctypes.cast(
        elevation_buffer, ctypes.POINTER(_TokenElevation)
    ).contents
    integrity = ctypes.cast(
        integrity_buffer, ctypes.POINTER(_TokenMandatoryLabel)
    ).contents
    return WindowsTokenIdentity(
        sid=_sid_string(user.User.Sid),
        elevated=bool(elevation.TokenIsElevated),
        integrity_rid=_integrity_rid(integrity.Label.Sid),
    )


def _close_token_after_inspection(token: wintypes.HANDLE) -> WindowsTokenIdentity:
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle.restype = wintypes.BOOL
    try:
        return _inspect_token(token)
    finally:
        kernel32.CloseHandle(token)


def _inspect_process_token(process_handle: wintypes.HANDLE) -> WindowsTokenIdentity:
    advapi32 = ctypes.WinDLL("advapi32", use_last_error=True)
    advapi32.OpenProcessToken.argtypes = [
        wintypes.HANDLE,
        wintypes.DWORD,
        ctypes.POINTER(wintypes.HANDLE),
    ]
    advapi32.OpenProcessToken.restype = wintypes.BOOL
    token = wintypes.HANDLE()
    if not advapi32.OpenProcessToken(process_handle, 0x0008, ctypes.byref(token)):
        raise OSError("Windows process token is unavailable")
    return _close_token_after_inspection(token)


def _inspect_current_token() -> WindowsTokenIdentity:
    advapi32 = ctypes.WinDLL("advapi32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    advapi32.OpenThreadToken.argtypes = [
        wintypes.HANDLE,
        wintypes.DWORD,
        wintypes.BOOL,
        ctypes.POINTER(wintypes.HANDLE),
    ]
    advapi32.OpenThreadToken.restype = wintypes.BOOL
    kernel32.GetCurrentThread.restype = wintypes.HANDLE
    kernel32.GetCurrentProcess.restype = wintypes.HANDLE
    token = wintypes.HANDLE()
    if advapi32.OpenThreadToken(
        kernel32.GetCurrentThread(), 0x0008, True, ctypes.byref(token)
    ):
        return _close_token_after_inspection(token)
    if ctypes.get_last_error() != 1008:
        raise OSError("Windows effective thread token is unavailable")
    return _inspect_process_token(kernel32.GetCurrentProcess())


def _inspect_child_token(
    process: subprocess.Popen[bytes],
) -> WindowsTokenIdentity:
    return _inspect_process_token(process._handle)


def _require_nonprivileged_token(token: WindowsTokenIdentity) -> None:
    if token.elevated:
        raise PermissionError("elevated Windows token is not authorized")
    if token.integrity_rid > 0x2000:
        raise PermissionError("Windows token integrity is not authorized")
    if token.sid.casefold() in {"s-1-5-18", "s-1-5-19", "s-1-5-20"}:
        raise PermissionError("Windows service identity is not authorized")


def expected_identity() -> str:
    """Return the current effective token SID in a stable public form."""
    return _inspect_current_token().public_identity


def _pid_exists(pid: int) -> bool:
    kernel32 = ctypes.windll.kernel32
    kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle.restype = wintypes.BOOL
    kernel32.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.c_void_p]
    kernel32.GetExitCodeProcess.restype = wintypes.BOOL
    process = kernel32.OpenProcess(0x1000, False, pid)
    if not process:
        return False
    exit_code = wintypes.DWORD()
    try:
        if not kernel32.GetExitCodeProcess(process, ctypes.byref(exit_code)):
            raise OSError("Windows process state query failed")
        return exit_code.value == 259
    finally:
        kernel32.CloseHandle(process)


class _JobBasicLimitInformation(ctypes.Structure):
    _fields_ = [
        ("PerProcessUserTimeLimit", ctypes.c_longlong),
        ("PerJobUserTimeLimit", ctypes.c_longlong),
        ("LimitFlags", ctypes.c_uint32),
        ("MinimumWorkingSetSize", ctypes.c_size_t),
        ("MaximumWorkingSetSize", ctypes.c_size_t),
        ("ActiveProcessLimit", ctypes.c_uint32),
        ("Affinity", ctypes.c_size_t),
        ("PriorityClass", ctypes.c_uint32),
        ("SchedulingClass", ctypes.c_uint32),
    ]


class _IoCounters(ctypes.Structure):
    _fields_ = [
        ("ReadOperationCount", ctypes.c_uint64),
        ("WriteOperationCount", ctypes.c_uint64),
        ("OtherOperationCount", ctypes.c_uint64),
        ("ReadTransferCount", ctypes.c_uint64),
        ("WriteTransferCount", ctypes.c_uint64),
        ("OtherTransferCount", ctypes.c_uint64),
    ]


class _JobExtendedLimitInformation(ctypes.Structure):
    _fields_ = [
        ("BasicLimitInformation", _JobBasicLimitInformation),
        ("IoInfo", _IoCounters),
        ("ProcessMemoryLimit", ctypes.c_size_t),
        ("JobMemoryLimit", ctypes.c_size_t),
        ("PeakProcessMemoryUsed", ctypes.c_size_t),
        ("PeakJobMemoryUsed", ctypes.c_size_t),
    ]


def _create_owned_job(process: subprocess.Popen[bytes]) -> int:
    kernel32 = ctypes.windll.kernel32
    kernel32.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
    kernel32.CreateJobObjectW.restype = wintypes.HANDLE
    kernel32.SetInformationJobObject.argtypes = [
        wintypes.HANDLE,
        ctypes.c_int,
        ctypes.c_void_p,
        wintypes.DWORD,
    ]
    kernel32.SetInformationJobObject.restype = wintypes.BOOL
    kernel32.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    kernel32.AssignProcessToJobObject.restype = wintypes.BOOL
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.CloseHandle.restype = wintypes.BOOL
    job = kernel32.CreateJobObjectW(None, None)
    if not job:
        raise OSError("Windows job creation failed")
    information = _JobExtendedLimitInformation()
    information.BasicLimitInformation.LimitFlags = 0x00002000
    if not kernel32.SetInformationJobObject(
        job, 9, ctypes.byref(information), ctypes.sizeof(information)
    ) or not kernel32.AssignProcessToJobObject(job, process._handle):
        kernel32.CloseHandle(job)
        raise OSError("Windows job assignment failed")
    return job


def _abort_owned_process(
    process: subprocess.Popen[bytes], job: int, exit_code: int
) -> None:
    kernel32 = ctypes.windll.kernel32
    kernel32.TerminateJobObject.argtypes = [wintypes.HANDLE, wintypes.UINT]
    kernel32.TerminateJobObject.restype = wintypes.BOOL
    try:
        if not kernel32.TerminateJobObject(job, exit_code):
            process.kill()
    finally:
        kernel32.CloseHandle(job)
    process.communicate(timeout=10)


def _observed_child_pid(output: bytes | None) -> int | None:
    for line in (output or b"").decode("utf-8", errors="replace").splitlines():
        if line.startswith("child-pid="):
            return int(line.removeprefix("child-pid="))
    return None


class WindowsSyntheticLauncher:
    """Actual-subprocess launcher for the fixed public Windows lab child."""

    def __init__(
        self,
        recorder: WindowsLabEvidenceRecorder,
        binding: controller.EvidenceBinding,
        *,
        mode: str = "success",
    ) -> None:
        if os.name != "nt":
            raise RuntimeError("Windows lab requires native Windows")
        if mode not in {"success", "timeout"}:
            raise ValueError("unsupported synthetic child mode")
        self.recorder = recorder
        self.binding = binding
        self.mode = mode

    def launch(self, request: controller.LaunchRequest) -> controller.ProcessOutcome:
        expected_token = _inspect_current_token()
        _require_nonprivileged_token(expected_token)
        evidence_root = self.recorder.root
        workspace = request.workspace.resolve(strict=True)
        if (
            evidence_root == workspace
            or evidence_root in workspace.parents
            or workspace in evidence_root.parents
        ):
            raise ValueError("evidence and execution roots must be separate")

        gate_path = workspace / ".afyx-job-assigned"
        if gate_path.exists():
            raise ValueError("job assignment gate must not already exist")
        executable = str(getattr(sys, "_base_executable", sys.executable))
        isolated_environment = {
            "AFYX_JOB_GATE": str(gate_path),
            "PATH": str(Path(executable).parent),
            "SystemRoot": os.environ["SystemRoot"],
            "TEMP": str(workspace),
            "TMP": str(workspace),
            "USERPROFILE": str(workspace),
            "WINDIR": os.environ["WINDIR"],
        }
        process = subprocess.Popen(
            [executable, "-I", "-c", SYNTHETIC_CHILD, self.mode],
            cwd=workspace,
            env=isolated_environment,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            creationflags=(
                subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW
            ),
        )
        self.recorder.process_start_count += 1
        try:
            job = _create_owned_job(process)
        except Exception:
            process.kill()
            process.communicate()
            raise
        try:
            observed_token = _inspect_child_token(process)
            _require_nonprivileged_token(observed_token)
            if observed_token.sid.casefold() != expected_token.sid.casefold():
                raise PermissionError("launched child identity does not match")
        except Exception:
            _abort_owned_process(process, job, 126)
            raise
        try:
            gate_path.write_bytes(b"assigned")
        except Exception:
            _abort_owned_process(process, job, 125)
            raise
        timed_out = False
        process_tree_terminated = True
        child_pid: int | None = None
        try:
            stdout, stderr = process.communicate(timeout=request.timeout_seconds)
        except subprocess.TimeoutExpired as error:
            timed_out = True
            child_pid = _observed_child_pid(error.output)
            kernel32 = ctypes.windll.kernel32
            kernel32.TerminateJobObject.argtypes = [wintypes.HANDLE, wintypes.UINT]
            kernel32.TerminateJobObject.restype = wintypes.BOOL
            process_tree_terminated = bool(
                kernel32.TerminateJobObject(job, 124)
            )
            if not process_tree_terminated:
                process.kill()
            stdout, stderr = process.communicate(timeout=10)
        finally:
            ctypes.windll.kernel32.CloseHandle(job)

        child_pid = child_pid or _observed_child_pid(stdout)
        child_alive = bool(child_pid is not None and _pid_exists(child_pid))
        process_tree_terminated = process_tree_terminated and not child_alive
        state = {
            "child_alive_after_cleanup": child_alive,
            "child_pid_observed": child_pid is not None,
            "exit_code": process.returncode,
            "expected_identity": expected_token.public_identity,
            "observed_child_identity": observed_token.public_identity,
            "observed_child_integrity_rid": observed_token.integrity_rid,
            "observed_child_token_elevated": observed_token.elevated,
            "launcher": "fixed-windows-synthetic-child-v1",
            "process_tree_terminated": process_tree_terminated,
            "profile_redirected_to_workspace": True,
            "timed_out": timed_out,
        }
        self.recorder.capture(
            request.evidence_session_id,
            binding=self.binding,
            stdout=stdout,
            stderr=stderr,
            process_state=state,
        )
        truncated = self.recorder.faults.truncate_stdout
        return controller.ProcessOutcome(
            identity=observed_token.public_identity,
            exit_code=process.returncode,
            stdout=stdout.decode("utf-8", errors="replace"),
            stderr=stderr.decode("utf-8", errors="replace"),
            stdout_upstream_truncated=truncated,
            stderr_upstream_truncated=False,
            stdout_stream_scan_complete=True if truncated else None,
            stderr_stream_scan_complete=None,
            stdout_stream_forbidden_marker=False if truncated else None,
            stderr_stream_forbidden_marker=None,
            timed_out=timed_out,
            process_tree_terminated=process_tree_terminated,
            provider_tokens="NOT_AVAILABLE",
            tool_calls=0,
            retry_count=0,
        )


class BindingLauncher:
    """Bind the controller-generated evidence challenge before launch."""

    def __init__(
        self, recorder: WindowsLabEvidenceRecorder, *, mode: str = "success"
    ) -> None:
        self.recorder = recorder
        self.mode = mode

    def launch(self, request: controller.LaunchRequest) -> controller.ProcessOutcome:
        readiness = json.loads(
            (
                self.recorder.root
                / request.evidence_session_id
                / "readiness.json"
            ).read_text("utf-8")
        )
        binding = controller.EvidenceBinding(**readiness["binding"])
        return WindowsSyntheticLauncher(
            self.recorder, binding, mode=self.mode
        ).launch(request)


def synthetic_artifact_sha256() -> str:
    return wsl_lab.synthetic_artifact_sha256()
