Set-StrictMode -Version Latest

$script:MarkerName = '.afyx-install.json'

function Get-AfyxBackupRoot {
    if ($env:AFYX_BACKUP_ROOT) { return [IO.Path]::GetFullPath($env:AFYX_BACKUP_ROOT) }
    $homePath = if ($env:USERPROFILE) { $env:USERPROFILE } else { $env:HOME }
    return Join-Path (Join-Path $homePath '.afyx') 'backups'
}

function Assert-AfyxSkillTarget {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$SkillsRoot, [Parameter(Mandatory)][string]$Target)
    $rootFull = [IO.Path]::GetFullPath($SkillsRoot).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
    $targetFull = [IO.Path]::GetFullPath($Target)
    $parentFull = [IO.Path]::GetFullPath((Split-Path -Parent $targetFull)).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
    $comparison = if ($env:OS -eq 'Windows_NT') { [StringComparison]::OrdinalIgnoreCase } else { [StringComparison]::Ordinal }
    if (-not [string]::Equals($rootFull, $parentFull, $comparison) -or [string]::Equals($rootFull, $targetFull, $comparison)) {
        throw "Skill target escapes configured root: $Target"
    }
    foreach ($path in @($rootFull, $targetFull)) {
        if (Test-Path -LiteralPath $path) {
            $item = Get-Item -LiteralPath $path -Force
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "Refusing reparse-point skill path: $path" }
        }
    }
}

function Restore-AfyxInterruptedSkillTransaction {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Target)
    $old = Join-Path (Split-Path -Parent $Target) ".$((Split-Path -Leaf $Target)).afyx-old"
    if ((Test-Path -LiteralPath $old) -and -not (Test-Path -LiteralPath $Target)) {
        Move-Item -LiteralPath $old -Destination $Target -ErrorAction Stop
        Write-Warning "Recovered interrupted skill transaction: $Target"
    } elseif ((Test-Path -LiteralPath $old) -and (Test-Path -LiteralPath $Target)) {
        throw "Ambiguous interrupted skill transaction; preserve both $Target and $old for manual recovery."
    }
}

function Get-AfyxSkillDigest {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Directory, [switch]$LegacyNls)
    $root = [IO.Path]::GetFullPath($Directory).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
    $lines = @()
    $files = @(Get-ChildItem -LiteralPath $root -File -Recurse -Force | Where-Object {
        $_.Name -ne $script:MarkerName -and $_.FullName -notmatch '[\\/]\.git[\\/]'
    })
    [string[]]$paths = @($files | ForEach-Object { $_.FullName })
    # Culture sorting differs between .NET Framework/NLS and .NET/ICU. New
    # ownership digests use one stable order on both PowerShell generations.
    $comparer = [StringComparer]::OrdinalIgnoreCase
    if ($LegacyNls) {
        if ($env:OS -ne 'Windows_NT') { throw 'Legacy NLS skill digests require Windows.' }
        if (-not ('Afyx.LegacySkillPathComparer' -as [type])) {
            Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
namespace Afyx {
    public sealed class LegacySkillPathComparer : IComparer<string>, System.Collections.IComparer {
        private readonly string locale;
        public LegacySkillPathComparer(string locale) { this.locale = locale; }
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern int CompareStringEx(string locale, uint flags, string left, int leftLength,
            string right, int rightLength, IntPtr version, IntPtr reserved, IntPtr parameter);
        public int Compare(string left, string right) {
            int result = CompareStringEx(locale, 1, left, -1, right, -1, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
            if (result == 0) throw new Win32Exception(Marshal.GetLastWin32Error());
            return result - 2;
        }
        int System.Collections.IComparer.Compare(object left, object right) { return Compare((string)left, (string)right); }
    }
}
'@
        }
        $comparer = New-Object Afyx.LegacySkillPathComparer ([Globalization.CultureInfo]::CurrentCulture.Name)
    }
    [Array]::Sort($paths, $comparer)
    foreach ($file in $paths) {
        $relative = $file.Substring($root.Length).TrimStart('\', '/').Replace('\', '/')
        $lines += "$(Get-FileHash -Algorithm SHA256 -LiteralPath $file | Select-Object -ExpandProperty Hash)  ./$relative"
    }
    $bytes = [Text.Encoding]::UTF8.GetBytes(($lines -join "`n") + "`n")
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
}

function Write-AfyxSkillMarker {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Target,
        [Parameter(Mandatory)][string]$Component,
        [Parameter(Mandatory)][ValidateSet('afyx', 'upstream')][string]$Owner,
        [string]$Version = '', [string]$SourceRepository = '', [string]$SourceRevision = ''
    )
    $record = [ordered]@{
        schema = 1
        product = 'Afyx Codex Engineering Kit'
        component = $Component
        owner = $Owner
        version = $Version
        content_sha256 = if ($Owner -eq 'afyx') { Get-AfyxSkillDigest -Directory $Target } else { '' }
        source_repository = $SourceRepository
        source_revision = $SourceRevision
    }
    $marker = Join-Path $Target $script:MarkerName
    [IO.File]::WriteAllText($marker, (($record | ConvertTo-Json -Depth 3) + "`n"), (New-Object Text.UTF8Encoding($false)))
    if ($Owner -eq 'upstream' -and (Test-Path -LiteralPath (Join-Path $Target '.git'))) {
        $info = Join-Path $Target '.git\info'
        New-Item -ItemType Directory -Force -Path $info | Out-Null
        $exclude = Join-Path $info 'exclude'
        $entry = "/$script:MarkerName"
        $existing = if (Test-Path -LiteralPath $exclude) { @(Get-Content -LiteralPath $exclude) } else { @() }
        if ($entry -notin $existing) { Add-Content -LiteralPath $exclude -Value $entry -Encoding ascii }
    }
}

