[CmdletBinding()]
param(
    [string]$Path = (Get-Location).Path,
    [ValidateSet('json', 'text')][string]$Format = 'json',
    [switch]$AllowExec,
    [switch]$WriteCache
)

# Zero-model project context detector (read-only unless -WriteCache is passed).
# Detects project root, project type, Odoo major version with its evidence, and
# likely addon roots. Evidence priority mirrors the Odoo Engineering skill:
#   strong: odoo/release.py > odoo.egg-info/PKG-INFO > odoo-bin --version (opt-in)
#   weak:   git branch/tag > __manifest__.py versions > dependency files
# Conflicting evidence is reported, never guessed. The optional
# .afyx/project.json cache is a hint only; runtime/source evidence always wins.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$SupportedMin = 10
$SupportedMax = 20
$SkipDirectories = @('.git', 'node_modules', '.venv', 'venv', '__pycache__', '.tox', 'dist', 'build', '.afyx-graph')
$ManifestCap = 200

function Read-Text([string]$File) {
    try { return [System.IO.File]::ReadAllText($File) } catch { return '' }
}

function Test-InRange([int]$Major) { return ($Major -ge $SupportedMin -and $Major -le $SupportedMax) }

function Find-Root([string]$Start) {
    # Nearest ancestor (including the start directory) carrying a root marker wins.
    $current = (Resolve-Path -LiteralPath $Start).Path
    $cursor = $current
    while ($cursor) {
        if (Test-Path -LiteralPath (Join-Path $cursor '.git')) { return @{ Root = $cursor; Evidence = '.git' } }
        if ((Test-Path -LiteralPath (Join-Path $cursor 'odoo\release.py')) -or (Test-Path -LiteralPath (Join-Path $cursor 'odoo-bin'))) {
            return @{ Root = $cursor; Evidence = 'odoo-source' }
        }
        $parent = Split-Path -Parent $cursor
        if (-not $parent -or $parent -eq $cursor) { break }
        $cursor = $parent
    }
    return @{ Root = $current; Evidence = 'start-directory' }
}

function Get-Manifests([string]$Root) {
    $found = New-Object System.Collections.Generic.List[object]
    $stack = New-Object System.Collections.Generic.Stack[object]
    $stack.Push(@($Root, 0, ''))
    while ($stack.Count -gt 0 -and $found.Count -lt $ManifestCap) {
        $item = $stack.Pop(); $directory = $item[0]; $depth = $item[1]; $relativeDirectory = $item[2]
        $manifest = Join-Path $directory '__manifest__.py'
        if (Test-Path -LiteralPath $manifest -PathType Leaf) {
            $found.Add([pscustomobject]@{ Path = $manifest; RelativeDirectory = $relativeDirectory })
        }
        if ($depth -ge 4) { continue }
        foreach ($child in (Get-ChildItem -LiteralPath $directory -Directory -Force -ErrorAction SilentlyContinue | Sort-Object Name)) {
            if ($SkipDirectories -contains $child.Name) { continue }
            $childRelative = if ($relativeDirectory) { Join-Path $relativeDirectory $child.Name } else { $child.Name }
            $stack.Push(@($child.FullName, ($depth + 1), $childRelative))
        }
    }
    return $found
}

$located = Find-Root $Path
$root = $located.Root
$evidence = New-Object System.Collections.Generic.List[object]

