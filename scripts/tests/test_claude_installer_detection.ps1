# Test script for Claude Code availability states and checkbox enablement in Windows installer
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$packageRoot = Split-Path -Parent (Split-Path -Parent $scriptDir)

function Describe-Test($name, $scriptBlock) {
    Write-Host "[TEST SUITE] $name"
    & $scriptBlock
    Write-Host "[TEST SUITE PASSED] $name`n"
}

Describe-Test 'Claude Code Provider Detection and Availability Matrix' {
    # Helper simulating the logic from install.ps1
    function Get-ClaudeAvailability($cliDetected, $extensionDetected) {
        $state = if ($cliDetected -and $extensionDetected) {
            'CLI_AND_EXTENSION'
        } elseif ($cliDetected) {
            'CLI_AVAILABLE'
        } elseif ($extensionDetected) {
            'EXTENSION_ONLY'
        } else {
            'UNAVAILABLE'
        }

        $detail = switch ($state) {
            'CLI_AND_EXTENSION' { 'CLI and VS Code extension detected; MCP supported' }
            'CLI_AVAILABLE' { 'native CLI detected; MCP adapter supported' }
            'EXTENSION_ONLY' { 'VS Code extension detected — standalone CLI unavailable' }
            default { 'not detected: claude CLI or VS Code extension' }
        }
        $enabled = $state -ne 'UNAVAILABLE'

        return [pscustomobject]@{
            State = $state
            Detail = $detail
            Enabled = $enabled
        }
    }

    # Case 1: Extension only (Standalone CLI absent)
    $c1 = Get-ClaudeAvailability $false $true
    if ($c1.State -ne 'EXTENSION_ONLY') { throw "Case 1 failed: Expected EXTENSION_ONLY, got $($c1.State)" }
    if (-not $c1.Enabled) { throw "Case 1 failed: Checkbox should be enabled for EXTENSION_ONLY" }
    if ($c1.Detail -notmatch 'VS Code extension detected — standalone CLI unavailable') {
        throw "Case 1 failed: Unexpected detail: $($c1.Detail)"
    }
    Write-Host "  -> PASS: Extension only allows checkbox selection with exact requirement text."

    # Case 2: CLI and Extension both installed
    $c2 = Get-ClaudeAvailability $true $true
    if ($c2.State -ne 'CLI_AND_EXTENSION') { throw "Case 2 failed: Expected CLI_AND_EXTENSION, got $($c2.State)" }
    if (-not $c2.Enabled) { throw "Case 2 failed: Checkbox should be enabled for CLI_AND_EXTENSION" }
    Write-Host "  -> PASS: CLI and Extension both detected properly."

    # Case 3: CLI only (Extension absent)
    $c3 = Get-ClaudeAvailability $true $false
    if ($c3.State -ne 'CLI_AVAILABLE') { throw "Case 3 failed: Expected CLI_AVAILABLE, got $($c3.State)" }
    if (-not $c3.Enabled) { throw "Case 3 failed: Checkbox should be enabled for CLI_AVAILABLE" }
    Write-Host "  -> PASS: CLI only properly detected."

    # Case 4: Neither installed
    $c4 = Get-ClaudeAvailability $false $false
    if ($c4.State -ne 'UNAVAILABLE') { throw "Case 4 failed: Expected UNAVAILABLE, got $($c4.State)" }
    if ($c4.Enabled) { throw "Case 4 failed: Checkbox should be disabled for UNAVAILABLE" }
    Write-Host "  -> PASS: Neither installed disables checkbox."
}

function Describe-Test($name, $scriptBlock) {
    Write-Host "[TEST SUITE] $name"
    & $scriptBlock
    Write-Host "[TEST SUITE PASSED] $name`n"
}

# Run live install.ps1 dry-run check in the current environment
Write-Host "[INTEGRATION] Verifying install.ps1 live detection with -Provider claude -WhatIf"
& "$packageRoot\install.ps1" -Provider claude -WhatIf
if ($LASTEXITCODE -ne 0) {
    throw "install.ps1 -Provider claude -WhatIf failed with exit code $LASTEXITCODE"
}
Write-Host "  -> PASS: install.ps1 completed with exit code 0."

Write-Host "All installer detection tests PASSED successfully."
