[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$SkillsRoot = (Join-Path $env:USERPROFILE '.agents\skills'),
    [switch]$Force,
    [switch]$ValidateOnly,
    [string[]]$ComponentAction = @(),
    [string]$Preset = '',
    [string[]]$CustomComponent = @(),
    [switch]$UpdateInstalled,
    [switch]$Offline,
    [switch]$NoBuildFallback,
    [switch]$AllowDirtySource,
    [switch]$InstallUsageTracker,
    [switch]$SkipUsageTracker,
    [switch]$SkipGraphMcp,
    [switch]$SkipGraphPathUpdate,
    [string[]]$Provider = @(),
    [ValidateSet('global', 'workspace')][string]$ProviderScope = 'global',
    [string]$WorkspaceRoot = (Get-Location).Path,
    [string]$GeminiHome = $(if ($env:AFYX_GEMINI_HOME) { $env:AFYX_GEMINI_HOME } else { Join-Path $env:USERPROFILE '.gemini' }),
    [string]$ClaudeHome = $(if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $env:USERPROFILE '.claude' }),
    [string]$ClaudeConfigDir = $(if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { '' }),
    [switch]$SkipProviderConfiguration,
    [string]$ContextRuntimeRoot = $(if ($env:AFYX_CONTEXT_RUNTIME_ROOT) { $env:AFYX_CONTEXT_RUNTIME_ROOT } else { Join-Path $env:USERPROFILE '.afyx\context' }),
    [string]$ForgeRuntimeRoot = $(if ($env:AFYX_FORGE_RUNTIME_ROOT) { $env:AFYX_FORGE_RUNTIME_ROOT } else { Join-Path $env:USERPROFILE '.afyx\forge' })
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$packageRoot = $PSScriptRoot
if ($CustomComponent.Count) {
    $CustomComponent = @($CustomComponent | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}
if ($Provider.Count) {
    $Provider = @($Provider | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}
$bundledEfficientCoding = Join-Path $packageRoot 'skills\efficient-coding'
$bundledOdooEngineering = Join-Path $packageRoot 'skills\odoo-engineering'
$bundledEngineeringExpert = Join-Path $packageRoot 'skills\afyx-engineering-expert'
$efficientTarget = Join-Path $SkillsRoot 'efficient-coding'
$odooTarget = Join-Path $SkillsRoot 'odoo-engineering'
$expertTarget = Join-Path $SkillsRoot 'afyx-engineering-expert'
$usageTrackerInstaller = Join-Path $packageRoot 'scripts\install-codex-usage-tracker.ps1'
$graphInstaller = Join-Path $packageRoot 'scripts\install-afyx-graph.ps1'
$graphMetadataPath = Join-Path $packageRoot 'afyx-graph\afyx-graph.json'
$contextInstaller = Join-Path $packageRoot 'scripts\install-afyx-context.ps1'
$contextMetadataPath = Join-Path $packageRoot 'afyx-context\afyx-context.json'
$contextCompanionSource = Join-Path $packageRoot 'skills\afyx-context'
$forgeInstaller = Join-Path $packageRoot 'scripts\install-afyx-forge.ps1'
$forgeMetadataPath = Join-Path $packageRoot 'afyx-forge\afyx-forge.json'
$forgeCompanionSource = Join-Path $packageRoot 'skills\afyx-forge'
$graphRuntimeRoot = if ($env:AFYX_GRAPH_RUNTIME_ROOT) { $env:AFYX_GRAPH_RUNTIME_ROOT } else { Join-Path $env:USERPROFILE '.afyx\graph' }
$codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }

if ($InstallUsageTracker -and $SkipUsageTracker) { throw '-InstallUsageTracker and -SkipUsageTracker cannot be used together.' }

# One component truth: scripts/components.json, read through the shared module.
Import-Module (Join-Path $packageRoot 'scripts\lib\AfyxComponents.psm1') -Force
Import-Module (Join-Path $packageRoot 'scripts\lib\AfyxSkillLifecycle.psm1') -Force -DisableNameChecking
Import-Module (Join-Path $packageRoot 'scripts\lib\AfyxTerminal.psm1') -Force
$terminal = New-AfyxTerminalContext
Show-AfyxBanner -Terminal $terminal -Subtitle 'Interactive Installer | Midnight Circuit'
$providerRegistry = @(Get-AfyxProviderRegistry)
$providerIds = @($providerRegistry | ForEach-Object { [string]$_.provider })
$codexHost = Get-AfyxCodexHost
$codexCommandDetected = if ($codexHost.State -eq 'CLI_READY') { [pscustomobject]@{ Source = $codexHost.Path } } else { $null }
$agyCommandDetected = Get-Command agy -ErrorAction SilentlyContinue
$antigravityCommandDetected = if ($agyCommandDetected) { $agyCommandDetected } else { Get-Command antigravity -ErrorAction SilentlyContinue }
$claudeCommandDetected = Get-Command claude -ErrorAction SilentlyContinue
$vscodeExtensionDetected = [bool](Get-ChildItem -Path (Join-Path $env:USERPROFILE '.vscode\extensions\openai.chatgpt-*') -Directory -ErrorAction SilentlyContinue | Select-Object -First 1)
# Read-only IDE discovery: distinguish an installed IDE from a usable provider CLI.
# IDE-only installs are displayed but never silently offered unsupported MCP mutation.
$claudeVsCodeDetected = [bool](Get-ChildItem -Path (Join-Path $env:USERPROFILE '.vscode\extensions\anthropic.claude-code-*') -Directory -ErrorAction SilentlyContinue | Select-Object -First 1)
$antigravityIdeCandidates = @(
    $(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'Programs\Antigravity\Antigravity.exe' }),
    $(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'Programs\Google Antigravity\Antigravity.exe' }),
    $(if ($env:ProgramFiles) { Join-Path $env:ProgramFiles 'Google\Antigravity\Antigravity.exe' })
) | Where-Object { $_ }
$antigravityIdePath = @($antigravityIdeCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1)
$antigravityIdeDetected = $antigravityIdePath.Count -gt 0
$explicitSelection = @(
    @('Preset', 'CustomComponent', 'ComponentAction', 'Provider', 'Force', 'UpdateInstalled', 'InstallUsageTracker', 'SkipUsageTracker', 'SkipProviderConfiguration', 'Confirm') |
        Where-Object { $PSBoundParameters.ContainsKey($_) }
)
$wizardMode = $terminal.Interactive -and -not $ValidateOnly -and -not $WhatIfPreference -and -not $env:CI -and $explicitSelection.Count -eq 0