# 1. odoo/release.py (strong)
$releaseFile = Join-Path $root 'odoo\release.py'
if (Test-Path -LiteralPath $releaseFile -PathType Leaf) {
    $match = [regex]::Match((Read-Text $releaseFile), "version_info\s*=\s*\(\s*['""]?(?:saas~)?(\d+)")
    if ($match.Success) { $evidence.Add([ordered]@{ source = 'odoo/release.py'; strength = 'strong'; major = [int]$match.Groups[1].Value; count = 1; priority = 1 }) }
}
# 2. release metadata (strong)
$pkgInfo = Join-Path $root 'odoo.egg-info\PKG-INFO'
if (Test-Path -LiteralPath $pkgInfo -PathType Leaf) {
    $match = [regex]::Match((Read-Text $pkgInfo), '(?m)^Version:\s*(\d+)\.')
    if ($match.Success) { $evidence.Add([ordered]@{ source = 'odoo.egg-info/PKG-INFO'; strength = 'strong'; major = [int]$match.Groups[1].Value; count = 1; priority = 2 }) }
}
# 3. odoo-bin --version (strong, executes project code: opt-in only)
$odooBin = Join-Path $root 'odoo-bin'
if ($AllowExec -and (Test-Path -LiteralPath $odooBin -PathType Leaf)) {
    $python = Get-Command python -ErrorAction SilentlyContinue
    if (-not $python) { $python = Get-Command python3 -ErrorAction SilentlyContinue }
    if ($python) {
        try {
            $output = (& $python.Source $odooBin --version 2>$null) -join ' '
            $match = [regex]::Match($output, 'Odoo Server\s+(?:saas~)?(\d+)')
            if ($match.Success) { $evidence.Add([ordered]@{ source = 'odoo-bin --version'; strength = 'strong'; major = [int]$match.Groups[1].Value; count = 1; priority = 3 }) }
        } catch { }
    }
}
# 4. git branch / tag (weak)
if ($located.Evidence -eq '.git' -and (Get-Command git -ErrorAction SilentlyContinue)) {
    $pattern = '(?<![0-9.])(1[0-9]|20)\.0(?![0-9])'
    $branch = (& git -C $root symbolic-ref --short -q HEAD 2>$null) -join ''
    $match = [regex]::Match($branch, $pattern)
    if ($match.Success) { $evidence.Add([ordered]@{ source = 'git branch'; strength = 'weak'; major = [int]$match.Groups[1].Value; count = 1; priority = 4 }) }
    else {
        $tag = (& git -C $root describe --tags --abbrev=0 2>$null) -join ''
        $match = [regex]::Match($tag, $pattern)
        if ($match.Success) { $evidence.Add([ordered]@{ source = 'git tag'; strength = 'weak'; major = [int]$match.Groups[1].Value; count = 1; priority = 4 }) }
    }
}
$global:LASTEXITCODE = 0   # `git describe` legitimately fails when there are no tags
# 5. __manifest__.py module versions (weak) and addon roots
$manifests = @(Get-Manifests $root)
$manifestMajors = @{}
$addonRoots = New-Object System.Collections.Generic.SortedSet[string] ([System.StringComparer]::Ordinal)
foreach ($manifest in $manifests) {
    $relativeContainer = [IO.Path]::GetDirectoryName([string]$manifest.RelativeDirectory)
    [void]$addonRoots.Add($(if ($relativeContainer) { $relativeContainer -replace '\\', '/' } else { '.' }))
    $match = [regex]::Match((Read-Text $manifest.Path), "['""]version['""]\s*:\s*['""](\d{2})\.0\.\d+\.\d+\.\d+['""]")
    if ($match.Success -and (Test-InRange ([int]$match.Groups[1].Value))) {
        $major = [int]$match.Groups[1].Value
        $manifestMajors[$major] = 1 + $(if ($manifestMajors.ContainsKey($major)) { $manifestMajors[$major] } else { 0 })
    }
}
foreach ($major in ($manifestMajors.Keys | Sort-Object)) {
    $evidence.Add([ordered]@{ source = '__manifest__.py'; strength = 'weak'; major = [int]$major; count = [int]$manifestMajors[$major]; priority = 5 })
}
# 6. dependency files (weak)
foreach ($name in @('requirements.txt', 'pyproject.toml', 'Dockerfile', 'docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml')) {
    $file = Join-Path $root $name
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { continue }
    $text = Read-Text $file
    $majors = @{}
    foreach ($pattern in @('(?im)^\s*odoo\s*(?:==|~=|>=)\s*(\d{2})\.0', '(?i)image:\s*[''"]?odoo:(\d{2})(?:\.0)?', '(?im)^\s*FROM\s+odoo:(\d{2})', '(?i)\bodoo(?:/odoo)?(?:\.git)?@(\d{2})\.0')) {
        foreach ($m in [regex]::Matches($text, $pattern)) { $majors[[int]$m.Groups[1].Value] = 1 }
    }
    foreach ($major in ($majors.Keys | Sort-Object)) {
        if (Test-InRange $major) { $evidence.Add([ordered]@{ source = $name; strength = 'weak'; major = [int]$major; count = 1; priority = 6 }) }
    }
}

