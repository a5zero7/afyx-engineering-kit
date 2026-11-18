import { inflateRawSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let b = 0; b < 8; b++) n = (n & 1) ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Read an admitted ZIP in memory. Never writes/extracts members or follows links. */
export function readArchive(bytes, limits, check) {
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) { end = i; break; }
  }
  if (end < 0) throw new Error('ZIP_DIRECTORY_MISSING');
  const count = bytes.readUInt16LE(end + 10);
  const size = bytes.readUInt32LE(end + 12); const start = bytes.readUInt32LE(end + 16);
  if (bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)
    || bytes.readUInt16LE(end + 8) !== count || count === 65535 || start + size !== end) throw new Error('ZIP_LAYOUT_UNSUPPORTED');
  if (count > limits.maxEntries) throw new Error('ZIP_ENTRY_LIMIT');
  let cursor = start; let expanded = 0;
  const entries = new Map(); const names = new Set(); const ranges = [];
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (let i = 0; i < count; i++) {
    check();
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50) throw new Error('ZIP_DIRECTORY_INVALID');
    const flags = bytes.readUInt16LE(cursor + 8); const method = bytes.readUInt16LE(cursor + 10);
    const crc = bytes.readUInt32LE(cursor + 16); const packed = bytes.readUInt32LE(cursor + 20); const length = bytes.readUInt32LE(cursor + 24);
    const nameSize = bytes.readUInt16LE(cursor + 28); const extraSize = bytes.readUInt16LE(cursor + 30); const commentSize = bytes.readUInt16LE(cursor + 32);
    const attributes = bytes.readUInt32LE(cursor + 38); const local = bytes.readUInt32LE(cursor + 42);
    if (cursor + 46 + nameSize + extraSize + commentSize > end || bytes.readUInt16LE(cursor + 34)) throw new Error('ZIP_DIRECTORY_INVALID');
    const rawName = bytes.subarray(cursor + 46, cursor + 46 + nameSize);
    const name = decoder.decode(rawName);
    if (!(flags & 0x800) && rawName.some((b) => b > 127)) throw new Error('ZIP_NAME_ENCODING_UNSUPPORTED');
    if (!name || name.includes('\\') || /[\x00-\x1f:]/.test(name) || name.startsWith('/') || name.split('/').some((part) => part === '..' || part === '.')
      || names.has(name.toLowerCase())) throw new Error('ZIP_PATH_UNSAFE');
    names.add(name.toLowerCase());
    const unixType = (attributes >>> 16) & 0xf000;
    if (unixType && unixType !== 0x8000 && unixType !== 0x4000) throw new Error('ZIP_SPECIAL_FILE_FORBIDDEN');
    if (/\.(?:exe|dll|com|bat|cmd|ps1|sh|js|mjs|cjs|py|vbs|vba|bin)$/i.test(name)) throw new Error('ZIP_EXECUTABLE_FORBIDDEN');
    if ((flags & ~0x808) || ![0, 8].includes(method)) throw new Error('ZIP_COMPRESSION_UNSUPPORTED');
    if (length > limits.maxEntryBytes || packed > limits.maxInputBytes || (length > 1024 && length / Math.max(1, packed) > 100)) throw new Error('ZIP_EXPANSION_LIMIT');
    expanded += length;
    if (expanded > limits.maxInflatedBytes) throw new Error('ZIP_EXPANSION_LIMIT');
    if (local + 30 > start || bytes.readUInt32LE(local) !== 0x04034b50
      || bytes.readUInt16LE(local + 6) !== flags || bytes.readUInt16LE(local + 8) !== method) throw new Error('ZIP_LOCAL_HEADER_INVALID');
    const localNameSize = bytes.readUInt16LE(local + 26); const localExtra = bytes.readUInt16LE(local + 28);
    const dataStart = local + 30 + localNameSize + localExtra;
    if (!rawName.equals(bytes.subarray(local + 30, local + 30 + localNameSize)) || dataStart + packed > start) throw new Error('ZIP_LOCAL_HEADER_INVALID');
    let dataEnd = dataStart + packed;
    if (flags & 8) {
      if (dataEnd + 12 > start) throw new Error('ZIP_DESCRIPTOR_INVALID');
      if (bytes.readUInt32LE(dataEnd) === 0x08074b50) dataEnd += 4;
      if (dataEnd + 12 > start || bytes.readUInt32LE(dataEnd) !== crc
        || bytes.readUInt32LE(dataEnd + 4) !== packed || bytes.readUInt32LE(dataEnd + 8) !== length) throw new Error('ZIP_DESCRIPTOR_INVALID');
      dataEnd += 12;
    } else if (bytes.readUInt32LE(local + 14) !== crc || bytes.readUInt32LE(local + 18) !== packed
      || bytes.readUInt32LE(local + 22) !== length) throw new Error('ZIP_LOCAL_HEADER_INVALID');
    if (name.endsWith('/') && length) throw new Error('ZIP_DIRECTORY_CONTENT_INVALID');
    if (ranges.some(([a, b]) => local < b && dataEnd > a)) throw new Error('ZIP_OVERLAPPING_ENTRIES');
    ranges.push([local, dataEnd]);
    let content;
    try { content = method === 0 ? Buffer.from(bytes.subarray(dataStart, dataStart + packed))
      : inflateRawSync(bytes.subarray(dataStart, dataStart + packed), { maxOutputLength: Math.max(1, length) }); }
    catch { throw new Error('ZIP_DECOMPRESSION_FAILED'); }
    if (content.length !== length || crc32(content) !== crc) throw new Error('ZIP_CONTENT_INTEGRITY');
    entries.set(name, content);
    cursor += 46 + nameSize + extraSize + commentSize;
  }
  if (cursor !== end) throw new Error('ZIP_DIRECTORY_INVALID');
  return entries;
}
