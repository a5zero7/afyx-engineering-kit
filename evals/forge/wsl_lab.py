#!/usr/bin/env python3
"""Bounded WSL-native synthetic integration for the public Forge controller.

This module is a lab adapter, not a formal campaign runner.  It executes one
fixed, repository-owned synthetic program as the current Linux user and keeps
the original process streams outside the disposable execution workspace.
"""

from __future__ import annotations

import hashlib
import json
import os
import signal
import subprocess
import sys
import uuid
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Mapping

from evals.forge import controller


SYNTHETIC_STDOUT = b"afyx-wsl-lab: stdout complete\n"
SYNTHETIC_STDERR = b"afyx-wsl-lab: stderr complete\n"
SYNTHETIC_ARTIFACT = (
    b"def clamp(value: int, lower: int, upper: int) -> int:\n"
    b"    \"\"\"Return value constrained to the inclusive lower/upper bounds.\"\"\"\n"
    b"    return max(lower, min(upper, value))\n"
)
SYNTHETIC_CHILD = """\
import pathlib
import sys
import time

mode = sys.argv[1]
if mode == "timeout":
    time.sleep(60)
pathlib.Path("known_math.py").write_bytes(%r)
sys.stdout.buffer.write(%r)
sys.stdout.buffer.flush()
sys.stderr.buffer.write(%r)
sys.stderr.buffer.flush()
""" % (SYNTHETIC_ARTIFACT, SYNTHETIC_STDOUT, SYNTHETIC_STDERR)


def _sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _canonical_bytes(value: Any) -> bytes:
    return json.dumps(
        value, ensure_ascii=True, separators=(",", ":"), sort_keys=True
    ).encode("utf-8")


def _write_durable(path: Path, content: bytes) -> None:
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    with temporary.open("xb") as handle:
        handle.write(content)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)
    if os.name != "nt":
        directory_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)


def _binding_record(binding: controller.EvidenceBinding) -> dict[str, str]:
    return asdict(binding)


@dataclass(frozen=True)
class WslLabFaults:
    """Explicit fault injection used only by the bounded synthetic lab."""

    capture_failure: bool = False
    truncate_stdout: bool = False
    tamper_after_capture: bool = False


class WslLabEvidenceRecorder:
    """Retain raw synthetic evidence outside the disposable workspace."""

    def __init__(self, evidence_root: Path, *, faults: WslLabFaults | None = None) -> None:
        self.root = evidence_root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.faults = faults or WslLabFaults()
        self.process_start_count = 0

    def _session(self, session_id: str) -> Path:
        if not controller.SAFE_CORRELATION.fullmatch(session_id):
            raise ValueError("invalid lab evidence session")
        return self.root / session_id

    def prepare(
        self, binding: controller.EvidenceBinding
    ) -> controller.ArchiveReadinessReceipt:
        session_id = f"wsl-lab-{uuid.uuid4().hex}"
        session = self._session(session_id)
        session.mkdir(mode=0o700)
        readiness = {
            "binding": _binding_record(binding),
            "capture_state": "READY_BEFORE_LAUNCH",
            "schema_version": 1,
            "session_id": session_id,
        }
        _write_durable(session / "readiness.json", _canonical_bytes(readiness))
        return controller.build_archive_readiness_receipt(binding, session_id)

    def capture(
        self,
        session_id: str,
        *,
        binding: controller.EvidenceBinding,
        stdout: bytes,
        stderr: bytes,
        process_state: Mapping[str, Any],
    ) -> None:
        if self.faults.capture_failure:
            raise OSError("synthetic capture failure")
        session = self._session(session_id)
        readiness_bytes = (session / "readiness.json").read_bytes()
        readiness = json.loads(readiness_bytes)
        if readiness["binding"] != _binding_record(binding):
            raise ValueError("capture binding mismatch")
        stored_stdout = (
            stdout[:-1] if self.faults.truncate_stdout and stdout else stdout
        )
        _write_durable(session / "stdout.bin", stored_stdout)
        _write_durable(session / "stderr.bin", stderr)
        capture = {
            "binding": _binding_record(binding),
            "process_state": dict(process_state),
            "readiness_record_sha256": _sha256(readiness_bytes),
            "schema_version": 1,
            "stderr_bytes": len(stderr),
            "stderr_sha256": _sha256(stderr),
            "stdout_bytes": len(stdout),
            "stdout_sha256": _sha256(stdout),
            "stdout_upstream_truncated": self.faults.truncate_stdout,
        }
        _write_durable(session / "capture.json", _canonical_bytes(capture))
        if self.faults.tamper_after_capture:
            _write_durable(session / "stdout.bin", stored_stdout + b"tampered")

    def finalize(
        self, request: controller.EvidenceFinalizationRequest
    ) -> controller.EvidenceFinalizationReceipt:
        session = self._session(request.evidence_session_id)
        capture_path = session / "capture.json"
        if not capture_path.is_file():
            raise ValueError("capture missing")
        capture = json.loads(capture_path.read_text("utf-8"))
        if capture["binding"] != _binding_record(request.binding):
            raise ValueError("finalization binding mismatch")
        if capture["readiness_record_sha256"] != _sha256(
            (session / "readiness.json").read_bytes()
        ):
            raise ValueError("readiness record changed after launch")
        for stream in ("stdout", "stderr"):
            original = (session / f"{stream}.bin").read_bytes()
            if len(original) != capture[f"{stream}_bytes"]:
                raise ValueError("retained stream length mismatch")
            if _sha256(original) != capture[f"{stream}_sha256"]:
                raise ValueError("retained stream digest mismatch")
        if capture["stdout_upstream_truncated"]:
            raise ValueError("truncated retained stream")
        receipt = controller.build_evidence_finalization_receipt(request)
        finalized = {
            "capture_sha256": _sha256(_canonical_bytes(capture)),
            "receipt": asdict(receipt),
            "schema_version": 1,
            "state": "FINALIZED_BEFORE_RESULT",
        }
        _write_durable(session / "finalization.json", _canonical_bytes(finalized))
        return receipt


