#!/usr/bin/env python3
"""Afyx-first routing acceptance (pure decisions; no provider calls)."""
from __future__ import annotations

import json
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ROUTER = ROOT / "scripts" / "afyx-tool-family-routing.mjs"
GUIDANCE = ROOT / "skills" / "efficient-coding" / "references" / "tool-routing.md"


def candidate(name, owner, capability, surface="mcp", **kwargs):
    value = {"id": name, "ownership": owner, "surface": surface,
             "capabilities": [capability], "installed": True, "enabled": True,
             "reachable": True, "healthy": True, "authorized": True,
             "compatible": True, "fresh": True}
    value.update(kwargs)
    return value


def route(config):
    script = f"""
import {{resolveAfyxToolFamilyRoute}} from {json.dumps(ROUTER.as_uri())};
const config = {json.dumps(config)};
try {{console.log(JSON.stringify({{result:resolveAfyxToolFamilyRoute(config)}}));}}
catch (error) {{console.log(JSON.stringify({{error:error.code || 'OTHER'}}));}}
"""
    result = subprocess.run(["node", "--input-type=module", "-e", script],
                            cwd=ROOT, capture_output=True, text=True)
    if result.returncode:
        raise AssertionError(result.stderr)
    return json.loads(result.stdout)


class ToolFamilyRoutingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not shutil.which("node"):
            raise unittest.SkipTest("Node unavailable")

    def test_native_healthy_wins_over_external(self):
        tools = [candidate("external-graph", "EXTERNAL", "graph-relations", "cli"),
                 candidate("afyx-graph", "AFYX", "graph-relations")]
        x = route({"intent": "capability", "capability": "graph-relations",
                   "allowExternalFallback": True, "candidates": tools})["result"]
        self.assertEqual((x["route"], x["toolId"]), ("AFYX", "afyx-graph"))

    def test_native_missing_external_explicitly_allowed(self):
        tools = [candidate("afyx-graph", "AFYX", "graph-relations", installed=False),
                 candidate("external-graph", "EXTERNAL", "graph-relations", "cli")]
        x = route({"intent": "capability", "capability": "graph-relations",
                   "allowExternalFallback": True, "candidates": tools})["result"]
        self.assertEqual(x["route"], "EXTERNAL")
        self.assertEqual(x["toolId"], "external-graph")

    def test_external_never_automatically_enabled(self):
        x = route({"intent": "capability", "capability": "graph-relations",
                   "candidates": [candidate("external-graph", "EXTERNAL", "graph-relations", "cli")]})["result"]
        self.assertEqual(x["route"], "DIRECT_SOURCE")

    def test_disabled_mcp_does_not_enable_external_cli(self):
        tools = [candidate("external-graph", "EXTERNAL", "graph-relations", enabled=False),
                 candidate("external-graph", "EXTERNAL", "graph-relations", "cli", authorized=False)]
        x = route({"intent": "capability", "capability": "graph-relations",
                   "allowExternalFallback": True, "candidates": tools})["result"]
        self.assertEqual(x["route"], "DIRECT_SOURCE")

    def test_cli_can_be_separately_authorized(self):
        tools = [candidate("external-graph", "EXTERNAL", "graph-relations", enabled=False),
                 candidate("external-graph", "EXTERNAL", "graph-relations", "cli", authorized=True)]
        x = route({"intent": "capability", "capability": "graph-relations",
                   "allowExternalFallback": True, "candidates": tools})["result"]
        self.assertEqual((x["route"], x["surface"]), ("EXTERNAL", "cli"))

    def test_exact_source_skips_graph(self):
        x = route({"intent": "exact-source", "capability": "graph-relations",
                   "candidates": [candidate("afyx-graph", "AFYX", "graph-relations")]})["result"]
        self.assertEqual(x["reason"], "EXACT_SOURCE")

    def test_stale_native_external_only_if_authorized(self):
        tools = [candidate("afyx-graph", "AFYX", "graph-relations", fresh=False),
                 candidate("external-graph", "EXTERNAL", "graph-relations", "cli")]
        x = {"intent": "capability", "capability": "graph-relations",
             "allowExternalFallback": True, "candidates": tools}
        self.assertEqual(route(x)["result"]["route"], "EXTERNAL")
        x["allowExternalFallback"] = False
        self.assertEqual(route(x)["result"]["route"], "DIRECT_SOURCE")

    def test_disabled_unhealthy_unauthorized_or_incompatible_native(self):
        for flags in ({"enabled": False}, {"healthy": False},
                      {"authorized": False}, {"compatible": False},
                      {"reachable": False}):
            x = route({"intent": "capability", "capability": "graph-relations",
                       "candidates": [candidate("afyx-graph", "AFYX", "graph-relations", **flags)]})["result"]
            self.assertEqual(x["route"], "DIRECT_SOURCE")

    def test_non_graph_context_family_uses_same_rule(self):
        tools = [candidate("foreign-context", "EXTERNAL", "context-selection"),
                 candidate("afyx-context", "AFYX", "context-selection")]
        x = {"intent": "capability", "capability": "context-selection",
             "allowExternalFallback": True, "candidates": tools}
        self.assertEqual(route(x)["result"]["toolId"], "afyx-context")
        tools[1]["installed"] = False
        self.assertEqual(route(x)["result"]["toolId"], "foreign-context")

    def test_no_false_capability_parity(self):
        x = route({"intent": "capability", "capability": "graph-relations",
                   "allowExternalFallback": True,
                   "candidates": [candidate("afyx-context", "AFYX", "context-selection")]})["result"]
        self.assertEqual(x["route"], "DIRECT_SOURCE")

    def test_unverified_candidate_fails_closed(self):
        x = route({"intent": "capability", "capability": "graph-relations",
                   "candidates": [candidate("afyx-graph", "AFYX", "graph-relations", healthy=None)]})
        self.assertEqual(x["error"], "INVALID_TOOL_ROUTING_INPUT")

    def test_missing_freshness_is_not_treated_as_ready(self):
        tool = candidate("afyx-graph", "AFYX", "graph-relations")
        del tool["fresh"]
        value = route({"intent": "capability", "capability": "graph-relations",
                       "candidates": [tool]})
        self.assertEqual(value["error"], "INVALID_TOOL_ROUTING_INPUT")

    def test_duplicate_surface_fails_closed(self):
        tool = candidate("afyx-graph", "AFYX", "graph-relations")
        x = route({"intent": "capability", "capability": "graph-relations",
                   "candidates": [tool, tool]})
        self.assertEqual(x["error"], "INVALID_TOOL_ROUTING_INPUT")

    def test_installed_skill_policy_is_not_absolute_external_ban(self):
        s = GUIDANCE.read_text(encoding="utf-8").lower()
        self.assertIn("afyx-first", s)
        self.assertIn("external fallback", s)
        self.assertNotIn("never invoke the deprecated external graph dependency", s)


if __name__ == "__main__":
    unittest.main(verbosity=2)
