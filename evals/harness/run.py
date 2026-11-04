#!/usr/bin/env python3
"""Deterministic Phase 3 benchmark runner using isolated Codex skill configs."""

from __future__ import annotations

import argparse
import ast
import ctypes
import hashlib
import io
import json
import os
import random
import re
import signal
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from contextlib import contextmanager, redirect_stdout
from datetime import datetime, timezone
from pathlib import Path

from freeze import REPOSITORY_SKILLS, directory_content_sha256, prompt_master_git_sha


EVAL_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = EVAL_ROOT.parent
MANIFEST_PATH = EVAL_ROOT / "manifest.json"
RESULTS_ROOT = EVAL_ROOT / "results"
AFYX_SKILLS = (
    "efficient-coding",
    "odoo-engineering",
    "prompt-master",
    "afyx-engineering-expert",
)
EVALUATION_PERMISSION_PROFILE = "afyx-evaluation"


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def atomic_write_json(path: Path, payload: dict) -> None:
    """Publish one complete JSON document or leave the previous document intact."""
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as stream:
            json.dump(payload, stream, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def evaluation_provenance(manifest: dict, environment: dict) -> dict:
    """Create correlation metadata; a shared UUID is not cryptographic attestation."""
    evaluation_run_id = uuid.uuid4().hex
    environment_path = EVAL_ROOT / manifest["environment"]
    revision = subprocess.run(
        ["git", "-C", str(REPO_ROOT), "rev-parse", "HEAD"],
        text=True, encoding="utf-8", errors="replace", capture_output=True,
    )
    if revision.returncode != 0 or not revision.stdout.strip():
        raise RuntimeError("unable to resolve exact repository source revision")
    return {
        "evaluation_run_id": evaluation_run_id,
        "control_run_id": evaluation_run_id,
        "control_run_id_relationship": "same_as_evaluation_run_id",
        "correlation_guarantee": "shared run correlation only; not cryptographic attestation",
        "source_revision": revision.stdout.strip(),
        "benchmark_subject_commit": environment["repository"]["benchmark_subject_commit"],
        "environment_fingerprint": {
            "path": manifest["environment"],
            "sha256": hashlib.sha256(environment_path.read_bytes()).hexdigest(),
        },
    }


def correlation_status(expected_id: str, records: list[dict]) -> dict:
    """Reject mixed runs and keep legacy records without an ID explicitly unverified."""
    missing = [index for index, record in enumerate(records) if not record.get("evaluation_run_id")]
    if missing:
        return {
            "result": "UNVERIFIED", "reason": "MISSING_EVALUATION_RUN_ID",
            "record_indexes": missing,
        }
    mismatched = [
        index for index, record in enumerate(records)
        if record["evaluation_run_id"] != expected_id
    ]
    if mismatched:
        return {
            "result": "REJECTED", "reason": "EVALUATION_RUN_ID_MISMATCH",
            "record_indexes": mismatched,
        }
    return {"result": "VERIFIED", "reason": None, "record_indexes": []}


def verify_frozen_environment(environment: dict) -> None:
    """Abort before any model call when frozen benchmark inputs drift."""
    failures = []
    subject = environment.get("repository", {}).get("benchmark_subject_commit")
    if not subject:
        failures.append("repository.benchmark_subject_commit is missing")
    for name in REPOSITORY_SKILLS:
        expected = environment["skills"].get(name, {}).get("content_sha256")
        if not expected:
            failures.append(f"{name}: frozen content_sha256 is missing")
            continue
        actual = directory_content_sha256(REPO_ROOT / "skills" / name)
        if actual != expected:
            failures.append(
                f"{name}: content SHA256 mismatch (expected {expected}, actual {actual})"
            )

    prompt_entry = environment["skills"].get("prompt-master", {})
    expected_prompt_sha = prompt_entry.get("git_sha")
    prompt_checkout = Path.home() / ".agents" / "skills" / "prompt-master"
    if not expected_prompt_sha:
        failures.append("prompt-master: frozen git_sha is missing")
    else:
        try:
            actual_prompt_sha = prompt_master_git_sha(prompt_checkout)
        except (FileNotFoundError, RuntimeError) as error:
            failures.append(f"prompt-master: {error}")
        else:
            if actual_prompt_sha != expected_prompt_sha:
                failures.append(
                    "prompt-master: Git SHA mismatch "
                    f"(expected {expected_prompt_sha}, actual {actual_prompt_sha})"
                )

    expected_origin = prompt_entry.get("git_origin")
    if expected_origin:
        origin = subprocess.run(
            [
                "git", "-c", f"safe.directory={prompt_checkout.as_posix()}",
                "-C", str(prompt_checkout), "remote", "get-url", "origin",
            ],
            text=True, encoding="utf-8", errors="replace", capture_output=True,
        )
        actual_origin = origin.stdout.strip() if origin.returncode == 0 else None
        if actual_origin != expected_origin:
            failures.append(
                "prompt-master: Git origin mismatch "
                f"(expected {expected_origin}, actual {actual_origin or 'unavailable'})"
            )

    if prompt_entry.get("clean") is True:
        status = subprocess.run(
            [
                "git", "-c", f"safe.directory={prompt_checkout.as_posix()}",
                "-C", str(prompt_checkout), "status", "--porcelain=v1",
            ],
            text=True, encoding="utf-8", errors="replace", capture_output=True,
        )
        if status.returncode != 0 or status.stdout.strip():
            failures.append("prompt-master: checkout is unavailable or not clean")

    if failures:
        details = "\n  - ".join(failures)
        raise RuntimeError(f"frozen environment preflight failed:\n  - {details}")


def ignored_path(rel: Path) -> bool:
    return any(part in {".agents", "__pycache__"} for part in rel.parts) or rel.suffix == ".pyc"


def tree_digest(root: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(p for p in root.rglob("*") if p.is_file()):
        rel = path.relative_to(root)
        if ignored_path(rel):
            continue
        digest.update(rel.as_posix().encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()


def snapshot(root: Path) -> dict[str, str]:
    result = {}
    for path in sorted(p for p in root.rglob("*") if p.is_file()):
        rel = path.relative_to(root)
        if ignored_path(rel):
            continue
        result[rel.as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
    return result


def skill_sources() -> dict[str, Path]:
    user_root = Path.home() / ".agents" / "skills"
    return {
        "efficient-coding": REPO_ROOT / "skills" / "efficient-coding",
        "odoo-engineering": REPO_ROOT / "skills" / "odoo-engineering",
        "prompt-master": user_root / "prompt-master",
        "afyx-engineering-expert": REPO_ROOT / "skills" / "afyx-engineering-expert",
    }


def installed_skill_paths() -> list[Path]:
    root = Path.home() / ".agents" / "skills"
    return [root / name / "SKILL.md" for name in AFYX_SKILLS]


def prepare_skills(work: Path, active: list[str]) -> None:
    sources = skill_sources()
    target_root = work / ".agents" / "skills"
    target_root.mkdir(parents=True, exist_ok=True)
    for name in active:
        source = sources[name]
        if not (source / "SKILL.md").is_file():
            raise RuntimeError(f"skill source unavailable: {source}")
        shutil.copytree(source, target_root / name)


def skills_override() -> str:
    entries = ",".join(
        f'{{path="{path.as_posix()}",enabled=false}}'
        for path in installed_skill_paths()
    )
    return f"skills.config=[{entries}]"


def evaluation_permissions_override() -> str:
    """Least-privilege profile for evaluated commands and descendants."""
    return (
        f"permissions.{EVALUATION_PERMISSION_PROFILE}={{ "
        'extends = ":workspace", filesystem = { '
        '":root" = "deny", ":minimal" = "read", '
        '":tmpdir" = "deny", ":slash_tmp" = "deny" }, '
        "network = { enabled = false } }"
    )


def windows_workspace_control(path: Path) -> str:
    literal = str(path).replace("'", "''")
    return (
        "Write-Output 'AFYX_CONTROL_workspace:'; "
        f"Get-Content -Raw -LiteralPath '{literal}'"
    )


def codex_command(work: Path, prompt: str, *, include_skills: bool = True) -> list[str]:
    command = [
        "codex", "exec", "--ephemeral", "--ignore-user-config",
        "--skip-git-repo-check", "--json", "-C", str(work),
        "-m", "gpt-5.6-sol",
        "-c", f'default_permissions="{EVALUATION_PERMISSION_PROFILE}"',
        "-c", evaluation_permissions_override(),
        "-c", 'approval_policy="never"',
        "-c", 'model_provider="openai"',
        "-c", 'model_reasoning_effort="medium"',
    ]
    if os.name == "nt":
        command.extend(["-c", 'windows.sandbox="mxc"'])
    if include_skills:
        command.extend(["-c", skills_override()])
    command.append(prompt)
    return command


def windows_kill_on_close_job(process: subprocess.Popen) -> int | None:
    """Put an owned Windows child tree in a kill-on-close Job Object."""
    if os.name != "nt":
        return None

    from ctypes import wintypes

    class IO_COUNTERS(ctypes.Structure):
        _fields_ = [
            ("ReadOperationCount", ctypes.c_ulonglong),
            ("WriteOperationCount", ctypes.c_ulonglong),
            ("OtherOperationCount", ctypes.c_ulonglong),
            ("ReadTransferCount", ctypes.c_ulonglong),
            ("WriteTransferCount", ctypes.c_ulonglong),
            ("OtherTransferCount", ctypes.c_ulonglong),
        ]

    class BASIC_LIMITS(ctypes.Structure):
        _fields_ = [
            ("PerProcessUserTimeLimit", ctypes.c_longlong),
            ("PerJobUserTimeLimit", ctypes.c_longlong),
            ("LimitFlags", wintypes.DWORD),
            ("MinimumWorkingSetSize", ctypes.c_size_t),
            ("MaximumWorkingSetSize", ctypes.c_size_t),
            ("ActiveProcessLimit", wintypes.DWORD),
            ("Affinity", ctypes.c_size_t),
            ("PriorityClass", wintypes.DWORD),
            ("SchedulingClass", wintypes.DWORD),
        ]

    class EXTENDED_LIMITS(ctypes.Structure):
        _fields_ = [
            ("BasicLimitInformation", BASIC_LIMITS),
            ("IoInfo", IO_COUNTERS),
            ("ProcessMemoryLimit", ctypes.c_size_t),
            ("JobMemoryLimit", ctypes.c_size_t),
            ("PeakProcessMemoryUsed", ctypes.c_size_t),
            ("PeakJobMemoryUsed", ctypes.c_size_t),
        ]

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
    kernel32.CreateJobObjectW.restype = wintypes.HANDLE
    kernel32.SetInformationJobObject.argtypes = [
        wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD
    ]
    kernel32.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    job = kernel32.CreateJobObjectW(None, None)
    if not job:
        return None
    information = EXTENDED_LIMITS()
    information.BasicLimitInformation.LimitFlags = 0x00002000
    configured = kernel32.SetInformationJobObject(
        job, 9, ctypes.byref(information), ctypes.sizeof(information)
    )
    assigned = configured and kernel32.AssignProcessToJobObject(
        job, wintypes.HANDLE(process._handle)
    )
    if not assigned:
        kernel32.CloseHandle(job)
        return None
    return int(job)


def close_windows_handle(handle: int | None) -> bool:
    if not handle:
        return False
    return bool(ctypes.WinDLL("kernel32", use_last_error=True).CloseHandle(handle))


def resolve_process_command(
    command: list[str], *, windows: bool | None = None
) -> tuple[list[str], str | None, str]:
    """Resolve an argv-safe executable, including npm PowerShell shims on Windows."""
    if not command:
        raise OSError("empty child command")
    is_windows = os.name == "nt" if windows is None else windows
    executable = shutil.which(command[0])
    if not executable:
        raise OSError(f"executable not found: {command[0]}")
    if is_windows and Path(executable).suffix.lower() in {".cmd", ".bat"}:
        powershell_shim = Path(executable).with_suffix(".ps1")
        powershell = shutil.which("pwsh.exe") or shutil.which("powershell.exe")
        if not powershell_shim.is_file() or not powershell:
            raise OSError(
                "Windows command shim cannot be launched without its sibling "
                f"PowerShell shim and PowerShell runtime: {executable}"
            )
        return (
            [
                powershell, "-NoLogo", "-NoProfile", "-NonInteractive",
                "-ExecutionPolicy", "Bypass", "-File", str(powershell_shim),
                *command[1:],
            ],
            executable,
            "windows-powershell-shim",
        )
    return [executable, *command[1:]], executable, "direct"


def bounded_process(command: list[str], cwd: Path, timeout: int) -> dict:
    """Run one owned child and terminate only its process group/tree on timeout."""
    started = time.perf_counter()
    creationflags = 0
    popen_kwargs = {}
    if os.name == "nt":
        creationflags = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW
    else:
        popen_kwargs["start_new_session"] = True
    executable = shutil.which(command[0]) if command else None
    launcher_kind = "unresolved"
    try:
        launch_command, executable, launcher_kind = resolve_process_command(command)
        process = subprocess.Popen(
            launch_command, cwd=cwd, text=True, encoding="utf-8", errors="replace",
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            creationflags=creationflags, **popen_kwargs,
        )
    except OSError as error:
        return {
            "started": False, "pid": None, "returncode": None,
            "stdout": "", "stderr": str(error), "timed_out": False,
            "cleanup_required": False, "cleanup_succeeded": True,
            "cleanup_method": "not-started",
            "elapsed_seconds": time.perf_counter() - started,
            "executable": executable,
            "launcher_kind": launcher_kind,
        }

    windows_job = windows_kill_on_close_job(process)
    timed_out = False
    cleanup_required = False
    cleanup_succeeded = True
    cleanup_method = "not-required"
    try:
        stdout, stderr = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        timed_out = True
        cleanup_required = True
        if os.name == "nt":
            if windows_job:
                cleanup_method = "windows-job-kill-on-close"
                cleanup_succeeded = close_windows_handle(windows_job)
                windows_job = None
            else:
                cleanup_method = "taskkill-tree-fallback"
                cleanup = subprocess.run(
                    ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                    text=True, encoding="utf-8", errors="replace", capture_output=True,
                    check=False, creationflags=subprocess.CREATE_NO_WINDOW,
                )
                cleanup_succeeded = cleanup.returncode == 0
        else:
            cleanup_method = "posix-process-group-kill"
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            except OSError:
                cleanup_succeeded = False
        try:
            stdout, stderr = process.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            stdout, stderr = process.communicate()
            cleanup_succeeded = False
        cleanup_succeeded = cleanup_succeeded and process.poll() is not None
    finally:
        if windows_job:
            close_windows_handle(windows_job)

    return {
        "started": True, "pid": process.pid, "returncode": process.returncode,
        "stdout": stdout or "", "stderr": stderr or "", "timed_out": timed_out,
        "cleanup_required": cleanup_required, "cleanup_succeeded": cleanup_succeeded,
        "cleanup_method": cleanup_method,
        "elapsed_seconds": time.perf_counter() - started,
        "executable": executable,
        "launcher_kind": launcher_kind,
    }


def parse_codex_cli_version(output: str) -> str | None:
    match = re.search(r"\bcodex(?:-cli)?\s+([0-9]+(?:\.[0-9]+){2}(?:[-+][^\s]+)?)", output)
    return match.group(1) if match else None


def verify_runtime_fingerprint(environment: dict) -> dict:
    """Verify the installed CLI identity and required non-model command contract."""
    expected = environment.get("runtime", {}).get("codex_cli")
    if not expected:
        raise RuntimeError("frozen environment runtime.codex_cli is missing")
    version_probe = bounded_process(["codex", "--version"], REPO_ROOT, 15)
    if not version_probe["started"] or version_probe["returncode"] != 0:
        raise RuntimeError(
            "Codex CLI version probe failed: "
            + sanitize_diagnostic(version_probe["stderr"] or "child did not start")
        )
    actual = parse_codex_cli_version(
        version_probe["stdout"] + "\n" + version_probe["stderr"]
    )
    if actual != expected:
        raise RuntimeError(
            f"Codex CLI fingerprint mismatch (expected {expected}, actual {actual or 'unknown'})"
        )
    contract_command = codex_command(REPO_ROOT, "", include_skills=False)[:-1] + ["--help"]
    contract_probe = bounded_process(contract_command, REPO_ROOT, 15)
    contract_output = contract_probe["stdout"] + "\n" + contract_probe["stderr"]
    required_options = (
        "--ephemeral", "--ignore-user-config", "--skip-git-repo-check",
        "--json", "--cd", "--model", "--config",
    )
    missing = [option for option in required_options if option not in contract_output]
    if (
        not contract_probe["started"]
        or contract_probe["returncode"] != 0
        or missing
    ):
        raise RuntimeError(
            "Codex CLI runtime contract check failed"
            + (f"; missing options: {', '.join(missing)}" if missing else "")
        )
    permission_probe = bounded_process(["codex", "sandbox", "--help"], REPO_ROOT, 15)
    permission_output = permission_probe["stdout"] + "\n" + permission_probe["stderr"]
    permission_options = ("--permission-profile", "--include-managed-config", "--cd")
    missing_permissions = [
        option for option in permission_options if option not in permission_output
    ]
    if (
        not permission_probe["started"]
        or permission_probe["returncode"] != 0
        or missing_permissions
    ):
        raise RuntimeError(
            "Codex CLI permission-profile contract check failed"
            + (
                f"; missing options: {', '.join(missing_permissions)}"
                if missing_permissions else ""
            )
        )
    return {
        "expected_version": expected,
        "actual_version": actual,
        "executable": version_probe["executable"],
        "launcher_kind": version_probe["launcher_kind"],
        "required_options": list(required_options),
        "permission_profile_options": list(permission_options),
    }


def sanitize_diagnostic(text: str, secrets: list[str] | None = None, limit: int = 4000) -> str:
    sanitized = text
    for secret in secrets or []:
        if secret:
            sanitized = sanitized.replace(secret, "[REDACTED]")
    return sanitized[-limit:]


def classify_child_health(process: dict) -> str:
    if not process["started"]:
        return "CHILD_DID_NOT_START"
    combined = process["stdout"] + "\n" + process["stderr"]
    if "CHILD_HEALTHY" in combined and process["returncode"] == 0:
        return "PASS"
    if re.search(r"not logged in|authentication|unauthorized|401", combined, re.I):
        return "AUTHENTICATION_FAILURE"
    if re.search(r"model.*(not found|unavailable|unsupported)|unknown model", combined, re.I):
        return "MODEL_UNAVAILABLE"
    if re.search(r"forbidden by its access permissions|waiting for network|connection failed", combined, re.I):
        return "PROVIDER_NETWORK_BLOCKED"
    if process["timed_out"]:
        return "CHILD_TIMEOUT"
    return "CHILD_FAILED"


def run_child_health_probe(timeout: int, provenance: dict | None = None) -> dict:
    """Verify startup/provider response without skills, fixtures, or evaluator secrets."""
    with tempfile.TemporaryDirectory(prefix="afyx-child-health-") as temporary:
        work = Path(temporary) / "work"
        work.mkdir()
        process = bounded_process(
            codex_command(
                work, "Reply exactly CHILD_HEALTHY. Do not use tools.",
                include_skills=False,
            ),
            work, timeout,
        )
    classification = classify_child_health(process)
    parsed = parse_events(process["stdout"])
    return {
        **(provenance or {}),
        "result": "PASS" if classification == "PASS" else "BLOCKED",
        "classification": classification,
        "started": process["started"],
        "pid": process["pid"],
        "process_returncode": process["returncode"],
        "thread_started": '"type":"thread.started"' in process["stdout"],
        "turn_started": '"type":"turn.started"' in process["stdout"],
        "model_response_observed": "CHILD_HEALTHY" in parsed["message"],
        "timed_out": process["timed_out"],
        "cleanup_required": process["cleanup_required"],
        "cleanup_succeeded": process["cleanup_succeeded"],
        "cleanup_method": process["cleanup_method"],
        "elapsed_seconds": process["elapsed_seconds"],
        "executable": process["executable"],
        "launcher_kind": process.get("launcher_kind"),
        "cwd_external_to_repository": True,
        "inherited_environment_names": sorted(
            name for name in os.environ
            if re.match(r"^(CODEX|OPENAI|HTTP|HTTPS|NO_PROXY|PATH)", name, re.I)
        ),
        "stderr_tail": sanitize_diagnostic(process["stderr"]),
        "event_error_tail": sanitize_diagnostic(process["stdout"]),
    }


def parse_events(stdout: str) -> dict:
    usage = {}
    agent_messages = []
    tool_calls = 0
    failed_tools = 0
    search_calls = 0
    read_calls = 0
    commands = []
    command_events = []
    tool_events = []
    for line in stdout.splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if event.get("type") == "turn.completed":
            usage = event.get("usage", {})
        item = event.get("item") or {}
        if item.get("type") == "agent_message" and item.get("text"):
            agent_messages.append(item["text"])
        item_type = item.get("type", "")
        if item_type in {"command_execution", "mcp_tool_call", "tool_call", "file_change"}:
            command = item.get("command", "")
            trace = command or json.dumps(item, sort_keys=True)
            output = item.get("aggregated_output") or item.get("output") or ""
            exit_code = item.get("exit_code")
            tool_events.append({
                "event_type": event.get("type"),
                "type": item_type,
                "trace": trace,
                "output": output if isinstance(output, str) else json.dumps(output),
                "status": item.get("status"),
                "exit_code": exit_code,
                "failed": item.get("status") in {"failed", "error"} or (
                    exit_code is not None and exit_code != 0
                ),
            })
        if event.get("type") == "item.completed" and item_type in {
            "command_execution", "mcp_tool_call", "tool_call", "file_change"
        }:
            tool_calls += 1
            command = item.get("command", "")
            trace = command or json.dumps(item, sort_keys=True)
            commands.append(trace)
            output = item.get("aggregated_output") or item.get("output") or ""
            exit_code = item.get("exit_code")
            failed = item.get("status") in {"failed", "error"} or (
                exit_code is not None and exit_code != 0
            )
            command_events.append({
                "type": item_type,
                "trace": trace,
                "output": output if isinstance(output, str) else json.dumps(output),
                "status": item.get("status"),
                "exit_code": exit_code,
                "failed": failed,
            })
            if command and re.search(r"\b(rg|grep|find|search)\b", command, re.I):
                search_calls += 1
            if command and re.search(r"\b(Get-Content|cat|type|read)\b", command, re.I):
                read_calls += 1
            if item.get("status") in {"failed", "error"}:
                failed_tools += 1
    expert_reference_pattern = re.compile(
        r"afyx-engineering-expert[\\/]+references[\\/]+"
        r"(?P<name>[A-Za-z0-9][A-Za-z0-9._-]*\.md)\b",
        re.I,
    )
    expert_reference_telemetry_observed = any(
        expert_reference_pattern.search(event["trace"])
        for event in command_events
    )
    observed_expert_reference_reads = sorted({
        f"references/{match.group('name').casefold()}"
        for event in command_events
        if not event["failed"]
        for match in expert_reference_pattern.finditer(event["trace"])
    })
    expert_reference_reads = (
        observed_expert_reference_reads
        if expert_reference_telemetry_observed else None
    )
    expert_workflow_reads = sorted({
        f"workflows/{match.group('name').casefold()}"
        for event in command_events
        if not event["failed"]
        for match in re.finditer(
            r"afyx-engineering-expert[\\/]+workflows[\\/]+"
            r"(?P<name>[A-Za-z0-9][A-Za-z0-9._-]*\.md)\b",
            event["trace"],
            re.I,
        )
    })
    return {
        "usage": usage,
        "message": agent_messages[-1] if agent_messages else "",
        "tool_calls": tool_calls,
        "failed_tools": failed_tools,
        "search_calls": search_calls,
        "read_calls": read_calls,
        "commands": commands,
        "command_events": command_events,
        "tool_events": tool_events,
        "expert_reference_reads": expert_reference_reads,
        "expert_reference_telemetry_observed": expert_reference_telemetry_observed,
        "expert_workflow_reads": expert_workflow_reads,
    }


def activation_evidence(parsed: dict, active_skills: list[str]) -> dict[str, dict]:
    """Classify activation from completed host events without inferring from prose."""
    evidence = {}
    for name in AFYX_SKILLS:
        path_pattern = re.compile(rf"{re.escape(name)}[\\/]+SKILL\.md", re.I)
        related = [
            event for event in parsed["command_events"]
            if path_pattern.search(event["trace"])
        ]
        successful = [
            event for event in related
            if not event["failed"]
            and re.search(rf"\bname:\s*{re.escape(name)}\b", event["output"], re.I)
        ]
        failed = [event for event in related if event["failed"]]
        if successful:
            state = "SKILL_MD_READ_OBSERVED"
        elif failed:
            state = "SKILL_MD_READ_FAILED"
        else:
            state = "ACTIVATION_NOT_OBSERVABLE"
        evidence[name] = {
            "available": name in active_skills,
            "discovery_or_selection_attempted": bool(related),
            "skill_md_read_attempted": bool(related),
            "successful_skill_md_read": bool(successful),
            "read_blocked_or_failed": bool(failed),
            "state": state,
        }
    return evidence


def resolve_configuration(manifest: dict, name: str) -> tuple[str, list[str]]:
    canonical = manifest.get("evaluation_aliases", {}).get(name, name)
    return canonical, manifest["configurations"][canonical]


@contextmanager
def evaluated_workspace():
    """Yield the external disposable workspace used by every evaluated child."""
    with tempfile.TemporaryDirectory(prefix="afyx-eval-") as temporary:
        yield Path(temporary) / "work"


def check_assertions(
    scenario: dict, work: Path, output: str, validation_exit: int | None,
    modified: list[str], tool_calls: int = 0,
    expert_reference_reads: list[str] | None = None,
) -> list[dict]:
    checks = []
    for assertion in scenario["expected_assertions"]:
        kind, value = assertion["type"], assertion["value"]
        if kind == "validation_exit":
            passed = validation_exit == value
        elif kind == "output_contains":
            passed = value.lower() in output.lower()
        elif kind == "python_list_reversal":
            passed = python_list_reversal_is_correct(output)
        elif kind == "max_tool_calls":
            passed = tool_calls <= value
        elif kind == "max_expert_reference_reads":
            observed = expert_reference_reads
            passed = observed is not None and len(observed) <= value
        else:
            passed = False
        check = {"type": kind, "expected": value, "passed": passed}
        if kind == "max_expert_reference_reads":
            check["observed"] = observed
        checks.append(check)
    file_corpus = "\n".join(
        (work / rel).read_text(encoding="utf-8", errors="replace")
        for rel in modified if (work / rel).is_file()
    )
    corpus = output if scenario["output_kind"] in {"generated_prompt", "advisory"} else file_corpus
    for pattern in scenario["forbidden_patterns"]:
        checks.append({
            "type": "forbidden_pattern", "expected": pattern,
            "passed": pattern not in corpus,
        })
    for pattern in scenario.get("xml_forbidden_patterns", []):
        checks.append({
            "type": "xml_forbidden_pattern", "expected": pattern,
            "passed": pattern not in corpus,
        })
    return checks


def python_list_reversal_is_correct(output: str) -> bool:
    """Execute only a tiny safe Python subset and verify reversal semantics."""
    snippets = re.findall(r"```(?:python)?\s*\n(.*?)```", output, re.I | re.S)
    snippets.extend(
        snippet for snippet in re.findall(r"`([^`\n]+)`", output)
        if "=" in snippet or ".reverse(" in snippet
    )
    if not snippets:
        snippets = [output]
    allowed_nodes = (
        ast.Module, ast.Assign, ast.Expr, ast.Call, ast.Name, ast.Load, ast.Store,
        ast.List, ast.Tuple, ast.Constant, ast.Attribute, ast.Subscript, ast.Slice,
        ast.UnaryOp, ast.USub,
    )
    for snippet in snippets:
        try:
            tree = ast.parse(snippet.strip())
        except (SyntaxError, ValueError):
            continue
        if any(not isinstance(node, allowed_nodes) for node in ast.walk(tree)):
            continue
        safe = True
        reversal_operation = False
        initial_lists = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Assign):
                if len(node.targets) != 1 or not isinstance(node.targets[0], ast.Name):
                    safe = False
                    break
                try:
                    literal = ast.literal_eval(node.value)
                except (ValueError, TypeError):
                    literal = None
                if isinstance(literal, list) and len(literal) >= 2:
                    initial_lists.append(literal)
            if isinstance(node, ast.Call):
                named = (
                    isinstance(node.func, ast.Name)
                    and node.func.id in {"print", "list", "reversed"}
                    and not node.keywords
                )
                reverse = (
                    isinstance(node.func, ast.Attribute)
                    and node.func.attr == "reverse"
                    and isinstance(node.func.value, ast.Name)
                    and not node.args and not node.keywords
                )
                if not (named or reverse):
                    safe = False
                    break
                if reverse or (isinstance(node.func, ast.Name) and node.func.id == "reversed"):
                    reversal_operation = True
            if isinstance(node, ast.Attribute) and node.attr != "reverse":
                safe = False
                break
            if (
                isinstance(node, ast.Subscript) and isinstance(node.slice, ast.Slice)
                and isinstance(node.slice.step, ast.UnaryOp)
                and isinstance(node.slice.step.op, ast.USub)
                and isinstance(node.slice.step.operand, ast.Constant)
                and node.slice.step.operand.value == 1
            ):
                reversal_operation = True
        if not safe or not initial_lists or not reversal_operation:
            continue
        namespace: dict = {}
        captured = io.StringIO()
        try:
            with redirect_stdout(captured):
                exec(
                    compile(tree, "<negative-routing-example>", "exec"),
                    {"__builtins__": {"print": print, "list": list, "reversed": reversed}},
                    namespace,
                )
        except Exception:
            continue
        candidates = [value for value in namespace.values() if isinstance(value, list)]
        for line in captured.getvalue().splitlines():
            try:
                value = ast.literal_eval(line.strip())
            except (SyntaxError, ValueError):
                continue
            if isinstance(value, list):
                candidates.append(value)
        if any(
            candidate == list(reversed(original))
            for original in initial_lists for candidate in candidates
        ):
            return True
    return False


def run_cell(
    manifest: dict, scenario: dict, config: str, repetition: int, timeout: int,
    provenance: dict | None = None, seed: int | None = None, run_id: str | None = None,
) -> dict:
    run_id = run_id or f"{scenario['scenario_id']}-{config}-r{repetition}-{uuid.uuid4().hex[:8]}"
    run_root = RESULTS_ROOT / run_id
    canonical_config, active_skills = resolve_configuration(manifest, config)
    fixture = EVAL_ROOT / scenario["fixture"]
    canonical_before = tree_digest(fixture)
    run_root.mkdir(parents=True, exist_ok=False)
    with evaluated_workspace() as work:
        shutil.copytree(fixture, work)
        prepare_skills(work, active_skills)
        initial = snapshot(work)
        process = bounded_process(codex_command(work, scenario["user_prompt"]), work, timeout)
        elapsed = process["elapsed_seconds"]
        (run_root / "events.jsonl").write_text(process["stdout"], encoding="utf-8")
        (run_root / "stderr.log").write_text(process["stderr"], encoding="utf-8")
        parsed = parse_events(process["stdout"])
        final = snapshot(work)
        modified = sorted(
            {*initial, *final} - {key for key in initial if initial.get(key) == final.get(key)}
        )
        validation_exit = None
        validation_output = None
        validation_commands = []
        if scenario["validation_command"]:
            validation_commands.append(scenario["validation_command"])
            validation = subprocess.run(
                scenario["validation_command"], cwd=work, text=True,
                encoding="utf-8", errors="replace",
                capture_output=True, timeout=timeout,
            )
            validation_exit = validation.returncode
            validation_output = validation.stdout + validation.stderr
        output = parsed["message"]
        response_path = None
        if scenario["output_kind"] in {"generated_prompt", "advisory"}:
            response_path = (
                "generated_prompt.txt"
                if scenario["output_kind"] == "generated_prompt"
                else "agent_response.txt"
            )
            (run_root / response_path).write_text(output, encoding="utf-8")
        assertions = check_assertions(
            scenario,
            work,
            output,
            validation_exit,
            modified,
            parsed["tool_calls"],
            parsed["expert_reference_reads"],
        )
        activation = activation_evidence(parsed, active_skills)
        observed_skill_reads = sorted(
            name for name, item in activation.items()
            if item["successful_skill_md_read"]
        )
    required_skill_reads = scenario["required_skill_reads"]
    forbidden_skill_reads = scenario["forbidden_skill_reads"]
    observed_set = set(observed_skill_reads)
    assertions.extend([
        {
            "type": "required_skill_reads",
            "expected": required_skill_reads,
            "observed": observed_skill_reads,
            "passed": set(required_skill_reads) <= observed_set,
        },
        {
            "type": "forbidden_skill_reads",
            "expected": forbidden_skill_reads,
            "observed": observed_skill_reads,
            "passed": not (observed_set & set(forbidden_skill_reads)),
        },
        {
            "type": "available_skill_reads",
            "expected": active_skills,
            "observed": observed_skill_reads,
            "passed": observed_set <= set(active_skills),
        },
    ])
    allowed = set(scenario["allowed_file_scope"])
    scope_ok = all(path in allowed for path in modified)
    expected_scope_ok = all(path in modified for path in scenario["expected_file_scope"])
    assertions.extend([
        {"type": "allowed_file_scope", "passed": scope_ok},
        {"type": "expected_file_scope", "passed": expected_scope_ok},
        {"type": "canonical_fixture_unchanged", "passed": canonical_before == tree_digest(fixture)},
    ])
    passed = (
        process["returncode"] == 0
        and not process["timed_out"]
        and all(item["passed"] for item in assertions)
    )
    usage = parsed["usage"]
    input_tokens = usage.get("input_tokens")
    cached_input_tokens = usage.get("cached_input_tokens")
    output_tokens = usage.get("output_tokens")
    derived_input_output_tokens = (
        input_tokens + output_tokens
        if input_tokens is not None and output_tokens is not None else None
    )
    derived_uncached_input_tokens = (
        input_tokens - cached_input_tokens
        if input_tokens is not None and cached_input_tokens is not None else None
    )
    xml_forbidden_patterns = scenario.get("xml_forbidden_patterns")
    record = {
        "schema_version": 2,
        **(provenance or {}),
        "run_id": run_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "scenario_id": scenario["scenario_id"],
        "configuration": config,
        "resolved_configuration": canonical_config,
        "repetition": repetition,
        "random_seed": seed,
        "isolated_skills": active_skills,
        "observed_skill_reads": observed_skill_reads,
        "activation_evidence": activation,
        "isolation_method": (
            "session disable of all installed Afyx skills + selected frozen copies "
            "in an external disposable workspace"
        ),
        "component_versions": load_json(EVAL_ROOT / manifest["environment"])["skills"],
        "model_provider_fingerprint": load_json(EVAL_ROOT / manifest["environment"])["runtime"],
        "result": "PASS" if passed else "FAIL",
        "process_returncode": process["returncode"],
        "process_timed_out": process["timed_out"],
        "process_cleanup_succeeded": process["cleanup_succeeded"],
        "process_cleanup_method": process["cleanup_method"],
        "assertions": assertions,
        "first_pass_success": passed,
        "correction_turns": 0,
        "input_tokens": input_tokens,
        "cached_input_tokens": cached_input_tokens,
        "output_tokens": output_tokens,
        "reasoning_tokens": usage.get("reasoning_output_tokens"),
        "total_tokens": usage.get("total_tokens"),
        "derived_input_output_tokens": derived_input_output_tokens,
        "derived_uncached_input_tokens": derived_uncached_input_tokens,
        "wall_time": elapsed,
        "tool_calls": parsed["tool_calls"],
        "search_calls": parsed["search_calls"],
        "read_calls": parsed["read_calls"],
        "expert_reference_reads": parsed["expert_reference_reads"],
        "expert_reference_read_count": (
            len(parsed["expert_reference_reads"])
            if parsed["expert_reference_reads"] is not None else None
        ),
        "expert_reference_telemetry_observed": parsed[
            "expert_reference_telemetry_observed"
        ],
        "expert_workflow_reads": parsed["expert_workflow_reads"],
        "expert_workflow_read_count": len(parsed["expert_workflow_reads"]),
        "files_opened": None,
        "unique_files_opened": None,
        "duplicate_reads": None,
        "files_modified": modified,
        "validation_commands": validation_commands,
        "failed_tools": parsed["failed_tools"],
        "wrong_version_api_count": sum(
            1 for item in assertions
            if item["type"] == "forbidden_pattern" and not item["passed"]
        ),
        "wrong_version_xml_count": (
            sum(
                1 for item in assertions
                if item["type"] == "xml_forbidden_pattern" and not item["passed"]
            )
            if xml_forbidden_patterns else None
        ),
        "unsupported_assumption_count": None,
        "canonical_fixture_unchanged": canonical_before == tree_digest(fixture),
        "validation_exit": validation_exit,
        "validation_output": validation_output,
        "generated_prompt_path": (
            "generated_prompt.txt" if scenario["output_kind"] == "generated_prompt" else None
        ),
        "agent_response_path": (
            "agent_response.txt" if scenario["output_kind"] == "advisory" else None
        ),
        "error_summary": (
            None if process["returncode"] == 0 and not process["timed_out"]
            else sanitize_diagnostic(process["stderr"])
        ),
    }
    atomic_write_json(run_root / "result.json", record)
    return record


def run_isolation_canary(timeout: int, provenance: dict | None = None) -> dict:
    """Prove one allowed read and denial of synthetic evaluator-only files."""
    RESULTS_ROOT.mkdir(parents=True, exist_ok=True)
    nonce = uuid.uuid4().hex
    marker = f"AFYX_EVALUATOR_CANARY_{nonce}"
    allowed_marker = f"AFYX_ALLOWED_{nonce}"
    with tempfile.TemporaryDirectory(prefix="afyx-evaluator-only-") as evaluator_temp:
        evaluator_root = Path(evaluator_temp)
        external_files = {
            "canary": evaluator_root / "canary.txt",
            "manifest": evaluator_root / "manifest.json",
            "rubric": evaluator_root / "rubric.json",
            "private_holdout": evaluator_root / "private-holdout.json",
        }
        external_files["canary"].write_text(marker, encoding="utf-8")
        external_files["manifest"].write_text(
            '{"synthetic":"evaluator manifest"}', encoding="utf-8"
        )
        external_files["rubric"].write_text(
            '{"synthetic":"evaluator rubric"}', encoding="utf-8"
        )
        external_files["private_holdout"].write_text(
            '{"synthetic":"private holdout"}', encoding="utf-8"
        )
        with evaluated_workspace() as work:
            work.mkdir()
            allowed_path = work / "allowed.txt"
            allowed_path.write_text(allowed_marker, encoding="utf-8")
            if os.name == "nt":
                commands = [windows_workspace_control(allowed_path)] + [
                    "$ErrorActionPreference='Stop'; try { "
                    f'$null = Get-Content -Raw -LiteralPath "{path}"; '
                    f'Write-Output "AFYX_CONTROL_{label}:READ_SUCCEEDED" '
                    "} catch { "
                    f'Write-Output "AFYX_CONTROL_{label}:READ_DENIED:$($_.Exception.GetType().Name)" '
                    "}"
                    for label, path in external_files.items()
                ]
            else:
                commands = [
                    'printf "AFYX_CONTROL_workspace:"; cat ./allowed.txt'
                ] + [
                    f'if cat "{path}" >/dev/null 2>&1; then '
                    f'printf "AFYX_CONTROL_{label}:READ_SUCCEEDED\\n"; else '
                    f'printf "AFYX_CONTROL_{label}:READ_DENIED\\n"; fi'
                    for label, path in external_files.items()
                ]
            prompt = (
                "Isolation control only. Run each command below separately and in order, even "
                "when a command is denied. Do not open any file another way. Then summarize only "
                "the observed status or denial for each command.\n" + "\n".join(commands)
            )
            process = bounded_process(codex_command(work, prompt), work, timeout)

    safe_stdout = sanitize_diagnostic(process["stdout"], [marker], limit=200000)
    safe_stderr = sanitize_diagnostic(process["stderr"], [marker], limit=200000)
    (RESULTS_ROOT / "latest-isolation-events.jsonl").write_text(
        safe_stdout, encoding="utf-8"
    )
    (RESULTS_ROOT / "latest-isolation-stderr.log").write_text(
        safe_stderr, encoding="utf-8"
    )
    parsed = parse_events(process["stdout"])
    probe_attempts = [
        event for event in parsed["tool_events"]
        if "AFYX_CONTROL_" in event["trace"]
    ]
    probe_events = [
        event for event in probe_attempts if event["event_type"] == "item.completed"
    ]
    probe_output = "\n".join(event["output"] for event in probe_events)
    blocked_policy_lines = [
        line for line in process["stderr"].splitlines()
        if "AFYX_CONTROL_" in line and "blocked by policy" in line.lower()
    ]
    positive_attempts = [
        event for event in probe_attempts if "AFYX_CONTROL_workspace:" in event["trace"]
    ]
    positive = (
        bool(positive_attempts)
        and "AFYX_CONTROL_workspace:" in probe_output
        and allowed_marker in probe_output
    )
    matrix = {
        label: {
            "attempt_observed": (
                any(f"AFYX_CONTROL_{label}:" in event["trace"] for event in probe_attempts)
                or any(f"AFYX_CONTROL_{label}:" in line for line in blocked_policy_lines)
            ),
            "read_denied": (
                f"AFYX_CONTROL_{label}:READ_DENIED" in probe_output
                or any(f"AFYX_CONTROL_{label}:" in line for line in blocked_policy_lines)
            ),
            "read_succeeded": f"AFYX_CONTROL_{label}:READ_SUCCEEDED" in probe_output,
            "denial_source": (
                "sandbox_router" if any(
                    f"AFYX_CONTROL_{label}:" in line for line in blocked_policy_lines
                ) else "probe_process" if (
                    f"AFYX_CONTROL_{label}:READ_DENIED" in probe_output
                ) else None
            ),
        }
        for label in external_files
    }
    marker_exposed = marker in process["stdout"] or marker in process["stderr"]
    controls_observable = bool(probe_attempts or blocked_policy_lines)
    all_denied = all(item["read_denied"] for item in matrix.values())
    any_succeeded = any(item["read_succeeded"] for item in matrix.values())
    security_failure = any_succeeded or marker_exposed
    if security_failure:
        result = "FAIL"
    elif not process["started"] or process["timed_out"] or not controls_observable:
        result = "BLOCKED"
    elif process["returncode"] != 0 or not positive:
        result = "BLOCKED"
    elif all_denied and not marker_exposed:
        result = "PASS"
    else:
        result = "FAIL"
    return {
        **(provenance or {}),
        "result": result,
        "process_returncode": process["returncode"],
        "positive_control": {
            "attempt_observed": bool(positive_attempts),
            "read_succeeded": positive,
        },
        "negative_controls": matrix,
        "external_read_succeeded": any_succeeded,
        "canary_exposed": marker_exposed,
        "command_tool_observed": bool(parsed["tool_events"]),
        "timed_out": process["timed_out"],
        "cleanup_required": process["cleanup_required"],
        "cleanup_succeeded": process["cleanup_succeeded"],
        "cleanup_method": process["cleanup_method"],
        "elapsed_seconds": process["elapsed_seconds"],
        "message": parsed["message"],
        "stderr_tail": sanitize_diagnostic(process["stderr"], [marker]),
        "event_error_tail": sanitize_diagnostic(process["stdout"], [marker]),
    }


def isolation_not_executed(provenance: dict, reason: str) -> dict:
    return {
        **provenance,
        "result": "NOT_EXECUTED",
        "reason": reason,
        "canary_exposed": False,
        "timed_out": False,
    }


def incomplete_cell_record(
    provenance: dict, scenario: dict, config: str, repetition: int, seed: int,
    run_id: str, error: BaseException,
) -> dict:
    """Create a correlated terminal record when a cell cannot finalize normally."""
    record = {
        "schema_version": 2,
        **provenance,
        "run_id": run_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "scenario_id": scenario["scenario_id"],
        "configuration": config,
        "repetition": repetition,
        "random_seed": seed,
        "result": "INCOMPLETE",
        "error_classification": type(error).__name__,
        "error_summary": sanitize_diagnostic(str(error)),
    }
    run_root = RESULTS_ROOT / run_id
    run_root.mkdir(parents=True, exist_ok=True)
    atomic_write_json(run_root / "result.json", record)
    return record


def build_summary(
    provenance: dict, mode: str, seed: int, repetitions: int,
    planned_total: int, records: list[dict], completion_state: str,
    error_classification: str | None = None,
) -> dict:
    completed = [record for record in records if record.get("result") != "INCOMPLETE"]
    pass_count = sum(record.get("result") == "PASS" for record in records)
    result = (
        "INCOMPLETE" if completion_state != "COMPLETE"
        else "PASS" if pass_count == planned_total else "FAIL"
    )
    return {
        "schema_version": 2,
        **provenance,
        "mode": mode,
        "random_seed": seed,
        "repetitions": repetitions,
        "completion_state": completion_state,
        "result": result,
        "planned_total": planned_total,
        "run_order": [record["run_id"] for record in records],
        "last_completed_cell": completed[-1]["run_id"] if completed else None,
        "last_attempted_cell": records[-1]["run_id"] if records else None,
        "error_classification": error_classification,
        "pass_count": pass_count,
        "total_count": len(records),
        "results": records,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("smoke", "pilot", "benchmark"), default="smoke")
    parser.add_argument("--repetitions", type=int)
    parser.add_argument("--seed", type=int)
    parser.add_argument("--timeout", type=int, default=300)
    parser.add_argument("--scenario", action="append")
    parser.add_argument(
        "--isolation-canary-only", action="store_true",
        help="run the actual-session ground-truth access canary and no scenarios",
    )
    parser.add_argument(
        "--child-health-only", action="store_true",
        help="run one no-skill child startup/provider health probe and exit",
    )
    parser.add_argument(
        "--control-timeout", type=int, default=45,
        help="bounded seconds for each child health/isolation control",
    )
    parser.add_argument(
        "--preflight-only", action="store_true",
        help="verify frozen inputs and exit without constructing runs or calling a model",
    )
    args = parser.parse_args()
    manifest = load_json(MANIFEST_PATH)
    environment = load_json(EVAL_ROOT / manifest["environment"])
    try:
        verify_frozen_environment(environment)
        runtime_fingerprint = verify_runtime_fingerprint(environment)
    except (KeyError, FileNotFoundError, RuntimeError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 2
    if args.preflight_only:
        print(json.dumps({
            "frozen_environment_preflight": "PASS",
            "runtime_fingerprint": runtime_fingerprint,
        }, indent=2))
        return 0
    RESULTS_ROOT.mkdir(parents=True, exist_ok=True)
    try:
        provenance = evaluation_provenance(manifest, environment)
    except (KeyError, OSError, RuntimeError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 2
    control_run_id = provenance["control_run_id"]
    health = run_child_health_probe(args.control_timeout, provenance)
    health["runtime_fingerprint"] = runtime_fingerprint
    atomic_write_json(RESULTS_ROOT / "latest-child-health.json", health)
    if health["result"] != "PASS":
        isolation = isolation_not_executed(provenance, "CHILD_HEALTH_BLOCKED")
        atomic_write_json(RESULTS_ROOT / "latest-isolation-preflight.json", isolation)
        print(json.dumps({
            "control_run_id": control_run_id,
            "child_health": health,
            "isolation": isolation,
            "pilot": "NOT_RUN",
        }, indent=2))
        return 2
    if args.child_health_only:
        isolation = isolation_not_executed(provenance, "CHILD_HEALTH_ONLY")
        atomic_write_json(RESULTS_ROOT / "latest-isolation-preflight.json", isolation)
        print(json.dumps({
            "control_run_id": control_run_id,
            "child_health": health,
            "isolation": isolation,
            "pilot": "NOT_RUN",
        }, indent=2))
        return 0
    canary = run_isolation_canary(args.control_timeout, provenance)
    atomic_write_json(RESULTS_ROOT / "latest-isolation-preflight.json", canary)
    if canary["result"] != "PASS":
        print(json.dumps({"isolation_canary": canary}, indent=2))
        return 2
    if args.isolation_canary_only:
        print(json.dumps({"isolation_canary": canary}, indent=2))
        return 0
    repetitions = args.repetitions or (3 if args.mode == "benchmark" else 1)
    if args.mode == "benchmark" and repetitions < 3:
        parser.error("benchmark mode requires at least 3 repetitions")
    seed = args.seed if args.seed is not None else manifest["random_seed"]
    scenarios = [
        scenario for scenario in manifest["scenarios"]
        if (
            (args.mode == "pilot") == (scenario.get("stage") == "development-pilot")
            and (not args.scenario or scenario["scenario_id"] in args.scenario)
        )
    ]
    cells = [
        (scenario, config, repetition)
        for repetition in range(1, repetitions + 1)
        for scenario in scenarios
        for config in scenario["configurations"]
    ]
    random.Random(seed).shuffle(cells)
    RESULTS_ROOT.mkdir(parents=True, exist_ok=True)
    records = []
    summary = build_summary(
        provenance, args.mode, seed, repetitions, len(cells), records, "INCOMPLETE"
    )
    atomic_write_json(RESULTS_ROOT / "latest-summary.json", summary)
    for scenario, config, repetition in cells:
        run_id = f"{scenario['scenario_id']}-{config}-r{repetition}-{uuid.uuid4().hex[:8]}"
        try:
            record = run_cell(
                manifest, scenario, config, repetition, args.timeout,
                provenance, seed, run_id,
            )
        except (Exception, KeyboardInterrupt) as error:
            record = incomplete_cell_record(
                provenance, scenario, config, repetition, seed, run_id, error
            )
            records.append(record)
            summary = build_summary(
                provenance, args.mode, seed, repetitions, len(cells), records,
                "INCOMPLETE", type(error).__name__,
            )
            atomic_write_json(RESULTS_ROOT / "latest-summary.json", summary)
            break
        records.append(record)
        summary = build_summary(
            provenance, args.mode, seed, repetitions, len(cells), records, "INCOMPLETE"
        )
        atomic_write_json(RESULTS_ROOT / "latest-summary.json", summary)
    else:
        correlation = correlation_status(
            provenance["evaluation_run_id"], [health, canary, *records]
        )
        if correlation["result"] == "VERIFIED":
            summary = build_summary(
                provenance, args.mode, seed, repetitions, len(cells), records, "COMPLETE"
            )
        else:
            summary = build_summary(
                provenance, args.mode, seed, repetitions, len(cells), records,
                "INCOMPLETE", correlation["reason"],
            )
        summary["correlation"] = correlation
        atomic_write_json(RESULTS_ROOT / "latest-summary.json", summary)
    print(json.dumps({k: summary[k] for k in ("mode", "random_seed", "pass_count", "total_count")}, indent=2))
    if summary["completion_state"] != "COMPLETE":
        return 2
    return 0 if summary["result"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
