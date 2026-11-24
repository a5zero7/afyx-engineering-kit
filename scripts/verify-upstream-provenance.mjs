#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const enginePrefix = 'afyx-graph/engine/';

const FORBIDDEN_NOTICE_PATHS = [
  'THIRD_PARTY_NOTICES.md',
  'NOTICE',
  'NOTICE.md',
  'NOTICE.txt',
  `${enginePrefix}THIRD_PARTY_NOTICES.md`,
  `${enginePrefix}NOTICE`,
  `${enginePrefix}NOTICE.md`,
  `${enginePrefix}NOTICE.txt`,
  'afyx-graph/THIRD_PARTY_NOTICES.md',
];

const AFYX_COPYRIGHT_LINE = /Copyright\s+\(c\)\s+2026\s+Afyx\b/;
const ANY_COPYRIGHT_LINE = /Copyright\s+\(c\)\s+(.+)/gi;

export function verifyReviewedProvenance(repository, entries) {
  for (const entry of entries) {
    if (entry.classification === 'DERIVED_MIT_UPSTREAM' || entry.upstreamSimilarity) {
      throw new Error(`Disallowed upstream/derived classification in pure-AFYX release: ${entry.path}`);
    }
  }

  for (const rel of FORBIDDEN_NOTICE_PATHS) {
    if (existsSync(resolve(repository, rel))) {
      throw new Error(`Forbidden third-party notice file present: ${rel}`);
    }
  }

  for (const pkgRel of ['package.json', `${enginePrefix}package.json`]) {
    const pkgPath = resolve(repository, pkgRel);
    if (!existsSync(pkgPath)) continue;
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    const files = Array.isArray(pkg.files) ? pkg.files : [];
    for (const fileEntry of files) {
      if (/(?:^|\/)(?:THIRD_PARTY_NOTICES|NOTICE)(?:\.[^/]+)?$/i.test(String(fileEntry))) {
        throw new Error(`Forbidden notice entry in ${pkgRel} files allowlist: ${fileEntry}`);
      }
    }
  }

  for (const licenseRel of ['LICENSE', `${enginePrefix}LICENSE`, 'afyx-context/LICENSE']) {
    const licensePath = resolve(repository, licenseRel);
    if (!existsSync(licensePath)) continue;
    const text = readFileSync(licensePath, 'utf8');
    if (!AFYX_COPYRIGHT_LINE.test(text)) {
      throw new Error(`Missing canonical Afyx copyright in ${licenseRel}`);
    }
    for (const match of text.matchAll(ANY_COPYRIGHT_LINE)) {
      if (!/^2026\s+Afyx\b/.test(match[1].trim())) {
        throw new Error(`Non-AFYX copyright holder in ${licenseRel}: ${match[0]}`);
      }
    }
  }

  return [];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { entries } = JSON.parse(readFileSync(resolve(root, 'scripts/native-source-ownership.json'), 'utf8'));
  verifyReviewedProvenance(root, entries);
  console.log(`Pure-AFYX provenance PASS (${entries.length} entries, 0 third-party notices)`);
}
