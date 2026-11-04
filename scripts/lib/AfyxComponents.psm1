Set-StrictMode -Version Latest

# Canonical component model for the Afyx Codex Engineering Kit (PowerShell).
# The data lives once in scripts/components.json; installer, updater,
# uninstaller, verifier and doctor all ask this module for component state.
# Read-only: nothing here writes, installs, or changes configuration.

$script:ContractPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'components.json'
$script:States = @('NOT INSTALLED', 'HEALTHY', 'INCOMPLETE', 'INVALID', 'DRIFTED', 'UNKNOWN')

function Get-AfyxPlatform {
    if ($PSVersionTable.PSVersion.Major -ge 6) {
        if ($IsWindows) { return 'windows' }
        return 'unix'
    }
    return 'windows'
}

function Get-AfyxCodexHost {
    [CmdletBinding()]
    param()

    if ((Get-AfyxPlatform) -eq 'windows') {
        foreach ($name in @('codex.exe', 'codex.cmd')) {
            $command = Get-Command $name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($command) {
                return [pscustomobject]@{
                    State = 'CLI_READY'
                    Path = [string]$command.Source
                    Command = $name
                    Detail = "Compatible native Codex launcher detected: $name"
                }
            }
        }
        $shim = Get-Command codex.ps1 -CommandType ExternalScript -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($shim) {
            return [pscustomobject]@{
                State = 'UNSUPPORTED_POWERSHELL_SHIM'
                Path = [string]$shim.Source
                Command = 'codex.ps1'
                Detail = 'codex.ps1 cannot be passed to the native Node.js MCP lifecycle; install or expose codex.exe or codex.cmd.'
            }
        }
        return [pscustomobject]@{
            State = 'CLI_NOT_FOUND'
            Path = ''
            Command = ''
            Detail = 'No compatible Codex CLI launcher was found; install or expose codex.exe or codex.cmd.'
        }
    }

    $command = Get-Command codex -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command) {
        return [pscustomobject]@{
            State = 'CLI_READY'
            Path = [string]$command.Source
            Command = 'codex'
            Detail = 'Codex CLI detected.'
        }
    }
    return [pscustomobject]@{
        State = 'CLI_NOT_FOUND'
        Path = ''
        Command = ''
        Detail = 'No compatible Codex CLI launcher was found.'
    }
}

function New-AfyxComponentContext {
    [CmdletBinding()]
    param(
        [string]$SkillsRoot,
        [string]$GraphRoot,
        [string]$ContextRoot,
        [string]$ForgeRoot,
        [string]$CodexHome,
        [string]$Platform
    )
    $userHome = if ($env:USERPROFILE) { $env:USERPROFILE } elseif ($env:HOME) { $env:HOME } else { [Environment]::GetFolderPath('UserProfile') }
    if (-not $SkillsRoot) { $SkillsRoot = Join-Path (Join-Path $userHome '.agents') 'skills' }
    if (-not $GraphRoot) { $GraphRoot = if ($env:AFYX_GRAPH_RUNTIME_ROOT) { $env:AFYX_GRAPH_RUNTIME_ROOT } else { Join-Path (Join-Path $userHome '.afyx') 'graph' } }
    if (-not $ContextRoot) { $ContextRoot = if ($env:AFYX_CONTEXT_RUNTIME_ROOT) { $env:AFYX_CONTEXT_RUNTIME_ROOT } else { Join-Path (Join-Path $userHome '.afyx') 'context' } }
    if (-not $ForgeRoot) { $ForgeRoot = if ($env:AFYX_FORGE_RUNTIME_ROOT) { $env:AFYX_FORGE_RUNTIME_ROOT } else { Join-Path (Join-Path $userHome '.afyx') 'forge' } }
    if (-not $CodexHome) { $CodexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $userHome '.codex' } }
    if (-not $Platform) { $Platform = Get-AfyxPlatform }
    [pscustomobject]@{
        SkillsRoot  = $SkillsRoot
        GraphRoot   = $GraphRoot
        ContextRoot = $ContextRoot
        ForgeRoot   = $ForgeRoot
        CodexHome   = $CodexHome
        Platform    = $Platform
    }
}

function Get-AfyxComponentContract {
    [CmdletBinding()]
    param([string]$Path = $script:ContractPath)
    $document = Get-Content -Raw -LiteralPath $Path -Encoding utf8 | ConvertFrom-Json
    if ($document.schema_version -ne 1) { throw "Unsupported component contract schema_version: $($document.schema_version)" }
    return @($document.components)
}

