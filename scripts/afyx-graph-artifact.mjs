#!/usr/bin/env node
/** Canonical Afyx Graph artifact identity shared by Windows and POSIX lifecycle scripts. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

const UNKNOWN = 'UNKNOWN';

function argument(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function revision(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return /^[0-9a-f]{7,64}$/.test(normalized) ? normalized : UNKNOWN;
}

function integer(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function readMetadata(file) {
  return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function writeMetadata(file, metadata) {
  writeFileSync(file, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
}

export function artifactIdentity(metadata) {
  return {
    schema: integer(metadata.artifact_identity_schema),
    productVersion: String(metadata.product_version || ''),
    releaseChannel: String(metadata.release_channel || ''),
    target: String(metadata.artifact_target || UNKNOWN),
    sourceRevision: revision(metadata.source_revision),
    buildIdentity: String(metadata.build_identity || UNKNOWN),
    extractionVersion: integer(metadata.extraction_version),
    provenance: String(metadata.artifact_provenance || UNKNOWN),
    archiveSha256: /^[0-9a-f]{64}$/i.test(String(metadata.archive_sha256 || ''))
      ? String(metadata.archive_sha256).toLowerCase()
      : UNKNOWN,
    requestedCheckoutRevision: revision(metadata.requested_checkout_revision),
    releaseManifestStatus: String(metadata.release_manifest_status || 'MISSING'),
    publisherAuthenticity: String(metadata.publisher_authenticity || 'UNVERIFIED'),
    buildProvenance: String(metadata.build_provenance || 'UNVERIFIED'),
  };
}

export function stampArtifact(metadata, fields) {
  const sourceRevision = revision(fields.revision);
  return {
    ...metadata,
    artifact_identity_schema: 1,
    artifact_target: fields.target,
    source_revision: sourceRevision,
    build_identity: sourceRevision === UNKNOWN ? UNKNOWN : `git:${sourceRevision}`,
    extraction_version: integer(fields.extractionVersion),
  };
}

export function revisionStatus(identity, requested) {
  const wanted = revision(requested);
  if (wanted === UNKNOWN || identity.sourceRevision === UNKNOWN) return 'UNKNOWN';
  return identity.sourceRevision === wanted ? 'MATCH' : 'REVISION_MISMATCH';
}

export function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function requireValue(value, name) {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function releaseManifest(directory, fields) {
  const sourceRevision = revision(fields.revision);
  if (sourceRevision === UNKNOWN) throw new Error('--revision must be a Git commit');
  const artifacts = readdirSync(directory)
    .filter((name) => /^afyx-graph-(?:win32|linux|darwin)-(?:x64|arm64)\.(?:zip|tar\.gz)$/.test(name))
    .sort()
    .map((name) => ({
      file: name,
      target: name.match(/^afyx-graph-(.+?)\.(?:zip|tar\.gz)$/)[1],
      sha256: sha256(join(directory, name)),
    }));
  if (artifacts.length === 0) throw new Error('release directory has no Afyx Graph archives');
  return {
    schema: 1,
    product: 'Afyx Graph',
    product_version: requireValue(fields.version, '--version'),
    release_tag: requireValue(fields.tag, '--tag'),
    source_revision: sourceRevision,
    integrity_claim: 'sha256',
    publisher_authenticity: 'requires-independent-attestation',
    artifacts,
  };
}

function verifyReleaseManifest(manifestFile, archiveFile, metadataFile) {
  const manifest = readMetadata(manifestFile);
  const metadata = readMetadata(metadataFile);
  const identity = artifactIdentity(metadata);
  if (manifest.schema !== 1 || manifest.product !== 'Afyx Graph') throw new Error('release manifest schema or product mismatch');
  const name = basename(archiveFile);
  const entry = Array.isArray(manifest.artifacts) ? manifest.artifacts.find((item) => item.file === name) : null;
  if (!entry || !/^[0-9a-f]{64}$/i.test(String(entry.sha256 || ''))) throw new Error(`release manifest has no valid entry for ${name}`);
  if (sha256(archiveFile) !== String(entry.sha256).toLowerCase()) throw new Error('release manifest archive digest mismatch');
  if (entry.target !== identity.target) throw new Error('release manifest target does not match artifact metadata');
  if (revision(manifest.source_revision) === UNKNOWN || revision(manifest.source_revision) !== identity.sourceRevision) throw new Error('release manifest revision does not match artifact metadata');
  if (String(manifest.product_version || '') !== identity.productVersion) throw new Error('release manifest version does not match artifact metadata');
  return { status: 'VERIFIED', sourceRevision: identity.sourceRevision, target: identity.target, archiveSha256: entry.sha256 };
}

try {
  const command = process.argv[2];
  const file = argument('--metadata');
  if (command === 'create-release-manifest') {
    const directory = requireValue(argument('--directory'), '--directory');
    const output = requireValue(argument('--output'), '--output');
    const manifest = releaseManifest(directory, {
      revision: argument('--revision'), version: argument('--version'), tag: argument('--tag'),
    });
    writeMetadata(output, manifest);
    console.log(JSON.stringify(manifest));
  } else if (command === 'verify-release-manifest') {
    console.log(JSON.stringify(verifyReleaseManifest(
      requireValue(argument('--manifest'), '--manifest'),
      requireValue(argument('--archive'), '--archive'),
      requireValue(file, '--metadata'),
    )));
  } else if (command === 'stamp') {
    const stamped = stampArtifact(readMetadata(file), {
      target: requireValue(argument('--target'), '--target'),
      revision: argument('--revision', UNKNOWN),
      extractionVersion: requireValue(argument('--extraction-version'), '--extraction-version'),
    });
    writeMetadata(file, stamped);
    console.log(JSON.stringify(artifactIdentity(stamped)));
  } else if (command === 'inspect') {
    const identity = artifactIdentity(readMetadata(file));
    const requested = argument('--requested-revision', UNKNOWN);
    console.log(JSON.stringify({ ...identity, revisionStatus: revisionStatus(identity, requested) }));
  } else if (command === 'require-revision') {
    const identity = artifactIdentity(readMetadata(file));
    const requested = requireValue(argument('--requested-revision'), '--requested-revision');
    const status = revisionStatus(identity, requested);
    console.log(JSON.stringify({ ...identity, revisionStatus: status }));
    if (status !== 'MATCH') process.exitCode = status === 'REVISION_MISMATCH' ? 3 : 4;
  } else if (command === 'record-install') {
    const metadata = readMetadata(file);
    const archive = requireValue(argument('--archive'), '--archive');
    const requested = argument('--requested-revision', UNKNOWN);
    const updated = {
      ...metadata,
      artifact_provenance: requireValue(argument('--provenance'), '--provenance'),
      archive_sha256: sha256(archive),
      requested_checkout_revision: revision(requested),
      revision_status: revisionStatus(artifactIdentity(metadata), requested),
      release_manifest_status: argument('--release-manifest-status', 'MISSING'),
      publisher_authenticity: argument('--publisher-authenticity', 'UNVERIFIED'),
      build_provenance: argument('--build-provenance', 'UNVERIFIED'),
    };
    writeMetadata(file, updated);
    console.log(JSON.stringify(artifactIdentity(updated)));
  } else {
    throw new Error('usage: afyx-graph-artifact.mjs create-release-manifest|verify-release-manifest|stamp|inspect|require-revision|record-install [options]');
  }
} catch (error) {
  console.error(`[artifact] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
