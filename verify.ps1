[CmdletBinding()]
param(
    [string]$SkillsRoot = (Join-Path $env:USERPROFILE '.agents\skills'),
    [string]$Preset = '',
    [string[]]$CustomComponent = @(),
    [string[]]$Provider = @('codex'),
    [ValidateSet('global', 'workspace')][string]$ProviderScope = 'global',
    [string]$WorkspaceRoot = (Get-Location).Path,
    [string]$GeminiHome = $(if ($env:AFYX_GEMINI_HOME) { $env:AFYX_GEMINI_HOME } else { Join-Path $env:USERPROFILE '.gemini' }),
    [string]$ClaudeHome = $(if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $env:USERPROFILE '.claude' }),
    [string]$ClaudeConfigDir = $(if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { '' }),
    [string]$ContextRuntimeRoot = $(if ($env:AFYX_CONTEXT_RUNTIME_ROOT) { $env:AFYX_CONTEXT_RUNTIME_ROOT } else { Join-Path $env:USERPROFILE '.afyx\context' }),
    [string]$ForgeRuntimeRoot = $(if ($env:AFYX_FORGE_RUNTIME_ROOT) { $env:AFYX_FORGE_RUNTIME_ROOT } else { Join-Path $env:USERPROFILE '.afyx\forge' }),
    [string]$AfyxInstallRoot = $(if ($env:AFYX_INSTALL_ROOT) { $env:AFYX_INSTALL_ROOT } else { Join-Path $env:USERPROFILE '.afyx' }),
    [string]$HostBridgeRuntimeRoot = $(if ($env:AFYX_HOST_BRIDGE_RUNTIME_ROOT) { $env:AFYX_HOST_BRIDGE_RUNTIME_ROOT } else { Join-Path $env:USERPROFILE '.afyx\host-bridge' })
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$coreFailure = $false
$configuredProviders = @()
$codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }
$configPath = Join-Path $codexHome 'config.toml'
$graphRoot = if ($env:AFYX_GRAPH_RUNTIME_ROOT) { $env:AFYX_GRAPH_RUNTIME_ROOT } else { Join-Path $env:USERPROFILE '.afyx\graph' }
Import-Module (Join-Path $PSScriptRoot 'scripts\lib\AfyxTerminal.psm1') -Force
$terminal = New-AfyxTerminalContext

function Write-Result([string]$State, [string]$Name, [string]$Detail = '') {
    $status = switch ($State) {
        'OK' { 'HEALTHY' }
        'FAIL' { 'BLOCKED' }
        'WARN' { 'WARNING' }
        default { $State }
    }
    Write-AfyxStatus -Status $status -Name $Name -Detail $Detail -Terminal $terminal
}

# One component truth: scripts/components.json, read through the shared module.
Import-Module (Join-Path $PSScriptRoot 'scripts\lib\AfyxComponents.psm1') -Force
Import-Module (Join-Path $PSScriptRoot 'scripts\lib\AfyxSkillLifecycle.psm1') -Force -DisableNameChecking
$providerIds = @(Get-AfyxProviderRegistry | ForEach-Object { [string]$_.provider })
$unknownProviders = @($Provider | Where-Object { $_ -notin $providerIds })
if ($unknownProviders.Count) { throw "Unknown provider(s): $($unknownProviders -join ', ')" }
$providerSkillRoots = @()
if ('codex' -in $Provider) {
    $providerSkillRoots += $(if ($PSBoundParameters.ContainsKey('SkillsRoot')) { $SkillsRoot } else { Join-Path $env:USERPROFILE '.agents\skills' })
}
if ('antigravity' -in $Provider) {
    if ($ProviderScope -eq 'workspace') { $providerSkillRoots += (Join-Path $WorkspaceRoot '.agents\skills') }
    else { $providerSkillRoots += @((Join-Path $GeminiHome 'config\skills'), (Join-Path $GeminiHome 'antigravity-cli\skills')) }
}
if ('claude' -in $Provider) {
    $providerSkillRoots += $(if ($ProviderScope -eq 'workspace') { Join-Path $WorkspaceRoot '.claude\skills' } else { Join-Path $ClaudeHome 'skills' })
}
if (-not $PSBoundParameters.ContainsKey('SkillsRoot') -and $providerSkillRoots.Count) { $SkillsRoot = $providerSkillRoots[0] }
$primarySkillsPath = [System.IO.Path]::GetFullPath($SkillsRoot)
$additionalSkillRoots = @($providerSkillRoots |
    Where-Object { [System.IO.Path]::GetFullPath($_) -ne $primarySkillsPath } |
    Select-Object -Unique)
