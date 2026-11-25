import { EXTRACTION_VERSION } from '../src/extraction/extraction-version';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import AfyxGraph from '../src/index';
import { extractNativeFacts } from '../src/extraction/native/fact-extractor';

const wizard = [
  'from odoo import _, models',
  'class Wizard(models.Model):',
  '    def notify(self, shortage):',
  '        return {',
  '            "title": _("Incomplete") if shortage else _("Complete"),',
  '            "next": {"type": "close"},',
  '        }',
].join('\n');

describe('Python imported translation function and class declarations', () => {
  it('does not extract a conditional translation call followed by a dict as a method', () => {
    const result = extractNativeFacts('wizard.py', wizard, 'python');
    expect(result.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'class', name: 'Wizard', startLine: 2 }),
      expect.objectContaining({ kind: 'method', name: 'notify', startLine: 3 }),
    ]));
    expect(result.nodes.filter(node => node.kind === 'method' && node.name === '_')).toEqual([]);
  });

  it('keeps real decorated, async, nested, and underscore-named definitions', () => {
    const source = [
      'class Outer:',
      '    @decorator',
      '    def normal(self):',
      '        return {"message": _("x"), "next": {"type": "close"}}',
      '    async def async_method(self):',
      '        return await fetch()',
      '    def _(self):',
      '        return 1',
      '    class Inner:',
      '        def nested(self):',
      '            return 2',
    ].join('\n');
    const result = extractNativeFacts('positive.py', source, 'python');
    for (const [name, line] of [['normal', 3], ['async_method', 5], ['_', 7], ['nested', 10]] as const) {
      expect(result.nodes).toContainEqual(expect.objectContaining({ kind: 'method', name, startLine: line }));
    }
    expect(result.nodes.filter(node => node.kind === 'method' && node.name === '_')).toHaveLength(1);
  });
});