function Get-AfyxControlPlaneContract {
    [CmdletBinding()]
    param([string]$Path = $script:ContractPath)
    $document = Get-Content -Raw -LiteralPath $Path -Encoding utf8 | ConvertFrom-Json
    if ($document.schema_version -ne 1 -or $document.control_plane_version -ne 1) {
        throw 'Unsupported Afyx component/control-plane contract version.'
    }
    return $document
}

function Get-AfyxProviderRegistry {
    [CmdletBinding()]
    param([string]$Path = $script:ContractPath)
    return @((Get-AfyxControlPlaneContract -Path $Path).providers)
}

function Get-AfyxDesiredComponentIds {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][ValidateSet('minimal', 'recommended', 'full', 'custom')][string]$Preset,
        [string[]]$CustomComponent = @(),
        [string]$Path = $script:ContractPath
    )
    $components = @(Get-AfyxComponentContract -Path $Path)
    if ($CustomComponent.Count) {
        $CustomComponent = @($CustomComponent | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    }
    $selectable = @($components | Where-Object { $_.type -ne 'detected-cli' } | ForEach-Object { [string]$_.id })
    if ($Preset -eq 'custom') {
        $unknown = @($CustomComponent | Where-Object { $_ -notin $selectable })
        if ($unknown.Count) { throw "Unknown custom component(s): $($unknown -join ', ')" }
        return @($selectable | Where-Object { $_ -in $CustomComponent })
    }
    if ($CustomComponent.Count) { throw '-CustomComponent is valid only with preset custom.' }
    return @($components | Where-Object { ";$($_.presets);" -like "*;$Preset;*" } | ForEach-Object { [string]$_.id })
}

function Get-AfyxControlPlan {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][ValidateSet('minimal', 'recommended', 'full', 'custom')][string]$Preset,
        [Parameter(Mandatory)]$Context,
        [string[]]$CustomComponent = @(),
        [string[]]$Provider = @(),
        [hashtable]$StateById,
        [string]$ContractPath = $script:ContractPath
    )
    $contract = Get-AfyxControlPlaneContract -Path $ContractPath
    $components = @($contract.components)
    if (-not $Provider.Count) { $Provider = @([string]$contract.default_provider) }
    $providerIds = @($contract.providers | ForEach-Object { [string]$_.provider })
    $unknownProviders = @($Provider | Where-Object { $_ -notin $providerIds })
    if ($unknownProviders.Count) { throw "Unknown provider(s): $($unknownProviders -join ', ')" }
    $Provider = @($providerIds | Where-Object { $_ -in $Provider })
    $desiredIds = @(Get-AfyxDesiredComponentIds -Preset $Preset -CustomComponent $CustomComponent -Path $ContractPath)
    $desiredIds = @($desiredIds | Where-Object {
        $wantedId = $_
        $component = @($components | Where-Object { [string]$_.id -eq $wantedId })[0]
        $restrictionText = if ($component.PSObject.Properties['providers']) { [string]$component.providers } else { '' }
        [string]::IsNullOrEmpty($restrictionText) -or @(($restrictionText -split ';') | Where-Object { $_ -in $Provider }).Count -gt 0
    })
    if (-not $StateById) {
        $StateById = @{}
        foreach ($state in (Get-AfyxComponentStates -Context $Context -ContractPath $ContractPath)) { $StateById[$state.Id] = $state }
    }
    $items = foreach ($component in $components) {
        $id = [string]$component.id
        $state = $StateById[$id]
        $desired = $id -in $desiredIds
        $notApplicable = $component.platforms -eq 'windows' -and $Context.Platform -ne 'windows'
        $actualState = if ($state) { [string]$state.State } else { 'UNKNOWN' }
        $runtimeOwnershipVerified = $true
        if ($component.type -eq 'runtime' -and $actualState -ne 'NOT INSTALLED') {
            $runtimeOwnershipVerified = $false
            try {
                $markerPath = Join-Path (Get-AfyxComponentRoot -Component $component -Context $Context) ([string]$component.marker_file)
                $markerDocument = Get-Content -Raw -LiteralPath $markerPath -Encoding utf8 | ConvertFrom-Json -ErrorAction Stop
                $marker = $markerDocument.PSObject.Properties[[string]$component.marker_field]
                $runtimeOwnershipVerified = $marker -and [string]$marker.Value -eq [string]$component.marker_value
            } catch { $runtimeOwnershipVerified = $false }
        }
        $drift = if ($notApplicable) { 'NOT_APPLICABLE' }
            elseif (-not $desired) { if ($actualState -eq 'NOT INSTALLED') { 'ABSENT' } else { 'EXTRA' } }
            elseif (-not $runtimeOwnershipVerified) { 'UNVERIFIED' }
            else { switch ($actualState) {
                'HEALTHY' { 'IN_SYNC' }
                'NOT INSTALLED' { 'MISSING' }
                'DRIFTED' { 'MODIFIED' }
                { $_ -in @('INCOMPLETE', 'INVALID') } { 'DEGRADED' }
                default { 'UNVERIFIED' }
            } }
        $ownership = if ($actualState -eq 'UNKNOWN' -or -not $runtimeOwnershipVerified) { 'USER' } elseif ($actualState -eq 'NOT INSTALLED') { 'NONE' } else { [string]$component.ownership_class }
        $repair = switch ($drift) {
            'MISSING' { 'INSTALL' }
            { $_ -in @('MODIFIED', 'DEGRADED') } { if ($component.ownership_class -eq 'AFYX') { 'REPAIR' } else { 'BLOCKED' } }
            'UNVERIFIED' { 'BLOCKED' }
            default { 'NONE' }
        }
        [pscustomobject]@{
            Id = $id; Desired = $desired; Ownership = [string]$component.ownership_class
            ActualOwnership = $ownership; ActualState = $actualState; Drift = $drift; Repair = $repair
        }
    }
    $identity = "v$($contract.control_plane_version)|$Preset|$($Provider -join ',')|$($desiredIds -join ',')"
    [pscustomobject]@{
        Version = [int]$contract.control_plane_version
        Identity = $identity
        Preset = $Preset
        Provider = ($Provider -join ',')
        Providers = @($Provider)
        DesiredComponents = @($desiredIds)
        Components = @($items)
    }
}

