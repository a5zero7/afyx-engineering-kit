import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';
import AfyxGraph from '../src/index';
import { EXTRACTION_VERSION } from '../src/extraction/extraction-version';

const BIN = path.resolve(__dirname, '../dist/bin/afyx-graph.js');

describe('TASK G8.5 — Phase 3 Compatibility & Index Lifecycle', () => {
  let tempDir: string;
  let odooDir: string;
  let cg: AfyxGraph | null = null;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-g8-5-compat-'));
    odooDir = path.join(tempDir, 'sample_mod');
    fs.mkdirSync(odooDir, { recursive: true });
    fs.mkdirSync(path.join(odooDir, 'models'), { recursive: true });
    fs.mkdirSync(path.join(odooDir, 'security'), { recursive: true });
    fs.mkdirSync(path.join(odooDir, 'tests'), { recursive: true });

    fs.writeFileSync(
      path.join(odooDir, '__manifest__.py'),
      `{ "name": "Sample Mod", "version": "1.0", "depends": ["base"], "data": ["security/ir.model.access.csv"] }`
    );
    fs.writeFileSync(
      path.join(odooDir, 'models', 'sample.py'),
      `from odoo import models, fields\nclass Sample(models.Model):\n    _name = 'sample.model'\n    name = fields.Char('Name')\n`
    );
    fs.writeFileSync(
      path.join(odooDir, 'security', 'ir.model.access.csv'),
      `id,name,model_id:id,group_id:id,perm_read,perm_write,perm_create,perm_unlink\naccess_sample,sample,model_sample_model,base.group_user,1,1,1,0\n`
    );
    fs.writeFileSync(
      path.join(odooDir, 'tests', 'test_sample.py'),
      `from odoo.tests.common import TransactionCase\nclass TestSample(TransactionCase):\n    pass\n`
    );
  });

  afterEach(async () => {
    if (cg) {
      await cg.close();
      cg = null;
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('verifies fresh v29 index creation and metadata identity', async () => {
    cg = await AfyxGraph.init(tempDir);
    await cg.indexAll();
    cg.resolveReferences();

    const buildInfo = cg.getIndexBuildInfo();
    expect(buildInfo.extractionVersion).toBe(29);
    expect(buildInfo.extractionVersion).toBe(EXTRACTION_VERSION);
    expect(cg.isIndexStale()).toBe(false);

    const modelNode = cg.getNodesByName('Sample')[0];
    expect(modelNode).toBeDefined();
    await cg.close();
    cg = null;
  });

  it('detects preexisting v28 index as stale and recommends rebuild via CLI and API', async () => {
    // 1. Create fresh index
    cg = await AfyxGraph.init(tempDir);
    await cg.indexAll();
    cg.resolveReferences();

    // 2. Simulate older v28 index by writing v28 to metadata via internal queries
    (cg as any).queries.setMetadata('indexed_with_extraction_version', '28');

    await cg.close();
    cg = null;

    // 3. Reopen and verify staleness detection
    const reopenedCg = await AfyxGraph.open(tempDir);
    const buildInfo = reopenedCg.getIndexBuildInfo();
    expect(buildInfo.extractionVersion).toBe(28);
    expect(reopenedCg.isIndexStale()).toBe(true);

    // 4. Affected tests with --explain must detect EXTRACTION_VERSION_STALE
    const affectedRes = spawnSync(process.execPath, [BIN, 'affected', 'sample_mod/models/sample.py', '-p', tempDir, '--explain', '--json'], {
      cwd: tempDir,
      encoding: 'utf8',
      env: { ...process.env, AFYX_GRAPH_NO_DAEMON: '1' },
    });
    expect(affectedRes.status).toBe(0);
    const affectedJson = JSON.parse(affectedRes.stdout.trim());
    expect(affectedJson.affectedTestsAnalysis.limitations).toContain('EXTRACTION_VERSION_STALE');

    // 5. CLI status must report reindex recommended
    const statusRes = spawnSync(process.execPath, [BIN, 'status', '-j', tempDir], {
      cwd: tempDir,
      encoding: 'utf8',
      env: { ...process.env, AFYX_GRAPH_NO_DAEMON: '1' },
    });
    expect(statusRes.status).toBe(0);
    const statusJson = JSON.parse(statusRes.stdout.trim());
    expect(statusJson.index.reindexRecommended).toBe(true);
    expect(statusJson.index.builtWithExtractionVersion).toBe(28);
    expect(statusJson.index.currentExtractionVersion).toBe(29);

    // 6. Validated rebuild heals the index to v29
    await reopenedCg.indexAll();
    reopenedCg.resolveReferences();
    expect(reopenedCg.isIndexStale()).toBe(false);
    expect(reopenedCg.getIndexBuildInfo().extractionVersion).toBe(29);

    await reopenedCg.close();
  });

  it('preserves relationship freshness and eliminates stale edges on modify/delete', async () => {
    cg = await AfyxGraph.init(tempDir);
    await cg.indexAll();
    cg.resolveReferences();

    // Verify initial edges
    const aclNode = cg.getNodesByName('access_sample')[0];
    expect(aclNode).toBeDefined();
    const initialOutgoing = cg.getOutgoingEdges(aclNode!.id);
    expect(initialOutgoing.length).toBeGreaterThan(0);

    // Add extra model
    const extraPath = path.join(odooDir, 'models', 'extra.py');
    fs.writeFileSync(extraPath, `from odoo import models\nclass Extra(models.Model):\n    _name = 'sample.extra'\n`);
    await cg.sync();

    const extraNode = cg.getNodesByName('Extra')[0];
    expect(extraNode).toBeDefined();

    // Remove extra model
    fs.unlinkSync(extraPath);
    await cg.sync();

    const removedExtra = cg.getNodesByName('Extra')[0];
    expect(removedExtra).toBeUndefined();

    // Repeated sync with zero changes is idempotent
    const sync3 = await cg.sync();
    expect(sync3.filesAdded).toBe(0);
    expect(sync3.filesModified).toBe(0);
    expect(sync3.filesRemoved).toBe(0);

    await cg.close();
    cg = null;
  });

  it('handles corrupt metadata gracefully without crash', async () => {
    cg = await AfyxGraph.init(tempDir);
    await cg.indexAll();
    cg.resolveReferences();

    // Corrupt the metadata
    (cg as any).queries.setMetadata('indexed_with_extraction_version', 'corrupted_string');
    await cg.close();
    cg = null;

    const reopenedCg = await AfyxGraph.open(tempDir);
    const buildInfo = reopenedCg.getIndexBuildInfo();
    expect(buildInfo.extractionVersion).toBeNull();
    // Incompatible / unparseable version must fail-safe to stale
    expect(reopenedCg.isIndexStale()).toBe(true);

    await reopenedCg.close();
  });
});
