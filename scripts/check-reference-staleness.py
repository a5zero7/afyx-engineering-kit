#!/usr/bin/env python3
"""Report Odoo reference files whose verification date is over six months old."""

from __future__ import annotations

import calendar
import re
from datetime import date
from pathlib import Path


LAST_VERIFIED_RE = re.compile(
    r"^Last verified:\s*(\d{4}-\d{2}-\d{2})\s*$", re.MULTILINE
)


def six_month_cutoff(today: date) -> date:
    month_index = today.month - 1 - 6
    year = today.year + month_index // 12
    month = month_index % 12 + 1
    day = min(today.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def check_references() -> None:
    repository_root = Path(__file__).resolve().parents[1]
    references_dir = repository_root / "skills" / "odoo-engineering" / "references"
    cutoff = six_month_cutoff(date.today())
    references = sorted(references_dir.glob("odoo-*.md"))

    if not references:
        print(f"WARN: no Odoo reference files found under {references_dir}")
        return

    stale_count = 0
    unknown_count = 0
    for reference in references:
        try:
            content = reference.read_text(encoding="utf-8")
            match = LAST_VERIFIED_RE.search(content)
            if match is None:
                unknown_count += 1
                print(f"WARN: {reference.name} has no parseable Last verified header")
                continue

            verified = date.fromisoformat(match.group(1))
            if verified < cutoff:
                stale_count += 1
                print(
                    f"WARN: {reference.name} was last verified {verified.isoformat()} "
                    f"(older than six months; cutoff {cutoff.isoformat()})"
                )
        except (OSError, UnicodeError, ValueError) as error:
            unknown_count += 1
            print(f"WARN: could not inspect {reference.name}: {error}")

    if stale_count == 0 and unknown_count == 0:
        print(f"No stale Odoo references found (cutoff {cutoff.isoformat()}).")



def main() -> int:
    try:
        check_references()
    except Exception as error:  # This informational check must never become a gate.
        print(f"WARN: reference staleness check could not complete: {error}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