function Get-AfyxField {
    param($Component, [string]$Name)
    $property = $Component.PSObject.Properties[$Name]
    if ($property -and $null -ne $property.Value) { return [string]$property.Value }
    return ''
}

function Get-AfyxList {
    param([string]$Value)
    if ([string]::IsNullOrEmpty($Value)) { return @() }
    return @($Value -split ';' | Where-Object { $_ })
}

function Get-AfyxComponentRoot {
    [CmdletBinding()]
    param([Parameter(Mandatory)]$Component, [Parameter(Mandatory)]$Context)
    $root = switch (Get-AfyxField $Component 'install_root') {
        'skills_root'       { $Context.SkillsRoot }
        'afyx_graph_root'   { $Context.GraphRoot }
        'afyx_context_root' { $Context.ContextRoot }
        'afyx_forge_root'   { $Context.ForgeRoot }
        'codex_tools'       { Join-Path $Context.CodexHome 'tools' }
        default             { '' }
    }
    if (-not $root) { return '' }
    $relative = Get-AfyxField $Component 'install_path'
    if ($relative) { return Join-Path $root $relative }
    return $root
}

function Test-AfyxSkillManifest {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Directory, [bool]$RequireVersion = $false)
    $manifest = Join-Path $Directory 'SKILL.md'
    if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) { return @{ Ok = $false; Detail = 'SKILL.md missing' } }
    try { $text = Get-Content -Raw -LiteralPath $manifest -Encoding utf8 } catch { return @{ Ok = $false; Detail = 'not readable as UTF-8' } }
    if ([string]::IsNullOrWhiteSpace($text)) { return @{ Ok = $false; Detail = 'SKILL.md is empty' } }
    if ($text -notmatch '\A---\r?\n[\s\S]*?\r?\n---\r?\n') { return @{ Ok = $false; Detail = 'frontmatter delimiters missing or malformed' } }
    if ($text -notmatch '(?m)^name:\s*[a-z0-9-]+\s*$') { return @{ Ok = $false; Detail = 'valid name missing' } }
    if ($text -notmatch '(?m)^description:\s*\S.+$') { return @{ Ok = $false; Detail = 'description missing' } }
    if ($RequireVersion -and $text -notmatch '(?ms)^metadata:\s*\r?\n\s+version:\s*["''][^"'']+["'']\s*$') { return @{ Ok = $false; Detail = 'metadata.version missing' } }
    return @{ Ok = $true; Detail = 'frontmatter valid' }
}

