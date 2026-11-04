#!/usr/bin/env python3
"""AFYX-256 registration tests use only isolated CODEX_HOME fixtures."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
HELPER = ROOT / "scripts/afyx-mcp-integration.mjs"


def codex_path() -> str | None:
    return shutil.which("codex.exe") if os.name == "nt" else shutil.which("codex")


def fake_server(path: Path, healthy: bool = True) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if healthy:
        path.write_text(
            """const readline=require('node:readline');
const lines=readline.createInterface({input:process.stdin});
lines.on('line',(line)=>{const m=JSON.parse(line);if(m.id===1)console.log(JSON.stringify({jsonrpc:'2.0',id:1,result:{protocolVersion:'2025-11-25',capabilities:{},serverInfo:{name:'afyx_graph',version:'1.0.0'}}}));if(m.id===2)console.log(JSON.stringify({jsonrpc:'2.0',id:2,result:{tools:[{name:'afyx_graph_explore'}]}}));});
""",
            encoding="utf-8",
        )
    else:
        path.write_text("setTimeout(()=>{},30000);\n", encoding="utf-8")


class McpIntegrationTests(unittest.TestCase):
    @unittest.skipUnless(os.name == "nt", "Windows .cmd launcher regression")
    def test_missing_codex_home_plan_is_read_only_then_first_apply_succeeds(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            base = Path(raw)
            codex_home = base / "missing-codex-home"
            entry = base / "runtime/current/lib/dist/bin/afyx-graph.js"
            fake_server(entry)
            invocation = base / "codex-invoked"
            fake_codex = base / "fake-codex.mjs"
            fake_codex.write_text(
                """import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
writeFileSync(process.env.AFYX_FIXTURE_INVOCATION, 'invoked');
const home=process.env.CODEX_HOME;
const state=resolve(home,'fixture-state.json');
const config=resolve(home,'config.toml');
const [scope,action,name,...rest]=process.argv.slice(2);
if(scope!=='mcp'||name!=='afyx_graph') process.exit(9);
if(action==='get') {
  if(!existsSync(state)){console.error('MCP server afyx_graph not found');process.exit(1);}
  console.log(readFileSync(state,'utf8'));
} else if(action==='add') {
  const separator=rest.indexOf('--');
  const command=rest.slice(separator+1);
  mkdirSync(home,{recursive:true});
  writeFileSync(state,JSON.stringify({transport:{type:'stdio',command:command[0],args:command.slice(1)}}));
  writeFileSync(config,'[mcp_servers.afyx_graph]\\n');
} else process.exit(8);
""",
                encoding="utf-8",
            )
            launcher = base / "codex.cmd"
            launcher.write_text(
                f'@echo off\r\n"{shutil.which("node")}" "%~dp0fake-codex.mjs" %*\r\n',
                encoding="utf-8",
            )
            command = [
                "node", str(HELPER), "--node", shutil.which("node") or "node",
                "--entry", str(entry), "--codex", str(launcher), "--codex-home", str(codex_home),
            ]
            environment = {**os.environ, "AFYX_FIXTURE_INVOCATION": str(invocation)}

            planned = subprocess.run(command, cwd=ROOT, env=environment, capture_output=True, text=True)
            self.assertEqual(planned.returncode, 0, planned.stdout + planned.stderr)
            planned_payload = json.loads(planned.stdout)
            self.assertEqual(planned_payload["mcp"], "MCP_NOT_CONFIGURED")
            self.assertEqual(planned_payload["reason"], "MCP_ENTRY_NOT_FOUND")
            self.assertFalse(codex_home.exists())
            self.assertFalse(invocation.exists())

            applied = subprocess.run(command + ["--apply"], cwd=ROOT, env=environment, capture_output=True, text=True)
            self.assertEqual(applied.returncode, 0, applied.stdout + applied.stderr)
            self.assertEqual(json.loads(applied.stdout)["mcp"], "MCP_REACHABLE")
            self.assertTrue(codex_home.is_dir())
            self.assertTrue(invocation.is_file())

            repeated = subprocess.run(command + ["--apply"], cwd=ROOT, env=environment, capture_output=True, text=True)
            self.assertEqual(repeated.returncode, 0, repeated.stdout + repeated.stderr)
            repeated_payload = json.loads(repeated.stdout)
            self.assertEqual(repeated_payload["mcp"], "MCP_REACHABLE")
            self.assertFalse(repeated_payload["changed"])

    def test_symlinked_codex_configuration_boundary_is_refused(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            base = Path(raw)
            real_home = base / "real-codex-home"
            real_home.mkdir()
            linked_home = base / "linked-codex-home"
            try:
                linked_home.symlink_to(real_home, target_is_directory=True)
            except OSError as error:
                self.skipTest(f"symlink creation unavailable: {error}")
            entry = base / "runtime/current/lib/dist/bin/afyx-graph.js"
            fake_server(entry)
            suffix = ".cmd" if os.name == "nt" else ""
            codex = base / f"codex{suffix}"
            if os.name == "nt":
                codex.write_text("@exit /b 0\r\n", encoding="utf-8")
            else:
                codex.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
                codex.chmod(0o755)
            result = subprocess.run(
                [
                    "node",
                    str(HELPER),
                    "--node",
                    shutil.which("node") or "node",
                    "--entry",
                    str(entry),
                    "--codex",
                    str(codex),
                    "--codex-home",
                    str(linked_home),
                ],
                cwd=ROOT,
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
            payload = json.loads(result.stdout)
            self.assertEqual(payload["reason"], "CODEX_PATH_UNSAFE")
            self.assertFalse((real_home / "config.toml").exists())

    def test_probe_isolates_caller_state_and_working_directory(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            base = Path(raw)
            entry = base / "runtime/current/lib/dist/bin/afyx-graph.js"
            entry.parent.mkdir(parents=True)
            entry.write_text(
                """const readline=require('node:readline');
