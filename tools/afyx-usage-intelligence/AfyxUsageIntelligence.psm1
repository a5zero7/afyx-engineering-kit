<#
.SYNOPSIS
    AFYX Usage Intelligence Module (Universal Multi-Provider Telemetry)
    Conforms to afyx-usage/v1 specification.

.DESCRIPTION
    Provides capability discovery and truthful normalized usage reporting across supported providers:
    - Codex CLI / VS Code
    - Antigravity IDE / CLI
    - Claude Code CLI / VS Code Extension

    Strict Truthful Telemetry Principles:
    - Exposes explicit separation of:
      1. Provider discovery
      2. Provider installation/availability
      3. Authentication/telemetry accessibility
      4. Active telemetry collection
      5. Presentation surface verification
      6. Actual provider billed cost vs API-equivalent estimated cost
    - Terminal presentation for Codex is VERIFIED; Chat Panel presentation is strictly NOT_VERIFIED.
    - Antigravity & Claude Code telemetry remain NOT_AVAILABLE unless authentic telemetry collection exists.
    - Never fabricates token counts, session IDs, or billing data.
    - Default OFF for automatic presentation unless explicitly opted in.
#>

Set-StrictMode -Version Latest

# Re-export and wrap Codex usage capabilities for backward compatibility
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$codexModule = Join-Path $scriptDir 'CodexUsage.psm1'
if (Test-Path $codexModule) {
    Import-Module $codexModule -Force -ErrorAction SilentlyContinue | Out-Null
}

function Get-AfyxProviderStatus {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet('codex', 'antigravity', 'claude')][string]$Provider
    )

    switch ($Provider) {
        'codex' {
            $codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }
            $hasHome = Test-Path $codexHome
            $hasSessions = Test-Path (Join-Path $codexHome 'sessions')
            $hasCommand = [bool](Get-Command 'codex' -ErrorAction SilentlyContinue)

            return [pscustomobject]@{
                Provider                    = 'codex'
                DiscoveryStatus             = 'DISCOVERED'
                InstallationStatus          = if ($hasHome -or $hasCommand) { 'INSTALLED' } else { 'NOT_INSTALLED' }
                AuthenticationStatus        = 'UNKNOWN'
                TelemetryStatus             = if ($hasSessions) { 'OK' } elseif ($hasHome) { 'NO_SESSIONS' } else { 'NOT_AVAILABLE' }
                SupportedMetadata           = @('inputTokens', 'outputTokens', 'cachedInputTokens', 'cacheWriteInputTokens', 'reasoningTokens')
                ActualBilledCostAvailable   = $false
                EstimatedCostSupported      = $true
                PresentationSurfaces        = [pscustomobject]@{
                    Terminal  = 'VERIFIED'
                    ChatPanel = 'NOT_VERIFIED'
                }
                VerificationEvidence        = 'Terminal presentation verified via local CLI/tasks; Chat Panel rendering remains NOT_VERIFIED pending real-host evidence. Session history alone does not verify active authentication.'
            }
        }
        'antigravity' {
            $agyHome = Join-Path $env:USERPROFILE '.gemini\antigravity'
            $hasAgy = Test-Path $agyHome
            $hasCommand = [bool](Get-Command 'agy' -ErrorAction SilentlyContinue) -or [bool](Get-Command 'antigravity' -ErrorAction SilentlyContinue)

            return [pscustomobject]@{
                Provider                    = 'antigravity'
                DiscoveryStatus             = if ($hasAgy -or $hasCommand) { 'DISCOVERED' } else { 'NOT_DISCOVERED' }
                InstallationStatus          = if ($hasAgy -or $hasCommand) { 'INSTALLED' } else { 'NOT_INSTALLED' }
                AuthenticationStatus        = 'UNKNOWN'
                TelemetryStatus             = 'NOT_AVAILABLE'
                Reason                      = 'PROVIDER_TELEMETRY_UNCONFIGURED'
                SupportedMetadata           = @('inputTokens', 'outputTokens')
                ActualBilledCostAvailable   = $false
                EstimatedCostSupported      = $false
                PresentationSurfaces        = [pscustomobject]@{
                    Terminal  = 'NOT_VERIFIED'
                    ChatPanel = 'UNSUPPORTED'
                }
                VerificationEvidence        = 'Antigravity discovery supported; actual live telemetry remains NOT_AVAILABLE without active provider collector.'
            }
        }
        'claude' {
            $claudeHome = Join-Path $env:USERPROFILE '.claude'
            $hasClaude = Test-Path $claudeHome
            $hasCommand = [bool](Get-Command 'claude' -ErrorAction SilentlyContinue)

            return [pscustomobject]@{
                Provider                    = 'claude'
                DiscoveryStatus             = if ($hasClaude -or $hasCommand) { 'DISCOVERED' } else { 'NOT_DISCOVERED' }
                InstallationStatus          = if ($hasClaude -or $hasCommand) { 'INSTALLED' } else { 'NOT_INSTALLED' }
                AuthenticationStatus        = 'UNKNOWN'
                TelemetryStatus             = 'NOT_AVAILABLE'
                Reason                      = 'PROVIDER_TELEMETRY_UNCONFIGURED'
                SupportedMetadata           = @('inputTokens', 'outputTokens')
                ActualBilledCostAvailable   = $false
                EstimatedCostSupported      = $false
                PresentationSurfaces        = [pscustomobject]@{
                    Terminal  = 'NOT_VERIFIED'
                    ChatPanel = 'UNSUPPORTED'
                }
                VerificationEvidence        = 'Claude Code discovery supported; actual live telemetry remains NOT_AVAILABLE without active provider collector.'
            }
        }
    }
}

