/** Copyright (c) 2026 Afyx */
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { QueryBuilder } from '../db/queries';
import { createDatabase } from '../db/sqlite-adapter';
import { getDatabasePath, getAfyxGraphDir } from '../directory';
import { hashContent } from '../extraction/content-hash';
import { getFreshness } from '../freshness';
import type { Node } from '../types';
import { isInsideRoot, validatePathWithinRoot } from '../utils';

const MANIFEST = 'afyx-contracts.json';
const MAX_PEERS = 8;
const MAX_ROWS = 128;
const MAX_FILE_BYTES = 1024 * 1024;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/;
export const CROSS_REPO_CONTRACT = 'AfyxCrossRepoContractImpact/v1';

type Endpoint = { file: string; symbol: string };
type Binding = { producer: string; contract: Endpoint; consumer: Endpoint };
type Manifest = { repository: string; consumes: Binding[] };
export type ContractCitation = Endpoint & { repository: string; line: number };
type Link = { provenance: 'cross-repo-contract' | 'indexed-call'; from: ContractCitation; to: ContractCitation; depth: number };

function endpoint(value: unknown): value is Endpoint {
  if (!value || typeof value !== 'object') return false;
  const { file, symbol } = value as Endpoint;
  return typeof file === 'string' && file.length <= 240 && /^[\w./-]+$/.test(file) &&
    !file.startsWith('/') && file.split('/').every(part => part && part !== '.' && part !== '..') &&
    typeof symbol === 'string' && symbol.length > 0 && symbol.length <= 256 && !/[\u0000-\u001f\u007f]/.test(symbol);
}

function manifest(root: string): { value: Manifest; source: string } | undefined {
  try {
    const path = validatePathWithinRoot(root, MANIFEST);
    if (!path || lstatSync(join(root, MANIFEST)).isSymbolicLink() || statSync(path).size > 64 * 1024) return;
    const source = readFileSync(path, 'utf8');
    const value = JSON.parse(source) as Manifest;
    if (!value || !ID.test(value.repository) || typeof value.repository !== 'string' ||
        !Array.isArray(value.consumes) || value.consumes.length > MAX_ROWS ||
        !value.consumes.every(item => item && typeof item.producer === 'string' && ID.test(item.producer) &&
          endpoint(item.contract) && endpoint(item.consumer))) return;
    return { value, source };
  } catch {
    return;
  }
}

function realPeer(parent: string, root: string, input: string): string | undefined {
  if (typeof input !== 'string' || !input || input.length > 1024) return;
  try {
    const requested = isAbsolute(input) ? resolve(input) : resolve(parent, input);
    if (dirname(requested) !== parent || lstatSync(requested).isSymbolicLink()) return;
    const peer = realpathSync(requested);
    if (peer !== requested || peer === root || !statSync(peer).isDirectory()) return;
    const directory = getAfyxGraphDir(peer);
    if (realpathSync(directory) !== directory || !isInsideRoot(peer, directory)) return;
    const db = getDatabasePath(peer);
    for (const file of [db, db + '-wal', db + '-shm', join(directory, 'freshness.json')]) {
      const stat = lstatSync(file, { throwIfNoEntry: false });
      if (stat && (!stat.isFile() || stat.isSymbolicLink())) return;
    }
    if (getFreshness(peer).state !== 'FRESH') return undefined;
    execFileSync('git', ['-C', peer, 'ls-files', '--error-unmatch', '--', MANIFEST], {
      stdio: 'ignore', timeout: 2000, windowsHide: true,
    });
    return peer;
  } catch {
    return;
  }
}

function exact(queries: QueryBuilder, root: string, location: Endpoint): Node | undefined {
  if (!endpoint(location)) return;
  const indexed = queries.getFileByPath(location.file);
  const path = validatePathWithinRoot(root, location.file);
  if (!indexed || !path) return;
  try {
    const stat = statSync(path);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES ||
        hashContent(readFileSync(path, 'utf8')) !== indexed.contentHash) return;
  } catch {
    return;
  }
  const matches = queries.getNodesByFile(location.file).filter(node =>
    node.qualifiedName === location.symbol || node.qualifiedName === location.file + '#' + location.symbol);
  return matches.length === 1 ? matches[0] : undefined;
}

function contractNode(node: Node): boolean {
  if (/\.(?:graphql|gql)$/i.test(node.filePath)) {
    return node.kind === 'property' || (node.kind === 'class' && /^type\s/.test(node.signature ?? ''));
  }
  if (/\.proto$/i.test(node.filePath)) return /^(?:rpc|message)\s/.test(node.signature ?? '');
  return /\.(?:json|ya?ml)$/i.test(node.filePath) &&
    /#(?:[A-Z]+:\/|schemas\/)/.test(node.qualifiedName);
}

function citation(repository: string, node: Node): ContractCitation {
  return { repository, file: node.filePath, line: node.startLine, symbol: node.qualifiedName };
}

