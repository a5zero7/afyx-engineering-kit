import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import AfyxGraph from '../src/index';
import { ToolHandler } from '../src/mcp/tools';

describe('TASK G8.1 — Graph Storage & MCP Retrieval Integration for Odoo Security', () => {
  let tempDir: string;
  let cg: AfyxGraph;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-odoo-test-'));
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

  it('indexes an Odoo module end-to-end and resolves security assets via Graph queries', async () => {
    // Setup synthetic module structure
    const moduleDir = path.join(tempDir, 'purchase_request_fixture');
    const secDir = path.join(moduleDir, 'security');
    fs.mkdirSync(secDir, { recursive: true });

    // 1. __manifest__.py
    fs.writeFileSync(
      path.join(moduleDir, '__manifest__.py'),
      `{
    "name": "Synthetic Purchase Request Fixture",
    "version": "17.0.1.0.0",
    "depends": ["purchase", "mail"],
    "data": [
        "security/purchase_request_security.xml",
        "security/ir.model.access.csv",
    ],
    "license": "LGPL-3",
}`,
      'utf8',
    );

    // 2. security/ir.model.access.csv
    fs.writeFileSync(
      path.join(secDir, 'ir.model.access.csv'),
      `id,name,model_id:id,group_id:id,perm_read,perm_write,perm_create,perm_unlink
access_purchase_request_user,purchase.request user,model_purchase_request,purchase.group_purchase_user,1,1,1,0
access_purchase_request_manager,purchase.request manager,model_purchase_request,purchase.group_purchase_manager,1,1,1,1
`,
      'utf8',
    );

    // 3. security/purchase_request_security.xml
    fs.writeFileSync(
      path.join(secDir, 'purchase_request_security.xml'),
      `<odoo>
    <record id="purchase_request_company_rule" model="ir.rule">
        <field name="name">Purchase Request multi-company</field>
        <field name="model_id" ref="model_purchase_request"/>
        <field name="domain_force">[('company_id', 'in', company_ids)]</field>
        <field name="groups" eval="[(4, ref('purchase.group_purchase_user'))]"/>
    </record>
</odoo>`,
      'utf8',
    );

    // Initialize and index AfyxGraph
    cg = await AfyxGraph.init(tempDir);
    await cg.indexAll();
    await cg.resolveReferences();

    // Verification 1: Manifest node stored
    const manifestNodes = cg.searchNodes('Synthetic Purchase Request Fixture');
    expect(manifestNodes.length).toBeGreaterThan(0);
    const modNode = manifestNodes.find((n) => n.node.kind === 'module')?.node;
    expect(modNode).toBeDefined();
    expect(modNode?.name).toBe('Synthetic Purchase Request Fixture');

    // Verification 2: ACL CSV rules stored with complete permission signatures
    const userAclNodes = cg.searchNodes('access_purchase_request_user');
    expect(userAclNodes.length).toBeGreaterThan(0);
    const userAcl = userAclNodes[0]!.node;
    expect(userAcl.kind).toBe('constant');
    expect(userAcl.signature).toContain('read:1');
    expect(userAcl.signature).toContain('unlink:0');
    expect(userAcl.filePath).toContain('ir.model.access.csv');

    // Verification 3: Record rules stored with domain and scope
    const ruleNodes = cg.searchNodes('purchase_request_company_rule');
    expect(ruleNodes.length).toBeGreaterThan(0);
    const compRule = ruleNodes[0]!.node;
    expect(compRule.kind).toBe('constant');
    expect(compRule.signature).toContain("[('company_id', 'in', company_ids)]");
    expect(compRule.signature).toContain('purchase.group_purchase_user');

    // Verification 4: afyx_graph_explore retrieval via MCP explore
    const handler = new ToolHandler(cg);
    const exploreResult = await handler.handleExplore({ query: 'purchase_request_company_rule' });
    const exploreText = JSON.stringify(exploreResult);
    expect(exploreText).toContain('purchase_request_company_rule');
    expect(exploreText).toContain('Purchase Request multi-company');
    expect(exploreText).toContain('company_ids');

    const aclExploreResult = await handler.handleExplore({ query: 'access_purchase_request_user' });
    const aclExploreText = JSON.stringify(aclExploreResult);
    expect(aclExploreText).toContain('access_purchase_request_user');
    expect(aclExploreText).toContain('model_purchase_request');

    // Verification 5: Incremental sync and updates
    // Modify the ACL file to grant unlink permission to user
    fs.writeFileSync(
      path.join(secDir, 'ir.model.access.csv'),
      `id,name,model_id:id,group_id:id,perm_read,perm_write,perm_create,perm_unlink
access_purchase_request_user,purchase.request user,model_purchase_request,purchase.group_purchase_user,1,1,1,1
access_purchase_request_manager,purchase.request manager,model_purchase_request,purchase.group_purchase_manager,1,1,1,1
`,
      'utf8',
    );

    await cg.sync();

    const updatedUserAclNodes = cg.searchNodes('access_purchase_request_user');
    expect(updatedUserAclNodes.length).toBeGreaterThan(0);
    expect(updatedUserAclNodes[0]!.node.signature).toContain('unlink:1');
  });
});
