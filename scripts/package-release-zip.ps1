[CmdletBinding()]
param(
    [string]$OutputDir = (Join-Path $PSScriptRoot '..\testing\integration\release-zip'),
    [string]$Revision = '',
    [string]$GraphReleaseDir = '',
    [switch]$BuildGraphFromSource
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$kitRoot = Split-Path -Parent $PSScriptRoot
$validator = Join-Path $PSScriptRoot 'validate-release-zip-graph.mjs'
$stageDir = $null

function Invoke-Required([string]$Program, [string[]]$Arguments) {
    $global:LASTEXITCODE = 0
    $output = & $Program @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) { throw "$Program failed ($LASTEXITCODE): $($output -join ' ')" }
    return $output
}

if (-not $Revision) { $Revision = (Invoke-Required 'git' @('-C', $kitRoot, 'rev-parse', 'HEAD') | Select-Object -Last 1).Trim() }
if ($Revision -cnotmatch '^[0-9a-f]{40}$') { throw 'Revision must be an exact 40-character Git commit SHA.' }
$resolved = (Invoke-Required 'git' @('-C', $kitRoot, 'rev-parse', '--verify', "$Revision^{commit}") | Select-Object -Last 1).Trim()
if ($resolved -cne $Revision) { throw 'Revision does not identify the selected Git commit.' }
$head = (Invoke-Required 'git' @('-C', $kitRoot, 'rev-parse', 'HEAD') | Select-Object -Last 1).Trim()
if ($head -cne $Revision) { throw 'Package only the current HEAD; switch to the selected immutable commit first.' }
if (Invoke-Required 'git' @('-C', $kitRoot, 'status', '--porcelain')) { throw 'Source checkout is dirty; commit or use a clean worktree before packaging.' }

if (-not $GraphReleaseDir) { $GraphReleaseDir = Join-Path $kitRoot 'afyx-graph\engine\release' }
if ($BuildGraphFromSource) {
    Invoke-Required 'node' @($validator, 'build', '--root', $kitRoot, '--revision', $Revision) | Out-Null
}
Invoke-Required 'node' @($validator, 'verify', '--release', $GraphReleaseDir, '--revision', $Revision, '--root', $kitRoot) | Out-Null

