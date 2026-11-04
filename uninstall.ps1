[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$SkillsRoot = (Join-Path $env:USERPROFILE '.agents\skills'),
    [Alias('Component')][string[]]$SelectedComponent = @(),
    [switch]$RemovePromptMaster,
    [switch]$RemoveUsageTracker,
    [switch]$RemoveAfyxGraph,
    [switch]$RemoveAfyxContext,
    [switch]$RemoveAfyxForge,
    [switch]$RemoveProviderConfiguration,
    [string[]]$Provider = @('codex'),
    [ValidateSet('global', 'workspace')][string]$ProviderScope = 'global',
    [string]$WorkspaceRoot = (Get-Location).Path,
    [string]$GeminiHome = $(if ($env:AFYX_GEMINI_HOME) { $env:AFYX_GEMINI_HOME } else { Join-Path $env:USERPROFILE '.gemini' }),
    [string]$ClaudeHome = $(if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $env:USERPROFILE '.claude' }),
    [string]$ClaudeConfigDir = $(if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { '' }),
    [string]$ContextRuntimeRoot = $(if ($env:AFYX_CONTEXT_RUNTIME_ROOT) { $env:AFYX_CONTEXT_RUNTIME_ROOT } else { Join-Path $env:USERPROFILE '.afyx\context' }),
    [string]$ForgeRuntimeRoot = $(if ($env:AFYX_FORGE_RUNTIME_ROOT) { $env:AFYX_FORGE_RUNTIME_ROOT } else { Join-Path $env:USERPROFILE '.afyx\forge' })
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Write-Host 'Afyx Codex Engineering Kit — Windows uninstaller (PowerShell)'
$providerSkillRoots = @()
if ('codex' -in $Provider) {
    $providerSkillRoots += $(if ($PSBoundParameters.ContainsKey('SkillsRoot')) { $SkillsRoot } else { Join-Path $env:USERPROFILE '.agents\skills' })
}
if ('antigravity' -in $Provider) {
    if ($ProviderScope -eq 'workspace') { $providerSkillRoots += (Join-Path $WorkspaceRoot '.agents\skills') }
    else { $providerSkillRoots += @((Join-Path $GeminiHome 'config\skills'), (Join-Path $GeminiHome 'antigravity-cli\skills')) }
}
if ('claude' -in $Provider) {
    $providerSkillRoots += $(if ($ProviderScope -eq 'workspace') { Join-Path $WorkspaceRoot '.claude\skills' } else { Join-Path $ClaudeHome 'skills' })
}
if (-not $PSBoundParameters.ContainsKey('SkillsRoot') -and $providerSkillRoots.Count) { $SkillsRoot = $providerSkillRoots[0] }
$primarySkillsPath = [System.IO.Path]::GetFullPath($SkillsRoot)
$additionalSkillRoots = @($providerSkillRoots |
    Where-Object { [System.IO.Path]::GetFullPath($_) -ne $primarySkillsPath } |
    Select-Object -Unique)

# One component truth: scripts/components.json. Only Afyx-owned skills are removable.
Import-Module (Join-Path $PSScriptRoot 'scripts\lib\AfyxComponents.psm1') -Force
Import-Module (Join-Path $PSScriptRoot 'scripts\lib\AfyxSkillLifecycle.psm1') -Force
$providerIds = @(Get-AfyxProviderRegistry | ForEach-Object { [string]$_.provider })
$unknownProviders = @($Provider | Where-Object { $_ -notin $providerIds })
if ($unknownProviders.Count) { throw "Unknown provider(s): $($unknownProviders -join ', ')" }
$componentContext = New-AfyxComponentContext -SkillsRoot $SkillsRoot -ContextRoot $ContextRuntimeRoot -ForgeRoot $ForgeRuntimeRoot
$contract = @(Get-AfyxComponentContract)
if ($RemovePromptMaster) {
    throw "Component 'prompt-master' is retired from Afyx Kit and remains externally/user managed; no changes were made."
}
foreach ($id in $SelectedComponent) {
    if ($id -in @('prompt-master', 'headroom')) {
        throw "Component '$id' is retired from Afyx Kit and remains externally/user managed; no changes were made."
    }
    $selected = @($contract | Where-Object { $_.id -eq $id -and $_.type -eq 'skill' -and $_.ownership -eq 'afyx' })
    if ($selected.Count -ne 1) { throw "Unknown or non-removable Afyx skill component: $id" }
}
$targets = @()
foreach ($component in $contract) {
    if ($component.type -ne 'skill') { continue }
    $selectedAfyx = $component.ownership -eq 'afyx' -and ($SelectedComponent.Count -eq 0 -or [string]$component.id -in $SelectedComponent)
    if ($selectedAfyx) {
        $targets += [pscustomobject]@{
            Component = [string]$component.id
            Owner = [string]$component.ownership
            Target = Get-AfyxComponentRoot -Component $component -Context $componentContext
        }
    }
}

foreach ($entry in $targets) {
    Remove-AfyxSkillSafely -SkillsRoot $SkillsRoot -Component $entry.Component -Target $entry.Target -ExpectedOwner $entry.Owner -Confirm:$false -WhatIf:$WhatIfPreference
}
foreach ($additionalRoot in $additionalSkillRoots) {
    foreach ($component in $contract | Where-Object { $_.type -eq 'skill' -and $_.ownership -eq 'afyx' }) {
        if ($SelectedComponent.Count -and [string]$component.id -notin $SelectedComponent) { continue }
        $target = Join-Path $additionalRoot ([string]$component.install_path)
        Remove-AfyxSkillSafely -SkillsRoot $additionalRoot -Component ([string]$component.id) -Target $target -ExpectedOwner ([string]$component.ownership) -Confirm:$false -WhatIf:$WhatIfPreference
    }
}

