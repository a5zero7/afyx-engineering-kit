[CmdletBinding()]
param(
    [string]$CodexHome = $(if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }),
    [string]$LatestUsagePath,
    [string]$SessionId,
    [string]$TurnId,
    [int]$MaxAgeSeconds = 300,
    [ValidateSet('Auto', 'Terminal', 'ChatPanel')][string]$HostCapability = 'Auto',
    [switch]$ForceOptIn,
    [switch]$Quiet
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

try {
    Import-Module (Join-Path $PSScriptRoot 'CodexUsage.psm1') -Force -ErrorAction Stop | Out-Null
    $result = Invoke-AfyxUsagePresentation -CodexHome $CodexHome `
                                          -LatestUsagePath $LatestUsagePath `
                                          -SessionId $SessionId `
                                          -TurnId $TurnId `
                                          -MaxAgeSeconds $MaxAgeSeconds `
                                          -HostCapability $HostCapability `
                                          -ForceOptIn:$ForceOptIn `
                                          -Quiet:$Quiet
    if ($result.Presented) {
        exit 0
    }
    exit 0
} catch {
    # Presentation adapter must never interrupt host agent workflow
    exit 0
}
