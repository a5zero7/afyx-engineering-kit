[CmdletBinding()]
param(
    [string]$CodexHome = $(if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }),
    [string]$SessionRoot,
    [string]$PricingPath = (Join-Path $PSScriptRoot 'codex-usage-pricing.json'),
    [string]$LatestUsagePath,
    [ValidateRange(100, 60000)] [int]$PollMilliseconds = 750,
    [ValidateRange(0, 100)] [int]$ReplayLatestCompletedTurns = 0,
    [ValidateRange(0, 100)] [int]$ExitAfterCompletions = 0,
    [switch]$NoSnapshot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

Import-Module (Join-Path $PSScriptRoot 'CodexUsage.psm1') -Force
$pricing = Import-CodexPricing -Path $PricingPath

if (-not $SessionRoot) { $SessionRoot = Join-Path $CodexHome 'sessions' }
if (-not $LatestUsagePath) { $LatestUsagePath = Join-Path $CodexHome 'tools\codex-usage-latest.json' }

function Find-LatestRollout {
    if (-not (Test-Path -LiteralPath $SessionRoot -PathType Container)) { return $null }
    return Get-ChildItem -LiteralPath $SessionRoot -Recurse -Filter 'rollout-*.jsonl' -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTimeUtc -Descending |
        Select-Object -First 1
}