$componentContext = New-AfyxComponentContext -SkillsRoot $SkillsRoot -GraphRoot $graphRoot -ContextRoot $ContextRuntimeRoot -ForgeRoot $ForgeRuntimeRoot -CodexHome $codexHome
$componentStates = @{}
foreach ($componentState in (Get-AfyxComponentStates -Context $componentContext)) { $componentStates[$componentState.Id] = $componentState }
if ($Preset) {
    foreach ($component in (Get-AfyxComponentContract | Where-Object { $_.type -eq 'skill' })) {
        $state = $componentStates[[string]$component.id]
        if ($state.State -eq 'NOT INSTALLED') { continue }
        $installedOwnership = Get-AfyxSkillOwnership -Target $state.Path -Component ([string]$component.id) -ExpectedOwner ([string]$component.ownership)
        if ($installedOwnership -eq 'AFYX_OWNED_MODIFIED') {
            $state.State = 'DRIFTED'; $state.Detail = 'Afyx ownership verified but installed content was modified'
        } elseif ($installedOwnership -notin @('AFYX_OWNED_UNMODIFIED', 'EXTERNAL_UPSTREAM')) {
            $state.State = 'UNKNOWN'; $state.Detail = "installed ownership is $installedOwnership"
        }
    }
}
if ($Preset -and $Preset -notin @('minimal', 'recommended', 'full', 'custom')) { throw "Unknown preset: $Preset" }
if (-not $Preset -and $CustomComponent.Count) { throw '-CustomComponent requires -Preset custom.' }
foreach ($id in $CustomComponent) {
    if ($id -in @('prompt-master', 'headroom')) {
        throw "Component '$id' is retired from Afyx Kit and remains externally/user managed; no changes were made."
    }
}
$controlPlan = if ($Preset) { Get-AfyxControlPlan -Preset $Preset -CustomComponent $CustomComponent -Provider $Provider -Context $componentContext -StateById $componentStates } else { $null }

