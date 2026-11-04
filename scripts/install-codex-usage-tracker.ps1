[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$CodexHome = $(if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }),
    [string]$VSCodeUserTasksPath = (Join-Path $env:APPDATA 'Code\User\tasks.json'),
    [string]$HooksPath,
    [switch]$SkipVSCodeTask,
    [switch]$Uninstall
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 7) {
    throw 'Codex Usage Tracker requires PowerShell 7+. Core Afyx installation compatibility is separate.'
}

$sourceRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'tools\codex-usage'
$toolsRoot = Join-Path $CodexHome 'tools'
if (-not $HooksPath) { $HooksPath = Join-Path $CodexHome 'hooks.json' }
$runtimeFiles = @('CodexUsage.psm1', 'codex-usage-stop.ps1', 'codex-usage-watch.ps1', 'codex-usage-doctor.ps1', 'codex-usage-pricing.json')
$taskLabel = 'Codex: Watch Token Usage'
$hookMarker = 'Afyx Codex Usage Tracking'

function Read-JsonDocument {
    param([string]$Path, [string]$Kind)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    try { return Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json -Depth 50 -ErrorAction Stop }
    catch { throw "Existing $Kind is not strict JSON; refusing to overwrite it: $Path" }
}

function Write-JsonDocument {
    param([string]$Path, [object]$Document, [string]$Action)

    $json = $Document | ConvertTo-Json -Depth 50
    if ((Test-Path -LiteralPath $Path -PathType Leaf) -and (Get-Content -Raw -LiteralPath $Path) -eq $json) { return $false }
    if (-not $PSCmdlet.ShouldProcess($Path, $Action)) { return $false }
    $parent = Split-Path -Parent $Path
    if ($parent) { [IO.Directory]::CreateDirectory($parent) | Out-Null }
    if (Test-Path -LiteralPath $Path -PathType Leaf) {
        Copy-Item -LiteralPath $Path -Destination "$Path.bak-$(Get-Date -Format 'yyyyMMdd-HHmmss-fff')"
    }
    $temporary = "$Path.tmp-$PID"
    [IO.File]::WriteAllText($temporary, $json, [Text.UTF8Encoding]::new($false))
    Move-Item -Force -LiteralPath $temporary -Destination $Path
    return $true
}

function Test-AfyxHookHandler {
    param([object]$Handler)

    if ($null -eq $Handler) { return $false }
    if ($Handler.PSObject.Properties['statusMessage'] -and [string]$Handler.statusMessage -eq $hookMarker) { return $true }
    foreach ($property in @('command', 'commandWindows')) {
        if ($Handler.PSObject.Properties[$property] -and [string]$Handler.$property -match '(?i)codex-usage-stop\.ps1') { return $true }
    }
    return $false
}

function Update-HooksDocument {
    param([switch]$Remove)

    $document = Read-JsonDocument -Path $HooksPath -Kind 'Codex hooks file'
    if ($Remove -and $null -eq $document) { return }
    if ($null -eq $document) { $document = [pscustomobject]@{ hooks = [pscustomobject]@{} } }
    if (-not $document.PSObject.Properties['hooks']) { $document | Add-Member -NotePropertyName hooks -NotePropertyValue ([pscustomobject]@{}) }
    if ($null -eq $document.hooks) { $document.hooks = [pscustomobject]@{} }

    $stopGroups = if ($document.hooks.PSObject.Properties['Stop']) { @($document.hooks.Stop) } else { @() }
    $keptGroups = [System.Collections.Generic.List[object]]::new()
    foreach ($group in $stopGroups) {
        $handlers = if ($group.PSObject.Properties['hooks']) { @($group.hooks) } else { @() }
        $ownedCount = @($handlers | Where-Object { Test-AfyxHookHandler $_ }).Count
        if ($ownedCount -eq 0) { $keptGroups.Add($group); continue }
        $remaining = @($handlers | Where-Object { -not (Test-AfyxHookHandler $_) })
        if ($remaining.Count -gt 0) {
            $group.hooks = $remaining
            $keptGroups.Add($group)
        }
    }

    if (-not $Remove) {
        $stopScript = Join-Path $toolsRoot 'codex-usage-stop.ps1'
        $quotedPath = '"' + $stopScript.Replace('"', '\"') + '"'
        $command = "pwsh -NoProfile -ExecutionPolicy Bypass -File $quotedPath"
        $handler = [pscustomobject]@{
            type = 'command'
            command = $command
            commandWindows = $command
            timeout = 3
            statusMessage = $hookMarker
        }
        $keptGroups.Add([pscustomobject]@{ hooks = @($handler) })
    }

    if ($document.hooks.PSObject.Properties['Stop']) {
        $document.hooks.Stop = $keptGroups.ToArray()
    } elseif ($keptGroups.Count -gt 0) {
        $document.hooks | Add-Member -NotePropertyName Stop -NotePropertyValue $keptGroups.ToArray()
    }
    if ($Remove -and $keptGroups.Count -eq 0 -and $document.hooks.PSObject.Properties['Stop']) {
        $document.hooks.PSObject.Properties.Remove('Stop')
    }
    [void](Write-JsonDocument -Path $HooksPath -Document $document -Action $(if ($Remove) { 'Remove Afyx usage Stop hook' } else { 'Configure Afyx usage Stop hook' }))
}