if ($wizardMode) {
    try {
        Write-AfyxSection -Title 'Welcome & Environment' -Terminal $terminal
        Write-AfyxStatus -Status INFO -Name 'Afyx Forge Core' -Detail 'optional Alpha guidance component; formal A8 remains evaluation gated' -Terminal $terminal
        Write-AfyxStatus -Status INFO -Name 'Afyx Context' -Detail 'optional to install; enabled by default when healthy; used only when needed' -Terminal $terminal
        $presetOptions = @(
            [pscustomobject]@{ Id = 'recommended'; Label = 'Recommended'; Detail = 'Core skills + Engineering Expert'; Enabled = $true },
            [pscustomobject]@{ Id = 'minimal'; Label = 'Minimal'; Detail = 'Core engineering skills'; Enabled = $true },
            [pscustomobject]@{ Id = 'full'; Label = 'Full'; Detail = 'Recommended + Graph + Codex usage tracking'; Enabled = $true },
            [pscustomobject]@{ Id = 'custom'; Label = 'Custom'; Detail = 'Choose exact components'; Enabled = $true }
        )
        $Preset = Read-AfyxSingleChoice -Prompt 'Choose an installation preset' -Options $presetOptions -DefaultId 'recommended' -Terminal $terminal
        if ($Preset -eq 'custom') {
            $componentOptions = @()
            foreach ($component in @(Get-AfyxComponentContract)) {
                $detail = "$($component.type); $($component.tier)"
                if ([string]$component.id -eq 'afyx-context') { $detail += '; optional to install, enabled unless explicitly OFF, used on demand' }
                elseif ([string]$component.id -eq 'afyx-forge') { $detail += '; alpha; bounded engineering guidance' }
                elseif ([string]$component.id -eq 'codex-usage-tracking') { $detail += '; Codex/Windows only' }
                $componentOptions += [pscustomobject]@{ Id = [string]$component.id; Label = [string]$component.name; Detail = $detail; Enabled = $true }
            }
            $CustomComponent = @(Read-AfyxMultiChoice -Prompt 'Select components' -Options $componentOptions -DefaultId @('efficient-coding', 'odoo-engineering') -Terminal $terminal)
        }

        $codexDetected = [bool]$codexCommandDetected
        $antigravityDetected = [bool]$antigravityCommandDetected
        $claudeDetected = [bool]$claudeCommandDetected
        $providerOptions = @(
            [pscustomobject]@{ Id = 'codex'; Label = 'Codex'; Detail = $(if ($codexDetected) { 'native CLI detected' } elseif ($vscodeExtensionDetected) { 'extension detected; native Codex CLI is still required for MCP configuration' } else { $codexHost.Detail }); Enabled = $codexDetected },
            [pscustomobject]@{ Id = 'antigravity'; Label = 'Antigravity'; Detail = $(if ($antigravityDetected) { 'CLI detected; MCP adapter supported' } elseif ($antigravityIdeDetected) { 'IDE detected; compatible CLI not found, MCP integration unavailable' } else { 'not detected: agy/antigravity CLI or recognized IDE path' }); Enabled = $antigravityDetected },
            [pscustomobject]@{ Id = 'claude'; Label = 'Claude Code'; Detail = $(if ($claudeDetected) { 'CLI detected; MCP adapter supported' } elseif ($claudeVsCodeDetected) { 'VS Code extension detected; native Claude CLI required for MCP configuration' } else { 'not detected: install Claude Code CLI' }); Enabled = $claudeDetected },
            [pscustomobject]@{ Id = 'skip'; Label = 'Skip provider configuration'; Detail = 'skills/runtimes only; no MCP registration'; Enabled = $true }
        )
        $detectedProviderDefaults = @($providerOptions | Where-Object { $_.Enabled -and $_.Id -ne 'skip' } | ForEach-Object { $_.Id })
        if (-not $detectedProviderDefaults.Count) { $detectedProviderDefaults = @('skip') }
        $providerChoice = @(Read-AfyxMultiChoice -Prompt 'Select provider integrations' -Options $providerOptions -DefaultId $detectedProviderDefaults -Terminal $terminal)
        if ('skip' -in $providerChoice) {
            if ($providerChoice.Count -ne 1) { throw 'Skip provider configuration cannot be combined with a provider.' }
            $Provider = @()
            $SkipProviderConfiguration = $true
        } else {
            $Provider = @($providerChoice)
            if (-not $Provider.Count) { $SkipProviderConfiguration = $true }
        }
        if (@($Provider | Where-Object { $_ -in @('antigravity', 'claude') }).Count) {
            $workspaceCompatible = 'codex' -notin $Provider
            $scopeOptions = @(
                [pscustomobject]@{ Id = 'workspace'; Label = 'Workspace'; Detail = $(if ($workspaceCompatible) { 'project-local provider skills and MCP configuration' } else { 'unavailable when Codex is selected; Codex MCP is user-scoped' }); Enabled = $workspaceCompatible },
                [pscustomobject]@{ Id = 'global'; Label = 'Global'; Detail = 'user-level configuration for every selected provider'; Enabled = $true }
            )
            $ProviderScope = Read-AfyxSingleChoice -Prompt 'Choose compatible provider scope' -Options $scopeOptions -DefaultId $(if ($workspaceCompatible) { 'workspace' } else { 'global' }) -Terminal $terminal
        }
    } catch [System.OperationCanceledException] {
        Write-AfyxStatus -Status SKIPPED -Name 'Installation cancelled' -Detail 'no configuration changes were made' -Terminal $terminal
        exit 130
    }
}

if (-not $Provider.Count) {
    if (-not $wizardMode -and -not $SkipProviderConfiguration -and -not $ValidateOnly -and -not $WhatIfPreference -and -not $env:CI -and $terminal.Interactive) {
        $detected = @()
        if ($codexCommandDetected) { $detected += 'codex' }
        if ($antigravityCommandDetected) { $detected += 'antigravity' }
        if ($claudeCommandDetected) { $detected += 'claude' }
        Write-Host "Provider hosts detected: $(if ($detected.Count) { $detected -join ', ' } else { 'none' })"
        do { $choice = (Read-Host 'Provider selection: [A] All detected / [R] Recommended Codex / [C] Custom / [S] Skip [A]').Trim() } until ($choice -match '(?i)^(|a|all|r|recommended|c|custom|s|skip)$')
        if ($choice -match '(?i)^(|a|all)$') { if ($detected.Count) { $Provider = $detected } else { $SkipProviderConfiguration = $true } }
        elseif ($choice -match '(?i)^(c|custom)$') { $Provider = @((Read-Host 'Provider ids (comma-separated)').Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ }) }
        elseif ($choice -match '(?i)^(s|skip)$') { $SkipProviderConfiguration = $true }
        else { $Provider = @('codex') }
    } elseif (-not $SkipProviderConfiguration) { $Provider = @('codex') }
}
$unknownProviders = @($Provider | Where-Object { $_ -notin $providerIds })
if ($unknownProviders.Count) { throw "Unknown provider(s): $($unknownProviders -join ', ')" }
$Provider = @($providerIds | Where-Object { $_ -in $Provider })
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
$efficientTarget = Join-Path $SkillsRoot 'efficient-coding'
$odooTarget = Join-Path $SkillsRoot 'odoo-engineering'
$expertTarget = Join-Path $SkillsRoot 'afyx-engineering-expert'
$componentContext = New-AfyxComponentContext -SkillsRoot $SkillsRoot -GraphRoot $graphRuntimeRoot -ContextRoot $ContextRuntimeRoot -ForgeRoot $ForgeRuntimeRoot -CodexHome $codexHome
$componentStates = @{}
foreach ($componentState in (Get-AfyxComponentStates -Context $componentContext)) { $componentStates[$componentState.Id] = $componentState }
foreach ($component in (Get-AfyxComponentContract | Where-Object { $_.type -eq 'skill' })) {
    $state = $componentStates[[string]$component.id]
    if ($state.State -eq 'NOT INSTALLED') { continue }
    $installedOwnership = Get-AfyxSkillOwnership -Target $state.Path -Component ([string]$component.id) -ExpectedOwner ([string]$component.ownership)
    if ($installedOwnership -eq 'AFYX_OWNED_MODIFIED') {
        $state.State = 'DRIFTED'
        $state.Detail = 'Afyx ownership verified but installed content was modified'
    } elseif ($installedOwnership -notin @('AFYX_OWNED_UNMODIFIED', 'EXTERNAL_UPSTREAM')) {
        $state.State = 'UNKNOWN'
        $state.Detail = "installed ownership is $installedOwnership"
    }
}
$componentActions = @{}
$retiredComponentIds = @('prompt-master', 'headroom')
function Assert-ActiveComponentId([string]$Id) {
    if ($Id -in $retiredComponentIds) {
        throw "Component '$Id' is retired from Afyx Kit and remains externally/user managed; no changes were made."
    }
}
foreach ($specification in $ComponentAction) {
    if ($specification -notmatch '^([a-z0-9-]+)=(skip|install|update|repair|adopt)$') {
        throw "Invalid -ComponentAction '$specification'. Use component-id=skip|install|update|repair|adopt."
    }
    Assert-ActiveComponentId $Matches[1]
    $componentActions[$Matches[1]] = $Matches[2]
}
$knownSelectable = @('efficient-coding', 'odoo-engineering', 'afyx-engineering-expert', 'afyx-graph', 'afyx-context', 'afyx-forge', 'codex-usage-tracking')
foreach ($id in $componentActions.Keys) { if ($id -notin $knownSelectable) { throw "Unknown selectable component: $id" } }
if ($Preset -and $Preset -notin @('minimal', 'recommended', 'full', 'custom')) { throw "Unknown preset: $Preset" }
if (-not $Preset -and $CustomComponent.Count) { throw '-CustomComponent requires -Preset custom.' }
foreach ($id in $CustomComponent) { Assert-ActiveComponentId $id }
if ($Preset -and ($ComponentAction.Count -or $Force -or $InstallUsageTracker -or $SkipUsageTracker)) {
    throw 'A preset is immutable for one operation; do not combine it with ComponentAction, Force, InstallUsageTracker, or SkipUsageTracker.'
}
$controlPlan = if ($Preset) { Get-AfyxControlPlan -Preset $Preset -CustomComponent $CustomComponent -Provider $Provider -Context $componentContext -StateById $componentStates } else { $null }

