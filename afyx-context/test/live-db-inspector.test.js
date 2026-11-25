import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DbInspector } from '../src/db-inspector.js';

for (const dialect of ['postgres', 'mysql']) {
  test(dialect + ' uses bounded non-shell read-only catalog and plan requests', t => {
    const root = mkdtempSync(join(tmpdir(), 'afyx-live-db-fixture-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const executable = join(root, (dialect === 'postgres' ? 'psql' : 'mysql') + (process.platform === 'win32' ? '.exe' : ''));
    writeFileSync(executable, '');
    const password = 'fixture_private_credential';
    const tlsCaFile = join(root, 'fixture-ca.pem');
    writeFileSync(tlsCaFile, 'synthetic CA path');
    const config = { live: true, authorized: true, host: 'db.example.invalid', allowedHosts: ['db.example.invalid'],
      user: 'readonly', database: 'fixture', readOnlyRole: true, executable, password, tlsCaFile, approvedRelations: ['catalog'] };
    let calls = 0;
    let response = { status: 0, stdout: 'catalog\npassword\n' + password + '\n' };
    const db = new DbInspector(root, { runClient: (_file, args, options) => {
      calls++;
      assert.equal(options.shell, false);
      assert.equal(options.timeout, 6000);
      assert.ok(options.maxBuffer <= 256 * 1024);
      assert.match(options.input, /^(BEGIN|START TRANSACTION) READ ONLY;/);
      assert.ok(options.input.endsWith('\nROLLBACK;\n'));
      assert.ok(!args.some(arg => arg.includes(password)));
      assert.equal(options.env[dialect === 'postgres' ? 'PGPASSWORD' : 'MYSQL_PWD'], password);
      return response;
    } });
    const explain = { kind: 'explain', sql: 'SELECT id FROM catalog' };
    assert.equal(db.inspectExternalCatalog(dialect).status, 'NOT_AVAILABLE');
    assert.equal(db.inspectExternalCatalog(dialect, { ...config, allowedHosts: [] }).status, 'ACCESS_DENIED');
    assert.equal(db.inspectExternalCatalog(dialect, { ...config, executable: join(root, 'absent') }).reason, 'DB_CLIENT_UNAVAILABLE');
    for (const sql of ['UPDATE catalog SET id = 1', 'SELECT id FROM catalog;', 'WITH x AS (SELECT id FROM catalog) SELECT id FROM x',
      'SELECT id FROM catalog FOR UPDATE', 'SELECT id INTO r FROM catalog', 'SELECT now() FROM catalog',
      'SELECT id FROM foreign_table', 'EXPLAIN ANALYZE SELECT id FROM catalog', 'SELECT id FROM catalog -- comment']) {
      assert.equal(db.inspectExternalCatalog(dialect, config, { ...explain, sql }).status, 'ACCESS_DENIED', sql);
    }
    assert.equal(calls, 0);
    assert.deepEqual(db.inspectExternalCatalog(dialect, config).tables, ['catalog', '[REDACTED]', '[REDACTED]']);
    assert.deepEqual(db.inspectExternalCatalog(dialect, config, { kind: 'columns', table: 'catalog' }).columns,
      ['catalog', '[REDACTED]', '[REDACTED]']);
    response = { status: 0, stdout: dialect === 'postgres' ?
      '[{"Plan":{"Node Type":"Seq Scan","Plan Rows":3,"Filter":"fixture_private_credential"}}]' :
      '{"query_block":{"table":{"access_type":"ALL","rows_examined_per_scan":3,"condition":"fixture_private_credential"}}}' };
    const planned = db.inspectExternalCatalog(dialect, config, explain);
    assert.equal(planned.executed, false);
    assert.deepEqual(planned.plan, { access: dialect === 'postgres' ? 'Seq Scan' : 'ALL', estimatedRows: 3 });
    assert.ok(!JSON.stringify(planned).includes(password));
    response = { status: 0, stdout: '7\n' };
    assert.equal(db.inspectExternalCatalog(dialect, config, { ...explain, kind: 'query' }).rowsObserved, 7);
    for (const failure of [
      { status: 1, stderr: password },
      { error: Object.assign(new Error(password), { code: 'ETIMEDOUT' }) },
      { status: 0, stdout: 'x'.repeat(257 * 1024) },
      { status: 0, stdout: 'not json' },
    ]) {
      response = failure;
      const result = db.inspectExternalCatalog(dialect, config, explain);
      assert.equal(result.status, 'ERROR');
      assert.ok(!JSON.stringify(result).includes(password));
    }
  });
}