Show-AfyxBanner -Terminal $terminal -Subtitle 'Readiness Verification | Midnight Circuit'
$gitSource = Get-Command git -ErrorAction SilentlyContinue
if ($gitSource) {
    $sourceCommit = (& git -C $PSScriptRoot rev-parse HEAD 2>$null) -join ''
    $sourceBranch = (& git -C $PSScriptRoot branch --show-current 2>$null) -join ''
    if (-not $sourceBranch) { $sourceBranch = 'DETACHED' }
    $sourceDirty = [bool]((& git -C $PSScriptRoot status --porcelain 2>$null) -join '')
    Write-Result $(if ($sourceDirty) { 'WARN' } else { 'OK' }) 'Source identity' "branch=$sourceBranch; commit=$sourceCommit; dirty=$sourceDirty"
}
foreach ($providerRecord in (Get-AfyxProviderRegistry)) {
    Write-Result 'INFO' "Provider adapter: $($providerRecord.name)" "primary=$($providerRecord.primary); ownership=$($providerRecord.ownership_class); capabilities=$($providerRecord.capabilities); policy=$($providerRecord.configuration_policy)"
}
if ($Provider.Count) {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    $entry = Join-Path $graphRoot 'current\lib\dist\bin\afyx-graph.js'
    if ($nodeCommand -and (Test-Path -LiteralPath $entry -PathType Leaf)) {
        $providerTool = Join-Path $PSScriptRoot 'scripts\afyx-provider-integration.mjs'
        $providerArguments = @($providerTool, '--providers', ($Provider -join ','), '--scope', $ProviderScope,
            '--workspace-root', $WorkspaceRoot, '--gemini-home', $GeminiHome, '--codex-home', $codexHome,
            '--node', $nodeCommand.Source, '--entry', $entry)
        $codexHost = Get-AfyxCodexHost
        $codexCommand = if ($codexHost.State -eq 'CLI_READY') { [pscustomobject]@{ Source = $codexHost.Path } } else { $null }
        $claudeCommand = Get-Command claude -ErrorAction SilentlyContinue
        if ($codexCommand) { $providerArguments += @('--codex', $codexCommand.Source) }
        if ($claudeCommand) { $providerArguments += @('--claude', $claudeCommand.Source) }
        if ($ClaudeConfigDir) { $providerArguments += @('--claude-config-dir', $ClaudeConfigDir) }
        $providerJson = (& $nodeCommand.Source @providerArguments) -join ''
        try {
            $providerResult = $providerJson | ConvertFrom-AfyxJson -Depth 20
            $configuredProviders = @($providerResult.providers | Where-Object { $_.status -in @('READY', 'CONFIGURED', 'CONFIGURED_RESTART_REQUIRED') })
            foreach ($providerEntry in $providerResult.providers) {
                $level = if ($providerEntry.status -in @('READY', 'CONFIGURED', 'CONFIGURED_RESTART_REQUIRED')) { 'OK' } elseif ($providerEntry.status -in @('BLOCKED', 'INCOMPATIBLE')) { 'FAIL' } else { 'INFO' }
                Write-Result $level "$($providerEntry.provider) MCP" "$($providerEntry.status): $($providerEntry.detail)"
                if ($level -eq 'FAIL') { $coreFailure = $true }
            }
        } catch { Write-Result 'FAIL' 'Provider MCP' 'provider status was not valid JSON'; $coreFailure = $true }
    } else { Write-Result 'INFO' 'Provider MCP' 'BLOCKED: Graph runtime or Node.js unavailable' }
}
if ($controlPlan) {
    Write-Result 'INFO' 'Desired state plan' $controlPlan.Identity
    foreach ($item in $controlPlan.Components) {
        if ($item.Drift -eq 'IN_SYNC') { Write-Result 'OK' "Plan/$($item.Id)" 'IN_SYNC' }
        elseif ($item.Drift -eq 'NOT_APPLICABLE' -or -not $item.Desired) { Write-Result 'INFO' "Plan/$($item.Id)" "$($item.Drift); preserved" }
        elseif ($item.Id -eq 'codex-usage-tracking' -and $item.Drift -eq 'MISSING') { Write-Result 'INFO' "Plan/$($item.Id)" 'optional; explicit installation was not requested' }
        else { Write-Result 'FAIL' "Plan/$($item.Id)" "$($item.Drift); ownership=$($item.ActualOwnership); repair=$($item.Repair)"; $coreFailure = $true }
    }
}
foreach ($additionalRoot in $additionalSkillRoots) {
    foreach ($component in Get-AfyxComponentContract | Where-Object { $_.type -eq 'skill' -and $_.ownership -eq 'afyx' }) {
        $desired = -not $controlPlan -or [string]$component.id -in $controlPlan.DesiredComponents
        $target = Join-Path $additionalRoot ([string]$component.install_path)
        $ownership = Get-AfyxSkillOwnership -Target $target -Component ([string]$component.id) -ExpectedOwner ([string]$component.ownership)
        if ($ownership -eq 'AFYX_OWNED_UNMODIFIED') { Write-Result 'OK' "Provider skill/$($component.id)" "$additionalRoot; ownership verified" }
        elseif ($ownership -eq 'NOT_INSTALLED' -and -not $desired) { Write-Result 'INFO' "Provider skill/$($component.id)" "$additionalRoot; not selected" }
        elseif ($desired) { Write-Result 'FAIL' "Provider skill/$($component.id)" "$additionalRoot; $ownership"; $coreFailure = $true }
    }
}
# Inspect effective on-disk provider companion ownership instead of inferring
# integration from runtime metadata or a planned routing status.
if ($controlPlan -and $Provider.Count) {
    foreach ($id in @('afyx-context', 'afyx-forge')) {
        if ($id -notin $controlPlan.DesiredComponents) { continue }
        if ($id -eq 'afyx-context' -and $env:AFYX_CONTEXT_OPT_IN -eq '0') {
            Write-Result 'INFO' 'Afyx Context Companion' 'explicitly disabled; no automatic re-enable'
            continue
        }
        $state = $componentStates[$id]
        if ($state.State -ne 'HEALTHY') { continue } # Reported by the normal desired-state check.
        foreach ($root in @($providerSkillRoots | Select-Object -Unique)) {
            $target = Join-Path $root $id
            $ownerState = Get-AfyxSkillOwnership -Target $target -Component $id -ExpectedOwner 'afyx'
            if ($ownerState -eq 'AFYX_OWNED_UNMODIFIED') {
                Write-Result 'OK' "Provider companion/$id" "$root; ownership verified; invocation remains on demand"
            } elseif ($ownerState -eq 'NOT_INSTALLED' -and $configuredProviders.Count -eq 0) {
                Write-Result 'INFO' "Provider companion/$id" "$root; provider integration is not configured"
            } else {
                Write-Result 'FAIL' "Provider companion/$id" "$root; ownership=$ownerState; expected an Afyx-owned skill for the selected runtime"
                $coreFailure = $true
            }
        }
    }
}
$git = Get-Command git -ErrorAction SilentlyContinue
$node = Get-Command node -ErrorAction SilentlyContinue
$npm = Get-Command npm -ErrorAction SilentlyContinue
Write-Result 'OK' 'OS/architecture [REQUIRED]' "$([System.Runtime.InteropServices.RuntimeInformation]::OSDescription) / $([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture)"
Write-Result 'OK' 'Platform shell [REQUIRED]' "PowerShell $($PSVersionTable.PSVersion)"
if ($git) { Write-Result 'OK' 'Git [REQUIRED]' ((& git --version 2>$null) -join ' ') } else { Write-Result 'FAIL' 'Git [REQUIRED]' 'missing; install Git for Windows from https://git-scm.com/'; $coreFailure = $true }
if ($node) {
    $nodeText = (& node --version 2>$null) -join ' '
    $match = [regex]::Match($nodeText, '(\d+)\.(\d+)\.(\d+)')
    if ($match.Success -and [version]$match.Value -ge [version]'22.5.0') { Write-Result 'OK' 'Node.js [COMPONENT_REQUIRED:Afyx Graph]' $nodeText }
    else { Write-Result 'WARN' 'Node.js [COMPONENT_REQUIRED:Afyx Graph]' "$nodeText; requires >=22.5.0" }
} else { Write-Result 'INFO' 'Node.js [COMPONENT_REQUIRED:Afyx Graph]' 'missing; install from https://nodejs.org/ before selecting Afyx Graph' }
if ($node) { Write-Result 'OK' 'Node.js [COMPONENT_REQUIRED:Afyx Context]' ((& node --version 2>$null) -join ' ') }
else { Write-Result 'INFO' 'Node.js [COMPONENT_REQUIRED:Afyx Context]' 'missing; required only when Afyx Context is selected' }
if ($npm) { Write-Result 'OK' 'npm [BUILD_ONLY:Afyx Graph]' ((& npm --version 2>$null) -join ' ') } else { Write-Result 'INFO' 'npm [BUILD_ONLY:Afyx Graph]' 'missing; required only for local artifact fallback' }
Write-Result 'OK' 'Archive/checksum [COMPONENT_REQUIRED:Afyx Graph]' 'Expand-Archive and Get-FileHash available'
$codexRequired = 'codex' -in $Provider -or -not $Provider.Count
$antigravityRequired = 'antigravity' -in $Provider
$claudeRequired = 'claude' -in $Provider

