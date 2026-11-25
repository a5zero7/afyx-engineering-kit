/** Copyright (c) 2026 Afyx */
import { closeSync, fstatSync, lstatSync, openSync, opendirSync, readSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { isInsideRoot } from '../utils';

export const MAX_AUTO_DISCOVERED_PEERS = 16;
const MAX_ENTRIES = 512;
const MAX_BYTES = 64 * 1024;
const MAX_PATTERNS = 32;
const PROTECTED = /^(?:[._]|node_modules$|testing$|progres$|archives?$|(?:temp|tmp|backup|dist|build|target|vendor|coverage)(?:$|[-_]))/i;
const PLAIN = /^[a-z0-9_-][a-z0-9_.-]*$/i;
const MARKER = /^(?:package\.json|go\.mod|Cargo\.toml|openapi\.[\w-]+|[^.].*\.(?:proto|graphql))$/;

export const peerIdentity = (path: string) => process.platform === 'win32' ? path.toLowerCase() : path;

function canonicalDirectory(parent: string, parts: string[]): string | undefined {
  let path = parent;
  for (const part of parts) {
    if (!PLAIN.test(part) || PROTECTED.test(part)) return;
    path = join(path, part);
    try {
      const entry = lstatSync(path);
      if (entry.isSymbolicLink() || !entry.isDirectory() || peerIdentity(realpathSync(path)) !== peerIdentity(path)) return;
    } catch { return; }
  }
  return path;
}

function workspacePatterns(name: string, content: string): string[] | undefined {
  if (name === 'package.json') {
    const value = JSON.parse(content);
    const patterns = Array.isArray(value?.workspaces) ? value.workspaces : value?.workspaces?.packages;
    return patterns === undefined ? [] : Array.isArray(patterns) && patterns.every(x => typeof x === 'string') ? patterns : undefined;
  }
  if (name === 'Cargo.toml') {
    const workspace = /^[ \t]*\[workspace\][ \t]*\r?\n([^]*?)(?=^[ \t]*\[|(?![^]))/m.exec(content)?.[1];
    if (workspace === undefined) return [];
    const lines = workspace.replace(/#[^\r\n]*/g, '');
    if (/^\s*exclude\s*=/m.test(lines)) return;
    const members = /^\s*members\s*=\s*\[([^\]]*)\]/m.exec(lines)?.[1];
    if (members === undefined) return /^\s*members\s*=/m.test(lines) ? undefined : [];
    return members.split(',').map(x => x.trim()).filter(Boolean).map(x => /^["']([\w.*/-]+)["']$/.exec(x)?.[1] ?? '!');
  }
  const patterns: string[] = [];
  let active = false;
  const pnpm = name === 'pnpm-workspace.yaml';
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#') || (!pnpm && line.startsWith('//'))) continue;
    if (pnpm ? /^packages\s*:/.test(line) : line === 'use (') {
      if (pnpm && line !== 'packages:') return;
      active = true;
      continue;
    }
    if (!pnpm && line === ')') { active = false; continue; }
    if (pnpm && !/^\s/.test(raw)) active = false;
    if (!active && (pnpm || !/^use\b/.test(line))) continue;
    const item = pnpm ? /^-\s+(.+)$/.exec(line)?.[1] :
      active ? line : /^use\s+(.+)$/.exec(line)?.[1];
    if (!item) return;
    const plain = /^(['"])(.*)\1$/.exec(item)?.[2] ?? item;
    if (pnpm && plain.startsWith('!')) return;
    patterns.push(plain);
  }
  if (!pnpm && active) return;
  return patterns;
}

export function discoverPeers(root: string, authorizedRoot: string, skip: (reason: string) => void) {
  const result = { paths: [] as string[], truncated: false, boundary: undefined as string | undefined };
  let boundary;
  try {
    if (!isAbsolute(authorizedRoot) || lstatSync(resolve(authorizedRoot)).isSymbolicLink()) throw new Error();
    boundary = realpathSync(authorizedRoot);
    if (![root, dirname(root)].map(peerIdentity).includes(peerIdentity(boundary)) ||
        boundary === dirname(boundary) || boundary.split(sep).slice(1).some(part =>
          /^(?:\.(?:git|rea_source|codex|claude|gemini|afyx|agents)|node_modules|testing|progres|_afyx-private-archive)$/i.test(part))) throw new Error();
  } catch {
    skip('PEER_DISCOVERY_SCOPE_INVALID');
    return result;
  }
  result.boundary = boundary;
  const deadline = performance.now() + 1000;
  let remaining = MAX_ENTRIES;
  let patternCount = 0;
  const candidates = new Map<string, string>();
  const bounded = () => {
    if (remaining > 0 && performance.now() < deadline) return false;
    result.truncated = true;
    return true;
  };
  const entries = (path: string) => {
    const names: string[] = [];
    if (bounded()) return names;
    try {
      const dir = opendirSync(path);
      try {
        for (let item; !bounded() && (item = dir.readSync());) {
          --remaining;
          names.push(item.name);
        }
      } finally { dir.closeSync(); }
    } catch { skip('PEER_DISCOVERY_UNREADABLE'); }
    return bounded() ? [] : names.sort();
  };
  const candidate = (parts: string[]) => {
    const path = canonicalDirectory(boundary, parts);
    if (!path || peerIdentity(path) === peerIdentity(root) || candidates.has(peerIdentity(path))) return;
    if (entries(path).some(name => {
      if (!MARKER.test(name)) return false;
      try {
        const file = lstatSync(join(path, name), { throwIfNoEntry: false });
        return file?.isFile() && !file.isSymbolicLink();
      } catch { return false; }
    })) candidates.set(peerIdentity(path), path);
  };
  for (const name of ['pnpm-workspace.yaml', 'package.json', 'go.work', 'Cargo.toml']) {
    if (bounded()) break;
    const path = join(boundary, name);
    try {
      const before = lstatSync(path, { throwIfNoEntry: false });
      if (!before) continue;
      if (!before.isFile() || before.isSymbolicLink() || before.size > MAX_BYTES) throw new Error();
      const fd = openSync(path, 'r');
      let patterns: string[] | undefined;
      try {
        const stat = fstatSync(fd);
        if (before.ino !== stat.ino || before.dev !== stat.dev || !isInsideRoot(boundary, realpathSync(path))) throw new Error();
        const bytes = Buffer.alloc(MAX_BYTES + 1);
        const count = readSync(fd, bytes, 0, bytes.length, 0);
        if (count !== stat.size || count > MAX_BYTES || fstatSync(fd).mtimeMs !== stat.mtimeMs) throw new Error();
        patterns = workspacePatterns(name, bytes.subarray(0, count).toString('utf8'));
      } finally { closeSync(fd); }
      if (!patterns) throw new Error();
      for (const pattern of patterns) {
        if (bounded() || patternCount++ >= MAX_PATTERNS) { result.truncated = true; break; }
        const parts = pattern.replace(/^\.\//, '').replace(/\/$/, '').split('/');
        const wildcard = parts.at(-1) === '*';
        const base = wildcard ? parts.slice(0, -1) : parts;
        if (!parts.length || parts.length > 4 || base.some(part => !PLAIN.test(part) || PROTECTED.test(part))) {
          skip('PEER_WORKSPACE_PATTERN_UNSUPPORTED');
          continue;
        }
        if (!wildcard) { candidate(parts); continue; }
        const directory = canonicalDirectory(boundary, base);
        if (directory) for (const child of entries(directory)) candidate([...base, child]);
      }
    } catch { skip('PEER_WORKSPACE_MANIFEST_UNSUPPORTED'); }
  }
  for (const child of entries(boundary)) candidate([child]);
  const sorted = [...candidates.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  result.truncated ||= sorted.length > MAX_AUTO_DISCOVERED_PEERS;
  result.paths = sorted.slice(0, MAX_AUTO_DISCOVERED_PEERS).map(([, path]) => path);
  return result;
}
