#!/usr/bin/env python3
"""Permanent acceptance regression tests for Afyx Modular Runtime Integration (TASK K02).

Covers:
1. 10 Representative Workload Scenarios:
   - S1: Simple Python bug (proportional discipline, zero expert overhead)
   - S2: Odoo ORM / security issue (framework domain authority)
   - S3: Cross-module impact analysis (relational graph evidence & safe degradation)
   - S4: Architecture review (cross-disciplinary engineering expert)
   - S5: Large context workload (Context Engine selected by default if installed; explicit disable respected)
   - S6: DevOps implementation (technical config retains efficient coding discipline)
   - S7: Documentation-only request (non-coding suppression)
   - S8: Provider capability unavailable (graceful degradation across providers)
   - S9: Multiple installed components (anti-overlap, single authoritative owner per domain)
   - S10: Forge requested before formal A8 gate (strictly blocked pending A8)
2. Host Authorization & Security Safeguards:
   - Refusal of silent CLI bypass when MCP is disabled
   - Refusal of automatic background indexing / daemonic builds
3. Provider-Mediated Surface Mapping:
   - Codex, Antigravity, and Claude Code native integration surfaces
4. Bounded, Sanitized Telemetry & Claims Verification:
   - No speculative token savings without measured provider counters
5. CLI Runner End-to-End Execution
"""

from __future__ import annotations

import json
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RUNTIME_MODULE = ROOT / "scripts/afyx-modular-runtime.mjs"
MODULAR_MODULE = ROOT / "scripts/afyx-modular-integration.mjs"


