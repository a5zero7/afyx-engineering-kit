#!/usr/bin/env node
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import { artifactPlan } from './distribution-contract.mjs';

const ZIP_DATE_1980_01_01 = 0x0021;
const UTF8_FLAG = 0x0800;
const CRC_TABLE = Array.from({ length: 256 }, (_, start) => {
  let value = start;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  }
  return value >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function collectFiles(source) {
  const root = resolve(source);
  const rootName = basename(root);
  const files = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    const entries = readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      const absolute = join(directory, entry.name);
      const stats = lstatSync(absolute);
      if (stats.isSymbolicLink()) throw new Error(`archive source must not contain symlinks: ${absolute}`);
      if (stats.isDirectory()) pending.push(absolute);
      else if (stats.isFile()) {
        const path = `${rootName}/${relative(root, absolute).split(sep).join('/')}`;
        files.push({
          path,
          bytes: readFileSync(absolute),
          mode: (stats.mode & 0o111) === 0 ? 0o644 : 0o755,
        });
      } else throw new Error(`archive source contains an unsupported entry: ${absolute}`);
    }
  }
  return files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

function zipArchive(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.path, 'utf8');
    const compressed = deflateRawSync(file.bytes, { level: 9 });
    const crc = crc32(file.bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(ZIP_DATE_1980_01_01, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(file.bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(UTF8_FLAG, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(ZIP_DATE_1980_01_01, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(file.bytes.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(((0o100000 | file.mode) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  if (files.length > 0xffff || offset > 0xffffffff) throw new Error('archive exceeds ZIP32 limits');
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function octal(value, length) {
  const rendered = value.toString(8);
  if (rendered.length > length - 1) throw new Error(`tar numeric field overflow: ${value}`);
  return `${rendered.padStart(length - 1, '0')}\0`;
}

function tarName(path) {
  if (Buffer.byteLength(path) <= 100) return { name: path, prefix: '' };
  for (let slash = path.lastIndexOf('/'); slash > 0; slash = path.lastIndexOf('/', slash - 1)) {
    const prefix = path.slice(0, slash);
    const name = path.slice(slash + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) return { name, prefix };
  }
  throw new Error(`archive path exceeds ustar limits: ${path}`);
}

function writeText(buffer, value, offset, length) {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length > length) throw new Error(`tar field exceeds ${length} bytes: ${value}`);
  bytes.copy(buffer, offset);
}

function tarArchive(files) {
  const parts = [];
  for (const file of files) {
    const split = tarName(file.path);
    const header = Buffer.alloc(512);
    writeText(header, split.name, 0, 100);
    writeText(header, octal(file.mode, 8), 100, 8);
    writeText(header, octal(0, 8), 108, 8);
    writeText(header, octal(0, 8), 116, 8);
    writeText(header, octal(file.bytes.length, 12), 124, 12);
    writeText(header, octal(0, 12), 136, 12);
    header.fill(0x20, 148, 156);
    header[156] = 0x30;
    writeText(header, 'ustar\0', 257, 6);
    writeText(header, '00', 263, 2);
    writeText(header, split.prefix, 345, 155);
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    writeText(header, `${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8);
    const padding = Buffer.alloc((512 - (file.bytes.length % 512)) % 512);
    parts.push(header, file.bytes, padding);
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

function deterministicGzip(bytes) {
  const header = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff]);
  const body = deflateRawSync(bytes, { level: 9 });
  const trailer = Buffer.alloc(8);
  trailer.writeUInt32LE(crc32(bytes), 0);
  trailer.writeUInt32LE(bytes.length >>> 0, 4);
  return Buffer.concat([header, body, trailer]);
}

export function createDeterministicArchive({ source, target, output }) {
  if (!source) throw new Error('archive source is required');
  if (!output) throw new Error('archive output is required');
  const family = artifactPlan(String(target || '')).family;
  const sourceRoot = resolve(source);
  const destination = resolve(output);
  if (destination === sourceRoot || destination.startsWith(`${sourceRoot}${sep}`)) {
    throw new Error('archive output must be outside the source tree');
  }
  const files = collectFiles(sourceRoot);
  if (files.length === 0) throw new Error('archive source contains no files');
  const bytes = family === 'win32' ? zipArchive(files) : deterministicGzip(tarArchive(files));
  mkdirSync(dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp-${process.pid}`;
  let temporaryCreated = false;
  try {
    writeFileSync(temporary, bytes, { flag: 'wx' });
    temporaryCreated = true;
    renameSync(temporary, destination);
    temporaryCreated = false;
  } finally {
    if (temporaryCreated) rmSync(temporary, { force: true });
  }
  return { bytes: bytes.length, entries: files.length };
}

function argument(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : '';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = createDeterministicArchive({
      source: argument('--source'),
      target: argument('--target'),
      output: argument('--output'),
    });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(`[archive] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
