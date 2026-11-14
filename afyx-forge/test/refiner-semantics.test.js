import assert from 'node:assert/strict';
import test from 'node:test';
import { refineTaskDirective, stripInstructionBoilerplate, evaluateTaskCompletion,
  evaluateVerifiedTaskCompletion } from '../src/workflow-refiner.js';

const texts = (result) => [...result.objectives, ...result.acceptanceCriteria.map((x) => x.text),
  ...result.constraints.map((x) => x.text)];

test('role lines carrying safety or disabled-component scope survive refinement verbatim', () => {
  for (const instruction of [
    'Act as a senior security engineer; never expose credentials or change production.',
    'You are a principal engineer and must not invoke disabled Graph.',
    'Act as a lead engineer responsible for offline-only validation.',
    'Anda adalah engineer keamanan; jangan ubah konfigurasi pengguna.',
  ]) {
    const result = refineTaskDirective(`${instruction}\n# Objective\nInspect local evidence.`);
    assert.ok(texts(result).includes(instruction), instruction);
  }
  assert.equal(stripInstructionBoilerplate('Please act as a senior software engineer and lead architect.\nInspect evidence.'), 'Inspect evidence.');
});

test('unbulleted English and Indonesian requirements and restrictions retain exact wording', () => {
  for (const [header, constraintHeader, objective, criterion, restrictions] of [
    ['Acceptance Criteria', 'Constraints', 'Review only the disposable source.',
      'Verify installed output against the source hash.',
      ['Never expose secrets.', 'Do not enable disabled Graph or Forge.', 'Leave owner files untouched.']],
    ['Kriteria Penerimaan', 'Batasan', 'Periksa hanya source disposable.',
      'Pastikan hash hasil sesuai source.',
      ['Jangan tampilkan kredensial.', 'Tidak boleh mengaktifkan Graph yang OFF.', 'Pertahankan konfigurasi owner.']],
  ]) {
    const result = refineTaskDirective(`# Objective\n${objective}\n# ${header}\n${criterion}\n# ${constraintHeader}\n${restrictions.join('\n')}`);
    assert.deepEqual(result.objectives, [objective]);
    assert.deepEqual(result.acceptanceCriteria.map((x) => x.text), [criterion]);
    assert.deepEqual(result.constraints.map((x) => x.text), restrictions);
  }
});

test('negative requirements remain constraints even inside an objective or acceptance section', () => {
  for (const header of ['Objective', 'Acceptance Criteria']) {
    const constraint = 'Never run disabled components or change global settings.';
    const result = refineTaskDirective(`# ${header}\n- ${constraint}`);
    assert.equal(result.constraints[0].text, constraint);
  }
});

test('header-like sentences and later scope instructions are not silently dropped', () => {
  const lines = ['Objective remains read-only.', 'Requirements must preserve owner data.',
    'Inspect component A.', 'Inspect component B.', 'Inspect component C.',
    'Inspect component D.', 'Use only the disposable profile.'];
  const result = refineTaskDirective(lines.join('\n'));
  for (const line of lines) assert.ok(texts(result).includes(line), line);
  assert.deepEqual(refineTaskDirective('Inspect source.').objectives, ['Inspect source.']);
});

test('malformed requests reject without fabricated completion; deterministic output remains bounded', () => {
  for (const input of [null, {}, '', '  ', 'x'.repeat(65_537)]) {
    assert.throws(() => refineTaskDirective(input), /non-empty.*65536/);
  }
  const input = '# Tujuan\n- Periksa source lokal.\n# Larangan\n- Jangan tulis file owner.';
  assert.deepEqual(refineTaskDirective(input), refineTaskDirective(input));
  for (const evidence of ['not verified', 'tests failed', 'belum terverifikasi', 'tidak berhasil']) {
    const result = evaluateTaskCompletion([{ id: 'AC-1', text: 'tests verified' }], [evidence]);
    assert.equal(result.isComplete, false);
    assert.equal(result.verifiedComplete, false);
  }
  const verified = evaluateVerifiedTaskCompletion([{ id: 'AC-1', text: 'Verify source.' }], [{
    criterionId: 'AC-1', status: 'PASS', exitCode: 0, verified: true,
    sourceRevision: 'a'.repeat(40), command: 'node test', evidenceDigest: 'b'.repeat(64),
  }], { sourceRevision: 'a'.repeat(40), verifyEvidence: () => false });
  assert.equal(verified.verifiedComplete, false);
});
