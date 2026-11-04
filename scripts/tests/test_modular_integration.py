#!/usr/bin/env python3
"""Permanent acceptance regression tests for Afyx Product Identity and Modular Integration Foundation (TASK K01).

Covers:
1. Canonical Product Identity & Branding Preservation
2. Standalone Operation
3. Modular Integration & 8 Capability Lifecycle States
4. Representative Task Routing & Redundancy Suppression
5. Safety, Degradation, and User Override Priority
6. Focused Review Corrections (K01.P3): Non-coding tasks, status semantics, explicit Odoo evidence, Graph fallback
"""

from __future__ import annotations

import json
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MODULAR_MODULE = ROOT / "scripts/afyx-modular-integration.mjs"
REGISTRY = ROOT / "scripts/components.json"
ARCHITECTURE_DOC = ROOT / "docs/AFYX_MODULAR_INTEGRATION_CONTRACT.md"


def run_node(source: str) -> dict:
    """Executes a small ES module snippet with Node.js and returns JSON output."""
    result = subprocess.run(
        ["node", "--input-type=module", "-e", source],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise AssertionError(f"Node execution failed (code {result.returncode}):\n{result.stdout}\n{result.stderr}")
    return json.loads(result.stdout)


class ModularIntegrationFoundationTests(unittest.TestCase):
    """Test suite for Afyx Modular Integration Foundation and Product Identity."""

    def setUp(self) -> None:
        self.registry_data = json.loads(REGISTRY.read_text(encoding="utf-8"))

    # -------------------------------------------------------------------------
    # 1. Product Identity, Branding & Maturity Tests
    # -------------------------------------------------------------------------

    def test_canonical_product_display_names_are_consistent(self) -> None:
        """Verifies that all 7 Afyx-owned products expose their canonical display names."""
        source = f"""
import {{ PRODUCT_INVENTORY }} from {json.dumps(MODULAR_MODULE.as_uri())};
console.log(JSON.stringify(PRODUCT_INVENTORY));
"""
        inventory = run_node(source)

        expected_names = {
            "afyx-graph": "Afyx Graph",
            "afyx-context": "Afyx Context Engine",
            "afyx-engineering-expert": "Afyx Engineering Expert",
            "odoo-engineering": "Afyx Odoo Engineering",
            "efficient-coding": "Afyx Efficient Coding",
            "codex-usage-tracking": "Afyx Codex Usage Tracking",
            "afyx-forge": "Afyx Forge",
        }

        for comp_id, expected_name in expected_names.items():
            self.assertIn(comp_id, inventory, f"Missing component {comp_id} in product inventory")
            self.assertEqual(
                inventory[comp_id]["canonicalName"],
                expected_name,
                f"Mismatch canonical name for {comp_id}",
            )

    def test_product_maturity_classifications_are_explicit(self) -> None:
        """Verifies explicit product maturity labels separate SOURCE_READY, STANDALONE_ACCEPTED, etc. per AFYX_V1_MASTER_ROADMAP.md."""
        source = f"""
import {{ PRODUCT_MATURITY_LEVELS, PRODUCT_INVENTORY }} from {json.dumps(MODULAR_MODULE.as_uri())};
console.log(JSON.stringify({{ levels: PRODUCT_MATURITY_LEVELS, inventory: PRODUCT_INVENTORY }}));
"""
        res = run_node(source)
        levels = set(res["levels"])
        self.assertEqual(
            levels,
            {"SOURCE_READY", "STANDALONE_ACCEPTED", "INTEGRATION_ACCEPTED", "RELEASE_READY"},
        )
        # Authoritative roadmap baselines
        self.assertEqual(res["inventory"]["afyx-forge"]["maturity"], "SOURCE_READY")
        self.assertEqual(res["inventory"]["codex-usage-tracking"]["maturity"], "STANDALONE_ACCEPTED")
        self.assertEqual(res["inventory"]["afyx-graph"]["maturity"], "SOURCE_READY")
        self.assertEqual(res["inventory"]["afyx-context"]["maturity"], "SOURCE_READY")
        self.assertEqual(res["inventory"]["afyx-engineering-expert"]["maturity"], "SOURCE_READY")
        self.assertEqual(res["inventory"]["odoo-engineering"]["maturity"], "SOURCE_READY")
        self.assertEqual(res["inventory"]["efficient-coding"]["maturity"], "SOURCE_READY")

        # Confirm no component asserts unsupported production readiness
        for comp_id, meta in res["inventory"].items():
            self.assertFalse(meta.get("productionReady", False), f"{comp_id} prematurely asserted productionReady")

    def test_registry_metadata_exposes_canonical_display_names_and_retains_stable_ids(self) -> None:
        """Verifies scripts/components.json preserves stable IDs while exposing canonical display names."""
        components = {c["id"]: c for c in self.registry_data["components"]}

        expected_display_names = {
            "efficient-coding": "Afyx Efficient Coding",
            "odoo-engineering": "Afyx Odoo Engineering",
            "afyx-engineering-expert": "Afyx Engineering Expert",
            "afyx-graph": "Afyx Graph",
            "afyx-context": "Afyx Context Engine",
            "codex-usage-tracking": "Afyx Codex Usage Tracking",
        }

        for comp_id, expected_name in expected_display_names.items():
            self.assertIn(comp_id, components, f"Stable ID {comp_id} missing in components.json")
            self.assertEqual(
                components[comp_id]["display_name"],
                expected_name,
                f"Display name mismatch for {comp_id}",
            )

    def test_third_party_dependencies_retain_proper_identity(self) -> None:
        """Confirms that external tools and platforms are not rebranded as Afyx products."""
        providers = {p["provider"]: p for p in self.registry_data["providers"]}
        self.assertEqual(providers["codex"]["name"], "Codex")
        self.assertEqual(providers["antigravity"]["name"], "Antigravity")
        self.assertEqual(providers["claude"]["name"], "Claude Code")
        self.assertEqual(providers["codex"]["ownership_class"], "USER")

        prereqs = {p["key"]: p for p in self.registry_data["prerequisites"]}
        self.assertIn("git", prereqs)
        self.assertIn("node", prereqs)
        self.assertIn("platform-shell", prereqs)

    # -------------------------------------------------------------------------
    # 2. Standalone Operation Tests
    # -------------------------------------------------------------------------

    def test_components_operate_independently_when_others_absent(self) -> None:
        """Verifies that an installed component functions without requiring other Afyx products."""
        source = f"""
import {{ resolveModularCapabilityPlan }} from {json.dumps(MODULAR_MODULE.as_uri())};

// Case A: Only Efficient Coding is installed
const planA = resolveModularCapabilityPlan(
  {{ taskType: 'simple-fix', intent: 'Fix typo in string' }},
  {{ 'efficient-coding': {{ installed: true, healthy: true }} }}
);

// Case B: Only Graph is installed for impact query
const planB = resolveModularCapabilityPlan(
  {{ taskType: 'impact-analysis', needsRelationalEvidence: true }},
  {{ 'afyx-graph': {{ installed: true, healthy: true }} }}
);

// Case C: Only Odoo Engineering is installed on an Odoo project
const planC = resolveModularCapabilityPlan(
  {{ taskType: 'odoo-issue', project: {{ isOdoo: true }} }},
  {{ 'odoo-engineering': {{ installed: true, healthy: true }} }}
);

console.log(JSON.stringify({{ planA, planB, planC }}));
"""
        res = run_node(source)

        # Plan A: Efficient Coding succeeds standalone
        self.assertIn("efficient-coding", res["planA"]["selectedComponents"])
        self.assertEqual(res["planA"]["componentStates"]["afyx-graph"], "UNAVAILABLE")

        # Plan B: Graph succeeds standalone
        self.assertIn("afyx-graph", res["planB"]["selectedComponents"])
        self.assertEqual(res["planB"]["componentStates"]["afyx-context"], "UNAVAILABLE")

        # Plan C: Odoo Engineering succeeds standalone
        self.assertIn("odoo-engineering", res["planC"]["selectedComponents"])
        self.assertEqual(res["planC"]["componentStates"]["afyx-engineering-expert"], "UNAVAILABLE")

    # -------------------------------------------------------------------------
    # 3. Modular Integration & Lifecycle State Tests
    # -------------------------------------------------------------------------

    def test_eight_lifecycle_states_are_explicit_and_distinguished(self) -> None:
        """Verifies the 8 canonical lifecycle states from discovery to execution."""
        source = f"""
import {{ CAPABILITY_LIFECYCLE_STATES }} from {json.dumps(MODULAR_MODULE.as_uri())};
console.log(JSON.stringify(CAPABILITY_LIFECYCLE_STATES));
"""
        states = run_node(source)
        expected = [
            "INSTALLED",
            "AVAILABLE",
            "ELIGIBLE",
            "SELECTED",
            "ACTIVATED",
            "EXECUTED",
            "DEGRADED",
            "UNAVAILABLE",
        ]
        self.assertEqual(states, expected)

    def test_capability_state_semantics_preserve_available_when_irrelevant(self) -> None:
        """Installed/healthy components remain AVAILABLE when not selected, never falsely UNAVAILABLE."""
        source = f"""
import {{ resolveModularCapabilityPlan }} from {json.dumps(MODULAR_MODULE.as_uri())};

// Both installed and healthy
const installed = {{
  'efficient-coding': {{ installed: true, healthy: true }},
  'odoo-engineering': {{ installed: true, healthy: true }},
  'afyx-graph': {{ installed: true, healthy: true }},
}};

// Task is non-Odoo generic coding
const plan = resolveModularCapabilityPlan(
  {{ taskType: 'generic-coding', intent: 'Update React state hook', project: {{ isOdoo: false }} }},
  installed
);

console.log(JSON.stringify(plan));
"""
        plan = run_node(source)
        # Efficient Coding is selected
        self.assertEqual(plan["componentStates"]["efficient-coding"], "SELECTED")
        # Odoo Engineering is installed and healthy, but not relevant: must be AVAILABLE, not UNAVAILABLE!
        self.assertEqual(plan["componentStates"]["odoo-engineering"], "AVAILABLE")
        self.assertNotIn("odoo-engineering", plan["selectedComponents"])

    def test_non_coding_task_suppresses_efficient_coding_selection(self) -> None:
        """Non-coding tasks (e.g. documentation, general-inquiry) do NOT select Efficient Coding."""
        source = f"""
import {{ resolveModularCapabilityPlan }} from {json.dumps(MODULAR_MODULE.as_uri())};

const installed = {{
  'efficient-coding': {{ installed: true, healthy: true }},
  'afyx-engineering-expert': {{ installed: true, healthy: true }},
}};

const planDoc = resolveModularCapabilityPlan(
  {{ taskType: 'documentation', intent: 'Draft release notes for v1.0' }},
  installed
);

const planInquiry = resolveModularCapabilityPlan(
  {{ taskType: 'general-inquiry', intent: 'What is the licensing policy?' }},
  installed
);

console.log(JSON.stringify({{ planDoc, planInquiry }}));
"""
        res = run_node(source)
        # In both non-coding cases, efficient-coding is NOT selected
        self.assertNotIn("efficient-coding", res["planDoc"]["selectedComponents"])
        self.assertEqual(res["planDoc"]["componentStates"]["efficient-coding"], "AVAILABLE")
        self.assertNotIn("efficient-coding", res["planInquiry"]["selectedComponents"])
        self.assertEqual(res["planInquiry"]["componentStates"]["efficient-coding"], "AVAILABLE")

    def test_devops_config_is_classified_as_implementation_task_and_selects_efficient_coding(self) -> None:
        """Verifies devops-config is treated as a technical implementation task that retains efficient-coding selection."""
        source = f"""
import {{ resolveModularCapabilityPlan }} from {json.dumps(MODULAR_MODULE.as_uri())};

const plan = resolveModularCapabilityPlan(
  {{ taskType: 'devops-config', intent: 'Configure GitHub Actions CI workflow and Dockerfile' }},
  {{ 'efficient-coding': {{ installed: true, healthy: true }} }}
);

console.log(JSON.stringify(plan));
"""
        plan = run_node(source)
        # devops-config is an implementation task: efficient-coding MUST be selected for quality-first change discipline
        self.assertIn("efficient-coding", plan["selectedComponents"])
        self.assertEqual(plan["componentStates"]["efficient-coding"], "SELECTED")
        self.assertEqual(len(plan["suppressedRedundancies"]), 0)

    def test_explicit_odoo_task_supported_without_repository_detection(self) -> None:
        """Explicit Odoo tasks are recognized and select Odoo Engineering even if auto-detection is false."""
        source = f"""
import {{ resolveModularCapabilityPlan }} from {json.dumps(MODULAR_MODULE.as_uri())};

const installed = {{
  'odoo-engineering': {{ installed: true, healthy: true }},
  'efficient-coding': {{ installed: true, healthy: true }},
}};

// Repository detection is false or absent, but task is explicitly Odoo
const plan = resolveModularCapabilityPlan(
  {{ taskType: 'odoo-issue', intent: 'Fix sale.order compute field in custom addon', project: {{ isOdoo: false }} }},
  installed
);

console.log(JSON.stringify(plan));
"""
        plan = run_node(source)
        self.assertIn("odoo-engineering", plan["selectedComponents"])
        self.assertEqual(plan["componentStates"]["odoo-engineering"], "SELECTED")

    def test_graph_fallback_distinguishes_absent_unhealthy_and_user_bypass(self) -> None:
        """Verifies Graph fallback clearly reports COMPONENT_ABSENT, COMPONENT_UNHEALTHY, and BYPASSED_BY_USER."""
        source = f"""
import {{ resolveModularCapabilityPlan }} from {json.dumps(MODULAR_MODULE.as_uri())};

// Case 1: Graph Absent
const planAbsent = resolveModularCapabilityPlan(
  {{ taskType: 'impact-analysis', needsRelationalEvidence: true }},
  {{ 'odoo-engineering': {{ installed: true, healthy: true }} }}
);

// Case 2: Graph Unhealthy
const planUnhealthy = resolveModularCapabilityPlan(
  {{ taskType: 'impact-analysis', needsRelationalEvidence: true }},
  {{ 'afyx-graph': {{ installed: true, healthy: false }} }}
);

// Case 3: Graph Installed & Healthy, but Bypassed by User
const planBypassed = resolveModularCapabilityPlan(
  {{ taskType: 'impact-analysis', needsRelationalEvidence: true }},
  {{ 'afyx-graph': {{ installed: true, healthy: true }} }},
  {{ forceDirectSource: true }}
);

console.log(JSON.stringify({{ planAbsent, planUnhealthy, planBypassed }}));
"""
        res = run_node(source)
        degAbsent = res["planAbsent"]["degradations"][0]
        self.assertEqual(degAbsent["reason"], "COMPONENT_ABSENT")
        self.assertEqual(degAbsent["fallback"], "DIRECT_SOURCE")

        degUnhealthy = res["planUnhealthy"]["degradations"][0]
        self.assertEqual(degUnhealthy["reason"], "COMPONENT_UNHEALTHY")
        self.assertEqual(degUnhealthy["fallback"], "DIRECT_SOURCE")

        degBypassed = res["planBypassed"]["degradations"][0]
        self.assertEqual(degBypassed["reason"], "BYPASSED_BY_USER")
        self.assertEqual(degBypassed["fallback"], "DIRECT_SOURCE")

    # -------------------------------------------------------------------------
    # 4. Anti-Redundancy & Opt-In Tests
    # -------------------------------------------------------------------------

    def test_simple_fix_suppresses_deep_orchestration_and_graph_overhead(self) -> None:
        """Simple code fix selects only Efficient Coding; suppresses Expert persona and Graph indexing."""
        source = f"""
import {{ resolveModularCapabilityPlan }} from {json.dumps(MODULAR_MODULE.as_uri())};

const allInstalled = {{
  'efficient-coding': {{ installed: true, healthy: true }},
  'odoo-engineering': {{ installed: true, healthy: true }},
  'afyx-engineering-expert': {{ installed: true, healthy: true }},
  'afyx-graph': {{ installed: true, healthy: true }},
  'afyx-context': {{ installed: true, healthy: true }},
  'codex-usage-tracking': {{ installed: true, healthy: true }},
}};

const plan = resolveModularCapabilityPlan(
  {{ taskType: 'simple-fix', intent: 'Fix integer overflow in calculator.py', project: {{ isOdoo: false }} }},
  allInstalled
);

console.log(JSON.stringify(plan));
"""
        plan = run_node(source)
        self.assertEqual(plan["selectedComponents"], ["efficient-coding"])

        # Verify expert and graph were suppressed to save tokens
        suppressed = {s["component"]: s["reason"] for s in plan["suppressedRedundancies"]}
        self.assertIn("afyx-engineering-expert", suppressed)
        self.assertEqual(suppressed["afyx-engineering-expert"], "SIMPLE_FIX_DISCIPLINE")
        self.assertIn("afyx-graph", suppressed)
        self.assertEqual(suppressed["afyx-graph"], "EXACT_SOURCE_SUFFICIENT")

    def test_context_engine_default_on_routes_only_when_needed(self) -> None:
        """Healthy Context is available by default, selected for large tasks, and can be disabled."""
        source = f"""
import {{ resolveModularCapabilityPlan }} from {json.dumps(MODULAR_MODULE.as_uri())};

const installed = {{
  'efficient-coding': {{ installed: true, healthy: true }},
  'afyx-context': {{ installed: true, healthy: true }},
}};

// Case 1: Tiny task, context available but not selected
const planDefault = resolveModularCapabilityPlan(
  {{ taskType: 'generic-coding' }},
  installed
);

// Case 2: Large workload auto-selects Context without opt-in
const planLarge = resolveModularCapabilityPlan(
  {{ taskType: 'large-context' }},
  installed
);

// Case 3: Explicit disable remains authoritative
const planDisabled = resolveModularCapabilityPlan(
  {{ taskType: 'large-context', optInContextEngine: false }},
  installed
);

console.log(JSON.stringify({{ planDefault, planLarge, planDisabled }}));
"""
        res = run_node(source)
        self.assertNotIn("afyx-context", res["planDefault"]["selectedComponents"])
        self.assertEqual(res["planDefault"]["componentStates"]["afyx-context"], "AVAILABLE")
        self.assertIn("afyx-context", res["planLarge"]["selectedComponents"])
        self.assertNotIn("afyx-context", res["planDisabled"]["selectedComponents"])
        self.assertEqual(res["planDisabled"]["reasons"]["afyx-context"], "Context Engine explicitly disabled by task or user preference.")

    def test_forge_production_activation_remains_unavailable_pending_a8(self) -> None:
        """Verifies Afyx Forge cannot be activated in production prior to formal A8 gate approval."""
        source = f"""
import {{ resolveModularCapabilityPlan, PRODUCT_INVENTORY }} from {json.dumps(MODULAR_MODULE.as_uri())};

const plan = resolveModularCapabilityPlan(
  {{ taskType: 'architecture', intent: 'Run autonomous evaluation' }},
  {{ 'afyx-forge': {{ installed: true, healthy: true }} }}
);

console.log(JSON.stringify({{
  plan,
  forgeMeta: PRODUCT_INVENTORY['afyx-forge']
}}));
"""
        res = run_node(source)
        self.assertEqual(res["plan"]["componentStates"]["afyx-forge"], "UNAVAILABLE")
        self.assertFalse(res["forgeMeta"]["productionReady"])
        self.assertEqual(res["forgeMeta"]["gateStatus"], "UNAVAILABLE_PENDING_A8")

    # -------------------------------------------------------------------------
    # 5. Architecture Documentation Consistency
    # -------------------------------------------------------------------------

    def test_canonical_architecture_contract_document_exists_and_matches(self) -> None:
        """Verifies docs/AFYX_MODULAR_INTEGRATION_CONTRACT.md is present and contains required principles."""
        self.assertTrue(ARCHITECTURE_DOC.is_file(), "Contract document missing")
        content = ARCHITECTURE_DOC.read_text(encoding="utf-8")

        self.assertIn("Standalone by Design, Integrated by Contract, Activated by Need.", content)
        self.assertIn("AfyxModularIntegration/v1", content)
        self.assertIn("Afyx Graph", content)
        self.assertIn("Afyx Context Engine", content)
        self.assertIn("Afyx Engineering Expert", content)
        self.assertIn("Afyx Odoo Engineering", content)
        self.assertIn("Afyx Efficient Coding", content)
        self.assertIn("Afyx Codex Usage Tracking", content)
        self.assertIn("Afyx Forge", content)
        self.assertIn("UNAVAILABLE_PENDING_A8", content)
        self.assertIn("STANDALONE_ACCEPTED", content)
        self.assertIn("INTEGRATION_ACCEPTED", content)


if __name__ == "__main__":
    unittest.main()