function Get-AvailableVersion([string]$Id) {
    switch ($Id) {
        'efficient-coding' { return Get-AfyxSkillVersion -Directory $bundledEfficientCoding }
        'odoo-engineering' { return Get-AfyxSkillVersion -Directory $bundledOdooEngineering }
        'afyx-engineering-expert' { return Get-AfyxSkillVersion -Directory $bundledEngineeringExpert }
        'afyx-graph' { return (Get-Content -Raw -LiteralPath $graphMetadataPath | ConvertFrom-Json).product_version }
        'afyx-context' { return (Get-Content -Raw -LiteralPath $contextMetadataPath | ConvertFrom-Json).product_version }
        'afyx-forge' { return (Get-Content -Raw -LiteralPath $forgeMetadataPath | ConvertFrom-Json).product_version }
        default { return '' }
    }
}

function Compare-AfyxVersion([string]$Installed, [string]$Available) {
    if (-not $Installed -or -not $Available) { return 0 }
    try { return ([version]$Installed).CompareTo([version]$Available) }
    catch { return [string]::Compare($Installed, $Available, $true) }
}

function Get-ComponentAction([string]$Id, [string]$Label) {
    $state = $componentStates[$Id]
    if ($componentActions.ContainsKey($Id)) { $action = $componentActions[$Id] }
    elseif ($controlPlan) {
        $planItem = @($controlPlan.Components | Where-Object { $_.Id -eq $Id })[0]
        if (-not $planItem.Desired -or $planItem.Drift -eq 'NOT_APPLICABLE') { $action = 'skip' }
        elseif ($planItem.Repair -eq 'BLOCKED') { $action = 'blocked' }
        elseif ($planItem.Repair -eq 'INSTALL') { $action = 'install' }
        elseif ($planItem.Repair -eq 'REPAIR') { $action = 'repair' }
        else {
            $available = Get-AvailableVersion $Id
            $action = if ($state.State -eq 'HEALTHY' -and $available -and (Compare-AfyxVersion $state.Version $available) -lt 0) { 'update' } else { 'skip' }
        }
    }
    elseif ($Force) {
        if ($state.State -eq 'UNKNOWN') { throw "$Label ownership is unknown; -Force cannot take ownership." }
        $action = if ($state.State -eq 'NOT INSTALLED') { 'install' } elseif ($state.State -in @('INCOMPLETE', 'INVALID', 'DRIFTED')) { 'repair' } else { 'update' }
    } elseif ($UpdateInstalled) {
        $available = Get-AvailableVersion $Id
        if ($state.State -in @('INCOMPLETE', 'INVALID', 'DRIFTED')) { $action = 'repair' }
        elseif ($state.State -eq 'HEALTHY' -and $available -and (Compare-AfyxVersion $state.Version $available) -lt 0) { $action = 'update' }
        else { $action = 'skip' }
    } elseif ($WhatIfPreference -or $env:CI -or -not $terminal.Interactive) { $action = 'skip' }
    else {
        $available = Get-AvailableVersion $Id
        $versionDetail = if ($state.Version -or $available) { " installed=$($state.Version) available=$available" } else { '' }
        if ($state.State -eq 'NOT INSTALLED') {
            do { $answer = (Read-Host "$Label is not installed.$versionDetail [I] Install / [S] Skip [S]").Trim() } until ($answer -match '(?i)^(|i|install|s|skip)$')
            $action = if ($answer -match '(?i)^(i|install)$') { 'install' } else { 'skip' }
        } elseif ($state.State -eq 'HEALTHY') {
            $default = if ($available -and (Compare-AfyxVersion $state.Version $available) -lt 0) { 'U' } else { 'S' }
            do { $answer = (Read-Host "$Label is healthy.$versionDetail [U] Update / [S] Skip [$default]").Trim() } until ($answer -match '(?i)^(|u|update|s|skip)$')
            $action = if ($answer -match '(?i)^(u|update)$' -or (-not $answer -and $default -eq 'U')) { 'update' } else { 'skip' }
        } elseif ($state.State -in @('INCOMPLETE', 'INVALID', 'DRIFTED')) {
            do { $answer = (Read-Host "$Label is $($state.State): $($state.Detail) [R] Repair / [S] Skip [S]").Trim() } until ($answer -match '(?i)^(|r|repair|s|skip)$')
            $action = if ($answer -match '(?i)^(r|repair)$') { 'repair' } else { 'skip' }
        } else {
            do { $answer = (Read-Host "$Label ownership/health is unknown. [A] Adopt verified legacy install / [S] Skip [S]").Trim() } until ($answer -match '(?i)^(|a|adopt|s|skip)$')
            $action = if ($answer -match '(?i)^(a|adopt)$') { 'adopt' } else { 'skip' }
        }
    }
    if ($action -eq 'blocked') { return $action }
    $allowed = switch ($state.State) {
        'NOT INSTALLED' { @('install', 'skip') }
        'HEALTHY' { @('update', 'adopt', 'skip') }
        { $_ -in @('INCOMPLETE', 'INVALID', 'DRIFTED') } { @('repair', 'skip') }
        'UNKNOWN' { @('adopt', 'skip') }
        default { @('skip') }
    }
    if ($action -notin $allowed) { throw "$Label state $($state.State) does not permit '$action' (allowed: $($allowed -join ', '))." }
    return $action
}

function Resolve-ComponentAction([string]$Id, [string]$Label) {
    if ($Id -eq 'codex-usage-tracking') {
        if ('codex' -notin $Provider) { return 'skip' }
        if ($InstallUsageTracker) {
            $state = $componentStates[$Id]
            if ($state.State -eq 'NOT INSTALLED') { return 'install' }
            if ($state.State -in @('INCOMPLETE', 'INVALID', 'DRIFTED')) { return 'repair' }
            return 'update'
        }
        if ($SkipUsageTracker) { return 'skip' }
    }
    return Get-ComponentAction $Id $Label
}

function Test-SkillManifest([string]$SkillDirectory) {
    $manifest = Join-Path $SkillDirectory 'SKILL.md'
    if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) { return $false }
    return (Get-Content -LiteralPath $manifest -TotalCount 1 -Encoding utf8) -eq '---'
}

function Read-ReplaceChoice([string]$Label) {
    if ($Force) { return 'Replace' }
    if ($WhatIfPreference -or $env:CI -or -not $terminal.Interactive) { return 'Skip' }
    do { $answer = (Read-Host "$Label [S] Skip / [R] Replace [S]").Trim() } until ($answer -match '(?i)^(|s|skip|r|replace)$')
    if ($answer -match '(?i)^(r|replace)$') { return 'Replace' }
    return 'Skip'
}

function Read-InstallChoice([string]$Label) {
    if ($WhatIfPreference -or $env:CI -or -not $terminal.Interactive) { return $false }
    do { $answer = (Read-Host "$Label [Y/N] [N]").Trim() } until ($answer -match '(?i)^(|y|yes|n|no)$')
    return $answer -match '(?i)^(y|yes)$'
}