export function crossRepoContractImpact(
  rootPath: string, local: QueryBuilder, target: Endpoint, peerProjectPaths: readonly string[], requestedDepth = 2,
) {
  const depth = Number.isSafeInteger(requestedDepth) ? Math.max(1, Math.min(10, requestedDepth)) : 2;
  const links: Link[] = [];
  let linkBytes = 0;
  const skipped: Record<string, number> = {};
  const skip = (reason: string) => { skipped[reason] = (skipped[reason] ?? 0) + 1; };
  let producer: ContractCitation | undefined;
  let truncated = false;
  const finish = () => ({ contract: CROSS_REPO_CONTRACT, producer: producer ?? null, links, skipped, depth, truncated });
  const root = realpathSync(rootPath);
  const identity = manifest(root);
  const node = exact(local, root, target);
  if (!identity || !node || !contractNode(node) ||
      local.getFileByPath(MANIFEST)?.contentHash !== hashContent(identity.source)) {
    skip('PRODUCER_CONTRACT_NOT_VERIFIED');
    return finish();
  }
  producer = citation(identity.value.repository, node);
  if (!Array.isArray(peerProjectPaths)) {
    skip('PEER_SCOPE_INVALID');
    return finish();
  }
  const opened: Array<{ root: string; repo: Manifest; queries: QueryBuilder; callers(target: string): string[]; close(): void }> = [];
  const seenRoots = new Set<string>();
  try {
    if (peerProjectPaths.length > MAX_PEERS) truncated = true;
    for (const input of peerProjectPaths.slice(0, MAX_PEERS).sort()) {
      const peer = realPeer(dirname(root), root, input);
      if (!peer) { skip('PEER_UNAVAILABLE_OR_STALE'); continue; }
      if (seenRoots.has(peer)) continue;
      seenRoots.add(peer);
      let close: (() => void) | undefined;
      try {
        const { db } = createDatabase(getDatabasePath(peer), { readOnly: true });
        close = () => db.close();
        const queries = new QueryBuilder(db);
        const declared = manifest(peer);
        if (!declared || queries.getMetadata('index_state') !== 'complete' ||
            queries.getFileByPath(MANIFEST)?.contentHash !== hashContent(declared.source)) {
          close();
          skip('PEER_CONTRACT_NOT_VERIFIED');
          continue;
        }
        const incoming = db.prepare("SELECT DISTINCT source FROM edges WHERE target = ? AND kind = 'calls' ORDER BY source LIMIT ?");
        const callers = (target: string) => (incoming.all(target, MAX_ROWS + 1) as { source: string }[])
          .slice(0, MAX_ROWS + 1).map(row => row.source);
        opened.push({ root: peer, repo: declared.value, queries, callers, close });
      } catch {
        close?.();
        skip('PEER_INDEX_UNREADABLE');
      }
    }
    for (const peer of opened) {
      if (peer.repo.repository === identity.value.repository ||
          opened.filter(other => other.repo.repository === peer.repo.repository).length !== 1) {
        skip('PEER_IDENTITY_AMBIGUOUS');
        continue;
      }
      const seen = new Set<string>();
      const firstLink = links.length;
      const emit = (link: Link) => {
        const bytes = Buffer.byteLength(JSON.stringify(link)) + 1;
        if (links.length >= MAX_ROWS || linkBytes + bytes > 26_000) { truncated = true; return false; }
        linkBytes += bytes;
        links.push(link);
        return true;
      };
      const queue: Array<{ node: Node; depth: number }> = [];
      try {
        for (const binding of peer.repo.consumes) {
          const name = node.qualifiedName.slice(node.qualifiedName.indexOf('#') + 1);
          if (binding.producer !== identity.value.repository || binding.contract.file !== node.filePath ||
              binding.contract.symbol !== name) continue;
          const consumer = exact(peer.queries, peer.root, binding.consumer);
          if (!consumer) { skip('CONSUMER_SYMBOL_NOT_VERIFIED'); continue; }
          if (seen.has(consumer.id)) continue;
          if (!emit({ provenance: 'cross-repo-contract', from: producer, to: citation(peer.repo.repository, consumer), depth: 1 })) break;
          seen.add(consumer.id);
          queue.push({ node: consumer, depth: 1 });
        }
        for (let index = 0; index < queue.length && !truncated; index++) {
          const current = queue[index]!;
          if (current.depth >= depth) continue;
          const callers = peer.callers(current.node.id);
          for (const source of callers) {
            if (seen.has(source)) continue;
            const caller = peer.queries.getNodeById(source);
            if (!caller || !exact(peer.queries, peer.root, {file: caller.filePath, symbol: caller.qualifiedName})) continue;
            if (!emit({ provenance: 'indexed-call', from: citation(peer.repo.repository, current.node),
              to: citation(peer.repo.repository, caller), depth: current.depth + 1 })) break;
            seen.add(caller.id);
            queue.push({ node: caller, depth: current.depth + 1 });
          }
          if (callers.length > MAX_ROWS) truncated = true;
        }
      } catch {
        for (const removed of links.splice(firstLink)) linkBytes -= Buffer.byteLength(JSON.stringify(removed)) + 1;
        skip('PEER_INDEX_UNREADABLE');
      }
    }
  } finally {
    for (const peer of opened) peer.close();
  }
  return finish();
}
