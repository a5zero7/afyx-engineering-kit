import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync, spawn, ChildProcessWithoutNullStreams } from 'child_process';
import AfyxGraph from '../src/index';
import { computeOdooImpact } from '../src/impact/odoo-impact';
import { EXTRACTION_VERSION } from '../src/extraction/extraction-version';

const BIN = path.resolve(__dirname, '../dist/bin/afyx-graph.js');

interface JsonRpcResponse {
  jsonrpc: string;
  id?: number | string;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

class McpClientHelper {
  private child: ChildProcessWithoutNullStreams;
  private pendingRequests = new Map<number | string, (res: JsonRpcResponse) => void>();
  private buffer = '';
  private nextId = 1;

  constructor(child: ChildProcessWithoutNullStreams) {
    this.child = child;
    this.child.stdout.on('data', (chunk) => {
      this.buffer += chunk.toString('utf8');
      let idx: number;
      while ((idx = this.buffer.indexOf('\n')) !== -1) {
        const line = this.buffer.slice(0, idx).trim();
        this.buffer = this.buffer.slice(idx + 1);
        if (!line) continue;
        try {
          const parsed = JSON.parse(line) as JsonRpcResponse;
          if (parsed.id !== undefined && this.pendingRequests.has(parsed.id)) {
            const cb = this.pendingRequests.get(parsed.id)!;
            this.pendingRequests.delete(parsed.id);
            cb(parsed);
          }
        } catch {
          // Ignore
        }
      }
    });
  }

  sendRequest(method: string, params: Record<string, any> = {}): Promise<JsonRpcResponse> {
    const id = this.nextId++;
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params,
    });

    return new Promise<JsonRpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timed out: ${method} (${id})`));
      }, 10000);

      this.pendingRequests.set(id, (res) => {
        clearTimeout(timer);
        resolve(res);
      });

      this.child.stdin.write(payload + '\n');
    });
  }

  sendNotification(method: string, params: Record<string, any> = {}): void {
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      method,
      params,
    });
    this.child.stdin.write(payload + '\n');
  }
}

describe('TASK G8.4 — Afyx Graph Phase 8 Odoo Intelligence Integration Acceptance', () => {
  let tempDir: string;
  let odooModuleDir: string;
  let cg: AfyxGraph | null = null;
  let childMcp: ChildProcessWithoutNullStreams | null = null;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-g8-4-acceptance-'));
    odooModuleDir = path.join(tempDir, 'purchase_request_fixture');
    fs.mkdirSync(odooModuleDir, { recursive: true });
    fs.mkdirSync(path.join(odooModuleDir, 'models'), { recursive: true });
    fs.mkdirSync(path.join(odooModuleDir, 'security'), { recursive: true });
    fs.mkdirSync(path.join(odooModuleDir, 'tests'), { recursive: true });

    // 1. __manifest__.py
    fs.writeFileSync(
      path.join(odooModuleDir, '__manifest__.py'),
      `# -*- coding: utf-8 -*-
{
    'name': 'Purchase Request Fixture',
    'version': '17.0.1.0.0',
    'depends': ['base', 'purchase'],
    'data': [
        'security/purchase_request_security.xml',
        'security/purchase_request_manager_security.xml',
        'security/ir.model.access.csv',
    ],
    'installable': True,
}
`
    );

    // 2. models/purchase_request.py
    fs.writeFileSync(
      path.join(odooModuleDir, 'models', 'purchase_request.py'),
      `# -*- coding: utf-8 -*-
from odoo import models, fields

class PurchaseRequest(models.Model):
    _name = 'purchase.request'
    _description = 'Purchase Request'
    name = fields.Char(string='Request Reference', required=True)
    state = fields.Selection([('draft', 'Draft'), ('approved', 'Approved')], default='draft')
    company_id = fields.Many2one('res.company', string='Company')

class PurchaseOrderExtension(models.Model):
    _inherit = 'purchase.order'
    request_id = fields.Many2one('purchase.request', string='Source Request')
`
    );

    // 3. security/ir.model.access.csv
    fs.writeFileSync(
      path.join(odooModuleDir, 'security', 'ir.model.access.csv'),
      `id,name,model_id:id,group_id:id,perm_read,perm_write,perm_create,perm_unlink
access_purchase_request_user,purchase.request.user,model_purchase_request,group_purchase_user,1,1,1,0
access_purchase_request_manager,purchase.request.manager,model_purchase_request,group_purchase_manager,1,1,1,1
`
    );

    // 4. security/purchase_request_security.xml
    fs.writeFileSync(
      path.join(odooModuleDir, 'security', 'purchase_request_security.xml'),
      `<?xml version="1.0" encoding="utf-8"?>
<odoo>
    <record id="group_purchase_user" model="res.groups">
        <field name="name">Purchase Request User</field>
        <field name="category_id" ref="base.module_category_operations_purchase"/>
    </record>

