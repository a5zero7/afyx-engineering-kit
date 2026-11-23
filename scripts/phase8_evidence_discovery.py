#!/usr/bin/env python3
"""Find retained Codex session metadata for specific Phase 8 run IDs, offline.

Reads only explicitly scoped rollout/JSONL files. Emits no prompts, event bodies,
absolute paths, credentials, or file contents. Never invokes an agent/provider.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
import sys
from pathlib import Path
from typing import Any

UUID = re.compile(r"^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$")
READ_LIMIT = 64
LINE_LIMIT = 1024 * 1024
DEFAULT_MAX_SIZE = 128 * 1024 * 1024


class DiscoveryError(ValueError):
    pass


def link_kind(path: Path) -> str | None:
    """Classify links without following them, including Windows reparse points."""
    if path.is_symlink():
        return "SYMLINK"
    attributes = getattr(path.lstat(), "st_file_attributes", 0)
    reparse_flag = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
    return "REPARSE_POINT" if attributes & reparse_flag else None


def default_root() -> Path:
    home = os.environ.get("CODEX_HOME")
    return Path(home).expanduser() / "sessions" if home else Path.home() / ".codex" / "sessions"


def thread_identity(path: Path) -> str | None:
    """Read bounded event *metadata*, not any prompt/body or arbitrary text match."""
    with path.open("rb") as f:
        for index, line in enumerate(f):
            if index >= READ_LIMIT:
                break
            if len(line) > LINE_LIMIT:
                raise DiscoveryError("oversized metadata line")
            try:
                event = json.loads(line)
            except (ValueError, UnicodeDecodeError) as exc:
                raise DiscoveryError("invalid JSONL metadata") from exc
            if not isinstance(event, dict):
                raise DiscoveryError("invalid JSONL event type")
            typ = event.get("type")
            if typ == "session_meta":
                payload = event.get("payload")
                candidate = payload.get("id") if isinstance(payload, dict) else None
            elif typ == "thread.started":
                candidate = event.get("thread_id")
            else:
                continue
            if isinstance(candidate, str) and UUID.fullmatch(candidate):
                return candidate.lower()
    return None


def file_sha256(path: Path) -> str:
    sha = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            sha.update(chunk)
    return sha.hexdigest()


def discover(root: Path, thread_ids: list[str], *, max_files: int = 4000,
             max_file_bytes: int = DEFAULT_MAX_SIZE, include_cli_json: bool = False) -> dict[str, Any]:
    if not thread_ids or any(not UUID.fullmatch(t) for t in thread_ids):
        raise DiscoveryError("valid thread UUIDs are required")
    if max_files < 1 or max_file_bytes < 1:
        raise DiscoveryError("positive scan limits required")
    target_ids = list(dict.fromkeys(t.lower() for t in thread_ids))
    base = root.expanduser().resolve(strict=False)
    result: dict[str, Any] = {"schema_version": 1, "scope": "EXPLICIT_ROOT_ONLY", "default_root_used": False,
                               "raw_content_exported": False, "provider_calls": 0,
                               "file_scan": {"visited": 0, "unreadable": 0, "oversized": 0,
                                             "unidentified": 0, "symlinks_skipped": 0,
                                             "reparse_points_skipped": 0, "cap_reached": False},
                               "runs": {t: {"status": "NOT_FOUND_IN_SCOPE", "matches": []} for t in target_ids}}
    if not base.is_dir():
        result["scope_status"] = "ROOT_NOT_FOUND"
        for r in result["runs"].values():
            r["status"] = "INCOMPLETE_SCAN"
        return result
    result["scope_status"] = "SCANNED"
    files: list[Path] = []
    counters = result["file_scan"]
    for directory, names, filenames in os.walk(base, followlinks=False):
        retained_names = []
        for name in sorted(names):
            candidate = Path(directory) / name
            try:
                kind = link_kind(candidate)
            except OSError:
                counters["unreadable"] += 1
                continue
            if kind == "SYMLINK":
                counters["symlinks_skipped"] += 1
            elif kind == "REPARSE_POINT":
                counters["reparse_points_skipped"] += 1
            else:
                retained_names.append(name)
        names[:] = retained_names
        for filename in sorted(filenames):
            if (filename.startswith("rollout-") and filename.endswith(".jsonl")) or (include_cli_json and filename.endswith(".jsonl")):
                files.append(Path(directory) / filename)
                if len(files) > max_files:
                    result["file_scan"]["cap_reached"] = True
                    break
        if result["file_scan"]["cap_reached"]:
            break
    for path in files[:max_files]:
        counters["visited"] += 1
        try:
            kind = link_kind(path)
            if kind == "SYMLINK":
                counters["symlinks_skipped"] += 1
                continue
            if kind == "REPARSE_POINT":
                counters["reparse_points_skipped"] += 1
                continue
            st = path.stat()
            if st.st_size > max_file_bytes:
                counters["oversized"] += 1
                continue
            session_id = thread_identity(path)
            if session_id not in result["runs"]:
                counters["unidentified"] += 1
                continue
            result["runs"][session_id]["matches"].append({
                "relative_path": path.relative_to(base).as_posix(),
                "size_bytes": st.st_size,
                "sha256": file_sha256(path),
                "identity_source": "STRUCTURED_EVENT_METADATA",
            })
        except (OSError, DiscoveryError):
            counters["unreadable"] += 1
    incomplete = any(result["file_scan"][k] for k in
                     ("unreadable", "oversized", "symlinks_skipped",
                      "reparse_points_skipped", "cap_reached"))
    for item in result["runs"].values():
        count = len(item["matches"])
        item["status"] = ("MULTIPLE_MATCHES" if count > 1 else
                          "INCOMPLETE_SCAN" if incomplete else
                          "FOUND" if count == 1 else "NOT_FOUND_IN_SCOPE")
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=None, help="Only this explicitly selected root is searched")
    parser.add_argument("--thread-id", action="append", required=True, help="Repeat for each target Codex thread UUID")
    parser.add_argument("--include-cli-json", action="store_true", help="Also inspect *.jsonl files under the root")
    parser.add_argument("--max-files", type=int, default=4000)
    parser.add_argument("--max-file-mib", type=int, default=128)
    parser.add_argument("--output", type=Path, help="Create new report exclusively; never overwrite")
    args = parser.parse_args(argv)
    try:
        root = args.root if args.root is not None else default_root()
        report = discover(root, args.thread_id, max_files=args.max_files,
                          max_file_bytes=args.max_file_mib * 1024 * 1024,
                          include_cli_json=args.include_cli_json)
        report["default_root_used"] = args.root is None
        encoded = json.dumps(report, indent=2, sort_keys=True) + "\n"
        if args.output:
            with args.output.open("x", encoding="utf-8", newline="\n") as f:
                f.write(encoded)
        else:
            print(encoded, end="")
    except (DiscoveryError, OSError) as exc:
        print("DISCOVERY_BLOCKED: " + str(exc), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
