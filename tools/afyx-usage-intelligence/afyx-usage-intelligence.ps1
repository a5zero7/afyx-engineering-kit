[CmdletBinding()]
param(
    [string[]]$Providers = @('codex', 'antigravity', 'claude'),
    [switch]$IncludeEstimates,
    [switch]$Json,
    [switch]$CollectLocalProviders,
    [string]$ClaudeProjectsRoot,
    [string]$GeminiSessionRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

$modulePath = Join-Path $PSScriptRoot 'AfyxUsageIntelligence.psm1'
Import-Module $modulePath -Force -ErrorAction Stop | Out-Null

$report = Get-AfyxUniversalUsageReport -Providers $Providers -IncludeEstimates:$IncludeEstimates `
    -CollectLocalProviders:$CollectLocalProviders -ClaudeProjectsRoot $ClaudeProjectsRoot -GeminiSessionRoot $GeminiSessionRoot

if ($Json) {
    $report | ConvertTo-Json -Depth 8
} else {
    Write-Host "==========================================================" -ForegroundColor Cyan
    Write-Host "  AFYX USAGE INTELLIGENCE (Universal Multi-Provider)      " -ForegroundColor Cyan
    Write-Host "==========================================================" -ForegroundColor Cyan
    foreach ($r in $report) {
        Write-Host "Provider: $($r.Provider.ToUpper()) | Status: $($r.Status)" -ForegroundColor Yellow
        if ($r.Reason) {
            Write-Host "  Reason: $($r.Reason)" -ForegroundColor DarkGray
        }
        if ($r.PSObject.Properties['LocalEvidence'] -and $r.LocalEvidence.activity) {
            Write-Host "  Observed sessions: $($r.LocalEvidence.activity.sessions)"
            Write-Host "  Recorded model messages: $($r.LocalEvidence.activity.modelMessages)"
            Write-Host "  Measured usage events: $($r.LocalEvidence.count)"
        }
        if ($r.ObservedTokens) {
            Write-Host "  Input Tokens  : $($r.ObservedTokens.InputTokens)" -ForegroundColor Green
            Write-Host "  Output Tokens : $($r.ObservedTokens.OutputTokens)" -ForegroundColor Green
            Write-Host "  Total Tokens  : $($r.ObservedTokens.TotalTokens)" -ForegroundColor Green
        }
        Write-Host "  Billed Cost   : NOT_AVAILABLE" -ForegroundColor White
        if ($IncludeEstimates -and $null -ne $r.EstimatedApiCostUsd) {
            Write-Host "  Estimated API : `$($r.EstimatedApiCostUsd)" -ForegroundColor DarkYellow
        }
        Write-Host "----------------------------------------------------------" -ForegroundColor DarkGray
    }
}
