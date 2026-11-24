#!/usr/bin/env python3
"""Independence gate: active product surfaces must carry no legacy identity.

The forbidden tokens are assembled from neutral fragments, so this file never
contains them and is scanned like every other active file. Exact historical and
legal evidence files are classified rather than erased, and the ignored local
developer index is an external exception. Matches are redacted in the output.
Zero-token and deterministic; reads the repository only.

usage: audit-legacy-identity.py [--root DIR]
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from pathlib import Path

FORBIDDEN_TOKENS = ("code" + "graph", "colby" + "mchenry")
PATTERN = re.compile("|".join(re.escape(token) for token in FORBIDDEN_TOKENS), re.IGNORECASE)
REDACTION = "<legacy-identity>"
MACHINE_PATH = re.compile(
    r"d:[/\\]+project\b|file:" + "/" * 3 + r"|~/\.gemini/" + "antigravity",
    re.IGNORECASE,
)
RULE_IMPLEMENTATION = "scripts/verify-native-source-ownership.mjs"
RULE_LITERALS = {
    r"pattern: /Copyright\s+\(c\)\s+\d{4}\s+" + FORBIDDEN_TOKENS[0].title().replace("graph", "Graph") + "/i,",
    r"""pattern: /from\s+['"]@""" + FORBIDDEN_TOKENS[0] + r"""\//i,""",
}
SKIPPED_DIRECTORIES = {".git", ".rea_source", "node_modules", "testing", "progres"}
PERMITTED_CONTENT_PATHS = {
    # Review metadata must name historical sources accurately. This file is
    # excluded from product packages and has its own fail-closed ownership gate.
    "scripts/native-source-ownership.json": "LEGAL_PROVENANCE",
    "docs/AFYX_INDEPENDENCE_PLAN.md": "HISTORICAL_EVIDENCE",
    "docs/AFYX_PHASE5F_THIRD_PARTY_REPLACEMENT.md": "HISTORICAL_EVIDENCE",
    "docs/AFYX_V1_MASTER_ROADMAP.md": "HISTORICAL_EVIDENCE",
    "AFYX-320-execution-handoff-2026-11-05.md": "HISTORICAL_EVIDENCE",
}
EXTERNAL_DIRECTORY = "." + FORBIDDEN_TOKENS[0]


def git_paths(root: Path, *options: str) -> list[str]:
    paths = subprocess.run(
        ["git", "-C", str(root), "ls-files", "-z", *options, "--exclude-standard", "--",
         ":(exclude).rea_source/", ":(exclude)testing/", ":(exclude)progres/"],
        capture_output=True, encoding="utf-8", check=True,
    ).stdout
    return [path for path in paths.split("\0") if path]


def directory_names(root: Path, files: list[str]) -> tuple[list[str], bool]:
    candidates = {parent for file in files for parent in Path(file).parents}
    # Git collapses untracked directories. Inspect just these directories
    # to retain the check for empty legacy directories.
    for path in git_paths(root, "--others", "--directory"):
        if not path.endswith("/") or path.startswith(EXTERNAL_DIRECTORY + "/"):
            continue
        relative_path = Path(path)
        if any(part in SKIPPED_DIRECTORIES for part in relative_path.parts):
            continue
        candidates.update(relative_path.parents)
        candidates.add(relative_path)
        for current, dirs, _files in os.walk(root / relative_path):
            dirs[:] = [name for name in dirs if name not in SKIPPED_DIRECTORIES]
            candidates.update((Path(current) / name).relative_to(root) for name in dirs)
    found = sorted(
        candidate.as_posix() for candidate in candidates
        if PATTERN.search(candidate.name) and candidate.parts[:1] != (EXTERNAL_DIRECTORY,)
    )
    return found, (root / EXTERNAL_DIRECTORY).is_dir()


def redact(text: str) -> str:
    return PATTERN.sub(REDACTION, text)


def tracked_path_findings(root: Path) -> list[str]:
    tracked = subprocess.run(
        ["git", "-C", str(root), "ls-files", "--cached", "-z"],
        capture_output=True, encoding="utf-8", check=True,
    ).stdout
    findings = []
    for rel in filter(None, tracked.split("\0")):
        target = root / rel
        if target.is_symlink():
            text = os.readlink(target)
        elif target.is_file():
            text = target.read_text(encoding="utf-8", errors="replace")
        else:
            continue
        if MACHINE_PATH.search(rel):
            findings.append(f"{MACHINE_PATH.sub('<machine-path>', rel)}: machine-specific file name")
        for number, line in enumerate(text.splitlines(), 1):
            if MACHINE_PATH.search(line):
                findings.append(f"{MACHINE_PATH.sub('<machine-path>', rel)}:{number}: machine-specific path")
    return findings


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=str(Path(__file__).resolve().parents[1]))
    root = Path(parser.parse_args().root).resolve()

    findings = tracked_path_findings(root)
    permitted = {"HISTORICAL_EVIDENCE": 0, "LEGAL_PROVENANCE": 0, "EXTERNAL_EXCEPTION": 0}
    files = [path for path in git_paths(root, "--cached", "--others") if (root / path).is_file()]
    for rel in files:
        if PATTERN.search(rel):
            findings.append(f"{redact(rel)}: file name carries the legacy identity")
        try:
            text = (root / rel).read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        hits = [(number, line.strip()) for number, line in enumerate(text.splitlines(), start=1) if PATTERN.search(line)
                and not (rel == RULE_IMPLEMENTATION and line.strip() in RULE_LITERALS)]
        classification = PERMITTED_CONTENT_PATHS.get(Path(rel).as_posix())
        if classification:
            permitted[classification] += len(hits)
            continue
        for number, line in hits[:3]:
            findings.append(f"{redact(rel)}:{number}: {redact(line)[:120]}")
        if len(hits) > 3:
            findings.append(f"{redact(rel)}: ... {len(hits) - 3} more")
    directories, has_external_directory = directory_names(root, files)
    permitted["EXTERNAL_EXCEPTION"] += int(has_external_directory)
    for directory in directories:
        findings.append(f"{redact(directory)}/: directory name carries the legacy identity")

    if findings:
        print("Legacy identity or machine paths found in the working tree:")
        for finding in findings:
            print(f"  {finding}")
        print(f"Legacy identity audit: FAIL ({len(findings)} finding line(s))")
        return 1
    print("Legacy identity audit: PASS (active contents, file names and directory names are clean)")
    print(
        "Permitted classified residue: "
        f"HISTORICAL_EVIDENCE={permitted['HISTORICAL_EVIDENCE']} "
        f"LEGAL_PROVENANCE={permitted['LEGAL_PROVENANCE']} "
        f"EXTERNAL_EXCEPTION={permitted['EXTERNAL_EXCEPTION']}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
