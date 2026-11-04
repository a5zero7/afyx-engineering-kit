import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import AfyxGraph from '../src/index';

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
          // Ignore non-json or partial lines
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
        reject(new Error(`MCP request '${method}' timed out after 10000ms`));
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

describe('TASK G8.1R — Native Odoo Security MCP Stdio Transport Verification', () => {
  let tempDir: string;
  let child: ChildProcessWithoutNullStreams | null = null;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-odoo-transport-'));
  });

  afterEach(async () => {
    if (child && !child.killed) {
      child.kill('SIGTERM');
      // Grace period
      await new Promise((r) => setTimeout(r, 200));
      if (!child.killed) {
        child.kill('SIGKILL');
      }
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  });

  it('performs live stdio MCP handshake, discovers tools, and retrieves Odoo security knowledge', async () => {
    // 1. Setup synthetic Odoo module fixture
    const moduleDir = path.join(tempDir, 'purchase_request_fixture');
    const secDir = path.join(moduleDir, 'security');
    const modelsDir = path.join(moduleDir, 'models');
    fs.mkdirSync(secDir, { recursive: true });
    fs.mkdirSync(modelsDir, { recursive: true });

    fs.writeFileSync(
      path.join(moduleDir, '__manifest__.py'),
      `{
    "name": "Synthetic Purchase Request Fixture",
    "version": "17.0.1.0.0",
    "depends": ["purchase"],
    "data": [
        "security/purchase_request_security.xml",
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
`,
      'utf8',
    );

    fs.writeFileSync(
      path.join(secDir, 'ir.model.access.csv'),
      `id,name,model_id:id,group_id:id,perm_read,perm_write,perm_create,perm_unlink
access_purchase_request_user,purchase.request user,model_purchase_request,purchase.group_purchase_user,1,1,1,0
`,
      'utf8',
    );

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

    // Initialize and index fixture so .afyx-graph exists
    const initCg = await AfyxGraph.init(tempDir);
    await initCg.indexAll();
    await initCg.resolveReferences();
    await initCg.close();

    // 2. Spawn real MCP server process in direct (no daemon) mode
    child = spawn(process.execPath, [BIN, 'serve', '--mcp', '--path', tempDir], {
      cwd: tempDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        AFYX_GRAPH_NO_DAEMON: '1',
      },
    }) as ChildProcessWithoutNullStreams;

    const client = new McpClientHelper(child);

    // 3. MCP Handshake: initialize
    const initResponse = await client.sendRequest('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'odoo-mcp-test-runner', version: '1.0.0' },
      rootUri: `file://${tempDir.replace(/\\/g, '/')}`,
    });

    expect(initResponse.error).toBeUndefined();
    expect(initResponse.result).toBeDefined();
    expect(initResponse.result.serverInfo.name).toBe('afyx_graph');

    // Send initialized notification
    client.sendNotification('notifications/initialized', {});

    // Allow background initialization to index synthetic fixture
    await new Promise((r) => setTimeout(r, 1200));

    // 4. tools/list: Verify default tool exposure
    // Default exposure must be exactly afyx_graph_explore and afyx_graph_inventory
    const listResponse = await client.sendRequest('tools/list', {});
    expect(listResponse.error).toBeUndefined();
    const toolNames = listResponse.result.tools.map((t: any) => t.name).sort();
    expect(toolNames).toEqual(['afyx_graph_explore', 'afyx_graph_inventory']);

    // 5. tools/call: afyx_graph_explore for Odoo record rule
    const exploreRuleRes = await client.sendRequest('tools/call', {
      name: 'afyx_graph_explore',
      arguments: {
        query: 'purchase_request_company_rule',
      },
    });

    expect(exploreRuleRes.error).toBeUndefined();
    expect(exploreRuleRes.result).toBeDefined();
    const exploreRuleText = exploreRuleRes.result.content?.[0]?.text || '';
    expect(exploreRuleText).toContain('purchase_request_company_rule');
    expect(exploreRuleText).toContain('company_ids');

    // 6. tools/call: afyx_graph_explore for Odoo ACL rule
    const exploreAclRes = await client.sendRequest('tools/call', {
      name: 'afyx_graph_explore',
      arguments: {
        query: 'access_purchase_request_user',
      },
    });

    expect(exploreAclRes.error).toBeUndefined();
    expect(exploreAclRes.result).toBeDefined();
    const exploreAclText = exploreAclRes.result.content?.[0]?.text || '';
    expect(exploreAclText).toContain('access_purchase_request_user');
    expect(exploreAclText).toContain('model_purchase_request');

    // 7. tools/call: afyx_graph_inventory for Python class declarations (_name = 'purchase.request')
    const inventoryResponse = await client.sendRequest('tools/call', {
      name: 'afyx_graph_inventory',
      arguments: {
        declaration: '_name',
        value: 'purchase.request',
      },
    });

    expect(inventoryResponse.error).toBeUndefined();
    expect(inventoryResponse.result).toBeDefined();
    const invContentText = inventoryResponse.result.content?.[0]?.text || '';
    expect(invContentText).toContain('purchase.request');
    expect(invContentText).toContain('PurchaseRequest');
  }, 30000);
});