function Get-AfyxSkillOwnership {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Target, [Parameter(Mandatory)][string]$Component, [Parameter(Mandatory)][string]$ExpectedOwner)
    if (-not (Test-Path -LiteralPath $Target)) { return 'NOT_INSTALLED' }
    try {
        $targetItem = Get-Item -LiteralPath $Target -Force
        if (-not $targetItem.PSIsContainer -or ($targetItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return 'UNSAFE' }
        $markerPath = Join-Path $Target $script:MarkerName
        if (-not (Test-Path -LiteralPath $markerPath -PathType Leaf)) { return 'FOREIGN_UNPROVEN' }
        $marker = Get-Content -Raw -LiteralPath $markerPath -Encoding utf8 | ConvertFrom-Json -ErrorAction Stop
        $validComponent = ($marker.component -eq $Component -or $marker.component -eq ($Component -replace '^afyx-', '') -or "afyx-$($marker.component)" -eq $Component)
        if ($marker.schema -ne 1 -or $marker.product -ne 'Afyx Codex Engineering Kit' -or -not $validComponent -or $marker.owner -ne $ExpectedOwner) { return 'FOREIGN_UNPROVEN' }
        if ($ExpectedOwner -eq 'afyx') {
            if ([string]$marker.content_sha256 -notmatch '^[0-9a-f]{64}$') { return 'FOREIGN_UNPROVEN' }
            if ((Get-AfyxSkillDigest -Directory $Target) -eq $marker.content_sha256) { return 'AFYX_OWNED_UNMODIFIED' }
            # Legacy Windows PowerShell markers remain valid only when the
            # complete current file set exactly reproduces their NLS digest.
            if ($env:OS -eq 'Windows_NT' -and (Get-AfyxSkillDigest -Directory $Target -LegacyNls) -eq $marker.content_sha256) { return 'AFYX_OWNED_UNMODIFIED' }
            return 'AFYX_OWNED_MODIFIED'
        }
        if (-not (Test-Path -LiteralPath (Join-Path $Target '.git'))) { return 'FOREIGN_UNPROVEN' }
        $head = (& git -C $Target rev-parse HEAD 2>$null) -join ''
        $remote = (& git -C $Target remote get-url origin 2>$null) -join ''
        $dirty = (& git -C $Target status --porcelain 2>$null) -join ''
        if ($LASTEXITCODE -eq 0 -and $head -eq $marker.source_revision -and $remote -eq $marker.source_repository -and -not $dirty) { return 'EXTERNAL_UPSTREAM' }
        return 'FOREIGN_UNPROVEN'
    } catch { return 'FOREIGN_UNPROVEN' }
}

