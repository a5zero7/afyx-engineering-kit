[CmdletBinding(SupportsShouldProcess, DefaultParameterSetName = 'Install')]
param(
    [Parameter(ParameterSetName = 'Install')][switch]$Replace,
    [Parameter(ParameterSetName = 'Install')][switch]$Update,
    [Parameter(ParameterSetName = 'Validate')][switch]$ValidateOnly,
    [Parameter(ParameterSetName = 'Uninstall')][switch]$Uninstall,
    [string]$ArchivePath,
    [string]$RuntimeRoot = (Join-Path $env:USERPROFILE '.afyx\graph'),
    [switch]$SkipPathUpdate,
    [switch]$Offline,
    [switch]$NoBuildFallback,
    [switch]$AllowDirtySource,
    [switch]$ConfigureMcp,
    [switch]$SkipMcp
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$kitRoot = Split-Path -Parent $PSScriptRoot
$metadataPath = Join-Path $kitRoot 'afyx-graph\afyx-graph.json'
$metadata = Get-Content -Raw -LiteralPath $metadataPath -Encoding utf8 | ConvertFrom-Json
$distributionProductPath = Join-Path $kitRoot 'afyx-graph\engine\scripts\distribution-product.json'
$releaseChannel = (Get-Content -Raw -LiteralPath $distributionProductPath -Encoding utf8 | ConvertFrom-Json).releaseChannel
$architecture = switch ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()) {
    'Arm64' { 'arm64' }
    'X64' { 'x64' }
    default { throw "Unsupported Windows architecture: $_" }
}
$target = "win32-$architecture"
$assetName = "afyx-graph-$target.zip"
$current = Join-Path $RuntimeRoot 'current'
$rootMetadata = Join-Path $RuntimeRoot 'metadata.json'
$launcher = Join-Path $current 'bin\afyx-graph.cmd'
$publicBin = Join-Path $RuntimeRoot 'bin'
$publicLauncher = Join-Path $publicBin 'afyx-graph.cmd'
$recoveryRoot = "$RuntimeRoot.afyx-old"
$engineRoot = Join-Path $kitRoot 'afyx-graph\engine'
$contractPath = Join-Path $engineRoot 'scripts\distribution-contract.mjs'
$artifactIdentityTool = Join-Path $kitRoot 'scripts\afyx-graph-artifact.mjs'
$releaseRoot = if ($env:AFYX_GRAPH_RELEASE_ROOT) { $env:AFYX_GRAPH_RELEASE_ROOT } else { Join-Path $engineRoot 'release' }

function Get-CommandVersion([string]$Name, [string[]]$Arguments = @('--version')) {
    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $command) { return $null }
    try {
        $output = (& $command.Source @Arguments 2>$null) -join ' '
        if ($LASTEXITCODE -ne 0) { return $null }
        return $output.Trim()
    } catch { return $null }
}

function Get-NodeVersion {
    $raw = Get-CommandVersion 'node' @('--version')
    if (-not $raw) { return $null }
    $match = [regex]::Match($raw, '(\d+)\.(\d+)\.(\d+)')
    if (-not $match.Success) { return $null }
    return [version]::new([int]$match.Groups[1].Value, [int]$match.Groups[2].Value, [int]$match.Groups[3].Value)
}

function Assert-HostRuntime {
    $nodeVersion = Get-NodeVersion
    if (-not $nodeVersion) {
        throw 'REQUIRED: Node.js was not found on PATH. Afyx Graph requires Node.js 22.5.0 or newer. Install it from https://nodejs.org/ and retry.'
    }
    if ($nodeVersion -lt [version]'22.5.0') {
        throw "REQUIRED: Node.js $nodeVersion is incompatible. Afyx Graph requires Node.js 22.5.0 or newer."
    }
    return $nodeVersion
}