$codexHost = Get-AfyxCodexHost
$codex = if ($codexHost.State -eq 'CLI_READY') { [pscustomobject]@{ Source = $codexHost.Path } } else { $null }
$extension = [bool](Get-ChildItem -Path (Join-Path $env:USERPROFILE '.vscode\extensions\openai.chatgpt-*') -Directory -ErrorAction SilentlyContinue | Select-Object -First 1)
if ($codex) {
    try {
        $version = (& $codex.Source --version 2>$null) -join ' '
        if ($LASTEXITCODE -ne 0) { throw 'version command returned a non-zero exit code' }
        Write-Result 'OK' 'Codex CLI' $version
    }
    catch {
        Write-Result $(if ($codexRequired) { 'FAIL' } else { 'WARN' }) 'Codex CLI' 'version command failed'
        if ($codexRequired) { $coreFailure = $true }
    }
} else { Write-Result 'INFO' 'Codex CLI' $(if ($codexRequired) { 'not found' } else { 'not found (optional)' }) }
if ($extension) { Write-Result 'OK' 'VS Code extension' 'detected' } else { Write-Result 'INFO' 'VS Code extension' 'not detected' }
if ($codexRequired -and -not $codex) {
    Write-Result 'FAIL' 'Codex host' "$($codexHost.Detail) A VS Code extension does not provide native MCP configuration."
    $coreFailure = $true
}

