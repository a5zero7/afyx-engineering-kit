[CmdletBinding()]
param(
    [string]$SkillsRoot,
    [string]$ProjectPath = (Get-Location).Path
)

# Afyx Engineering Doctor (Windows PowerShell / PowerShell 7). Read-only:
# reports component health from the shared contract (scripts/components.json),
# the environment, and the current project. It never installs, repairs, or
# writes anything, and it never opens the Afyx Graph database.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Import-Module (Join-Path $PSScriptRoot 'lib\AfyxComponents.psm1') -Force
$context = New-AfyxComponentContext -SkillsRoot $SkillsRoot
$script:Failures = 0
$script:Warnings = 0

function Write-Line([string]$State, [string]$Name, [string]$Detail = '') {
    if ($State -eq 'FAIL') { $script:Failures++ }
    if ($State -eq 'WARN') { $script:Warnings++ }
    $suffix = if ($Detail) { " — $Detail" } else { '' }
    Write-Host "[$State] $Name$suffix"
}

function Get-ToolVersion([string]$Command, [string[]]$Arguments) {
    $found = Get-Command $Command -ErrorAction SilentlyContinue
    if (-not $found) { return $null }
    try { return ((& $found.Source @Arguments 2>$null) -join ' ').Trim() } catch { return '' }
}

# ---- Freshness: cheap local evidence only (never opens the database) --------------------
# .afyx-graph/freshness.json is written by Afyx Graph after each index/sync:
#   { "schema_version": 1, "indexed_at": ISO-8601, "git_head": "<sha>"|null, "tracked_clean": true|false|null }
# The same rules as src/freshness.ts in the engine.
function Get-GraphFreshness([string]$Root) {
    $stateName = if ($env:AFYX_GRAPH_DIR) { $env:AFYX_GRAPH_DIR } else { '.afyx-graph' }
    $stateDirectory = Join-Path $Root $stateName
    $database = Join-Path $stateDirectory 'afyx-graph.db'
    if (-not (Test-Path -LiteralPath $database -PathType Leaf)) { return @{ State = 'MISSING'; Detail = 'no .afyx-graph/afyx-graph.db; run "afyx-graph init"' } }
    try {
        $stream = [System.IO.File]::OpenRead($database)
        try { $header = New-Object byte[] 16; $read = $stream.Read($header, 0, 16) } finally { $stream.Dispose() }
    } catch { return @{ State = 'INVALID'; Detail = 'database is not readable' } }
    $magic = [System.Text.Encoding]::ASCII.GetString($header, 0, [Math]::Min($read, 15))
    if ($read -lt 16 -or $magic -ne 'SQLite format 3') { return @{ State = 'INVALID'; Detail = 'database is not a SQLite file' } }
    $metaFile = Join-Path $stateDirectory 'freshness.json'
    if (-not (Test-Path -LiteralPath $metaFile -PathType Leaf)) { return @{ State = 'UNKNOWN'; Detail = 'index metadata not recorded yet; run "afyx-graph sync" with a current release' } }
    try { $meta = Get-Content -Raw -LiteralPath $metaFile -Encoding utf8 | ConvertFrom-Json } catch { return @{ State = 'INVALID'; Detail = 'freshness.json is not valid JSON' } }
    if (-not (Get-Command git -ErrorAction SilentlyContinue) -or -not (Test-Path -LiteralPath (Join-Path $Root '.git'))) {
        return @{ State = 'UNKNOWN'; Detail = 'not a git working tree; freshness cannot be proven cheaply' }
    }
    $head = ((& git -C $Root rev-parse HEAD 2>$null) -join '').Trim()
    $dirty = @(& git -C $Root status --porcelain --untracked-files=no 2>$null).Count -gt 0
    $global:LASTEXITCODE = 0
    $recorded = $meta.PSObject.Properties['git_head']
    if (-not $recorded -or -not $recorded.Value) { return @{ State = 'UNKNOWN'; Detail = 'index metadata has no git head' } }
    if ($head -ne [string]$recorded.Value) { return @{ State = 'STALE'; Detail = 'git HEAD changed since the last index' } }
    if ($dirty) { return @{ State = 'STALE'; Detail = 'tracked files changed since the last index' } }
    $clean = $meta.PSObject.Properties['tracked_clean']
    if (-not $clean -or $clean.Value -ne $true) { return @{ State = 'STALE'; Detail = 'the index was built while tracked files had uncommitted changes' } }
    return @{ State = 'FRESH'; Detail = 'matches git HEAD with a clean tracked tree' }
}

Write-Host 'Afyx Engineering Doctor'
$states = @{}
foreach ($state in (Get-AfyxComponentStates -Context $context)) { $states[$state.Id] = $state }

Write-Host ''
Write-Host 'CORE'
foreach ($id in @('efficient-coding', 'odoo-engineering')) {
    $component = $states[$id]
    if ($component.State -eq 'HEALTHY') { Write-Line 'OK' $component.Name $component.Version }
    else { Write-Line 'FAIL' $component.Name "$($component.State): $($component.Detail)" }
}

