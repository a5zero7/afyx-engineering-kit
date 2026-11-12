import { gunzipSync } from 'node:zlib';

function safeName(name) {
  const normalized = name.replace(/\/$/, '');
  if (!normalized || name.includes('\\') || name.startsWith('/') || /^[a-z]:/i.test(name) ||
      normalized.split('/').some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error(`Unsafe Graph archive path: ${name}`);
  }
}

export function verifyGraphArchivePaths(bytes, fileName) {
  let entries = 0;
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
      offset += 512 + Math.ceil(size / 512) * 512;
      if (offset > tar.length) throw new Error(`Truncated Graph tar entry: ${name}`);
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
      entries++;
      offset = end;
    }
  } else {
    throw new Error(`Unsupported Graph archive format: ${fileName}`);
  }
  if (!entries) throw new Error(`Graph archive contains no entries: ${fileName}`);
  return entries;
}