if ($antigravityRequired) {
    $antigravity = Get-Command agy -ErrorAction SilentlyContinue
    if (-not $antigravity) { $antigravity = Get-Command antigravity -ErrorAction SilentlyContinue }
    if ($antigravity) {
        try {
            $version = (& $antigravity.Source --version 2>$null) -join ' '
            Write-Result 'OK' 'Antigravity host' "detected ($version)"
        } catch {
            Write-Result 'FAIL' 'Antigravity host' 'version command failed'
            $coreFailure = $true
        }
    } else {
        Write-Result 'FAIL' 'Antigravity host' 'not found; install agy/antigravity'
        $coreFailure = $true
    }
}

if ($claudeRequired) {
    $claude = Get-Command claude.exe -ErrorAction SilentlyContinue
    if (-not $claude) { $claude = Get-Command claude.cmd -ErrorAction SilentlyContinue }
    if (-not $claude) { $claude = Get-Command claude -ErrorAction SilentlyContinue }
    if ($claude) {
        try {
            $version = (& claude --version 2>$null) -join ' '
            Write-Result 'OK' 'Claude Code host' "detected ($version)"
        } catch {
            Write-Result 'FAIL' 'Claude Code host' 'version command failed'
            $coreFailure = $true
        }
    } else {
        Write-Result 'FAIL' 'Claude Code host' 'not found; install Claude Code CLI'
        $coreFailure = $true
    }
}

$requiredIds = if ($controlPlan) { @($controlPlan.DesiredComponents) } else { @('efficient-coding', 'odoo-engineering') }
foreach ($component in ($componentStates.Values | Where-Object { $_.Id -in $requiredIds -and $_.Type -eq 'skill' } | Sort-Object { $requiredIds.IndexOf($_.Id) })) {
    if ($component.State -eq 'HEALTHY') { Write-Result 'OK' $component.Name $component.Detail }
    else { Write-Result 'FAIL' $component.Name "$($component.State): $($component.Detail)"; $coreFailure = $true }
}

$expert = $componentStates['afyx-engineering-expert']
switch ($expert.State) {
    'HEALTHY' { Write-Result 'OK' $expert.Name "$($expert.Version); optional skill valid" }
    'NOT INSTALLED' { Write-Result 'INFO' $expert.Name 'not installed (optional)' }
    default { Write-Result 'WARN' $expert.Name "$($expert.State): $($expert.Detail) (optional)" }
}

