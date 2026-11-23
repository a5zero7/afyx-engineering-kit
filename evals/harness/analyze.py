#!/usr/bin/env python3
"""Summarize sanitized benchmark result records without inventing metrics."""

import json
import statistics
from collections import defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    latest = ROOT / "results" / "latest-summary.json"
    records = json.loads(latest.read_text(encoding="utf-8"))["results"]
    groups = defaultdict(list)
    for record in records:
        groups[(record["scenario_id"], record["configuration"])].append(record)
    summary = []
    for (scenario, config), runs in sorted(groups.items()):
        times = [r["wall_time"] for r in runs if r["wall_time"] is not None]
        tokens = [r["total_tokens"] for r in runs if r["total_tokens"] is not None]
        summary.append({
            "scenario_id": scenario,
            "configuration": config,
            "passes": sum(r["result"] == "PASS" for r in runs),
            "runs": len(runs),
            "median_wall_time": statistics.median(times) if times else None,
            "median_total_tokens": statistics.median(tokens) if tokens else None,
        })
    print(json.dumps({"groups": summary}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