function Install-ManagedSkillSafely([string]$Component, [string]$Name, [string]$Source, [string]$Target, [bool]$ReplaceExisting, [string]$InstallRoot = $SkillsRoot, [bool]$AuthorizeRepair = $false) {
    if ((Test-Path -LiteralPath $Target) -and -not $ReplaceExisting) { return 'skipped' }
    if ($WhatIfPreference) { Write-Host "WhatIf: would stage and install $Name at $Target"; return 'planned' }
    Assert-AfyxSkillTarget -SkillsRoot $InstallRoot -Target $Target
    $parent = Split-Path -Parent $Target
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    $stage = Join-Path $parent ".$((Split-Path -Leaf $Target))-stage-$([guid]::NewGuid().ToString('N'))"
    try {
        Copy-Item -LiteralPath $Source -Destination $stage -Recurse -Force -ErrorAction Stop
        if (-not (Test-SkillManifest $stage)) { throw "$Name staged manifest is invalid." }
        $planRepair = $controlPlan -and @($controlPlan.Components | Where-Object { $_.Id -eq $Component -and $_.Repair -eq 'REPAIR' }).Count -eq 1
        $authorized = $Force -or $componentActions.ContainsKey($Component) -or $planRepair -or $AuthorizeRepair
        Install-AfyxSkillTransaction -SkillsRoot $InstallRoot -Component $Component -Name $Name -Stage $stage -Target $Target -Owner afyx -Version (Get-AfyxSkillVersion -Directory $Source) -AuthorizeUnproven:$authorized
    } finally {
        if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }
    }
    return $(if ($ReplaceExisting) { 'replaced' } else { 'installed' })
}

