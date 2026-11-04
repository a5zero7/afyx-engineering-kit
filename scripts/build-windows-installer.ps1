# Builder for Afyx Unified Windows Installer (TASK U-A02)
# Generates a single lightweight AfyxSetup.exe executable with embedded 7-component offline payload.

[CmdletBinding()]
param(
    [string]$OutputDir = (Join-Path $PSScriptRoot '..\dist'),
    [switch]$SkipPayloadBuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptRoot = $PSScriptRoot
$repoRoot = (Resolve-Path (Join-Path $scriptRoot '..')).Path
$toolsDir = Join-Path $repoRoot 'tools\windows-setup'

Write-Host "=== Afyx Unified Windows Installer Builder (TASK U-A02) ===" -ForegroundColor Cyan
Write-Host "Repo Root: $repoRoot"
Write-Host "Output Dir: $OutputDir"

if (-not (Test-Path -LiteralPath $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
}

$stagingDir = Join-Path ([System.IO.Path]::GetTempPath()) "afyx-setup-staging-$([Guid]::NewGuid().ToString('N').Substring(0, 8))"
$payloadZip = Join-Path $OutputDir 'afyx-kit-payload.zip'
$outputExe = Join-Path $OutputDir 'AfyxSetup.exe'

try {
    Write-Host "[1/4] Preparing Clean 7-Component Distribution Staging..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Path $stagingDir -Force | Out-Null

    # Root scripts
    foreach ($file in @('install.ps1', 'verify.ps1', 'update.ps1', 'uninstall.ps1')) {
        Copy-Item -LiteralPath (Join-Path $repoRoot $file) -Destination (Join-Path $stagingDir $file) -Force
    }
    $currentRevision = ((& git -C $repoRoot rev-parse HEAD 2>$null) -join '').Trim()
    if ($currentRevision -match '^[0-9a-f]{40}$') {
        Set-Content -LiteralPath (Join-Path $stagingDir '.afyx-source-revision') -Value $currentRevision -Encoding utf8
    }

    # Scripts directory
    $stagedScripts = Join-Path $stagingDir 'scripts'
    New-Item -ItemType Directory -Path $stagedScripts -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $repoRoot 'scripts\lib') -Destination $stagedScripts -Recurse -Force

    Get-ChildItem -Path (Join-Path $repoRoot 'scripts') -File | Where-Object {
        $_.Name -notin @('build-windows-installer.ps1')
    } | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $stagedScripts $_.Name) -Force
    }

    # Skills directory
    $stagedSkills = Join-Path $stagingDir 'skills'
    New-Item -ItemType Directory -Path $stagedSkills -Force | Out-Null
    # Include optional provider companions from the candidate source tree.
    # Context is introduced on a separate PR; staging must pick it up when
    # that source is integrated, without changing today's standalone default.
    foreach ($sk in @('efficient-coding', 'odoo-engineering', 'afyx-engineering-expert', 'afyx-forge', 'afyx-context')) {
        $skSrc = Join-Path $repoRoot "skills\$sk"
        if (Test-Path -LiteralPath $skSrc) {
            Copy-Item -LiteralPath $skSrc -Destination $stagedSkills -Recurse -Force
        }
    }

    # Afyx Context directory
    $stagedContext = Join-Path $stagingDir 'afyx-context'
    New-Item -ItemType Directory -Path $stagedContext -Force | Out-Null
    Copy-Item -Path (Join-Path $repoRoot 'afyx-context\*') -Destination $stagedContext -Recurse -Force

    # Afyx Forge directory
    $stagedForge = Join-Path $stagingDir 'afyx-forge'
    New-Item -ItemType Directory -Path $stagedForge -Force | Out-Null
    Copy-Item -Path (Join-Path $repoRoot 'afyx-forge\*') -Destination $stagedForge -Recurse -Force

    # Afyx Graph directory
    $stagedGraph = Join-Path $stagingDir 'afyx-graph'
    New-Item -ItemType Directory -Path $stagedGraph -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $repoRoot 'afyx-graph\afyx-graph.json') -Destination (Join-Path $stagedGraph 'afyx-graph.json') -Force

    $distJsonSrc = Join-Path $repoRoot 'afyx-graph\engine\scripts\distribution-product.json'
    $distContractSrc = Join-Path $repoRoot 'afyx-graph\engine\scripts\distribution-contract.mjs'
    if (Test-Path -LiteralPath $distJsonSrc) {
        $stagedGraphScripts = Join-Path $stagedGraph 'engine\scripts'
        New-Item -ItemType Directory -Path $stagedGraphScripts -Force | Out-Null
        Copy-Item -LiteralPath $distJsonSrc -Destination (Join-Path $stagedGraphScripts 'distribution-product.json') -Force
        if (Test-Path -LiteralPath $distContractSrc) {
            Copy-Item -LiteralPath $distContractSrc -Destination (Join-Path $stagedGraphScripts 'distribution-contract.mjs') -Force
        }
    }

    $graphReleaseZip = Join-Path $repoRoot 'afyx-graph\engine\release\afyx-graph-win32-x64.zip'
    if (-not (Test-Path -LiteralPath $graphReleaseZip)) {
        throw "Afyx Graph win32 release artifact not found at $graphReleaseZip. Run graph build first."
    }
    $stagedGraphRelease = Join-Path $stagedGraph 'engine\release'
    New-Item -ItemType Directory -Path $stagedGraphRelease -Force | Out-Null
    Copy-Item -LiteralPath $graphReleaseZip -Destination (Join-Path $stagedGraphRelease 'afyx-graph-win32-x64.zip') -Force
    $graphSums = Join-Path $repoRoot 'afyx-graph\engine\release\SHA256SUMS'
    if (Test-Path -LiteralPath $graphSums) {
        Copy-Item -LiteralPath $graphSums -Destination (Join-Path $stagedGraphRelease 'SHA256SUMS') -Force
    }

    # Tools directory
    $stagedTools = Join-Path $stagingDir 'tools'
    New-Item -ItemType Directory -Path $stagedTools -Force | Out-Null
    Get-ChildItem -Path (Join-Path $repoRoot 'tools') -Directory | Where-Object {
        $_.Name -ne 'windows-setup'
    } | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $stagedTools -Recurse -Force
    }

    Write-Host "[2/4] Compressing Clean 7-Component Staging into $payloadZip..." -ForegroundColor Yellow
    if (Test-Path -LiteralPath $payloadZip) { Remove-Item -LiteralPath $payloadZip -Force }

    # Use .NET ZipArchive for deterministic, clean compression
    [System.IO.Compression.ZipFile]::CreateFromDirectory($stagingDir, $payloadZip, [System.IO.Compression.CompressionLevel]::Optimal, $false)
    $zipLengthMB = [math]::Round(((Get-Item -LiteralPath $payloadZip).Length / 1MB), 2)
    Write-Host "-> Payload package created: $zipLengthMB MB" -ForegroundColor Green

    Write-Host "[3/4] Compiling AfyxSetup.exe via .NET C# Compiler..." -ForegroundColor Yellow
    $cscPath = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
    if (-not (Test-Path -LiteralPath $cscPath)) {
        $cscPath = (Get-Command csc.exe -ErrorAction SilentlyContinue).Source
    }
    if (-not $cscPath) { throw "C# compiler csc.exe not found on system." }

    $sourceCs = Join-Path $toolsDir 'SetupBootstrapper.cs'
    $cscArgs = @(
        '/target:exe',
        '/platform:anycpu',
        '/optimize+',
        "/out:$outputExe",
        "/resource:$payloadZip,afyx-kit-payload.zip",
        '/reference:System.IO.Compression.dll',
        '/reference:System.IO.Compression.FileSystem.dll',
        $sourceCs
    )

    & $cscPath $cscArgs
    if ($LASTEXITCODE -ne 0) { throw "csc.exe compilation failed with exit code $LASTEXITCODE" }

    $exeLengthMB = [math]::Round(((Get-Item -LiteralPath $outputExe).Length / 1MB), 2)
    Write-Host "-> Executable created: $outputExe ($exeLengthMB MB)" -ForegroundColor Green

    Write-Host "[4/4] Calculating SHA-256 Checksums & Generating Build Manifest..." -ForegroundColor Yellow
    $hash = (Get-FileHash -LiteralPath $outputExe -Algorithm SHA256).Hash.ToLowerInvariant()
    $checksumFile = Join-Path $OutputDir 'AfyxSetup.exe.sha256'
    Set-Content -LiteralPath $checksumFile -Value "$hash  AfyxSetup.exe`n" -Encoding utf8

    $sumsFile = Join-Path $OutputDir 'SHA256SUMS'
    $zipHash = (Get-FileHash -LiteralPath $payloadZip -Algorithm SHA256).Hash.ToLowerInvariant()
    $sumsContent = @"