Write-Host ''
Write-Host 'OPTIONAL'
$expert = $states['afyx-engineering-expert']
switch ($expert.State) {
    'HEALTHY' { Write-Line 'OK' $expert.Name $expert.Version }
    'NOT INSTALLED' { Write-Line 'INFO' $expert.Name 'not installed (optional)' }
    default { Write-Line 'WARN' $expert.Name "$($expert.State): $($expert.Detail)" }
}
$graph = $states['afyx-graph']
switch ($graph.State) {
    'HEALTHY' { Write-Line 'OK' $graph.Name $graph.Version; Write-Host "     State: $($graph.State)" }
    'NOT INSTALLED' { Write-Line 'INFO' $graph.Name 'not installed (optional)' }
    default { Write-Line 'WARN' $graph.Name "$($graph.State): $($graph.Detail)" }
}
$usage = $states['codex-usage-tracking']
switch ($usage.State) {
    'HEALTHY' { Write-Line 'OK' $usage.Name }
    'NOT INSTALLED' { Write-Line 'INFO' $usage.Name $(if ($usage.Detail -eq 'not installed') { 'not installed (optional)' } else { $usage.Detail }) }
    default { Write-Line 'WARN' $usage.Name "$($usage.State): $($usage.Detail)" }
}
Write-Host ''
Write-Host 'ENVIRONMENT'
$codexVersion = Get-ToolVersion 'codex' @('--version')
$extension = [bool](Get-ChildItem -Path (Join-Path $(if ($env:USERPROFILE) { $env:USERPROFILE } else { $env:HOME }) '.vscode\extensions\openai.chatgpt-*') -Directory -ErrorAction SilentlyContinue | Select-Object -First 1)
if ($codexVersion) { Write-Line 'OK' 'Codex CLI' $codexVersion } else { Write-Line 'INFO' 'Codex CLI' 'not found' }
if ($extension) { Write-Line 'OK' 'VS Code extension' 'detected' } else { Write-Line 'INFO' 'VS Code extension' 'not detected' }
if (-not $codexVersion -and -not $extension) { Write-Line 'FAIL' 'Codex host' 'neither Codex CLI nor the ChatGPT/Codex VS Code extension was detected' }
$gitVersion = Get-ToolVersion 'git' @('--version')
if ($gitVersion) { Write-Line 'OK' 'Git' $gitVersion } else { Write-Line 'WARN' 'Git' 'not found; required for source and freshness checks' }
$pythonVersion = Get-ToolVersion 'python' @('--version')
if (-not $pythonVersion) { $pythonVersion = Get-ToolVersion 'python3' @('--version') }
if ($pythonVersion) { Write-Line 'OK' 'Python' "$pythonVersion (optional: validators and evals)" } else { Write-Line 'INFO' 'Python' 'not found (optional: validators and evals)' }
Write-Line 'OK' 'PowerShell' "$($PSVersionTable.PSVersion) ($($context.Platform))"

Write-Host ''
Write-Host 'PROJECT'
$projectJson = & (Join-Path $PSScriptRoot 'afyx-project.ps1') -Path $ProjectPath -Format json
$project = ($projectJson -join "`n") | ConvertFrom-Json
Write-Host "     Root: $($project.project_root) ($($project.root_evidence))"
if ($project.odoo.detected) {
    Write-Line 'OK' 'Odoo detected'
    switch ($project.odoo.version_status) {
        'proven' { Write-Line 'OK' "Version: $($project.odoo.major_version)" 'proven by source evidence' }
        'inferred' { Write-Line 'OK' "Version: $($project.odoo.major_version)" 'inferred from repository evidence; confirm before version-specific work' }
        'conflict' { Write-Line 'WARN' 'Version' 'conflicting evidence; do not guess (see afyx-project.ps1 -Format text)' }
        'unsupported' { Write-Line 'WARN' 'Version' 'outside the supported Odoo 10-20 range' }
        default { Write-Line 'WARN' 'Version' 'no version evidence found' }
    }
    foreach ($conflict in @($project.odoo.conflicts)) { Write-Line 'WARN' 'Version evidence disagrees' "$($conflict.source) says $($conflict.major)" }
    if (@($project.odoo.addon_roots).Count -gt 0) { Write-Host "     Addon roots: $(@($project.odoo.addon_roots) -join ', ')" }
} else {
    Write-Line 'INFO' "Project type: $($project.project_type)" 'no Odoo project detected'
}
$freshness = Get-GraphFreshness $project.project_root
switch ($freshness.State) {
    'FRESH' { Write-Line 'OK' 'Afyx Graph index: FRESH' $freshness.Detail }
    'MISSING' { Write-Line 'INFO' 'Afyx Graph index: MISSING' $freshness.Detail }
    'STALE' { Write-Line 'WARN' 'Afyx Graph index: STALE' $freshness.Detail }
    'INVALID' { Write-Line 'WARN' 'Afyx Graph index: INVALID' $freshness.Detail }
    default { Write-Line 'INFO' "Afyx Graph index: $($freshness.State)" $freshness.Detail }
}

Write-Host ''
if ($script:Failures -gt 0) { Write-Host 'NOT READY'; exit 1 }
if ($script:Warnings -gt 0) { Write-Host 'READY (with warnings)'; exit 0 }
Write-Host 'READY'
exit 0
