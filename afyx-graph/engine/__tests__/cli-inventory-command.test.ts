import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import AfyxGraph from '../src/index';

const BIN = path.resolve(__dirname, '../dist/bin/afyx-graph.js');

describe('afyx-graph inventory command', () => {
  let root = '';

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-inventory-cli-'));
    const target = path.join(root, 'addons', 'demo', 'models');
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'sale.py'), [
      'from odoo import models',
      'class One(models.Model):',
      "    _inherit = 'sale.order'",
      'class Two(models.Model):',
      "    _inherit = ['sale.order', 'pos.load.mixin']",
    ].join('\n'));
    const graph = AfyxGraph.initSync(root, { config: { include: ['**/*.py'], exclude: [] } });
    await graph.indexAll();
    graph.destroy();
  });

  afterEach(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it('exposes the exact bounded inventory through the shipped CLI', () => {
    const output = execFileSync(process.execPath, [
      BIN, 'inventory', '_inherit', 'sale.order', '--scope', 'addons', '--path', root,
    ], {
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, AFYX_GRAPH_NO_DAEMON: '1', NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(output).toMatch(/Matches:\*\* 2 declarations; 1 files; 1 modules/);
    expect(output).toMatch(/COMPLETE FOR SUPPORTED LITERAL DECLARATIONS/);
  });
});
