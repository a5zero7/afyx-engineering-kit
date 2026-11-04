#!/usr/bin/env python3
"""Isolated Claude Code ProviderAdapter tests; no owner configuration is used."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
HELPER = ROOT / "scripts/afyx-provider-integration.mjs"


def fake_server(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        """const readline=require('node:readline');
const lines=readline.createInterface({input:process.stdin});
lines.on('line',(line)=>{const m=JSON.parse(line);if(m.id===1)console.log(JSON.stringify({jsonrpc:'2.0',id:1,result:{protocolVersion:'2025-11-25',capabilities:{},serverInfo:{name:'afyx_graph',version:'1.0.0'}}}));if(m.id===2)console.log(JSON.stringify({jsonrpc:'2.0',id:2,result:{tools:[{name:'afyx_graph_explore'}]}}));});
""",
        encoding="utf-8",
    )


def fake_claude(path: Path, script: Path) -> None:
    script.write_text(
        r"""const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const args=process.argv.slice(2);
const overridden=Object.hasOwn(process.env,'CLAUDE_CONFIG_DIR');
const configDir=overridden?path.resolve(process.env.CLAUDE_CONFIG_DIR):path.join(os.homedir(),'.claude');
const userConfig=overridden?path.join(configDir,'.claude.json'):path.join(os.homedir(),'.claude.json');
const projectConfig=path.join(process.cwd(),'.mcp.json');
const sentinel=(name)=>fs.existsSync(path.join(configDir,name));
const pause=()=>{const end=Date.now()+2000;while(Date.now()<end){}};
const read=(file)=>fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};
const write=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');};
const scope=()=>{const index=args.indexOf('--scope');return index>=0?args[index+1]:'local';};
const fileFor=(value)=>value==='project'?projectConfig:userConfig;
const localEntry=(document,name)=>{
  for(const [project,value] of Object.entries(document.projects||{})){
    if(path.resolve(project)===path.resolve(process.cwd())&&value.mcpServers&&value.mcpServers[name])return value.mcpServers[name];
  }
  return null;
};
const effective=(name)=>{
  const state=read(userConfig);const project=read(projectConfig);
  const local=localEntry(state,name);if(local)return {name,scope:'local',entry:local};
  if(project.mcpServers&&project.mcpServers[name])return {name,scope:'project',entry:project.mcpServers[name]};
  if(state.mcpServers&&state.mcpServers[name])return {name,scope:'user',entry:state.mcpServers[name]};
  return null;
};
if(args[0]!=='mcp'){console.error('unsupported command');process.exit(64);}
if(sentinel('HANG'))pause();
if(args[1]==='get'){
  const name=args[2];
  if(sentinel('MISMATCH_GET')){console.log(JSON.stringify({name,scope:'user',entry:{type:'stdio',command:'foreign',args:[]}}));process.exit(0);}
  if(sentinel('UNPROVEN_GET')){console.log('afyx_graph exists');process.exit(0);}
  const found=effective(name);if(found){console.log(JSON.stringify(found));process.exit(0);}
  console.error('MCP server not found');process.exit(1);
}
if(args[1]==='add-json'){
  if(sentinel('FAIL_ADD')){
    const corrupt=path.join(configDir,'CORRUPT_PATH');
    if(fs.existsSync(corrupt))fs.appendFileSync(fs.readFileSync(corrupt,'utf8'),'\nforeign-concurrent-change');
    if(sentinel('DIRTY_FAIL'))write(userConfig,{mcpServers:{afyx_graph:{type:'stdio',command:'unproven',args:[]}}});
    console.error('injected add failure');process.exit(9);
  }
  const name=args[2];const entry=JSON.parse(args[3]);const file=fileFor(scope());const doc=read(file);doc.mcpServers ||= {};
  if(doc.mcpServers[name]){console.error('MCP server already exists');process.exit(2);}
  doc.mcpServers[name]=entry;write(file,doc);console.log('Added');process.exit(0);
}
if(args[1]==='remove'){
  if(sentinel('FAIL_REMOVE')){console.error('injected remove failure');process.exit(8);}
  const name=args[2];const file=fileFor(scope());const doc=read(file);
  if(!doc.mcpServers||!doc.mcpServers[name]){console.error('MCP server not found');process.exit(1);}
  delete doc.mcpServers[name];if(Object.keys(doc.mcpServers).length===0)delete doc.mcpServers;write(file,doc);console.log('Removed');process.exit(0);
}
console.error('unsupported mcp operation');process.exit(64);
""",
        encoding="utf-8",
    )
    node = shutil.which("node") or "node"
    if os.name == "nt":
        path.write_text(f'@"{node}" "{script}" %*\r\n', encoding="utf-8")
    else:
        path.write_text(f'#!/bin/sh\nexec "{node}" "{script}" "$@"\n', encoding="utf-8")
        path.chmod(0o755)


class ClaudeProviderIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.base = Path(self.temporary.name)
        self.claude_config = self.base / "claude-config"
        self.claude_config.mkdir()
        self.native_home = self.base / "native-home"
        self.native_home.mkdir()
        self.workspace = self.base / "workspace"
        self.workspace.mkdir()
        self.entry = self.base / "runtime/current/lib/dist/bin/afyx-graph.js"
        fake_server(self.entry)
        self.node = shutil.which("node") or "node"
        suffix = ".cmd" if os.name == "nt" else ""
        fake_bin = self.base / "fake-bin"
        fake_bin.mkdir()
        self.claude = fake_bin / f"claude{suffix}"
        fake_claude(self.claude, self.base / "fake-claude.cjs")

    def tearDown(self) -> None:
        self.temporary.cleanup()

    @property
    def user_config(self) -> Path:
        return self.claude_config / ".claude.json"

    @property
    def default_user_config(self) -> Path:
        return self.native_home / ".claude.json"

    @property
    def ownership(self) -> Path:
        return self.claude_config / ".afyx-provider-ownership.json"

    @property
    def expected_entry(self) -> dict:
        return {
            "type": "stdio",
            "command": str(Path(self.node).resolve()),
            "args": [str(self.entry.resolve()), "serve", "--mcp"],
        }

    def run_helper(
        self,
        *extra: str,
        expected: int = 0,
        providers: str = "claude",
        timeout_ms: int = 15000,
        config_override: bool = True,
    ) -> dict:
        command = [
            "node",
            str(HELPER),
            "--providers",
            providers,
            "--node",
            self.node,
            "--entry",
            str(self.entry),
            "--claude",
            str(self.claude),
            "--gemini-home",
            str(self.base / "gemini"),
            "--codex-home",
            str(self.base / "codex"),
            "--workspace-root",
            str(self.workspace),
            "--provider-timeout-ms",
            str(timeout_ms),
        ]
        if config_override:
            command.extend(["--claude-config-dir", str(self.claude_config)])
        command.extend(extra)
        env = os.environ.copy()
        env.pop("CLAUDE_CONFIG_DIR", None)
        env["HOME"] = str(self.native_home)
        env["USERPROFILE"] = str(self.native_home)
        result = subprocess.run(
            command, cwd=ROOT, env=env, capture_output=True, text=True
        )
        self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
        return json.loads(result.stdout)

    def test_capabilities_keep_cli_ide_instructions_and_skills_independent(self) -> None:
        script = f"""import {{providerAdapters}} from {json.dumps(HELPER.as_uri())};