$graph = $componentStates['afyx-graph']
switch ($graph.State) {
    'NOT INSTALLED' { Write-Result 'INFO' 'Afyx Graph' 'not installed (optional)' }
    'HEALTHY' {
        $graphCli = Join-Path $graph.Path 'bin\afyx-graph.cmd'
        try {
            $reported = (& $graphCli --version 2>$null) -join ' '
            if ($LASTEXITCODE -ne 0 -or $reported -notmatch [regex]::Escape([string]$graph.Version)) { throw 'version mismatch' }
            & $graphCli help *> $null
            if ($LASTEXITCODE -ne 0) { throw 'help command failed' }
            Write-Result 'OK' 'Afyx Graph' "$reported; executable verification passed"
        } catch { Write-Result 'FAIL' 'Afyx Graph' "metadata is healthy but executable verification failed: $($_.Exception.Message)"; $coreFailure = $true }
    }
    'INCOMPLETE' { Write-Result 'WARN' 'Afyx Graph' 'incomplete Afyx-owned runtime (optional)' }
    'INVALID' { Write-Result 'WARN' 'Afyx Graph' 'invalid metadata (optional)' }
    default { Write-Result 'WARN' 'Afyx Graph' "state $($graph.State): $($graph.Detail) (optional)" }
}
if ($codexRequired) {
    if ($graph.State -eq 'HEALTHY' -and $node -and $codex) {
        $entry = Join-Path $graph.Path 'current\lib\dist\bin\afyx-graph.js'
        $integrationTool = Join-Path $PSScriptRoot 'scripts\afyx-mcp-integration.mjs'
        $integrationJson = (& $node.Source $integrationTool --node $node.Source --entry $entry --codex $codex.Source --codex-home $codexHome 2>$null) -join ''
        try {
            $integration = $integrationJson | ConvertFrom-Json
            $level = if ($integration.mcp -eq 'MCP_REACHABLE') { 'OK' } elseif ($integration.mcp -eq 'MCP_NOT_CONFIGURED') { 'INFO' } else { 'WARN' }
            Write-Result $level 'Afyx Graph MCP' "$($integration.mcp): $($integration.detail)"
        } catch { Write-Result 'WARN' 'Afyx Graph MCP' 'MCP_BLOCKED: integration status unavailable' }
    } elseif (-not $codex) { Write-Result 'INFO' 'Afyx Graph MCP' 'MCP_BLOCKED: Codex CLI unavailable' }
    elseif ($graph.State -ne 'HEALTHY') { Write-Result 'INFO' 'Afyx Graph MCP' 'MCP_BLOCKED: Graph runtime unavailable' }
    else { Write-Result 'INFO' 'Afyx Graph MCP' 'MCP_NOT_CONFIGURED' }
}
$context = $componentStates['afyx-context']
switch ($context.State) {
    'NOT INSTALLED' { Write-Result 'INFO' 'Afyx Context Engine' 'not installed (optional; explicit selection only)' }
    'HEALTHY' {
        $contextCli = Join-Path $context.Path 'current\bin\afyx-context.cmd'
        try {
            $reported = (& $contextCli --version 2>$null) -join ' '
            if ($LASTEXITCODE -ne 0 -or $reported -notmatch [regex]::Escape([string]$context.Version)) { throw 'version mismatch' }
            & $contextCli --help *> $null
            if ($LASTEXITCODE -ne 0) { throw 'help command failed' }
            Write-Result 'OK' 'Afyx Context Engine' "$reported; integrity and executable verification passed; Graph integration remains OFF"
        } catch { Write-Result 'FAIL' 'Afyx Context Engine' "metadata is healthy but executable verification failed: $($_.Exception.Message)"; $coreFailure = $true }
    }
    default { Write-Result 'WARN' 'Afyx Context Engine' "$($context.State): $($context.Detail) (optional)" }
}

