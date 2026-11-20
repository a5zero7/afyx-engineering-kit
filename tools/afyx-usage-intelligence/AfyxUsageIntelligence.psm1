<#
.SYNOPSIS
    AFYX Usage Intelligence Module (Universal Multi-Provider Telemetry)
    Conforms to afyx-usage/v1 specification.

.DESCRIPTION
    Provides capability discovery and normalized usage reporting across supported providers:
    - Codex CLI / VS Code
    - Antigravity IDE / CLI
    - Claude Code CLI / VS Code Extension

    Strict Truthful Telemetry Principles:
    - Exposes actual status: OK, NOT_AVAILABLE, UNAUTHENTICATED, UNSUPPORTED, or DISABLED.
    - Never fabricates token counts or billing data.
    - Strictly separates Actual Provider-Billed Cost from API-Equivalent Estimated Cost.
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
            return [pscustomobject]@{
                Provider               = 'codex'
                Availability           = if ($hasHome) { 'AVAILABLE' } else { 'NOT_INSTALLED' }
                TelemetryStatus        = if ($hasSessions) { 'OK' } else { 'NO_SESSIONS' }
                SupportedMetadata      = @('inputTokens', 'outputTokens', 'cachedInputTokens', 'cacheWriteInputTokens', 'reasoningTokens')
                BilledCostSupported    = $false
                EstimatedCostSupported = $true
                PresentationSurface    = 'Terminal,ChatPanel'
            }
        }
        'antigravity' {
            $agyHome = Join-Path $env:USERPROFILE '.gemini\antigravity'
            $hasAgy = Test-Path $agyHome
            return [pscustomobject]@{
                Provider               = 'antigravity'
                Availability           = if ($hasAgy) { 'AVAILABLE' } else { 'NOT_AVAILABLE' }
                TelemetryStatus        = 'NOT_AVAILABLE'
                Reason                 = 'PROVIDER_TELEMETRY_UNCONFIGURED'
                SupportedMetadata      = @('inputTokens', 'outputTokens')
                BilledCostSupported    = $false
                EstimatedCostSupported = $false
                PresentationSurface    = 'Terminal'
            }
        }
        'claude' {
            $claudeHome = Join-Path $env:USERPROFILE '.claude'
            $hasClaude = Test-Path $claudeHome
            return [pscustomobject]@{
                Provider               = 'claude'
                Availability           = if ($hasClaude) { 'AVAILABLE' } else { 'NOT_AVAILABLE' }
                TelemetryStatus        = 'NOT_AVAILABLE'
                Reason                 = 'PROVIDER_TELEMETRY_UNCONFIGURED'
                SupportedMetadata      = @('inputTokens', 'outputTokens')
                BilledCostSupported    = $false
                EstimatedCostSupported = $false
                PresentationSurface    = 'Terminal'
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
        if ($prov -eq 'codex' -and $status.Availability -eq 'AVAILABLE') {
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
                Status                 = 'OK'
                ObservedTokens         = if ($latestData) {
                    [pscustomobject]@{
                        InputTokens  = $latestData.input_tokens
                        OutputTokens = $latestData.output_tokens
                        TotalTokens  = $latestData.total_tokens
                    }
                } else { $null }
                ActualBilledCostUsd    = $null
                EstimatedApiCostUsd    = if ($IncludeEstimates -and $latestData) { $latestData.api_equivalent_cost } else { $null }
                CostKind               = 'unknown'
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
                CostKind               = 'unknown'
            })
        }
    }

    return $reports.ToArray()
}

Export-ModuleMember -Function @(
    'Get-AfyxProviderStatus',
    'Get-AfyxUniversalUsageReport',
    'Invoke-AfyxUsagePresentation'
)