if ($RemoveUsageTracker) {
    $trackerInstaller = Join-Path $PSScriptRoot 'scripts\install-codex-usage-tracker.ps1'
    & $trackerInstaller -Uninstall -Confirm:$false -WhatIf:$WhatIfPreference
    if (-not $?) { throw 'Codex Usage Tracking removal failed.' }
}

$graphRoot = $componentContext.GraphRoot
if ($RemoveProviderConfiguration) {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    $codexHost = Get-AfyxCodexHost
    $codexCommand = if ($codexHost.State -eq 'CLI_READY') { [pscustomobject]@{ Source = $codexHost.Path } } else { $null }
    $claudeCommand = Get-Command claude -ErrorAction SilentlyContinue
    $installedEntry = Join-Path $graphRoot 'current\lib\dist\bin\afyx-graph.js'
    if (-not $nodeCommand) { throw 'Node.js is required to remove owned provider entries.' }
    if ('codex' -in $Provider -and -not $codexCommand) { throw "Codex MCP removal requires a native Codex CLI. $($codexHost.Detail)" }
    $codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }
    $arguments = @((Join-Path $PSScriptRoot 'scripts\afyx-provider-integration.mjs'), '--providers', ($Provider -join ','), '--scope', $ProviderScope,
        '--workspace-root', $WorkspaceRoot, '--gemini-home', $GeminiHome, '--codex-home', $codexHome, '--node', $nodeCommand.Source, '--entry', $installedEntry, '--uninstall')
    if ($codexCommand) { $arguments += @('--codex', $codexCommand.Source) }
    if ($claudeCommand) { $arguments += @('--claude', $claudeCommand.Source) }
    if ($ClaudeConfigDir) { $arguments += @('--claude-config-dir', $ClaudeConfigDir) }
    if (-not $WhatIfPreference) { $arguments += '--apply' }
    if ($WhatIfPreference) { Write-Host "WhatIf: would remove only Afyx-owned provider MCP entries at $ProviderScope scope" }
    else {
        $providerJson = (& $nodeCommand.Source @arguments) -join ''
        $providerResult = $providerJson | ConvertFrom-Json -Depth 20
        Write-Host "Provider removal: $($providerResult.status)"
        if ($LASTEXITCODE -ne 0 -or $providerResult.status -eq 'BLOCKED') { throw "Provider removal failed: $providerJson" }
    }
}
if (Test-Path -LiteralPath $graphRoot) {
    $removeGraph = $RemoveAfyxGraph
    if (-not $removeGraph -and -not $WhatIfPreference -and -not $env:CI -and -not [Console]::IsInputRedirected) {
        do { $answer = (Read-Host 'Afyx Graph detected. Remove Afyx Graph? [Y/N] [N]').Trim() } until ($answer -match '(?i)^(|y|yes|n|no)$')
        $removeGraph = $answer -match '(?i)^(y|yes)$'
    }
    if ($removeGraph) {
        & (Join-Path $PSScriptRoot 'scripts\install-afyx-graph.ps1') -Uninstall -RuntimeRoot $graphRoot -Confirm:$false -WhatIf:$WhatIfPreference
        if (-not $?) { throw 'Afyx Graph removal failed.' }
    } else { Write-Host 'Afyx Graph: kept' }
}

if ($RemoveAfyxContext) {
    # Remove only ownership-verified ACE companions for selected providers.
    # A foreign or user-modified skill is never adopted or deleted implicitly.
    foreach ($root in @($providerSkillRoots | Select-Object -Unique)) {
        $target = Join-Path $root 'afyx-context'
        Remove-AfyxSkillSafely -SkillsRoot $root -Component 'afyx-context' -Target $target -ExpectedOwner 'afyx' -Confirm:$false -WhatIf:$WhatIfPreference
    }
    & (Join-Path $PSScriptRoot 'scripts\install-afyx-context.ps1') -RuntimeRoot $ContextRuntimeRoot -Uninstall -Confirm:$false -WhatIf:$WhatIfPreference
    if (-not $?) { throw 'Afyx Context removal failed.' }
} elseif (Test-Path -LiteralPath $ContextRuntimeRoot) { Write-Host 'Afyx Context Engine: kept' }

if ($RemoveAfyxForge) {
    foreach ($root in @($providerSkillRoots | Select-Object -Unique)) {
        $target = Join-Path $root 'afyx-forge'
        Remove-AfyxSkillSafely -SkillsRoot $root -Component 'afyx-forge' -Target $target -ExpectedOwner 'afyx' -Confirm:$false -WhatIf:$WhatIfPreference
    }
    & (Join-Path $PSScriptRoot 'scripts\install-afyx-forge.ps1') -RuntimeRoot $ForgeRuntimeRoot -Uninstall -Confirm:$false -WhatIf:$WhatIfPreference
    if (-not $?) { throw 'Afyx Forge removal failed.' }
} elseif (Test-Path -LiteralPath $ForgeRuntimeRoot) { Write-Host 'Afyx Forge Core: kept' }

Write-Host 'ACE user state, project indexes, external software, and unrelated Codex configuration were not changed.'