$hash  AfyxSetup.exe
$zipHash  afyx-kit-payload.zip
"@
    Set-Content -LiteralPath $sumsFile -Value $sumsContent -Encoding utf8

    $manifestFile = Join-Path $OutputDir 'build-manifest.json'
    $buildManifest = [ordered]@{
        product_name         = "Afyx Code Engineering Kit"
        distribution_channel = "technical-alpha"
        package_name         = "AfyxSetup.exe"
        package_version      = "0.1.0-alpha.1"
        target_platform      = "win32-x64"
        source_revision      = $currentRevision
        build_timestamp      = (Get-Date).ToString('o')
        executable_size_bytes = (Get-Item -LiteralPath $outputExe).Length
        executable_sha256    = $hash
        payload_size_bytes   = (Get-Item -LiteralPath $payloadZip).Length
        payload_sha256       = $zipHash
        components           = @(
            @{ id = "efficient-coding"; name = "Afyx Efficient Coding"; type = "skill"; version = "1.2.1"; tier = "core" },
            @{ id = "odoo-engineering"; name = "Afyx Odoo Engineering"; type = "skill"; version = "1.2.0"; tier = "core" },
            @{ id = "afyx-engineering-expert"; name = "Afyx Engineering Expert"; type = "skill"; version = "0.1.1"; tier = "optional" },
            @{ id = "afyx-graph"; name = "Afyx Graph"; type = "runtime"; version = "1.0.0"; tier = "optional"; activation = "on-demand" },
            @{ id = "afyx-context"; name = "Afyx Context Engine"; type = "runtime"; version = "0.1.0"; tier = "optional"; integration_default = "OFF" },
            @{ id = "afyx-forge"; name = "Afyx Forge Core"; type = "runtime"; version = "0.1.0"; tier = "optional"; mode = "assistive-guidance-only"; a8_gate = "EVALUATION_GATED" },
            @{ id = "codex-usage-tracking"; name = "Afyx Codex Usage Tracking"; type = "toolset"; version = "1.0.0"; tier = "optional"; platform = "windows" }
        )
        governance_boundaries = @{
            forge_autonomous_execution = "FORBIDDEN"
            forge_a8_gate              = "EVALUATION_GATED (0/36 NOT_RUN)"
            context_graph_integration  = "DEFAULT_OFF"
            graph_v29_wip              = "EXCLUDED"
            code_signing               = "UNSIGNED_ALPHA_CANDIDATE"
        }
        runtime_prerequisites = @(
            "Windows 10 / Windows 11 (x64)",
            "PowerShell 7.0+ (pwsh) or Windows PowerShell 5.1",
            "Node.js >= 22.5.0 (for Graph, Context, and Forge runtimes)",
            "Git for Windows (for version control operations)"
        )
    }
    Set-Content -LiteralPath $manifestFile -Value ($buildManifest | ConvertTo-Json -Depth 10) -Encoding utf8

    Write-Host "`n=== BUILD COMPLETE ===" -ForegroundColor Green
    Write-Host "Installer Executable: $outputExe ($exeLengthMB MB)"
    Write-Host "SHA-256: $hash"
    Write-Host "Checksum file: $checksumFile"
    Write-Host "Build manifest: $manifestFile"

    return [pscustomobject]@{
        Executable = $outputExe
        SizeMB = $exeLengthMB
        SHA256 = $hash
        PayloadZip = $payloadZip
        Manifest = $manifestFile
    }
}
finally {
    if (Test-Path -LiteralPath $stagingDir) {
        Remove-Item -LiteralPath $stagingDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}
