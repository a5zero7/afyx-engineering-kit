# package-release-zip.ps1 — Builds a release-pinned self-contained ZIP distribution
[CmdletBinding()]
param(
    [string]$OutputDir = (Join-Path $PSScriptRoot '..\testing\integration\release-zip'),
    [string]$Revision = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$kitRoot = Split-Path -Parent $PSScriptRoot
if (-not $Revision) {
    $Revision = try { (& git -C $kitRoot rev-parse HEAD 2>$null).Trim() } catch { '' }
}
if (-not $Revision) { $Revision = '838b5b0bf1d3413579281cbd6c5250ec767ba79d' }

$pkgJson = Get-Content -Raw -LiteralPath (Join-Path $kitRoot 'package.json') | ConvertFrom-Json
$version = $pkgJson.version
$zipName = "afyx-engineering-kit-v$version-windows-x64.zip"
$stageDir = Join-Path ([System.IO.Path]::GetTempPath()) ("afyx-zip-stage-" + [guid]::NewGuid().ToString('N'))
$kitStage = Join-Path $stageDir "afyx-engineering-kit"

try {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
    New-Item -ItemType Directory -Path $kitStage -Force | Out-Null

    Write-Host "Staging release ZIP for revision $Revision (v$version)..."

    # Copy files according to packaging contract
    $itemsToCopy = @(
        'bin',
        'scripts',
        'skills',
        'afyx-context',
        'afyx-forge',
        'tools',
        'install.ps1',
        'install.sh',
        'verify.ps1',
        'verify.sh',
        'update.ps1',
        'update.sh',
        'uninstall.ps1',
        'uninstall.sh',
        'package.json',
        'LICENSE',
        'README.md',
        'SECURITY.md'
    )

    foreach ($item in $itemsToCopy) {
        $src = Join-Path $kitRoot $item
        $dst = Join-Path $kitStage $item
        if (Test-Path -LiteralPath $src) {
            Copy-Item -LiteralPath $src -Destination $dst -Recurse -Force
        }
    }

    # Ensure afyx-graph metadata and engine scripts / release files are staged
    $graphStage = Join-Path $kitStage 'afyx-graph'
    New-Item -ItemType Directory -Path $graphStage -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $kitRoot 'afyx-graph\afyx-graph.json') -Destination (Join-Path $graphStage 'afyx-graph.json') -Force

    $engineScriptsSrc = Join-Path $kitRoot 'afyx-graph\engine\scripts'
    if (Test-Path -LiteralPath $engineScriptsSrc) {
        $engineScriptsDst = Join-Path $graphStage 'engine\scripts'
        New-Item -ItemType Directory -Path $engineScriptsDst -Force | Out-Null
        Copy-Item -Path (Join-Path $engineScriptsSrc '*') -Destination $engineScriptsDst -Recurse -Force
    }

    $engineReleaseSrc = Join-Path $kitRoot 'afyx-graph\engine\release'
    $engineReleaseDst = Join-Path $graphStage 'engine\release'
    New-Item -ItemType Directory -Path $engineReleaseDst -Force | Out-Null

    # If engine release cache exists locally, copy it; else download from afyx-dev-snapshot
    $winZip = Join-Path $engineReleaseSrc 'afyx-graph-win32-x64.zip'
    if (Test-Path -LiteralPath $winZip -PathType Leaf) {
        Copy-Item -Path (Join-Path $engineReleaseSrc '*') -Destination $engineReleaseDst -Force
    } else {
        Write-Host "Fetching verified release cache from afyx-dev-snapshot..."
        $tag = 'afyx-dev-snapshot'
        $repoBase = 'https://github.com/a5zero7/afyx-engineering-kit'
        Invoke-WebRequest -UseBasicParsing -Uri "$repoBase/releases/download/$tag/RELEASE-MANIFEST.json" -OutFile (Join-Path $engineReleaseDst 'RELEASE-MANIFEST.json')
        Invoke-WebRequest -UseBasicParsing -Uri "$repoBase/releases/download/$tag/SHA256SUMS" -OutFile (Join-Path $engineReleaseDst 'SHA256SUMS')
        Invoke-WebRequest -UseBasicParsing -Uri "$repoBase/releases/download/$tag/afyx-graph-win32-x64.zip" -OutFile (Join-Path $engineReleaseDst 'afyx-graph-win32-x64.zip')
    }

    # Write .afyx-source-revision stamped with exact revision
    Set-Content -LiteralPath (Join-Path $kitStage '.afyx-source-revision') -Value "$Revision`n" -Encoding utf8

    $outZipPath = Join-Path $OutputDir $zipName
    if (Test-Path -LiteralPath $outZipPath) { Remove-Item -LiteralPath $outZipPath -Force }

    Write-Host "Compressing to $outZipPath..."
    Compress-Archive -Path (Join-Path $kitStage '*') -DestinationPath $outZipPath -Force

    $sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $outZipPath).Hash.ToLowerInvariant()
    Write-Host "Created Release ZIP: $outZipPath"
    Write-Host "SHA-256: $sha256"

    return [pscustomobject]@{
        Path = $outZipPath
        Version = $version
        Revision = $Revision
        Sha256 = $sha256
    }
} finally {
    if (Test-Path -LiteralPath $stageDir) {
        Remove-Item -LiteralPath $stageDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}