function Get-AfyxLegacySkillProvenance {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Target,
        [Parameter(Mandatory)][string]$Component,
        [Parameter(Mandatory)][ValidateSet('afyx', 'upstream')][string]$Owner,
        [string]$LegacyVersion = '', [string]$LegacyContentSha256 = '',
        [string]$SourceRepository = '', [string]$SourceRevision = ''
    )
    if (-not (Test-Path -LiteralPath $Target -PathType Container)) { return 'UNKNOWN' }
    if (Test-Path -LiteralPath (Join-Path $Target $script:MarkerName)) { return 'UNKNOWN' }
    try {
        $item = Get-Item -LiteralPath $Target -Force
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return 'UNKNOWN' }
        if ($Owner -eq 'afyx') {
            if ($LegacyContentSha256 -notmatch '^[0-9a-f]{64}$') { return 'UNKNOWN' }
            if ((Get-AfyxSkillDigest -Directory $Target) -eq $LegacyContentSha256 -or
                ($env:OS -eq 'Windows_NT' -and (Get-AfyxSkillDigest -Directory $Target -LegacyNls) -eq $LegacyContentSha256)) { return 'MATCH' }
            $manifest = Join-Path $Target 'SKILL.md'
            if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) { return 'UNKNOWN' }
            $content = Get-Content -Raw -LiteralPath $manifest -Encoding utf8
            $nameMatch = [regex]::Match($content, '(?m)^name:\s*["'']?([^"''\r\n]+?)["'']?\s*$')
            $versionMatch = [regex]::Match($content, '(?m)^\s*version:\s*["'']?([^"''\s]+)["'']?\s*$')
            if (-not $nameMatch.Success) { return 'UNKNOWN' }
            $expectedNames = @($Component, ($Component -replace '^afyx-', ''), "afyx-$Component")
            if ($nameMatch.Groups[1].Value.Trim() -notin $expectedNames) { return 'FOREIGN' }
            if ($versionMatch.Success -and $versionMatch.Groups[1].Value -eq $LegacyVersion) { return 'MODIFIED' }
            return 'UNKNOWN'
        }
        if (-not (Test-Path -LiteralPath (Join-Path $Target '.git'))) { return 'UNKNOWN' }
        $remote = ((& git -C $Target remote get-url origin 2>$null) -join '').Trim()
        if ($LASTEXITCODE -ne 0) { return 'UNKNOWN' }
        if ($remote -ne $SourceRepository) { return 'FOREIGN' }
        $dirty = ((& git -C $Target status --porcelain 2>$null) -join '').Trim()
        if ($LASTEXITCODE -ne 0) { return 'UNKNOWN' }
        if ($dirty) { return 'MODIFIED' }
        $head = ((& git -C $Target rev-parse HEAD 2>$null) -join '').Trim()
        if ($LASTEXITCODE -ne 0 -or $head -ne $SourceRevision) { return 'UNKNOWN' }
        return 'MATCH'
    } catch { return 'UNKNOWN' }
}

