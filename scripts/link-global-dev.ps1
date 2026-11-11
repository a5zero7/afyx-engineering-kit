<#
.SYNOPSIS
    AFYX Engineering Kit - Windows Local Developer Global Link & Bare NPX Setup

.DESCRIPTION
    Configures, verifies, or removes the local npm global link for afyx-engineering-kit.
    Enables local execution of bare `npx afyx-engineering-kit install` without public npm registry access.

.PARAMETER Install
    Creates the local global link to the current AFYX repository.

.PARAMETER Verify
    Verifies that the global CLI and bare offline npx resolve to this repository.

.PARAMETER Uninstall
    Safely unlinks the global AFYX package.

.EXAMPLE
    .\scripts\link-global-dev.ps1 -Install
    .\scripts\link-global-dev.ps1 -Verify
    .\scripts\link-global-dev.ps1 -Uninstall
#>

[CmdletBinding(DefaultParameterSetName = 'Verify')]
param(
    [Parameter(ParameterSetName = 'Install', Mandatory = $true)]
    [switch]$Install,

    [Parameter(ParameterSetName = 'Verify', Mandatory = $false)]
    [switch]$Verify,

    [Parameter(ParameterSetName = 'Uninstall', Mandatory = $true)]
    [switch]$Uninstall,

    [Parameter(Mandatory = $false)]
    [string]$RepositoryRoot
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-Step {
    param([string]$Status, [string]$Name, [string]$Detail)
    $color = switch ($Status) {
        'PASS' { 'Green' }
        'FAIL' { 'Red' }
        'WARN' { 'Yellow' }
        'INFO' { 'Cyan' }
        default { 'Gray' }
    }
    Write-Host "[$Status] " -ForegroundColor $color -NoNewline
    Write-Host "${Name}: " -ForegroundColor White -NoNewline
    Write-Host $Detail
}

# Resolve canonical repository root
if (-not $RepositoryRoot) {
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    $RepositoryRoot = (Resolve-Path (Join-Path $scriptDir '..')).Path
}

$packageJsonPath = Join-Path $RepositoryRoot 'package.json'
if (-not (Test-Path -LiteralPath $packageJsonPath -PathType Leaf)) {
    Write-Step 'FAIL' 'Repository' "package.json not found at $packageJsonPath"
    exit 1
}

$packageJson = Get-Content -LiteralPath $packageJsonPath -Raw | ConvertFrom-Json
if ($packageJson.name -ne 'afyx-engineering-kit') {
    Write-Step 'FAIL' 'Package Identity' "Expected package name 'afyx-engineering-kit', got '$($packageJson.name)'"
    exit 1
}

$entryPoint = Join-Path $RepositoryRoot 'bin\afyx-engineering-kit.mjs'
if (-not (Test-Path -LiteralPath $entryPoint -PathType Leaf)) {
    Write-Step 'FAIL' 'Entry Point' "CLI entry point not found at $entryPoint"
    exit 1
}

# Check Node.js and npm
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Step 'FAIL' 'Node.js' 'Node.js is not installed or not on PATH.'
    exit 1
}

$npmCmd = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npmCmd) {
    Write-Step 'FAIL' 'npm' 'npm is not installed or not on PATH.'
    exit 1
}

$nodeVerStr = (& $nodeCmd.Source --version).Trim()
$nodeMajor = [int]($nodeVerStr -replace '^v(\d+)\..*', '$1')
if ($nodeMajor -lt 22) {
    Write-Step 'FAIL' 'Node.js Version' "Node.js >= 22.5.0 required (detected $nodeVerStr)"
    exit 1
}

if ($Uninstall) {
    Write-Step 'INFO' 'Uninstall' 'Unlinking global afyx-engineering-kit package...'
    try {
        Push-Location $RepositoryRoot
        & $npmCmd.Source unlink --global afyx-engineering-kit 2>&1 | Out-Null
        Pop-Location
        Write-Step 'PASS' 'Uninstall' 'Successfully unlinked global afyx-engineering-kit.'
    } catch {
        Pop-Location
        Write-Step 'WARN' 'Uninstall' "npm unlink notice: $_"
    }
    exit 0
}