$stageDir = Join-Path ([IO.Path]::GetTempPath()) ("afyx-zip-stage-" + [guid]::NewGuid().ToString('N'))
try {
    $sourceDir = Join-Path $stageDir 'source'
    $kitStage = Join-Path $stageDir 'afyx-engineering-kit'
    [IO.Directory]::CreateDirectory($sourceDir) | Out-Null
    [IO.Directory]::CreateDirectory($kitStage) | Out-Null
    $sourceTar = Join-Path $stageDir 'source.tar'
    Invoke-Required 'git' @('-C', $kitRoot, 'archive', '--format=tar', "--output=$sourceTar", $Revision) | Out-Null
    Invoke-Required 'tar' @('-xf', $sourceTar, '-C', $sourceDir) | Out-Null

    $items = @('bin', 'scripts', 'skills', 'afyx-context', 'afyx-forge', 'tools',
        'install.ps1', 'install.sh', 'verify.ps1', 'verify.sh', 'update.ps1', 'update.sh',
        'uninstall.ps1', 'uninstall.sh', 'package.json', 'LICENSE', 'README.md', 'SECURITY.md')
    foreach ($item in $items) {
        $from = Join-Path $sourceDir $item
        if (-not (Test-Path -LiteralPath $from)) { throw "Committed source is missing required package item: $item" }
        Copy-Item -LiteralPath $from -Destination (Join-Path $kitStage $item) -Recurse -Force
    }
    $stageRoot = [IO.Path]::GetFullPath($kitStage).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    foreach ($relative in @('scripts\tests', 'afyx-context\test', 'afyx-context\benchmark',
        'afyx-forge\test', 'tools\codex-usage\tests')) {
        $target = [IO.Path]::GetFullPath((Join-Path $kitStage $relative))
        if (-not $target.StartsWith($stageRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe staging path' }
        if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
    }
    $graphStage = Join-Path $kitStage 'afyx-graph'
    [IO.Directory]::CreateDirectory($graphStage) | Out-Null
    Copy-Item -LiteralPath (Join-Path $sourceDir 'afyx-graph\afyx-graph.json') -Destination $graphStage
    $engineStage = Join-Path $graphStage 'engine'
    [IO.Directory]::CreateDirectory($engineStage) | Out-Null
    $engineScripts = Join-Path $engineStage 'scripts'
    [IO.Directory]::CreateDirectory($engineScripts) | Out-Null
    foreach ($name in @('distribution-contract.mjs', 'distribution-product.json')) {
        Copy-Item -LiteralPath (Join-Path $sourceDir "afyx-graph\engine\scripts\$name") -Destination $engineScripts
    }
    $releaseStage = Join-Path $engineStage 'release'
    [IO.Directory]::CreateDirectory($releaseStage) | Out-Null
    foreach ($name in @('afyx-graph-win32-x64.zip', 'RELEASE-MANIFEST.json', 'SHA256SUMS')) {
        Copy-Item -LiteralPath (Join-Path $GraphReleaseDir $name) -Destination $releaseStage
    }
    [IO.File]::WriteAllText((Join-Path $kitStage '.afyx-source-revision'), "$Revision`n", [Text.UTF8Encoding]::new($false))

    $version = (Get-Content -Raw -LiteralPath (Join-Path $sourceDir 'package.json') | ConvertFrom-Json).version
    $name = "afyx-engineering-kit-v$version-windows-x64.zip"
    $tempZip = Join-Path $stageDir $name
    $timestamp = [datetime]::SpecifyKind([datetime]'2020-01-01', [DateTimeKind]::Utc)
    Get-ChildItem -LiteralPath $kitStage -Recurse -Force | ForEach-Object { $_.LastWriteTimeUtc = $timestamp }
    (Get-Item -LiteralPath $kitStage).LastWriteTimeUtc = $timestamp
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $writer = [IO.Compression.ZipFile]::Open($tempZip, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($file in (Get-ChildItem -LiteralPath $kitStage -Recurse -Force -File | Sort-Object FullName)) {
            $relative = $file.FullName.Substring($kitStage.Length).TrimStart([char[]]@('\', '/')).Replace('\', '/')
            $entryName = "afyx-engineering-kit/$relative"
            [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($writer, $file.FullName, $entryName, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
        }
    } finally { $writer.Dispose() }
    $zip = [IO.Compression.ZipFile]::OpenRead($tempZip)
    try {
        $required = @("afyx-engineering-kit/.afyx-source-revision", "afyx-engineering-kit/install.ps1",
            "afyx-engineering-kit/verify.ps1", "afyx-engineering-kit/afyx-graph/engine/release/afyx-graph-win32-x64.zip")
        foreach ($entryName in $required) {
            if (-not $zip.GetEntry($entryName)) { throw "Release ZIP is missing $entryName" }
        }
        foreach ($forbidden in @('scripts/tests/', 'afyx-context/test/', 'afyx-context/benchmark/',
            'afyx-forge/test/', 'tools/codex-usage/tests/', 'afyx-graph/engine/scripts/tests/')) {
            if ($zip.Entries.FullName | Where-Object { $_.StartsWith("afyx-engineering-kit/$forbidden", [StringComparison]::OrdinalIgnoreCase) }) {
                throw "Development fixture leaked into release ZIP: $forbidden"
            }
        }
        $reader = [IO.StreamReader]::new($zip.GetEntry($required[0]).Open())
        try { if ($reader.ReadToEnd().Trim() -cne $Revision) { throw 'Packed revision marker mismatch' } }
        finally { $reader.Dispose() }
    } finally { $zip.Dispose() }

    [IO.Directory]::CreateDirectory([IO.Path]::GetFullPath($OutputDir)) | Out-Null
    $destination = Join-Path ([IO.Path]::GetFullPath($OutputDir)) $name
    $digest = (Get-FileHash -Algorithm SHA256 -LiteralPath $tempZip).Hash.ToLowerInvariant()
    if (Test-Path -LiteralPath $destination) {
        $existing = (Get-FileHash -Algorithm SHA256 -LiteralPath $destination).Hash.ToLowerInvariant()
        if ($existing -ne $digest) { throw "Destination already exists with different bytes: $destination" }
    } else { Move-Item -LiteralPath $tempZip -Destination $destination }
    [pscustomobject]@{ Path = $destination; Version = $version; Revision = $Revision; Sha256 = $digest }
} finally {
    if ($stageDir -and (Test-Path -LiteralPath $stageDir)) {
        Remove-Item -LiteralPath $stageDir -Recurse -Force
    }
}
