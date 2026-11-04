$ErrorActionPreference = 'Stop'
$testRoot = Join-Path $env:TEMP ("afyx-forge-lifecycle-" + [guid]::NewGuid().ToString('N'))

try {
    Write-Host "1. Testing clean install to $testRoot..."
    & "$PSScriptRoot\..\install-afyx-forge.ps1" -RuntimeRoot $testRoot

    Write-Host "2. Testing verification & validation..."
    $res = & "$PSScriptRoot\..\install-afyx-forge.ps1" -RuntimeRoot $testRoot -ValidateOnly
    if ($res.State -ne 'HEALTHY') {
        throw "Expected state HEALTHY but got $($res.State)"
    }
    if (-not $res.SourceRevision -or $res.SourceRevision.Length -lt 7) {
        throw "Expected non-empty SourceRevision in validation output, got '$($res.SourceRevision)'"
    }
    if ($res.ArtifactDigest -notmatch '^[0-9a-f]{64}$') {
        throw "Expected 64-char SHA-256 ArtifactDigest, got '$($res.ArtifactDigest)'"
    }
    $identityPath = Join-Path $testRoot 'current\identity.json'
    $integrityPath = Join-Path $testRoot 'integrity.sha256'
    if (-not (Test-Path -LiteralPath $identityPath -PathType Leaf) -or -not (Test-Path -LiteralPath $integrityPath -PathType Leaf)) {
        throw "Expected current/identity.json and integrity.sha256 to exist."
    }
    Write-Host "State verified: $($res.State) (v$($res.Version), rev=$($res.SourceRevision), digest=$($res.ArtifactDigest))"

    Write-Host "3. Testing installed CLI launcher..."
    $launcher = Join-Path $testRoot 'bin\afyx-forge.cmd'
    $versionOutput = (& $launcher --version 2>&1) -join ' '
    if ($versionOutput -notmatch 'afyx-forge 0\.1\.0') {
        throw "CLI output mismatch: $versionOutput"
    }
    Write-Host "CLI launcher verified: $versionOutput"

    Write-Host "4. Testing doctor command on installed runtime..."
    $doctorOutput = (& $launcher doctor 2>&1) -join "`n"
    if ($doctorOutput -notmatch 'A8_FORMAL_CAMPAIGN') {
        throw "Doctor output mismatch: $doctorOutput"
    }
    Write-Host "Doctor command verified: A8 governance gate intact."

    Write-Host "5. Testing update reinstallation..."
    & "$PSScriptRoot\..\install-afyx-forge.ps1" -RuntimeRoot $testRoot -Update
    Write-Host "Update completed successfully."

    Write-Host "6. Testing safe uninstallation..."
    & "$PSScriptRoot\..\install-afyx-forge.ps1" -RuntimeRoot $testRoot -Uninstall
    if (Test-Path -LiteralPath $testRoot) {
        throw "Expected $testRoot to be removed after uninstall."
    }
    Write-Host "Uninstallation verified."

    Write-Host "ALL LIFECYCLE TESTS PASSED!"
} finally {
    if (Test-Path -LiteralPath $testRoot) {
        Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}