function Update-VSCodeTaskDocument {
    param([switch]$Remove)

    $document = Read-JsonDocument -Path $VSCodeUserTasksPath -Kind 'VS Code tasks file'
    if ($Remove) {
        if ($null -eq $document -or -not $document.PSObject.Properties['tasks']) { return }
        $document.tasks = @($document.tasks | Where-Object { [string]$_.label -ne $taskLabel })
    } else {
        $template = Get-Content -Raw -LiteralPath (Join-Path $sourceRoot 'vscode-user-task.json') | ConvertFrom-Json -Depth 20
        $newTask = $template.tasks[0]
        if ($null -eq $document) { $document = $template }
        else {
            if (-not $document.PSObject.Properties['tasks']) { $document | Add-Member -NotePropertyName tasks -NotePropertyValue @() }
            $document.tasks = @($document.tasks | Where-Object { [string]$_.label -ne $taskLabel }) + $newTask
        }
    }
    [void](Write-JsonDocument -Path $VSCodeUserTasksPath -Document $document -Action $(if ($Remove) { 'Remove Afyx VS Code usage task' } else { 'Install global VS Code usage task' }))
}

if ($Uninstall) {
    Update-HooksDocument -Remove
    if (-not $SkipVSCodeTask) { Update-VSCodeTaskDocument -Remove }
    foreach ($file in $runtimeFiles) {
        $target = Join-Path $toolsRoot $file
        if ((Test-Path -LiteralPath $target -PathType Leaf) -and $PSCmdlet.ShouldProcess($target, 'Remove Afyx usage tracker runtime file')) {
            Remove-Item -LiteralPath $target -Force
        }
    }
    Write-Host 'Codex Usage Tracking: removed (unrelated hooks and tasks preserved)'
    return
}

# Validate user-owned JSON before copying runtime files so malformed configuration
# cannot leave a partially updated installation.
[void](Read-JsonDocument -Path $HooksPath -Kind 'Codex hooks file')
if (-not $SkipVSCodeTask) { [void](Read-JsonDocument -Path $VSCodeUserTasksPath -Kind 'VS Code tasks file') }

if ($PSCmdlet.ShouldProcess($toolsRoot, 'Install Codex usage tracker runtime')) {
    [IO.Directory]::CreateDirectory($toolsRoot) | Out-Null
    foreach ($file in $runtimeFiles) {
        $source = Join-Path $sourceRoot $file
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Missing tracker file: $source" }
        Copy-Item -Force -LiteralPath $source -Destination (Join-Path $toolsRoot $file)
    }
}

Update-HooksDocument
if (-not $SkipVSCodeTask) { Update-VSCodeTaskDocument }

if (-not $WhatIfPreference) {
    $missingRuntime = @($runtimeFiles | Where-Object { -not (Test-Path -LiteralPath (Join-Path $toolsRoot $_) -PathType Leaf) })
    if ($missingRuntime.Count -gt 0) { throw "Usage Tracker installation incomplete: $($missingRuntime -join ', ')" }
    $verifiedHooks = Read-JsonDocument -Path $HooksPath -Kind 'Codex hooks file'
    $verifiedHandlers = @($verifiedHooks.hooks.Stop | ForEach-Object { $_.hooks } | Where-Object { Test-AfyxHookHandler $_ })
    if ($verifiedHandlers.Count -ne 1) { throw "Expected exactly one Afyx Stop hook after installation; found $($verifiedHandlers.Count)." }
    $expectedStopPath = [IO.Path]::GetFullPath((Join-Path $toolsRoot 'codex-usage-stop.ps1'))
    $verifiedCommand = if ($verifiedHandlers[0].PSObject.Properties['commandWindows']) { [string]$verifiedHandlers[0].commandWindows } else { [string]$verifiedHandlers[0].command }
    if ($verifiedCommand -notmatch [regex]::Escape($expectedStopPath)) { throw 'Installed Stop hook command does not point to the expected runtime script.' }
}

Write-Host 'Codex Usage Tracking: installed'
Write-Host 'Automatic UI usage message: configured'
Write-Host 'Terminal watcher fallback: installed'
Write-Host 'Usage doctor: installed'
if (-not $SkipVSCodeTask) { Write-Host 'VS Code User Task: installed' }
Write-Host 'Hook trust: review required via /hooks'
Write-Host 'Start a fresh Codex CLI session or reload VS Code after hook installation or changes.'