if(process.env.AFYX_GRAPH_STATE_DIR || process.env.AFYX_GRAPH_NO_DAEMON!=='1' || process.env.AFYX_GRAPH_NO_WATCH!=='1' || process.env.NODE_DISABLE_COMPILE_CACHE!=='1' || !require('node:path').basename(process.cwd()).startsWith('afyx-mcp-probe-')) process.exit(23);
const lines=readline.createInterface({input:process.stdin});
lines.on('line',(line)=>{const m=JSON.parse(line);if(m.id===1)console.log(JSON.stringify({jsonrpc:'2.0',id:1,result:{protocolVersion:'2025-11-25',capabilities:{},serverInfo:{name:'afyx_graph',version:'1.0.0'}}}));if(m.id===2)console.log(JSON.stringify({jsonrpc:'2.0',id:2,result:{tools:[{name:'afyx_graph_explore'}]}}));});
""",
                encoding="utf-8",
            )
            script = (
                f"import {{probeMcp}} from {json.dumps(HELPER.as_uri())};"
                f"console.log(JSON.stringify(await probeMcp(process.execPath,{json.dumps(str(entry))})));"
            )
            result = subprocess.run(
                ["node", "--input-type=module", "-e", script],
                cwd=ROOT,
                env={**os.environ, "AFYX_GRAPH_STATE_DIR": str(ROOT.parent)},
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertTrue(json.loads(result.stdout)["ok"])

    def test_classifier_distinguishes_current_stale_and_conflict(self) -> None:
        expected = {"node": "C:/node/node.exe", "entry": "C:/runtime/current/lib/dist/bin/afyx-graph.js"}
        script = f"""import {{classifyEntry}} from {json.dumps(HELPER.as_uri())};
const expected={json.dumps(expected)};
const current={{transport:{{type:'stdio',command:'C:/node/node.exe',args:[expected.entry,'serve','--mcp']}}}};
const equivalent={{transport:{{type:'stdio',command:'node',args:[expected.entry,'serve','--mcp']}}}};
const stale={{transport:{{type:'stdio',command:'node',args:['C:/old/lib/dist/bin/afyx-graph.js','serve','--mcp']}}}};
const conflict={{transport:{{type:'stdio',command:'python',args:['other.py']}}}};
console.log(JSON.stringify([classifyEntry(null,expected),classifyEntry(current,expected),classifyEntry(equivalent,expected),classifyEntry(stale,expected),classifyEntry(conflict,expected)]));"""
        result = subprocess.run(["node", "--input-type=module", "-e", script], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(json.loads(result.stdout), ["MCP_NOT_CONFIGURED", "MCP_CONFIGURED", "MCP_CONFIGURED", "MCP_STALE_OWNED", "MCP_BLOCKED"])

    @unittest.skipUnless(os.name == "nt", "Windows .cmd launcher regression")
    def test_windows_cmd_launcher_preserves_arguments_and_is_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            launcher_dir = base / "launcher & shim"
            launcher_dir.mkdir()
            codex_home = base / "codex home"
            entry = base / "runtime with spaces/current/lib/dist/bin/afyx-graph.js"
            fake_server(entry)

            fake_codex = launcher_dir / "fake-codex.mjs"
            fake_codex.write_text(
                """import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const home = process.env.CODEX_HOME;