function Get-AfyxSkillVersion {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Directory)
    $manifest = Join-Path $Directory 'SKILL.md'
    if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) { return $null }
    $text = Get-Content -Raw -LiteralPath $manifest -Encoding utf8
    $match = [regex]::Match($text, '(?m)^[ \t]*version:[ \t]*["'']?([^"''\s]+)')
    if ($match.Success) { return $match.Groups[1].Value }
    return $null
}

function New-AfyxState {
    param($Component, [string]$State, [string]$Detail, [string]$Version = '', [string]$Path = '')
    [pscustomobject]@{
        Id        = Get-AfyxField $Component 'id'
        Name      = Get-AfyxField $Component 'name'
        Type      = Get-AfyxField $Component 'type'
        Tier      = Get-AfyxField $Component 'tier'
        Ownership = Get-AfyxField $Component 'ownership'
        State     = $State
        Detail    = $Detail
        Version   = $Version
        Path      = $Path
    }
}

function Test-AfyxRuntimeIntegrity {
    param([Parameter(Mandatory)][string]$Root, [Parameter(Mandatory)][string]$ManifestRelative, [string]$IdentityRelative = '')
    try {
        $rootItem = Get-Item -LiteralPath $Root -Force
        if ($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) { return $false }
        $manifest = Join-Path $Root $ManifestRelative
        $metadata = Get-Content -Raw -LiteralPath (Join-Path $Root 'metadata.json') -Encoding utf8 | ConvertFrom-Json -ErrorAction Stop
        if ($IdentityRelative) {
            $identity = Get-Content -Raw -LiteralPath (Join-Path $Root $IdentityRelative) -Encoding utf8 | ConvertFrom-Json -ErrorAction Stop
            foreach ($field in @('product_name','product_version','source_revision','ownership_class','build_provenance','release_channel','integration_default')) {
                if ([string]$metadata.$field -ne [string]$identity.$field) { return $false }
            }
        }
        if ((Get-FileHash -LiteralPath $manifest -Algorithm SHA256).Hash.ToLowerInvariant() -ne [string]$metadata.artifact_digest) { return $false }
        foreach ($line in (Get-Content -LiteralPath $manifest -Encoding utf8)) {
            if ($line -notmatch '^([0-9a-f]{64})  (current/[A-Za-z0-9._/-]+)$' -or $Matches[2] -match '(^|/)\.\.(/|$)') { return $false }
            $file = Join-Path $Root ($Matches[2] -replace '/', [IO.Path]::DirectorySeparatorChar)
            if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { return $false }
            if ((Get-Item -LiteralPath $file -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { return $false }
            if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Matches[1]) { return $false }
        }
        return $true
    } catch { return $false }
}

function Get-AfyxComponentState {
    [CmdletBinding()]
    param([Parameter(Mandatory)]$Component, [Parameter(Mandatory)]$Context)

    $type = Get-AfyxField $Component 'type'
    $platforms = Get-AfyxField $Component 'platforms'

    if ($type -eq 'detected-cli') {
        $command = Get-AfyxField $Component 'detect_command'
        if (Get-Command $command -ErrorAction SilentlyContinue) { return New-AfyxState $Component 'HEALTHY' 'externally managed; detected' }
        return New-AfyxState $Component 'NOT INSTALLED' 'externally managed; not detected'
    }
    if ($platforms -eq 'windows' -and $Context.Platform -ne 'windows') {
        return New-AfyxState $Component 'NOT INSTALLED' 'Windows-only runtime'
    }

    $path = Get-AfyxComponentRoot -Component $Component -Context $Context
    if (-not $path) { return New-AfyxState $Component 'UNKNOWN' 'component root is not defined' }

    $required = @(Get-AfyxList (Get-AfyxField $Component 'required_files'))
    $required += @(Get-AfyxList (Get-AfyxField $Component "required_files_$($Context.Platform)"))

    try {
        switch ($type) {
            'skill' {
                if (-not (Test-Path -LiteralPath $path)) { return New-AfyxState $Component 'NOT INSTALLED' 'not installed' '' $path }
                $requireVersion = (Get-AfyxField $Component 'version_required') -eq 'true'
                $manifest = Test-AfyxSkillManifest -Directory $path -RequireVersion $requireVersion
                if (-not $manifest.Ok) { return New-AfyxState $Component 'INVALID' $manifest.Detail '' $path }
                foreach ($relative in $required) {
                    $file = Join-Path $path $relative
                    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { return New-AfyxState $Component 'INCOMPLETE' "reference missing: $relative" '' $path }
                    if ($relative -ne 'SKILL.md' -and [string]::IsNullOrWhiteSpace((Get-Content -Raw -LiteralPath $file -Encoding utf8))) {
                        return New-AfyxState $Component 'INCOMPLETE' "reference empty: $relative" '' $path
                    }
                }
                return New-AfyxState $Component 'HEALTHY' 'frontmatter and required references valid' (Get-AfyxSkillVersion -Directory $path) $path
            }
            'runtime' {
                if (-not (Test-Path -LiteralPath $path)) { return New-AfyxState $Component 'NOT INSTALLED' 'not installed' '' $path }
                if ((Get-Item -LiteralPath $path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { return New-AfyxState $Component 'UNKNOWN' 'runtime root is a reparse point' '' $path }
                foreach ($relative in $required) {
                    if (-not (Test-Path -LiteralPath (Join-Path $path $relative) -PathType Leaf)) { return New-AfyxState $Component 'INCOMPLETE' "missing: $relative" '' $path }
                }
                $markerFile = Join-Path $path (Get-AfyxField $Component 'marker_file')
                try { $document = Get-Content -Raw -LiteralPath $markerFile -Encoding utf8 | ConvertFrom-Json -ErrorAction Stop }
                catch { return New-AfyxState $Component 'INVALID' 'ownership metadata is not valid JSON' '' $path }
                $field = Get-AfyxField $Component 'marker_field'
                $marker = $document.PSObject.Properties[$field]
                if (-not $marker -or [string]$marker.Value -ne (Get-AfyxField $Component 'marker_value')) {
                    return New-AfyxState $Component 'INVALID' 'ownership marker mismatch' '' $path
                }
                $versionField = (Get-AfyxField $Component 'version_source') -replace '^[^#]*#', ''
                $version = $document.PSObject.Properties[$versionField]
                if ((Get-AfyxField $Component 'version_required') -eq 'true' -and (-not $version -or -not $version.Value)) {
                    return New-AfyxState $Component 'INVALID' "$versionField missing from metadata" '' $path
                }
                $versionText = if ($version) { [string]$version.Value } else { '' }
                $integrityManifest = Get-AfyxField $Component 'integrity_manifest_file'
                if ($integrityManifest -and -not (Test-AfyxRuntimeIntegrity -Root $path -ManifestRelative $integrityManifest -IdentityRelative (Get-AfyxField $Component 'identity_file'))) {
                    return New-AfyxState $Component 'DRIFTED' 'Afyx ownership verified but runtime integrity differs' $versionText $path
                }
                return New-AfyxState $Component 'HEALTHY' 'Afyx-owned runtime valid' $versionText $path
            }
            'toolset' {
                $present = @($required | Where-Object { Test-Path -LiteralPath (Join-Path $path $_) -PathType Leaf })
                if ($present.Count -eq 0) { return New-AfyxState $Component 'NOT INSTALLED' 'not installed' '' $path }
                if ($present.Count -eq $required.Count) { return New-AfyxState $Component 'HEALTHY' 'runtime files installed' '' $path }
                return New-AfyxState $Component 'INCOMPLETE' "$($present.Count) of $($required.Count) runtime files present" '' $path
            }
            default { return New-AfyxState $Component 'UNKNOWN' "unsupported component type: $type" '' $path }
        }
    }
    catch [System.UnauthorizedAccessException] { return New-AfyxState $Component 'UNKNOWN' 'access denied while inspecting component' '' $path }
    catch { return New-AfyxState $Component 'UNKNOWN' "inspection failed: $($_.Exception.Message)" '' $path }
}

function Get-AfyxComponentStates {
    [CmdletBinding()]
    param([Parameter(Mandatory)]$Context, [string]$ContractPath = $script:ContractPath)
    foreach ($component in (Get-AfyxComponentContract -Path $ContractPath)) {
        Get-AfyxComponentState -Component $component -Context $Context
    }
}

Export-ModuleMember -Function Get-AfyxPlatform, Get-AfyxCodexHost, New-AfyxComponentContext, Get-AfyxComponentContract, Get-AfyxControlPlaneContract, Get-AfyxProviderRegistry, Get-AfyxDesiredComponentIds, Get-AfyxControlPlan, Get-AfyxComponentRoot, Test-AfyxSkillManifest, Get-AfyxSkillVersion, Get-AfyxComponentState, Get-AfyxComponentStates