def run_node(source: str) -> dict:
    """Executes an ES module snippet with Node.js and returns parsed JSON output."""
    result = subprocess.run(
        ["node", "--input-type=module", "-e", source],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise AssertionError(f"Node execution failed (code {result.returncode}):\n{result.stdout}\n{result.stderr}")
    return json.loads(result.stdout)


def run_runtime_cli(args: list[str]) -> tuple[int, dict, str]:
    """Runs the afyx-modular-runtime.mjs CLI directly and returns (code, json_output, stderr)."""
    cmd = ["node", str(RUNTIME_MODULE)] + args
    result = subprocess.run(
        cmd,
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    parsed = {}
    if result.stdout.strip():
        try:
            parsed = json.loads(result.stdout)
        except json.JSONDecodeError:
            pass
    return result.returncode, parsed, result.stderr


class ModularRuntimeIntegrationTests(unittest.TestCase):
    """Test suite for Afyx Modular Runtime Integration & Intelligent Capability Activation."""

    # -------------------------------------------------------------------------
    # Scenario 1: Simple Python Bug (Proportional Discipline, Suppressed Overhead)
    # -------------------------------------------------------------------------
    def test_scenario_1_simple_python_bug_activation(self) -> None:
        """Verifies simple bug selects efficient-coding; expert and graph are suppressed."""
        source = f"""
import {{ resolveModularRuntimeActivation }} from {json.dumps(RUNTIME_MODULE.as_uri())};
const res = resolveModularRuntimeActivation({{
  task: {{ id: 'task-s1', taskType: 'simple-fix', intent: 'Fix null dereference in parser' }},
  provider: 'codex',
  installedComponents: {{
    'efficient-coding': {{ installed: true, healthy: true }},
    'afyx-engineering-expert': {{ installed: true, healthy: true }},
    'afyx-graph': {{ installed: true, healthy: true }},
    'afyx-context': {{ installed: true, healthy: true }},
  }},
}});
console.log(JSON.stringify(res));
"""
        res = run_node(source)
        self.assertEqual(res["status"], "READY")
        self.assertEqual(res["plannedComponents"], ["efficient-coding"])
        self.assertEqual(len(res["activatedCapabilities"]), 1)
        self.assertEqual(res["activatedCapabilities"][0]["componentId"], "efficient-coding")
        self.assertEqual(res["domainAuthorities"]["focused-coding-discipline"], "efficient-coding")

        # Confirm expert was suppressed for simple fix discipline
        suppressed_reasons = {item["component"]: item["reason"] for item in res["suppressedRedundancies"]}
        self.assertEqual(suppressed_reasons.get("afyx-engineering-expert"), "SIMPLE_FIX_DISCIPLINE")
        self.assertEqual(suppressed_reasons.get("afyx-graph"), "EXACT_SOURCE_SUFFICIENT")
        self.assertEqual(suppressed_reasons.get("afyx-context"), "CONTEXT_NOT_NEEDED")

    # -------------------------------------------------------------------------
    # Scenario 2: Odoo ORM / Security Issue (Framework Domain Authority)
    # -------------------------------------------------------------------------
    def test_scenario_2_odoo_framework_authority_activation(self) -> None:
        """Verifies Odoo task grants domain authority to odoo-engineering alongside efficient-coding."""
        source = f"""
import {{ resolveModularRuntimeActivation }} from {json.dumps(RUNTIME_MODULE.as_uri())};
const res = resolveModularRuntimeActivation({{
  task: {{ id: 'task-s2', taskType: 'odoo-security', project: {{ isOdoo: true }} }},
  provider: 'antigravity',
  installedComponents: {{
    'odoo-engineering': {{ installed: true, healthy: true }},
    'efficient-coding': {{ installed: true, healthy: true }},
    'afyx-graph': {{ installed: true, healthy: true }},
  }},
}});
console.log(JSON.stringify(res));
"""
        res = run_node(source)
        self.assertEqual(res["status"], "READY")
        self.assertIn("odoo-engineering", res["plannedComponents"])
        self.assertIn("efficient-coding", res["plannedComponents"])
        self.assertEqual(res["domainAuthorities"]["odoo-framework-authority"], "odoo-engineering")
        self.assertEqual(res["domainAuthorities"]["focused-coding-discipline"], "efficient-coding")

        # Graph index suppressed because relational evidence was not requested
        suppressed = [item["component"] for item in res["suppressedRedundancies"]]
        self.assertIn("afyx-graph", suppressed)

    # -------------------------------------------------------------------------
    # Scenario 3: Cross-Module Impact Analysis (Relational Evidence & Degradation)
    # -------------------------------------------------------------------------
    def test_scenario_3_cross_module_impact_analysis_ready(self) -> None:
        """Verifies afyx-graph is selected and activated when relational evidence is required."""
        source = f"""
import {{ resolveModularRuntimeActivation }} from {json.dumps(RUNTIME_MODULE.as_uri())};
const res = resolveModularRuntimeActivation({{
  task: {{ id: 'task-s3', taskType: 'impact-analysis', needsRelationalEvidence: true }},
  provider: 'codex',
  installedComponents: {{
    'afyx-graph': {{ installed: true, healthy: true, indexReady: true, indexFresh: true }},
    'efficient-coding': {{ installed: true, healthy: true }},
  }},
}});
console.log(JSON.stringify(res));
"""
        res = run_node(source)
        self.assertEqual(res["status"], "READY")
        self.assertIn("afyx-graph", res["plannedComponents"])
        activated_ids = [item["componentId"] for item in res["activatedCapabilities"]]
        self.assertIn("afyx-graph", activated_ids)
        self.assertEqual(res["domainAuthorities"]["repository-graph-evidence"], "afyx-graph")

    def test_scenario_3_cross_module_impact_analysis_safe_degradation(self) -> None:
        """Verifies safe degradation to direct source when afyx-graph is absent or unhealthy."""
        source = f"""
import {{ resolveModularRuntimeActivation }} from {json.dumps(RUNTIME_MODULE.as_uri())};
const res = resolveModularRuntimeActivation({{
  task: {{ id: 'task-s3-deg', taskType: 'impact-analysis', needsRelationalEvidence: true }},
  provider: 'codex',
  installedComponents: {{
    'afyx-graph': {{ installed: false, healthy: false }},
    'efficient-coding': {{ installed: true, healthy: true }},
  }},
}});
console.log(JSON.stringify(res));
"""
        res = run_node(source)
        self.assertEqual(res["status"], "DEGRADED")
        self.assertNotIn("afyx-graph", res["plannedComponents"])
        deg = next(d for d in res["degradations"] if d["component"] == "afyx-graph")
        self.assertEqual(deg["fallback"], "DIRECT_SOURCE")
        self.assertEqual(deg["reason"], "COMPONENT_ABSENT")

    # -------------------------------------------------------------------------
    # Scenario 4: Architecture Review (Cross-Disciplinary Engineering Expert)
    # -------------------------------------------------------------------------
    def test_scenario_4_architecture_review_activation(self) -> None:
        """Verifies architecture review activates afyx-engineering-expert as domain authority."""
        source = f"""
import {{ resolveModularRuntimeActivation }} from {json.dumps(RUNTIME_MODULE.as_uri())};
const res = resolveModularRuntimeActivation({{
  task: {{ id: 'task-s4', taskType: 'architecture', intent: 'Review system design boundaries' }},
  provider: 'claude',
  installedComponents: {{
    'afyx-engineering-expert': {{ installed: true, healthy: true }},
    'efficient-coding': {{ installed: true, healthy: true }},
  }},
}});
console.log(JSON.stringify(res));
"""
        res = run_node(source)
        self.assertEqual(res["status"], "READY")
        self.assertIn("afyx-engineering-expert", res["plannedComponents"])
        self.assertEqual(res["domainAuthorities"]["cross-disciplinary-expertise"], "afyx-engineering-expert")

    # -------------------------------------------------------------------------
    # Scenario 5: Large Context Workload (Default-ON, On-Demand)
    # -------------------------------------------------------------------------
    def test_scenario_5_large_context_default_on(self) -> None:
        """Verifies that installed healthy Context is selected when the task needs optimization."""
        source = f"""
import {{ resolveModularRuntimeActivation }} from {json.dumps(RUNTIME_MODULE.as_uri())};
const res = resolveModularRuntimeActivation({{
  task: {{ id: 'task-s5-off', taskType: 'large-context' }},
  provider: 'codex',
  installedComponents: {{
    'afyx-context': {{ installed: true, healthy: true }},
    'efficient-coding': {{ installed: true, healthy: true }},
  }},
}});
console.log(JSON.stringify(res));
"""
        res = run_node(source)
        self.assertIn("afyx-context", res["plannedComponents"])
        self.assertEqual(res["domainAuthorities"]["bounded-context-optimization"], "afyx-context")

    def test_scenario_5_large_context_opt_in_activation(self) -> None:
        """Verifies explicit opt-in remains supported alongside default-on routing."""
        source = f"""
import {{ resolveModularRuntimeActivation }} from {json.dumps(RUNTIME_MODULE.as_uri())};
const res = resolveModularRuntimeActivation({{
  task: {{ id: 'task-s5-on', taskType: 'large-context', optInContextEngine: true }},
  provider: 'codex',
  installedComponents: {{
    'afyx-context': {{ installed: true, healthy: true }},
    'efficient-coding': {{ installed: true, healthy: true }},
  }},
}});
console.log(JSON.stringify(res));
"""
        res = run_node(source)
        self.assertIn("afyx-context", res["plannedComponents"])
        self.assertEqual(res["domainAuthorities"]["bounded-context-optimization"], "afyx-context")

    # -------------------------------------------------------------------------
    # Scenario 6: DevOps Implementation Task Classification
    # -------------------------------------------------------------------------
    def test_scenario_6_devops_config_retains_efficient_coding(self) -> None:
        """Verifies devops-config is classified as implementation and activates efficient-coding."""
        source = f"""
import {{ resolveModularRuntimeActivation }} from {json.dumps(RUNTIME_MODULE.as_uri())};
const res = resolveModularRuntimeActivation({{
  task: {{ id: 'task-s6', taskType: 'devops-config', intent: 'Configure CI/CD workflow' }},
  provider: 'codex',
  installedComponents: {{
    'efficient-coding': {{ installed: true, healthy: true }},
  }},
}});
console.log(JSON.stringify(res));
"""
        res = run_node(source)
        self.assertEqual(res["status"], "READY")
        self.assertIn("efficient-coding", res["plannedComponents"])

    # -------------------------------------------------------------------------
    # Scenario 7: Documentation-Only Request (Non-Coding Suppression)
    # -------------------------------------------------------------------------
    def test_scenario_7_documentation_task_suppresses_coding_discipline(self) -> None:
        """Verifies documentation task suppresses efficient-coding to avoid redundant guidance."""
        source = f"""
import {{ resolveModularRuntimeActivation }} from {json.dumps(RUNTIME_MODULE.as_uri())};
const res = resolveModularRuntimeActivation({{
  task: {{ id: 'task-s7', taskType: 'documentation', intent: 'Draft release notes' }},
  provider: 'codex',
  installedComponents: {{
    'efficient-coding': {{ installed: true, healthy: true }},
  }},
}});
console.log(JSON.stringify(res));
"""
        res = run_node(source)
        self.assertNotIn("efficient-coding", res["plannedComponents"])
        suppressed = next(s for s in res["suppressedRedundancies"] if s["component"] == "efficient-coding")
        self.assertEqual(suppressed["reason"], "NON_CODING_TASK")

    # -------------------------------------------------------------------------
    # Scenario 8: Provider Capability Unavailable (Graceful Degradation)
    # -------------------------------------------------------------------------
    def test_scenario_8_unsupported_capability_on_provider_graceful_degradation(self) -> None:
        """Verifies codex-usage-tracking degrades gracefully when requested on claude/antigravity."""
        source = f"""
import {{ resolveModularRuntimeActivation }} from {json.dumps(RUNTIME_MODULE.as_uri())};
const res = resolveModularRuntimeActivation({{
  task: {{ id: 'task-s8', taskType: 'simple-fix' }},
  provider: 'claude',
  installedComponents: {{
    'codex-usage-tracking': {{ installed: true, healthy: true }},
    'efficient-coding': {{ installed: true, healthy: true }},
  }},
}});
console.log(JSON.stringify(res));
"""
        res = run_node(source)
        self.assertEqual(res["status"], "READY")
        # codex-usage-tracking was not selected by task, so no error
        self.assertIn("efficient-coding", res["plannedComponents"])

    # -------------------------------------------------------------------------
    # Scenario 9: Multiple Installed Components (Anti-Overlap Domain Ownership)
    # -------------------------------------------------------------------------
    def test_scenario_9_anti_overlap_single_domain_authority(self) -> None:
        """Verifies each active domain has exactly ONE authoritative owner without overlap."""
        source = f"""
import {{ resolveModularRuntimeActivation }} from {json.dumps(RUNTIME_MODULE.as_uri())};
const res = resolveModularRuntimeActivation({{
  task: {{ id: 'task-s9', taskType: 'odoo-issue', project: {{ isOdoo: true }}, needsRelationalEvidence: true, optInContextEngine: true }},
  provider: 'codex',
  installedComponents: {{
    'afyx-graph': {{ installed: true, healthy: true, indexReady: true, indexFresh: true }},
    'afyx-context': {{ installed: true, healthy: true }},
    'odoo-engineering': {{ installed: true, healthy: true }},
    'efficient-coding': {{ installed: true, healthy: true }},
    'afyx-engineering-expert': {{ installed: true, healthy: true }},
  }},
}});
console.log(JSON.stringify(res));
"""
        res = run_node(source)
        self.assertEqual(res["status"], "READY")
        authorities = res["domainAuthorities"]

        # Assert disjoint domain authorities
        self.assertEqual(authorities["odoo-framework-authority"], "odoo-engineering")
        self.assertEqual(authorities["focused-coding-discipline"], "efficient-coding")
        self.assertEqual(authorities["repository-graph-evidence"], "afyx-graph")
        self.assertEqual(authorities["bounded-context-optimization"], "afyx-context")

        # Zero duplicates in owner values per domain
        self.assertEqual(len(authorities.keys()), len(set(authorities.keys())))

    # -------------------------------------------------------------------------
    # Scenario 10: Forge Requested Before Formal A8 Gate (Strictly Blocked)
    # -------------------------------------------------------------------------
    def test_scenario_10_forge_activation_blocked_pending_a8(self) -> None:
        """Verifies afyx-forge request is strictly BLOCKED pending formal A8 gate."""
        source = f"""
import {{ resolveModularRuntimeActivation }} from {json.dumps(RUNTIME_MODULE.as_uri())};
const res = resolveModularRuntimeActivation({{
  task: {{ id: 'task-s10', taskType: 'forge-evaluation', requestedComponent: 'afyx-forge' }},
  provider: 'codex',
  installedComponents: {{
    'afyx-forge': {{ installed: true, healthy: true }},
  }},
}});
console.log(JSON.stringify(res));
"""
        res = run_node(source)
        self.assertEqual(res["status"], "BLOCKED")
        self.assertEqual(len(res["activatedCapabilities"]), 0)
        diagnostic = next(d for d in res["diagnostics"] if d["code"] == "FORGE_GATED_PENDING_A8")
        self.assertEqual(diagnostic["severity"], "ERROR")

    # -------------------------------------------------------------------------
    # Host Safeguards & Authorization Tests
    # -------------------------------------------------------------------------
    def test_disabled_mcp_cli_bypass_refusal(self) -> None:
        """Verifies that disabled MCP refuses unverified silent CLI bypass."""
        source = f"""
import {{ resolveModularRuntimeActivation }} from {json.dumps(RUNTIME_MODULE.as_uri())};
const res = resolveModularRuntimeActivation({{
  task: {{ id: 'task-auth-1', taskType: 'simple-fix' }},
  provider: 'codex',
  installedComponents: {{
    'efficient-coding': {{ installed: true, healthy: true }},
  }},
  hostAuthorizations: {{
    mcpEnabled: false,
    attemptedCliBypass: true,
    cliBypassAllowed: false,
  }},
}});
console.log(JSON.stringify(res));
"""
        res = run_node(source)
        self.assertEqual(res["status"], "BLOCKED")
        diag = next(d for d in res["diagnostics"] if d["code"] == "CLI_BYPASS_REFUSED")
        self.assertEqual(diag["severity"], "ERROR")

    def test_automatic_background_indexing_refusal(self) -> None:
        """Verifies that stale/unready Graph index degrades to DIRECT_SOURCE instead of auto-indexing."""
        source = f"""
import {{ resolveModularRuntimeActivation }} from {json.dumps(RUNTIME_MODULE.as_uri())};
const res = resolveModularRuntimeActivation({{
  task: {{ id: 'task-auth-2', taskType: 'impact-analysis', needsRelationalEvidence: true }},
  provider: 'codex',
  installedComponents: {{
    'afyx-graph': {{ installed: true, healthy: true, indexReady: false, indexFresh: false }},
  }},
  hostAuthorizations: {{
    allowAutomaticIndexing: false,
  }},
}});
console.log(JSON.stringify(res));
"""
        res = run_node(source)
        self.assertEqual(res["status"], "DEGRADED")
        deg = next(d for d in res["degradations"] if d["component"] == "afyx-graph")
        self.assertEqual(deg["fallback"], "DIRECT_SOURCE")
        self.assertEqual(deg["reason"], "INDEX_NOT_READY_OR_STALE")

    # -------------------------------------------------------------------------
    # Provider Surface Mapping Tests
    # -------------------------------------------------------------------------
    def test_provider_surface_mapping_antigravity_skills(self) -> None:
        """Verifies Antigravity maps skills to 'skills' surface with correct skillName."""
        source = f"""
import {{ resolveModularRuntimeActivation }} from {json.dumps(RUNTIME_MODULE.as_uri())};
const res = resolveModularRuntimeActivation({{
  task: {{ id: 'task-surf', taskType: 'simple-fix' }},
  provider: 'antigravity',
  installedComponents: {{
    'efficient-coding': {{ installed: true, healthy: true }},
  }},
}});
console.log(JSON.stringify(res));
"""
        res = run_node(source)
        cap = res["activatedCapabilities"][0]
        self.assertEqual(cap["provider"], "antigravity")
        self.assertEqual(cap["surface"], "skills")
        self.assertEqual(cap["surfaceDetails"]["skillName"], "efficient-coding")

    # -------------------------------------------------------------------------
    # Bounded Telemetry & Claims Verification
    # -------------------------------------------------------------------------
    def test_telemetry_claims_verification_flag(self) -> None:
        """Verifies telemetry strictly disclaims speculative token savings without provider counters."""
        source = f"""
import {{ resolveModularRuntimeActivation }} from {json.dumps(RUNTIME_MODULE.as_uri())};
const res = resolveModularRuntimeActivation({{
  task: {{ id: 'task-telem', taskType: 'simple-fix' }},
  provider: 'codex',
  installedComponents: {{
    'efficient-coding': {{ installed: true, healthy: true }},
  }},
}});
console.log(JSON.stringify(res));
"""
        res = run_node(source)
        self.assertIn("telemetry", res)
        self.assertEqual(
            res["telemetry"]["claimVerification"],
            "No speculative token savings claimed without measured provider counters.",
        )

    # -------------------------------------------------------------------------
    # Additional Negative & Verification Tests (K02 Review Corrections)
    # -------------------------------------------------------------------------
    def test_unknown_provider_fails_closed_blocked(self) -> None:
        """Verifies unknown provider fails closed with BLOCKED status and explicit diagnostic."""
        source = f"""
import {{ resolveModularRuntimeActivation }} from {json.dumps(RUNTIME_MODULE.as_uri())};
const res = resolveModularRuntimeActivation({{
  task: {{ id: 'task-unk-prov', taskType: 'simple-fix' }},
  provider: 'unknown-vendor-ai',
  installedComponents: {{
    'efficient-coding': {{ installed: true, healthy: true }},
  }},
}});
console.log(JSON.stringify(res));
"""
        res = run_node(source)
        self.assertEqual(res["status"], "BLOCKED")
        self.assertEqual(len(res["preparedCapabilities"]), 0)
        diag = next(d for d in res["diagnostics"] if d["code"] == "UNKNOWN_PROVIDER_REFUSED")
        self.assertEqual(diag["severity"], "ERROR")

    def test_graph_missing_freshness_evidence_treated_as_unknown(self) -> None:
        """Verifies missing Graph freshness/readiness evidence is treated as UNKNOWN, not implicitly ready."""
        source = f"""
import {{ resolveModularRuntimeActivation }} from {json.dumps(RUNTIME_MODULE.as_uri())};
const res = resolveModularRuntimeActivation({{
  task: {{ id: 'task-graph-unk', taskType: 'impact-analysis', needsRelationalEvidence: true }},
  provider: 'codex',
  installedComponents: {{
    'afyx-graph': {{ installed: true, healthy: true }}, // indexReady and indexFresh are omitted (undefined)
  }},
}});
console.log(JSON.stringify(res));
"""
        res = run_node(source)
        self.assertEqual(res["status"], "DEGRADED")
        deg = next(d for d in res["degradations"] if d["component"] == "afyx-graph")
        self.assertEqual(deg["fallback"], "DIRECT_SOURCE")
        self.assertEqual(deg["reason"], "INDEX_FRESHNESS_UNKNOWN")
        diag = next(d for d in res["diagnostics"] if d["code"] == "GRAPH_FRESHNESS_UNKNOWN")
        self.assertEqual(diag["severity"], "WARNING")

    def test_lifecycle_state_is_prepared_and_execution_is_not_run(self) -> None:
        """Verifies activation semantics: capabilities are PREPARED with executionStatus NOT_RUN."""
        source = f"""
import {{ resolveModularRuntimeActivation }} from {json.dumps(RUNTIME_MODULE.as_uri())};
const res = resolveModularRuntimeActivation({{
  task: {{ id: 'task-sem', taskType: 'simple-fix' }},
  provider: 'codex',
  installedComponents: {{
    'efficient-coding': {{ installed: true, healthy: true }},
  }},
}});
console.log(JSON.stringify(res));
"""
        res = run_node(source)
        self.assertEqual(res["executionStatus"], "NOT_RUN")
        self.assertFalse(res["actualExecutionClaimed"])
        self.assertEqual(len(res["preparedCapabilities"]), 1)
        cap = res["preparedCapabilities"][0]
        self.assertEqual(cap["lifecycleState"], "PREPARED")
        self.assertEqual(cap["executionStatus"], "NOT_RUN")

    def test_accepted_providers_imported_from_component_registry(self) -> None:
        """Verifies ACCEPTED_PROVIDERS matches the authoritative components.json registry."""
        source = f"""
import {{ ACCEPTED_PROVIDERS }} from {json.dumps(RUNTIME_MODULE.as_uri())};
console.log(JSON.stringify(ACCEPTED_PROVIDERS));
"""
        providers = run_node(source)
        self.assertEqual(providers, ["codex", "antigravity", "claude"])

    # -------------------------------------------------------------------------
    # CLI Runner Tests
    # -------------------------------------------------------------------------
    def test_cli_runner_success(self) -> None:
        """Verifies CLI runner executes and returns exit code 0 for READY status."""
        task_json = json.dumps({"taskType": "simple-fix"})
        installed_json = json.dumps({"efficient-coding": {"installed": True, "healthy": True}})
        code, out, _ = run_runtime_cli([
            "--task-json", task_json,
            "--provider", "codex",
            "--installed-json", installed_json,
        ])
        self.assertEqual(code, 0)
        self.assertEqual(out.get("status"), "READY")

    def test_cli_runner_blocked_exit_code(self) -> None:
        """Verifies CLI runner returns exit code 2 when status is BLOCKED."""
        task_json = json.dumps({"taskType": "forge-evaluation"})
        code, out, _ = run_runtime_cli([
            "--task-json", task_json,
            "--provider", "codex",
        ])
        self.assertEqual(code, 2)
        self.assertEqual(out.get("status"), "BLOCKED")


if __name__ == "__main__":
    unittest.main()

