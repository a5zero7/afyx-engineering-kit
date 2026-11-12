# test_afyx_platform.ps1 — Regression tests for AfyxPlatform architecture helper
# Tests compatibility with Windows PowerShell 5.1 and PowerShell 7+

[CmdletBinding()]
param(
    [string]$ExpectedArchitecture = 'x64'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptRoot = Split-Path -Parent $PSScriptRoot
$libFile = Join-Path $scriptRoot 'lib\AfyxPlatform.ps1'
if (-not (Test-Path -LiteralPath $libFile -PathType Leaf)) {
    throw "AfyxPlatform.ps1 not found at $libFile"
}

. $libFile

Write-Host "=== Testing Get-AfyxOperatingSystemArchitecture ==="
$arch = Get-AfyxOperatingSystemArchitecture
Write-Host "Detected architecture: $arch"
if ($arch -notin @('x64', 'arm64', 'x86', 'unknown')) {
    throw "Unexpected architecture value returned: $arch"
}
if ($arch -ne $ExpectedArchitecture) {
    throw "Expected architecture $ExpectedArchitecture, but got $arch"
}

Write-Host "=== Testing Get-AfyxPlatformDescription ==="
$desc = Get-AfyxPlatformDescription
Write-Host "Platform description: $desc"
if (-not $desc -or $desc -notmatch '/ (X64|ARM64|X86|UNKNOWN)') {
    throw "Platform description format invalid: $desc"
}

Write-Host "=== Testing Get-AfyxGraphTarget ==="
$target = Get-AfyxGraphTarget
Write-Host "Graph target: $target"
if ($target -notin @('win32-x64', 'win32-arm64', 'win32-x86')) {
    throw "Unexpected Graph target returned: $target"
}

Write-Host "=== Testing StrictMode with missing properties ==="
# Ensure invoking properties under StrictMode Latest does not throw
$desc2 = Get-AfyxPlatformDescription
$arch2 = Get-AfyxOperatingSystemArchitecture
if ($arch -ne $arch2) {
    throw "Inconsistent architecture detection on subsequent calls"
}

Write-Host "AfyxPlatform Regression Tests: PASS"
exit 0
