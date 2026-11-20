[CmdletBinding()]
param(
    [string]$CodexHome = $(if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }),
    [string]$HooksPath,
    [string]$SessionRoot,
    [string]$PricingPath = (Join-Path $PSScriptRoot 'codex-usage-pricing.json'),
    [ValidateRange(1, 99)] [int]$PowerShellMajor = $PSVersionTable.PSVersion.Major
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $HooksPath) { $HooksPath = Join-Path $CodexHome 'hooks.json' }
if (-not $SessionRoot) { $SessionRoot = Join-Path $CodexHome 'sessions' }

$failures = [System.Collections.Generic.List[string]]::new()
function Write-Check {
    param([bool]$Ok, [string]$Name, [string]$Detail)
    $state = if ($Ok) { 'OK' } else { 'FAIL' }
    $suffix = if ($Detail) { " — $Detail" } else { '' }
    Write-Host "[$state] $Name$suffix"
    if (-not $Ok) { $script:failures.Add($Name) }
}

Write-Host 'Afyx Codex Usage Doctor'
Write-Host ''
$powerShellOk = $PowerShellMajor -ge 7
Write-Check $powerShellOk 'PowerShell 7+' $(if ($powerShellOk) { "$($PSVersionTable.PSVersion)" } else { 'Usage Tracker requires PowerShell 7+; Windows PowerShell 5.1 is unsupported' })
if (-not $powerShellOk) {
    Write-Host ''
    Write-Host 'Hook display path: UNKNOWN'
    Write-Host 'NOT READY'
    exit 1
}

$requiredFiles = @(
    'CodexUsage.psm1',
    'codex-usage-stop.ps1',
    'codex-usage-watch.ps1',
    'codex-usage-pricing.json',
    'codex-usage-doctor.ps1'
)
$missingFiles = @($requiredFiles | Where-Object { -not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $_) -PathType Leaf) })
Write-Check ($missingFiles.Count -eq 0) 'Tracker runtime files' $(if ($missingFiles.Count) { 'missing: ' + ($missingFiles -join ', ') } else { 'complete' })

$hooksDocument = $null
$hooksJsonOk = $false
if (Test-Path -LiteralPath $HooksPath -PathType Leaf) {
    try {
        $hooksDocument = Get-Content -Raw -LiteralPath $HooksPath | ConvertFrom-Json -Depth 50 -ErrorAction Stop
        $hooksJsonOk = $true
    } catch { }
}
Write-Check $hooksJsonOk 'Hooks JSON' $(if ($hooksJsonOk) { 'parseable' } else { 'missing or invalid' })

$expectedStopPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'codex-usage-stop.ps1'))
$afyxHandler = $null
if ($hooksJsonOk -and $hooksDocument.PSObject.Properties['hooks'] -and $hooksDocument.hooks.PSObject.Properties['Stop']) {
    $afyxHandler = @($hooksDocument.hooks.Stop | ForEach-Object { $_.hooks } | Where-Object {
        ($_.PSObject.Properties['statusMessage'] -and [string]$_.statusMessage -eq 'Afyx Codex Usage Tracking') -or
        ($_.PSObject.Properties['commandWindows'] -and [string]$_.commandWindows -match '(?i)codex-usage-stop\.ps1') -or
        ($_.PSObject.Properties['command'] -and [string]$_.command -match '(?i)codex-usage-stop\.ps1')
    } | Select-Object -First 1)
    if ($afyxHandler.Count) { $afyxHandler = $afyxHandler[0] } else { $afyxHandler = $null }
}
Write-Check ($null -ne $afyxHandler) 'Stop hook configured' $(if ($afyxHandler) { 'Afyx handler found' } else { 'Afyx handler missing' })
$hookCommandOk = $false
if ($null -ne $afyxHandler) {
    $command = if ($afyxHandler.PSObject.Properties['commandWindows']) { [string]$afyxHandler.commandWindows } else { [string]$afyxHandler.command }
    $hookCommandOk = $command -match [regex]::Escape($expectedStopPath) -and (Test-Path -LiteralPath $expectedStopPath -PathType Leaf)
}
Write-Check $hookCommandOk 'Stop hook script' $(if ($hookCommandOk) { 'command resolves to installed script' } else { 'command path missing or unexpected' })

