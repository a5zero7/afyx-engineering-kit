import json
import subprocess
import unittest
from datetime import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]

try:
    import tomllib
except ImportError:
    tomllib = None

@unittest.skipIf(tomllib is None, "Python 3.11+ tomllib is required")
class ProviderTomlDifferentialTests(unittest.TestCase):
    def test_preserves_supported_standard_toml_values(self):
        source = "\n".join([
            "basic = " + '"' * 3 + "text" + '"' * 5,
            "literal = " + "'" * 3 + "text" + "'" * 4,
            "clock = 07:32:00.123",
            "[[profiles.workers]]",
            'name = "first"',
            "[[profiles.workers]]",
            'name = "second"',
        ])
        expected = json.loads(json.dumps(tomllib.loads(source), default=lambda value: value.isoformat()))
        script = """
import {readFileSync} from 'node:fs';
import {parseToml} from './scripts/afyx-provider-backup.mjs';
const spans=[];
const doc=parseToml(readFileSync(0,'utf8'), (span)=>spans.push(span));
console.log(JSON.stringify({doc,spans}));
"""
        result = subprocess.run(
            ["node", "--input-type=module", "-e", script],
            input=source, text=True, capture_output=True, cwd=ROOT, timeout=15, check=True,
        )
        actual = json.loads(result.stdout)
        expected["clock"] = source.splitlines()[2].split(" = ")[1]
        self.assertIsInstance(tomllib.loads(source)["clock"], time)
        self.assertEqual(actual["doc"], expected)
        self.assertEqual(
            [span["keys"] for span in actual["spans"] if span["kind"] == "array-table"],
            [["profiles", "workers"], ["profiles", "workers"]],
        )
