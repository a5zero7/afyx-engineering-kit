import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { refineTaskDirective, stripInstructionBoilerplate, evaluateTaskCompletion, evaluateVerifiedTaskCompletion } from '../src/workflow-refiner.js';

const texts = (result) => [...result.objectives, ...result.acceptanceCriteria.map((x) => x.text), ...result.constraints.map((x) => x.text)];

test('boilerplate prefixes do not erase substantive intent or security instructions', () => {
  for (const instruction of [
    'Make sure you are very careful not to overwrite owner files.',
    'Always follow best practices unless the owner explicitly denies execution.',
    'We need to carefully preserve every foreign entry.',
    'Quality is of utmost importance: never expose secrets.',
  ]) {
    assert.equal(stripInstructionBoilerplate(instruction), instruction);
    assert.ok(texts(refineTaskDirective(instruction)).includes(instruction));
  }
  assert.equal(stripInstructionBoilerplate('Always follow best practices.\r\nInspect source.'), 'Inspect source.');
});

test('unknown sections close preceding scope and preserve safety-bearing headings', () => {
  const result = refineTaskDirective('# Constraints\nNever publish.\n# Deployment\nVerify the staging log.\n# Jangan ubah data pengguna');
  assert.deepEqual(result.constraints.map((x) => x.text), ['Never publish.', 'Jangan ubah data pengguna']);
  assert.deepEqual(result.acceptanceCriteria, [{ id: 'AC-1', text: 'Verify the staging log.' }]);
  assert.deepEqual(result.objectives, ['Deployment']);
});

test('Indonesian requirements and Markdown checklists produce deterministic source criteria', () => {
  const task = '# Misi\nPeriksa fixture lokal.\n# Persyaratan\n- [ ] Hash harus cocok.\n2) [x] Verifikasi hasil instalasi.\n# Batasan\n- [ ] Pertahankan data owner.';
  const result = refineTaskDirective(task);
  assert.deepEqual(result.objectives, ['Periksa fixture lokal.']);
  assert.deepEqual(result.acceptanceCriteria, [
    { id: 'AC-1', text: 'Hash harus cocok.' },
    { id: 'AC-2', text: 'Verifikasi hasil instalasi.' },
  ]);
  assert.deepEqual(result.constraints, [{ id: 'CONST-1', text: 'Pertahankan data owner.' }]);
  assert.equal(result.clarificationRequired, false);
  assert.deepEqual(refineTaskDirective(task), result);
});

test('English and Indonesian negation remains exact constraints without section headers', () => {
  const restrictions = ["Don't enable Graph.", 'Dilarang mengubah konfigurasi.', 'Cannot execute without permission.', 'Perubahan tanpa izin tidak diizinkan.'];
  const result = refineTaskDirective(restrictions.join('\n'));
  assert.deepEqual(result.constraints.map((x) => x.text), restrictions);
  assert.deepEqual(result.acceptanceCriteria, []);
});

test('ambiguous requests require clarification without inventing acceptance requirements', () => {
  for (const task of ['Fix it.', 'Perbaiki itu.', 'Act as a senior engineer.', '# Tujuan\n# Batasan\nJangan ubah source.']) {
    const result = refineTaskDirective(task);
    assert.deepEqual(result.acceptanceCriteria, []);
    assert.equal(result.clarificationRequired, true);
    assert.deepEqual(result.clarificationReasons, ['ACCEPTANCE_CRITERIA_UNSPECIFIED']);
    assert.equal(evaluateVerifiedTaskCompletion(result.acceptanceCriteria).isComplete, false);
  }
});

test('text hints cannot complete empty, tokenless or explicitly unexecuted requirements', () => {
  assert.equal(evaluateTaskCompletion([]).isComplete, false);
  assert.equal(evaluateTaskCompletion([{ id: 'AC-1', text: 'OK' }]).isComplete, false);
  for (const evidence of ['Tests pass successfully: not tested.', 'Tests pass successfully: belum diuji.', 'Tests pass successfully: tidak dijalankan.']) {
    const result = evaluateTaskCompletion([{ id: 'AC-1', text: 'Tests pass successfully' }], [evidence]);
    assert.equal(result.isComplete, false);
    assert.equal(result.verifiedComplete, false);
  }
});

test('standalone refiner remains assistive with optional runtimes unavailable and explicitly OFF', () => {
  const task = '# Objective\nInspect local relationships.\n# Acceptance Criteria\nVerify source evidence.\n# Constraints\nDo not enable Graph or Context.';
  const cli = fileURLToPath(new URL('../bin/afyx-forge.js', import.meta.url));
  const result = spawnSync(process.execPath, [cli, 'refine', '--task', task], {
    encoding: 'utf8', timeout: 5000,
    env: { ...process.env, PATH: '', AFYX_GRAPH_OPT_IN: '0', AFYX_CONTEXT_OPT_IN: '0' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), refineTaskDirective(task));
});