function Get-SourceRevision {
    $git = Get-Command git -ErrorAction SilentlyContinue
    if (-not $git) { return $null }
    & $git.Source -C $kitRoot rev-parse --is-inside-work-tree *> $null
    if ($LASTEXITCODE -ne 0) { return $null }
    $commit = (& $git.Source -C $kitRoot rev-parse HEAD 2>$null).Trim()
    $branch = ((& $git.Source -C $kitRoot branch --show-current 2>$null) -join '').Trim()
    $dirty = [bool]((& $git.Source -C $kitRoot status --porcelain 2>$null) -join '')
    return [pscustomobject]@{ Commit = $commit; Branch = $branch; Dirty = $dirty }
}

function Get-RequestedRevision {
    $source = Get-SourceRevision
    if ($source) { return $source.Commit }
    return $null
}

function Build-LocalArchive {
    if ($NoBuildFallback) { throw 'COMPONENT_REQUIRED: no matching verified release artifact is available and local build fallback was disabled.' }
    $nodeVersion = Assert-HostRuntime
    $npm = Get-Command npm -ErrorAction SilentlyContinue
    if (-not $npm) {
        throw 'BUILD_ONLY: npm was not found on PATH. It is required only because no verified release artifact was available.'
    }
    $source = Get-SourceRevision
    if (-not $source) {
        throw 'BUILD_ONLY: local fallback requires a validated Git checkout. Install Git or provide -ArchivePath with SHA256SUMS.'
    }
    if ($source.Dirty -and -not $AllowDirtySource) {
        throw 'BUILD_ONLY: local source has uncommitted changes. Refusing to build an unverifiable Technical Alpha artifact; commit the changes or explicitly use -AllowDirtySource.'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $engineRoot 'package-lock.json') -PathType Leaf)) {
        throw 'BUILD_ONLY: afyx-graph/engine/package-lock.json is missing; local source is incomplete.'
    }

    Write-Host "Verified release unavailable; building Afyx Graph locally from $($source.Commit) on $($source.Branch)."
    Push-Location $engineRoot
    try {
        & $npm.Source ci | Out-Host
        if ($LASTEXITCODE -ne 0) { throw 'BUILD_ONLY: npm ci failed; the existing installation was not changed.' }
        & $npm.Source run build:clean | Out-Host
        if ($LASTEXITCODE -ne 0) { throw 'BUILD_ONLY: Afyx Graph clean build failed; the existing installation was not changed.' }
    } finally { Pop-Location }

    $buildRoot = Join-Path ([System.IO.Path]::GetTempPath()) "afyx-graph-build-$([guid]::NewGuid().ToString('N'))"
    $bundleName = "afyx-graph-$target"
    $bundleRoot = Join-Path $buildRoot $bundleName
    try {
        New-Item -ItemType Directory -Force -Path (Join-Path $bundleRoot 'lib'), (Join-Path $bundleRoot 'bin') | Out-Null
        Copy-Item -LiteralPath (Join-Path $engineRoot 'dist') -Destination (Join-Path $bundleRoot 'lib\dist') -Recurse
        Copy-Item -LiteralPath (Join-Path $engineRoot 'package.json') -Destination (Join-Path $bundleRoot 'lib\package.json')
        Copy-Item -LiteralPath $metadataPath -Destination (Join-Path $bundleRoot 'metadata.json')
        $bundleMetadataPath = Join-Path $bundleRoot 'metadata.json'
        $bundleMetadata = Get-Content -Raw -LiteralPath $bundleMetadataPath -Encoding utf8 | ConvertFrom-Json
        $bundleMetadata | Add-Member -NotePropertyName release_channel -NotePropertyValue $releaseChannel
        $bundleMetadata | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $bundleMetadataPath -Encoding utf8
        $extractionVersion = [regex]::Match(
            (Get-Content -Raw -LiteralPath (Join-Path $engineRoot 'src\extraction\extraction-version.ts')),
            'EXTRACTION_VERSION\s*=\s*(\d+)'
        ).Groups[1].Value
        & (Get-Command node).Source $artifactIdentityTool stamp --metadata $bundleMetadataPath --target $target --revision $source.Commit --extraction-version $extractionVersion *> $null
        if ($LASTEXITCODE -ne 0) { throw 'BUILD_ONLY: failed to stamp the local artifact identity.' }
        Copy-Item -LiteralPath (Join-Path $engineRoot 'LICENSE') -Destination (Join-Path $bundleRoot 'LICENSE')
        @'
@echo off
where node >nul 2>&1
if errorlevel 1 (
  echo [Afyx Graph] Node.js was not found on PATH. Install Node.js 22.5.0 or newer: https://nodejs.org/ 1>&2
  exit /b 1
)
node --disable-warning=ExperimentalWarning "%~dp0..\lib\dist\bin\afyx-graph.js" %*
'@ | Set-Content -LiteralPath (Join-Path $bundleRoot 'bin\afyx-graph.cmd') -Encoding ascii

        & (Get-Command node).Source $contractPath verify-bundle --root $bundleRoot --target $target | Out-Host
        if ($LASTEXITCODE -ne 0) { throw 'BUILD_ONLY: locally staged bundle failed the distribution contract.' }
        New-Item -ItemType Directory -Force -Path $releaseRoot | Out-Null
        $archive = Join-Path $releaseRoot $assetName
        if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
        Compress-Archive -LiteralPath $bundleRoot -DestinationPath $archive -CompressionLevel Optimal
        $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLowerInvariant()
        "$hash  $assetName" | Set-Content -LiteralPath (Join-Path $releaseRoot 'SHA256SUMS') -Encoding ascii
        Write-Host "Local artifact verified: $assetName (Node.js $nodeVersion, commit $($source.Commit))."
        return [pscustomobject]@{ Path = $archive; Source = 'local-build'; Commit = $source.Commit }
    } finally {
        if (Test-Path -LiteralPath $buildRoot) { Remove-Item -LiteralPath $buildRoot -Recurse -Force }
    }
}

