import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveGitRevision,
  getCandidateTagsForRevision,
  resolveAndStageGitReleaseArtifacts,
} from '../resolve-git-release-artifacts.mjs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

describe('T01 & T02: Git Release Artifact Resolver & Packaging Lifecycle', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

  test('resolveGitRevision: determines exact 40-character Git SHA', () => {
    const revision = resolveGitRevision(root);
    assert.ok(revision, 'Revision must be determined');
    assert.match(revision, /^[0-9a-f]{40}$/, 'Must be exact 40-character SHA');
  });

  test('getCandidateTagsForRevision: generates canonical release tag variants', () => {
    const testSha = '1234567890abcdef1234567890abcdef12345678';
    const tags = getCandidateTagsForRevision(testSha);
    assert.ok(tags.includes(`afyx-dev-${testSha}`));
    assert.ok(tags.includes(`dev-${testSha}`));
    assert.ok(tags.includes(`afyx-dev-1234567890ab`));
    assert.ok(tags.includes(`afyx-dev-snapshot`));
  });

  test('resolveAndStageGitReleaseArtifacts: fails closed on invalid revision', async () => {
    await assert.rejects(
      async () => {
        await resolveAndStageGitReleaseArtifacts(root, 'invalid-short-sha');
      },
      /Valid 40-character Git commit SHA is required/
    );
  });

  test('resolveAndStageGitReleaseArtifacts: fails closed without source compile when release is absent', async () => {
    const fakeSha = '0000000000000000000000000000000000000000';
    await assert.rejects(
      async () => {
        await resolveAndStageGitReleaseArtifacts(root, fakeSha);
      },
      /No official precompiled Graph release artifacts found/
    );
  });
});
