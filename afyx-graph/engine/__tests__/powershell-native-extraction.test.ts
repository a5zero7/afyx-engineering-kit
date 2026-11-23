import { describe, expect, it } from 'vitest';
import { extractFromSource } from '../src/extraction/extract';
import { detectLanguage, isSourceFile } from '../src/extraction/grammars';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import AfyxGraph from '../src/index';

describe('native PowerShell extraction', () => {
  it('registers scripts, modules, and data files', () => {
    for (const extension of ['ps1', 'psm1', 'psd1']) {
      expect(detectLanguage(`Module.${extension}`)).toBe('powershell');
      expect(isSourceFile(`Module.${extension}`)).toBe(true);
    }
  });

  it('grounds case-insensitive functions, parameters, calls, and exports', () => {
    const source = [
      'function Get-Value {', '  param([string]$Name)', '  Get-Item $Name', '}',
      'get-value -Name a', 'Export-ModuleMember -Function Get-Value',
    ].join('\n');
    const result = extractFromSource('Module.psm1', source);
    const functionNode = result.nodes.find((node) => node.kind === 'function' && node.name === 'Get-Value');
    expect(functionNode).toMatchObject({ startLine: 1, endLine: 4, language: 'powershell', isExported: true });
    expect(result.nodes).toContainEqual(expect.objectContaining({ kind: 'parameter', name: 'Name' }));
    expect(result.edges).toContainEqual(expect.objectContaining({
      source: 'file:Module.psm1', target: functionNode?.id, kind: 'calls',
    }));
    expect(result.unresolvedReferences).toContainEqual(expect.objectContaining({
      referenceKind: 'calls', referenceName: 'Get-Item', line: 3,
    }));
    expect(result.edges).toContainEqual(expect.objectContaining({ kind: 'exports', target: functionNode?.id }));
  });

  it('records relative imports and dot-sourcing with spaces', () => {
    const source = "Import-Module './Modules/My Module.psm1'\n. './helper file.ps1'\n& './run.ps1'\n";
    const result = extractFromSource('scripts/main.ps1', source);
    expect(result.unresolvedReferences.filter((ref) => ref.referenceKind === 'imports')
      .map((ref) => ref.referenceName)).toEqual([
      './Modules/My Module.psm1', './helper file.ps1', './run.ps1',
    ]);
  });

  it('extracts static data-file declarations and relative root module', () => {
    const result = extractFromSource('Modules/Kit.psd1', "@{\nRootModule = './Kit.psm1'\nFunctionsToExport = @('Get-Value')\n}\n");
    expect(result.nodes.filter((node) => node.kind === 'constant').map((node) => node.name))
      .toEqual(['RootModule', 'FunctionsToExport']);
    expect(result.unresolvedReferences).toContainEqual(expect.objectContaining({
      referenceKind: 'imports', referenceName: './Kit.psm1',
    }));
  });

  it('ignores comments, here-strings, and dynamic invocation', () => {
    const source = [
      'function Invoke-Real { }', '# Invoke-Real',
      "@'", 'function Invoke-Fake { }', 'Invoke-Real', "'@",
      '<# Invoke-Real #>', '& $Dynamic', 'Invoke-Real',
    ].join('\n');
    const result = extractFromSource('main.ps1', source);
    expect(result.nodes.filter((node) => node.kind === 'function').map((node) => node.name)).toEqual(['Invoke-Real']);
    expect(result.edges.filter((edge) => edge.kind === 'calls')).toHaveLength(1);
  });

  it('does not bind ambiguous case-insensitive declarations', () => {
    const result = extractFromSource('main.ps1', 'function Get-X {}\nfunction get-x {}\nGET-X\n');
    expect(result.edges.filter((edge) => edge.kind === 'calls')).toHaveLength(0);
  });

  it('handles Unicode names and paths with pipeline and line continuation', () => {
    const source = [
      'function Get-Ångström { param($Nämé) }',
      "Import-Module './Módulo/工具.psm1'",
      'Get-Item . | get-ångström `',
      '  -Nämé ok',
    ].join('\n');
    const result = extractFromSource('main.ps1', source);
    expect(result.nodes).toContainEqual(expect.objectContaining({ kind: 'function', name: 'Get-Ångström' }));
    expect(result.nodes).toContainEqual(expect.objectContaining({ kind: 'parameter', name: 'Nämé' }));
    expect(result.unresolvedReferences).toContainEqual(expect.objectContaining({
      referenceKind: 'imports', referenceName: './Módulo/工具.psm1',
    }));
    expect(result.edges.filter((edge) => edge.kind === 'calls')).toHaveLength(1);
  });

  it('does not invent a function or call from incomplete source', () => {
    const result = extractFromSource('broken.ps1', 'function Missing {\n  Get-Item .\n');
    expect(result.nodes.filter((node) => node.kind === 'function')).toEqual([]);
    expect(result.edges.filter((edge) => edge.kind === 'calls')).toEqual([]);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('does not treat comment and here-string markers inside quotes as syntax', () => {
    const source = "Write-Output '<# literal'\nWrite-Output '@\"'\nfunction Get-Real { }\nGet-Real\n";
    const result = extractFromSource('main.ps1', source);
    expect(result.nodes).toContainEqual(expect.objectContaining({ kind: 'function', name: 'Get-Real' }));
    expect(result.edges.filter((edge) => edge.kind === 'calls')).toHaveLength(1);
  });

  it('repeats stable symbol and relationship identities', () => {
    const source = 'function Get-Stable { }\nGet-Stable\n';
    const shape = () => {
      const result = extractFromSource('stable.ps1', source);
      return {
        nodes: result.nodes.map(({ id, kind, startLine, endLine }) => ({ id, kind, startLine, endLine })),
        edges: result.edges,
      };
    };
    expect(shape()).toEqual(shape());
  });

  it('indexes a dot-sourced script as an actual Graph import edge', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'afyx-ps-graph-'));
    let graph: AfyxGraph | undefined;
    try {
      fs.writeFileSync(path.join(root, 'helper.ps1'), 'function Get-Thing { }\n');
      fs.writeFileSync(path.join(root, 'main.ps1'), ". './helper.ps1'\nGet-Thing\n");
      graph = await AfyxGraph.init(root);
      await graph.indexAll();
      await graph.resolveReferences();
      expect(graph.searchNodes('Get-Thing').some(({ node }) => node.kind === 'function')).toBe(true);
      expect(graph.getOutgoingEdgesFrom(['file:main.ps1'], ['imports']))
        .toContainEqual(expect.objectContaining({ target: 'file:helper.ps1' }));
      fs.writeFileSync(path.join(root, 'main.ps1'), ". './helper.ps1'\nfunction Get-Updated { }\n");
      const incremental = await graph.indexFiles(['main.ps1']);
      expect(incremental.filesIndexed).toBe(1);
      expect(graph.searchNodes('Get-Updated').some(({ node }) => node.kind === 'function')).toBe(true);
    } finally {
      await graph?.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
