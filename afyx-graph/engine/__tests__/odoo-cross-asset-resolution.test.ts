import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import AfyxGraph from '../src/index';
import { ToolHandler } from '../src/mcp/tools';

describe('TASK G8.2 — Native Odoo Cross-Asset Dependency Resolution', () => {
  let tempDir: string;
  let cg: AfyxGraph;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-odoo-g82-'));
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

  it('resolves cross-asset relationships between manifest, ACL CSV, security XML, and Python models', async () => {
    // -------------------------------------------------------------------------
    // Setup Module 1: purchase_request_fixture
    // -------------------------------------------------------------------------
    const modDir = path.join(tempDir, 'purchase_request_fixture');
    const secDir = path.join(modDir, 'security');
    const modelsDir = path.join(modDir, 'models');
    fs.mkdirSync(secDir, { recursive: true });
    fs.mkdirSync(modelsDir, { recursive: true });

    // 1. Manifest
    fs.writeFileSync(
      path.join(modDir, '__manifest__.py'),
      `{
    "name": "Synthetic Purchase Request Fixture",
    "version": "17.0.1.0.0",
    "depends": ["purchase_base_module", "external_unresolved_dep"],
    "data": [
        "security/purchase_request_security.xml",
        "security/ir.model.access.csv",
    ],
}`,
      'utf8',
    );

    // 2. Python Primary Model Declaration
    fs.writeFileSync(
      path.join(modelsDir, 'purchase_request.py'),
      `from odoo import models, fields

class PurchaseRequest(models.Model):
    _name = 'purchase.request'
    _description = 'Purchase Request Workflow'

    name = fields.Char('Title', required=True)
`,
      'utf8',
    );

    // 3. Python Model Extension and Classical Inheritance
    fs.writeFileSync(
      path.join(modelsDir, 'purchase_request_line.py'),
      `from odoo import models, fields

class PurchaseRequestLine(models.Model):
    _name = 'purchase.request.line'
    _inherit = 'purchase.request'
    _description = 'Purchase Request Line'

class PurchaseRequestExtension(models.Model):
    _inherit = 'purchase.request'

    def action_approve(self):
        return True
`,
      'utf8',
    );

    // 4. Security XML: res.groups and ir.rule
    fs.writeFileSync(
      path.join(secDir, 'purchase_request_security.xml'),
      `<odoo>
    <record id="group_purchase_request_user" model="res.groups">
        <field name="name">Purchase Request User</field>
        <field name="implied_ids" eval="[(4, ref('base.group_user'))]"/>
    </record>

    <record id="group_purchase_request_manager" model="res.groups">
        <field name="name">Purchase Request Manager</field>
        <field name="implied_ids" eval="[(4, ref('group_purchase_request_user'))]"/>
    </record>

    <record id="purchase_request_company_rule" model="ir.rule">
        <field name="name">Purchase Request Multi-Company</field>
        <field name="model_id" ref="model_purchase_request"/>
        <field name="domain_force">[('company_id', 'in', company_ids)]</field>
        <field name="groups" eval="[(4, ref('purchase_request_fixture.group_purchase_request_user'))]"/>
    </record>
</odoo>`,
      'utf8',
    );

    // 5. ACL CSV
    fs.writeFileSync(
      path.join(secDir, 'ir.model.access.csv'),
      `id,name,model_id:id,group_id:id,perm_read,perm_write,perm_create,perm_unlink
access_purchase_request_user,purchase.request user,model_purchase_request,group_purchase_request_user,1,1,1,0
access_purchase_request_manager,purchase.request manager,model_purchase_request,purchase_request_fixture.group_purchase_request_manager,1,1,1,1
access_purchase_request_line_user,purchase.request.line user,model_purchase_request_line,group_purchase_request_user,1,1,1,0
access_purchase_request_missing,missing model test,model_non_existent,group_purchase_request_user,1,0,0,0
`,
      'utf8',
    );

    // -------------------------------------------------------------------------
    // Setup Module 2: purchase_base_module (Local dependency)
    // -------------------------------------------------------------------------
    const baseModDir = path.join(tempDir, 'purchase_base_module');
    fs.mkdirSync(baseModDir, { recursive: true });
    fs.writeFileSync(
      path.join(baseModDir, '__manifest__.py'),
      `{
    "name": "Purchase Base Module",
    "version": "17.0.1.0.0",
    "depends": ["base"],
    "data": [],
}`,
      'utf8',
    );

    // Initialize graph, index all assets, and resolve references
    cg = await AfyxGraph.init(tempDir);
    await cg.indexAll();
    const resResult = await cg.resolveReferences();

    expect(resResult).toBeDefined();

    // -------------------------------------------------------------------------
    // Phase 2A Verification: ACL -> Python Model Resolution
    // -------------------------------------------------------------------------
    const prClassNodes = cg.getNodesByName('PurchaseRequest').filter((n) => n.kind === 'class');
    expect(prClassNodes.length).toBeGreaterThan(0);
    const prClass = prClassNodes[0]!;

    const aclUserNodes = cg.getNodesByName('access_purchase_request_user');
    expect(aclUserNodes.length).toBeGreaterThan(0);
    const aclUser = aclUserNodes[0]!;

    const outgoingAclUser = cg.getOutgoingEdges(aclUser.id);
    // Should have edge to PurchaseRequest class
    const aclToModelEdge = outgoingAclUser.find((e) => e.target === prClass.id);
    expect(aclToModelEdge).toBeDefined();
    expect(aclToModelEdge?.kind).toBe('references');

    // Missing model 'model_non_existent' must NOT fabricate a target node
    const aclMissingNodes = cg.getNodesByName('access_purchase_request_missing');
    expect(aclMissingNodes.length).toBeGreaterThan(0);
    const outgoingAclMissing = cg.getOutgoingEdges(aclMissingNodes[0]!.id);
    const fakeModelEdge = outgoingAclMissing.find((e) => e.target.includes('non_existent'));
    expect(fakeModelEdge).toBeUndefined();

    // -------------------------------------------------------------------------
    // Phase 2B Verification: Record Rule -> Model and Group Resolution
    // -------------------------------------------------------------------------
    const ruleNodes = cg.getNodesByName('purchase_request_company_rule');
    expect(ruleNodes.length).toBeGreaterThan(0);
    const ruleNode = ruleNodes[0]!;

    const outgoingRule = cg.getOutgoingEdges(ruleNode.id);
    // 1. Edge from ir.rule to model (PurchaseRequest class)
    const ruleToModel = outgoingRule.find((e) => e.target === prClass.id);
    expect(ruleToModel).toBeDefined();
    expect(ruleToModel?.kind).toBe('references');

    // 2. Edge from ir.rule to res.groups (group_purchase_request_user)
    const groupUserNodes = cg.getNodesByName('group_purchase_request_user');
    expect(groupUserNodes.length).toBeGreaterThan(0);
    const groupUserNode = groupUserNodes[0]!;
    const ruleToGroup = outgoingRule.find((e) => e.target === groupUserNode.id);
    expect(ruleToGroup).toBeDefined();
    expect(ruleToGroup?.kind).toBe('references');

    // 3. Intra-module implied_ids: group_purchase_request_manager -> group_purchase_request_user
    const groupMgrNodes = cg.getNodesByName('group_purchase_request_manager');
    expect(groupMgrNodes.length).toBeGreaterThan(0);
    const groupMgrNode = groupMgrNodes[0]!;
    const outgoingMgr = cg.getOutgoingEdges(groupMgrNode.id);
    const impliedEdge = outgoingMgr.find((e) => e.target === groupUserNode.id);
    expect(impliedEdge).toBeDefined();
    expect(impliedEdge?.kind).toBe('references');

    // 4. External implied_ids ('base.group_user') must remain honestly unresolved without fake nodes
    const outgoingGroupUser = cg.getOutgoingEdges(groupUserNode.id);
    const fakeBaseGroupEdge = outgoingGroupUser.find((e) => e.target.includes('base.group_user'));
    expect(fakeBaseGroupEdge).toBeUndefined();

    // -------------------------------------------------------------------------
    // Phase 2C Verification: Manifest -> Data Files and Module Dependencies
    // -------------------------------------------------------------------------
    const manifestNodes = cg.getNodesByName('Synthetic Purchase Request Fixture');
    expect(manifestNodes.length).toBeGreaterThan(0);
    const manifestNode = manifestNodes[0]!;
    const outgoingManifest = cg.getOutgoingEdges(manifestNode.id);

    // 1. Data file resolution: Manifest -> security XML and ACL CSV file nodes
    const dataEdges = outgoingManifest.filter((e) => e.kind === 'references');
    const targetFileNodes = dataEdges.map((e) => cg.getNode(e.target));
    expect(targetFileNodes.some((n) => n?.filePath.endsWith('purchase_request_security.xml'))).toBe(true);
    expect(targetFileNodes.some((n) => n?.filePath.endsWith('ir.model.access.csv'))).toBe(true);

    // 2. Module dependency: Manifest -> purchase_base_module (Local repo module)
    const baseModuleNodes = cg.getNodesByName('Purchase Base Module');
    expect(baseModuleNodes.length).toBeGreaterThan(0);
    const baseModuleNode = baseModuleNodes[0]!;
    const depEdge = outgoingManifest.find((e) => e.target === baseModuleNode.id);
    expect(depEdge).toBeDefined();
    expect(depEdge?.kind).toBe('imports');

    // 3. External module dependency ('external_unresolved_dep') must not fabricate node
    const fakeDepEdge = outgoingManifest.find((e) => e.target.includes('external_unresolved_dep'));
    expect(fakeDepEdge).toBeUndefined();

    // -------------------------------------------------------------------------
    // Phase 2D Verification: Python Model Relationships
    // -------------------------------------------------------------------------
    // 1. Classical Inheritance: PurchaseRequestLine -> PurchaseRequest
    const prLineClassNodes = cg.getNodesByName('PurchaseRequestLine').filter((n) => n.kind === 'class');
    expect(prLineClassNodes.length).toBeGreaterThan(0);
    const prLineClass = prLineClassNodes[0]!;
    const outgoingPrLine = cg.getOutgoingEdges(prLineClass.id);
    const classicalInheritEdge = outgoingPrLine.find((e) => e.target === prClass.id);
    expect(classicalInheritEdge).toBeDefined();
    expect(classicalInheritEdge?.kind).toBe('extends');

    // 2. In-place Extension: PurchaseRequestExtension -> PurchaseRequest
    const prExtClassNodes = cg.getNodesByName('PurchaseRequestExtension').filter((n) => n.kind === 'class');
    expect(prExtClassNodes.length).toBeGreaterThan(0);
    const prExtClass = prExtClassNodes[0]!;
    const outgoingPrExt = cg.getOutgoingEdges(prExtClass.id);
    const inPlaceExtEdge = outgoingPrExt.find((e) => e.target === prClass.id);
    expect(inPlaceExtEdge).toBeDefined();
    expect(inPlaceExtEdge?.kind).toBe('extends');

    // Verify distinction: both classes exist distinctly, not collapsed
    expect(prClass.id).not.toBe(prExtClass.id);
    expect(prClass.id).not.toBe(prLineClass.id);

    // -------------------------------------------------------------------------
    // MCP Tool Observability Verification (afyx_graph_explore)
    // -------------------------------------------------------------------------
    const handler = new ToolHandler(cg);
    const exploreResult = await handler.handleExplore({ query: 'purchase_request_company_rule' });
    const exploreText = JSON.stringify(exploreResult);
    expect(exploreText).toContain('purchase_request_company_rule');
    expect(exploreText).toContain('PurchaseRequest');
  });

  it('safely handles path traversal in manifest data files and preserves security bounds', async () => {
    const evilModDir = path.join(tempDir, 'evil_module');
    fs.mkdirSync(evilModDir, { recursive: true });

    // Attempt directory traversal out of module boundary
    fs.writeFileSync(
      path.join(evilModDir, '__manifest__.py'),
      `{
    "name": "Evil Module",
    "version": "1.0",
    "data": [
        "../../sensitive.xml",
        "/etc/passwd",
        "C:\\\\Windows\\\\System32\\\\cmd.exe",
    ],
}`,
      'utf8',
    );

    cg = await AfyxGraph.init(tempDir);
    await cg.indexAll();
    await cg.resolveReferences();

    const evilModNodes = cg.getNodesByName('Evil Module');
    expect(evilModNodes.length).toBeGreaterThan(0);
    const evilMod = evilModNodes[0]!;
    const outgoing = cg.getOutgoingEdges(evilMod.id);

    // Traversal attempts must NOT resolve to any target node
    expect(outgoing.length).toBe(0);
  });

  it('explicitly handles ambiguous model definitions without incorrect guessing', async () => {
    // Module A defines 'conflict.model'
    const modADir = path.join(tempDir, 'module_a');
    fs.mkdirSync(path.join(modADir, 'models'), { recursive: true });
    fs.writeFileSync(
      path.join(modADir, '__manifest__.py'),
      `{ "name": "Module A", "version": "1.0", "data": [] }`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(modADir, 'models/a.py'),
      `from odoo import models
class ConflictA(models.Model):
    _name = 'conflict.model'
`,
      'utf8',
    );

    // Module B also defines 'conflict.model'
    const modBDir = path.join(tempDir, 'module_b');
    fs.mkdirSync(path.join(modBDir, 'models'), { recursive: true });
    fs.writeFileSync(
      path.join(modBDir, '__manifest__.py'),
      `{ "name": "Module B", "version": "1.0", "data": [] }`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(modBDir, 'models/b.py'),
      `from odoo import models
class ConflictB(models.Model):
    _name = 'conflict.model'
`,
      'utf8',
    );

    // Module C (unrelated) tries to reference 'conflict.model' via ACL
    const modCDir = path.join(tempDir, 'module_c');
    fs.mkdirSync(path.join(modCDir, 'security'), { recursive: true });
    fs.writeFileSync(
      path.join(modCDir, '__manifest__.py'),
      `{ "name": "Module C", "version": "1.0", "data": ["security/ir.model.access.csv"] }`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(modCDir, 'security/ir.model.access.csv'),
      `id,name,model_id:id,group_id:id,perm_read,perm_write,perm_create,perm_unlink
access_ambiguous,ambiguous access,model_conflict_model,,1,0,0,0
`,
      'utf8',
    );

    cg = await AfyxGraph.init(tempDir);
    await cg.indexAll();
    await cg.resolveReferences();

    const aclNodes = cg.getNodesByName('access_ambiguous');
    expect(aclNodes.length).toBeGreaterThan(0);
    const aclNode = aclNodes[0]!;
    const outgoing = cg.getOutgoingEdges(aclNode.id);

    // Irreconcilably ambiguous: must NOT arbitrarily pick ConflictA or ConflictB
    expect(outgoing.length).toBe(0);
  });

  it('reconciles correctly across lifecycle: incremental sync, modification, and restart', async () => {
    const modDir = path.join(tempDir, 'lifecycle_module');
    const secDir = path.join(modDir, 'security');
    const modelsDir = path.join(modDir, 'models');
    fs.mkdirSync(secDir, { recursive: true });
    fs.mkdirSync(modelsDir, { recursive: true });

    fs.writeFileSync(
      path.join(modDir, '__manifest__.py'),
      `{ "name": "Lifecycle Module", "version": "1.0", "data": ["security/ir.model.access.csv"] }`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(modelsDir, 'first_model.py'),
      `from odoo import models
class FirstModel(models.Model):
    _name = 'lifecycle.target'
`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(secDir, 'ir.model.access.csv'),
      `id,name,model_id:id,group_id:id,perm_read,perm_write,perm_create,perm_unlink
access_lifecycle,lifecycle access,model_lifecycle_target,,1,0,0,0
`,
      'utf8',
    );

    // 1. Initial Index & Resolution
    cg = await AfyxGraph.init(tempDir);
    await cg.indexAll();
    await cg.resolveReferences();

    const aclNode = cg.getNodesByName('access_lifecycle')[0]!;
    const targetClass = cg.getNodesByName('FirstModel')[0]!;
    expect(cg.getOutgoingEdges(aclNode.id).some((e) => e.target === targetClass.id)).toBe(true);

    // 2. Restart graph and verify persistence
    await cg.close();
    cg = await AfyxGraph.open(tempDir);
    expect(cg.getOutgoingEdges(aclNode.id).some((e) => e.target === targetClass.id)).toBe(true);

    // 3. Modify ACL file: change model_id from model_lifecycle_target to model_new_target
    fs.writeFileSync(
      path.join(modelsDir, 'new_model.py'),
      `from odoo import models
class NewModel(models.Model):
    _name = 'new.target'
`,
      'utf8',
    );
    fs.writeFileSync(
      path.join(secDir, 'ir.model.access.csv'),
      `id,name,model_id:id,group_id:id,perm_read,perm_write,perm_create,perm_unlink
access_lifecycle,lifecycle access,model_new_target,,1,0,0,0
`,
      'utf8',
    );

    await cg.sync();
    await cg.resolveReferences();

    const updatedAclNode = cg.getNodesByName('access_lifecycle')[0]!;
    const newTargetClass = cg.getNodesByName('NewModel')[0]!;
    const outgoingAfterChange = cg.getOutgoingEdges(updatedAclNode.id);

    // Edge now points to new target, old edge is cleaned up
    expect(outgoingAfterChange.some((e) => e.target === targetClass.id)).toBe(false);
    expect(outgoingAfterChange.some((e) => e.target === newTargetClass.id)).toBe(true);

    // 4. Delete target file and verify edge cascades to clean removal
    fs.unlinkSync(path.join(modelsDir, 'new_model.py'));
    await cg.sync();

    const outgoingAfterDelete = cg.getOutgoingEdges(updatedAclNode.id);
    expect(outgoingAfterDelete.some((e) => e.target === newTargetClass.id)).toBe(false);
  });
});
