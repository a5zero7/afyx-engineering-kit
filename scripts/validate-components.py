#!/usr/bin/env python3
"""Static validation of the Afyx component contract (scripts/components.json).

Zero-token and deterministic. Proves the single component truth is well formed,
readable by both the PowerShell module and the Bash library (one "key": "value"
per line), and consistent with the files the kit actually ships.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "scripts" / "components.json"

TYPES = {"skill", "runtime", "toolset", "detected-cli"}
TIERS = {"core", "optional", "external"}
OWNERSHIP = {"afyx", "upstream", "external"}
OWNERSHIP_CLASSES = {"AFYX", "EXTERNAL", "USER"}
PRESETS = {"minimal", "recommended", "full", "custom"}
PLATFORMS = {"all", "windows"}
INSTALL_ROOTS = {"skills_root", "afyx_graph_root", "afyx_context_root", "afyx_forge_root", "codex_tools", ""}
REQUIRED_KEYS = {"id", "name", "type", "tier", "ownership", "ownership_class", "presets", "platforms", "install_root", "install_path"}
EXPECTED_IDS = ["efficient-coding", "odoo-engineering", "afyx-engineering-expert", "afyx-graph", "afyx-context", "afyx-forge", "codex-usage-tracking"]
LINE_RE = re.compile(r'^\s*"[a-z_]+":\s*"[^"\\]*",?\s*$')


def fail(message: str) -> None:
    raise SystemExit(f"Component contract validation failed: {message}")


text = CONTRACT.read_text(encoding="utf-8")
document = json.loads(text)
if document.get("schema_version") != 1:
    fail("schema_version must be 1")
if document.get("control_plane_version") != 1:
    fail("control_plane_version must be 1")
if document.get("provider_adapter_contract") != "ProviderAdapter/v1":
    fail("provider_adapter_contract must be ProviderAdapter/v1")
if document.get("provider_adapter_operations") != "inspect;plan;apply;verify;uninstall":
    fail("provider_adapter_operations must declare the stable v1 lifecycle")
expected_contracts = {
    "provider_capability_contract": "ProviderCapability/v1",
    "provider_negotiation_contract": "ProviderCapabilityNegotiation/v1",
    "engineering_task_contract": "AfyxEngineeringTask/v1",
    "engineering_result_contract": "AfyxEngineeringResult/v1",
}
for key, expected in expected_contracts.items():
    if document.get(key) != expected:
        fail(f"{key} must be {expected}")
if set(document.get("supported_presets", "").split(";")) != PRESETS:
    fail("supported_presets must contain minimal, recommended, full and custom")
providers = document.get("providers", [])
provider_ids = [provider.get("provider") for provider in providers]
if provider_ids != ["codex", "antigravity", "claude"] or document.get("default_provider") != "codex":
    fail("provider registry must declare Codex first/default, Antigravity second, and Claude third")
if len(set(provider_ids)) != len(provider_ids):
    fail("duplicate provider id")
for provider in providers:
    if provider.get("ownership_class") not in OWNERSHIP_CLASSES:
        fail(f"provider {provider.get('provider')}: invalid ownership_class")
    if provider.get("configuration_policy") not in {"merge-afyx-owned-entries-only", "observe-only"}:
        fail(f"provider {provider.get('provider')}: unsafe configuration_policy")
if providers[0].get("primary") != "true":
    fail("Codex must be the primary v1 provider")
if any(provider.get("primary") == "true" for provider in providers[1:]):
    fail("only Codex may be the primary provider")
components = document["components"]

# The Bash reader parses one scalar "key": "value" per line inside each object.
inside = False
for number, line in enumerate(text.splitlines(), start=1):
    stripped = line.strip()
    if stripped == "{" and number > 1 and inside is False and line.startswith("    "):
        inside = True
        continue
    if inside and stripped in ("}", "},"):
        inside = False
        continue
    if inside and not LINE_RE.match(line):
        fail(f"line {number} is not a single scalar \"key\": \"value\" pair: {line.strip()!r}")

ids = [component["id"] for component in components]
if ids != EXPECTED_IDS:
    fail(f"component ids must be exactly {EXPECTED_IDS}, got {ids}")
if len(set(ids)) != len(ids):
    fail("duplicate component id")

for component in components:
    cid = component["id"]
    missing = REQUIRED_KEYS - component.keys()
    if missing:
        fail(f"{cid}: missing keys {sorted(missing)}")
    for key, value in component.items():
        if not isinstance(value, str):
            fail(f"{cid}.{key} must be a string")
    if component["type"] not in TYPES:
        fail(f"{cid}: unknown type {component['type']}")
    if component["tier"] not in TIERS:
        fail(f"{cid}: unknown tier {component['tier']}")
    if component["ownership"] not in OWNERSHIP:
        fail(f"{cid}: unknown ownership {component['ownership']}")
    if component["ownership_class"] not in OWNERSHIP_CLASSES - {"USER"}:
        fail(f"{cid}: invalid declared ownership_class")
    declared_presets = {item for item in component["presets"].split(";") if item}
    if not declared_presets <= PRESETS - {"custom"}:
        fail(f"{cid}: invalid preset membership")
    if component["platforms"] not in PLATFORMS:
        fail(f"{cid}: unknown platforms {component['platforms']}")
    if component["install_root"] not in INSTALL_ROOTS:
        fail(f"{cid}: unknown install_root {component['install_root']}")
    if component["tier"] == "core" and component["ownership"] == "external":
        fail(f"{cid}: a core component cannot be externally owned")

by_id = {component["id"]: component for component in components}
expected_presets = {
    "minimal": {"efficient-coding", "odoo-engineering"},
    "recommended": {"efficient-coding", "odoo-engineering", "afyx-engineering-expert"},
    "full": {"efficient-coding", "odoo-engineering", "afyx-engineering-expert", "afyx-graph", "afyx-context", "afyx-forge", "codex-usage-tracking"},
}
for preset, expected in expected_presets.items():
    actual = {component["id"] for component in components if preset in component["presets"].split(";")}
    if actual != expected:
        fail(f"{preset}: component membership mismatch")

# Bundled skills must ship exactly what the contract requires.
for cid in ("efficient-coding", "odoo-engineering", "afyx-engineering-expert"):
    component = by_id[cid]
    skill_dir = ROOT / "skills" / component["install_path"]
    for relative in component["required_files"].split(";"):
        if not (skill_dir / relative).is_file():
            fail(f"{cid}: required file {relative} is missing from the bundled skill")
    manifest = (skill_dir / "SKILL.md").read_text(encoding="utf-8")
    if not re.search(r"(?m)^name:\s*" + re.escape(cid) + r"\s*$", manifest):
        fail(f"{cid}: SKILL.md name does not match the component id")
    if component["version_required"] == "true" and not re.search(r'(?ms)^metadata:\s*\n\s+version:\s*["\'][^"\']+["\']', manifest):
        fail(f"{cid}: SKILL.md metadata.version is required by the contract")
    if cid == "afyx-engineering-expert":
        if any(key.startswith("legacy_") for key in component):
            fail("afyx-engineering-expert: new skill must not claim legacy adoption evidence")
        continue
    if component.get("legacy_version") != "1.1.0" or component.get("legacy_distribution_revision") != "b0b4d88eb7c42627598de71d6b0bf26317b9a694":
        fail(f"{cid}: legacy adoption evidence must identify the verified 1.1.0 baseline")
    if not re.fullmatch(r"[0-9a-f]{64}", component.get("legacy_content_digest", "")) or not re.fullmatch(r"[0-9a-f]{64}", component.get("legacy_content_digest_bash", "")):
        fail(f"{cid}: legacy adoption digests must be exact SHA-256 values")

# The graph component must agree with the operational metadata.
graph = by_id["afyx-graph"]
metadata = json.loads((ROOT / "afyx-graph" / "afyx-graph.json").read_text(encoding="utf-8"))
if graph["marker_value"] != metadata["product_name"]:
    fail("afyx-graph marker_value differs from metadata product_name")
if graph["marker_field"] not in metadata:
    fail("afyx-graph marker_field is not a metadata field")
version_field = graph["version_source"].split("#", 1)[1]
if version_field not in metadata:
    fail("afyx-graph version_source is not a metadata field")
if metadata["cli"] not in graph["required_files_unix"] or f"{metadata['cli']}.cmd" not in graph["required_files_windows"]:
    fail("afyx-graph launcher files must match the metadata CLI name")

# ACE is first-party in the explicitly selected Full preset. Graph consumers
# remain OFF unless separately authorized.
context = by_id["afyx-context"]
context_metadata = json.loads((ROOT / "afyx-context" / "afyx-context.json").read_text(encoding="utf-8"))
if context["ownership_class"] != "AFYX" or context["install_root"] != "afyx_context_root" or context["presets"] != "full":
    fail("afyx-context must be an AFYX-owned Full-preset runtime")
if context_metadata["kit_management"]["lifecycle_integration"] != "managed-optional":
    fail("afyx-context lifecycle metadata must declare managed-optional")
if context_metadata["kit_management"]["default_presets"] != ["full"] or context_metadata["optional_consumers"]["graph"]["default_enabled"]:
    fail("afyx-context Full-preset metadata and Graph OFF must remain aligned")
if context["marker_value"] != context_metadata["product_name"] or context["marker_field"] not in context_metadata:
    fail("afyx-context component metadata does not match its product identity")

# Afyx Forge Core is first-party in the explicitly selected Full preset,
# bounded to assistive guidance while A8 remains evaluation-gated.
forge = by_id["afyx-forge"]
forge_metadata = json.loads((ROOT / "afyx-forge" / "afyx-forge.json").read_text(encoding="utf-8"))
if forge["ownership_class"] != "AFYX" or forge["install_root"] != "afyx_forge_root" or forge["presets"] != "full":
    fail("afyx-forge must be an AFYX-owned Full-preset runtime")
if forge["marker_value"] != forge_metadata["product_name"] or forge["marker_field"] not in forge_metadata:
    fail("afyx-forge component metadata does not match its product identity")
if forge_metadata.get("runtime_mode") != "ASSISTIVE_GUIDANCE_ONLY" or forge_metadata.get("evaluation_gate", {}).get("autonomous_code_execution") is not False:
    fail("afyx-forge metadata must enforce ASSISTIVE_GUIDANCE_ONLY without autonomous execution")

# The usage tracker contract must list files the kit actually ships.
usage = by_id["codex-usage-tracking"]
if usage.get("providers") != "codex":
    fail("codex-usage-tracking must remain Codex-only")
for relative in usage["required_files"].split(";"):
    if not (ROOT / "tools" / "codex-usage" / relative).is_file():
        fail(f"codex-usage-tracking: {relative} is not shipped in tools/codex-usage")

print(f"Afyx component contract: PASS ({len(components)} components)")
