#!/usr/bin/env python3
"""Isolated multi-provider lifecycle tests; no live host configuration is used."""

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

try:
    from test_unified_installer import UnifiedInstallerIntegrationTests
except ImportError:
    from scripts.tests.test_unified_installer import UnifiedInstallerIntegrationTests
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


class ProviderIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.base = Path(self.temporary.name)
        self.gemini = self.base / "gemini"
        self.workspace = self.base / "workspace"
        self.entry = self.base / "runtime/current/lib/dist/bin/afyx-graph.js"
        fake_server(self.entry)
        self.node = shutil.which("node") or "node"

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def run_helper(
        self, *extra: str, expected: int = 0, providers: str = "antigravity"
    ) -> dict:
        command = [
            "node", str(HELPER), "--providers", providers,
            "--node", self.node, "--entry", str(self.entry),
            "--gemini-home", str(self.gemini), "--workspace-root", str(self.workspace),
            *extra,
        ]
        result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
        return json.loads(result.stdout)

    def test_versioned_adapter_contract_exposes_only_accepted_providers(self) -> None:
        script = f"""import {{PROVIDER_ADAPTER_CONTRACT,providerAdapters}} from {json.dumps(HELPER.as_uri())};
const methods=['inspect','plan','apply','verify','uninstall'];
console.log(JSON.stringify({{
  contract:PROVIDER_ADAPTER_CONTRACT,
  providers:Object.keys(providerAdapters),
  methods:Object.fromEntries(Object.entries(providerAdapters).map(([id,adapter])=>[id,methods.every((name)=>typeof adapter[name]==='function')])),
  scopes:Object.fromEntries(Object.entries(providerAdapters).map(([id,adapter])=>[id,adapter.capabilities.scopes])),
}}));"""
        result = subprocess.run(
            ["node", "--input-type=module", "-e", script],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["contract"]["name"], "ProviderAdapter")
        self.assertEqual(payload["contract"]["version"], 1)
        self.assertEqual(
            payload["contract"]["operations"],
            ["inspect", "plan", "apply", "verify", "uninstall"],
        )
        self.assertEqual(payload["providers"], ["codex", "antigravity", "claude"])
        self.assertEqual(
            payload["methods"],
            {"codex": True, "antigravity": True, "claude": True},
        )
        self.assertEqual(
            payload["scopes"],
            {
                "codex": ["global"],
                "antigravity": ["global", "workspace"],
                "claude": ["global", "workspace"],
            },
        )

    def test_capability_discovery_is_deterministic_read_only_and_evidence_aware(self) -> None:
        config = self.gemini / "config/mcp_config.json"
        config.parent.mkdir(parents=True)
        config.write_text(json.dumps({"preserve": True}), encoding="utf-8")
        before = config.read_bytes()
        script = f"""import {{providerAdapters}} from {json.dumps(HELPER.as_uri())};
const options={{geminiHome:{json.dumps(str(self.gemini))},host:{{detected:true,command:'agy',version:'1.2.3',evidence:'CALLER'}}}};
const first=providerAdapters.antigravity.discover(options);
const second=providerAdapters.antigravity.discover(options);
const declared=providerAdapters.antigravity.negotiate([{{capability:'mcp'}}],options);
const runtime=providerAdapters.antigravity.negotiate([{{capability:'mcp',verification:'RUNTIME'}}],options);
console.log(JSON.stringify({{first,declared,runtime,deterministic:JSON.stringify(first)===JSON.stringify(second)}}));"""
        result = subprocess.run(
            ["node", "--input-type=module", "-e", script], cwd=ROOT,
            capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        payload = json.loads(result.stdout)
        discovery = payload["first"]
        by_capability = {item["id"]: item for item in discovery["capabilities"]}
        self.assertTrue(payload["deterministic"])
        self.assertEqual(discovery["contract"], "ProviderCapability/v1")
        self.assertEqual(discovery["provider"]["id"], "antigravity")
        self.assertEqual(discovery["host"]["version"], "1.2.3")
        self.assertEqual(discovery["surfaces"], ["cli", "ide"])
        self.assertEqual(discovery["scopes"]["mcp"], ["global", "workspace"])
        self.assertEqual(
            discovery["scopes"]["skills"],
            ["ide-global", "cli-global", "workspace"],
        )
        self.assertEqual(discovery["acceptance"], "NOT_RUN")
        self.assertFalse(discovery["mutationAuthorized"])
        self.assertEqual(by_capability["mcp"]["status"], "SUPPORTED")
        self.assertFalse(by_capability["mcp"]["runtimeVerified"])
        self.assertEqual(by_capability["surface:cli"]["status"], "UNVERIFIED")
        self.assertFalse(by_capability["surface:cli"]["runtimeVerified"])
        self.assertTrue(by_capability["surface:cli"]["declared"])
        self.assertEqual(by_capability["surface:ide"]["status"], "UNVERIFIED")
        self.assertEqual(by_capability["scope:ide-global"]["status"], "SUPPORTED")
        self.assertEqual(payload["declared"]["status"], "SUPPORTED")
        self.assertEqual(payload["runtime"]["status"], "UNVERIFIED")
        self.assertFalse(payload["declared"]["mutationAuthorized"])
        self.assertEqual(config.read_bytes(), before)

    def test_existing_host_path_is_presence_evidence_not_runtime_verification(self) -> None:
        script = f"""import {{providerAdapters}} from {json.dumps(HELPER.as_uri())};
const discovery=providerAdapters.codex.discover({{codex:process.execPath}});
const cli=discovery.capabilities.find((item)=>item.id==='surface:cli');
const negotiation=providerAdapters.codex.negotiate([{{capability:'surface:cli',verification:'RUNTIME'}}],{{codex:process.execPath}});
console.log(JSON.stringify({{discovery,cli,negotiation}}));"""
        result = subprocess.run(
            ["node", "--input-type=module", "-e", script], cwd=ROOT,
            capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        payload = json.loads(result.stdout)
        self.assertTrue(payload["discovery"]["host"]["detected"])
        self.assertEqual(payload["discovery"]["host"]["evidence"], "FILESYSTEM")
        self.assertEqual(payload["discovery"]["host"]["status"], "UNVERIFIED")
        self.assertFalse(payload["discovery"]["host"]["runtimeVerified"])
        self.assertEqual(payload["cli"]["status"], "UNVERIFIED")
        self.assertFalse(payload["cli"]["runtimeVerified"])
        self.assertEqual(payload["negotiation"]["status"], "UNVERIFIED")
        self.assertFalse(payload["negotiation"]["mutationAuthorized"])

    def test_capability_negotiation_fails_closed_for_missing_unsupported_and_unknown(self) -> None:
        missing_codex = self.base / "missing-codex"
        script = f"""import {{providerAdapters}} from {json.dumps(HELPER.as_uri())};
const missing=providerAdapters.codex.discover({{codex:{json.dumps(str(missing_codex))}}});
const blocked=providerAdapters.codex.negotiate([{{capability:'mcp',verification:'RUNTIME'}}],{{codex:{json.dumps(str(missing_codex))}}});
const unsupported=providerAdapters.antigravity.negotiate([{{capability:'hooks'}}],{{host:{{detected:true,command:'agy',evidence:'CALLER'}}}});
const unknown=providerAdapters.antigravity.negotiate([{{capability:'model-routing'}}],{{host:{{detected:true,command:'agy',evidence:'CALLER'}}}});
const malformed=providerAdapters.codex.discover({{host:{{detected:'yes',command:'codex'}}}});
console.log(JSON.stringify({{missing,blocked,unsupported,unknown,malformed}}));"""
        result = subprocess.run(
            ["node", "--input-type=module", "-e", script], cwd=ROOT,
            capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["missing"]["status"], "BLOCKED")
        self.assertEqual(payload["blocked"]["status"], "BLOCKED")
        self.assertEqual(payload["unsupported"]["status"], "UNSUPPORTED")
        self.assertEqual(payload["unknown"]["status"], "BLOCKED")
        self.assertEqual(payload["malformed"]["status"], "BLOCKED")
        self.assertEqual(
            payload["malformed"]["diagnostics"][0]["code"],
            "MALFORMED_CAPABILITY_METADATA",
        )
        for result_payload in (
            payload["blocked"], payload["unsupported"], payload["unknown"]
        ):
            self.assertFalse(result_payload["mutationAuthorized"])

    def test_codex_plan_is_side_effect_free_and_unknown_provider_fails_closed(self) -> None:
        codex_home = self.base / "codex-plan"
        unknown_home = self.base / "unknown-plan"
        if os.name == "nt":
            fake_codex = self.base / "fake-codex.cmd"
            fake_codex.write_text(
                "@echo MCP server afyx_graph not found 1>&2\r\n@exit /b 1\r\n",
                encoding="utf-8",
            )
        else:
            fake_codex = self.base / "fake-codex"
            fake_codex.write_text(
                "#!/bin/sh\necho 'MCP server afyx_graph not found' >&2\nexit 1\n",
                encoding="utf-8",
            )
            fake_codex.chmod(0o755)
        script = f"""import {{providerAdapters,runProviderLifecycle}} from {json.dumps(HELPER.as_uri())};
const options={{scope:'global',node:process.execPath,entry:{json.dumps(str(self.entry))},codex:{json.dumps(str(fake_codex))},codexHome:{json.dumps(str(codex_home))},geminiHome:{json.dumps(str(self.gemini))},workspaceRoot:{json.dumps(str(self.workspace))}}};
const planned=await providerAdapters.codex.plan(options);
const unknown=await runProviderLifecycle({{...options,providers:['future-provider'],codexHome:{json.dumps(str(unknown_home))}}});
console.log(JSON.stringify({{planned,unknown}}));"""
        result = subprocess.run(
            ["node", "--input-type=module", "-e", script],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["planned"]["status"], "DETECTED")
        self.assertEqual(payload["planned"]["reason"], "MCP_ENTRY_NOT_FOUND")
        self.assertFalse(codex_home.exists())
        self.assertEqual(payload["unknown"]["status"], "BLOCKED")
        self.assertEqual(payload["unknown"]["providers"][0]["status"], "BLOCKED")
        self.assertEqual(payload["unknown"]["providers"][0]["reason"], "UNKNOWN_PROVIDER")
        self.assertFalse(unknown_home.exists())

    def assert_unknown_provider_prevalidation_preserves_configuration(
        self, providers: str
    ) -> None:
        blocked = self.run_helper(
            "--scope", "global", "--apply", expected=2, providers=providers
        )
        self.assertEqual(blocked["status"], "BLOCKED")
        by_provider = {item["provider"]: item for item in blocked["providers"]}
        self.assertEqual(by_provider["future-provider"]["reason"], "UNKNOWN_PROVIDER")
        self.assertFalse(by_provider["future-provider"]["changed"])
        self.assertEqual(
            by_provider["antigravity"]["reason"], "PREVALIDATION_FAILED"
        )
        self.assertFalse(by_provider["antigravity"]["changed"])
        self.assertFalse(self.gemini.exists())

    def test_unknown_provider_after_accepted_provider_blocks_before_apply(self) -> None:
        self.assert_unknown_provider_prevalidation_preserves_configuration(
            "antigravity,future-provider"
        )

    def test_unknown_provider_before_accepted_provider_blocks_before_apply(self) -> None:
        self.assert_unknown_provider_prevalidation_preserves_configuration(
            "future-provider,antigravity"
        )

    def test_unsupported_scope_blocks_all_providers_before_apply(self) -> None:
        blocked = self.run_helper(
            "--scope",
            "workspace",
            "--apply",
            expected=2,
            providers="antigravity,codex",
        )
        self.assertEqual(blocked["status"], "BLOCKED")
        by_provider = {item["provider"]: item for item in blocked["providers"]}
        self.assertEqual(
            by_provider["antigravity"]["reason"], "PREVALIDATION_FAILED"
        )
        self.assertEqual(by_provider["codex"]["status"], "INCOMPATIBLE")
        self.assertEqual(by_provider["codex"]["reason"], "SCOPE_UNSUPPORTED")
        self.assertFalse(self.workspace.exists())

    def test_unknown_provider_blocks_owned_uninstall_without_mutation(self) -> None:
        self.run_helper("--scope", "global", "--apply")
        config = self.gemini / "config/mcp_config.json"
        ownership = Path(f"{config}.afyx-ownership.json")
        config_before = config.read_bytes()
        ownership_before = ownership.read_bytes()

        blocked = self.run_helper(
            "--scope",
            "global",
            "--apply",
            "--uninstall",
            expected=2,
            providers="antigravity,future-provider",
        )
        self.assertEqual(blocked["status"], "BLOCKED")
        self.assertEqual(config.read_bytes(), config_before)
        self.assertEqual(ownership.read_bytes(), ownership_before)

    def test_global_plan_is_side_effect_free_then_apply_is_idempotent(self) -> None:
        planned = self.run_helper("--scope", "global")
        self.assertEqual(planned["status"], "PARTIAL")
        self.assertEqual(planned["providers"][0]["action"], "CREATE")
        self.assertFalse(self.gemini.exists())

        first = self.run_helper("--scope", "global", "--apply")
        self.assertEqual(first["status"], "CONFIGURED_RESTART_REQUIRED")
        self.assertTrue(first["providers"][0]["changed"])
        config = self.gemini / "config/mcp_config.json"
        document = json.loads(config.read_text(encoding="utf-8"))
        self.assertEqual(os.path.normcase(document["mcpServers"]["afyx_graph"]["command"]), os.path.normcase(str(Path(self.node).resolve())))
        self.assertEqual(os.path.normcase(document["mcpServers"]["afyx_graph"]["args"][0]), os.path.normcase(str(self.entry.resolve())))
        self.assertEqual(document["mcpServers"]["afyx_graph"]["args"][1:], ["serve", "--mcp"])

        second = self.run_helper("--scope", "global", "--apply")
        self.assertFalse(second["providers"][0]["changed"])
        self.assertEqual(second["providers"][0]["status"], "CONFIGURED_RESTART_REQUIRED")

    def test_workspace_preserves_unrelated_config_and_uninstalls_only_owned_entry(self) -> None:
        config = self.workspace / ".agents/mcp_config.json"
        config.parent.mkdir(parents=True)
        original = {"theme": "preserve", "mcpServers": {"other": {"command": "other"}}}
        config.write_text(json.dumps(original), encoding="utf-8")

        applied = self.run_helper("--scope", "workspace", "--apply")
        self.assertEqual(applied["status"], "READY")
        after = json.loads(config.read_text(encoding="utf-8"))
        self.assertEqual(after["theme"], "preserve")
        self.assertEqual(after["mcpServers"]["other"], {"command": "other"})

        removed = self.run_helper("--scope", "workspace", "--apply", "--uninstall")
        self.assertTrue(removed["providers"][0]["changed"])
        self.assertEqual(json.loads(config.read_text(encoding="utf-8")), original)

    def test_foreign_and_matching_unowned_entries_are_never_replaced_or_removed(self) -> None:
        config = self.gemini / "config/mcp_config.json"
        config.parent.mkdir(parents=True)
        foreign = {"mcpServers": {"afyx_graph": {"command": "python", "args": ["foreign.py"]}}}
        config.write_text(json.dumps(foreign), encoding="utf-8")
        blocked = self.run_helper("--scope", "global", "--apply", expected=2)
        self.assertEqual(blocked["providers"][0]["reason"], "FOREIGN_ENTRY")
        self.assertEqual(json.loads(config.read_text(encoding="utf-8")), foreign)

        matching = {"mcpServers": {"afyx_graph": {"command": str(Path(self.node).resolve()), "args": [str(self.entry.resolve()), "serve", "--mcp"]}}}
        config.write_text(json.dumps(matching), encoding="utf-8")
        verified = self.run_helper("--scope", "global", "--apply")
        self.assertFalse(verified["providers"][0]["changed"])
        self.assertEqual(verified["providers"][0]["state"], "MCP_CONFIGURED_UNOWNED")
        refused = self.run_helper("--scope", "global", "--apply", "--uninstall", expected=2)
        self.assertEqual(refused["providers"][0]["reason"], "UNOWNED_ENTRY")
        self.assertEqual(json.loads(config.read_text(encoding="utf-8")), matching)

    def test_owned_stale_entry_updates_but_tampered_claim_fails_closed(self) -> None:
        self.run_helper("--scope", "workspace", "--apply")
        config = self.workspace / ".agents/mcp_config.json"
        document = json.loads(config.read_text(encoding="utf-8"))
        document["mcpServers"]["afyx_graph"]["args"][0] = str(self.base / "old/afyx-graph.js")
        config.write_text(json.dumps(document), encoding="utf-8")
        blocked = self.run_helper("--scope", "workspace", "--apply", expected=2)
        self.assertEqual(blocked["providers"][0]["reason"], "FOREIGN_ENTRY")

    def test_invalid_json_fails_closed_without_rewrite(self) -> None:
        config = self.gemini / "config/mcp_config.json"
        config.parent.mkdir(parents=True)
        config.write_text("not json\n", encoding="utf-8")
        before = config.read_bytes()
        blocked = self.run_helper("--scope", "global", "--apply", expected=2)
        self.assertEqual(blocked["providers"][0]["reason"], "INSPECTION_FAILED")
        self.assertEqual(config.read_bytes(), before)

    def test_legacy_duplicate_is_reported_and_preserved(self) -> None:
        legacy = self.gemini / "antigravity/mcp_config.json"
        legacy.parent.mkdir(parents=True)
        original = {"mcpServers": {"afyx_graph": {"command": "legacy", "args": []}}, "keep": True}
        legacy.write_text(json.dumps(original), encoding="utf-8")
        blocked = self.run_helper("--scope", "global", "--apply", expected=2)
        self.assertEqual(blocked["providers"][0]["reason"], "LEGACY_DUPLICATE")
        self.assertEqual(json.loads(legacy.read_text(encoding="utf-8")), original)
        self.assertFalse((self.gemini / "config/mcp_config.json").exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