$forge = $componentStates['afyx-forge']
switch ($forge.State) {
    'NOT INSTALLED' { Write-Result 'INFO' 'Afyx Forge Core' 'not installed (optional; selectable via custom preset)' }
    'HEALTHY' {
        $forgeCli = Join-Path $forge.Path 'bin\afyx-forge.cmd'
        try {
            & (Join-Path $PSScriptRoot 'scripts\install-afyx-forge.ps1') -RuntimeRoot $forge.Path -Verify *> $null
            if ($LASTEXITCODE -ne 0) { throw 'integrity check failed' }
            $reported = (& $forgeCli --version 2>$null) -join ' '
            if ($LASTEXITCODE -ne 0 -or $reported -notmatch [regex]::Escape([string]$forge.Version)) { throw 'version mismatch' }
            $doctorOut = (& $forgeCli doctor 2>$null) -join ' '
            if ($LASTEXITCODE -ne 0) { throw 'doctor command failed' }
            Write-Result 'OK' 'Afyx Forge Core' "$reported; integrity and executable verification passed; A8 gate remains EVALUATION_GATED"
        } catch { Write-Result 'FAIL' 'Afyx Forge Core' "metadata is healthy but executable verification failed: $($_.Exception.Message)"; $coreFailure = $true }
    }
    default { Write-Result 'WARN' 'Afyx Forge Core' "$($forge.State): $($forge.Detail) (optional)" }
}
if ($codexRequired) {
    if (Test-Path -LiteralPath $configPath -PathType Leaf) { Write-Result 'OK' 'Codex config' 'read-only check completed' }
    else { Write-Result 'WARN' 'Codex config' 'not found; optional MCP entries unavailable' }
}

$usageComponent = $componentStates['codex-usage-tracking']
$hooksPath = Join-Path $codexHome 'hooks.json'
$tasksPath = Join-Path $env:APPDATA 'Code\User\tasks.json'
$usagePresent = $usageComponent.State -notin @('NOT INSTALLED', 'UNKNOWN')
if (-not $usagePresent -and (Test-Path -LiteralPath $hooksPath -PathType Leaf)) {
    try { $usagePresent = (Get-Content -Raw -LiteralPath $hooksPath) -match '(?i)(Afyx Codex Usage Tracking|codex-usage-stop\.ps1)' } catch { }
}
if (-not $usagePresent -and (Test-Path -LiteralPath $tasksPath -PathType Leaf)) {
    try { $usagePresent = (Get-Content -Raw -LiteralPath $tasksPath) -match 'Codex: Watch Token Usage' } catch { }
}
if (-not $usagePresent) {
    Write-Result 'INFO' 'Codex Usage Tracker' 'optional; not installed'
} else {
    if ($usageComponent.State -eq 'HEALTHY') { Write-Result 'OK' 'Codex Usage Tracker' 'runtime files installed' }
    else { Write-Result 'WARN' 'Codex Usage Tracker' 'runtime files incomplete (optional)' }

    $hookConfigured = $false
    if (Test-Path -LiteralPath $hooksPath -PathType Leaf) {
        try {
            $hooksDocument = Get-Content -Raw -LiteralPath $hooksPath | ConvertFrom-AfyxJson -Depth 50 -ErrorAction Stop
            $hookConfigured = [bool](@($hooksDocument.hooks.Stop | ForEach-Object { $_.hooks } | Where-Object {
                ([string]$_.statusMessage -eq 'Afyx Codex Usage Tracking') -or
                ([string]$_.commandWindows -match '(?i)codex-usage-stop\.ps1') -or
                ([string]$_.command -match '(?i)codex-usage-stop\.ps1')
            }).Count)
        } catch { Write-Result 'WARN' 'Codex Usage Hook' 'hooks.json is invalid JSON' }
    }
    if ($hookConfigured) { Write-Result 'OK' 'Codex Usage Hook' 'global Stop hook configured' }
    else { Write-Result 'WARN' 'Codex Usage Hook' 'global Stop hook not configured (optional)' }

    try {
        $pricing = Get-Content -Raw -LiteralPath (Join-Path $codexHome 'tools\codex-usage-pricing.json') | ConvertFrom-AfyxJson -Depth 20 -ErrorAction Stop
        if ($pricing.unit_tokens -and $pricing.models) { Write-Result 'OK' 'Codex Usage Pricing' 'valid' }
        else { throw 'required pricing fields missing' }
    } catch { Write-Result 'WARN' 'Codex Usage Pricing' 'missing or invalid (optional)' }

    $taskConfigured = $false
    if (Test-Path -LiteralPath $tasksPath -PathType Leaf) {
        try {
            $taskDocument = Get-Content -Raw -LiteralPath $tasksPath | ConvertFrom-AfyxJson -Depth 30 -ErrorAction Stop
            $taskConfigured = [bool](@($taskDocument.tasks | Where-Object { $_.label -eq 'Codex: Watch Token Usage' }).Count)
        } catch { }
    }
    if ($taskConfigured) { Write-Result 'OK' 'Codex Usage VS Code Task' 'configured' }
    else { Write-Result 'WARN' 'Codex Usage VS Code Task' 'not configured (optional fallback)' }
    Write-Result 'INFO' 'Codex Usage Hook trust' 'verify with /hooks'
}

