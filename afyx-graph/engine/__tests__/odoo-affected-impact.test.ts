import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawnSync } from 'child_process';
import AfyxGraph from '../src/index';
import { computeOdooImpact } from '../src/impact/odoo-impact';

const BIN = path.resolve(__dirname, '../dist/bin/afyx-graph.js');

describe('TASK G8.3 — Native Odoo-Aware Impact & Affected Analysis', () => {
  let tempDir: string;
  let cg: AfyxGraph;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-odoo-g83-'));
  });

  afterEach(async () => {
    if (cg) {
      await cg.close();
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  });

  it('determines impacted models, security assets, modules, and tests across changes', async () => {
    // -------------------------------------------------------------------------
    // Setup Module 1: purchase_base
    // -------------------------------------------------------------------------
    const baseDir = path.join(tempDir, 'purchase_base');
    fs.mkdirSync(baseDir, { recursive: true });
    fs.writeFileSync(
      path.join(baseDir, '__manifest__.py'),
      `{ "name": "Purchase Base", "version": "17.0", "depends": [], "data": [] }`,
      'utf8',
    );

    // -------------------------------------------------------------------------
    // Setup Module 2: purchase_request_fixture (depends on purchase_base)
    // -------------------------------------------------------------------------
    const modDir = path.join(tempDir, 'purchase_request_fixture');
    const secDir = path.join(modDir, 'security');
    const modelsDir = path.join(modDir, 'models');
    const testsDir = path.join(modDir, 'tests');
    fs.mkdirSync(secDir, { recursive: true });
    fs.mkdirSync(modelsDir, { recursive: true });
    fs.mkdirSync(testsDir, { recursive: true });

    fs.writeFileSync(
      path.join(modDir, '__manifest__.py'),
      `{
    "name": "Synthetic Purchase Request Fixture",
    "version": "17.0.1.0.0",
    "depends": ["purchase_base"],
    "data": [
        "security/purchase_request_security.xml",
        "security/purchase_request_manager_security.xml",
        "security/ir.model.access.csv",
    ],
}`,
      'utf8',
    );

    fs.writeFileSync(
      path.join(modelsDir, 'purchase_request.py'),
      `from odoo import models, fields

class PurchaseRequest(models.Model):
    _name = 'purchase.request'
    _description = 'Purchase Request Workflow'

    name = fields.Char('Title')
`,
      'utf8',
    );

    fs.writeFileSync(
      path.join(modelsDir, 'purchase_request_line.py'),
      `from odoo import models, fields

class PurchaseRequestLine(models.Model):
    _name = 'purchase.request.line'
    _inherit = 'purchase.request'

class PurchaseRequestExtension(models.Model):
    _inherit = 'purchase.request'
`,
      'utf8',
    );

    fs.writeFileSync(
      path.join(secDir, 'purchase_request_security.xml'),
      `<odoo>
    <record id="group_purchase_user" model="res.groups">
        <field name="name">Purchase User</field>
    </record>

    <record id="purchase_request_company_rule" model="ir.rule">
        <field name="name">Purchase Request Multi-Company</field>
        <field name="model_id" ref="model_purchase_request"/>
        <field name="domain_force">[('company_id', 'in', company_ids)]</field>
        <field name="groups" eval="[(4, ref('purchase_request_fixture.group_purchase_user'))]"/>
    </record>
</odoo>`,
      'utf8',
    );

    fs.writeFileSync(
      path.join(secDir, 'purchase_request_manager_security.xml'),
      `<odoo>
    <record id="group_purchase_manager" model="res.groups">
        <field name="name">Purchase Manager</field>
        <field name="implied_ids" eval="[(4, ref('group_purchase_user'))]"/>
    </record>
</odoo>`,
      'utf8',
    );

    fs.writeFileSync(
      path.join(secDir, 'ir.model.access.csv'),
      `id,name,model_id:id,group_id:id,perm_read,perm_write,perm_create,perm_unlink
access_purchase_request_user,purchase.request user,model_purchase_request,group_purchase_user,1,1,1,0
access_purchase_request_manager,purchase.request manager,model_purchase_request,group_purchase_manager,1,1,1,1
`,
      'utf8',
    );

    fs.writeFileSync(
      path.join(testsDir, 'test_purchase_request.py'),
      `from odoo.tests.common import TransactionCase

class TestPurchaseRequest(TransactionCase):
    def test_creation(self):
        self.assertTrue(True)
`,
      'utf8',
    );

    // -------------------------------------------------------------------------
    // Setup Module 3: purchase_request_custom (Transitive dependent of fixture)
    // -------------------------------------------------------------------------
    const customDir = path.join(tempDir, 'purchase_request_custom');
    const customTestsDir = path.join(customDir, 'tests');
    fs.mkdirSync(customTestsDir, { recursive: true });
    fs.writeFileSync(
      path.join(customDir, '__manifest__.py'),
      `{ "name": "Purchase Request Custom", "version": "1.0", "depends": ["purchase_request_fixture"], "data": [] }`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(customTestsDir, 'test_custom.py'),
      `from odoo.tests.common import TransactionCase
class TestCustom(TransactionCase):
    pass
`,
      'utf8',
    );

    // Initialize & index
    cg = await AfyxGraph.init(tempDir);
    await cg.indexAll();
    await cg.resolveReferences();

    // =========================================================================
    // 1. Python Model Change Analysis
    // =========================================================================
    const modelImpact = computeOdooImpact(cg, ['purchase_request_fixture/models/purchase_request.py']);
    expect(modelImpact.isOdooProject).toBe(true);

    // Primary declaration
    const prModel = modelImpact.affectedModels.find((m) => m.name === 'purchase.request' && m.relationship === 'primary_declaration');
    expect(prModel).toBeDefined();
    expect(prModel?.direction).toBe('direct');
    expect(prModel?.hopCount).toBe(0);

    // Classical inheritance
    const prLineModel = modelImpact.affectedModels.find((m) => m.name === 'purchase.request.line');
    expect(prLineModel).toBeDefined();
    expect(prLineModel?.relationship).toBe('classical_inheritance');
    expect(prLineModel?.hopCount).toBe(1);

    // In-place extension
    const prExtModel = modelImpact.affectedModels.find((m) => m.relationship === 'in_place_extension');
    expect(prExtModel).toBeDefined();

    // Referencing security assets (ACL + Rule)
    const aclAsset = modelImpact.affectedSecurityAssets.find((s) => s.ruleId === 'access_purchase_request_user');
    expect(aclAsset).toBeDefined();
    expect(aclAsset?.assetType).toBe('acl_grant');
    expect(aclAsset?.semantics).toContain('Model-level Access Grant');

    const ruleAsset = modelImpact.affectedSecurityAssets.find((s) => s.ruleId === 'purchase_request_company_rule');
    expect(ruleAsset).toBeDefined();
    expect(ruleAsset?.assetType).toBe('record_rule');
    expect(ruleAsset?.semantics).toContain('Row-level Domain Restriction');

    // Affected modules: owning (fixture) and downstream consumer (custom)
    expect(modelImpact.affectedModules.some((m) => m.moduleName === 'purchase_request_fixture')).toBe(true);
    expect(modelImpact.affectedModules.some((m) => m.moduleName === 'purchase_request_custom')).toBe(true);

    // Candidate tests: includes tests in fixture and downstream custom
    expect(modelImpact.affectedTests).toContain('purchase_request_fixture/tests/test_purchase_request.py');
    expect(modelImpact.affectedTests).toContain('purchase_request_custom/tests/test_custom.py');

    // =========================================================================
    // 2. Security ACL CSV Change Analysis
    // =========================================================================
    const aclImpact = computeOdooImpact(cg, ['purchase_request_fixture/security/ir.model.access.csv']);
    expect(aclImpact.affectedSecurityAssets.some((s) => s.ruleId === 'access_purchase_request_user' && s.hopCount === 0)).toBe(true);

    // Governed model is identified
    const governedModel = aclImpact.affectedModels.find((m) => m.name === 'purchase.request' && m.relationship === 'governed_by_acl');
    expect(governedModel).toBeDefined();
    expect(governedModel?.hopCount).toBe(1);

    // Bound security group is identified
    expect(aclImpact.affectedSecurityAssets.some((s) => s.ruleId === 'group_purchase_user' && s.assetType === 'security_group')).toBe(true);

    // =========================================================================
    // 3. Security XML Record Rule Change Analysis
    // =========================================================================
    const xmlImpact = computeOdooImpact(cg, ['purchase_request_fixture/security/purchase_request_security.xml']);
    expect(xmlImpact.affectedSecurityAssets.some((s) => s.ruleId === 'purchase_request_company_rule' && s.assetType === 'record_rule')).toBe(true);

    // Restricted model identified
    const restrictedModel = xmlImpact.affectedModels.find((m) => m.name === 'purchase.request' && m.relationship === 'restricted_by_rule');
    expect(restrictedModel).toBeDefined();

    // Implied group transitive relationship: group_purchase_manager inherits group_purchase_user
    const impliedGroup = xmlImpact.affectedSecurityAssets.find((s) => s.ruleId === 'group_purchase_manager');
    expect(impliedGroup).toBeDefined();
    expect(impliedGroup?.direction).toBe('transitive');

    // =========================================================================
    // 4. Manifest Change Analysis & Transitive Module Consumers
    // =========================================================================
    const baseManifestImpact = computeOdooImpact(cg, ['purchase_base/__manifest__.py']);
    // purchase_request_fixture directly depends on purchase_base
    const directConsumer = baseManifestImpact.affectedModules.find((m) => m.moduleName === 'purchase_request_fixture');
    expect(directConsumer).toBeDefined();
    expect(directConsumer?.direction).toBe('direct');

    // purchase_request_custom transitively depends on purchase_base
    const transitiveConsumer = baseManifestImpact.affectedModules.find((m) => m.moduleName === 'purchase_request_custom');
    expect(transitiveConsumer).toBeDefined();
    expect(transitiveConsumer?.direction).toBe('transitive');
    expect(transitiveConsumer?.hopCount).toBe(2);

    // =========================================================================
    // 5. Static Disclaimer Verification
    // =========================================================================
    expect(modelImpact.disclaimer).toContain('Static graph relationships identify structurally bound assets only');
  });

  it('safely handles cyclic module dependencies without infinite recursion', async () => {
    // Module Alpha depends on Beta, and Beta depends on Alpha (mutual/cyclic dependency)
    const modAlpha = path.join(tempDir, 'cycle_alpha');
    const modBeta = path.join(tempDir, 'cycle_beta');
    fs.mkdirSync(modAlpha, { recursive: true });
    fs.mkdirSync(modBeta, { recursive: true });

    fs.writeFileSync(
      path.join(modAlpha, '__manifest__.py'),
      `{ "name": "Cycle Alpha", "version": "1.0", "depends": ["cycle_beta"], "data": [] }`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(modBeta, '__manifest__.py'),
      `{ "name": "Cycle Beta", "version": "1.0", "depends": ["cycle_alpha"], "data": [] }`,
      'utf8',
    );

    cg = await AfyxGraph.init(tempDir);
    await cg.indexAll();
    await cg.resolveReferences();

    // Impact traversal must terminate deterministically
    const impact = computeOdooImpact(cg, ['cycle_alpha/__manifest__.py'], { maxDepth: 10 });
    expect(impact.affectedModules.map((m) => m.moduleName)).toContain('cycle_alpha');
    expect(impact.affectedModules.map((m) => m.moduleName)).toContain('cycle_beta');
    // Result size must be bounded (exactly 2 modules)
    expect(impact.affectedModules.length).toBe(2);
  });

  it('executes real CLI affected command with --json and --quiet flags', () => {
    const modDir = path.join(tempDir, 'cli_test_mod');
    const testsDir = path.join(modDir, 'tests');
    fs.mkdirSync(testsDir, { recursive: true });

    fs.writeFileSync(
      path.join(modDir, '__manifest__.py'),
      `{ "name": "CLI Test Mod", "version": "1.0", "depends": [], "data": [] }`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(modDir, 'my_model.py'),
      `from odoo import models
class CliModel(models.Model):
    _name = 'cli.model'
`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(testsDir, 'test_cli.py'),
      `class TestCli: pass`,
      'utf8',
    );

    // Initialize graph via CLI command
    const initRes = spawnSync(process.execPath, [BIN, 'init', tempDir], {
      encoding: 'utf8',
      env: { ...process.env, AFYX_GRAPH_NO_DAEMON: '1' },
    });
    expect(initRes.status).toBe(0);

    // 1. Run CLI: affected <file> --json
    const affectedJsonRes = spawnSync(
      process.execPath,
      [BIN, 'affected', 'cli_test_mod/my_model.py', '-p', tempDir, '--json'],
      {
        encoding: 'utf8',
        env: { ...process.env, AFYX_GRAPH_NO_DAEMON: '1' },
      }
    );

    expect(affectedJsonRes.status).toBe(0);
    const jsonOutput = JSON.parse(affectedJsonRes.stdout);

    // Standard affected fields must exist
    expect(jsonOutput.changedFiles).toBeDefined();
    expect(jsonOutput.affectedTests).toBeDefined();
    expect(jsonOutput.totalDependentsTraversed).toBeDefined();

    // Odoo-specific impact field must be populated
    expect(jsonOutput.odooImpact).toBeDefined();
    expect(jsonOutput.odooImpact.isOdooProject).toBe(true);
    expect(jsonOutput.odooImpact.affectedModels.some((m: any) => m.name === 'cli.model')).toBe(true);
    expect(jsonOutput.affectedTests).toContain('cli_test_mod/tests/test_cli.py');

    // 2. Run CLI: affected <file> --quiet
    const affectedQuietRes = spawnSync(
      process.execPath,
      [BIN, 'affected', 'cli_test_mod/my_model.py', '-p', tempDir, '--quiet'],
      {
        encoding: 'utf8',
        env: { ...process.env, AFYX_GRAPH_NO_DAEMON: '1' },
      }
    );

    expect(affectedQuietRes.status).toBe(0);
    const quietOutput = affectedQuietRes.stdout.trim().split('\n').map((l) => l.trim()).filter(Boolean);
    // Quiet output must only output test paths, with zero decorative headers
    expect(quietOutput).toEqual(['cli_test_mod/tests/test_cli.py']);
  });

  it('preserves standard behavior for non-Odoo repositories without adding odooImpact', () => {
    const nonOdooDir = path.join(tempDir, 'ts_project');
    const srcDir = path.join(nonOdooDir, 'src');
    const testDir = path.join(nonOdooDir, 'test');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.mkdirSync(testDir, { recursive: true });

    fs.writeFileSync(path.join(srcDir, 'util.ts'), 'export function add(a: number, b: number) { return a + b; }', 'utf8');
    fs.writeFileSync(path.join(testDir, 'util.test.ts'), 'import { add } from "../src/util"; test("add", () => add(1, 2));', 'utf8');

    const initRes = spawnSync(process.execPath, [BIN, 'init', nonOdooDir], {
      encoding: 'utf8',
      env: { ...process.env, AFYX_GRAPH_NO_DAEMON: '1' },
    });
    expect(initRes.status).toBe(0);

    const affectedRes = spawnSync(
      process.execPath,
      [BIN, 'affected', 'src/util.ts', '-p', nonOdooDir, '--json'],
      {
        encoding: 'utf8',
        env: { ...process.env, AFYX_GRAPH_NO_DAEMON: '1' },
      }
    );

    expect(affectedRes.status).toBe(0);
    const parsed = JSON.parse(affectedRes.stdout);

    // Standard fields
    expect(parsed.changedFiles).toContain('src/util.ts');
    expect(parsed.affectedTests).toContain('test/util.test.ts');
    // Non-Odoo repo: odooImpact must NOT be emitted
    expect(parsed.odooImpact).toBeUndefined();
  });
});