function Read-AppendedTelemetry {
    param([Parameter(Mandatory)] [hashtable]$Tracker)

    $stream = [IO.File]::Open(
        $Tracker.Path,
        [IO.FileMode]::Open,
        [IO.FileAccess]::Read,
        [IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete
    )
    try {
        if ($stream.Length -lt [long]$Tracker.Offset) {
            return [pscustomobject]@{ Truncated = $true; Lines = @() }
        }

        $remaining = $stream.Length - [long]$Tracker.Offset
        if ($remaining -eq 0) {
            return [pscustomobject]@{ Truncated = $false; Lines = @() }
        }
        if ($remaining -gt [int]::MaxValue) {
            throw "Telemetry append is too large to process safely: $remaining bytes"
        }

        [void]$stream.Seek([long]$Tracker.Offset, [IO.SeekOrigin]::Begin)
        $bytes = [byte[]]::new([int]$remaining)
        $read = 0
        while ($read -lt $bytes.Length) {
            $count = $stream.Read($bytes, $read, $bytes.Length - $read)
            if ($count -eq 0) { break }
            $read += $count
        }
        $Tracker.Offset += $read
        if ($read -eq 0) {
            return [pscustomobject]@{ Truncated = $false; Lines = @() }
        }

        $text = $Tracker.Buffer + [Text.Encoding]::UTF8.GetString($bytes, 0, $read)
        $parts = [regex]::Split($text, "`n")
        if ($text.EndsWith("`n", [StringComparison]::Ordinal)) {
            $Tracker.Buffer = ''
            $complete = if ($parts.Count -gt 1) { $parts[0..($parts.Count - 2)] } else { @() }
        } else {
            $Tracker.Buffer = $parts[-1]
            $complete = if ($parts.Count -gt 1) { $parts[0..($parts.Count - 2)] } else { @() }
        }
        return [pscustomobject]@{
            Truncated = $false
            Lines = @($complete | ForEach-Object { $_.TrimEnd("`r") })
        }
    } finally {
        $stream.Dispose()
    }
}

function Process-TelemetryLines {
    param(
        [Parameter(Mandatory)] [hashtable]$Tracker,
        [Parameter(Mandatory)] [AllowEmptyCollection()] [string[]]$Lines
    )

    $completions = [System.Collections.Generic.List[object]]::new()
    foreach ($line in $Lines) {
        $event = ConvertFrom-CodexTelemetryLine -Line $line
        if ($null -eq $event) { continue }
        $completion = Update-CodexUsageState -State $Tracker.Parser -Event $event -Pricing $pricing -SessionFile $Tracker.Path
        if ($null -ne $completion) { $completions.Add($completion) }
    }
    return $completions.ToArray()
}

function Initialize-RolloutTracker {
    param([Parameter(Mandatory)] [string]$Path)

    $tracker = @{
        Path = [IO.Path]::GetFullPath($Path)
        Offset = [long]0
        Buffer = ''
        Parser = New-CodexUsageParserState
    }
    $batch = Read-AppendedTelemetry -Tracker $tracker
    $completions = Process-TelemetryLines -Tracker $tracker -Lines $batch.Lines
    return [pscustomobject]@{ Tracker = $tracker; Completions = @($completions) }
}

function Write-LatestUsageSnapshot {
    param([Parameter(Mandatory)] [object]$Completion)

    if ($NoSnapshot) { return }

    $parent = Split-Path -Parent $LatestUsagePath
    if ($parent) { [IO.Directory]::CreateDirectory($parent) | Out-Null }
    $snapshot = [ordered]@{
        schema_version = 1
        completed_at = $Completion.CompletedAt
        model = $Completion.Model
        input_tokens = $Completion.InputTokens
        cached_input_tokens = $Completion.CachedInputTokens
        cache_write_input_tokens = $Completion.CacheWriteInputTokens
        uncached_input_tokens = $Completion.UncachedInputTokens
        output_tokens = $Completion.OutputTokens
        reasoning_tokens = if ($Completion.ReasoningAvailable) { $Completion.ReasoningTokens } else { $null }
        total_tokens = $Completion.TotalTokens
        api_equivalent_currency = if ($Completion.ApiEquivalentAvailable) { $pricing.currency } else { $null }
        api_equivalent_cost = if ($Completion.ApiEquivalentAvailable) { $Completion.ApiEquivalentCost } else { $null }
        usage_source = $Completion.UsageSource
        session_file = $Completion.SessionFile
    }
    $json = $snapshot | ConvertTo-Json -Depth 5
    $temporary = "$LatestUsagePath.tmp-$PID"
    [IO.File]::WriteAllText($temporary, $json, [Text.UTF8Encoding]::new($false))
    Move-Item -Force -LiteralPath $temporary -Destination $LatestUsagePath
}

function Show-Completion {
    param([Parameter(Mandatory)] [object]$Completion)

    Format-CodexUsageSummary -Completion $Completion | ForEach-Object { Write-Host $_ }
    Write-LatestUsageSnapshot -Completion $Completion
}

$latest = Find-LatestRollout
if ($null -eq $latest) {
    throw "No Codex rollout files found under $SessionRoot"
}

$initial = Initialize-RolloutTracker -Path $latest.FullName
if ($ReplayLatestCompletedTurns -gt 0) {
    $selected = @($initial.Completions | Select-Object -Last $ReplayLatestCompletedTurns)
    foreach ($completion in $selected) { Show-Completion $completion }
    if ($selected.Count -eq 0) {
        Write-Host 'No completed Codex turns found in the latest rollout file.'
    }
    exit 0
}

$trackers = @{}
$trackers[$initial.Tracker.Path] = $initial.Tracker
$activePath = $initial.Tracker.Path
$emitted = 0
$watcherStartedUtc = [DateTime]::UtcNow
$lastFallbackDiscovery = [DateTime]::UtcNow

$fileWatcher = [IO.FileSystemWatcher]::new($SessionRoot, '*')
$fileWatcher.IncludeSubdirectories = $true
$fileWatcher.NotifyFilter = [IO.NotifyFilters]::FileName -bor [IO.NotifyFilters]::DirectoryName -bor [IO.NotifyFilters]::LastWrite -bor [IO.NotifyFilters]::Size
$fileWatcher.EnableRaisingEvents = $true

Write-Host "Codex usage watcher ready. Monitoring $SessionRoot"
Write-Host 'Only token metadata, model, timestamps, and turn boundaries are processed.'

try {
    while ($true) {
        $change = $fileWatcher.WaitForChanged(
            [IO.WatcherChangeTypes]::Changed -bor [IO.WatcherChangeTypes]::Created -bor [IO.WatcherChangeTypes]::Renamed,
            $PollMilliseconds
        )

        $pathsToRead = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
        $newFileCompletions = [System.Collections.Generic.List[object]]::new()
        $discoverLatest = $false
        if (-not $change.TimedOut -and $change.Name) {
            $candidate = [IO.Path]::GetFullPath((Join-Path $SessionRoot $change.Name))
            if ((Split-Path -Leaf $candidate) -like 'rollout-*.jsonl' -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
                if (-not $trackers.ContainsKey($candidate)) {
                    $created = Initialize-RolloutTracker -Path $candidate
                    $trackers[$candidate] = $created.Tracker
                    if ((Get-Item -LiteralPath $candidate).CreationTimeUtc -ge $watcherStartedUtc.AddSeconds(-1)) {
                        foreach ($completion in $created.Completions) { $newFileCompletions.Add($completion) }
                    }
                }
                $activePath = $candidate
                [void]$pathsToRead.Add($candidate)
            } else {
                $discoverLatest = $true
            }
        }

        [void]$pathsToRead.Add($activePath)
        if ($discoverLatest -or ([DateTime]::UtcNow - $lastFallbackDiscovery).TotalSeconds -ge 2) {
            $fallback = Find-LatestRollout
            $lastFallbackDiscovery = [DateTime]::UtcNow
            if ($null -ne $fallback) {
                $fallbackPath = [IO.Path]::GetFullPath($fallback.FullName)
                if (-not $trackers.ContainsKey($fallbackPath)) {
                    $created = Initialize-RolloutTracker -Path $fallbackPath
                    $trackers[$fallbackPath] = $created.Tracker
                    if ($fallback.CreationTimeUtc -ge $watcherStartedUtc.AddSeconds(-1)) {
                        foreach ($completion in $created.Completions) { $newFileCompletions.Add($completion) }
                    }
                }
                $activePath = $fallbackPath
                [void]$pathsToRead.Add($fallbackPath)
            }
        }

        foreach ($completion in $newFileCompletions) {
            Show-Completion $completion
            $emitted++
            if ($ExitAfterCompletions -gt 0 -and $emitted -ge $ExitAfterCompletions) { return }
        }

        foreach ($path in $pathsToRead) {
            if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { continue }
            $tracker = $trackers[$path]
            $batch = Read-AppendedTelemetry -Tracker $tracker
            if ($batch.Truncated) {
                Write-Warning "Telemetry file was truncated or recreated; rebuilding baseline for $(Split-Path -Leaf $path)."
                $rebuilt = Initialize-RolloutTracker -Path $path
                $trackers[$path] = $rebuilt.Tracker
                continue
            }
            $completions = @(Process-TelemetryLines -Tracker $tracker -Lines $batch.Lines)
            foreach ($completion in $completions) {
                Show-Completion $completion
                $emitted++
                if ($ExitAfterCompletions -gt 0 -and $emitted -ge $ExitAfterCompletions) { return }
            }
        }
    }
} finally {
    $fileWatcher.Dispose()
}