function Adopt-LegacySkillSafely([string]$Component, [string]$Name, [string]$Target) {
    $contract = @(Get-AfyxComponentContract | Where-Object { $_.id -eq $Component })[0]
    $legacyVersion = if ($contract.PSObject.Properties['legacy_version']) { [string]$contract.legacy_version } else { '' }
    $legacyDigest = if ($contract.PSObject.Properties['legacy_content_digest']) { [string]$contract.legacy_content_digest } else { '' }
    $repository = if ($contract.PSObject.Properties['source']) { [string]$contract.source } else { '' }
    $revision = if ($contract.PSObject.Properties['source_revision']) { [string]$contract.source_revision } else { '' }
    $current = Get-AfyxSkillOwnership -Target $Target -Component $Component -ExpectedOwner ([string]$contract.ownership)
    if ($current -in @('AFYX_OWNED_UNMODIFIED', 'EXTERNAL_UPSTREAM')) { return 'already adopted' }
    $provenance = Get-AfyxLegacySkillProvenance -Target $Target -Component $Component -Owner ([string]$contract.ownership) `
        -LegacyVersion $legacyVersion -LegacyContentSha256 $legacyDigest -SourceRepository $repository -SourceRevision $revision
    if ($provenance -ne 'MATCH') { throw "Refusing to adopt $Name because legacy provenance is $provenance." }
    if ($WhatIfPreference) { Write-Host "WhatIf: would adopt verified legacy $Name at $Target after durable backup"; return 'planned adoption' }
    return Adopt-AfyxLegacySkill -SkillsRoot $SkillsRoot -Target $Target -Component $Component -Owner ([string]$contract.ownership) `
        -Version $legacyVersion -LegacyVersion $legacyVersion -LegacyContentSha256 $legacyDigest `
        -SourceRepository $repository -SourceRevision $revision
}

if (-not (Test-SkillManifest $bundledEfficientCoding)) { throw 'Bundled Efficient Coding is invalid or missing.' }
if (-not (Test-SkillManifest $bundledOdooEngineering)) { throw 'Bundled Odoo Engineering is invalid or missing.' }
if (-not (Test-SkillManifest $bundledEngineeringExpert)) { throw 'Bundled Afyx Engineering Expert is invalid or missing.' }
if (-not (Test-Path -LiteralPath $graphMetadataPath -PathType Leaf)) { throw 'Bundled Afyx Graph metadata is missing.' }
if (-not (Test-Path -LiteralPath $contextMetadataPath -PathType Leaf)) { throw 'Bundled Afyx Context metadata is missing.' }

$componentLabels = [ordered]@{
    'efficient-coding' = 'Efficient Coding'
    'odoo-engineering' = 'Odoo Engineering'
    'afyx-engineering-expert' = 'Afyx Engineering Expert'
    'afyx-graph' = 'Afyx Graph'
    'afyx-context' = 'Afyx Context Engine'
    'afyx-forge' = 'Afyx Forge Core'
    'codex-usage-tracking' = 'Usage Tracking'
}
$actionDecisions = [ordered]@{}
if ($controlPlan) {
    foreach ($decision in $componentLabels.GetEnumerator()) {
        $actionDecisions[$decision.Key] = Resolve-ComponentAction ([string]$decision.Key) ([string]$decision.Value)
    }
}

$codexCliDetected = [bool]$codexCommandDetected
$graphMetadata = Get-Content -Raw -LiteralPath $graphMetadataPath | ConvertFrom-Json
$distProductPath = Join-Path $packageRoot 'afyx-graph\engine\scripts\distribution-product.json'
$graphReleaseChannel = if (Test-Path -LiteralPath $distProductPath -PathType Leaf) {
    (Get-Content -Raw -LiteralPath $distProductPath | ConvertFrom-Json).releaseChannel
} elseif ($graphMetadata.PSObject.Properties['release_channel']) {
    [string]$graphMetadata.release_channel
} else {
    'technical-alpha'
}
$states = [ordered]@{
    'Efficient Coding' = $componentStates['efficient-coding'].State
    'Odoo Engineering' = $componentStates['odoo-engineering'].State
    'Afyx Engineering Expert' = $componentStates['afyx-engineering-expert'].State
    'Afyx Graph' = $componentStates['afyx-graph'].State
    'Afyx Context Engine' = $componentStates['afyx-context'].State
    'Afyx Forge Core' = $componentStates['afyx-forge'].State
    'Usage Tracking' = $componentStates['codex-usage-tracking'].State
}
Write-AfyxSection -Title 'Component Inventory' -Terminal $terminal
foreach ($entry in $states.GetEnumerator()) {
    $id = switch ($entry.Key) { 'Efficient Coding' { 'efficient-coding' } 'Odoo Engineering' { 'odoo-engineering' } 'Afyx Engineering Expert' { 'afyx-engineering-expert' } 'Afyx Graph' { 'afyx-graph' } 'Afyx Context Engine' { 'afyx-context' } 'Afyx Forge Core' { 'afyx-forge' } default { 'codex-usage-tracking' } }
    $installed = $componentStates[$id].Version
    $available = Get-AvailableVersion $id
    $status = if ($entry.Value -eq 'HEALTHY' -and $installed -and $available -and (Compare-AfyxVersion $installed $available) -lt 0) { 'UPDATE AVAILABLE' }
        elseif ($entry.Value -eq 'HEALTHY') { 'HEALTHY' }
        elseif ($entry.Value -eq 'NOT INSTALLED') { 'NOT INSTALLED' }
        else { 'BLOCKED' }
    $detail = "installed=$(if ($installed) { $installed } else { 'n/a' }); available=$(if ($available) { $available } else { 'external/n/a' }); ownership=$($componentStates[$id].Ownership)"
    Write-AfyxStatus -Status $status -Name $entry.Key -Detail $detail -Terminal $terminal
}
if ($controlPlan) {
    Write-AfyxSection -Title "Desired State Plan | $($controlPlan.Identity)" -Terminal $terminal
    foreach ($item in $controlPlan.Components) {
        $decidedAction = [string]$actionDecisions[[string]$item.Id]
        $planStatus = if ($decidedAction -eq 'blocked') { 'BLOCKED' }
            elseif ($decidedAction -ne 'skip') { 'PLANNED' }
            elseif ($item.Drift -eq 'IN_SYNC') { 'NO CHANGE' }
            elseif ($item.Drift -eq 'EXTRA') { 'EXTRA' }
            else { 'SKIPPED' }
        $planDetail = "action=$decidedAction; desired=$($item.Desired); actual=$($item.ActualState); drift=$($item.Drift); ownership=$($item.ActualOwnership); repair=$($item.Repair)"
        if ($planStatus -eq 'EXTRA') { $planDetail += '; installed optional component is outside this desired preset and will be preserved' }
        Write-AfyxStatus -Status $planStatus -Name $item.Id -Detail $planDetail -Terminal $terminal
    }
}
Write-AfyxSection -Title 'Prerequisite Inventory' -Terminal $terminal
$gitVersion = try { (& git --version 2>$null) -join ' ' } catch { '' }
$nodeVersion = try { (& node --version 2>$null) -join ' ' } catch { '' }
$npmVersion = try { (& npm --version 2>$null) -join ' ' } catch { '' }
Write-AfyxStatus -Status HEALTHY -Name 'OS/architecture [REQUIRED]' -Detail "$([System.Runtime.InteropServices.RuntimeInformation]::OSDescription) / $([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture)" -Terminal $terminal
Write-AfyxStatus -Status HEALTHY -Name 'Platform shell [REQUIRED]' -Detail "PowerShell $($PSVersionTable.PSVersion)" -Terminal $terminal
Write-AfyxStatus -Status $(if ($gitVersion) { 'HEALTHY' } else { 'BLOCKED' }) -Name 'Git [REQUIRED]' -Detail $(if ($gitVersion) { $gitVersion } else { 'missing; install Git for Windows from https://git-scm.com/' }) -Terminal $terminal
$codexRequired = 'codex' -in $Provider -or -not $Provider.Count
$codexStatus = if ($codexCliDetected) { 'HEALTHY' } elseif ($codexRequired) { 'BLOCKED' } elseif ($vscodeExtensionDetected) { 'HEALTHY' } else { 'SKIPPED' }
$codexLabel = if ($codexRequired) { 'Codex host [REQUIRED]' } else { 'Codex host' }
$codexDetail = if ($codexCliDetected) { "native CLI detected ($($codexHost.Command))" } elseif ($codexRequired) { "$($codexHost.Detail) A VS Code extension does not provide native MCP configuration." } elseif ($vscodeExtensionDetected) { 'VS Code extension detected; native CLI not selected' } else { 'not detected; required only when selected' }
Write-AfyxStatus -Status $codexStatus -Name $codexLabel -Detail $codexDetail -Terminal $terminal
Write-AfyxStatus -Status $(if ($antigravityCommandDetected) { 'HEALTHY' } else { 'SKIPPED' }) -Name 'Antigravity host' -Detail $(if ($antigravityCommandDetected) { 'compatible CLI detected' } elseif ($antigravityIdeDetected) { 'IDE detected; compatible CLI required for automatic MCP registration' } else { 'not detected; required only when selected' }) -Terminal $terminal
Write-AfyxStatus -Status $(if ($claudeCommandDetected) { 'HEALTHY' } else { 'SKIPPED' }) -Name 'Claude Code host' -Detail $(if ($claudeCommandDetected) { 'compatible CLI detected' } elseif ($claudeVsCodeDetected) { 'VS Code extension detected; compatible CLI required for MCP registration' } else { 'not detected; required only when selected' }) -Terminal $terminal
Write-AfyxStatus -Status $(if ($nodeVersion) { 'HEALTHY' } else { 'BLOCKED' }) -Name 'Node.js >=22.5.0 [COMPONENT_REQUIRED:Graph/Context]' -Detail $(if ($nodeVersion) { $nodeVersion } else { 'missing; install from https://nodejs.org/ before selecting Graph or Context' }) -Terminal $terminal
Write-AfyxStatus -Status $(if ($npmVersion) { 'HEALTHY' } else { 'SKIPPED' }) -Name 'npm [BUILD_ONLY:Afyx Graph]' -Detail $(if ($npmVersion) { $npmVersion } else { 'missing; needed only for automatic local fallback' }) -Terminal $terminal
Write-AfyxStatus -Status HEALTHY -Name 'Archive/checksum [COMPONENT_REQUIRED:Afyx Graph]' -Detail 'Expand-Archive + Get-FileHash available' -Terminal $terminal
$sourceBranch = if ($gitVersion) { (& git -C $packageRoot branch --show-current 2>$null) -join '' } else { 'unavailable' }
$sourceCommit = if ($gitVersion) { (& git -C $packageRoot rev-parse HEAD 2>$null) -join '' } else { 'unavailable' }
$sourceDirty = if ($gitVersion) { [bool]((& git -C $packageRoot status --porcelain 2>$null) -join '') } else { $false }
if (-not $sourceBranch) { $sourceBranch = 'DETACHED' }
Write-AfyxStatus -Status $(if ($sourceDirty) { 'WARNING' } else { 'HEALTHY' }) -Name 'Source identity' -Detail "branch=$sourceBranch; commit=$sourceCommit; dirty=$sourceDirty; channel=$graphReleaseChannel" -Terminal $terminal
Write-AfyxSection -Title 'Provider Plan' -Terminal $terminal
if ($SkipProviderConfiguration) { Write-AfyxStatus -Status SKIPPED -Name 'Provider configuration' -Detail 'skipped explicitly; no provider configuration will change' -Terminal $terminal }
foreach ($providerId in $Provider) {
    $providerRecord = @($providerRegistry | Where-Object { $_.provider -eq $providerId })[0]
    $detected = if ($providerId -eq 'codex') { [bool]$codexCommandDetected }
        elseif ($providerId -eq 'antigravity') { [bool]$antigravityCommandDetected }
        else { [bool]$claudeCommandDetected }
    $configPath = if ($providerId -eq 'codex') { Join-Path $codexHome 'config.toml' }
        elseif ($providerId -eq 'antigravity' -and $ProviderScope -eq 'workspace') { Join-Path $WorkspaceRoot '.agents\mcp_config.json' }
        elseif ($providerId -eq 'antigravity') { Join-Path $GeminiHome 'config\mcp_config.json' }
        elseif ($ProviderScope -eq 'workspace') { Join-Path $WorkspaceRoot '.mcp.json' }
        elseif ($ClaudeConfigDir) { Join-Path $ClaudeConfigDir '.claude.json' }
        else { Join-Path $env:USERPROFILE '.claude.json' }
    $effectiveScope = if ($providerId -eq 'codex') { 'global' } else { $ProviderScope }
    Write-AfyxStatus -Status $(if ($detected) { 'PLANNED' } else { 'BLOCKED' }) -Name $providerRecord.name -Detail "detected=$detected; scope=$effectiveScope; capabilities=$($providerRecord.capabilities); planned-config=$configPath" -Terminal $terminal
    if ($providerId -eq 'antigravity') {
        $plannedSkills = if ($ProviderScope -eq 'workspace') { Join-Path $WorkspaceRoot '.agents\skills' }
            else { @((Join-Path $GeminiHome 'config\skills'), (Join-Path $GeminiHome 'antigravity-cli\skills')) -join ';' }
        Write-AfyxStatus -Status PLANNED -Name 'Antigravity skills' -Detail $plannedSkills -Terminal $terminal
    } elseif ($providerId -eq 'claude') {
        $plannedSkills = if ($ProviderScope -eq 'workspace') { Join-Path $WorkspaceRoot '.claude\skills' } else { Join-Path $ClaudeHome 'skills' }
        Write-AfyxStatus -Status PLANNED -Name 'Claude Code skills' -Detail $plannedSkills -Terminal $terminal
    }
}
$graphState = $states['Afyx Graph']
$graphAction = if ($ValidateOnly) { 'skip' } elseif ($controlPlan) { [string]$actionDecisions['afyx-graph'] } else { Resolve-ComponentAction 'afyx-graph' 'Afyx Graph' }
$providerTool = Join-Path $packageRoot 'scripts\afyx-provider-integration.mjs'
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$plannedProviderEntry = Join-Path $graphRuntimeRoot 'current\lib\dist\bin\afyx-graph.js'
$providerMcpRequested = -not $SkipGraphMcp -and -not $SkipProviderConfiguration -and $Provider.Count -and `
    ($graphAction -ne 'skip' -or (Test-Path -LiteralPath $plannedProviderEntry -PathType Leaf))
function Get-AfyxProviderArguments([string]$Entry) {
    $arguments = @($providerTool, '--providers', ($Provider -join ','), '--scope', $ProviderScope,
        '--workspace-root', $WorkspaceRoot, '--gemini-home', $GeminiHome, '--codex-home', $codexHome,
        '--node', $nodeCommand.Source, '--entry', $Entry)
    if ($codexCommandDetected) { $arguments += @('--codex', $codexCommandDetected.Source) }
    if ($claudeCommandDetected) { $arguments += @('--claude', $claudeCommandDetected.Source) }
    if ($ClaudeConfigDir) { $arguments += @('--claude-config-dir', $ClaudeConfigDir) }
    return $arguments
}
if (-not $ValidateOnly -and $providerMcpRequested -and $nodeCommand -and ('codex' -notin $Provider -or $codexCliDetected)) {
    $preflightArguments = Get-AfyxProviderArguments $plannedProviderEntry
    $preflightJson = (& $nodeCommand.Source @preflightArguments 2>$null) -join ''
    try { $preflightResult = $preflightJson | ConvertFrom-Json -Depth 20 }
    catch { throw "Provider preflight did not return valid JSON: $preflightJson" }
    if (-not $preflightResult -or -not $preflightResult.PSObject.Properties['providers']) {
        throw "Provider preflight result missing 'providers': $preflightJson"
    }
    $preflightBlocked = @($preflightResult.providers | Where-Object {
        $_.status -in @('BLOCKED', 'INCOMPATIBLE') -and
        -not ($_.reason -eq 'GRAPH_RUNTIME_UNAVAILABLE' -and $graphAction -ne 'skip')
    })
    if ($preflightBlocked.Count) {
        $blocked = $preflightBlocked[0]
        throw "Provider plan is blocked before mutation: $($blocked.provider): $($blocked.reason): $($blocked.detail)"
    }
}

if ($ValidateOnly) {
    [pscustomobject]@{
        BundledEfficientCoding = Test-SkillManifest $bundledEfficientCoding
        InstalledEfficientCoding = $states['Efficient Coding'] -eq 'HEALTHY'
        EfficientCodingState = $states['Efficient Coding']
        EfficientCodingVersion = $componentStates['efficient-coding'].Version
        BundledOdooEngineering = Test-SkillManifest $bundledOdooEngineering
        InstalledOdooEngineering = $states['Odoo Engineering'] -eq 'HEALTHY'
        OdooEngineeringState = $states['Odoo Engineering']
        OdooEngineeringVersion = $componentStates['odoo-engineering'].Version
        BundledAfyxEngineeringExpert = Test-SkillManifest $bundledEngineeringExpert
        InstalledAfyxEngineeringExpert = $states['Afyx Engineering Expert'] -eq 'HEALTHY'
        AfyxEngineeringExpertState = $states['Afyx Engineering Expert']
        AfyxEngineeringExpertVersion = $componentStates['afyx-engineering-expert'].Version
        BundledAfyxGraphSource = Test-Path -LiteralPath (Join-Path $packageRoot 'afyx-graph\engine\package.json')
        InstalledAfyxGraph = $states['Afyx Graph'] -eq 'HEALTHY'
        AfyxGraphState = $states['Afyx Graph']
        AfyxGraphVersion = $graphMetadata.product_version
        AfyxGraphRuntimeRoot = $graphRuntimeRoot
        BundledAfyxContextSource = Test-Path -LiteralPath (Join-Path $packageRoot 'afyx-context\package.json')
        InstalledAfyxContext = $states['Afyx Context Engine'] -eq 'HEALTHY'
        AfyxContextState = $states['Afyx Context Engine']
        AfyxContextVersion = (Get-Content -Raw -LiteralPath $contextMetadataPath | ConvertFrom-Json).product_version
        AfyxContextRuntimeRoot = $ContextRuntimeRoot
        BundledAfyxForgeSource = Test-Path -LiteralPath (Join-Path $packageRoot 'afyx-forge\afyx-forge.json')
        InstalledAfyxForge = $states['Afyx Forge Core'] -eq 'HEALTHY'
        AfyxForgeState = $states['Afyx Forge Core']
        AfyxForgeVersion = (Get-Content -Raw -LiteralPath $forgeMetadataPath | ConvertFrom-Json).product_version
        AfyxForgeRuntimeRoot = $ForgeRuntimeRoot
        InstalledUsageTracker = $states['Usage Tracking'] -eq 'HEALTHY'
        UsageTrackerState = $states['Usage Tracking']
        CodexCliDetected = $codexCliDetected
        VsCodeExtensionDetected = $vscodeExtensionDetected
        ControlPlanIdentity = if ($controlPlan) { $controlPlan.Identity } else { 'LEGACY_INTERACTIVE' }
        ControlPlanDrift = if ($controlPlan) { @($controlPlan.Components | Where-Object { $_.Desired -and $_.Drift -ne 'IN_SYNC' -and $_.Drift -ne 'NOT_APPLICABLE' }).Count } else { 0 }
    } | Format-List
    exit 0
}

if ($controlPlan) {
    $blockedPlanItems = @($controlPlan.Components | Where-Object { $_.Desired -and $_.Repair -eq 'BLOCKED' })
    if ($blockedPlanItems.Count) {
        $blockedSummary = ($blockedPlanItems | ForEach-Object { "$($_.Id):$($_.Drift):$($_.ActualOwnership)" }) -join ', '
        throw "Desired-state plan is blocked before mutation: $blockedSummary"
    }
}

if (-not $SkipProviderConfiguration -and 'codex' -in $Provider -and -not $codexCliDetected) { throw "Selected Codex MCP integration requires a native Codex CLI. $($codexHost.Detail)" }
if (-not $SkipProviderConfiguration -and 'antigravity' -in $Provider -and -not $agyCommandDetected -and -not (Get-Command antigravity -ErrorAction SilentlyContinue)) { throw 'Selected Antigravity provider host was not detected.' }
if (-not $SkipProviderConfiguration -and 'claude' -in $Provider -and -not $claudeCommandDetected) { throw 'Selected Claude Code provider host was not detected.' }
if ($providerMcpRequested -and -not $nodeCommand) { throw 'Node.js is required for selected provider MCP configuration.' }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Git is required for Afyx source validation and lifecycle updates.' }

if ($wizardMode) {
    Write-AfyxSection -Title 'Review Actual Planned Changes' -Terminal $terminal
    $mutationPreview = @()
    foreach ($decision in $actionDecisions.GetEnumerator()) {
        if ([string]$decision.Value -eq 'skip') { continue }
        $mutationPreview += [pscustomobject]@{ Id = [string]$decision.Key; Action = [string]$decision.Value }
        Write-AfyxStatus -Status PLANNED -Name ([string]$decision.Key) -Detail ([string]$decision.Value) -Terminal $terminal
    }
    if (-not $SkipProviderConfiguration) {
        foreach ($providerId in $Provider) {
            $effectiveScope = if ($providerId -eq 'codex') { 'global' } else { $ProviderScope }
            Write-AfyxStatus -Status PLANNED -Name "$providerId provider" -Detail "scope=$effectiveScope; Afyx-owned entries only" -Terminal $terminal
        }
    }
    if (-not $mutationPreview.Count) { Write-AfyxStatus -Status 'NO CHANGE' -Name 'Components' -Detail 'selected component versions and ownership are already healthy' -Terminal $terminal }
    try {
        if (($mutationPreview.Count -or (-not $SkipProviderConfiguration -and $Provider.Count)) -and -not (Read-AfyxConfirmation -Prompt 'Apply the reviewed plan?' -Terminal $terminal)) {
            Write-AfyxStatus -Status SKIPPED -Name 'Installation cancelled' -Detail 'no configuration changes were made' -Terminal $terminal
            exit 0
        }
    } catch [System.OperationCanceledException] {
        Write-AfyxStatus -Status SKIPPED -Name 'Installation cancelled' -Detail 'no configuration changes were made' -Terminal $terminal
        exit 130
    }
}

$summary = [ordered]@{}
$changesApplied = $false
$skillActions = @{}
$skillDefinitions = @(
    @{ Id = 'efficient-coding'; Name = 'Efficient Coding'; Source = $bundledEfficientCoding; Target = $efficientTarget },
    @{ Id = 'odoo-engineering'; Name = 'Odoo Engineering'; Source = $bundledOdooEngineering; Target = $odooTarget },
    @{ Id = 'afyx-engineering-expert'; Name = 'Afyx Engineering Expert'; Source = $bundledEngineeringExpert; Target = $expertTarget }
)
# Prevalidate selected runtime companions before skill, runtime, or MCP mutation.
# A foreign or modified provider skill must block the plan, not cause a partial
# install followed by an ownership conflict late in the transaction.
if (-not $SkipProviderConfiguration -and $Provider.Count) {
    $requestedCompanions = @()
    foreach ($id in @('afyx-context', 'afyx-forge')) {
        $selected = if ($controlPlan) { $id -in $controlPlan.DesiredComponents }
            else { $componentActions.ContainsKey($id) -and $componentActions[$id] -ne 'skip' }
        if ($selected -and ($id -ne 'afyx-context' -or $env:AFYX_CONTEXT_OPT_IN -ne '0')) {
            $requestedCompanions += $id
        }
    }
    foreach ($id in $requestedCompanions) {
        foreach ($root in @($providerSkillRoots | Select-Object -Unique)) {
            $candidate = Join-Path $root $id
            $ownership = Get-AfyxSkillOwnership -Target $candidate -Component $id -ExpectedOwner 'afyx'
            if ($ownership -notin @('NOT_INSTALLED', 'AFYX_OWNED_UNMODIFIED')) {
                throw "Provider companion preflight blocked before mutation: $candidate ($ownership)."
            }
        }
    }
}
foreach ($component in $skillDefinitions) {
    $skillActions[$component.Id] = if ($controlPlan) { [string]$actionDecisions[$component.Id] } else { Resolve-ComponentAction $component.Id $component.Name }
}
foreach ($additionalRoot in $additionalSkillRoots) {
    foreach ($component in $skillDefinitions) {
        $replicaDesired = if ($controlPlan) { $component.Id -in $controlPlan.DesiredComponents } else { $skillActions[$component.Id] -notin @('skip', 'adopt') }
        if (-not $replicaDesired) { continue }
        $target = Join-Path $additionalRoot $component.Id
        $ownership = Get-AfyxSkillOwnership -Target $target -Component $component.Id -ExpectedOwner 'afyx'
        if ($ownership -notin @('NOT_INSTALLED', 'AFYX_OWNED_UNMODIFIED', 'AFYX_OWNED_MODIFIED')) {
            throw "Provider skill plan is blocked at $target because ownership is $ownership."
        }
    }
}
foreach ($component in $skillDefinitions) {
    $action = $skillActions[$component.Id]
    if ($action -eq 'skip') { $summary[$component.Name] = 'skipped'; continue }
    Write-AfyxStatus -Status PLANNED -Name $component.Name -Detail "$action in progress" -Terminal $terminal
    if ($action -eq 'adopt') { $summary[$component.Name] = Adopt-LegacySkillSafely $component.Id $component.Name $component.Target }
    else { $summary[$component.Name] = Install-ManagedSkillSafely $component.Id $component.Name $component.Source $component.Target ($action -in @('update', 'repair')) }
    if (-not $WhatIfPreference) { $changesApplied = $true }
}
foreach ($additionalRoot in $additionalSkillRoots) {
    foreach ($component in $skillDefinitions) {
        $action = $skillActions[$component.Id]
        $replicaDesired = if ($controlPlan) { $component.Id -in $controlPlan.DesiredComponents } else { $action -notin @('skip', 'adopt') }
        if (-not $replicaDesired) { continue }
        $target = Join-Path $additionalRoot $component.Id
        $ownership = Get-AfyxSkillOwnership -Target $target -Component $component.Id -ExpectedOwner 'afyx'
        if ($ownership -notin @('NOT_INSTALLED', 'AFYX_OWNED_UNMODIFIED', 'AFYX_OWNED_MODIFIED')) {
            throw "Refusing to replace $($component.Name) at provider skill root $additionalRoot because ownership is $ownership."
        }
        if ($ownership -eq 'AFYX_OWNED_UNMODIFIED' -and (Get-AfyxSkillVersion -Directory $target) -eq (Get-AfyxSkillVersion -Directory $component.Source)) {
            $summary["$($component.Name) [$additionalRoot]"] = 'skipped'
            continue
        }
        $replicate = Install-ManagedSkillSafely $component.Id $component.Name $component.Source $target ($ownership -ne 'NOT_INSTALLED') $additionalRoot ($ownership -eq 'AFYX_OWNED_MODIFIED')
        $summary["$($component.Name) [$additionalRoot]"] = $replicate
        if (-not $WhatIfPreference) { $changesApplied = $true }
    }
}

if ($graphAction -eq 'skip') { $summary['Afyx Graph'] = 'skipped' }
else {
    Write-AfyxStatus -Status PLANNED -Name 'Afyx Graph' -Detail "$graphAction in progress" -Terminal $terminal
    $arguments = if ($graphState -eq 'NOT INSTALLED') { @{} } elseif ($graphAction -eq 'update') { @{ Update = $true } } else { @{ Replace = $true } }
    $arguments.RuntimeRoot = $graphRuntimeRoot
    if ($Offline) { $arguments.Offline = $true }
    if ($NoBuildFallback) { $arguments.NoBuildFallback = $true }
    if ($AllowDirtySource) { $arguments.AllowDirtySource = $true }
    if ($SkipGraphPathUpdate) { $arguments.SkipPathUpdate = $true }
    # ProviderAdapter/v1 owns one transactional MCP configuration pass for every selected provider.
    $arguments.SkipMcp = $true
    & $graphInstaller -Confirm:$false -WhatIf:$WhatIfPreference @arguments
    if (-not $?) { throw 'Afyx Graph installation failed.' }
    $summary['Afyx Graph'] = $graphAction
    if (-not $WhatIfPreference) { $changesApplied = $true }
}

if ($providerMcpRequested) {
    $installedEntry = Join-Path $graphRuntimeRoot 'current\lib\dist\bin\afyx-graph.js'
    $providerArguments = Get-AfyxProviderArguments $installedEntry
    if (-not $WhatIfPreference) { $providerArguments += '--apply' }
    if ($WhatIfPreference) { Write-Host "WhatIf: would configure selected provider MCP entries through ProviderAdapter/v1" }
    elseif (Test-Path -LiteralPath $installedEntry -PathType Leaf) {
        $providerJson = (& $nodeCommand.Source @providerArguments) -join ''
        $providerResult = $providerJson | ConvertFrom-Json -Depth 20
        Write-Host "Provider transaction: $($providerResult.status)"
        if ($LASTEXITCODE -ne 0 -or $providerResult.status -eq 'BLOCKED') { throw "Provider configuration failed: $providerJson" }
        foreach ($providerEntry in $providerResult.providers) { $summary["$($providerEntry.provider) MCP"] = $providerEntry.status }
        if (@($providerResult.providers | Where-Object { $_.changed }).Count) { $changesApplied = $true }
    } else { throw 'Installed Graph entry is unavailable for selected provider configuration.' }
}

$contextState = $states['Afyx Context Engine']
$contextAction = if ($controlPlan) { [string]$actionDecisions['afyx-context'] } else { Resolve-ComponentAction 'afyx-context' 'Afyx Context Engine' }
if ($contextAction -eq 'skip') { $summary['Afyx Context Engine'] = 'skipped' }
else {
    Write-AfyxStatus -Status PLANNED -Name 'Afyx Context Engine' -Detail "$contextAction in progress; task-based enablement available; Graph consumer registration still requires integration support" -Terminal $terminal
    $contextArguments = @{ RuntimeRoot = $ContextRuntimeRoot }
    if ($contextAction -eq 'update') { $contextArguments.Update = $true }
    elseif ($contextAction -eq 'repair') { $contextArguments.Repair = $true }
    & $contextInstaller -Confirm:$false -WhatIf:$WhatIfPreference @contextArguments
    if (-not $?) { throw 'Afyx Context installation failed.' }
    $summary['Afyx Context Engine'] = $contextAction
    if (-not $WhatIfPreference) { $changesApplied = $true }
}

# Provider integration of the selected ACE runtime is a separate, Afyx-owned
# skill companion. It does not change Graph MCP responses or external provider
# toggles. Native Context CLI remains independently usable without this skill.
$contextCompanionDesired = -not $SkipProviderConfiguration -and $env:AFYX_CONTEXT_OPT_IN -ne '0' -and (
    $(if ($controlPlan) { 'afyx-context' -in $controlPlan.DesiredComponents }
      else { $contextAction -ne 'skip' })
)
$contextReadyForCompanion = $contextAction -ne 'skip' -or $contextState -eq 'HEALTHY'
if ($contextCompanionDesired -and $contextReadyForCompanion -and $Provider.Count) {
    if (-not (Test-SkillManifest $contextCompanionSource)) { throw 'Bundled Afyx Context provider companion is invalid.' }
    foreach ($root in @($providerSkillRoots | Select-Object -Unique)) {
        $target = Join-Path $root 'afyx-context'
        $ownership = Get-AfyxSkillOwnership -Target $target -Component 'afyx-context' -ExpectedOwner 'afyx'
        if ($ownership -eq 'AFYX_OWNED_UNMODIFIED' -and
            (Get-AfyxSkillVersion -Directory $target) -eq (Get-AfyxSkillVersion -Directory $contextCompanionSource)) {
            $summary["Afyx Context Companion [$root]"] = 'skipped'
            continue
        }
        if ($ownership -notin @('NOT_INSTALLED', 'AFYX_OWNED_UNMODIFIED')) {
            throw "Refusing automatic Context companion replacement at $target because ownership is $ownership."
        }
        $summary["Afyx Context Companion [$root]"] = Install-ManagedSkillSafely 'afyx-context' 'Afyx Context Companion' $contextCompanionSource $target ($ownership -eq 'AFYX_OWNED_UNMODIFIED') $root
        if (-not $WhatIfPreference) { $changesApplied = $true }
    }
}

$forgeState = $states['Afyx Forge Core']
$forgeAction = if ($controlPlan) { [string]$actionDecisions['afyx-forge'] } else { Resolve-ComponentAction 'afyx-forge' 'Afyx Forge Core' }
if ($forgeAction -eq 'skip') { $summary['Afyx Forge Core'] = 'skipped' }
else {
    Write-AfyxStatus -Status PLANNED -Name 'Afyx Forge Core' -Detail "$forgeAction in progress; Guidance Alpha mode active" -Terminal $terminal
    $forgeArguments = @{ RuntimeRoot = $ForgeRuntimeRoot }
    if ($forgeAction -eq 'update') { $forgeArguments.Update = $true }
    elseif ($forgeAction -eq 'repair') { $forgeArguments.Repair = $true }
    & $forgeInstaller -Confirm:$false -WhatIf:$WhatIfPreference @forgeArguments
    if (-not $?) { throw 'Afyx Forge Core installation failed.' }
    $summary['Afyx Forge Core'] = $forgeAction
    if (-not $WhatIfPreference) { $changesApplied = $true }
}
# The selected Forge Core contributes a skill surface, not autonomous runtime
# execution. Formal A8 acceptance remains gated.
$forgeCompanionDesired = -not $SkipProviderConfiguration -and (
    $(if ($controlPlan) { 'afyx-forge' -in $controlPlan.DesiredComponents }
      else { $forgeAction -ne 'skip' })
)
$forgeReadyForCompanion = $forgeAction -ne 'skip' -or $states['Afyx Forge Core'] -eq 'HEALTHY'
if ($forgeCompanionDesired -and $forgeReadyForCompanion -and $Provider.Count) {
    if (-not (Test-SkillManifest $forgeCompanionSource)) { throw 'Bundled Afyx Forge provider companion is invalid.' }
    foreach ($root in @($providerSkillRoots | Select-Object -Unique)) {
        $target = Join-Path $root 'afyx-forge'
        $ownership = Get-AfyxSkillOwnership -Target $target -Component 'afyx-forge' -ExpectedOwner 'afyx'
        if ($ownership -eq 'AFYX_OWNED_UNMODIFIED' -and
            (Get-AfyxSkillVersion -Directory $target) -eq (Get-AfyxSkillVersion -Directory $forgeCompanionSource)) {
            $summary["Afyx Forge Companion [$root]"] = 'skipped'
            continue
        }
        if ($ownership -notin @('NOT_INSTALLED', 'AFYX_OWNED_UNMODIFIED')) {
            throw "Refusing automatic Forge companion replacement at $target because ownership is $ownership."
        }
        $summary["Afyx Forge Companion [$root]"] = Install-ManagedSkillSafely 'afyx-forge' 'Afyx Forge Companion' $forgeCompanionSource $target ($ownership -eq 'AFYX_OWNED_UNMODIFIED') $root
        if (-not $WhatIfPreference) { $changesApplied = $true }
    }
}

$usageAction = if ($controlPlan) { [string]$actionDecisions['codex-usage-tracking'] } else { Resolve-ComponentAction 'codex-usage-tracking' 'Usage Tracking' }
if ($usageAction -eq 'skip') { $summary['Usage Tracking'] = 'skipped'; Write-Host 'Usage Tracking: skipped' }
else {
    Write-AfyxStatus -Status PLANNED -Name 'Usage Tracking' -Detail "$usageAction in progress" -Terminal $terminal
    & $usageTrackerInstaller -Confirm:$false -WhatIf:$WhatIfPreference
    if (-not $?) { throw 'Codex Usage Tracking installation failed.' }
    $summary['Usage Tracking'] = $usageAction
    if (-not $WhatIfPreference) { $changesApplied = $true }
}

$receipt = @()
foreach ($entry in $summary.GetEnumerator()) {
    $componentId = switch ($entry.Key) {
        'Efficient Coding' { 'efficient-coding' }
        'Odoo Engineering' { 'odoo-engineering' }
        'Afyx Engineering Expert' { 'afyx-engineering-expert' }
        'Afyx Graph' { 'afyx-graph' }
        'Afyx Context Engine' { 'afyx-context' }
        'Afyx Forge Core' { 'afyx-forge' }
        'Usage Tracking' { 'codex-usage-tracking' }
        default { '' }
    }
    $componentState = if ($componentId) { [string]$componentStates[$componentId].State } else { '' }
    $receipt += [pscustomobject]@{
        Status = Get-AfyxOutcomeStatus -ComponentState $componentState -Action ([string]$entry.Value) -WhatIf:$WhatIfPreference
        Name = [string]$entry.Key
        Detail = "outcome=$($entry.Value)"
    }
}
Show-AfyxReceipt -Items $receipt -Terminal $terminal
if ($WhatIfPreference) { Write-AfyxStatus -Status PLANNED -Name 'WhatIf complete' -Detail 'no files or configuration were changed' -Terminal $terminal }
elseif ($changesApplied) { Write-AfyxStatus -Status 'RESTART REQUIRED' -Name 'Provider session' -Detail 'start a new provider session to load installed components' -Terminal $terminal }
else { Write-AfyxStatus -Status 'NO CHANGE' -Name 'Installation' -Detail 'existing healthy components were preserved' -Terminal $terminal }