$debugLogPath = Join-Path $CodexHome 'tools\logs\codex-usage-debug.log'
$observedStage = 'HOOK_NOT_OBSERVED'
if (Test-Path -LiteralPath $debugLogPath -PathType Leaf) {
    try {
        $debugRecords = @(Get-Content -LiteralPath $debugLogPath -Tail 100 | ForEach-Object { $_ | ConvertFrom-Json -ErrorAction Stop })
        if (@($debugRecords | Where-Object { $_.stage -eq 'HOOK_OBSERVED' }).Count -gt 0) {
            $observedStage = [string]$debugRecords[-1].stage
        }
    } catch { $observedStage = 'DEBUG_LOG_INVALID' }
}
Write-Host "[INFO] Hook observation — $observedStage"

$sessionDirectoryOk = Test-Path -LiteralPath $SessionRoot -PathType Container
Write-Check $sessionDirectoryOk 'Sessions directory' $(if ($sessionDirectoryOk) { 'found' } else { 'missing' })
$latest = if ($sessionDirectoryOk) {
    Get-ChildItem -LiteralPath $SessionRoot -Recurse -Filter 'rollout-*.jsonl' -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
} else { $null }
Write-Check ($null -ne $latest) 'Latest rollout' $(if ($latest) { 'found and readable' } else { 'not found' })

$pricing = $null
$pricingOk = $false
try {
    Import-Module (Join-Path $PSScriptRoot 'CodexUsage.psm1') -Force -ErrorAction Stop | Out-Null
    $pricing = Import-CodexPricing -Path $PricingPath
    $pricingOk = $pricing.ContainsKey('unit_tokens') -and $pricing.ContainsKey('models')
} catch { }
Write-Check $pricingOk 'Pricing configuration' $(if ($pricingOk) { 'valid' } else { 'missing or invalid' })

$tokenEventFound = $false
$lastCompletion = $null
if ($latest -and $pricingOk) {
    try {
        $state = New-CodexUsageParserState
        $stream = [IO.File]::Open($latest.FullName, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete)
        try {
            $reader = [IO.StreamReader]::new($stream, [Text.Encoding]::UTF8, $true, 4096, $true)
            try {
                while (-not $reader.EndOfStream) {
                    $line = $reader.ReadLine()
                    if ($line -match '"type"\s*:\s*"token_usage_record"') { $tokenEventFound = $true }
                    $event = ConvertFrom-CodexTelemetryLine -Line $line
                    if ($null -eq $event) { continue }
                    $completion = Update-CodexUsageState -State $state -Event $event -Pricing $pricing -SessionFile $latest.FullName
                    if ($null -ne $completion) { $lastCompletion = $completion }
                }
            } finally { $reader.Dispose() }
        } finally { $stream.Dispose() }
    } catch { }
}
Write-Check $tokenEventFound 'Token usage event' $(if ($tokenEventFound) { 'detected' } else { 'not detected' })
Write-Check ($null -ne $lastCompletion) 'Latest completed turn' $(if ($lastCompletion) { 'parseable' } else { 'not parseable' })

$summaryOk = $false
if ($null -ne $lastCompletion) {
    try { $summaryOk = -not [string]::IsNullOrWhiteSpace((Format-CodexUsageUiMessage -Completion $lastCompletion)) } catch { }
}
Write-Check $summaryOk 'Usage summary' $(if ($summaryOk) { 'generated' } else { 'not generated' })

$watcherReplayOk = $false
if ($latest -and $pricingOk -and (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'codex-usage-watch.ps1') -PathType Leaf)) {
    try {
        $output = & (Get-Command pwsh).Source -NoLogo -NoProfile -File (Join-Path $PSScriptRoot 'codex-usage-watch.ps1') `
            -SessionRoot $SessionRoot -PricingPath $PricingPath -ReplayLatestCompletedTurns 1 -NoSnapshot 2>$null
        $watcherReplayOk = $LASTEXITCODE -eq 0 -and (($output -join "`n") -match 'Codex Turn Usage')
    } catch { }
}
Write-Check $watcherReplayOk 'Watcher replay' $(if ($watcherReplayOk) { 'latest completed turn replayed' } else { 'replay failed' })

Write-Host ''
$displayPath = if ($summaryOk -and $hookCommandOk) { 'CLIENT DISPLAY NOT VERIFIED' } else { 'UNKNOWN' }
Write-Host "Hook display path: $displayPath"
if ($failures.Count -eq 0) {
    Write-Host 'READY'
    exit 0
}
Write-Host 'NOT READY'
exit 1