const state = resolve(home, 'fixture-state.json');
const config = resolve(home, 'config.toml');
const rejectAdd = resolve(home, 'reject-add');
const [scope, action, name, ...rest] = process.argv.slice(2);
if (scope !== 'mcp' || name !== 'afyx_graph') process.exit(9);
if (action === 'get') {
  if (!existsSync(state)) { console.error('MCP server afyx_graph not found'); process.exit(1); }
  console.log(readFileSync(state, 'utf8'));
} else if (action === 'add') {
  if (existsSync(rejectAdd)) { console.error('synthetic registration rejection'); process.exit(7); }
  const separator = rest.indexOf('--');
  const command = rest.slice(separator + 1);
  mkdirSync(home, { recursive: true });
  writeFileSync(state, JSON.stringify({ transport: { type: 'stdio', command: command[0], args: command.slice(1) } }));
  writeFileSync(config, '[mcp_servers.afyx_graph]\\n');
} else if (action === 'remove') {
  rmSync(state, { force: true });
  rmSync(config, { force: true });
} else {
  process.exit(8);
}
""",
                encoding="utf-8",
            )
            launcher = launcher_dir / "codex.cmd"
            launcher.write_text(
                f'@echo off\r\n"{shutil.which("node")}" "%~dp0fake-codex.mjs" %*\r\n',
                encoding="utf-8",
            )
            command = [
                "node", str(HELPER),
                "--node", shutil.which("node") or "node",
                "--entry", str(entry),
                "--codex", str(launcher),
                "--codex-home", str(codex_home),
                "--apply",
            ]

            offered = subprocess.run(command[:-1], cwd=ROOT, capture_output=True, text=True)
            self.assertEqual(offered.returncode, 0, offered.stdout + offered.stderr)
            offered_payload = json.loads(offered.stdout)
            self.assertEqual(offered_payload["mcp"], "MCP_NOT_CONFIGURED")
            self.assertEqual(offered_payload["reason"], "MCP_ENTRY_NOT_FOUND")

            first = subprocess.run(command, cwd=ROOT, capture_output=True, text=True)
            self.assertEqual(first.returncode, 0, first.stdout + first.stderr)
            first_payload = json.loads(first.stdout)
            self.assertEqual(first_payload["graph"], "GRAPH_INSTALLED")
            self.assertEqual(first_payload["mcp"], "MCP_REACHABLE")
            self.assertEqual(first_payload["reason"], "")
            self.assertTrue(first_payload["changed"])
            state = json.loads((codex_home / "fixture-state.json").read_text(encoding="utf-8"))
            self.assertEqual(state["transport"]["command"], shutil.which("node"))
            self.assertEqual(state["transport"]["args"], [str(entry), "serve", "--mcp"])

            second = subprocess.run(command, cwd=ROOT, capture_output=True, text=True)
            self.assertEqual(second.returncode, 0, second.stdout + second.stderr)
            self.assertEqual(json.loads(second.stdout)["mcp"], "MCP_REACHABLE")
            self.assertFalse(json.loads(second.stdout)["changed"])

            removed = subprocess.run(command + ["--uninstall"], cwd=ROOT, capture_output=True, text=True)
            self.assertEqual(removed.returncode, 0, removed.stdout + removed.stderr)
            self.assertEqual(json.loads(removed.stdout)["mcp"], "MCP_NOT_CONFIGURED")
            self.assertTrue(json.loads(removed.stdout)["changed"])
            self.assertFalse((codex_home / ".afyx-provider-ownership.json").exists())
            restored = subprocess.run(command, cwd=ROOT, capture_output=True, text=True)
            self.assertEqual(restored.returncode, 0, restored.stdout + restored.stderr)

            (codex_home / "fixture-state.json").write_text("not json", encoding="utf-8")
            invalid = subprocess.run(command, cwd=ROOT, capture_output=True, text=True)
            self.assertEqual(invalid.returncode, 2, invalid.stdout + invalid.stderr)
            invalid_payload = json.loads(invalid.stdout)
            self.assertEqual(invalid_payload["graph"], "GRAPH_INSTALLED")
            self.assertEqual(invalid_payload["reason"], "MCP_INVALID_CONFIGURATION")

            (codex_home / "fixture-state.json").unlink()
            (codex_home / "reject-add").write_text("reject", encoding="utf-8")
            rejected = subprocess.run(command, cwd=ROOT, capture_output=True, text=True)
            self.assertEqual(rejected.returncode, 2, rejected.stdout + rejected.stderr)
            rejected_payload = json.loads(rejected.stdout)
            self.assertEqual(rejected_payload["graph"], "GRAPH_INSTALLED")
            self.assertEqual(rejected_payload["reason"], "MCP_REGISTRATION_FAILED")
            self.assertIn("synthetic registration rejection", rejected_payload["detail"])

            bad_launcher = base / "invalid-codex.exe"
            bad_launcher.write_text("not an executable", encoding="utf-8")
            launch_command = command.copy()
            launch_command[launch_command.index(str(launcher))] = str(bad_launcher)
            launch_failed = subprocess.run(launch_command, cwd=ROOT, capture_output=True, text=True)
            self.assertEqual(launch_failed.returncode, 2, launch_failed.stdout + launch_failed.stderr)
            launch_payload = json.loads(launch_failed.stdout)
            self.assertEqual(launch_payload["graph"], "GRAPH_INSTALLED")
            self.assertEqual(launch_payload["reason"], "CODEX_LAUNCH_FAILED")

    @unittest.skipUnless(codex_path(), "Codex CLI unavailable on this runner")
    def test_native_registration_is_idempotent_and_preserves_unrelated_config(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            base = Path(raw)
            codex_home = base / "codex"
            codex_home.mkdir()
            config = codex_home / "config.toml"
            unrelated_server = "code" + "graph"
            original = f'model = "fixture-model"\n\n[mcp_servers.{unrelated_server}]\ncommand = "node"\nargs = ["{unrelated_server}.js"]\nenabled = false\n\n[mcp_servers.headroom]\nurl = "http://127.0.0.1:9999/mcp"\n'
            config.write_text(original, encoding="utf-8")
            entry = base / "runtime/current/lib/dist/bin/afyx-graph.js"
            fake_server(entry)
            command = [
                "node", str(HELPER), "--node", shutil.which("node") or "node", "--entry", str(entry),
                "--codex", codex_path() or "codex", "--codex-home", str(codex_home), "--apply",
            ]
            offered = subprocess.run(command[:-1], cwd=ROOT, capture_output=True, text=True)
            self.assertEqual(offered.returncode, 0, offered.stdout + offered.stderr)
            self.assertEqual(json.loads(offered.stdout)["mcp"], "MCP_NOT_CONFIGURED")
            self.assertEqual(config.read_text(encoding="utf-8"), original)

            first = subprocess.run(command, cwd=ROOT, capture_output=True, text=True)
            self.assertEqual(first.returncode, 0, first.stdout + first.stderr)
            self.assertEqual(json.loads(first.stdout)["mcp"], "MCP_REACHABLE")
            self.assertTrue(json.loads(first.stdout)["changed"])
            after = config.read_text(encoding="utf-8")
            self.assertIn('model = "fixture-model"', after)
            self.assertIn(f"[mcp_servers.{unrelated_server}]", after)
            self.assertIn("enabled = false", after)
            self.assertIn("[mcp_servers.headroom]", after)
            self.assertEqual(after.count("[mcp_servers.afyx_graph]"), 1)

            second = subprocess.run(command, cwd=ROOT, capture_output=True, text=True)
            self.assertEqual(second.returncode, 0, second.stdout + second.stderr)
            self.assertFalse(json.loads(second.stdout)["changed"])
            self.assertEqual(config.read_text(encoding="utf-8").count("[mcp_servers.afyx_graph]"), 1)

            stale_entry = base / "old/current/lib/dist/bin/afyx-graph.js"
            fake_server(stale_entry)
            subprocess.run(
                [codex_path() or "codex", "mcp", "remove", "afyx_graph"],
                env={**os.environ, "CODEX_HOME": str(codex_home)}, check=True, capture_output=True, text=True,
            )
            subprocess.run(
                [codex_path() or "codex", "mcp", "add", "afyx_graph", "--", shutil.which("node") or "node", str(stale_entry), "serve", "--mcp"],
                env={**os.environ, "CODEX_HOME": str(codex_home)}, check=True, capture_output=True, text=True,
            )
            stale = subprocess.run(command, cwd=ROOT, capture_output=True, text=True)
            self.assertEqual(stale.returncode, 0, stale.stdout + stale.stderr)
            self.assertTrue(json.loads(stale.stdout)["changed"])
            self.assertEqual(json.loads(stale.stdout)["mcp"], "MCP_REACHABLE")
            self.assertIn("enabled = false", config.read_text(encoding="utf-8"))

            subprocess.run(
                [codex_path() or "codex", "mcp", "remove", "afyx_graph"],
                env={**os.environ, "CODEX_HOME": str(codex_home)}, check=True, capture_output=True, text=True,
            )
            subprocess.run(
                [codex_path() or "codex", "mcp", "add", "afyx_graph", "--", "python", "other.py"],
                env={**os.environ, "CODEX_HOME": str(codex_home)}, check=True, capture_output=True, text=True,
            )
            conflict_before = config.read_text(encoding="utf-8")
            conflict = subprocess.run(command, cwd=ROOT, capture_output=True, text=True)
            self.assertEqual(conflict.returncode, 2)
            self.assertEqual(json.loads(conflict.stdout)["mcp"], "MCP_BLOCKED")
            self.assertEqual(config.read_text(encoding="utf-8"), conflict_before)

    @unittest.skipUnless(codex_path(), "Codex CLI unavailable on this runner")
    def test_configured_server_reports_failed_handshake_without_rewriting_config(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            base = Path(raw)
            codex_home = base / "codex"
            codex_home.mkdir()
            entry = base / "runtime/current/lib/dist/bin/afyx-graph.js"
            fake_server(entry, healthy=False)
            codex = codex_path() or "codex"
            subprocess.run(
                [codex, "mcp", "add", "afyx_graph", "--", shutil.which("node") or "node", str(entry), "serve", "--mcp"],
                env={**os.environ, "CODEX_HOME": str(codex_home)}, check=True, capture_output=True, text=True,
            )
            config = codex_home / "config.toml"
            before = config.read_text(encoding="utf-8")
            result = subprocess.run([
                "node", str(HELPER), "--node", shutil.which("node") or "node", "--entry", str(entry),
                "--codex", codex, "--codex-home", str(codex_home),
            ], cwd=ROOT, env={**os.environ, "AFYX_MCP_HANDSHAKE_TIMEOUT_MS": "250"}, capture_output=True, text=True)
            self.assertEqual(result.returncode, 2)
            self.assertEqual(json.loads(result.stdout)["mcp"], "MCP_HANDSHAKE_FAILED")
            self.assertEqual(config.read_text(encoding="utf-8"), before)

    def test_missing_codex_is_optional_and_non_destructive(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            base = Path(raw)
            entry = base / "runtime/current/lib/dist/bin/afyx-graph.js"
            fake_server(entry)
            result = subprocess.run([
                "node", str(HELPER), "--node", shutil.which("node") or "node", "--entry", str(entry),
                "--codex", str(base / "missing-codex"), "--codex-home", str(base / "codex"), "--apply",
            ], capture_output=True, text=True)
            self.assertEqual(result.returncode, 2)
            payload = json.loads(result.stdout)
            self.assertEqual(payload["graph"], "GRAPH_INSTALLED")
            self.assertEqual(payload["cli"], "CLI_REACHABLE")
            self.assertEqual(payload["mcp"], "MCP_BLOCKED")
            self.assertFalse((base / "codex/config.toml").exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
