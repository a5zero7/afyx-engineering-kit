<#
.SYNOPSIS
    Unit tests for AFYX Usage Intelligence Capability Metadata & Provider Truthfulness
#>

[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$modulePath = Join-Path (Split-Path -Parent $scriptDir) 'AfyxUsageIntelligence.psm1'

Import-Module $modulePath -Force

$passed = 0
$failed = 0

function Assert-Equal($actual, $expected, [string]$label) {
    if ($actual -eq $expected) {
        Write-Host "  [PASS] $label" -ForegroundColor Green
        $script:passed++
    } else {
        Write-Host "  [FAIL] $label (Expected: '$expected', Actual: '$actual')" -ForegroundColor Red
        $script:failed++
    }
}

Write-Host "=== Testing AFYX Usage Intelligence Capability Metadata ===" -ForegroundColor Cyan

# Test 1: Codex capability metadata & truthful authentication
$originalCodexHome = $env:CODEX_HOME
$tempCodexWithSessions = Join-Path ([System.IO.Path]::GetTempPath()) ("afyx-usage-sessions-" + [Guid]::NewGuid().ToString("N"))
$tempCodexNoSessions = Join-Path ([System.IO.Path]::GetTempPath()) ("afyx-usage-nosessions-" + [Guid]::NewGuid().ToString("N"))

try {
    New-Item -ItemType Directory -Path (Join-Path $tempCodexWithSessions 'sessions') -Force | Out-Null
    New-Item -ItemType Directory -Path $tempCodexNoSessions -Force | Out-Null

    # 1a. Sessions directory exists, but auth is unverified -> UNKNOWN
    $env:CODEX_HOME = $tempCodexWithSessions
    $codexWithSessions = Get-AfyxProviderStatus -Provider 'codex'
    Assert-Equal $codexWithSessions.Provider 'codex' "Codex provider recognized"
    Assert-Equal $codexWithSessions.DiscoveryStatus 'DISCOVERED' "Codex discovery does not imply authentication"
    Assert-Equal $codexWithSessions.TelemetryStatus 'OK' "Codex telemetry OK when sessions dir exists"
    Assert-Equal $codexWithSessions.AuthenticationStatus 'UNKNOWN' "Sessions directory exists without verified auth -> AuthenticationStatus is UNKNOWN"
    Assert-Equal $codexWithSessions.PresentationSurfaces.Terminal 'VERIFIED' "Codex Terminal surface is VERIFIED"
    Assert-Equal $codexWithSessions.PresentationSurfaces.ChatPanel 'NOT_VERIFIED' "Codex ChatPanel surface is NOT_VERIFIED"
    Assert-Equal $codexWithSessions.ActualBilledCostAvailable $false "Codex billed cost is NOT available"
    Assert-Equal $codexWithSessions.EstimatedCostSupported $true "Codex estimated API cost is supported"

    # 1b. No sessions directory -> no false authenticated status
    $env:CODEX_HOME = $tempCodexNoSessions
    $codexNoSessions = Get-AfyxProviderStatus -Provider 'codex'
    Assert-Equal $codexNoSessions.TelemetryStatus 'NO_SESSIONS' "Codex telemetry NO_SESSIONS when sessions dir absent"
    Assert-Equal $codexNoSessions.AuthenticationStatus 'UNKNOWN' "No sessions directory -> AuthenticationStatus is UNKNOWN"
} finally {
    if ($null -ne $originalCodexHome) {
        $env:CODEX_HOME = $originalCodexHome
    } else {
        Remove-Item Env:CODEX_HOME -ErrorAction SilentlyContinue
    }
    Remove-Item -Recurse -Force $tempCodexWithSessions -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force $tempCodexNoSessions -ErrorAction SilentlyContinue
}

# Test 2: Antigravity capability metadata
$agyStatus = Get-AfyxProviderStatus -Provider 'antigravity'
Assert-Equal $agyStatus.Provider 'antigravity' "Antigravity provider recognized"
Assert-Equal $agyStatus.AuthenticationStatus 'UNKNOWN' "Antigravity authentication is UNKNOWN"
Assert-Equal $agyStatus.TelemetryStatus 'NOT_AVAILABLE' "Antigravity telemetry is truthfully NOT_AVAILABLE"
Assert-Equal $agyStatus.PresentationSurfaces.Terminal 'NOT_VERIFIED' "Antigravity Terminal is NOT_VERIFIED"
Assert-Equal $agyStatus.PresentationSurfaces.ChatPanel 'UNSUPPORTED' "Antigravity ChatPanel is UNSUPPORTED"
Assert-Equal $agyStatus.ActualBilledCostAvailable $false "Antigravity billed cost is NOT available"

# Test 3: Claude Code capability metadata
$claudeStatus = Get-AfyxProviderStatus -Provider 'claude'
Assert-Equal $claudeStatus.Provider 'claude' "Claude provider recognized"
Assert-Equal $claudeStatus.AuthenticationStatus 'UNKNOWN' "Claude authentication is UNKNOWN"
Assert-Equal $claudeStatus.TelemetryStatus 'NOT_AVAILABLE' "Claude telemetry is truthfully NOT_AVAILABLE"
Assert-Equal $claudeStatus.PresentationSurfaces.Terminal 'NOT_VERIFIED' "Claude Terminal is NOT_VERIFIED"
Assert-Equal $claudeStatus.PresentationSurfaces.ChatPanel 'UNSUPPORTED' "Claude ChatPanel is UNSUPPORTED"
Assert-Equal $claudeStatus.ActualBilledCostAvailable $false "Claude billed cost is NOT available"

# Test 4: Universal usage report cost separation
$reports = Get-AfyxUniversalUsageReport -Providers @('codex', 'antigravity', 'claude') -IncludeEstimates
Assert-Equal $reports.Count 3 "Reports array count equals 3"
foreach ($r in $reports) {
    Assert-Equal $r.ActualBilledCostUsd $null "Provider $($r.Provider) actual billed cost is null"
}

# Test 5: Presentation opt-in requirement
$optOutResult = Invoke-AfyxUsagePresentation -Surface 'Terminal' -OptIn:$false
Assert-Equal $optOutResult.Status 'OPT_IN_REQUIRED' "Presentation requires explicit opt-in"

# Test 6: Chat panel presentation rejection
$chatPanelResult = Invoke-AfyxUsagePresentation -Surface 'ChatPanel' -OptIn:$true
Assert-Equal $chatPanelResult.Status 'NOT_VERIFIED' "ChatPanel presentation returns NOT_VERIFIED"

Write-Host "=== Summary: $passed Passed, $failed Failed ===" -ForegroundColor $(if ($failed -eq 0) { 'Green' } else { 'Red' })

if ($failed -gt 0) {
    throw "AFYX Usage Intelligence metadata tests failed ($failed failures)"
}