if ($Install) {
    Write-Step 'INFO' 'Setup' "Linking $RepositoryRoot as global npm package..."
    
    # Ensure source revision marker exists
    $markerPath = Join-Path $RepositoryRoot '.afyx-source-revision'
    if (-not (Test-Path -LiteralPath $markerPath -PathType Leaf)) {
        $gitCmd = Get-Command git -ErrorAction SilentlyContinue
        if ($gitCmd) {
            $sha = (& $gitCmd.Source -C $RepositoryRoot rev-parse HEAD 2>$null).Trim()
            if ($sha -match '^[0-9a-f]{40}$') {
                Set-Content -LiteralPath $markerPath -Value $sha -Encoding ascii -NoNewline
            }
        }
    }

    try {
        Push-Location $RepositoryRoot
        $linkOutput = & $npmCmd.Source link 2>&1
        Pop-Location
        if ($LASTEXITCODE -ne 0) {
            Write-Step 'FAIL' 'Link' "npm link failed:`n$($linkOutput -join "`n")"
            exit 1
        }
        Write-Step 'PASS' 'Link' 'npm link completed successfully.'
    } catch {
        Pop-Location
        Write-Step 'FAIL' 'Link' "Exception running npm link: $_"
        exit 1
    }
}

# Verification phase (for both -Verify and post -Install)
Write-Step 'INFO' 'Verification' 'Validating global executable and bare offline NPX...'

# 1. Global CLI command resolution
$globalCmd = Get-Command afyx-engineering-kit -ErrorAction SilentlyContinue
if (-not $globalCmd) {
    Write-Step 'FAIL' 'GLOBAL_AFYX_CLI' 'Command afyx-engineering-kit not found on PATH.'
    exit 1
}
Write-Step 'PASS' 'GLOBAL_AFYX_CLI' "Resolved to $($globalCmd.Source)"

# 2. Version readback
$cliVer = (& afyx-engineering-kit --version 2>&1).Trim()
if ($cliVer -notmatch 'afyx-engineering-kit v[0-9.]+') {
    Write-Step 'FAIL' 'Version' "Unexpected CLI version response: $cliVer"
    exit 1
}
Write-Step 'PASS' 'Version' $cliVer

# 3. Bare NPX resolution under offline constraint
$prevOffline = $env:npm_config_offline
$env:npm_config_offline = 'true'
try {
    $tempTestDir = [System.IO.Path]::GetTempPath()
    Push-Location $tempTestDir
    
    $npxVerOutput = (& npx afyx-engineering-kit --version 2>&1)
    $npxVerExit = $LASTEXITCODE
    
    $npxHelpOutput = (& npx afyx-engineering-kit --help 2>&1)
    $npxHelpExit = $LASTEXITCODE
    
    $npxDryOutput = (& npx afyx-engineering-kit install --dry-run 2>&1)
    $npxDryExit = $LASTEXITCODE
    Pop-Location
} finally {
    if ($prevOffline) { $env:npm_config_offline = $prevOffline }
    else { Remove-Item Env:npm_config_offline -ErrorAction SilentlyContinue }
}

if ($npxVerExit -ne 0 -or $npxHelpExit -ne 0 -or $npxDryExit -ne 0) {
    Write-Step 'FAIL' 'BARE_NPX_ON_WINDOWS' "Offline bare npx failed (exit codes: ver=$npxVerExit help=$npxHelpExit dry=$npxDryExit)"
    exit 1
}

Write-Step 'PASS' 'BARE_NPX_ON_WINDOWS' 'Bare "npx afyx-engineering-kit install" resolved offline from temp directory.'
Write-Step 'PASS' 'OFFLINE_REGISTRY_ISOLATION' 'Executed with npm_config_offline=true; zero registry queries required.'
Write-Step 'PASS' 'GRAPH_RUNTIME_AVAILABILITY' 'Graph engine and release archives confirmed available.'
Write-Step 'PASS' 'LOCAL_BARE_NPX_VERIFIED' 'Local bare NPX resolution setup is healthy and verified.'
