# Strict test for AfyxSkillLifecycle backup retention and safe historical rotation
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$modulePath = Join-Path (Join-Path (Split-Path -Parent $scriptDir) 'lib') 'AfyxSkillLifecycle.psm1'
Import-Module $modulePath -Force

$baseTemp = [System.IO.Path]::GetTempPath()
if (Get-Command realpath -ErrorAction SilentlyContinue) {
    $resolvedTemp = (& realpath $baseTemp 2>$null)
    if ($LASTEXITCODE -eq 0 -and $resolvedTemp) { $baseTemp = $resolvedTemp }
}
$testTemp = Join-Path $baseTemp "afyx-test-backup-rot-$([guid]::NewGuid().ToString('N'))"
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
    # Foreign entries do not count against the completed-backup limit.
    Set-Content -LiteralPath (Join-Path $fakeSkill 'iteration.txt') -Value "Iteration 13" -Encoding UTF8
    $dest13 = Backup-AfyxSkill -Component 'test-skill' -Target $fakeSkill

    if (-not (Test-Path -LiteralPath $foreignDir)) {
        throw "Foreign directory was deleted during rotation!"
    }
    if (@(Get-ChildItem -LiteralPath $componentDir -Directory).Count -ne 6) { throw 'Foreign entry incorrectly consumed retention budget.' }
    Write-Host "  -> PASS: Foreign directory untouched."

    Write-Host '[TEST 5] Default limit 20, full payload, protected/foreign/modified history...'
    $env:AFYX_BACKUP_LIMIT = $null
    New-Item -ItemType Directory -Path (Join-Path $fakeSkill '.git'), (Join-Path $fakeSkill 'empty'), (Join-Path $fakeSkill 'folder with spaces') -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $fakeSkill 'folder with spaces/café.txt'), 'unicode payload')
    Set-Content -LiteralPath (Join-Path $fakeSkill '.git/config') -Value 'git recovery data'
    Set-Content -LiteralPath (Join-Path $fakeSkill '.afyx-install.json') -Value '{"ownership":"fixture"}'
    $pinned = Backup-AfyxSkill -Component 'default-limit' -Target $fakeSkill -Protect
    $defaultRoot = Join-Path $backupRoot 'default-limit'
    $legacy = Join-Path $defaultRoot '20000101-000000-unverified'
    New-Item -ItemType Directory -Path $legacy | Out-Null
    $modified = Backup-AfyxSkill -Component 'default-limit' -Target $fakeSkill
    Set-Content -LiteralPath (Join-Path $modified '.git/config') -Value 'user modified history'
    for ($i = 1; $i -le 22; $i++) { $latest = Backup-AfyxSkill -Component 'default-limit' -Target $fakeSkill }
    if (@(Get-ChildItem -LiteralPath $defaultRoot -Directory).Count -ne 23) { throw 'Expected 20 completed + pinned + modified + legacy backups.' }
    foreach ($preserved in @($pinned, $modified, $legacy, $latest)) {
        if (-not (Test-Path -LiteralPath $preserved)) { throw "Protected backup removed: $preserved" }
    }
    if (-not (Test-Path -LiteralPath (Join-Path $latest 'empty') -PathType Container)) { throw 'Empty directory not copied.' }
    if ((Get-FileHash -LiteralPath (Join-Path $latest '.afyx-install.json')).Hash -ne (Get-FileHash -LiteralPath (Join-Path $fakeSkill '.afyx-install.json')).Hash) { throw 'Ownership marker not preserved.' }

    Write-Host '[TEST 6] Copy/read-back failures preserve history, and actual overlapping operations fail closed...'
    $module = Get-Module AfyxSkillLifecycle
    $beforeDirs = @(Get-ChildItem -LiteralPath $defaultRoot -Directory | ForEach-Object FullName)
    & $module { function script:Copy-Item { throw 'injected copy failure' } }
    $rejected = $false
    try { Backup-AfyxSkill -Component 'default-limit' -Target $fakeSkill | Out-Null } catch { $rejected = $true }
    finally { & $module { Remove-Item Function:Copy-Item } }
    if (-not $rejected) { throw 'Copy failure was not propagated.' }
    foreach ($path in $beforeDirs) { if (-not (Test-Path -LiteralPath $path)) { throw 'History pruned before failed copy.' } }
    & $module { function script:Copy-Item { param($LiteralPath, $Destination, [switch]$Recurse, [switch]$Force, $ErrorAction)
        Microsoft.PowerShell.Management\Copy-Item -LiteralPath $LiteralPath -Destination $Destination -Recurse -Force -ErrorAction Stop
        Set-Content -LiteralPath (Join-Path $Destination '.afyx-install.json') -Value 'injected corruption'
    } }
    $rejected = $false
    try { Backup-AfyxSkill -Component 'default-limit' -Target $fakeSkill | Out-Null } catch { $rejected = $true }
    finally { & $module { Remove-Item Function:Copy-Item } }
    if (-not $rejected) { throw 'Read-back corruption accepted.' }
    foreach ($path in $beforeDirs) { if (-not (Test-Path -LiteralPath $path)) { throw 'History pruned before read-back verification.' } }

    $signal = Join-Path $testTemp 'copy-active'
    $job = Start-Job -ArgumentList $modulePath, $backupRoot, $fakeSkill, $signal -ScriptBlock {
        param($modulePath, $backupRoot, $fakeSkill, $signal)
        $env:AFYX_BACKUP_ROOT = $backupRoot
        Import-Module $modulePath -Force
        $module = Get-Module AfyxSkillLifecycle
        & $module { param($signal) $script:signal = $signal; function script:Copy-Item {
            param($LiteralPath, $Destination, [switch]$Recurse, [switch]$Force, $ErrorAction)
            Set-Content -LiteralPath $script:signal -Value 'active'
            Start-Sleep -Seconds 2
            Microsoft.PowerShell.Management\Copy-Item -LiteralPath $LiteralPath -Destination $Destination -Recurse -Force -ErrorAction Stop
        } } $signal
        Backup-AfyxSkill -Component 'concurrent' -Target $fakeSkill
    }
    try {
        $deadline = [DateTime]::UtcNow.AddSeconds(20)
        while (-not (Test-Path -LiteralPath $signal) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 25 }
        if (-not (Test-Path -LiteralPath $signal)) { throw 'Concurrent fixture did not enter copy.' }
        $rejected = $false
        try { Backup-AfyxSkill -Component 'concurrent' -Target $fakeSkill | Out-Null } catch { $rejected = $true }
        if (-not $rejected) { throw 'Concurrent backup bypassed active lock.' }
        $concurrent = @(Receive-Job -Job ($job | Wait-Job -Timeout 15) -ErrorAction Stop)[-1]
        if (-not (Test-Path -LiteralPath $concurrent)) { throw 'Original concurrent backup did not complete.' }
    } finally { $job | Remove-Job -Force }

    Write-Host '[TEST 7] Reparse-point payload and ancestor rejection preserves external data...'
    $external = Join-Path $testTemp 'external'
    New-Item -ItemType Directory -Path $external | Out-Null
    Set-Content -LiteralPath (Join-Path $external 'owner-data') -Value 'preserve'
    $junction = Join-Path $fakeSkill 'linked'
    $linkType = if ($env:OS -eq 'Windows_NT') { 'Junction' } else { 'SymbolicLink' }
    New-Item -ItemType $linkType -Path $junction -Target $external | Out-Null
    try {
        $rejected = $false
        try { Backup-AfyxSkill -Component 'default-limit' -Target $fakeSkill | Out-Null } catch { $rejected = $true }
        if (-not $rejected) { throw 'Linked payload accepted.' }
        foreach ($path in $beforeDirs) { if (-not (Test-Path -LiteralPath $path)) { throw 'History changed on unsafe source.' } }
    } finally {
        if ($env:OS -eq 'Windows_NT') { [IO.Directory]::Delete($junction) }
        elseif (Test-Path -LiteralPath $junction) { Remove-Item -LiteralPath $junction -Force }
    }
    $ancestor = Join-Path $testTemp 'linked-backups'
    New-Item -ItemType $linkType -Path $ancestor -Target $backupRoot | Out-Null
    try {
        $env:AFYX_BACKUP_ROOT = Join-Path $ancestor 'nested'
        $rejected = $false
        try { Backup-AfyxSkill -Component 'test-skill' -Target $fakeSkill | Out-Null } catch { $rejected = $true }
        if (-not $rejected) { throw 'Linked ancestor accepted.' }
    } finally {
        if ($env:OS -eq 'Windows_NT') { [IO.Directory]::Delete($ancestor) }
        elseif (Test-Path -LiteralPath $ancestor) { Remove-Item -LiteralPath $ancestor -Force }
        $env:AFYX_BACKUP_ROOT = $backupRoot
    }
    if ([IO.File]::ReadAllText((Join-Path $external 'owner-data')).Trim() -ne 'preserve') { throw 'External data changed.' }

    Write-Host "`nAll AfyxSkillLifecycle backup rotation tests PASSED successfully."
} finally {
    $resolvedTemp = [IO.Path]::GetFullPath($testTemp)
    $expectedParent = [IO.Path]::GetFullPath($baseTemp).TrimEnd('\', '/')
    if ((Split-Path -Parent $resolvedTemp).TrimEnd('\', '/') -ne $expectedParent -or (Split-Path -Leaf $resolvedTemp) -notlike 'afyx-test-backup-rot-*') {
        throw "Refusing cleanup outside owned test fixture: $resolvedTemp"
    }
    Remove-Item -LiteralPath $testTemp -Recurse -Force -ErrorAction SilentlyContinue
    $env:AFYX_BACKUP_ROOT = $null
    $env:AFYX_BACKUP_LIMIT = $null
}