class WslLabEvidenceVerifier:
    """Path-separated lab verifier with persistent one-use challenge markers."""

    def __init__(self, evidence_root: Path) -> None:
        self.root = evidence_root.resolve()
        self.replay_root = self.root / ".verified-challenges"
        self.replay_root.mkdir(mode=0o700, exist_ok=True)

    def _session(self, session_id: str) -> Path:
        if not controller.SAFE_CORRELATION.fullmatch(session_id):
            raise ValueError("invalid lab evidence session")
        return self.root / session_id

    def verify_readiness(
        self,
        binding: controller.EvidenceBinding,
        receipt: controller.ArchiveReadinessReceipt,
    ) -> None:
        readiness = json.loads(
            (self._session(receipt.evidence_session_id) / "readiness.json").read_text(
                "utf-8"
            )
        )
        if readiness["binding"] != _binding_record(binding):
            raise ValueError("readiness binding mismatch")
        marker = self.replay_root / binding.retention_challenge_id
        with marker.open("xb") as handle:
            handle.write(receipt.receipt_sha256.encode("ascii"))
            handle.flush()
            os.fsync(handle.fileno())

    def verify_finalization(
        self,
        request: controller.EvidenceFinalizationRequest,
        receipt: controller.EvidenceFinalizationReceipt,
    ) -> None:
        session = self._session(receipt.evidence_session_id)
        finalized = json.loads((session / "finalization.json").read_text("utf-8"))
        if _canonical_bytes(finalized["receipt"]) != _canonical_bytes(asdict(receipt)):
            raise ValueError("finalization receipt mismatch")
        capture = json.loads((session / "capture.json").read_text("utf-8"))
        if finalized["capture_sha256"] != _sha256(_canonical_bytes(capture)):
            raise ValueError("capture metadata tampered")
        if capture["readiness_record_sha256"] != _sha256(
            (session / "readiness.json").read_bytes()
        ):
            raise ValueError("readiness record tampered")
        for stream in ("stdout", "stderr"):
            original = (session / f"{stream}.bin").read_bytes()
            if len(original) != capture[f"{stream}_bytes"]:
                raise ValueError("retained stream length mismatch")
            if _sha256(original) != capture[f"{stream}_sha256"]:
                raise ValueError("retained stream digest mismatch")
        marker = self.replay_root / request.binding.retention_challenge_id
        if marker.read_text("ascii") != request.readiness_receipt_sha256:
            raise ValueError("readiness verification state missing")


class WslSyntheticLauncher:
    """Launch exactly the fixed synthetic child; never workspace source."""

    def __init__(
        self,
        recorder: WslLabEvidenceRecorder,
        binding: controller.EvidenceBinding,
        *,
        mode: str = "success",
    ) -> None:
        if mode not in {"success", "timeout"}:
            raise ValueError("unsupported synthetic child mode")
        self.recorder = recorder
        self.binding = binding
        self.mode = mode

    def launch(self, request: controller.LaunchRequest) -> controller.ProcessOutcome:
        evidence_root = self.recorder.root
        workspace = request.workspace.resolve(strict=True)
        if (
            evidence_root == workspace
            or evidence_root in workspace.parents
            or workspace in evidence_root.parents
        ):
            raise ValueError("evidence and execution roots must be separate")
        process = subprocess.Popen(
            [sys.executable, "-I", "-c", SYNTHETIC_CHILD, self.mode],
            cwd=workspace,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            start_new_session=True,
            env={"PATH": os.environ.get("PATH", "/usr/bin:/bin")},
        )
        self.recorder.process_start_count += 1
        timed_out = False
        process_tree_terminated = True
        try:
            stdout, stderr = process.communicate(timeout=request.timeout_seconds)
        except subprocess.TimeoutExpired:
            timed_out = True
            os.killpg(process.pid, signal.SIGKILL)
            stdout, stderr = process.communicate()
        state = {
            "exit_code": process.returncode,
            "launcher": "fixed-wsl-synthetic-child-v1",
            "process_tree_terminated": process_tree_terminated,
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
            identity=f"wsl-uid:{os.getuid()}",
            exit_code=process.returncode,
            stdout=stdout.decode("utf-8", errors="replace"),
            stderr=stderr.decode("utf-8", errors="replace"),
            stdout_upstream_truncated=truncated,
            stderr_upstream_truncated=False,
            stdout_stream_scan_complete=False if truncated else None,
            stdout_stream_forbidden_marker=False if truncated else None,
            timed_out=timed_out,
            process_tree_terminated=process_tree_terminated,
        )


class BindingLauncher:
    """Late-bind the controller-generated challenge to the lab launcher."""

    def __init__(
        self,
        recorder: WslLabEvidenceRecorder,
        *,
        mode: str = "success",
    ) -> None:
        self.recorder = recorder
        self.mode = mode

    def launch(self, request: controller.LaunchRequest) -> controller.ProcessOutcome:
        readiness = json.loads(
            (self.recorder.root / request.evidence_session_id / "readiness.json").read_text(
                "utf-8"
            )
        )
        binding = controller.EvidenceBinding(**readiness["binding"])
        return WslSyntheticLauncher(self.recorder, binding, mode=self.mode).launch(
            request
        )


def expected_identity() -> str:
    return f"wsl-uid:{os.getuid()}"


def synthetic_artifact_sha256() -> str:
    return _sha256(SYNTHETIC_ARTIFACT)
