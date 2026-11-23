[CmdletBinding()]
param(
    [string[]]$Providers = @('codex', 'antigravity', 'claude'),
    [switch]$IncludeEstimates,
    [switch]$Json
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

$modulePath = Join-Path $PSScriptRoot 'AfyxUsageIntelligence.psm1'
Import-Module $modulePath -Force -ErrorAction Stop | Out-Null

$report = Get-AfyxUniversalUsageReport -Providers $Providers -IncludeEstimates:$IncludeEstimates

if ($Json) {
    $report | ConvertTo-Json -Depth 5
} else {
    Write-Host "==========================================================" -ForegroundColor Cyan
    Write-Host "  AFYX USAGE INTELLIGENCE (Universal Multi-Provider)      " -ForegroundColor Cyan
    Write-Host "==========================================================" -ForegroundColor Cyan
    foreach ($r in $report) {
        Write-Host "Provider: $($r.Provider.ToUpper()) | Status: $($r.Status)" -ForegroundColor Yellow
        if ($r.Reason) {
            Write-Host "  Reason: $($r.Reason)" -ForegroundColor DarkGray
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
