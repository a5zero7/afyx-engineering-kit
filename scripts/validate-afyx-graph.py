#!/usr/bin/env python3
"""Static Afyx Graph identity, metadata and attribution validation.

Zero-token and deterministic: reads repository files only. No network, no model
calls, no build. The canonical product identity is declared once in
afyx-graph/engine/src/product.ts; this script proves the operational metadata,
package manifest and CLI entry all agree with it.
"""

from __future__ import annotations

import hashlib
import json
import re
import tarfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GRAPH = ROOT / "afyx-graph"
ENGINE = GRAPH / "engine"
metadata_path = GRAPH / "afyx-graph.json"
package_path = ENGINE / "package.json"
ui_package_path = ENGINE / "ui" / "package.json"
product_path = ENGINE / "src" / "product.ts"
root_license_path = ROOT / "LICENSE"
engine_license_path = ENGINE / "LICENSE"
obsolete_legal_paths = (
    GRAPH / "LICENSES" / "THIRD_PARTY_ENGINE_MIT.txt",
    GRAPH / "THIRD_PARTY_NOTICES.md",
    ROOT / "THIRD_PARTY_NOTICES.md",
    ENGINE / "THIRD_PARTY_NOTICES.md",
)
bundle_script_path = ENGINE / "scripts" / "build-bundle.sh"
archive_script_path = ENGINE / "scripts" / "deterministic-archive.mjs"
distribution_product_path = ENGINE / "scripts" / "distribution-product.json"
release_dir = ENGINE / "release"
installer_paths = (ROOT / "scripts" / "install-afyx-graph.ps1", ROOT / "scripts" / "install-afyx-graph.sh")
installer_legal_requirements = {
    "install-afyx-graph.ps1": "@('bin\\afyx-graph.cmd', 'metadata.json', 'LICENSE')",
    "install-afyx-graph.sh": "bin/afyx-graph metadata.json LICENSE",
}

COPYRIGHT_LINE = "Copyright (c) 2026 Afyx"
LICENSE_MARKERS = (
    "MIT License",
    "Permission is hereby granted, free of charge",
    "The above copyright notice and this permission notice shall be included in all",
    'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND',
)
EXPECTED_LEGAL_FILES = [
    {"source": "LICENSE", "bundlePath": "LICENSE"},
]
OBSOLETE_LEGAL_NAMES = ("THIRD_PARTY_ENGINE_MIT.txt", "THIRD_PARTY_NOTICES.md", "NOTICE", "NOTICE.md", "NOTICE.txt")

REQUIRED_METADATA = {
    "product_name",
    "product_version",
    "package",
    "repository",
    "cli",
    "runtime_path",
    "state_directory",
    "database_filename",
    "mcp_server",
    "supported_platforms",
    "license",
}


def fail(message: str) -> None:
    raise SystemExit(f"Afyx Graph validation failed: {message}")


def product_constant(source: str, name: str) -> str:
    match = re.search(rf"export const {name}\s*=\s*'([^']*)';", source)
    if not match:
        fail(f"src/product.ts does not declare {name} as a string constant")
    return match.group(1)


metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
package = json.loads(package_path.read_text(encoding="utf-8"))
ui_package = json.loads(ui_package_path.read_text(encoding="utf-8"))
product = product_path.read_text(encoding="utf-8")

missing = sorted(REQUIRED_METADATA - metadata.keys())
if missing:
    fail(f"metadata missing: {', '.join(missing)}")
extra = sorted(metadata.keys() - REQUIRED_METADATA)
if extra:
    fail(f"operational metadata must hold exactly the Afyx Graph fields; unexpected: {', '.join(extra)}")

if metadata["product_name"] != "Afyx Graph" or package["name"] != "@a5zero7/afyx-graph":
    fail("product/package identity mismatch")
if metadata["package"] != package["name"]:
    fail("metadata package differs from package.json name")
if metadata["product_version"] != package["version"]:
    fail("metadata and package versions differ")
if ui_package["name"] != "@a5zero7/afyx-graph-ui" or ui_package["version"] != package["version"]:
    fail("UI package identity/version mismatch")

# CLI: exactly one binary, generated at dist/bin/afyx-graph.js.
if package.get("bin") != {"afyx-graph": "./dist/bin/afyx-graph.js"}:
    fail(f"package bin must expose only afyx-graph -> ./dist/bin/afyx-graph.js, got {package.get('bin')!r}")
if not (ENGINE / "src" / "bin" / "afyx-graph.ts").is_file():
    fail("src/bin/afyx-graph.ts (CLI source) is missing")

# Canonical identity constants: product.ts is the single source of truth.
expected = {
    "PRODUCT_NAME": metadata["product_name"],
    "CLI_NAME": metadata["cli"],
    "MCP_SERVER_NAME": metadata["mcp_server"],
    "STATE_DIR_NAME": metadata["state_directory"],
    "DATABASE_FILE_NAME": metadata["database_filename"],
}
for name, value in expected.items():
    actual = product_constant(product, name)
    if actual != value:
        fail(f"product.ts {name}={actual!r} but metadata declares {value!r}")
if product_constant(product, "ENV_PREFIX") != "AFYX_GRAPH_":
    fail("environment prefix must be AFYX_GRAPH_")
if product_constant(product, "MCP_TOOL_PREFIX") != metadata["mcp_server"] + "_":
    fail("MCP tool prefix must be the MCP server name plus an underscore")
