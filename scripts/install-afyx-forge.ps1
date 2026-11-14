[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$RuntimeRoot = $(if ($env:AFYX_FORGE_RUNTIME_ROOT) { $env:AFYX_FORGE_RUNTIME_ROOT } else { Join-Path $env:USERPROFILE '.afyx\forge' }),
    [string]$SourceRevision = '',
    [switch]$Update,
    [switch]$Repair,
    [switch]$Verify,
    [switch]$Uninstall,
    [switch]$ValidateOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$packageRoot = Split-Path -Parent $PSScriptRoot
$sourceRoot = Join-Path $packageRoot 'afyx-forge'
$artifactStager = Join-Path $PSScriptRoot 'afyx-forge-artifact.mjs'
$recoveryRoot = "$RuntimeRoot.afyx-old"

function Resolve-Full([string]$Path) { return [System.IO.Path]::GetFullPath($Path) }
function Test-IsFullyQualified([string]$Path) {
    if (-not [System.IO.Path]::IsPathRooted($Path)) { return $false }
    $root = [System.IO.Path]::GetPathRoot($Path)
    if (-not $root -or $root -eq '\' -or $root -eq '/') { return $false }
    return $true
}

function Assert-NoReparsePoints([string]$CandidatePath) {
    $probe = $CandidatePath
    while ($probe) {
        if (Test-Path -LiteralPath $probe) {
            $item = Get-Item -LiteralPath $probe -Force
            if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
                throw "Afyx Forge runtime path must not traverse a reparse point or symbolic link: $probe"
            }
        }
        $parent = Split-Path -Parent $probe
        if (-not $parent -or $parent -eq $probe) { break }
        $probe = $parent
    }
}

function Assert-SafeRoot {
    if (-not (Test-IsFullyQualified $RuntimeRoot)) { throw 'Afyx Forge RuntimeRoot must be absolute.' }
    if (($RuntimeRoot -split '[\\/]') -contains '..') { throw 'Afyx Forge RuntimeRoot must not contain traversal segments.' }
    $resolved = Resolve-Full $RuntimeRoot
    $root = [System.IO.Path]::GetPathRoot($resolved)
    if ($resolved.TrimEnd('\','/') -eq $root.TrimEnd('\','/')) { throw 'Afyx Forge RuntimeRoot cannot be a filesystem root.' }
    $source = (Resolve-Full $sourceRoot).TrimEnd('\','/')
    if ($resolved.TrimEnd('\','/') -eq $source -or $resolved.StartsWith("$source\", [System.StringComparison]::OrdinalIgnoreCase) -or $source.StartsWith("$($resolved.TrimEnd('\','/'))\", [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'Afyx Forge RuntimeRoot must not overlap the bundled source.'
    }
    Assert-NoReparsePoints $resolved
    Assert-NoReparsePoints (Resolve-Full $recoveryRoot)
}

function Resolve-SourceRevision {
    if ($SourceRevision) {
        if ($SourceRevision -cnotmatch '^[0-9a-f]{40}$') { throw 'Explicit source revision is invalid.' }
        return $SourceRevision
    }
    $gitCmd = Get-Command git -ErrorAction SilentlyContinue
    if ($gitCmd -and (Test-Path -LiteralPath (Join-Path $packageRoot '.git'))) {
        $rev = ((& $gitCmd.Source -C $packageRoot rev-parse HEAD 2>$null) -join '').Trim()
        if ($LASTEXITCODE -eq 0 -and $rev -cmatch '^[0-9a-f]{40}$') { return $rev }
    }
    $revFile = Join-Path $packageRoot '.afyx-source-revision'
    if (Test-Path -LiteralPath $revFile -PathType Leaf) {
        $fromFile = (Get-Content -Raw -LiteralPath $revFile -Encoding utf8).Trim()
        if ($fromFile -cnotmatch '^[0-9a-f]{40}$') { throw 'Packaged source revision marker is invalid.' }
        return $fromFile
    }
    return 'unknown'
}

function Resolve-SourceProvenance {
    $gitCmd = Get-Command git -ErrorAction SilentlyContinue
    if ($gitCmd -and (Test-Path -LiteralPath (Join-Path $packageRoot '.git'))) {
        $dirty = ((& $gitCmd.Source -C $packageRoot status --porcelain -- afyx-forge 2>$null) -join '').Trim()
        if ($LASTEXITCODE -eq 0) {
            return $(if ($dirty) { 'LOCAL_SOURCE_DIRTY' } else { 'LOCAL_SOURCE_CLEAN' })
        }
    }
    $revFile = Join-Path $packageRoot '.afyx-source-revision'
    if (Test-Path -LiteralPath $revFile -PathType Leaf) { return 'RELEASE_CANDIDATE_SNAPSHOT' }
    return 'LOCAL_SOURCE_UNVERIFIED'
}

function Test-OwnedRuntime([string]$Root) {
    try {
        $metadataPath = Join-Path $Root 'metadata.json'
        if (-not (Test-Path -LiteralPath $metadataPath -PathType Leaf)) { return $false }
        $metadata = Get-Content -Raw -LiteralPath $metadataPath -Encoding utf8 | ConvertFrom-Json -ErrorAction Stop
        return ($metadata.product_name -eq 'Afyx Forge Core' -and $metadata.ownership_class -eq 'AFYX')
    } catch {
        return $false
    }
}

function Test-HealthyRuntime([string]$Root) {
    if (-not (Test-OwnedRuntime $Root)) { return $false }
    try {
        $metadataPath = Join-Path $Root 'metadata.json'
        $identityPath = Join-Path $Root 'current\identity.json'
        $integrityPath = Join-Path $Root 'integrity.sha256'
        $launcherCmd = Join-Path $Root 'current\bin\afyx-forge.cmd'
        $launcherJs = Join-Path $Root 'current\bin\afyx-forge.js'
        $publicLauncherCmd = Join-Path $Root 'bin\afyx-forge.cmd'
        $packageJson = Join-Path $Root 'current\package.json'
        $licenseFile = Join-Path $Root 'current\LICENSE'
        foreach ($required in @($metadataPath, $identityPath, $integrityPath, $launcherCmd, $launcherJs, $publicLauncherCmd, $packageJson, $licenseFile)) {
            if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { return $false }
        }
        $metadata = Get-Content -Raw -LiteralPath $metadataPath -Encoding utf8 | ConvertFrom-Json -ErrorAction Stop
        $identity = Get-Content -Raw -LiteralPath $identityPath -Encoding utf8 | ConvertFrom-Json -ErrorAction Stop
        if ($identity.product_name -ne 'Afyx Forge Core' -or $identity.ownership_class -ne 'AFYX') { return $false }
        if ($identity.product_version -ne $metadata.product_version) { return $false }
        if (-not $metadata.source_revision -or $identity.source_revision -ne $metadata.source_revision) { return $false }
        if (-not $metadata.artifact_digest) { return $false }

        $actualIntegrityDigest = (Get-FileHash -LiteralPath $integrityPath -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actualIntegrityDigest -ne ([string]$metadata.artifact_digest).ToLowerInvariant()) { return $false }

        $lines = @(Get-Content -LiteralPath $integrityPath -Encoding utf8 | Where-Object { $_.Trim() })
        if (-not $lines.Count) { return $false }
        foreach ($line in $lines) {
            if ($line -notmatch '^([0-9a-fA-F]{64})\s\s(current/.+)$') { return $false }
            $expectedHash = $Matches[1].ToLowerInvariant()
            $relPath = $Matches[2] -replace '/', '\'
            $fullPath = Join-Path $Root $relPath
            if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) { return $false }
            $actualHash = (Get-FileHash -LiteralPath $fullPath -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($actualHash -ne $expectedHash) { return $false }
        }
        return $true
    } catch {
        return $false
    }
}

function Get-State {
    if (-not (Test-Path -LiteralPath $RuntimeRoot)) { return 'NOT INSTALLED' }
    if (-not (Test-OwnedRuntime $RuntimeRoot)) { return 'DRIFTED' }
    if (Test-HealthyRuntime $RuntimeRoot) { return 'HEALTHY' }
    return 'BROKEN'
}

Assert-SafeRoot

if (Test-Path -LiteralPath $recoveryRoot) {
    if (Test-Path -LiteralPath $RuntimeRoot) {
        throw 'Interrupted Afyx Forge transaction is ambiguous; runtime and recovery both exist.'
    }
    if (-not (Test-OwnedRuntime $recoveryRoot)) {
        throw 'Interrupted Afyx Forge recovery ownership is invalid.'
    }
    if ($ValidateOnly -or $Verify -or $Uninstall) {
        throw 'Afyx Forge recovery is pending; read-only/uninstall operation will not mutate it.'
    }
    Move-Item -LiteralPath $recoveryRoot -Destination $RuntimeRoot
    Write-Host "Recovered interrupted Afyx Forge transaction at $RuntimeRoot."
}

$currentState = Get-State

if ($ValidateOnly -or $Verify) {
    $metadataPath = Join-Path $RuntimeRoot 'metadata.json'
    $metadata = if ($currentState -in @('HEALTHY', 'BROKEN') -and (Test-Path -LiteralPath $metadataPath)) {
        Get-Content -Raw -LiteralPath $metadataPath -Encoding utf8 | ConvertFrom-Json
    } else { $null }
    [pscustomobject]@{
        Component       = 'afyx-forge'
        State           = $currentState
        RuntimeRoot     = $RuntimeRoot
        Version         = if ($metadata) { $metadata.product_version } else { '0.1.0' }
        SourceRevision  = if ($metadata -and $metadata.PSObject.Properties['source_revision']) { $metadata.source_revision } else { $null }
        ArtifactDigest  = if ($metadata -and $metadata.PSObject.Properties['artifact_digest']) { $metadata.artifact_digest } else { $null }
        BuildProvenance = if ($metadata -and $metadata.PSObject.Properties['build_provenance']) { $metadata.build_provenance } else { $null }
        Ownership       = if ($currentState -in @('HEALTHY', 'BROKEN')) { 'afyx' } else { 'unknown' }
    }
    if ($Verify -and $currentState -ne 'HEALTHY') { exit 1 }
    exit 0
}

if ($Uninstall) {
    if ($currentState -eq 'NOT INSTALLED') {
        Write-Host 'Afyx Forge: already not installed.'
        exit 0
    }
    if ($currentState -eq 'DRIFTED') {
        throw "Refusing to uninstall $($RuntimeRoot): Afyx Forge ownership could not be verified."
    }
    if ($WhatIfPreference) {
        Write-Host "WhatIf: would uninstall Afyx Forge at $RuntimeRoot"
        exit 0
    }
    Remove-Item -LiteralPath $RuntimeRoot -Recurse -Force
    Write-Host "Afyx Forge: uninstalled from $RuntimeRoot"
    exit 0
}

if ($currentState -eq 'DRIFTED') {
    throw "Refusing to replace or modify unowned directory at $($RuntimeRoot): Afyx Forge ownership could not be verified."
}

if ($currentState -eq 'NOT INSTALLED' -and ($Update -or $Repair)) {
    throw "Update or repair requires an existing Afyx Forge runtime at $RuntimeRoot."
}

if ($currentState -eq 'BROKEN' -and -not $Update -and -not $Repair) {
    throw "Installed Afyx Forge at $RuntimeRoot is BROKEN (integrity or file drift detected). Use -Repair or -Update to restore it."
}

if ($currentState -eq 'HEALTHY' -and -not $Update -and -not $Repair) {
    Write-Host "Afyx Forge: already installed and HEALTHY at $RuntimeRoot. Use -Update or -Repair to reinstall."
    exit 0
}

if ($WhatIfPreference) {
    Write-Host "WhatIf: would stage and install Afyx Forge Core at $RuntimeRoot"
    exit 0
}

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    throw 'Node.js is required for Afyx Forge Core installation.'
}

$resolvedRevision = Resolve-SourceRevision
$resolvedProvenance = Resolve-SourceProvenance
$installedAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')

$parentDir = Split-Path -Parent $RuntimeRoot
New-Item -ItemType Directory -Force -Path $parentDir | Out-Null
$transactionId = [guid]::NewGuid().ToString('N')
$stageDir = Join-Path $parentDir ".forge-stage-$transactionId"

try {
    & $nodeCmd.Source $artifactStager --source-root $sourceRoot --stage-dir $stageDir --runtime-root (Resolve-Full $RuntimeRoot) --revision $resolvedRevision --provenance $resolvedProvenance --installed-at $installedAt
    if ($LASTEXITCODE -ne 0) {
        throw 'Failed to stage Afyx Forge Core artifact.'
    }
    if (-not (Test-HealthyRuntime $stageDir)) {
        throw 'Staged Afyx Forge runtime failed pre-swap integrity validation.'
    }

    if (Test-Path -LiteralPath $RuntimeRoot) {
        if (Test-Path -LiteralPath $recoveryRoot) { Remove-Item -LiteralPath $recoveryRoot -Recurse -Force }
        Move-Item -LiteralPath $RuntimeRoot -Destination $recoveryRoot
    }
    try {
        Move-Item -LiteralPath $stageDir -Destination $RuntimeRoot

        if ((Get-State) -ne 'HEALTHY') {
            throw 'Installed Afyx Forge failed post-installation health check.'
        }
        $verifyOutput = (& (Join-Path $RuntimeRoot 'bin\afyx-forge.cmd') --version 2>&1) -join ' '
        if ($LASTEXITCODE -ne 0 -or $verifyOutput -notmatch 'afyx-forge 0\.1\.0') {
            throw "Installed Afyx Forge CLI verification failed: $verifyOutput"
        }
    } catch {
        if (Test-Path -LiteralPath $RuntimeRoot) { Remove-Item -LiteralPath $RuntimeRoot -Recurse -Force }
        if (Test-Path -LiteralPath $recoveryRoot) { Move-Item -LiteralPath $recoveryRoot -Destination $RuntimeRoot }
        throw
    }
    if (Test-Path -LiteralPath $recoveryRoot) { Remove-Item -LiteralPath $recoveryRoot -Recurse -Force }
    Write-Host "Afyx Forge Core 0.1.0: successfully installed at $RuntimeRoot (revision=$resolvedRevision)"
} finally {
    if (Test-Path -LiteralPath $stageDir) { Remove-Item -LiteralPath $stageDir -Recurse -Force }
}