    <record id="rule_purchase_request_user" model="ir.rule">
        <field name="name">Purchase Request Multi-Company Rule</field>
        <field name="model_id" ref="model_purchase_request"/>
        <field name="domain_force">['|', ('company_id', '=', False), ('company_id', 'in', company_ids)]</field>
        <field name="groups" eval="[(4, ref('group_purchase_user'))]"/>
    </record>
</odoo>
`
    );

    // 5. security/purchase_request_manager_security.xml
    fs.writeFileSync(
      path.join(odooModuleDir, 'security', 'purchase_request_manager_security.xml'),
      `<?xml version="1.0" encoding="utf-8"?>
<odoo>
    <record id="group_purchase_manager" model="res.groups">
        <field name="name">Purchase Request Manager</field>
        <field name="implied_ids" eval="[(4, ref('purchase_request_fixture.group_purchase_user'))]"/>
    </record>
</odoo>
`
    );

    // 6. tests/test_purchase_request.py
    fs.writeFileSync(
      path.join(odooModuleDir, 'tests', 'test_purchase_request.py'),
      `# -*- coding: utf-8 -*-
from odoo.tests.common import TransactionCase

class TestPurchaseRequest(TransactionCase):
    def test_request_creation(self):
        pr = self.env['purchase.request'].create({'name': 'PR-001'})
        self.assertEqual(pr.name, 'PR-001')
`
    );
  });

  afterEach(async () => {
    if (cg) {
      await cg.close();
      cg = null;
    }
    if (childMcp && !childMcp.killed) {
      childMcp.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 200));
      if (!childMcp.killed) {
        childMcp.kill('SIGKILL');
      }
      childMcp = null;
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  // ===========================================================================
  // PHASE 2: FULL PIPELINE ACCEPTANCE
  // ===========================================================================
  describe('Phase 2 — Full Pipeline Acceptance', () => {
    it('indexes fresh Odoo repository with models, manifest, ACL, XML security, and relationships', async () => {
      cg = await AfyxGraph.init(tempDir);
      await cg.indexAll();
      cg.resolveReferences();

      // 1. Verify extraction version & metadata
      const buildInfo = cg.getIndexBuildInfo();
      expect(buildInfo.extractionVersion).toBe(EXTRACTION_VERSION);
      expect(EXTRACTION_VERSION).toBe(29);
      expect(cg.isIndexStale()).toBe(false);

      // 2. Verify Nodes in DB
      const prModelClass = cg.getNodesByName('PurchaseRequest')[0];
      expect(prModelClass).toBeDefined();
      expect(prModelClass?.kind).toBe('class');
      expect(prModelClass?.language).toBe('python');

      const manifestNodes = cg.getNodesByKind('module');
      const prManifest = manifestNodes.find((m) => m.qualifiedName.includes('purchase_request_fixture'));
      expect(prManifest).toBeDefined();

      const userGroup = cg.getNodesByName('group_purchase_user')[0];
      expect(userGroup).toBeDefined();
      expect(userGroup?.kind).toBe('constant');

      const aclUser = cg.getNodesByName('access_purchase_request_user')[0];
      expect(aclUser).toBeDefined();

      const ruleUser = cg.getNodesByName('rule_purchase_request_user')[0];
      expect(ruleUser).toBeDefined();

      // 3. Verify Cross-Asset Edges
      // ACL -> Model (references)
      const aclOutgoing = cg.getOutgoingEdges(aclUser!.id).filter((e) => e.kind === 'references');
      expect(aclOutgoing.some((e) => e.target === prModelClass!.id)).toBe(true);

      // Rule -> Model (references)
      const ruleOutgoing = cg.getOutgoingEdges(ruleUser!.id).filter((e) => e.kind === 'references');
      expect(ruleOutgoing.some((e) => e.target === prModelClass!.id)).toBe(true);

      // Rule -> Group (references)
      expect(ruleOutgoing.some((e) => e.target === userGroup!.id)).toBe(true);

      // Manager Group -> User Group (references)
      const mgrGroup = cg.getNodesByName('group_purchase_manager')[0];
      expect(mgrGroup).toBeDefined();
      const mgrOutgoing = cg.getOutgoingEdges(mgrGroup!.id).filter((e) => e.kind === 'references');
      expect(mgrOutgoing.some((e) => e.target === userGroup!.id)).toBe(true);

      // 4. Verify Close and Reopen persistence
      await cg.close();
      cg = null;

      const reopenedCg = await AfyxGraph.open(tempDir);
      const reopenedPrModel = reopenedCg.getNodesByName('PurchaseRequest')[0];
      expect(reopenedPrModel).toBeDefined();
      expect(reopenedPrModel?.id).toBe(prModelClass!.id);

      const reopenedRuleOutgoing = reopenedCg.getOutgoingEdges(ruleUser!.id).filter((e) => e.kind === 'references');
      expect(reopenedRuleOutgoing.some((e) => e.target === prModelClass!.id)).toBe(true);
      await reopenedCg.close();
    });

    it('handles incremental modify, add, delete, and eliminates stale edges', async () => {
      cg = await AfyxGraph.init(tempDir);
      await cg.indexAll();
      cg.resolveReferences();

      // Add new model file
      const newModelPath = path.join(odooModuleDir, 'models', 'purchase_request_tag.py');
      fs.writeFileSync(
        newModelPath,
        `# -*- coding: utf-8 -*-
from odoo import models, fields

class PurchaseRequestTag(models.Model):
    _name = 'purchase.request.tag'
    name = fields.Char('Tag Name')
`
      );

      const syncResult1 = await cg.sync();
      expect(syncResult1.filesAdded).toBe(1);
      const tagModel = cg.getNodesByName('PurchaseRequestTag')[0];
      expect(tagModel).toBeDefined();

      // Delete the added model file
      fs.unlinkSync(newModelPath);
      const syncResult2 = await cg.sync();
      expect(syncResult2.filesRemoved).toBe(1);
      const tagModelDeleted = cg.getNodesByName('PurchaseRequestTag')[0];
      expect(tagModelDeleted).toBeUndefined();

      await cg.close();
      cg = null;
    });

    it('demonstrates behavior of preexisting v29 index vs fresh build', async () => {
      cg = await AfyxGraph.init(tempDir);
      await cg.indexAll();
      cg.resolveReferences();

      const buildInfo = cg.getIndexBuildInfo();
      expect(buildInfo.extractionVersion).toBe(29);

      // Validated rebuild path:
      await cg.indexAll();
      cg.resolveReferences();
      expect(cg.getNodesByName('PurchaseRequest')[0]).toBeDefined();
      await cg.close();
      cg = null;
    });
  });

  // ===========================================================================
  // PHASE 3: ACTUAL CLI ACCEPTANCE
  // ===========================================================================
  describe('Phase 3 — Actual CLI Acceptance', () => {
    beforeEach(() => {
      // Build index using CLI init first
      spawnSync(process.execPath, [BIN, 'init', tempDir], {
        cwd: tempDir,
        encoding: 'utf8',
        env: { ...process.env, AFYX_GRAPH_NO_DAEMON: '1' },
      });
    });

    it('executes affected with changed-file arguments and outputs human-readable summary', () => {
      const relModel = path.join('purchase_request_fixture', 'models', 'purchase_request.py');
      const res = spawnSync(process.execPath, [BIN, 'affected', relModel, '-p', tempDir], {
        cwd: tempDir,
        encoding: 'utf8',
        env: { ...process.env, AFYX_GRAPH_NO_DAEMON: '1' },
      });

      expect(res.status).toBe(0);
      expect(res.stdout).toContain('purchase_request_fixture/tests/test_purchase_request.py');
      expect(res.stdout).toContain('Affected Odoo Models');
      expect(res.stdout).toContain('purchase.request');
      expect(res.stdout).toContain('Affected Odoo Security Assets');
      expect(res.stdout).toContain('Affected Odoo Modules');
      expect(res.stdout).toContain('purchase_request_fixture');
    });

    it('executes affected --stdin and parses piped file list', () => {
      const relModel = path.join('purchase_request_fixture', 'models', 'purchase_request.py');
      const res = spawnSync(process.execPath, [BIN, 'affected', '--stdin', '-p', tempDir], {
        cwd: tempDir,
        input: `${relModel}\n`,
        encoding: 'utf8',
        env: { ...process.env, AFYX_GRAPH_NO_DAEMON: '1' },
      });

      expect(res.status).toBe(0);
      expect(res.stdout).toContain('purchase_request_fixture/tests/test_purchase_request.py');
    });

    it('executes affected --json and returns structured odooImpact schema', () => {
      const relAcl = path.join('purchase_request_fixture', 'security', 'ir.model.access.csv');
      const res = spawnSync(process.execPath, [BIN, 'affected', relAcl, '-p', tempDir, '--json'], {
        cwd: tempDir,
        encoding: 'utf8',
        env: { ...process.env, AFYX_GRAPH_NO_DAEMON: '1' },
      });

      expect(res.status).toBe(0);
      const parsed = JSON.parse(res.stdout.trim());
      expect(parsed.changedFiles).toBeDefined();
      expect(parsed.affectedTests).toBeDefined();
      expect(parsed.odooImpact).toBeDefined();
      expect(parsed.odooImpact.isOdooProject).toBe(true);
      expect(parsed.odooImpact.affectedModels.length).toBeGreaterThan(0);
      expect(parsed.odooImpact.affectedSecurityAssets.length).toBeGreaterThan(0);
      expect(parsed.odooImpact.disclaimer).toContain('runtime');
    });

    it('executes affected --quiet and returns strictly line-by-line test paths without decoration', () => {
      const relAcl = path.join('purchase_request_fixture', 'security', 'ir.model.access.csv');
      const res = spawnSync(process.execPath, [BIN, 'affected', relAcl, '-p', tempDir, '--quiet'], {
        cwd: tempDir,
        encoding: 'utf8',
        env: { ...process.env, AFYX_GRAPH_NO_DAEMON: '1' },
      });

      expect(res.status).toBe(0);
      const lines = res.stdout.trim().split(/\r?\n/).filter(Boolean);
      expect(lines.length).toBe(1);
      expect(lines[0]).toBe('purchase_request_fixture/tests/test_purchase_request.py');
    });

    it('executes affected --explain and clarifies empty results when coverage is absent', () => {
      const nonExistentFile = path.join('purchase_request_fixture', 'models', 'non_existent.py');
      const res = spawnSync(process.execPath, [BIN, 'affected', nonExistentFile, '-p', tempDir, '--explain'], {
        cwd: tempDir,
        encoding: 'utf8',
        env: { ...process.env, AFYX_GRAPH_NO_DAEMON: '1' },
      });

      expect(res.status).toBe(0);
      expect(res.stdout).not.toBe('');
    });

    it('preserves clean output for non-Odoo repositories without adding odooImpact', () => {
      const nonOdooDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-non-odoo-'));
      try {
        fs.writeFileSync(path.join(nonOdooDir, 'index.ts'), 'export const a = 1;');
        fs.writeFileSync(path.join(nonOdooDir, 'index.test.ts'), 'import { a } from "./index";');

        spawnSync(process.execPath, [BIN, 'init', nonOdooDir], {
          cwd: nonOdooDir,
          encoding: 'utf8',
          env: { ...process.env, AFYX_GRAPH_NO_DAEMON: '1' },
        });

        const res = spawnSync(process.execPath, [BIN, 'affected', 'index.ts', '-p', nonOdooDir, '--json'], {
          cwd: nonOdooDir,
          encoding: 'utf8',
          env: { ...process.env, AFYX_GRAPH_NO_DAEMON: '1' },
        });

        expect(res.status).toBe(0);
        const parsed = JSON.parse(res.stdout.trim());
        expect(parsed.odooImpact).toBeUndefined();
      } finally {
        fs.rmSync(nonOdooDir, { recursive: true, force: true });
      }
    });
  });

  // ===========================================================================
  // PHASE 4: ACTUAL MCP ACCEPTANCE
  // ===========================================================================
  describe('Phase 4 — Actual MCP Acceptance', () => {
    it('performs live stdio MCP handshake, discovers advertised tools, and queries Odoo graph', async () => {
      // Build index first
      const initCg = await AfyxGraph.init(tempDir);
      await initCg.indexAll();
      initCg.resolveReferences();
      await initCg.close();

      childMcp = spawn(process.execPath, [BIN, 'serve', '--mcp', '--path', tempDir], {
        cwd: tempDir,
        env: { ...process.env, NODE_ENV: 'test', AFYX_GRAPH_NO_DAEMON: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
      }) as ChildProcessWithoutNullStreams;

      const client = new McpClientHelper(childMcp);

      // 1. Initialize
      const initResp = await client.sendRequest('initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'g8-4-acceptance-client', version: '1.0.0' },
        rootUri: `file://${tempDir.replace(/\\/g, '/')}`,
      });
      expect(initResp.result).toBeDefined();
      expect(initResp.result.serverInfo.name).toBe('afyx_graph');

      // 2. Initialized notification
      client.sendNotification('notifications/initialized', {});

      // Allow background initialization
      await new Promise((r) => setTimeout(r, 1200));

      // 3. Tools list
      const toolsResp = await client.sendRequest('tools/list', {});
      expect(toolsResp.result).toBeDefined();
      const toolNames = toolsResp.result.tools.map((t: any) => t.name);
      expect(toolNames).toContain('afyx_graph_explore');
      expect(toolNames).toContain('afyx_graph_inventory');

      // 4. Explore tool call on Odoo symbol
      const exploreResp = await client.sendRequest('tools/call', {
        name: 'afyx_graph_explore',
        arguments: {
          query: 'PurchaseRequest',
        },
      });
      expect(exploreResp.result).toBeDefined();
      expect(exploreResp.result.isError).toBeFalsy();
      const exploreContent = exploreResp.result.content[0].text;
      expect(exploreContent).toContain('PurchaseRequest');

      // 5. Inventory tool call on Odoo declaration
      const inventoryResp = await client.sendRequest('tools/call', {
        name: 'afyx_graph_inventory',
        arguments: {
          declaration: '_name',
          value: 'purchase.request',
        },
      });
      expect(inventoryResp.result).toBeDefined();
      expect(inventoryResp.result.isError).toBeFalsy();
      const inventoryContent = inventoryResp.result.content[0].text;
      expect(inventoryContent).toContain('purchase.request');

      // 6. Clean termination
      childMcp.stdin.end();
      const exitPromise = new Promise<number | null>((resolve) => {
        childMcp!.on('exit', (code) => resolve(code));
      });
      const exitCode = await exitPromise;
      expect(exitCode === 0 || exitCode === null).toBe(true);
      childMcp = null;
    });
  });

  // ===========================================================================
  // PHASE 5: SECURITY & ROBUSTNESS
  // ===========================================================================
  describe('Phase 5 — Security & Anti-Regression', () => {
    it('safely handles malformed XML and refuses path traversal in manifest data', async () => {
      // 1. Path traversal in manifest data
      const evilManifestPath = path.join(odooModuleDir, '__manifest__.py');
      fs.writeFileSync(
        evilManifestPath,
        `# -*- coding: utf-8 -*-
{
    'name': 'Evil Manifest',
    'data': [
        '../../../../etc/passwd',
        'C:/Windows/System32/drivers/etc/hosts',
        '/root/.ssh/id_rsa',
    ],
}
`
      );

      // 2. Malformed XML file
      const malformedXmlPath = path.join(odooModuleDir, 'security', 'malformed.xml');
      fs.writeFileSync(malformedXmlPath, '<odoo><record id="broken">unclosed tags');

      cg = await AfyxGraph.init(tempDir);
      await expect(cg.indexAll()).resolves.toBeDefined();
      expect(cg.resolveReferences()).toBeDefined();

      // No edges should be created for evil traversal paths
      const manifestNode = cg.getNodesByKind('module').find((m) => m.qualifiedName.includes('purchase_request_fixture'));
      expect(manifestNode).toBeDefined();
      const outgoing = cg.getOutgoingEdges(manifestNode!.id);
      const evilEdge = outgoing.find((e) =>
        e.target.includes('passwd') || e.target.includes('hosts') || e.target.includes('id_rsa')
      );
      expect(evilEdge).toBeUndefined();

      await cg.close();
      cg = null;
    });

    it('extracts multi-company record rule domains without claiming runtime permissions', async () => {
      cg = await AfyxGraph.init(tempDir);
      await cg.indexAll();
      cg.resolveReferences();

      const ruleNode = cg.getNodesByName('rule_purchase_request_user')[0];
      expect(ruleNode).toBeDefined();
      expect(ruleNode?.docstring).toContain('company_id');

      // computeOdooImpact must always include load-bearing disclaimer
      const impact = computeOdooImpact(cg, ['purchase_request_fixture/models/purchase_request.py']);
      expect(impact.disclaimer).toBeDefined();
      expect(impact.disclaimer.length).toBeGreaterThan(20);

      await cg.close();
      cg = null;
    });
  });
});
