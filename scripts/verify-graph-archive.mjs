import { gunzipSync, inflateRawSync } from 'node:zlib';
import { artifactPlan, DISTRIBUTION_PRODUCT } from '../afyx-graph/engine/scripts/distribution-contract.mjs';
import { GRAPH_PACKAGE_TARGETS, graphArchiveName } from './afyx-graph-targets.mjs';

const MAX_METADATA_BYTES = 16 * 1024;

function safeName(name) {
  const normalized = name.replace(/\/$/, '');
  if (!normalized || name.includes('\\') || name.startsWith('/') || /^[a-z]:/i.test(name) ||
      normalized.split('/').some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error(`Unsafe Graph archive path: ${name}`);
  }
}

export function graphArchiveIdentity(manifest, artifact) {
  if (manifest.schema !== 2) return undefined; // Legacy Alpha.7 manifest contract.
  if (manifest.product !== DISTRIBUTION_PRODUCT.productName ||
      typeof manifest.product_version !== 'string' || !manifest.product_version ||
      !GRAPH_PACKAGE_TARGETS.includes(artifact.target) || artifact.file !== graphArchiveName(artifact.target)) {
    throw new Error('Graph release manifest does not match product or target');
  }
  return { revision: manifest.source_revision, version: manifest.product_version, target: artifact.target };
}

export function verifyGraphArchivePaths(bytes, fileName, identity) {
  let entries = 0;
  let metadata;
  const plan = identity && artifactPlan(identity.target);
  const expectedFiles = new Set(plan ? [plan.launcherPath, 'lib/package.json', 'lib/dist/viewer/index.html',
    ...DISTRIBUTION_PRODUCT.engineSentinels.map((file) => 'lib/dist/' + file),
    ...plan.legalFiles.map((file) => file.bundlePath),
  ].map((file) => plan.bundleName + '/' + file) : []);
  const metadataName = plan && `${plan.bundleName}/metadata.json`;
  const identityError = (reason) => new Error(`Graph archive identity: ${fileName}: ${reason}`);
  const recordMetadata = (data) => {
    if (metadata !== undefined) throw identityError('duplicate metadata');
    try {
      metadata = JSON.parse(data.toString('utf8'));
    } catch {
      throw identityError('invalid metadata JSON');
    }
  };
  if (fileName.endsWith('.tar.gz')) {
    const tar = gunzipSync(bytes);
    for (let offset = 0; offset + 512 <= tar.length;) {
      const header = tar.subarray(offset, offset + 512);
      if (header.every((byte) => byte === 0)) break;
      const field = (start, end) => header.subarray(start, end).toString('utf8').replace(/\0.*$/, '');
      const name = [field(345, 500), field(0, 100)].filter(Boolean).join('/');
      safeName(name);
      const type = header[156];
      if (type !== 0 && type !== 48 && type !== 53) throw new Error(`Unsupported Graph archive entry: ${name}`);
      const sizeText = field(124, 136).trim();
      if (!/^[0-7]+$/.test(sizeText)) throw new Error(`Invalid Graph tar size: ${name}`);
      const size = Number.parseInt(sizeText, 8);
      const dataOffset = offset + 512;
      offset = dataOffset + Math.ceil(size / 512) * 512;
      if (offset > tar.length) throw new Error(`Truncated Graph tar entry: ${name}`);
      if (type !== 53 && size > 0) expectedFiles.delete(name);
      if (name === metadataName) {
        if (type === 53 || size > MAX_METADATA_BYTES) throw identityError('invalid metadata entry');
        recordMetadata(tar.subarray(dataOffset, dataOffset + size));
      }
      entries++;
    }
  } else if (fileName.endsWith('.zip')) {
    let eocd = -1;
    for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
      if (bytes.readUInt32LE(offset) === 0x06054b50) { eocd = offset; break; }
    }
    if (eocd < 0) throw new Error('Graph zip central directory is missing');
    const count = bytes.readUInt16LE(eocd + 10);
    let offset = bytes.readUInt32LE(eocd + 16);
    if (count === 0xffff || offset === 0xffffffff) throw new Error('Unsupported Graph ZIP64 archive');
    for (let index = 0; index < count; index++) {
      if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== 0x02014b50) {
        throw new Error('Invalid Graph zip central directory');
      }
      const nameLength = bytes.readUInt16LE(offset + 28);
      const extraLength = bytes.readUInt16LE(offset + 30);
      const commentLength = bytes.readUInt16LE(offset + 32);
      const end = offset + 46 + nameLength + extraLength + commentLength;
      if (end > bytes.length) throw new Error('Truncated Graph zip entry');
      const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
      safeName(name);
      const localOffset = bytes.readUInt32LE(offset + 42);
      if (localOffset + 30 > bytes.length || bytes.readUInt32LE(localOffset) !== 0x04034b50) {
        throw new Error(`Missing Graph zip local entry: ${name}`);
      }
      const unixType = (bytes.readUInt32LE(offset + 38) >>> 16) & 0o170000;
      if (unixType === 0o120000) throw new Error(`Graph zip symlink is forbidden: ${name}`);
      if (!name.endsWith('/') && bytes.readUInt32LE(offset + 24) > 0) expectedFiles.delete(name);
      if (name === metadataName) {
        const method = bytes.readUInt16LE(offset + 10);
        const compressed = bytes.readUInt32LE(offset + 20);
        const size = bytes.readUInt32LE(offset + 24);
        const localNameLength = bytes.readUInt16LE(localOffset + 26);
        const dataOffset = localOffset + 30 + localNameLength + bytes.readUInt16LE(localOffset + 28);
        if (size > MAX_METADATA_BYTES || compressed > MAX_METADATA_BYTES ||
            dataOffset + compressed > bytes.readUInt32LE(eocd + 16) ||
            bytes.readUInt16LE(localOffset + 8) !== method ||
            bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength).toString('utf8') !== name ||
            ![0, 8].includes(method)) throw identityError('invalid metadata entry');
        const raw = bytes.subarray(dataOffset, dataOffset + compressed);
        const data = method === 8 ? inflateRawSync(raw, { maxOutputLength: MAX_METADATA_BYTES }) : raw;
        if (data.length !== size) throw identityError('invalid metadata size');
        recordMetadata(data);
      }
      entries++;
      offset = end;
    }
  } else {
    throw new Error(`Unsupported Graph archive format: ${fileName}`);
  }
  if (!entries) throw new Error(`Graph archive contains no entries: ${fileName}`);
  if (identity && (metadata?.artifact_identity_schema !== 1 ||
      metadata.product_name !== DISTRIBUTION_PRODUCT.productName ||
      metadata.package !== DISTRIBUTION_PRODUCT.packageName ||
      metadata.cli !== DISTRIBUTION_PRODUCT.cli ||
      metadata.release_channel !== DISTRIBUTION_PRODUCT.releaseChannel ||
      metadata.product_version !== identity.version ||
      metadata.artifact_target !== identity.target ||
      metadata.source_revision !== identity.revision ||
      metadata.build_identity !== `git:${identity.revision}`)) {
    throw identityError('embedded metadata is missing or does not match manifest');
  }
  if (expectedFiles.size) throw identityError(`missing required entries: ${[...expectedFiles].join(', ')}`);
  return entries;
}
