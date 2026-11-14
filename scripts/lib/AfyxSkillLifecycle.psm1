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
        if ($marker.schema -ne 1 -or $marker.product -ne 'Afyx Codex Engineering Kit' -or $marker.component -ne $Component -or $marker.owner -ne $ExpectedOwner) { return 'FOREIGN_UNPROVEN' }
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
            if ($nameMatch.Groups[1].Value.Trim() -ne $Component) { return 'FOREIGN' }
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
    $backup = Backup-AfyxSkill -Component $Component -Target $Target
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
    return "ADOPTED backup=$backup"
}

function Backup-AfyxSkill {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Component, [Parameter(Mandatory)][string]$Target)
    $componentRoot = Join-Path (Get-AfyxBackupRoot) $Component
    New-Item -ItemType Directory -Force -Path $componentRoot | Out-Null
    $limit = if ($env:AFYX_BACKUP_LIMIT -match '^\d+$') { [int]$env:AFYX_BACKUP_LIMIT } else { 20 }
    if ($limit -le 0) { $limit = 20 }
    $existing = @(Get-ChildItem -LiteralPath $componentRoot -Directory -Force)
    if ($existing.Count -ge $limit) {
        $eligible = @($existing | Where-Object {
            $_.Name -match '^\d{8}-\d{6}-[\w-]+$' -and
            -not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint)
        } | Sort-Object -Property CreationTime, LastWriteTime, Name)

        $toPrune = ($existing.Count - $limit) + 1
        $pruned = 0
        foreach ($oldBackup in $eligible) {
            if ($pruned -ge $toPrune) { break }
            try {
                Remove-Item -LiteralPath $oldBackup.FullName -Recurse -Force -ErrorAction Stop
                $pruned++
                Write-Verbose "Pruned historical backup: $($oldBackup.FullName)"
            } catch {
                Write-Warning "Could not prune historical backup $($oldBackup.FullName): $_"
            }
        }
    }
    $destination = Join-Path $componentRoot "$(Get-Date -Format 'yyyyMMdd-HHmmss')-$([guid]::NewGuid().ToString('N'))"
    Copy-Item -LiteralPath $Target -Destination $destination -Recurse -Force -ErrorAction Stop
    return $destination
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
    if ($hadExisting) { $backup = Backup-AfyxSkill -Component $Component -Target $Target; Move-Item -LiteralPath $Target -Destination $old -ErrorAction Stop }
    try {
        Move-Item -LiteralPath $Stage -Destination $Target -ErrorAction Stop
        $installed = Get-AfyxSkillOwnership -Target $Target -Component $Component -ExpectedOwner $Owner
        if ($installed -notin @('AFYX_OWNED_UNMODIFIED', 'EXTERNAL_UPSTREAM')) { throw "$Name post-install ownership verification failed." }
        if ($hadExisting) { Remove-Item -LiteralPath $old -Recurse -Force -ErrorAction Stop }
        if ($backup) { Write-Verbose "Backup: $backup" }
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
        $backup = Backup-AfyxSkill -Component $Component -Target $Target
        Remove-Item -LiteralPath $Target -Recurse -Force -ErrorAction Stop
        Write-Host "Removed: $Target (backup: $backup)"
    }
}

Export-ModuleMember -Function Assert-AfyxSkillTarget, Restore-AfyxInterruptedSkillTransaction, Get-AfyxSkillDigest, Write-AfyxSkillMarker, Get-AfyxSkillOwnership, Get-AfyxLegacySkillProvenance, Adopt-AfyxLegacySkill, Backup-AfyxSkill, Install-AfyxSkillTransaction, Remove-AfyxSkillSafely