describe('Graph resolution for imported external translation', () => {
  let temp: string;
  let graph: AfyxGraph | undefined;
  beforeEach(() => { temp = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-python-translation-')); });
  afterEach(() => { graph?.close(); fs.rmSync(temp, { recursive: true, force: true }); });

  it('does not link imported Odoo translation to a synthetic declaration in another file', async () => {
    fs.writeFileSync(path.join(temp, 'wizard.py'), wizard);
    fs.writeFileSync(path.join(temp, 'partner.py'), [
      'from odoo import _, models',
      'class Partner(models.Model):',
      '    def helper(self):',
      '        return True',
      '    def create(self):',
      '        if self.helper():',
      '            return _("forbidden")',
    ].join('\n'));
    graph = AfyxGraph.initSync(temp);
    await graph.indexAll();
    const target = graph.searchNodes('create').map(result => result.node).find(node => node.name === 'create' && node.filePath === 'partner.py');
    expect(target).toBeDefined();
    const callees = graph.getCallees(target!.id).map(item => item.node.name);
    expect(callees).toContain('helper');
    expect(callees).not.toContain('_');
  });

  it('does not link imported Odoo translation to a genuine unrelated class method', async () => {
    fs.writeFileSync(path.join(temp, 'unrelated.py'), [
      'class Unrelated:',
      '    def _(self, value):',
      '        return value',
    ].join('\n'));
    fs.writeFileSync(path.join(temp, 'partner.py'), [
      'from odoo import _, models',
      'class Partner(models.Model):',
      '    def create(self):',
      '        return _("forbidden")',
    ].join('\n'));
    graph = AfyxGraph.initSync(temp);
    await graph.indexAll();
    const target = graph.searchNodes('create').map(result => result.node).find(node => node.name === 'create' && node.filePath === 'partner.py');
    expect(target).toBeDefined();
    const callees = graph.getCallees(target!.id).map(item => item.node.name);
    expect(callees).not.toContain('_');
  });

  it('does not link imported Odoo translation to a genuine unrelated module function', async () => {
    fs.writeFileSync(path.join(temp, 'unrelated.py'), 'def _(value):\n    return value\n');
    fs.writeFileSync(path.join(temp, 'partner.py'), [
      'from odoo import _',
      'class Partner:',
      '    def create(self):',
      '        return _("forbidden")',
    ].join('\n'));
    graph = AfyxGraph.initSync(temp);
    await graph.indexAll();
    const target = graph.searchNodes('create').map(result => result.node).find(node => node.name === 'create' && node.filePath === 'partner.py');
    expect(target).toBeDefined();
    expect(graph.getCallees(target!.id).map(item => item.node.name)).not.toContain('_');
  });

  it('does not link an aliased external import to an unrelated same-name function', async () => {
    fs.writeFileSync(path.join(temp, 'unrelated.py'), 'def translate(value):\n    return value\n');
    fs.writeFileSync(path.join(temp, 'partner.py'), [
      'from odoo import _ as translate',
      'class Partner:',
      '    def create(self):',
      '        return translate("forbidden")',
    ].join('\n'));
    graph = AfyxGraph.initSync(temp);
    await graph.indexAll();
    const target = graph.searchNodes('create').map(result => result.node).find(node => node.name === 'create' && node.filePath === 'partner.py');
    expect(target).toBeDefined();
    expect(graph.getCallees(target!.id).map(item => item.node.name)).not.toContain('translate');
  });

  it('keeps a resolvable in-repository Python import', async () => {
    fs.writeFileSync(path.join(temp, 'helpers.py'), 'def translate(value):\n    return value\n');
    fs.writeFileSync(path.join(temp, 'partner.py'), [
      'from helpers import translate',
      'class Partner:',
      '    def create(self):',
      '        return translate("value")',
    ].join('\n'));
    graph = AfyxGraph.initSync(temp);
    await graph.indexAll();
    const target = graph.searchNodes('create').map(result => result.node).find(node => node.name === 'create' && node.filePath === 'partner.py');
    expect(target).toBeDefined();
    expect(graph.getCallees(target!.id).map(item => [item.node.name, item.node.filePath])).toContainEqual(['translate', 'helpers.py']);
  });

  it('keeps a same-file definition that shadows an earlier external import', async () => {
    fs.writeFileSync(path.join(temp, 'partner.py'), [
      'from odoo import _',
      'def _(value):',
      '    return value',
      'class Partner:',
      '    def create(self):',
      '        return _("value")',
    ].join('\n'));
    graph = AfyxGraph.initSync(temp);
    await graph.indexAll();
    const target = graph.searchNodes('create').map(result => result.node).find(node => node.name === 'create' && node.filePath === 'partner.py');
    expect(target).toBeDefined();
    expect(graph.getCallees(target!.id).map(item => [item.node.name, item.node.filePath])).toContainEqual(['_', 'partner.py']);
  });

  it('keeps an in-repository import re-exported by a Python package', async () => {
    fs.mkdirSync(path.join(temp, 'helpers'));
    fs.writeFileSync(path.join(temp, 'helpers', '__init__.py'), 'from .core import translate\n');
    fs.writeFileSync(path.join(temp, 'helpers', 'core.py'), 'def translate(value):\n    return value\n');
    fs.writeFileSync(path.join(temp, 'partner.py'), [
      'from helpers import translate',
      'class Partner:',
      '    def create(self):',
      '        return translate("value")',
    ].join('\n'));
    graph = AfyxGraph.initSync(temp);
    await graph.indexAll();
    const target = graph.searchNodes('create').map(result => result.node).find(node => node.name === 'create' && node.filePath === 'partner.py');
    expect(target).toBeDefined();
    expect(graph.getCallees(target!.id).map(item => [item.node.name, item.node.filePath])).toContainEqual(['translate', 'helpers/core.py']);
  });

  it('keeps a local Odoo add-on imported through the odoo.addons namespace', async () => {
    fs.mkdirSync(path.join(temp, 'ijp_helpers'));
    fs.writeFileSync(path.join(temp, 'ijp_helpers', 'models.py'), 'def translate(value):\n    return value\n');
    fs.writeFileSync(path.join(temp, 'partner.py'), [
      'from odoo.addons.ijp_helpers.models import translate',
      'class Partner:',
      '    def create(self):',
      '        return translate("value")',
    ].join('\n'));
    graph = AfyxGraph.initSync(temp);
    await graph.indexAll();
    const target = graph.searchNodes('create').map(result => result.node).find(node => node.name === 'create' && node.filePath === 'partner.py');
    expect(target).toBeDefined();
    expect(graph.getCallees(target!.id).map(item => [item.node.name, item.node.filePath])).toContainEqual(['translate', 'ijp_helpers/models.py']);
  });

  it('marks an Alpha.8 extraction-v29 index stale until it is rebuilt', async () => {
    fs.writeFileSync(path.join(temp, 'wizard.py'), wizard);
    graph = AfyxGraph.initSync(temp);
    await graph.indexAll();
    (graph as any).queries.setMetadata('indexed_with_extraction_version', '29');
    await graph.close();
    graph = await AfyxGraph.open(temp);
    expect(graph.getIndexBuildInfo().extractionVersion).toBe(29);
    expect(graph.isIndexStale()).toBe(true);
    await graph.indexAll();
    expect(graph.getIndexBuildInfo().extractionVersion).toBe(EXTRACTION_VERSION);
    expect(graph.isIndexStale()).toBe(false);
  });
});