# Resolve
$strong = @($evidence | Where-Object { $_.strength -eq 'strong' } | ForEach-Object { $_.major } | Sort-Object -Unique)
$weak = @($evidence | Where-Object { $_.strength -eq 'weak' } | ForEach-Object { $_.major } | Sort-Object -Unique)
$resolved = $null; $status = 'unknown'
if ($strong.Count -eq 1) { $resolved = [int]$strong[0]; $status = 'proven' }
elseif ($strong.Count -gt 1) { $status = 'conflict' }
elseif ($weak.Count -eq 1) { $resolved = [int]$weak[0]; $status = 'inferred' }
elseif ($weak.Count -gt 1) { $status = 'conflict' }
if ($null -ne $resolved -and -not (Test-InRange $resolved)) { $status = 'unsupported' }
$conflicts = @()
if ($status -eq 'proven') { $conflicts = @($evidence | Where-Object { $_.strength -eq 'weak' -and $_.major -ne $resolved } | ForEach-Object { [ordered]@{ source = $_.source; major = $_.major } }) }
$odooDetected = ($evidence.Count -gt 0) -or ($manifests.Count -gt 0) -or (Test-Path -LiteralPath $odooBin -PathType Leaf) -or (Test-Path -LiteralPath $releaseFile -PathType Leaf)

$projectType = 'unknown'
if ($odooDetected) { $projectType = 'odoo' }
elseif ((Test-Path -LiteralPath (Join-Path $root 'pyproject.toml')) -or (Test-Path -LiteralPath (Join-Path $root 'setup.py')) -or (Test-Path -LiteralPath (Join-Path $root 'requirements.txt'))) { $projectType = 'python' }
elseif (Test-Path -LiteralPath (Join-Path $root 'package.json')) { $projectType = 'node' }

# Optional cache (hint only)
$cachePath = Join-Path $root '.afyx\project.json'
$cachePresent = Test-Path -LiteralPath $cachePath -PathType Leaf
$hint = $null; $agrees = $null
if ($cachePresent) {
    try {
        $cache = Get-Content -Raw -LiteralPath $cachePath -Encoding utf8 | ConvertFrom-Json
        $property = $cache.PSObject.Properties['odoo_major']
        if ($property) { $hint = [int]$property.Value }
    } catch { }
    if ($null -ne $hint -and $null -ne $resolved) { $agrees = ($hint -eq $resolved) }
}

$sortedEvidence = @($evidence | Sort-Object { $_.priority }, { $_.source }, { $_.major } | ForEach-Object { [ordered]@{ source = $_.source; strength = $_.strength; major = $_.major; count = $_.count } })
$result = [ordered]@{
    schema_version = 1
    project_root   = $root
    root_evidence  = $located.Evidence
    project_type   = $projectType
    odoo           = [ordered]@{
        detected        = [bool]$odooDetected
        supported_range = "$SupportedMin-$SupportedMax"
        major_version   = $resolved
        version_status  = $status
        evidence        = $sortedEvidence
        conflicts       = @($conflicts)
        addon_roots     = @($addonRoots | Select-Object -First 20)
    }
    cache          = [ordered]@{ path = '.afyx/project.json'; present = [bool]$cachePresent; hint_major = $hint; agrees = $agrees }
}

if ($WriteCache) {
    $cacheDirectory = Split-Path -Parent $cachePath
    New-Item -ItemType Directory -Force -Path $cacheDirectory | Out-Null
    $hintDocument = [ordered]@{ note = 'Hint only. Source and runtime evidence always win.'; odoo_major = $resolved; version_status = $status }
    Set-Content -LiteralPath $cachePath -Value ($hintDocument | ConvertTo-Json) -Encoding utf8
}

if ($Format -eq 'json') { $result | ConvertTo-Json -Depth 8; return }

Write-Output "Project root: $root ($($located.Evidence))"
Write-Output "Project type: $projectType"
if ($odooDetected) {
    $versionText = if ($null -ne $resolved) { "version $resolved ($status)" } else { "version $status" }
    Write-Output "Odoo: detected; $versionText"
    foreach ($item in $sortedEvidence) { Write-Output "  evidence: $($item.source) = $($item.major) [$($item.strength)]" }
    foreach ($item in $conflicts) { Write-Output "  conflict: $($item.source) = $($item.major)" }
    if ($addonRoots.Count -gt 0) { Write-Output "  addon roots: $(@($addonRoots | Select-Object -First 20) -join ', ')" }
} else { Write-Output 'Odoo: not detected' }
