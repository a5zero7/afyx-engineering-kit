#!/usr/bin/env python3
"""TB7 compatibility lock for the stable three-provider platform."""

from __future__ import annotations

import json
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PROVIDERS = ROOT / "scripts/afyx-provider-integration.mjs"


def run_node(source: str) -> dict:
    result = subprocess.run(
        ["node", "--input-type=module", "-e", source],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise AssertionError(result.stdout + result.stderr)
    return json.loads(result.stdout)


class TB7PlatformContractTests(unittest.TestCase):
    def test_adapter_v1_snapshot_preserves_provider_specific_scopes(self) -> None:
        source = f"""
import {{providerAdapters}} from {json.dumps(PROVIDERS.as_uri())};
const methods = ['discover', 'negotiate', 'inspect', 'plan', 'apply', 'verify', 'uninstall'];
const adapters = Object.fromEntries(Object.entries(providerAdapters).map(([provider, adapter]) => [provider, {{
  contract: adapter.contract,
  capabilities: adapter.capabilities,
  methods: methods.filter((method) => typeof adapter[method] === 'function'),
  frozen: Object.isFrozen(adapter)
    && Object.isFrozen(adapter.contract)
    && Object.isFrozen(adapter.contract.operations)
    && Object.isFrozen(adapter.capabilities)
    && Object.isFrozen(adapter.capabilities.scopes),
}}]));
console.log(JSON.stringify({{providers: Object.keys(providerAdapters), adapters}}));
"""
        payload = run_node(source)
        operations = ["inspect", "plan", "apply", "verify", "uninstall"]
        methods = ["discover", "negotiate", *operations]
        expected_scopes = {
            "codex": ["global"],
            "antigravity": ["global", "workspace"],
            "claude": ["global", "workspace"],
        }

        self.assertEqual(payload["providers"], ["codex", "antigravity", "claude"])
        for provider, scopes in expected_scopes.items():
            adapter = payload["adapters"][provider]
            self.assertEqual(
                adapter["contract"],
                {"name": "ProviderAdapter", "version": 1, "operations": operations},
            )
            self.assertEqual(
                adapter["capabilities"],
                {
                    "scopes": scopes,
                    "operations": operations,
                    "configurationPolicy": "merge-afyx-owned-entries-only",
                },
            )
            self.assertEqual(adapter["methods"], methods)
            self.assertTrue(adapter["frozen"])

    def test_prevalidation_diagnostics_are_ordered_deduplicated_and_fail_closed(self) -> None:
        source = f"""
import {{runProviderLifecycle}} from {json.dumps(PROVIDERS.as_uri())};
const first = await runProviderLifecycle({{
  providers: ['claude', 'codex', 'claude', 'unknown'],
  scope: 'workspace',
  apply: true,
}});
const second = await runProviderLifecycle({{
  providers: ['claude', 'codex', 'claude', 'unknown'],
  scope: 'workspace',
  apply: true,
}});
console.log(JSON.stringify({{first, deterministic: JSON.stringify(first) === JSON.stringify(second)}}));
"""
        payload = run_node(source)
        result = payload["first"]

        self.assertTrue(payload["deterministic"])
        self.assertEqual(result["status"], "BLOCKED")
        self.assertEqual(result["recovery"], {"status": "NOT_STARTED"})
        self.assertEqual(
            [item["provider"] for item in result["providers"]],
            ["claude", "codex", "unknown"],
        )
        self.assertEqual(
            [item["reason"] for item in result["providers"]],
            ["PREVALIDATION_FAILED", "SCOPE_UNSUPPORTED", "UNKNOWN_PROVIDER"],
        )
        self.assertTrue(all(item["changed"] is False for item in result["providers"]))


if __name__ == "__main__":
    unittest.main(verbosity=2)
