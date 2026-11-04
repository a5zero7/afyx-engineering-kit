# Focused Clean-Windows Installation Smoke Test for TASK U-A03
# Tests discovery, 7-component installation, verification, idempotence, safe uninstall, and foreign config preservation via AfyxSetup.exe

[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptRoot = $PSScriptRoot
$repoRoot = (Resolve-Path (Join-Path $scriptRoot '..\..')).Path
$exePath = Join-Path $repoRoot 'dist\AfyxSetup.exe'

Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host " TASK U-A03: Clean-Windows Smoke Test via Final AfyxSetup.exe" -ForegroundColor Cyan
Write-Host " Executable: $exePath" -ForegroundColor Cyan
Write-Host " Size: $((Get-Item -LiteralPath $exePath).Length) bytes" -ForegroundColor Cyan
Write-Host " SHA-256: $((Get-FileHash -LiteralPath $exePath -Algorithm SHA256).Hash)" -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Cyan

$tempRoot = [System.IO.Path]::GetTempPath()
$disposable = Join-Path $tempRoot ("test-smoke-u03-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$skills = Join-Path $disposable 'skills'
$context = Join-Path $disposable 'context'
$forge = Join-Path $disposable 'forge'
$codex = Join-Path $disposable 'codex'
$graph = Join-Path $disposable 'graph'
$gemini = Join-Path $disposable 'gemini'
$claude = Join-Path $disposable 'claude'
$fakeBin = Join-Path $disposable 'fake-bin'
$backupRoot = Join-Path $disposable '.afyx\backups'

$originalPath = $env:PATH
$originalBackupRoot = $env:AFYX_BACKUP_ROOT
$hadBackupRoot = Test-Path Env:AFYX_BACKUP_ROOT
$env:AFYX_BACKUP_ROOT = $backupRoot
try {
    # 0. Setup disposable test root & foreign config
    New-Item -ItemType Directory -Path $codex -Force | Out-Null
    New-Item -ItemType Directory -Path $gemini -Force | Out-Null
    New-Item -ItemType Directory -Path $claude -Force | Out-Null
    New-Item -ItemType Directory -Path $fakeBin -Force | Out-Null

    # Provide hermetic Codex CLI mock for isolated test runs
    $fakeCodexJs = Join-Path $fakeBin 'fake-codex.js'
    $fakeCodexJsContent = @'
const fs = require('fs');
const path = require('path');
const home = process.env.CODEX_HOME || process.cwd();
const state = path.join(home, 'fixture-state.json');
const args = process.argv.slice(2);
if (args.length === 0 || args[0] === '--version') {
  console.log('codex-cli 0.1.0-mock');
  process.exit(0);
}
const scope = args[0];
const action = args[1];
const name = args[2];
if (scope === 'mcp') {
  if (action === 'get') {
    if (!fs.existsSync(state)) {
      console.error('MCP server afyx_graph not found');
      process.exit(1);
    }
    const content = fs.readFileSync(state, 'utf8');
    if (!content || !content.trim()) {
      console.error('MCP server afyx_graph not found');
      process.exit(1);
    }
    console.log(content);
    process.exit(0);
  } else if (action === 'add') {
    const sep = args.indexOf('--');
    const cmd = args.slice(sep + 1);
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(state, JSON.stringify({ transport: { type: 'stdio', command: cmd[0], args: cmd.slice(1) } }));
    process.exit(0);
  } else if (action === 'remove') {
    if (fs.existsSync(state)) {
      fs.rmSync(state, { force: true });
    }
    process.exit(0);
  }
}
process.exit(0);
'@
    Set-Content -LiteralPath $fakeCodexJs -Value $fakeCodexJsContent -Encoding utf8
    $fakeCodexCmdContent = "@echo off`r`nnode `"%~dp0fake-codex.js`" %*`r`n"
    Set-Content -LiteralPath (Join-Path $fakeBin 'codex.cmd') -Value $fakeCodexCmdContent -Encoding utf8
    $env:PATH = "$fakeBin;$env:PATH"

    $tomlContent = @"
model = "gpt-5-preview"

[user_custom]
keep_this_setting = true
my_custom_env = "production"
"@
    Set-Content -LiteralPath (Join-Path $codex 'config.toml') -Value $tomlContent -Encoding utf8

    $env:AFYX_GRAPH_RUNTIME_ROOT = $graph
    $env:CODEX_HOME = $codex

    # Packaging regression: all present, supported provider companions must
    # survive the EXE's embedded-archive staging. This check automatically
    # begins covering Afyx Context when PR #139 source is integrated, without
    # assuming a companion was already shipped on the older dev baseline.
    $extractedPayload = Join-Path $disposable 'embedded-payload-check'
    & $exePath --extract $extractedPayload
    if ($LASTEXITCODE -ne 0) { throw "Embedded payload extraction failed with exit code $LASTEXITCODE" }
    foreach ($skill in @('efficient-coding', 'odoo-engineering', 'afyx-engineering-expert', 'afyx-forge', 'afyx-context')) {
        $sourceSkill = Join-Path $repoRoot "skills\\$skill\\SKILL.md"
        if (-not (Test-Path -LiteralPath $sourceSkill -PathType Leaf)) { continue }
        $shippedSkill = Join-Path $extractedPayload "skills\\$skill\\SKILL.md"
        if (-not (Test-Path -LiteralPath $shippedSkill -PathType Leaf)) {
            throw "Installer payload omitted the available provider skill: $skill"
        }
        $sourceDigest = (Get-FileHash -LiteralPath $sourceSkill -Algorithm SHA256).Hash
        $shippedDigest = (Get-FileHash -LiteralPath $shippedSkill -Algorithm SHA256).Hash
        if ($sourceDigest -ne $shippedDigest) {
            throw "Installer payload skill differs from the candidate source: $skill"
        }
    }
    $sourceBridge = Join-Path $repoRoot 'afyx-context\\src\\graph-mcp-bridge.js'
    if (Test-Path -LiteralPath $sourceBridge -PathType Leaf) {
        $shippedBridge = Join-Path $extractedPayload 'afyx-context\\src\\graph-mcp-bridge.js'
        if (-not (Test-Path -LiteralPath $shippedBridge -PathType Leaf)) {
            throw 'Installer payload omitted the available native Graph-ACE MCP worker.'
        }
        if ((Get-FileHash -LiteralPath $sourceBridge -Algorithm SHA256).Hash -ne
            (Get-FileHash -LiteralPath $shippedBridge -Algorithm SHA256).Hash) {
            throw 'Installer payload Graph-ACE MCP worker hash differs from candidate source.'
        }
    }

    # Phase 1: Component Discovery / Pre-flight
    Write-Host "`n[1/5] Testing Component Discovery via AfyxSetup.exe -ValidateOnly..." -ForegroundColor Yellow
    & $exePath -ValidateOnly -SkillsRoot $skills -ContextRuntimeRoot $context -ForgeRuntimeRoot $forge -GeminiHome $gemini -ClaudeHome $claude -Provider codex
    if ($LASTEXITCODE -ne 0) { throw "Discovery failed with exit code $LASTEXITCODE" }
    Write-Host "-> Component discovery PASSED." -ForegroundColor Green

    # Phase 2: Complete Seven-Component Installation
    Write-Host "`n[2/5] Testing 7-Component Clean Installation..." -ForegroundColor Yellow
    $allSeven = "efficient-coding,odoo-engineering,afyx-engineering-expert,afyx-graph,afyx-context,afyx-forge,codex-usage-tracking"
    & $exePath -Preset custom -CustomComponent $allSeven -SkillsRoot $skills -ContextRuntimeRoot $context -ForgeRuntimeRoot $forge -GeminiHome $gemini -ClaudeHome $claude -Offline -Provider codex -SkipGraphPathUpdate
    if ($LASTEXITCODE -ne 0) { throw "Installation failed with exit code $LASTEXITCODE" }

    # Verify physical file existence
    $forgeCmd = Join-Path $forge 'bin\afyx-forge.cmd'
    $contextCmd = Join-Path $context 'current\bin\afyx-context.cmd'
    $graphCmd = Join-Path $graph 'bin\afyx-graph.cmd'
    $usageMod = Join-Path $codex 'tools\CodexUsage.psm1'
    $skill1 = Join-Path $skills 'efficient-coding\SKILL.md'
    $skill2 = Join-Path $skills 'odoo-engineering\SKILL.md'
    $skill3 = Join-Path $skills 'afyx-engineering-expert\SKILL.md'

    foreach ($f in @($forgeCmd, $contextCmd, $graphCmd, $usageMod, $skill1, $skill2, $skill3)) {
        if (-not (Test-Path -LiteralPath $f)) { throw "Expected installed artifact missing: $f" }
    }
    Write-Host "-> All 7 components verified physically present on disk." -ForegroundColor Green

    # Verify standalone CLI behaviors & boundaries
    $forgeVer = (& $forgeCmd --version 2>&1) -join ' '
    $forgeDoc = (& $forgeCmd doctor 2>&1) -join ' '
    if ($forgeDoc -notmatch 'EVALUATION_GATED') { throw "A8 gate violated in doctor: $forgeDoc" }
    $contextVer = (& $contextCmd --version 2>&1) -join ' '
    $graphVer = (& $graphCmd --version 2>&1) -join ' '
    Write-Host "-> CLIs verified: Forge ($forgeVer), Context ($contextVer), Graph ($graphVer)." -ForegroundColor Green

    # Phase 3: Post-Installation Verification
    Write-Host "`n[3/5] Testing Verification via AfyxSetup.exe --verify..." -ForegroundColor Yellow
    & $exePath --verify -SkillsRoot $skills -ContextRuntimeRoot $context -ForgeRuntimeRoot $forge -GeminiHome $gemini -ClaudeHome $claude -Provider codex
    if ($LASTEXITCODE -ne 0) { throw "Verification failed with exit code $LASTEXITCODE" }
    Write-Host "-> Verification PASSED: Core readiness ready." -ForegroundColor Green

    # Phase 4: Idempotence Re-run
    Write-Host "`n[4/5] Testing Idempotence Re-run..." -ForegroundColor Yellow
    & $exePath -Preset custom -CustomComponent $allSeven -SkillsRoot $skills -ContextRuntimeRoot $context -ForgeRuntimeRoot $forge -GeminiHome $gemini -ClaudeHome $claude -Offline -Provider codex -SkipGraphPathUpdate
    if ($LASTEXITCODE -ne 0) { throw "Idempotence re-run failed with exit code $LASTEXITCODE" }
    Write-Host "-> Idempotence PASSED: Healthy components preserved." -ForegroundColor Green

    # Phase 5: Safe Uninstallation & Foreign Config Preservation
    Write-Host "`n[5/5] Testing Safe Uninstall & Foreign Configuration Preservation..." -ForegroundColor Yellow
    & $exePath --uninstall -SkillsRoot $skills -ContextRuntimeRoot $context -ForgeRuntimeRoot $forge -GeminiHome $gemini -ClaudeHome $claude -Provider codex -RemoveAfyxGraph -RemoveAfyxContext -RemoveAfyxForge -RemoveUsageTracker -RemoveProviderConfiguration
    if ($LASTEXITCODE -ne 0) { throw "Uninstall failed with exit code $LASTEXITCODE" }

    # Confirm uninstalled
    if (Test-Path -LiteralPath $forgeCmd) { throw "Forge was not uninstalled!" }
    if (Test-Path -LiteralPath $contextCmd) { throw "Context was not uninstalled!" }
    if (Test-Path -LiteralPath $graphCmd) { throw "Graph was not uninstalled!" }
    if (Test-Path -LiteralPath $usageMod) { throw "Usage tracker was not uninstalled!" }

    # Confirm foreign configuration intact
    $codexConfig = Get-Content -Raw -LiteralPath (Join-Path $codex 'config.toml')
    if ($codexConfig -notmatch 'keep_this_setting = true') {
        throw "Foreign configuration was overwritten or removed!"
    }
    Write-Host "-> Safe uninstall PASSED: Runtimes cleanly removed, foreign config preserved." -ForegroundColor Green

    Write-Host "`n==================================================================" -ForegroundColor Green
    Write-Host " ALL 5 SMOKE TEST PHASES PASSED VIA AfyxSetup.exe!" -ForegroundColor Green
    Write-Host "==================================================================" -ForegroundColor Green
    return $true
}
finally {
    if ($originalPath) {
        $env:PATH = $originalPath
    }
    if (Test-Path -LiteralPath $disposable) {
        Remove-Item -LiteralPath $disposable -Recurse -Force -ErrorAction SilentlyContinue
    }
    Remove-Item Env:AFYX_GRAPH_RUNTIME_ROOT -ErrorAction SilentlyContinue
    Remove-Item Env:CODEX_HOME -ErrorAction SilentlyContinue
    if ($hadBackupRoot) { $env:AFYX_BACKUP_ROOT = $originalBackupRoot }
    else { Remove-Item Env:AFYX_BACKUP_ROOT -ErrorAction SilentlyContinue }
}