if ($Provider.Count -and $node) {
    $workflowProviders = @($Provider | Where-Object { $_ -eq 'antigravity' -or ($_ -eq 'claude' -and $ProviderScope -eq 'workspace') })
    $bridgeLifecycle = Join-Path $PSScriptRoot 'scripts\afyx-host-bridge-lifecycle.mjs'
    $bridgeJson = (& $node.Source $bridgeLifecycle '--runtime-root' $HostBridgeRuntimeRoot 2>$null) -join ''
    try { $bridge = $bridgeJson | ConvertFrom-AfyxJson -Depth 10 }
    catch { $bridge = $null }
    if ($bridge -and $bridge.status -eq 'READY') {
        Write-Result 'OK' 'Afyx Universal Host Bridge' "$($bridge.sourceRevision); integrity verified"
        if ($workflowProviders.Count) {
            $providerArgs = @((Join-Path $PSScriptRoot 'scripts\afyx-provider-integration.mjs'), '--providers', ($workflowProviders -join ','),
                '--scope', $ProviderScope, '--workspace-root', $WorkspaceRoot, '--gemini-home', $GeminiHome,
                '--codex-home', $codexHome, '--node', $node.Source, '--entry', $bridge.entry,
                '--server', 'afyx_workflow', '--mode', 'workflow', '--tool', 'afyx_workflow',
                '--install-root', $AfyxInstallRoot, '--authorize', 'afyx-graph,afyx-context', '--verify')
            if ($claudeCommand) { $providerArgs += @('--claude', $claudeCommand.Source) }
            if ($ClaudeConfigDir) { $providerArgs += @('--claude-config-dir', $ClaudeConfigDir) }
            $providerJson = (& $node.Source @providerArgs 2>$null) -join ''
            try { $providerResult = $providerJson | ConvertFrom-AfyxJson -Depth 20 }
            catch { $providerResult = $null }
            if (-not $providerResult -or $providerResult.status -eq 'BLOCKED') {
                Write-Result 'FAIL' 'Afyx workflow MCP' $(if ($providerJson) { $providerJson } else { 'provider verification failed' })
                $coreFailure = $true
            } else {
                Write-Result 'OK' 'Afyx workflow MCP' $providerResult.status
            }
        } else {
            Write-Result 'INFO' 'Afyx workflow MCP' 'session/workspace-isolated; direct CLI and session override available'
        }
    } elseif ($workflowProviders.Count -or (Test-Path -LiteralPath $HostBridgeRuntimeRoot)) {
        Write-Result 'FAIL' 'Afyx Universal Host Bridge' $(if ($bridgeJson) { $bridgeJson } else { 'not installed or integrity verification failed' })
        $coreFailure = $true
    } else {
        Write-Result 'INFO' 'Afyx Universal Host Bridge' 'not installed (managed infrastructure for Antigravity/Claude workflow)'
    }
}

if ($coreFailure) { Write-Result 'FAIL' 'Core readiness'; exit 1 }
Write-Result 'OK' 'Core readiness' 'ready; optional enhancement warnings do not affect this result'