function Adopt-AfyxLegacySkill {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$SkillsRoot,
        [Parameter(Mandatory)][string]$Target,
        [Parameter(Mandatory)][string]$Component,
        [Parameter(Mandatory)][ValidateSet('afyx', 'upstream')][string]$Owner,
        [string]$Version = '', [string]$LegacyVersion = '', [string]$LegacyContentSha256 = '',
        [string]$SourceRepository = '', [string]$SourceRevision = ''
    )
    Assert-AfyxSkillTarget -SkillsRoot $SkillsRoot -Target $Target
    Restore-AfyxInterruptedSkillTransaction -Target $Target
    $current = Get-AfyxSkillOwnership -Target $Target -Component $Component -ExpectedOwner $Owner
    if ($current -in @('AFYX_OWNED_UNMODIFIED', 'EXTERNAL_UPSTREAM')) { return 'ALREADY_ADOPTED' }
    if (Test-Path -LiteralPath (Join-Path $Target $script:MarkerName)) {
        throw "Refusing to adopt $Component because ownership metadata already exists but is not valid."
    }
    $provenance = Get-AfyxLegacySkillProvenance -Target $Target -Component $Component -Owner $Owner `
        -LegacyVersion $LegacyVersion -LegacyContentSha256 $LegacyContentSha256 `
        -SourceRepository $SourceRepository -SourceRevision $SourceRevision
    if ($provenance -ne 'MATCH') { throw "Refusing to adopt $Component because legacy provenance is $provenance." }
    $backup = Backup-AfyxSkill -Component $Component -Target $Target -Protect
    if ((Get-AfyxSkillDigest -Directory $backup) -ne (Get-AfyxSkillDigest -Directory $Target)) {
        throw "$Component adoption backup verification failed."
    }
    if ($Owner -eq 'upstream' -and (Get-AfyxLegacySkillProvenance -Target $backup -Component $Component -Owner $Owner `
        -LegacyVersion $LegacyVersion -LegacyContentSha256 $LegacyContentSha256 `
        -SourceRepository $SourceRepository -SourceRevision $SourceRevision) -ne 'MATCH') {
        throw "$Component adoption backup provenance verification failed."
    }
    $exclude = Join-Path $Target '.git\info\exclude'
    $excludeEntry = "/$script:MarkerName"
    $excludeAlreadyPresent = (Test-Path -LiteralPath $exclude) -and ($excludeEntry -in @(Get-Content -LiteralPath $exclude))
    try {
        Write-AfyxSkillMarker -Target $Target -Component $Component -Owner $Owner -Version $Version `
            -SourceRepository $SourceRepository -SourceRevision $SourceRevision
        $expected = if ($Owner -eq 'afyx') { 'AFYX_OWNED_UNMODIFIED' } else { 'EXTERNAL_UPSTREAM' }
        if ((Get-AfyxSkillOwnership -Target $Target -Component $Component -ExpectedOwner $Owner) -ne $expected) {
            throw "$Component post-adoption ownership verification failed."
        }
    } catch {
        Remove-Item -LiteralPath (Join-Path $Target $script:MarkerName) -Force -ErrorAction SilentlyContinue
        if ($Owner -eq 'upstream' -and -not $excludeAlreadyPresent -and (Test-Path -LiteralPath $exclude)) {
            $remaining = @(Get-Content -LiteralPath $exclude | Where-Object { $_ -ne $excludeEntry })
            [IO.File]::WriteAllLines($exclude, $remaining, (New-Object Text.UTF8Encoding($false)))
        }
        throw
    }
    Remove-Item -LiteralPath "$backup.afyx-active" -Force -ErrorAction Stop
    return "ADOPTED backup=$backup"
}

function Assert-AfyxBackupPath {
    param([Parameter(Mandatory)][string]$Path)
    $current = [IO.Path]::GetFullPath($Path)
    while ($current) {
        $item = Get-Item -LiteralPath $current -Force -ErrorAction SilentlyContinue
        if ($null -ne $item) {
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
                throw "Refusing reparse-point backup path: $current"
            }
        }
        $parent = Split-Path -Parent $current
        if ($parent -eq $current) { break }
        $current = $parent
    }
}

# Unlike the skill ownership digest, recovery verification includes ownership
# markers, .git, hidden files and empty directories. Links are never followed.
function Get-AfyxBackupDigest {
    param([Parameter(Mandatory)][string]$Directory)
    Assert-AfyxBackupPath -Path $Directory
    $root = [IO.Path]::GetFullPath($Directory).TrimEnd('\', '/')
    if (-not (Test-Path -LiteralPath $root -PathType Container)) { throw "Backup source directory missing: $root" }
    $pending = New-Object 'System.Collections.Generic.Stack[string]'
    $pending.Push($root)
    $lines = New-Object 'System.Collections.Generic.List[string]'
    while ($pending.Count) {
        foreach ($item in @(Get-ChildItem -LiteralPath $pending.Pop() -Force -ErrorAction Stop)) {
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Refusing reparse-point backup content: $($item.FullName)" }
            $relative = $item.FullName.Substring($root.Length).TrimStart('\', '/').Replace('\', '/')
            if ($relative -match '[\r\n]') { throw 'Backup paths containing newlines are unsupported.' }
            if ($item.PSIsContainer) {
                $lines.Add("D  $relative")
                $pending.Push($item.FullName)
            } else {
                $digest = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256 -ErrorAction Stop).Hash.ToLowerInvariant()
                $lines.Add("F $digest  $relative")
            }
        }
    }
    $lines.Sort([StringComparer]::Ordinal)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes(($lines -join "`n") + "`n")))).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
}

function Backup-AfyxSkill {
    [CmdletBinding()]
    param([Parameter(Mandatory)][ValidatePattern('^[a-z0-9][a-z0-9-]*$')][string]$Component, [Parameter(Mandatory)][string]$Target, [switch]$Protect)
    $componentRoot = Join-Path (Get-AfyxBackupRoot) $Component
    Assert-AfyxBackupPath -Path $componentRoot
    New-Item -ItemType Directory -Force -Path $componentRoot -ErrorAction Stop | Out-Null
    Assert-AfyxBackupPath -Path $componentRoot
    $limit = if ($env:AFYX_BACKUP_LIMIT -match '^\d+$') { [int]$env:AFYX_BACKUP_LIMIT } else { 20 }
    if ($limit -le 0) { $limit = 20 }
    $lockPath = Join-Path $componentRoot '.afyx-backup.lock'
    try { $lock = [IO.File]::Open($lockPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None) }
    catch { throw "Backup already active or stale lock requires inspection: $lockPath" }
    try {
        $before = Get-AfyxBackupDigest -Directory $Target
        $destination = Join-Path $componentRoot "$(Get-Date -Format 'yyyyMMdd-HHmmss')-$([guid]::NewGuid().ToString('N'))"
        Copy-Item -LiteralPath $Target -Destination $destination -Recurse -Force -ErrorAction Stop
        $copied = Get-AfyxBackupDigest -Directory $destination
        if ($copied -ne $before -or (Get-AfyxBackupDigest -Directory $Target) -ne $before) {
            throw "Backup verification failed; history and incomplete copy preserved: $destination"
        }
        $receipt = "$destination.afyx-backup"
        [IO.File]::WriteAllText($receipt, "AfyxSkillBackup/v1`n$Component`n$(Split-Path -Leaf $destination)`n$copied`n", (New-Object Text.UTF8Encoding($false)))
        if ($Protect) { [IO.File]::WriteAllText("$destination.afyx-active", 'active rollback', (New-Object Text.UTF8Encoding($false))) }
        # Only completed, still-verifiable AFYX receipts count toward retention.
        # Legacy, modified, active and foreign entries are preserved separately.
        $eligible = @(foreach ($entry in @(Get-ChildItem -LiteralPath $componentRoot -Directory -Force)) {
            $candidate = $entry.FullName
            if ($entry.Name -notmatch '^\d{8}-\d{6}-[\w-]+$' -or ($null -ne (Get-Item -LiteralPath "$candidate.afyx-active" -Force -ErrorAction SilentlyContinue))) { continue }
            try {
                Assert-AfyxBackupPath -Path "$candidate.afyx-backup"
                $record = [IO.File]::ReadAllLines("$candidate.afyx-backup")
                if ($record.Count -eq 4 -and $record[0] -eq 'AfyxSkillBackup/v1' -and $record[1] -eq $Component -and
                    $record[2] -eq $entry.Name -and $record[3] -match '^[0-9a-f]{64}$' -and
                    (Get-AfyxBackupDigest -Directory $candidate) -eq $record[3]) { $entry }
            } catch { Write-Verbose "Preserving unverified backup: $candidate" }
        }) | Sort-Object Name
        # Reserve a slot for this verified transaction backup; after successful
        # unpinning it must not leave ordinary completed history over the limit.
        $toPrune = @($eligible).Count + [int][bool]$Protect - $limit
        foreach ($entry in @($eligible)) {
            if ($toPrune -le 0) { break }
            if ($entry.FullName -eq $destination) { continue }
            # Full path remains an immediate child of the validated component root.
            Assert-AfyxBackupPath -Path $entry.FullName
            Remove-Item -LiteralPath $entry.FullName -Recurse -Force -ErrorAction Stop
            Remove-Item -LiteralPath "$($entry.FullName).afyx-backup" -Force -ErrorAction Stop
            $toPrune--
        }
        return $destination
    } finally {
        $lock.Dispose()
        Remove-Item -LiteralPath $lockPath -Force -ErrorAction Stop
    }
}

function Assert-AfyxBackupPurgeRoot {
    $root = Get-AfyxBackupRoot
    Assert-AfyxBackupPath -Path $root
    $volumeRoot = [IO.Path]::GetPathRoot($root)
    if ($root.TrimEnd('\', '/') -eq $volumeRoot.TrimEnd('\', '/') -or
        ((Test-Path -LiteralPath $root) -and -not (Test-Path -LiteralPath $root -PathType Container))) {
        throw 'Refusing unsafe backup purge root.'
    }
}

function Remove-AfyxRetainedBackups {
    [CmdletBinding(SupportsShouldProcess)]
    param([Parameter(Mandatory)][ValidatePattern('^[a-z0-9][a-z0-9-]*$')][string]$Component)
    $root = Join-Path (Get-AfyxBackupRoot) $Component
    Assert-AfyxBackupPath -Path $root
    if (-not (Test-Path -LiteralPath $root -PathType Container)) { return }
    $lockPath = Join-Path $root '.afyx-backup.lock'
    $lock = $null
    if (-not $WhatIfPreference) {
        $lock = [IO.File]::Open($lockPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    } else {
        Assert-AfyxBackupPath -Path $lockPath
        if (Test-Path -LiteralPath $lockPath) { throw 'Backup lock is active; purge preview refused.' }
    }
    try {
        $verified = @(foreach ($entry in Get-ChildItem -LiteralPath $root -Directory -Force) {
            $candidate = $entry.FullName
            if ($entry.Name -notmatch '^\d{8}-\d{6}-[a-zA-Z0-9_-]+$' -or
                (Get-Item -LiteralPath "$candidate.afyx-active" -Force -ErrorAction SilentlyContinue)) { continue }
            try {
                Assert-AfyxBackupPath -Path "$candidate.afyx-backup"
                $record = [IO.File]::ReadAllLines("$candidate.afyx-backup")
                if ($record.Count -eq 4 -and $record[0] -eq 'AfyxSkillBackup/v1' -and
                    $record[1] -ceq $Component -and $record[2] -ceq $entry.Name -and
                    $record[3] -cmatch '^[0-9a-f]{64}$' -and (Get-AfyxBackupDigest -Directory $candidate) -ceq $record[3]) { $entry }
            } catch { Write-Verbose "Preserving unverified backup: $candidate" }
        })
        $verified = @($verified | Sort-Object Name -Descending)
        foreach ($entry in @($verified | Select-Object -Skip 5)) {
            $candidate = $entry.FullName
            if ($PSCmdlet.ShouldProcess($candidate, 'Purge verified AFYX skill backup')) {
                Assert-AfyxBackupPath -Path $candidate
                if (Get-Item -LiteralPath "$candidate.afyx-active" -Force -ErrorAction SilentlyContinue) {
                    throw 'Backup is active; purge refused.'
                }
                Assert-AfyxBackupPath -Path "$candidate.afyx-backup"
                $current = [IO.File]::ReadAllLines("$candidate.afyx-backup")
                if ($current.Count -ne 4 -or $current[0] -cne 'AfyxSkillBackup/v1' -or
                    $current[1] -cne $Component -or $current[2] -cne $entry.Name -or
                    (Get-AfyxBackupDigest -Directory $candidate) -cne $current[3]) {
                    throw 'Backup evidence changed; purge refused.'
                }
                Remove-Item -LiteralPath $candidate -Recurse -Force -Confirm:$false -ErrorAction Stop
                Remove-Item -LiteralPath "$candidate.afyx-backup" -Force -Confirm:$false -ErrorAction Stop
            }
        }
    } finally {
        if ($lock) {
            $lock.Dispose()
            Remove-Item -LiteralPath $lockPath -Force -Confirm:$false -ErrorAction Stop
        }
    }
}

function Install-AfyxSkillTransaction {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$SkillsRoot, [Parameter(Mandatory)][string]$Component,
        [Parameter(Mandatory)][string]$Name, [Parameter(Mandatory)][string]$Stage,
        [Parameter(Mandatory)][string]$Target, [Parameter(Mandatory)][ValidateSet('afyx', 'upstream')][string]$Owner,
        [string]$Version = '', [string]$SourceRepository = '', [string]$SourceRevision = '', [switch]$AuthorizeUnproven
    )
    Assert-AfyxSkillTarget -SkillsRoot $SkillsRoot -Target $Target
    Restore-AfyxInterruptedSkillTransaction -Target $Target
    if ((Get-Item -LiteralPath $Stage -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "$Name staging directory is a reparse point." }
    Write-AfyxSkillMarker -Target $Stage -Component $Component -Owner $Owner -Version $Version -SourceRepository $SourceRepository -SourceRevision $SourceRevision
    $state = Get-AfyxSkillOwnership -Target $Target -Component $Component -ExpectedOwner $Owner
    if ($state -eq 'AFYX_OWNED_MODIFIED' -and -not $AuthorizeUnproven) {
        throw "Refusing to replace $Target ($state) without explicit repair authorization."
    }
    if ($state -notin @('NOT_INSTALLED', 'AFYX_OWNED_UNMODIFIED', 'AFYX_OWNED_MODIFIED', 'EXTERNAL_UPSTREAM')) {
        throw "Refusing to take ownership of $Target ($state)."
    }
    if ($state -eq 'UNSAFE') { throw "Refusing unsafe skill target $Target." }
    $old = Join-Path (Split-Path -Parent $Target) ".$((Split-Path -Leaf $Target)).afyx-old"
    $backup = ''
    $hadExisting = Test-Path -LiteralPath $Target
    if ($hadExisting) { $backup = Backup-AfyxSkill -Component $Component -Target $Target -Protect; Move-Item -LiteralPath $Target -Destination $old -ErrorAction Stop }
    try {
        Move-Item -LiteralPath $Stage -Destination $Target -ErrorAction Stop
        $installed = Get-AfyxSkillOwnership -Target $Target -Component $Component -ExpectedOwner $Owner
        if ($installed -notin @('AFYX_OWNED_UNMODIFIED', 'EXTERNAL_UPSTREAM')) { throw "$Name post-install ownership verification failed." }
        if ($hadExisting) { Remove-Item -LiteralPath $old -Recurse -Force -ErrorAction Stop }
        if ($backup) { Remove-Item -LiteralPath "$backup.afyx-active" -Force -ErrorAction SilentlyContinue; Write-Verbose "Backup: $backup" }
    } catch {
        if (Test-Path -LiteralPath $Target) { Remove-Item -LiteralPath $Target -Recurse -Force -ErrorAction SilentlyContinue }
        if ($hadExisting -and (Test-Path -LiteralPath $old) -and -not (Test-Path -LiteralPath $Target)) { Move-Item -LiteralPath $old -Destination $Target -ErrorAction SilentlyContinue }
        throw
    }
}

function Remove-AfyxSkillSafely {
    [CmdletBinding(SupportsShouldProcess)]
    param([Parameter(Mandatory)][string]$SkillsRoot, [Parameter(Mandatory)][string]$Component, [Parameter(Mandatory)][string]$Target, [Parameter(Mandatory)][string]$ExpectedOwner)
    Assert-AfyxSkillTarget -SkillsRoot $SkillsRoot -Target $Target
    Restore-AfyxInterruptedSkillTransaction -Target $Target
    $state = Get-AfyxSkillOwnership -Target $Target -Component $Component -ExpectedOwner $ExpectedOwner
    if ($state -eq 'NOT_INSTALLED') { return }
    if ($state -notin @('AFYX_OWNED_UNMODIFIED', 'EXTERNAL_UPSTREAM')) { throw "Refusing to remove $Target because installed ownership is $state." }
    if ($PSCmdlet.ShouldProcess($Target, 'Back up and remove installed skill')) {
        $backup = Backup-AfyxSkill -Component $Component -Target $Target -Protect
        Remove-Item -LiteralPath $Target -Recurse -Force -ErrorAction Stop
        Remove-Item -LiteralPath "$backup.afyx-active" -Force -ErrorAction Stop
        Write-Host "Removed: $Target (backup: $backup)"
    }
}

function Migrate-AfyxLegacySkills {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string[]]$TargetRoots,
        [string]$BundledEfficientCoding,
        [string]$BundledOdooEngineering,
        [hashtable]$ExcludeComponents = @{}
    )
    $legacyPairs = @(
        @{ Legacy = 'efficient-coding'; Canonical = 'afyx-efficient-coding'; Name = 'Afyx Efficient Coding'; Source = $BundledEfficientCoding },
        @{ Legacy = 'odoo-engineering'; Canonical = 'afyx-odoo-engineering'; Name = 'Afyx Odoo Engineering'; Source = $BundledOdooEngineering }
    )
    foreach ($root in ($TargetRoots | Where-Object { $_ } | Select-Object -Unique)) {
        if (-not (Test-Path -LiteralPath $root -PathType Container)) { continue }
        foreach ($pair in $legacyPairs) {
            if ($ExcludeComponents.ContainsKey($pair.Legacy) -or $ExcludeComponents.ContainsKey($pair.Canonical)) { continue }
            $legacyPath = Join-Path $root $pair.Legacy
            $canonicalPath = Join-Path $root $pair.Canonical
            if (-not (Test-Path -LiteralPath $legacyPath -PathType Container)) { continue }

            $legacyOwnership = Get-AfyxSkillOwnership -Target $legacyPath -Component $pair.Legacy -ExpectedOwner 'afyx'
            if ($legacyOwnership -ne 'AFYX_OWNED_UNMODIFIED') {
                $contract = Get-AfyxComponentContract | Where-Object { $_.id -eq $pair.Canonical }
                $proof = Get-AfyxLegacySkillProvenance -Target $legacyPath -Component $pair.Legacy -Owner 'afyx' -LegacyVersion $contract.legacy_version -LegacyContentSha256 $contract.legacy_content_digest
                if ($proof -ne 'MATCH') {
                    Write-Host "[LEGACY-DETECTED] $($pair.Legacy) preserved; ownership not verified."
                    continue
                }
            }
            $backup = Backup-AfyxSkill -Component $pair.Canonical -Target $legacyPath -Protect
            if ($pair.Source -and (Test-Path -LiteralPath $pair.Source)) {
                $installedState = Get-AfyxSkillOwnership -Target $canonicalPath -Component $pair.Canonical -ExpectedOwner 'afyx'
                if ($installedState -ne 'AFYX_OWNED_UNMODIFIED') {
                    $stage = Join-Path $root ".$($pair.Canonical).afyx-stage-$([guid]::NewGuid().ToString('N'))"
                    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }
                    Copy-Item -LiteralPath $pair.Source -Destination $stage -Recurse -Force -ErrorAction Stop
                    try {
                        Install-AfyxSkillTransaction -SkillsRoot $root -Component $pair.Canonical -Name $pair.Name `
                            -Stage $stage -Target $canonicalPath -Owner 'afyx'
                    } finally {
                        if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }
                    }
                }
            }

            $canonicalState = Get-AfyxSkillOwnership -Target $canonicalPath -Component $pair.Canonical -ExpectedOwner 'afyx'
            if ($canonicalState -eq 'AFYX_OWNED_UNMODIFIED') {
                Remove-Item -LiteralPath $legacyPath -Recurse -Force -ErrorAction Stop
                if (Test-Path -LiteralPath "$backup.afyx-active") {
                    Remove-Item -LiteralPath "$backup.afyx-active" -Force -ErrorAction SilentlyContinue
                }
                Write-Host "[MIGRATED] $($pair.Legacy) -> $($pair.Canonical) at $root (backup: $backup)"
            } else {
                Write-Warning "Legacy migration kept $legacyPath because canonical verification was $canonicalState."
            }
        }
    }
}

Export-ModuleMember -Function Assert-AfyxSkillTarget, Restore-AfyxInterruptedSkillTransaction, Get-AfyxSkillDigest, Write-AfyxSkillMarker, Get-AfyxSkillOwnership, Get-AfyxLegacySkillProvenance, Adopt-AfyxLegacySkill, Backup-AfyxSkill, Assert-AfyxBackupPurgeRoot, Remove-AfyxRetainedBackups, Install-AfyxSkillTransaction, Remove-AfyxSkillSafely, Migrate-AfyxLegacySkills
