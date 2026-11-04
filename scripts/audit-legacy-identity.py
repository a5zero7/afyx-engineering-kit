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
SKIPPED_DIRECTORIES = {".git", "node_modules"}
PERMITTED_CONTENT_PATHS = {
    "docs/AFYX_INDEPENDENCE_PLAN.md": "HISTORICAL_EVIDENCE",
    "docs/AFYX_PHASE5F_THIRD_PARTY_REPLACEMENT.md": "HISTORICAL_EVIDENCE",
    "docs/AFYX_V1_MASTER_ROADMAP.md": "HISTORICAL_EVIDENCE",
}
EXTERNAL_DIRECTORY = "." + FORBIDDEN_TOKENS[0]


def repository_files(root: Path) -> list[str]:
    out = subprocess.run(
        ["git", "-C", str(root), "ls-files", "--cached", "--others", "--exclude-standard"],
        capture_output=True, text=True, check=True,
    ).stdout
    return [line for line in out.splitlines() if line and (root / line).is_file()]


def directory_names(root: Path) -> tuple[list[str], list[str]]:
    found: list[str] = []
    external: list[str] = []
    for current, dirs, _files in os.walk(root):
        relative_current = Path(current).relative_to(root)
        if relative_current == Path(".") and EXTERNAL_DIRECTORY in dirs:
            external.append(EXTERNAL_DIRECTORY)
        dirs[:] = [
            name for name in dirs
            if name not in SKIPPED_DIRECTORIES
            and not (relative_current == Path(".") and name == EXTERNAL_DIRECTORY)
        ]
        for name in dirs:
            if PATTERN.search(name):
                found.append(Path(current, name).relative_to(root).as_posix())
    return found, external


def redact(text: str) -> str:
    return PATTERN.sub(REDACTION, text)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=str(Path(__file__).resolve().parents[1]))
    root = Path(parser.parse_args().root).resolve()

    findings: list[str] = []
    permitted = {"HISTORICAL_EVIDENCE": 0, "LEGAL_PROVENANCE": 0, "EXTERNAL_EXCEPTION": 0}
    for rel in repository_files(root):
        if PATTERN.search(rel):
            findings.append(f"{redact(rel)}: file name carries the legacy identity")
        try:
            text = (root / rel).read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        hits = [(number, line.strip()) for number, line in enumerate(text.splitlines(), start=1) if PATTERN.search(line)]
        classification = PERMITTED_CONTENT_PATHS.get(Path(rel).as_posix())
        if classification:
            permitted[classification] += len(hits)
            continue
        for number, line in hits[:3]:
            findings.append(f"{redact(rel)}:{number}: {redact(line)[:120]}")
        if len(hits) > 3:
            findings.append(f"{redact(rel)}: ... {len(hits) - 3} more")
    directories, external_directories = directory_names(root)
    permitted["EXTERNAL_EXCEPTION"] += len(external_directories)
    for directory in directories:
        findings.append(f"{redact(directory)}/: directory name carries the legacy identity")

    if findings:
        print("Legacy identity found in the working tree:")
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