function Update-UserPath([switch]$Remove) {
    if ($SkipPathUpdate) { return }
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $entries = @($userPath -split ';' | Where-Object { $_ })
    $present = $entries | Where-Object { $_.TrimEnd('\') -ieq $publicBin.TrimEnd('\') }
    if ($Remove) {
        if ($present -and $PSCmdlet.ShouldProcess('User PATH', "Remove $publicBin")) {
            $updated = ($entries | Where-Object { $_.TrimEnd('\') -ine $publicBin.TrimEnd('\') }) -join ';'
            [Environment]::SetEnvironmentVariable('Path', $updated, 'User')
        }
    } elseif (-not $present -and $PSCmdlet.ShouldProcess('User PATH', "Add $publicBin")) {
        $updated = (@($entries) + $publicBin) -join ';'
        [Environment]::SetEnvironmentVariable('Path', $updated, 'User')
    }
}

function Get-State {
    if (-not (Test-Path -LiteralPath $RuntimeRoot)) { return 'NOT INSTALLED' }
    if (-not (Test-Path -LiteralPath $rootMetadata -PathType Leaf) -or
        -not (Test-Path -LiteralPath $launcher -PathType Leaf)) { return 'INCOMPLETE' }
    try {
        $installed = Get-Content -Raw -LiteralPath $rootMetadata -Encoding utf8 | ConvertFrom-Json
        if ($installed.product_name -ne 'Afyx Graph' -or -not $installed.product_version) { return 'INVALID' }
    } catch { return 'INVALID' }
    return 'HEALTHY'
}

function Test-AfyxOwnershipAt([string]$Path) {
    $metadataAtPath = Join-Path $Path 'metadata.json'
    if (-not (Test-Path -LiteralPath $metadataAtPath -PathType Leaf)) { return $false }
    try {
        return (Get-Content -Raw -LiteralPath $metadataAtPath -Encoding utf8 | ConvertFrom-Json).product_name -eq 'Afyx Graph'
    } catch { return $false }
}

function Test-AfyxOwnership { return Test-AfyxOwnershipAt -Path $RuntimeRoot }

function Resolve-Archive {
    if ($ArchivePath) {
        $resolved = Resolve-Path -LiteralPath $ArchivePath -ErrorAction Stop
        return [pscustomobject]@{ Path = $resolved.Path; Source = 'explicit-archive'; Commit = $null; RevisionStatus = 'UNKNOWN' }
    }
    $requestedRevision = Get-RequestedRevision
    $local = Join-Path $releaseRoot $assetName
    if (Test-Path -LiteralPath $local -PathType Leaf) {
        $identity = $null
        try {
            Test-ArchiveChecksum -Path $local
            Test-ArchiveBundle -Path $local
            $identity = Get-ArchiveIdentity -Path $local -RequestedRevision $requestedRevision
        } catch {
            Write-Warning "Ignoring invalid local release cache ($($_.Exception.Message)); rebuilding from validated source."
            return Build-LocalArchive
        }
        if ($requestedRevision -and $identity.revisionStatus -ne 'MATCH') {
            Write-Warning "Ignoring valid but stale local release cache (requested $requestedRevision; artifact $($identity.sourceRevision)); rebuilding from validated source."
            return Build-LocalArchive
        }
        return [pscustomobject]@{ Path = $local; Source = 'local-release-cache'; Commit = $identity.sourceRevision; RevisionStatus = $identity.revisionStatus }
    }
    if (-not $Offline) {
        $downloadRoot = Join-Path ([System.IO.Path]::GetTempPath()) "afyx-graph-download-$([guid]::NewGuid().ToString('N'))"
        try {
            New-Item -ItemType Directory -Path $downloadRoot | Out-Null
            $download = Join-Path $downloadRoot $assetName
            $tag = "afyx-graph-v$($metadata.product_version)"
            $url = "https://github.com/a5zero7/afyx-codex-engineering-kit/releases/download/$tag/$assetName"
            Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $download
            Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/a5zero7/afyx-codex-engineering-kit/releases/download/$tag/SHA256SUMS" -OutFile (Join-Path $downloadRoot 'SHA256SUMS')
            Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/a5zero7/afyx-codex-engineering-kit/releases/download/$tag/RELEASE-MANIFEST.json" -OutFile (Join-Path $downloadRoot 'RELEASE-MANIFEST.json')
            Test-ArchiveChecksum -Path $download
            Test-ArchiveBundle -Path $download
            $identity = Get-ArchiveIdentity -Path $download -RequestedRevision $requestedRevision
            if ($requestedRevision -and $identity.revisionStatus -ne 'MATCH') {
                throw "Downloaded release revision is $($identity.sourceRevision), requested checkout is $requestedRevision."
            }
            return [pscustomobject]@{ Path = $download; Source = 'github-release'; Commit = $identity.sourceRevision; RevisionStatus = $identity.revisionStatus }
        } catch {
            Write-Warning "Verified GitHub release unavailable ($($_.Exception.Message)); trying bounded local build fallback."
        }
    } else { Write-Host 'Offline mode: skipping GitHub release lookup.' }
    return Build-LocalArchive
}

function Get-ArchiveIdentity([string]$Path, [string]$RequestedRevision) {
    $probe = Join-Path ([System.IO.Path]::GetTempPath()) "afyx-graph-identity-$([guid]::NewGuid().ToString('N'))"
    try {
        Expand-Archive -LiteralPath $Path -DestinationPath $probe
        $bundleMetadata = Join-Path $probe "afyx-graph-$target\metadata.json"
        $arguments = @($artifactIdentityTool, 'inspect', '--metadata', $bundleMetadata)
        if ($RequestedRevision) { $arguments += @('--requested-revision', $RequestedRevision) }
        $json = (& (Get-Command node).Source @arguments 2>$null) -join ''
        if ($LASTEXITCODE -ne 0) { throw 'Artifact identity could not be inspected.' }
        return $json | ConvertFrom-Json
    } finally {
        if (Test-Path -LiteralPath $probe) { Remove-Item -LiteralPath $probe -Recurse -Force }
    }
}

function Test-ArchiveChecksum([string]$Path) {
    $sumsPath = Join-Path (Split-Path -Parent $Path) 'SHA256SUMS'
    if (-not (Test-Path -LiteralPath $sumsPath -PathType Leaf)) { throw "SHA256SUMS is required beside $Path." }
    $line = Get-Content -LiteralPath $sumsPath | Where-Object { $_ -match "(?i)^([0-9a-f]{64})\s+\*?$([regex]::Escape((Split-Path -Leaf $Path)))$" } | Select-Object -First 1
    if (-not $line) { throw "SHA256SUMS has no entry for $(Split-Path -Leaf $Path)." }
    $expected = ([regex]::Match($line, '^[0-9a-fA-F]{64}')).Value.ToLowerInvariant()
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
    if ($actual -ne $expected) { throw "Checksum mismatch for $(Split-Path -Leaf $Path)." }
}

function Test-ArchiveBundle([string]$Path) {
    $probe = Join-Path ([System.IO.Path]::GetTempPath()) "afyx-graph-probe-$([guid]::NewGuid().ToString('N'))"
    try {
        Expand-Archive -LiteralPath $Path -DestinationPath $probe
        Test-StagedBundle -Path (Join-Path $probe "afyx-graph-$target")
    } finally {
        if (Test-Path -LiteralPath $probe) { Remove-Item -LiteralPath $probe -Recurse -Force }
    }
}

function Test-StagedBundle([string]$Path) {
    $required = @('bin\afyx-graph.cmd', 'metadata.json', 'LICENSE')
    foreach ($relative in $required) {
        if (-not (Test-Path -LiteralPath (Join-Path $Path $relative) -PathType Leaf)) {
            throw "Afyx Graph staged bundle is incomplete: $relative is missing."
        }
    }
    $stagedMetadata = Get-Content -Raw -LiteralPath (Join-Path $Path 'metadata.json') -Encoding utf8 | ConvertFrom-Json
    if ($stagedMetadata.product_name -ne 'Afyx Graph' -or $stagedMetadata.release_channel -ne $releaseChannel) {
        throw 'Afyx Graph staged bundle identity or release channel is invalid.'
    }
    if ($stagedMetadata.product_version -ne $metadata.product_version) {
        throw "Afyx Graph version mismatch: expected $($metadata.product_version), got $($stagedMetadata.product_version)."
    }
    if ($target -notin @($stagedMetadata.supported_platforms)) { throw "Afyx Graph bundle does not support $target." }
    & (Get-Command node).Source $contractPath verify-bundle --root $Path --target $target | Out-Host
    if ($LASTEXITCODE -ne 0) { throw 'Afyx Graph staged bundle failed the distribution contract.' }
}

function Test-StagedRuntimeIdentity([string]$Path) {
    $metadataPath = Join-Path $Path 'metadata.json'
    $identity = (& (Get-Command node).Source $artifactIdentityTool inspect --metadata $metadataPath 2>$null) -join '' | ConvertFrom-Json
    if ($identity.extractionVersion -eq $null) { return }
    $compiled = Join-Path $Path 'lib\dist\extraction\extraction-version.js'
    $actual = (& (Get-Command node).Source -e "process.stdout.write(String(require(process.argv[1]).EXTRACTION_VERSION))" $compiled 2>$null) -join ''
    if ($LASTEXITCODE -ne 0 -or [int]$actual -ne [int]$identity.extractionVersion) {
        throw "Installed artifact extraction identity mismatch: metadata $($identity.extractionVersion), compiled runtime $actual."
    }
}

if (Test-Path -LiteralPath $recoveryRoot) {
    if (Test-Path -LiteralPath $RuntimeRoot) {
        throw "Interrupted Graph transaction is ambiguous: both $RuntimeRoot and $recoveryRoot exist. Refusing to modify either path."
    }
    if ($ValidateOnly -or $Uninstall -or $WhatIfPreference) {
        throw "Interrupted Graph transaction found at $recoveryRoot. Retry the original install/update operation to restore it before validation or removal."
    }
    if (-not (Test-AfyxOwnershipAt -Path $recoveryRoot)) {
        throw "Refusing to restore $recoveryRoot because Afyx Graph ownership cannot be verified."
    }
    Move-Item -LiteralPath $recoveryRoot -Destination $RuntimeRoot
    Write-Host "Recovered interrupted Afyx Graph transaction at $RuntimeRoot."
}

$state = Get-State
if ($ValidateOnly) {
    $installedMetadata = if (Test-Path -LiteralPath $rootMetadata) { Get-Content -Raw $rootMetadata | ConvertFrom-Json } else { $null }
    $currentCheckoutRevision = Get-RequestedRevision
    $revisionStatus = if (-not $installedMetadata -or -not $installedMetadata.source_revision -or -not $currentCheckoutRevision) {
        'UNKNOWN'
    } elseif ([string]$installedMetadata.source_revision -eq $currentCheckoutRevision) {
        'MATCH'
    } else {
        'REVISION_MISMATCH'
    }
    [pscustomobject]@{
        Product = 'Afyx Graph'
        State = $state
        RuntimeRoot = $RuntimeRoot
        Version = if ($installedMetadata) { $installedMetadata.product_version } else { $null }
        SourceRevision = if ($installedMetadata -and $installedMetadata.source_revision) { $installedMetadata.source_revision } else { 'UNKNOWN' }
        ExtractionVersion = if ($installedMetadata) { $installedMetadata.extraction_version } else { $null }
        Provenance = if ($installedMetadata -and $installedMetadata.artifact_provenance) { $installedMetadata.artifact_provenance } else { 'UNKNOWN' }
        ReleaseManifestStatus = if ($installedMetadata -and $installedMetadata.release_manifest_status) { $installedMetadata.release_manifest_status } else { 'MISSING' }
        PublisherAuthenticity = if ($installedMetadata -and $installedMetadata.publisher_authenticity) { $installedMetadata.publisher_authenticity } else { 'UNVERIFIED' }
        BuildProvenance = if ($installedMetadata -and $installedMetadata.build_provenance) { $installedMetadata.build_provenance } else { 'UNVERIFIED' }
        CurrentCheckoutRevision = if ($currentCheckoutRevision) { $currentCheckoutRevision } else { 'UNKNOWN' }
        RevisionStatus = $revisionStatus
        UpdateAvailable = $revisionStatus -eq 'REVISION_MISMATCH'
    } | Format-List
    if ($revisionStatus -eq 'REVISION_MISMATCH') { Write-Host 'UPDATE AVAILABLE — REVISION MISMATCH' }
    if ($state -in @('INCOMPLETE', 'INVALID')) { exit 1 }
    exit 0
}

if ($Uninstall) {
    if ($state -eq 'NOT INSTALLED') { Write-Host 'Afyx Graph: not installed'; exit 0 }
    if (-not (Test-AfyxOwnership)) { throw "Refusing to remove $RuntimeRoot because Afyx Graph ownership cannot be verified." }
    if ($PSCmdlet.ShouldProcess($RuntimeRoot, 'Remove Afyx-owned Graph runtime')) {
        Remove-Item -LiteralPath $RuntimeRoot -Recurse -Force
        Update-UserPath -Remove
    }
    Write-Host 'Afyx Graph: removed; project .afyx-graph indexes were not changed.'
    exit 0
}

if ($state -ne 'NOT INSTALLED' -and -not ($Replace -or $Update)) {
    throw "Afyx Graph already exists at $RuntimeRoot. Use -Replace after inspecting the installation."
}
if ($state -ne 'NOT INSTALLED' -and -not (Test-AfyxOwnership)) {
    throw "Refusing to replace $RuntimeRoot because Afyx Graph ownership cannot be verified."
}
if ($WhatIfPreference) {
    $nodeVersion = Get-NodeVersion
    Write-Host "WhatIf: would resolve, verify, stage, and install $assetName to $RuntimeRoot"
    Write-Host "Release channel: $releaseChannel; Node.js: $(if ($nodeVersion) { $nodeVersion } else { 'missing/incompatible' })"
    exit 0
}

$nodeVersion = Assert-HostRuntime
$resolvedArchive = Resolve-Archive
$archive = $resolvedArchive.Path
Test-ArchiveChecksum -Path $archive
$parent = Split-Path -Parent $RuntimeRoot
New-Item -ItemType Directory -Force -Path $parent | Out-Null
$transaction = Join-Path $parent ".graph-stage-$([guid]::NewGuid().ToString('N'))"
$extract = Join-Path $transaction 'extract'
$prepared = Join-Path $transaction 'prepared'
$swapped = $false
try {
    New-Item -ItemType Directory -Force -Path $extract, $prepared | Out-Null
    Expand-Archive -LiteralPath $archive -DestinationPath $extract
    $bundle = Get-ChildItem -LiteralPath $extract -Directory | Where-Object Name -eq "afyx-graph-$target" | Select-Object -First 1
    if (-not $bundle) { throw "Archive does not contain afyx-graph-$target." }
    Test-StagedBundle -Path $bundle.FullName
    Test-StagedRuntimeIdentity -Path $bundle.FullName
    $requestedRevision = Get-RequestedRevision
    $releaseManifest = Join-Path (Split-Path -Parent $archive) 'RELEASE-MANIFEST.json'
    $manifestStatus = 'MISSING'
    $publisherAuthenticity = 'UNVERIFIED'
    $buildProvenance = 'UNVERIFIED'
    if (Test-Path -LiteralPath $releaseManifest -PathType Leaf) {
        & (Get-Command node).Source $artifactIdentityTool verify-release-manifest --manifest $releaseManifest --archive $archive --metadata (Join-Path $bundle.FullName 'metadata.json') *> $null
        if ($LASTEXITCODE -ne 0) { throw 'Release manifest verification failed.' }
        $manifestStatus = 'VERIFIED'
        $buildProvenance = 'COMMIT_BOUND_MANIFEST'
    } elseif ($resolvedArchive.Source -eq 'github-release') {
        throw 'GitHub release is missing RELEASE-MANIFEST.json.'
    }
    $gh = Get-Command gh -ErrorAction SilentlyContinue
    if ($resolvedArchive.Source -eq 'github-release' -and $gh) {
        & $gh.Source attestation verify $archive --repo a5zero7/afyx-codex-engineering-kit *> $null
        if ($LASTEXITCODE -ne 0) { throw 'GitHub publisher/build attestation verification failed.' }
        $publisherAuthenticity = 'GITHUB_ATTESTED'
        $buildProvenance = 'GITHUB_ATTESTED'
    }
    & (Get-Command node).Source $artifactIdentityTool record-install --metadata (Join-Path $bundle.FullName 'metadata.json') --archive $archive --provenance $resolvedArchive.Source --requested-revision $(if ($requestedRevision) { $requestedRevision } else { 'UNKNOWN' }) --release-manifest-status $manifestStatus --publisher-authenticity $publisherAuthenticity --build-provenance $buildProvenance *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Failed to record installed artifact provenance.' }
    Move-Item -LiteralPath $bundle.FullName -Destination (Join-Path $prepared 'current')
    Copy-Item -LiteralPath (Join-Path $prepared 'current\metadata.json') -Destination (Join-Path $prepared 'metadata.json')
    $stagedPublicBin = Join-Path $prepared 'bin'
    New-Item -ItemType Directory -Force -Path $stagedPublicBin | Out-Null
    @"
@echo off
@call "%~dp0..\current\bin\afyx-graph.cmd" %*
"@ | Set-Content -LiteralPath (Join-Path $stagedPublicBin 'afyx-graph.cmd') -Encoding ascii
    if (Test-Path -LiteralPath $RuntimeRoot) { Move-Item -LiteralPath $RuntimeRoot -Destination $recoveryRoot }
    try {
        Move-Item -LiteralPath $prepared -Destination $RuntimeRoot
        $swapped = $true
        if ((Get-State) -ne 'HEALTHY') { throw 'Installed Afyx Graph failed post-swap validation.' }
        $versionOutput = (& $publicLauncher --version 2>&1) -join ' '
        if ($LASTEXITCODE -ne 0 -or $versionOutput -notmatch [regex]::Escape([string]$metadata.product_version)) {
            throw "Installed Afyx Graph CLI verification failed: $versionOutput"
        }
        & $publicLauncher help *> $null
        if ($LASTEXITCODE -ne 0) { throw 'Installed Afyx Graph help command failed.' }
    } catch {
        if (Test-Path -LiteralPath $RuntimeRoot) { Remove-Item -LiteralPath $RuntimeRoot -Recurse -Force }
        if (Test-Path -LiteralPath $recoveryRoot) { Move-Item -LiteralPath $recoveryRoot -Destination $RuntimeRoot }
        throw
    }
    if (Test-Path -LiteralPath $recoveryRoot) { Remove-Item -LiteralPath $recoveryRoot -Recurse -Force }
} finally {
    if (Test-Path -LiteralPath $transaction) { Remove-Item -LiteralPath $transaction -Recurse -Force }
    if (-not $swapped -and (Test-Path -LiteralPath $recoveryRoot) -and -not (Test-Path -LiteralPath $RuntimeRoot)) {
        Move-Item -LiteralPath $recoveryRoot -Destination $RuntimeRoot
    }
}

Update-UserPath

$mcpState = 'MCP_NOT_CONFIGURED'
if ($SkipMcp) {
    Write-Host 'Afyx Graph MCP: skipped explicitly.'
} else {
    $codexCommand = Get-Command codex.exe -ErrorAction SilentlyContinue
    if (-not $codexCommand) { $codexCommand = Get-Command codex.cmd -ErrorAction SilentlyContinue }
    $codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }
    $installedEntry = Join-Path $RuntimeRoot 'current\lib\dist\bin\afyx-graph.js'
    $arguments = @(
        (Join-Path $kitRoot 'scripts\afyx-mcp-integration.mjs'),
        '--node', (Get-Command node).Source,
        '--entry', $installedEntry,
        '--codex-home', $codexHome
    )
    if ($codexCommand) { $arguments += @('--codex', $codexCommand.Source) }
    if ($ConfigureMcp) { $arguments += '--apply' }
    $mcpJson = (& (Get-Command node).Source @arguments 2>$null) -join ''
    try {
        $mcpResult = $mcpJson | ConvertFrom-Json
        $mcpState = $mcpResult.mcp
        Write-Host "Afyx Graph MCP: $($mcpResult.mcp) — $($mcpResult.detail)"
    } catch {
        $mcpState = 'MCP_BLOCKED'
        Write-Warning 'Afyx Graph MCP integration could not be evaluated; the healthy Graph runtime was preserved.'
    }
    if (-not $ConfigureMcp -and $mcpState -eq 'MCP_NOT_CONFIGURED') {
        Write-Host 'Registration available: rerun the selected Graph lifecycle with -ConfigureMcp (or use the main installer selection).'
    }
}

Write-Host "Afyx Graph $($metadata.product_version) [$releaseChannel]: installed at $RuntimeRoot"
Write-Host "Artifact source: $($resolvedArchive.Source); source revision: $(if ($resolvedArchive.Commit) { $resolvedArchive.Commit } else { 'release/explicit archive' })"
Write-Host "CLI: $publicLauncher"
if ($SkipMcp) { Write-Host 'MCP configuration was not changed.' }