const caller=providerAdapters.claude.discover({{host:{{detected:true,command:'claude',version:'1.0',evidence:'CALLER'}}}});
const filesystem=providerAdapters.claude.discover({{claude:process.execPath}});
const runtime=providerAdapters.claude.negotiate([{{capability:'surface:cli',verification:'RUNTIME'}},{{capability:'surface:ide',verification:'RUNTIME'}}],{{claude:process.execPath}});
console.log(JSON.stringify({{caller,filesystem,runtime}}));"""
        result = subprocess.run(
            ["node", "--input-type=module", "-e", script],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        payload = json.loads(result.stdout)
        caller = payload["caller"]
        by_id = {item["id"]: item for item in caller["capabilities"]}
        self.assertEqual(caller["surfaces"], ["cli", "ide"])
        self.assertEqual(caller["scopes"]["mcp"], ["global", "workspace"])
        self.assertEqual(caller["scopes"]["instructions"], ["global", "workspace"])
        self.assertTrue(by_id["instructions"]["declared"])
        self.assertTrue(by_id["skills"]["declared"])
        self.assertFalse(by_id["surface:cli"]["runtimeVerified"])
        self.assertFalse(by_id["surface:ide"]["runtimeVerified"])
        self.assertEqual(payload["filesystem"]["host"]["evidence"], "FILESYSTEM")
        self.assertFalse(payload["filesystem"]["host"]["runtimeVerified"])
        self.assertEqual(payload["runtime"]["status"], "UNVERIFIED")

    def test_global_plan_apply_verify_idempotency_and_uninstall(self) -> None:
        planned = self.run_helper("--scope", "global")
        self.assertEqual(planned["providers"][0]["nativeScope"], "user")
        self.assertEqual(planned["providers"][0]["action"], "CREATE")
        self.assertFalse(self.user_config.exists())
        self.assertFalse(self.ownership.exists())

        first = self.run_helper("--scope", "global", "--apply")
        self.assertEqual(first["status"], "READY")
        self.assertTrue(first["providers"][0]["changed"])
        document = json.loads(self.user_config.read_text(encoding="utf-8"))
        entry = document["mcpServers"]["afyx_graph"]
        self.assertEqual(entry["type"], "stdio")
        self.assertEqual(entry["args"][1:], ["serve", "--mcp"])

        second = self.run_helper("--scope", "global", "--apply")
        self.assertEqual(second["status"], "READY")
        self.assertFalse(second["providers"][0]["changed"])

        (self.claude_config / "HANG").write_text("1", encoding="utf-8")
        side_effect_free = self.run_helper("--scope", "global", timeout_ms=50)
        self.assertEqual(side_effect_free["providers"][0]["status"], "CONFIGURED")
        (self.claude_config / "HANG").unlink()

        removed = self.run_helper("--scope", "global", "--apply", "--uninstall")
        self.assertTrue(removed["providers"][0]["changed"])
        self.assertFalse(
            json.loads(self.user_config.read_text(encoding="utf-8")).get("mcpServers")
        )
        self.assertFalse(self.ownership.exists())

    def test_native_default_and_overridden_config_paths_are_distinct(self) -> None:
        overridden = self.run_helper("--scope", "global")
        self.assertEqual(
            Path(overridden["providers"][0]["configPath"]), self.user_config
        )

        native = self.run_helper(
            "--scope", "global", "--apply", config_override=False
        )
        self.assertEqual(native["status"], "READY")
        self.assertEqual(
            Path(native["providers"][0]["configPath"]), self.default_user_config
        )
        self.assertTrue(self.default_user_config.exists())
        self.assertFalse(self.user_config.exists())

    def test_higher_precedence_project_and_local_entries_block_user_ready(self) -> None:
        self.run_helper("--scope", "global", "--apply")
        user_before = self.user_config.read_bytes()
        foreign = {"type": "stdio", "command": "foreign", "args": []}

        project_config = self.workspace / ".mcp.json"
        project_config.write_text(
            json.dumps({"mcpServers": {"afyx_graph": foreign}}), encoding="utf-8"
        )
        project_blocked = self.run_helper(
            "--scope", "global", "--apply", expected=2
        )
        self.assertEqual(
            project_blocked["providers"][0]["reason"],
            "HIGHER_PRECEDENCE_ENTRY",
        )
        self.assertEqual(self.user_config.read_bytes(), user_before)

        project_config.unlink()
        state = json.loads(self.user_config.read_text(encoding="utf-8"))
        state["projects"] = {
            str(self.workspace.resolve()): {"mcpServers": {"afyx_graph": foreign}}
        }
        self.user_config.write_text(json.dumps(state), encoding="utf-8")
        local_before = self.user_config.read_bytes()
        local_blocked = self.run_helper(
            "--scope", "global", "--apply", expected=2
        )
        self.assertEqual(
            local_blocked["providers"][0]["reason"],
            "HIGHER_PRECEDENCE_ENTRY",
        )
        self.assertEqual(self.user_config.read_bytes(), local_before)

    def test_cli_success_mismatch_blocks_and_unparseable_identity_is_unverified(self) -> None:
        self.run_helper("--scope", "global", "--apply")
        config_before = self.user_config.read_bytes()
        (self.claude_config / "MISMATCH_GET").write_text("1", encoding="utf-8")
        mismatch = self.run_helper("--scope", "global", "--apply", expected=2)
        self.assertEqual(
            mismatch["providers"][0]["reason"],
            "CLAUDE_EFFECTIVE_ENTRY_MISMATCH",
        )
        self.assertEqual(self.user_config.read_bytes(), config_before)

        (self.claude_config / "MISMATCH_GET").unlink()
        (self.claude_config / "UNPROVEN_GET").write_text("1", encoding="utf-8")
        unproven = self.run_helper("--scope", "global", "--apply")
        self.assertEqual(unproven["status"], "PARTIAL")
        self.assertEqual(unproven["providers"][0]["status"], "UNVERIFIED")
        self.assertEqual(
            unproven["providers"][0]["reason"],
            "CLAUDE_EFFECTIVE_ENTRY_UNPROVEN",
        )

    def test_project_scope_preserves_unrelated_configuration(self) -> None:
        config = self.workspace / ".mcp.json"
        original = {"keep": {"owner": "user"}, "mcpServers": {"other": {"command": "other"}}}
        config.write_text(json.dumps(original), encoding="utf-8")
        applied = self.run_helper("--scope", "workspace", "--apply")
        self.assertEqual(applied["status"], "READY")
        self.assertEqual(applied["providers"][0]["nativeScope"], "project")
        after = json.loads(config.read_text(encoding="utf-8"))
        self.assertEqual(after["keep"], original["keep"])
        self.assertEqual(after["mcpServers"]["other"], original["mcpServers"]["other"])
        removed = self.run_helper("--scope", "workspace", "--apply", "--uninstall")
        self.assertTrue(removed["providers"][0]["changed"])
        self.assertEqual(json.loads(config.read_text(encoding="utf-8")), original)

    def test_foreign_unowned_and_malformed_configuration_fail_closed(self) -> None:
        foreign = {"preserve": True, "mcpServers": {"afyx_graph": {"command": "foreign", "args": []}}}
        self.user_config.write_text(json.dumps(foreign), encoding="utf-8")
        blocked = self.run_helper("--scope", "global", "--apply", expected=2)
        self.assertEqual(blocked["providers"][0]["reason"], "FOREIGN_ENTRY")
        self.assertEqual(json.loads(self.user_config.read_text(encoding="utf-8")), foreign)

        self.user_config.write_text(
            json.dumps({"mcpServers": {"afyx_graph": self.expected_entry}}),
            encoding="utf-8",
        )
        refused = self.run_helper("--scope", "global", "--apply", "--uninstall", expected=2)
        self.assertEqual(refused["providers"][0]["reason"], "UNOWNED_ENTRY")
        self.assertTrue(self.user_config.exists())

        self.user_config.write_text("not json\n", encoding="utf-8")
        malformed = self.run_helper("--scope", "global", expected=2)
        self.assertEqual(malformed["providers"][0]["reason"], "INSPECTION_FAILED")
        self.assertEqual(self.user_config.read_text(encoding="utf-8"), "not json\n")

    def test_failed_stale_update_rolls_back_exact_configuration_and_claim(self) -> None:
        self.run_helper("--scope", "global", "--apply")
        document = json.loads(self.user_config.read_text(encoding="utf-8"))
        marker = json.loads(self.ownership.read_text(encoding="utf-8"))
        stale = dict(document["mcpServers"]["afyx_graph"])
        stale["args"] = [str(self.base / "old/afyx-graph.js"), "serve", "--mcp"]
        document["mcpServers"]["afyx_graph"] = stale
        marker["entries"]["afyx_graph"]["entry"] = stale
        self.user_config.write_text(json.dumps(document), encoding="utf-8")
        self.ownership.write_text(json.dumps(marker), encoding="utf-8")
        config_before = self.user_config.read_bytes()
        marker_before = self.ownership.read_bytes()
        self.claude_config.mkdir(parents=True, exist_ok=True)
        (self.claude_config / "FAIL_ADD").write_text("1", encoding="utf-8")

        blocked = self.run_helper("--scope", "global", "--apply", expected=2)
        self.assertEqual(blocked["providers"][0]["reason"], "ROLLBACK_COMPLETED")
        self.assertEqual(self.user_config.read_bytes(), config_before)
        self.assertEqual(self.ownership.read_bytes(), marker_before)

    def test_missing_cli_and_timeout_are_bounded_without_persistent_mutation(self) -> None:
        missing = self.base / "missing-claude"
        original = self.claude
        self.claude = missing
        blocked = self.run_helper("--scope", "global", "--apply", expected=2)
        self.assertEqual(blocked["providers"][0]["reason"], "ROLLBACK_COMPLETED")
        self.assertFalse(self.user_config.exists())
        self.assertFalse(self.ownership.exists())

        self.claude = original
        self.claude_config.mkdir(parents=True, exist_ok=True)
        (self.claude_config / "HANG").write_text("1", encoding="utf-8")
        timed_out = self.run_helper("--scope", "global", "--apply", expected=2, timeout_ms=50)
        self.assertEqual(timed_out["providers"][0]["reason"], "ROLLBACK_COMPLETED")
        self.assertIn("timed out", timed_out["providers"][0]["detail"])
        self.assertFalse(self.user_config.exists())

    def test_three_provider_prevalidation_blocks_all_before_workspace_mutation(self) -> None:
        blocked = self.run_helper(
            "--scope",
            "workspace",
            "--apply",
            expected=2,
            providers="antigravity,claude,codex",
        )
        by_provider = {item["provider"]: item for item in blocked["providers"]}
        self.assertEqual(by_provider["codex"]["reason"], "SCOPE_UNSUPPORTED")
        self.assertEqual(by_provider["antigravity"]["reason"], "PREVALIDATION_FAILED")
        self.assertEqual(by_provider["claude"]["reason"], "PREVALIDATION_FAILED")
        self.assertFalse((self.workspace / ".mcp.json").exists())
        self.assertFalse((self.workspace / ".agents").exists())

    def test_later_provider_failure_rolls_back_earlier_owned_change(self) -> None:
        config = self.base / "gemini/config/mcp_config.json"
        config.parent.mkdir(parents=True)
        config.write_text('{\n  "theme": "owner-preserved"\n}\n', encoding="utf-8")
        config_before = config.read_bytes()
        (self.claude_config / "FAIL_ADD").write_text("1", encoding="utf-8")
        blocked = self.run_helper(
            "--scope",
            "global",
            "--apply",
            providers="antigravity,claude",
            expected=2,
        )
        by_provider = {item["provider"]: item for item in blocked["providers"]}
        self.assertEqual(blocked["recovery"]["status"], "RESTORED")
        self.assertEqual(by_provider["antigravity"]["reason"], "BATCH_ROLLED_BACK")
        self.assertFalse(by_provider["antigravity"]["changed"])
        self.assertEqual(by_provider["antigravity"]["recovery"]["status"], "RESTORED")
        self.assertEqual(config.read_bytes(), config_before)
        self.assertFalse((self.base / "gemini/config/mcp_config.json.afyx-ownership.json").exists())

    def test_concurrent_foreign_change_blocks_batch_rollback_without_overwrite(self) -> None:
        config = self.base / "gemini/config/mcp_config.json"
        (self.claude_config / "FAIL_ADD").write_text("1", encoding="utf-8")
        (self.claude_config / "CORRUPT_PATH").write_text(str(config), encoding="utf-8")
        blocked = self.run_helper(
            "--scope",
            "global",
            "--apply",
            providers="antigravity,claude",
            expected=2,
        )
        by_provider = {item["provider"]: item for item in blocked["providers"]}
        self.assertEqual(blocked["recovery"]["status"], "INCOMPLETE")
        self.assertEqual(
            by_provider["antigravity"]["reason"], "BATCH_ROLLBACK_INCOMPLETE"
        )
        self.assertTrue(by_provider["antigravity"]["changed"])
        self.assertIn(b"foreign-concurrent-change", config.read_bytes())

    def test_failed_provider_unproven_mutation_is_preserved_and_reported(self) -> None:
        (self.claude_config / "FAIL_ADD").write_text("1", encoding="utf-8")
        (self.claude_config / "DIRTY_FAIL").write_text("1", encoding="utf-8")
        blocked = self.run_helper(
            "--scope", "global", "--apply", expected=2, providers="claude"
        )
        provider = blocked["providers"][0]
        self.assertEqual(blocked["recovery"]["status"], "INCOMPLETE")
        self.assertEqual(provider["recovery"]["status"], "INCOMPLETE")
        self.assertTrue(provider["changed"])
        state = json.loads(self.user_config.read_text(encoding="utf-8"))
        self.assertEqual(
            state["mcpServers"]["afyx_graph"]["command"], "unproven"
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
