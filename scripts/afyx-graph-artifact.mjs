#!/usr/bin/env node
/** Canonical Afyx Graph artifact identity shared by Windows and POSIX lifecycle scripts. */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { closeSync, constants, fstatSync, openSync, readSync, readFileSync, writeFileSync, readdirSync, statSync, realpathSync } from 'node:fs';
import { basename, delimiter, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

function verifyReleaseArchive(manifestFile, archiveFile) {
  const manifest = readMetadata(manifestFile);
  if (![1, 2].includes(manifest.schema) || manifest.product !== 'Afyx Graph') throw new Error('release manifest schema or product mismatch');
  const name = basename(archiveFile);
  const entries = Array.isArray(manifest.artifacts) ? manifest.artifacts.filter((item) => item?.file === name) : [];
  const entry = entries.length === 1 ? entries[0] : null;
  if (!entry || !/^[0-9a-f]{64}$/i.test(String(entry.sha256 || ''))) throw new Error(`release manifest has no valid entry for ${name}`);
  if (sha256(archiveFile) !== String(entry.sha256).toLowerCase()) throw new Error('release manifest archive digest mismatch');
  return { manifest, entry };
}

function verifyReleaseManifest(manifestFile, archiveFile, metadataFile) {
  const { manifest, entry } = verifyReleaseArchive(manifestFile, archiveFile);
  const identity = artifactIdentity(readMetadata(metadataFile));
  if (entry.target !== identity.target) throw new Error('release manifest target does not match artifact metadata');
  if (revision(manifest.source_revision) === UNKNOWN || revision(manifest.source_revision) !== identity.sourceRevision) throw new Error('release manifest revision does not match artifact metadata');
  if (String(manifest.product_version || '') !== identity.productVersion) throw new Error('release manifest version does not match artifact metadata');
  return { status: 'VERIFIED', sourceRevision: identity.sourceRevision, target: identity.target, archiveSha256: entry.sha256 };
}

const RELEASE_REPOSITORY = 'a5zero7/afyx-engineering-kit';
const RELEASE_WORKFLOW = RELEASE_REPOSITORY + '/.github/workflows/graph-release.yml';
const SLSA_PREDICATE = 'https://slsa.dev/provenance/v1';

function findGitHubCli() {
  const executable = process.platform === 'win32' ? 'gh.exe' : 'gh';
  for (const dir of (process.env.PATH || '').split(delimiter).filter(isAbsolute).slice(0, 128)) {
    try {
      const path = realpathSync(join(dir, executable));
      if (statSync(path).isFile()) return path;
    } catch {}
  }
}

export function verifyArtifactAttestation(archive, identity, {
  mode = 'optional', offline = false, executable = findGitHubCli(), run = spawnSync,
} = {}) {
  const result = (status, reason) => ({ status, reason, accepted: status === 'VERIFIED' ||
    (mode === 'optional' && status.startsWith('SKIPPED_')) });
  if (offline) return result('SKIPPED_OFFLINE', 'ATTESTATION_OFFLINE');
  if (!executable) return result('SKIPPED_GH_UNAVAILABLE', 'ATTESTATION_UNAVAILABLE');
  const args = ['attestation', 'verify'];
  const options = { env: { ...process.env, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1',
    GH_NO_EXTENSION_UPDATE_NOTIFIER: '1' }, timeout: 15000, killSignal: 'SIGKILL',
    maxBuffer: 2 * 1024 * 1024, encoding: 'utf8', shell: false, windowsHide: true };
  try {
    const help = run(executable, [...args, '--help'], options);
    if (help.error || help.status !== 0 || !['--repo', '--signer-workflow', '--source-digest', '--format', '--predicate-type', '--hostname']
      .every(flag => typeof help.stdout === 'string' && help.stdout.includes(flag))) {
      return result('SKIPPED_GH_UNAVAILABLE', 'ATTESTATION_REQUIRED_FLAGS_UNAVAILABLE');
    }
    if (!/^[0-9a-f]{40}$/.test(identity?.sourceRevision ?? '') ||
        !/^[0-9a-f]{64}$/i.test(identity?.archiveSha256 ?? '') ||
        sha256(archive) !== identity.archiveSha256.toLowerCase()) {
      return result('FAILED', 'ATTESTATION_ARTIFACT_IDENTITY_MISMATCH');
    }
    const verification = run(executable, [...args, resolve(archive), '--repo', RELEASE_REPOSITORY,
      '--hostname', 'github.com', '--signer-workflow', RELEASE_WORKFLOW,
      '--source-digest', identity.sourceRevision, '--predicate-type', SLSA_PREDICATE, '--format', 'json'], options);
    if (verification.status !== 0 || verification.error) {
      const stderr = verification.stderr ?? '';
      const reason = /no attestations? found|attestations? not found/i.test(stderr) ? 'ATTESTATION_MISSING' :
        /auth|login|401/i.test(stderr) ? 'ATTESTATION_AUTH_REQUIRED' :
        /network|timeout|connection|HTTP 5\d\d|rate limit/i.test(stderr) || verification.error?.code === 'ETIMEDOUT'
          ? 'ATTESTATION_SERVICE_ERROR' : 'ATTESTATION_VERIFICATION_FAILED';
      return result('FAILED', reason);
    }
    // gh enforces source digest and workflow against the verified signing
    // certificate. Only examine the statement from that verification result.
    const statements = JSON.parse(verification.stdout);
    if (!Array.isArray(statements) || !statements.some(item => {
      const statement = item?.verificationResult?.statement;
      return statement?.predicateType === SLSA_PREDICATE && Array.isArray(statement.subject) &&
        statement.subject.some(subject => subject?.digest?.sha256 === identity.archiveSha256.toLowerCase());
    }) || sha256(archive) !== identity.archiveSha256.toLowerCase()) {
      return result('FAILED', 'ATTESTATION_SUBJECT_MISMATCH');
    }
    return result('VERIFIED', null);
  } catch {
    return result('FAILED', 'ATTESTATION_VERIFICATION_FAILED');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
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
    } else if (command === 'verify-release-archive') {
      const { entry } = verifyReleaseArchive(
        requireValue(argument('--manifest'), '--manifest'), requireValue(argument('--archive'), '--archive'),
      );
      if (entry.target !== requireValue(argument('--target'), '--target')) {
        throw new Error('release manifest target does not match the installer target');
      }
    } else if (command === 'verify-release-manifest') {
      console.log(JSON.stringify(verifyReleaseManifest(
        requireValue(argument('--manifest'), '--manifest'),
        requireValue(argument('--archive'), '--archive'),
        requireValue(file, '--metadata'),
      )));
    } else if (command === 'verify-attestation') {
      const mode = argument('--mode');
      if (!['optional', 'required'].includes(mode)) throw new Error('Invalid attestation mode');
      const archive = requireValue(argument('--archive'), '--archive');
      const manifest = argument('--manifest');
      let identity = null;
      if (manifest && file) {
        try {
          identity = verifyReleaseManifest(manifest, archive, file);
        } catch {
          throw new Error('ATTESTATION_ARTIFACT_IDENTITY_MISMATCH');
        }
      }
      const result = verifyArtifactAttestation(archive, identity, { mode, offline: argument('--offline') === 'true' });
      console.log(result.status);
      if (result.reason) console.error('[' + result.reason + ']');
      if (!result.accepted) process.exitCode = 1;
    } else if (command === 'read-extraction-version') {
      const path = requireValue(argument('--compiled'), '--compiled');
      const file = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      try {
        const info = fstatSync(file);
        if (!info.isFile() || info.size > 32768) throw new Error('Invalid compiled extraction identity file');
        const bytes = Buffer.alloc(32769);
        const count = readSync(file, bytes, 0, bytes.length, 0);
        if (count !== info.size) throw new Error('Compiled extraction identity file changed');
        const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, count));
        const assignments = [...source.matchAll(/^[ \t]*exports\.EXTRACTION_VERSION[ \t]*=[ \t]*([1-9][0-9]{0,8});[ \t]*\r?$/gm)];
        if (assignments.length !== 1) throw new Error('Missing or ambiguous compiled extraction identity');
        console.log(assignments[0][1]);
      } finally {
        closeSync(file);
      }
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
      throw new Error('usage: afyx-graph-artifact.mjs create-release-manifest|verify-release-archive|verify-release-manifest|stamp|inspect|require-revision|record-install [options]');
    }
  } catch (error) {
    console.error(`[artifact] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
