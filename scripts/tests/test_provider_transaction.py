#!/usr/bin/env python3
"""TB6 cross-provider transaction tests using disposable provider fixtures."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.tests.test_claude_provider_integration import fake_claude, fake_server

HELPER = ROOT / "scripts/afyx-provider-integration.mjs"


def fake_codex(path: Path, script: Path) -> None:
    script.write_text(
        r"""const fs=require('node:fs');
const path=require('node:path');
const home=process.env.CODEX_HOME;
const config=path.join(home,'config.toml');
const args=process.argv.slice(2);
if(fs.existsSync(path.join(home,'HANG'))){const end=Date.now()+2000;while(Date.now()<end){}}
if(args[0]!=='mcp'||args[2]!=='afyx_graph')process.exit(64);
if(args[1]!=='get')process.exit(64);
if(!fs.existsSync(config)){console.error('MCP server afyx_graph not found');process.exit(1);}
const text=fs.readFileSync(config,'utf8');
const command=text.match(/^command = (.+)$/m);
const values=text.match(/^args = (.+)$/m);
if(!command||!values){console.error('MCP server afyx_graph not found');process.exit(1);}
console.log(JSON.stringify({transport:{type:'stdio',command:JSON.parse(command[1]),args:JSON.parse(values[1])}}));
""",
        encoding="utf-8",
    )
    node = shutil.which("node") or "node"
    if os.name == "nt":
        path.write_text(f'@"{node}" "{script}" %*\r\n', encoding="utf-8")
    else:
        path.write_text(f'#!/bin/sh\nexec "{node}" "{script}" "$@"\n', encoding="utf-8")
        path.chmod(0o755)


class ProviderTransactionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.base = Path(self.temporary.name)
        self.workspace = self.base / "workspace"
        self.workspace.mkdir()
        self.gemini = self.base / "gemini"
        self.codex_home = self.base / "codex"
        self.claude_config = self.base / "claude-config"
        self.claude_config.mkdir()
        self.native_home = self.base / "native-home"
        self.native_home.mkdir()
        self.entry = self.base / "runtime/current/lib/dist/bin/afyx-graph.js"
        fake_server(self.entry)
        self.node = shutil.which("node") or "node"
        fake_bin = self.base / "fake-bin"
        fake_bin.mkdir()
        suffix = ".cmd" if os.name == "nt" else ""
        self.codex = fake_bin / f"codex{suffix}"
        self.claude = fake_bin / f"claude{suffix}"
        fake_codex(self.codex, self.base / "fake-codex.cjs")
        fake_claude(self.claude, self.base / "fake-claude.cjs")

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def run_helper(
        self,
        *extra: str,
        providers: str = "codex,antigravity,claude",
        expected: int = 0,
        timeout_ms: int = 15000,
    ) -> dict:
        command = [
            "node",
            str(HELPER),
            "--providers",
            providers,
            "--scope",
            "global",
            "--node",
            self.node,
            "--entry",
            str(self.entry),
            "--codex",
            str(self.codex),
            "--codex-home",
            str(self.codex_home),
            "--gemini-home",
            str(self.gemini),
            "--claude",
            str(self.claude),
            "--claude-config-dir",
            str(self.claude_config),
            "--workspace-root",
            str(self.workspace),
            "--provider-timeout-ms",
            str(timeout_ms),
            *extra,
        ]
        env = os.environ.copy()
        env.pop("CLAUDE_CONFIG_DIR", None)
        env["HOME"] = str(self.native_home)
        env["USERPROFILE"] = str(self.native_home)
        result = subprocess.run(command, cwd=ROOT, env=env, capture_output=True, text=True)
        self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
        return json.loads(result.stdout)

    def test_three_provider_global_apply_is_idempotent_and_uninstalls(self) -> None:
        first = self.run_helper("--apply")
        self.assertEqual(first["status"], "CONFIGURED_RESTART_REQUIRED")
        self.assertEqual(first["recovery"]["status"], "NOT_REQUIRED")
        self.assertTrue(all(item["changed"] for item in first["providers"]))

        second = self.run_helper("--apply")
        self.assertEqual(second["status"], "CONFIGURED_RESTART_REQUIRED")
        self.assertFalse(any(item["changed"] for item in second["providers"]))

        removed = self.run_helper("--apply", "--uninstall")
        self.assertEqual(removed["recovery"]["status"], "NOT_REQUIRED")
        self.assertTrue(all(item["changed"] for item in removed["providers"]))
        self.assertNotIn("[mcp_servers.afyx_graph]", (self.codex_home / "config.toml").read_text(encoding="utf-8"))
        antigravity_state = json.loads(
            (self.gemini / "config/mcp_config.json").read_text(encoding="utf-8")
        )
        self.assertFalse(antigravity_state.get("mcpServers"))
        claude_state = json.loads(
            (self.claude_config / ".claude.json").read_text(encoding="utf-8")
        )
        self.assertFalse(claude_state.get("mcpServers"))

    def test_missing_or_timed_out_cli_preserves_independent_provider_progress(self) -> None:
        original = self.codex
        self.codex = self.base / "missing-codex"
        missing = self.run_helper(
            "--apply", providers="antigravity,codex", expected=2
        )
        by_provider = {item["provider"]: item for item in missing["providers"]}
        self.assertEqual(missing["recovery"]["status"], "NOT_REQUIRED")
        self.assertEqual(by_provider["codex"]["reason"], "CODEX_UNAVAILABLE")
        self.assertEqual(by_provider["antigravity"]["status"], "CONFIGURED_RESTART_REQUIRED")
        self.assertTrue((self.gemini / "config/mcp_config.json").exists())

        self.codex = original
        self.codex_home.mkdir()
        (self.codex_home / "HANG").write_text("1", encoding="utf-8")
        timed_out = self.run_helper(
            "--apply",
            providers="antigravity,codex",
            expected=2,
            timeout_ms=50,
        )
        by_provider = {item["provider"]: item for item in timed_out["providers"]}
        self.assertEqual(by_provider["codex"]["reason"], "CODEX_TIMEOUT")
        self.assertEqual(by_provider["antigravity"]["status"], "CONFIGURED_RESTART_REQUIRED")
        self.assertTrue((self.gemini / "config/mcp_config.json").exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