function Get-AfyxUniversalUsageReport {
    [CmdletBinding()]
    param(
        [string[]]$Providers = @('codex', 'antigravity', 'claude'),
        [switch]$IncludeEstimates = $false
    )

    $reports = [System.Collections.Generic.List[object]]::new()

    foreach ($prov in $Providers) {
        $status = Get-AfyxProviderStatus -Provider $prov
        if ($prov -eq 'codex' -and $status.InstallationStatus -eq 'INSTALLED') {
            $codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }
            $latestPath = Join-Path $codexHome 'tools\codex-usage-latest.json'
            $latestData = $null
            if (Test-Path $latestPath) {
                try {
                    $latestData = Get-Content $latestPath -Raw | ConvertFrom-Json
                } catch {}
            }

            $reports.Add([pscustomobject]@{
                Contract               = 'afyx-usage/v1'
                Provider               = 'codex'
                Status                 = $status.TelemetryStatus
                ObservedTokens         = if ($latestData) {
                    [pscustomobject]@{
                        InputTokens  = $latestData.input_tokens
                        OutputTokens = $latestData.output_tokens
                        TotalTokens  = $latestData.total_tokens
                    }
                } else { $null }
                ActualBilledCostUsd    = $null # ACTUAL_PROVIDER_BILLED_COST is strictly NOT_AVAILABLE
                EstimatedApiCostUsd    = if ($IncludeEstimates -and $latestData -and $latestData.PSObject.Properties['api_equivalent_cost']) { $latestData.api_equivalent_cost } else { $null }
                CostKind               = if ($IncludeEstimates -and $latestData) { 'API_EQUIVALENT_ESTIMATE' } else { 'UNAVAILABLE' }
                PresentationSurfaces   = $status.PresentationSurfaces
            })
        } else {
            $reports.Add([pscustomobject]@{
                Contract               = 'afyx-usage/v1'
                Provider               = $prov
                Status                 = $status.TelemetryStatus
                Reason                 = if ($status.PSObject.Properties['Reason']) { $status.Reason } else { $null }
                ObservedTokens         = $null
                ActualBilledCostUsd    = $null
                EstimatedApiCostUsd    = $null
                CostKind               = 'UNAVAILABLE'
                PresentationSurfaces   = $status.PresentationSurfaces
            })
        }
    }

    return $reports.ToArray()
}

function Invoke-AfyxUsagePresentation {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $false)]
        [ValidateSet('Terminal', 'ChatPanel')][string]$Surface = 'Terminal',
        [switch]$OptIn = $false
    )

    if (-not $OptIn) {
        Write-Verbose "Usage presentation is opt-in by default; skipping automatic display."
        return [pscustomobject]@{
            Status  = 'OPT_IN_REQUIRED'
            Message = 'Usage presentation requires explicit opt-in.'
        }
    }

    if ($Surface -eq 'ChatPanel') {
        return [pscustomobject]@{
            Status  = 'NOT_VERIFIED'
            Message = 'Chat Panel usage rendering is not verified for current host environment; falling back to Terminal.'
            Surface = 'ChatPanel'
        }
    }

    # Execute verified terminal presentation
    $codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }
    $presentScript = Join-Path $codexHome 'tools\codex-usage-present.ps1'
    if (Test-Path $presentScript) {
        & $presentScript
        return [pscustomobject]@{
            Status  = 'PRESENTED'
            Surface = 'Terminal'
        }
    } else {
        return [pscustomobject]@{
            Status  = 'TOOL_NOT_FOUND'
            Surface = 'Terminal'
            Message = "Presentation script not found at $presentScript"
        }
    }
}

Export-ModuleMember -Function @(
    'Get-AfyxProviderStatus',
    'Get-AfyxUniversalUsageReport',
    'Invoke-AfyxUsagePresentation'
)