if metadata["state_directory"] != ".afyx-graph" or metadata["database_filename"] != "afyx-graph.db":
    fail("state directory and database filename must be .afyx-graph / afyx-graph.db")

# The repository and engine package use one current Afyx MIT license.
license_text = root_license_path.read_text(encoding="utf-8")
if COPYRIGHT_LINE not in license_text:
    fail(f"current copyright line {COPYRIGHT_LINE!r} is missing from root LICENSE")
for marker in LICENSE_MARKERS:
    if marker not in license_text:
        fail(f"MIT license text is incomplete: missing {marker!r}")
if license_text.splitlines() != engine_license_path.read_text(encoding="utf-8").splitlines():
    fail("engine/LICENSE and root LICENSE must be identical")
for obsolete_path in obsolete_legal_paths:
    if obsolete_path.exists():
        fail(f"obsolete historical legal payload must not exist: {obsolete_path.relative_to(ROOT).as_posix()}")

for package_root in (ROOT, ENGINE):
    package_files = json.loads((package_root / "package.json").read_text(encoding="utf-8"))["files"]
    for entry in package_files:
        if any(obs in str(entry) for obs in ("THIRD_PARTY_NOTICES", "NOTICE")):
            fail(f"forbidden notice in package allowlist: {package_root.relative_to(ROOT).as_posix()}: {entry}")

# Every bundle must ship only the current Afyx license. The artifact plan is
# the source of truth and the shell must consume its legal-file staging command.
bundle_script = bundle_script_path.read_text(encoding="utf-8")
distribution_product = json.loads(distribution_product_path.read_text(encoding="utf-8"))
if distribution_product.get("releaseChannel") != "technical-alpha":
    fail("distribution-product.json must identify the Technical Alpha release channel")
runtime = distribution_product.get("runtime", {})
if runtime != {
    "name": "Node.js",
    "ownership": "external_platform",
    "executable": "node",
    "minimumVersion": "22.5.0",
}:
    fail(f"distribution runtime contract is invalid: {runtime!r}")
if package.get("engines", {}).get("node") != f">={runtime['minimumVersion']}":
    fail("package engine floor differs from the distribution runtime contract")
for forbidden in ("nodejs.org/dist", "npm ci --omit=dev", '"$STAGE/node"', '"$STAGE/node.exe"'):
    if forbidden in bundle_script:
        fail(f"build-bundle.sh still owns a bundled runtime/dependency tree: {forbidden}")
if distribution_product.get("legalFiles") != EXPECTED_LEGAL_FILES:
    fail("distribution-product.json must ship the Afyx license and the verified third-party notice")
for installer in installer_paths:
    installer_text = installer.read_text(encoding="utf-8")
    if installer_legal_requirements[installer.name] not in installer_text:
        fail(f"{installer.name} does not require LICENSE in a staged bundle")
    for obsolete_name in OBSOLETE_LEGAL_NAMES:
        if obsolete_name in installer_text:
            fail(f"{installer.name} still references obsolete legal payload {obsolete_name}")
if "legal-files" not in bundle_script:
    fail("build-bundle.sh does not consume the artifact plan's legal files")
if "npm run build:clean" not in bundle_script:
    fail("build-bundle.sh must not reuse a stale dist directory")
if "deterministic-archive.mjs" not in bundle_script or not archive_script_path.is_file():
    fail("build-bundle.sh does not use the deterministic archive writer")

def check_bundle_legal_payload(archive: Path, names: list[str], read_entry) -> None:
    prefix = archive.name.removesuffix(".zip").removesuffix(".tar.gz")
    expected = {f"{prefix}/LICENSE"}
    normalized_names = [name.replace("\\", "/") for name in names]
    for entry in expected:
        if normalized_names.count(entry) != 1:
            fail(f"{archive.name} must contain one {entry}")
    try:
        bundled_license = read_entry(f"{prefix}/LICENSE").decode("utf-8")
    except UnicodeDecodeError:
        fail(f"{archive.name} has an invalid LICENSE encoding")
    if bundled_license.splitlines() != license_text.splitlines():
        fail(f"{archive.name} does not preserve the current Afyx LICENSE")
    for normalized in normalized_names:
        basename = normalized.rstrip("/").rsplit("/", 1)[-1].upper()
        legal_candidate = basename in {"LICENSE", "NOTICE", "COPYING", "ATTRIBUTION"} or "THIRD_PARTY" in basename
        if legal_candidate and normalized not in expected:
            fail(f"{archive.name} contains obsolete or unexplained legal payload {normalized}")


if release_dir.is_dir():
    for archive in sorted(release_dir.glob("afyx-graph-*")):
        if archive.suffix == ".zip":
            with zipfile.ZipFile(archive) as bundle:
                check_bundle_legal_payload(archive, bundle.namelist(), bundle.read)
        elif archive.name.endswith(".tar.gz"):
            with tarfile.open(archive) as bundle:
                def read_tar_entry(entry: str) -> bytes:
                    member = bundle.getmember(entry)
                    if not member.isfile():
                        fail(f"{archive.name} contains a non-file legal payload: {entry}")
                    with bundle.extractfile(member) as source:
                        return source.read()

                check_bundle_legal_payload(archive, bundle.getnames(), read_tar_entry)

print("Afyx Graph identity, metadata and legal payload: PASS")
