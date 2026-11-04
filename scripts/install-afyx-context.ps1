[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$RuntimeRoot = $(if ($env:AFYX_CONTEXT_RUNTIME_ROOT) { $env:AFYX_CONTEXT_RUNTIME_ROOT } else { Join-Path $env:USERPROFILE '.afyx\context' }),
    [switch]$Update,
    [switch]$Repair,
    [switch]$Verify,
    [switch]$Uninstall,
    [switch]$ValidateOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$packageRoot = Split-Path -Parent $PSScriptRoot
$sourceRoot = Join-Path $packageRoot 'afyx-context'
$artifactTool = Join-Path $PSScriptRoot 'afyx-context-artifact.mjs'
$recoveryRoot = "$RuntimeRoot.afyx-old"

function Resolve-Full([string]$Path) { return [System.IO.Path]::GetFullPath($Path) }
function Test-IsFullyQualified([string]$Path) {
    if (-not [System.IO.Path]::IsPathRooted($Path)) { return $false }
    $root = [System.IO.Path]::GetPathRoot($Path)
    if (-not $root -or $root -eq '\' -or $root -eq '/') { return $false }
    return $true
}
function Assert-SafeRoot {
    if (-not (Test-IsFullyQualified $RuntimeRoot)) { throw 'Afyx Context RuntimeRoot must be absolute.' }
    if (($RuntimeRoot -split '[\\/]') -contains '..') { throw 'Afyx Context RuntimeRoot must not contain traversal segments.' }
    $resolved = Resolve-Full $RuntimeRoot
    $root = [System.IO.Path]::GetPathRoot($resolved)
    if ($resolved.TrimEnd('\','/') -eq $root.TrimEnd('\','/')) { throw 'Afyx Context RuntimeRoot cannot be a filesystem root.' }
    $source = (Resolve-Full $sourceRoot).TrimEnd('\','/')
    if ($resolved.TrimEnd('\','/') -eq $source -or $resolved.StartsWith("$source\", [System.StringComparison]::OrdinalIgnoreCase) -or $source.StartsWith("$($resolved.TrimEnd('\','/'))\", [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'Afyx Context RuntimeRoot must not overlap the bundled source.'
    }
    foreach ($candidate in @($RuntimeRoot, $recoveryRoot)) {
        $probe = Resolve-Full $candidate
        while ($probe) {
            if (Test-Path -LiteralPath $probe) {
                $item = Get-Item -LiteralPath $probe -Force
                if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Refusing reparse-point runtime path: $probe" }
            }
            $parent = [IO.Directory]::GetParent($probe)
            if (-not $parent) { break }
            $probe = $parent.FullName
        }
    }
}
function Get-Sha256([string]$Path) { return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
function Test-OwnedRuntime([string]$Root, [switch]$AllowModified) {
    try {
        $metadataPath = Join-Path $Root 'metadata.json'
        $manifestPath = Join-Path $Root 'integrity.sha256'
        $metadata = Get-Content -Raw -LiteralPath $metadataPath -Encoding utf8 | ConvertFrom-Json -ErrorAction Stop
        $identity = Get-Content -Raw -LiteralPath (Join-Path $Root 'current\identity.json') -Encoding utf8 | ConvertFrom-Json -ErrorAction Stop
        if ($metadata.product_name -ne 'Afyx Context Engine' -or $metadata.ownership_class -ne 'AFYX') { return $false }
        foreach ($field in @('product_name','product_version','source_revision','ownership_class','build_provenance','release_channel','integration_default')) {
            if ([string]$metadata.$field -ne [string]$identity.$field) { return $false }
        }
        if ($AllowModified) { return $true }
        if ((Get-Sha256 $manifestPath) -ne [string]$metadata.artifact_digest) { return $false }
        foreach ($line in (Get-Content -LiteralPath $manifestPath -Encoding utf8)) {
            if ($line -notmatch '^([0-9a-f]{64})  (current/[A-Za-z0-9._/-]+)$' -or $Matches[2] -match '(^|/)\.\.(/|$)') { return $false }
            $file = Join-Path $Root ($Matches[2] -replace '/', [IO.Path]::DirectorySeparatorChar)
            if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { return $false }
            $item = Get-Item -LiteralPath $file -Force
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { return $false }
            if ((Get-Sha256 $file) -ne $Matches[1]) { return $false }
        }
        return $true
    } catch { return $false }
}
function Recover-Interrupted {
    if (-not (Test-Path -LiteralPath $recoveryRoot)) { return }
    if (Test-Path -LiteralPath $RuntimeRoot) { throw 'Interrupted Afyx Context transaction is ambiguous; runtime and recovery both exist.' }
    if (-not (Test-OwnedRuntime $recoveryRoot)) { throw 'Interrupted Afyx Context recovery ownership or integrity is invalid.' }
    if ($ValidateOnly -or $Verify -or $Uninstall -or $WhatIfPreference) { throw 'Afyx Context recovery is pending; read-only/uninstall operation will not mutate it.' }
    Move-Item -LiteralPath $recoveryRoot -Destination $RuntimeRoot
    Write-Host "Recovered interrupted Afyx Context transaction at $RuntimeRoot."
}

Assert-SafeRoot
Recover-Interrupted
$state = if (-not (Test-Path -LiteralPath $RuntimeRoot)) { 'NOT INSTALLED' } elseif (Test-OwnedRuntime $RuntimeRoot) { 'HEALTHY' } elseif (Test-OwnedRuntime $RuntimeRoot -AllowModified) { 'DRIFTED' } else { 'UNKNOWN' }
if ($ValidateOnly -or $Verify) {
    Write-Host "Product: Afyx Context Engine`nState: $state`nRuntimeRoot: $RuntimeRoot"
    if ($Verify -and $state -ne 'HEALTHY') { exit 1 }
    exit 0
}
if ($Uninstall) {
    if ($state -eq 'NOT INSTALLED') { Write-Host 'Afyx Context Engine is not installed.'; exit 0 }
    if ($state -ne 'HEALTHY') { throw "Refusing to uninstall Afyx Context runtime with state $state." }
    if ($PSCmdlet.ShouldProcess($RuntimeRoot, 'Remove Afyx-owned Context runtime')) { Remove-Item -LiteralPath $RuntimeRoot -Recurse -Force }
    Write-Host 'Afyx Context runtime removed; user state was not changed.'
    exit 0
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js >=22.5.0 is required for Afyx Context.' }
$nodeVersion = (& node -p "process.versions.node") -join ''
if ([version]$nodeVersion -lt [version]'22.5.0') { throw "Node.js >=22.5.0 is required; found $nodeVersion." }
if ($state -eq 'UNKNOWN') { throw 'Refusing to replace foreign or unverified Afyx Context destination.' }
if ($state -eq 'DRIFTED' -and -not $Repair) { throw 'Modified Afyx Context runtime requires explicit repair.' }
if ($state -eq 'HEALTHY' -and -not ($Update -or $Repair)) { Write-Host 'Afyx Context runtime is already healthy; unchanged.'; exit 0 }
if ($state -eq 'NOT INSTALLED' -and ($Update -or $Repair)) { throw 'Update/repair requires an existing Afyx Context runtime.' }
if ($WhatIfPreference) { Write-Host "WhatIf: would stage and install Afyx Context at $RuntimeRoot"; exit 0 }

$revision = (& git -C $packageRoot rev-parse HEAD 2>$null) -join ''
if (-not $revision -or $revision -notmatch '^[0-9a-f]{40}$') {
    $revFile = Join-Path $packageRoot '.afyx-source-revision'
    if (Test-Path -LiteralPath $revFile -PathType Leaf) {
        $revision = (Get-Content -Raw -LiteralPath $revFile -Encoding utf8).Trim()
    }
}
if ($revision -notmatch '^[0-9a-f]{40}$') { throw 'Exact Git source revision is required to install Afyx Context.' }
$dirty = (& git -C $packageRoot status --porcelain --untracked-files=no 2>$null) -join ''
$provenance = if ($dirty) { 'LOCAL_SOURCE_DIRTY' } else { 'LOCAL_SOURCE_CLEAN' }
$parent = Split-Path -Parent $RuntimeRoot
New-Item -ItemType Directory -Force -Path $parent | Out-Null
$prepared = Join-Path $parent ".afyx-context-stage-$([guid]::NewGuid().ToString('N'))"
$swapped = $false
try {
    New-Item -ItemType Directory -Path $prepared | Out-Null
    & node $artifactTool prepare --source $sourceRoot --target (Join-Path $prepared 'current') --metadata (Join-Path $prepared 'metadata.json') --manifest (Join-Path $prepared 'integrity.sha256') --revision $revision --provenance $provenance
    if ($LASTEXITCODE -ne 0 -or -not (Test-OwnedRuntime $prepared)) { throw 'Prepared Afyx Context artifact failed integrity validation.' }
    if ($state -eq 'HEALTHY') {
        $oldDigest = (Get-Content -Raw -LiteralPath (Join-Path $RuntimeRoot 'metadata.json') | ConvertFrom-Json).artifact_digest
        $newDigest = (Get-Content -Raw -LiteralPath (Join-Path $prepared 'metadata.json') | ConvertFrom-Json).artifact_digest
        if ($oldDigest -eq $newDigest) { Remove-Item -LiteralPath $prepared -Recurse -Force; Write-Host 'Afyx Context runtime already matches the candidate; unchanged.'; exit 0 }
    }
    if (Test-Path -LiteralPath $RuntimeRoot) { Move-Item -LiteralPath $RuntimeRoot -Destination $recoveryRoot }
    Move-Item -LiteralPath $prepared -Destination $RuntimeRoot
    $swapped = $true
    if (-not (Test-OwnedRuntime $RuntimeRoot)) { throw 'Installed Afyx Context runtime failed post-swap verification.' }
    if (Test-Path -LiteralPath $recoveryRoot) { Remove-Item -LiteralPath $recoveryRoot -Recurse -Force }
} catch {
    if ($swapped -and (Test-Path -LiteralPath $RuntimeRoot)) { Remove-Item -LiteralPath $RuntimeRoot -Recurse -Force }
    if ((Test-Path -LiteralPath $recoveryRoot) -and -not (Test-Path -LiteralPath $RuntimeRoot)) { Move-Item -LiteralPath $recoveryRoot -Destination $RuntimeRoot }
    throw
} finally {
    if (Test-Path -LiteralPath $prepared) { Remove-Item -LiteralPath $prepared -Recurse -Force -ErrorAction SilentlyContinue }
}
Write-Host "Afyx Context Engine installed at $RuntimeRoot; source revision $revision; PATH and user state unchanged."
