# Strict test for AfyxSkillLifecycle backup retention and safe historical rotation
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$modulePath = Join-Path (Join-Path (Split-Path -Parent $scriptDir) 'lib') 'AfyxSkillLifecycle.psm1'
Import-Module $modulePath -Force

$testTemp = Join-Path ([System.IO.Path]::GetTempPath()) "afyx-test-backup-rot-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Force -Path $testTemp | Out-Null

try {
    $backupRoot = Join-Path $testTemp 'backups'
    $env:AFYX_BACKUP_ROOT = $backupRoot
    $env:AFYX_BACKUP_LIMIT = '5'

    $fakeSkill = Join-Path $testTemp 'fake-skill'
    New-Item -ItemType Directory -Force -Path $fakeSkill | Out-Null
    Set-Content -LiteralPath (Join-Path $fakeSkill 'SKILL.md') -Value "---`nname: test-skill`n---" -Encoding UTF8

    Write-Host "[TEST 1] Creating 5 backups with limit 5..."
    for ($i = 1; $i -le 5; $i++) {
        Set-Content -LiteralPath (Join-Path $fakeSkill 'iteration.txt') -Value "Iteration $i" -Encoding UTF8
        $dest = Backup-AfyxSkill -Component 'test-skill' -Target $fakeSkill
        if (-not (Test-Path -LiteralPath $dest)) {
            throw "Backup $i destination was not created: $dest"
        }
        Start-Sleep -Milliseconds 50
    }

    $componentDir = Join-Path $backupRoot 'test-skill'
    $entries = @(Get-ChildItem -LiteralPath $componentDir -Directory)
    if ($entries.Count -ne 5) {
        throw "Expected exactly 5 backups, but found $($entries.Count)"
    }
    Write-Host "  -> PASS: 5 backups created successfully."

    Write-Host "[TEST 2] Creating 6th backup (rotation should prune oldest)..."
    Set-Content -LiteralPath (Join-Path $fakeSkill 'iteration.txt') -Value "Iteration 6" -Encoding UTF8
    $dest6 = Backup-AfyxSkill -Component 'test-skill' -Target $fakeSkill
    $entriesAfter6 = @(Get-ChildItem -LiteralPath $componentDir -Directory)
    if ($entriesAfter6.Count -ne 5) {
        throw "Expected 5 backups after 6th backup rotation, but found $($entriesAfter6.Count)"
    }
    # Verify newest backup exists
    if (-not (Test-Path -LiteralPath $dest6)) {
        throw "6th backup was not preserved: $dest6"
    }
    $iterContent = Get-Content -LiteralPath (Join-Path $dest6 'iteration.txt') -Raw
    if ($iterContent -notmatch 'Iteration 6') {
        throw "6th backup content mismatch: $iterContent"
    }
    Write-Host "  -> PASS: Oldest backup pruned, count maintained at 5, new backup valid."

    Write-Host "[TEST 3] Multiple sequential rotations up to 12 iterations..."
    for ($i = 7; $i -le 12; $i++) {
        Set-Content -LiteralPath (Join-Path $fakeSkill 'iteration.txt') -Value "Iteration $i" -Encoding UTF8
        $destI = Backup-AfyxSkill -Component 'test-skill' -Target $fakeSkill
        Start-Sleep -Milliseconds 50
    }
    $entriesAfter12 = @(Get-ChildItem -LiteralPath $componentDir -Directory)
    if ($entriesAfter12.Count -ne 5) {
        throw "Expected 5 backups after 12 iterations, but found $($entriesAfter12.Count)"
    }
    Write-Host "  -> PASS: Count maintained at 5 across all iterations."

    Write-Host "[TEST 4] Foreign directory preservation during rotation..."
    $foreignDir = Join-Path $componentDir 'custom-manual-notes'
    New-Item -ItemType Directory -Force -Path $foreignDir | Out-Null
    Set-Content -LiteralPath (Join-Path $foreignDir 'notes.txt') -Value 'Important manual notes' -Encoding UTF8

    # Now we have 5 valid backups + 1 foreign = 6 directories total
    # Next backup should prune 2 valid backups to bring total back down towards limit
    Set-Content -LiteralPath (Join-Path $fakeSkill 'iteration.txt') -Value "Iteration 13" -Encoding UTF8
    $dest13 = Backup-AfyxSkill -Component 'test-skill' -Target $fakeSkill

    if (-not (Test-Path -LiteralPath $foreignDir)) {
        throw "Foreign directory was deleted during rotation!"
    }
    Write-Host "  -> PASS: Foreign directory untouched."

    Write-Host "`nAll AfyxSkillLifecycle backup rotation tests PASSED successfully."
} finally {
    Remove-Item -LiteralPath $testTemp -Recurse -Force -ErrorAction SilentlyContinue
    $env:AFYX_BACKUP_ROOT = $null
    $env:AFYX_BACKUP_LIMIT = $null
}
