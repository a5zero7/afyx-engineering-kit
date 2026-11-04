#!/usr/bin/env node
/**
 * Afyx Forge Core — Deterministic Release Artifact & Integrity Stager
 *
 * Stages a self-contained Afyx Forge Core runtime bundle into <stage>/current,
 * creates top-level bin launchers (<stage>/bin/afyx-forge and afyx-forge.cmd),
 * writes <stage>/current/identity.json and <stage>/metadata.json bound to the
 * exact source revision and artifact digest, and emits <stage>/integrity.sha256.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = "true";
    }
  }
  return out;
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    const stat = fs.lstatSync(srcPath);
    if (stat.isSymbolicLink()) {
      throw new Error(`Refusing to package symbolic link in Afyx Forge artifact: ${srcPath}`);
    }
    if (entry.isDirectory()) {
      copyTree(srcPath, dstPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

function collectFiles(root, prefix = "") {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(full, rel));
    } else if (entry.isFile()) {
      files.push(rel);
    }
  }
  return files.sort();
}

const args = parseArgs(process.argv.slice(2));
const sourceRoot = path.resolve(args["source-root"] || "");
const stageDir = path.resolve(args["stage-dir"] || "");
const runtimeRoot = args["runtime-root"] ? path.resolve(args["runtime-root"]) : stageDir;
const revision = args.revision || "unknown";
const provenance = args.provenance || "LOCAL_SOURCE_CLEAN";
const installedAt = args["installed-at"] || new Date().toISOString();

if (!args["source-root"] || !args["stage-dir"]) {
  console.error(
    "Usage: node scripts/afyx-forge-artifact.mjs --source-root <dir> --stage-dir <dir> [--runtime-root <dir>] [--revision <sha>] [--provenance <tag>] [--installed-at <iso>]"
  );
  process.exit(2);
}

const manifestPath = path.join(sourceRoot, "afyx-forge.json");
const packagePath = path.join(sourceRoot, "package.json");
if (!fs.existsSync(manifestPath) || !fs.existsSync(packagePath)) {
  console.error(`Missing Afyx Forge source manifests in ${sourceRoot}`);
  process.exit(2);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));

if (manifest.product_name !== "Afyx Forge Core" || manifest.product_version !== pkg.version) {
  console.error("Afyx Forge manifest and package.json version/identity mismatch.");
  process.exit(2);
}
if (
  manifest.component_id !== "afyx-forge" ||
  manifest.runtime_mode !== "ASSISTIVE_GUIDANCE_ONLY" ||
  manifest.evaluation_gate?.status !== "EVALUATION_GATED" ||
  manifest.evaluation_gate?.autonomous_code_execution !== false
) {
  console.error("Afyx Forge manifest violates bounded assistive-guidance governance invariants.");
  process.exit(2);
}

const currentDir = path.join(stageDir, "current");
const binDir = path.join(stageDir, "bin");
fs.mkdirSync(currentDir, { recursive: true });
fs.mkdirSync(binDir, { recursive: true });

fs.copyFileSync(packagePath, path.join(currentDir, "package.json"));
fs.copyFileSync(manifestPath, path.join(currentDir, "afyx-forge.json"));
copyTree(path.join(sourceRoot, "contracts"), path.join(currentDir, "contracts"));
copyTree(path.join(sourceRoot, "src"), path.join(currentDir, "src"));
copyTree(path.join(sourceRoot, "bin"), path.join(currentDir, "bin"));

const currentUnixBin = path.join(currentDir, "bin", "afyx-forge");
if (fs.existsSync(currentUnixBin)) {
  fs.chmodSync(currentUnixBin, 0o755);
}

const identity = {
  product_name: manifest.product_name,
  product_version: manifest.product_version,
  component_id: manifest.component_id,
  source_revision: revision,
  ownership_class: "AFYX",
  build_provenance: provenance,
  release_channel: manifest.distribution_channel || "technical-alpha",
  runtime_mode: manifest.runtime_mode,
  governance_state: manifest.evaluation_gate.status,
};
fs.writeFileSync(path.join(currentDir, "identity.json"), `${JSON.stringify(identity, null, 2)}\n`, "utf8");

const files = collectFiles(currentDir);
const checksumLines = files.map((rel) => `${sha256File(path.join(currentDir, rel))}  current/${rel}`);
const integrityPath = path.join(stageDir, "integrity.sha256");
fs.writeFileSync(integrityPath, `${checksumLines.join("\n")}\n`, "utf8");

const artifactDigest = sha256File(integrityPath);

const topCmdWrapper = `@echo off\r\nnode "%~dp0..\\current\\bin\\afyx-forge.js" %*\r\n`;
fs.writeFileSync(path.join(binDir, "afyx-forge.cmd"), topCmdWrapper, "ascii");

const topShWrapper = `#!/usr/bin/env bash\nDIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"\nexec node "$DIR/../current/bin/afyx-forge.js" "$@"\n`;
const topShPath = path.join(binDir, "afyx-forge");
fs.writeFileSync(topShPath, topShWrapper, "utf8");
fs.chmodSync(topShPath, 0o755);

const metadata = {
  schema_version: 1,
  product_name: manifest.product_name,
  product_version: manifest.product_version,
  component_id: manifest.component_id,
  ownership_class: "AFYX",
  distribution_channel: manifest.distribution_channel || "technical-alpha",
  release_channel: manifest.distribution_channel || "technical-alpha",
  runtime_mode: manifest.runtime_mode,
  governance_state: manifest.evaluation_gate.status,
  source_revision: revision,
  build_provenance: provenance,
  artifact_digest: artifactDigest,
  installed_at: installedAt,
  runtime_root: runtimeRoot,
};
fs.writeFileSync(path.join(stageDir, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");

