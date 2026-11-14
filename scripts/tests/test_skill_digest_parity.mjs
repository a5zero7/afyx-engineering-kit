import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { PACKAGE_ROOT, subprocessEnvironment } from '../afyx-npm-installer.mjs';

for (const format of ['canonical', 'legacy-nls']) {
  test(`PS5.1/7 ${format} ownership stays valid without rewriting markers; changed files still fail`,
    { skip: process.platform !== 'win32', timeout: 60_000 }, (t) => {
      const root = mkdtempSync(join(realpathSync(tmpdir()), 'afyx-skill-digest-parity-'));
      t.after(() => rmSync(root, { recursive: true, force: true }));
      const skill = join(root, 'skill'); mkdirSync(join(skill, 'references'), { recursive: true });
      const unmarked = join(root, 'legacy'); mkdirSync(join(unmarked, 'references'), { recursive: true });
      const paths = ['references/data-engineer.md', 'references/database-administrator.md', 'SKILL.md'];
      for (const path of paths) {
        writeFileSync(join(skill, path), `AFYX owned fixture: ${path}\n`);
        writeFileSync(join(unmarked, path), readFileSync(join(skill, path)));
      }
      const hash = (data) => createHash('sha256').update(data).digest('hex');
      const digest = (order) => hash(order.map((path) => `${hash(readFileSync(join(skill, path))).toUpperCase()}  ./${path}`).join('\n') + '\n');
      const canonical = digest(paths), legacy = digest([paths[1], paths[0], paths[2]]);
      assert.notEqual(canonical, legacy);
      const marker = join(skill, '.afyx-install.json');
      const originalMarker = Buffer.from(JSON.stringify({ schema: 1, product: 'Afyx Codex Engineering Kit',
        component: 'afyx-engineering-expert', owner: 'afyx', version: '0.1.1',
        content_sha256: format === 'canonical' ? canonical : legacy }) + '\r\n');
      writeFileSync(marker, originalMarker);
      const probe = join(root, 'probe.ps1');
      writeFileSync(probe, `param([string]$Module,[string]$Skill,[string]$Unmarked)\n$ErrorActionPreference='Stop'\nImport-Module $Module -Force -DisableNameChecking\n` +
        `$marker=Get-Content (Join-Path $Skill '.afyx-install.json') -Raw | ConvertFrom-Json\n` +
        `[ordered]@{canonical=(Get-AfyxSkillDigest -Directory $Skill);legacy=(Get-AfyxSkillDigest -Directory $Skill -LegacyNls);ownership=(Get-AfyxSkillOwnership -Target $Skill -Component afyx-engineering-expert -ExpectedOwner afyx);provenance=(Get-AfyxLegacySkillProvenance -Target $Unmarked -Component afyx-engineering-expert -Owner afyx -LegacyContentSha256 $marker.content_sha256)}|ConvertTo-Json -Compress\n`);
      const inspect = (expected) => {
        for (const shell of ['powershell.exe', 'pwsh.exe']) {
          const result = spawnSync(shell, ['-NoProfile', '-File', probe, '-Module',
            join(PACKAGE_ROOT, 'scripts/lib/AfyxSkillLifecycle.psm1'), '-Skill', skill, '-Unmarked', unmarked], {
            encoding: 'utf8', timeout: 20_000, windowsHide: true, env: subprocessEnvironment(shell),
          });
          assert.equal(result.status, 0, `${shell}: ${result.stdout}\n${result.stderr}`);
          const actual = JSON.parse(result.stdout);
          assert.equal(actual.ownership, expected, `${shell}: ${JSON.stringify(actual)}`);
          if (expected === 'AFYX_OWNED_UNMODIFIED') {
            assert.equal(actual.canonical, canonical);
            assert.equal(actual.legacy, legacy);
            assert.equal(actual.provenance, 'MATCH');
          } else {
            assert.notEqual(actual.provenance, 'MATCH');
          }
          assert.deepEqual(readFileSync(marker), originalMarker);
        }
      };
      inspect('AFYX_OWNED_UNMODIFIED');
      const changed = Buffer.from(readFileSync(join(skill, paths[0]), 'utf8') + 'User modification must survive.\n');
      writeFileSync(join(skill, paths[0]), changed);
      writeFileSync(join(unmarked, paths[0]), changed);
      inspect('AFYX_OWNED_MODIFIED');
      assert.deepEqual(readFileSync(join(skill, paths[0])), changed);
    });
}
