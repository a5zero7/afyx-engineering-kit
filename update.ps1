[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$SkillsRoot = (Join-Path $env:USERPROFILE '.agents\skills'),
    [switch]$SkipSelfUpdate,

    [string[]]$ComponentAction = @(),
    [string]$Preset = '',
    [string[]]$CustomComponent = @(),

    [switch]$Offline,

    [switch]$NoBuildFallback,

    [switch]$AllowDirtySource,
    [switch]$InstallUsageTracker,
    [switch]$SkipUsageTracker,
    [switch]$SkipGraphMcp,
    [switch]$SkipGraphPathUpdate,
    [string[]]$Provider = @(),
    [ValidateSet('global', 'workspace')][string]$ProviderScope = 'global',
    [string]$WorkspaceRoot = (Get-Location).Path,
    [string]$GeminiHome = $(if ($env:AFYX_GEMINI_HOME) { $env:AFYX_GEMINI_HOME } else { Join-Path $env:USERPROFILE '.gemini' }),
    [string]$ClaudeHome = $(if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $env:USERPROFILE '.claude' }),
    [string]$ClaudeConfigDir = $(if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { '' }),
    [switch]$SkipProviderConfiguration,
    [string]$ContextRuntimeRoot = $(if ($env:AFYX_CONTEXT_RUNTIME_ROOT) { $env:AFYX_CONTEXT_RUNTIME_ROOT } else { Join-Path $env:USERPROFILE '.afyx\context' }),
    [string]$ForgeRuntimeRoot = $(if ($env:AFYX_FORGE_RUNTIME_ROOT) { $env:AFYX_FORGE_RUNTIME_ROOT } else { Join-Path $env:USERPROFILE '.afyx\forge' })
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$installer = Join-Path $PSScriptRoot 'install.ps1'
$root = $PSScriptRoot
if (-not $PSBoundParameters.ContainsKey('SkillsRoot') -and $ProviderScope -eq 'workspace' -and 'antigravity' -in $Provider) {
    $SkillsRoot = Join-Path $WorkspaceRoot '.agents\skills'
}

if ($InstallUsageTracker -and $SkipUsageTracker) {
    Write-Error '-InstallUsageTracker and -SkipUsageTracker cannot be used together.'
    exit 1
}

foreach ($id in $CustomComponent) {
    if ($id -in @('prompt-master', 'headroom')) {
        throw "Component '$id' is retired from Afyx Kit and remains externally/user managed; no changes were made."
    }
}
foreach ($specification in $ComponentAction) {
    if ($specification -match '^([a-z0-9-]+)=' -and $Matches[1] -in @('prompt-master', 'headroom')) {
        throw "Component '$($Matches[1])' is retired from Afyx Kit and remains externally/user managed; no changes were made."
    }
}

Write-Host 'Afyx Codex Engineering Kit — Windows updater (PowerShell)'

if ($Offline -and -not $SkipSelfUpdate) {
    Write-Host 'Offline mode: self-update skipped; using the current local source intentionally.'
} elseif (-not $SkipSelfUpdate) {
    $git = Get-Command git -ErrorAction SilentlyContinue
    if (-not $git) {
        Write-Error 'Git executable not found. Self-update cannot be performed. Re-run with -SkipSelfUpdate only if using the current checkout intentionally.'
        exit 1
    }
    & git -C $root rev-parse --is-inside-work-tree *> $null
    if ($LASTEXITCODE -ne 0) {
        Write-Warning 'Self-update unavailable: source directory is not a Git repository. Continuing with current source.'
    } else {
        $status = & git -C $root status --porcelain
        if ($LASTEXITCODE -ne 0) { Write-Error 'Unable to inspect Git worktree status; updater aborted.'; exit 1 }
        if ($status) {
            Write-Error 'Local changes detected. Self-update and installation aborted. Run git status to handle local changes, or intentionally use .\update.ps1 -SkipSelfUpdate.'
            exit 1
        }
        if ($WhatIfPreference) {
            Write-Host 'WhatIf: skipping git pull --ff-only; repository will not be modified.'
        } else {
            & git -C $root pull --ff-only
            if ($LASTEXITCODE -ne 0) { Write-Error 'Self-update failed; installer was not run.'; exit 1 }
        }
    }
} else { Write-Host 'Self-update skipped by -SkipSelfUpdate; using current local source intentionally.' }

$usageArguments = @{}
if ($InstallUsageTracker) { $usageArguments.InstallUsageTracker = $true }
elseif ($SkipUsageTracker) { $usageArguments.SkipUsageTracker = $true }

& $installer -SkillsRoot $SkillsRoot -UpdateInstalled -ComponentAction $ComponentAction -Preset $Preset -CustomComponent $CustomComponent -Offline:$Offline -NoBuildFallback:$NoBuildFallback -AllowDirtySource:$AllowDirtySource -SkipGraphMcp:$SkipGraphMcp -SkipGraphPathUpdate:$SkipGraphPathUpdate -Provider $Provider -ProviderScope $ProviderScope -WorkspaceRoot $WorkspaceRoot -GeminiHome $GeminiHome -ClaudeHome $ClaudeHome -ClaudeConfigDir $ClaudeConfigDir -SkipProviderConfiguration:$SkipProviderConfiguration -ContextRuntimeRoot $ContextRuntimeRoot -ForgeRuntimeRoot $ForgeRuntimeRoot -Confirm:$false -WhatIf:$WhatIfPreference @usageArguments
$installerSucceeded = $?
$installerExitCode = 0
if (Test-Path -LiteralPath variable:LASTEXITCODE) { $installerExitCode = [int]$LASTEXITCODE }
if (-not $installerSucceeded -and $installerExitCode -eq 0) { $installerExitCode = 1 }
if ($installerExitCode -ne 0) { exit $installerExitCode }
exit 0
