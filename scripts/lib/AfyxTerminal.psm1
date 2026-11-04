Set-StrictMode -Version Latest

$script:AfyxAnsi = [char]27
$script:AfyxPalette = @{
    Primary   = '38;2;34;211;238'
    Secondary = '38;2;167;139;250'
    Success   = '38;2;52;211;153'
    Warning   = '38;2;251;191;36'
    Error     = '38;2;251;113;133'
    Text      = '38;2;226;232;240'
    Muted     = '38;2;148;163;184'
}

function Test-AfyxAnsiSupport {
    [CmdletBinding()]
    param([switch]$ForcePlain)
    if ($ForcePlain -or $env:NO_COLOR -or $env:TERM -eq 'dumb') { return $false }
    try {
        if ([Console]::IsOutputRedirected) { return $false }
        $property = $Host.UI.PSObject.Properties['SupportsVirtualTerminal']
        if ($property -and [bool]$property.Value) { return $true }
        return [bool]($env:WT_SESSION -or $env:TERM_PROGRAM -or ($env:TERM -match 'color|ansi|xterm'))
    } catch { return $false }
}

function Test-AfyxInteractiveTerminal {
    [CmdletBinding()]
    param([switch]$ForceInteractive, [switch]$ForcePlain)
    if ($ForcePlain -or $env:CI) { return $false }
    try {
        if ([Console]::IsInputRedirected -or [Console]::IsOutputRedirected) { return $false }
        if ($ForceInteractive -or $env:AFYX_FORCE_INTERACTIVE -eq '1') { return $true }
        return $null -ne $Host.UI.RawUI
    } catch { return $false }
}

function New-AfyxTerminalContext {
    [CmdletBinding()]
    param([switch]$ForceInteractive, [switch]$ForcePlain, [int]$Width = 0)
    if ($Width -lt 1) {
        try { $Width = [Math]::Max(40, [Math]::Min(120, [int]$Host.UI.RawUI.WindowSize.Width)) }
        catch { $Width = 80 }
    }
    [pscustomobject]@{
        Interactive = Test-AfyxInteractiveTerminal -ForceInteractive:$ForceInteractive -ForcePlain:$ForcePlain
        Ansi = Test-AfyxAnsiSupport -ForcePlain:$ForcePlain
        Width = $Width
    }
}

function Get-AfyxStyledText {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][AllowEmptyString()][string]$Text,
        [ValidateSet('Primary', 'Secondary', 'Success', 'Warning', 'Error', 'Text', 'Muted')][string]$Tone = 'Text',
        [Parameter(Mandatory)]$Terminal
    )
    if (-not $Terminal.Ansi) { return $Text }
    return "$script:AfyxAnsi[$($script:AfyxPalette[$Tone])m$Text$script:AfyxAnsi[0m"
}

function Format-AfyxWrappedText {
    [CmdletBinding()]
    param([AllowEmptyString()][string]$Text, [int]$Width = 80, [string]$Indent = '')
    $available = [Math]::Max(10, $Width - $Indent.Length)
    $result = @()
    foreach ($paragraph in @($Text -split "`r?`n")) {
        if (-not $paragraph) { $result += $Indent; continue }
        $line = ''
        foreach ($word in @($paragraph -split '\s+')) {
            if (-not $line) { $line = $word; continue }
            if (($line.Length + 1 + $word.Length) -le $available) { $line += " $word" }
            else { $result += "$Indent$line"; $line = $word }
        }
        if ($line) { $result += "$Indent$line" }
    }
    return @($result)
}

function Write-AfyxText {
    [CmdletBinding()]
    param(
        [AllowEmptyString()][string]$Text = '',
        [ValidateSet('Primary', 'Secondary', 'Success', 'Warning', 'Error', 'Text', 'Muted')][string]$Tone = 'Text',
        [Parameter(Mandatory)]$Terminal,
        [string]$Indent = ''
    )
    foreach ($line in @(Format-AfyxWrappedText -Text $Text -Width $Terminal.Width -Indent $Indent)) {
        Write-Host (Get-AfyxStyledText -Text $line -Tone $Tone -Terminal $Terminal)
    }
}

function Show-AfyxBanner {
    [CmdletBinding()]
    param([Parameter(Mandatory)]$Terminal, [string]$Subtitle = 'Code Engineering Kit')
    Write-Host ''
    Write-AfyxText -Terminal $Terminal -Tone Primary -Text '  +-- AFYX ----------------------------------------+'
    Write-AfyxText -Terminal $Terminal -Tone Secondary -Text "  |  $Subtitle"
    Write-AfyxText -Terminal $Terminal -Tone Primary -Text '  +------------------------------------------------+'
}

function Write-AfyxSection {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Title, [Parameter(Mandatory)]$Terminal)
    Write-Host ''
    Write-AfyxText -Terminal $Terminal -Tone Primary -Text "-- $Title"
}

function Get-AfyxStatusTone {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Status)
    switch ($Status.ToUpperInvariant()) {
        { $_ -in @('HEALTHY', 'NO CHANGE', 'READY') } { return 'Success' }
        { $_ -in @('UPDATE AVAILABLE', 'PLANNED', 'RESTART REQUIRED', 'WARNING') } { return 'Warning' }
        { $_ -in @('BLOCKED', 'FAILED', 'ERROR') } { return 'Error' }
        { $_ -in @('SKIPPED', 'INFO', 'NOT INSTALLED', 'EXTRA') } { return 'Muted' }
        default { return 'Text' }
    }
}

function Write-AfyxStatus {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Status,
        [Parameter(Mandatory)][string]$Name,
        [string]$Detail = '',
        [Parameter(Mandatory)]$Terminal
    )
    $label = "[$($Status.ToUpperInvariant())]"
    $styled = Get-AfyxStyledText -Text $label -Tone (Get-AfyxStatusTone -Status $Status) -Terminal $Terminal
    $suffix = if ($Detail) { " - $Detail" } else { '' }
    Write-Host "$styled $Name$suffix"
}

function Get-AfyxOutcomeStatus {
    [CmdletBinding()]
    param([string]$ComponentState, [string]$Action, [switch]$WhatIf)
    if ($WhatIf -and $Action -notin @('', 'skip', 'skipped')) { return 'PLANNED' }
    if ($Action -match 'blocked|failed|error') { return 'BLOCKED' }
    if ($Action -match 'restart') { return 'RESTART REQUIRED' }
    if ($Action -in @('installed', 'replaced', 'updated', 'update', 'repair', 'repaired', 'adopted', 'already adopted', 'install')) { return 'HEALTHY' }
    if ($Action -in @('planned', 'planned adoption')) { return 'PLANNED' }
    if ($Action -in @('skip', 'skipped', '')) {
        if ($ComponentState -eq 'HEALTHY') { return 'NO CHANGE' }
        return 'SKIPPED'
    }
    return $Action.ToUpperInvariant()
}

function Get-AfyxEnabledOptionIndex {
    param([object[]]$Options, [int]$Start, [int]$Direction)
    $index = $Start
    for ($attempt = 0; $attempt -lt $Options.Count; $attempt++) {
        $index = ($index + $Direction + $Options.Count) % $Options.Count
        $enabled = -not $Options[$index].PSObject.Properties['Enabled'] -or [bool]$Options[$index].Enabled
        if ($enabled) { return $index }
    }
    return $Start
}

function Show-AfyxChoiceFrame {
    param([string]$Prompt, [object[]]$Options, [int]$Selected, [hashtable]$Checked, $Terminal, [switch]$Multiple)
    $lineCount = @(Format-AfyxWrappedText -Text $Prompt -Width $Terminal.Width).Count
    Write-AfyxText -Terminal $Terminal -Tone Text -Text $Prompt
    for ($i = 0; $i -lt $Options.Count; $i++) {
        $option = $Options[$i]
        $enabled = -not $option.PSObject.Properties['Enabled'] -or [bool]$option.Enabled
        $cursor = if ($i -eq $Selected) { '>' } else { ' ' }
        $mark = if ($Multiple) { if ($Checked.ContainsKey([string]$option.Id)) { '[x]' } else { '[ ]' } } else { "[$($i + 1)]" }
        $detail = if ($option.PSObject.Properties['Detail'] -and $option.Detail) { " - $($option.Detail)" } else { '' }
        $tone = if (-not $enabled) { 'Muted' } elseif ($i -eq $Selected) { 'Primary' } else { 'Text' }
        $optionText = "$cursor $mark $($option.Label)$detail"
        $lineCount += @(Format-AfyxWrappedText -Text $optionText -Width $Terminal.Width -Indent '  ').Count
        Write-AfyxText -Terminal $Terminal -Tone $tone -Text $optionText -Indent '  '
    }
    $helpText = if ($Multiple) { 'Up/Down move | Space toggle | Enter continue | Esc cancel' } else { 'Up/Down move | Enter select | Esc cancel' }
    $lineCount += @(Format-AfyxWrappedText -Text $helpText -Width $Terminal.Width -Indent '  ').Count
    Write-AfyxText -Terminal $Terminal -Tone Muted -Text $helpText -Indent '  '
    return $lineCount
}

function Reset-AfyxChoiceFrame {
    param([int]$LineCount, [Parameter(Mandatory)]$Terminal)
    if ($LineCount -lt 1 -or -not $Terminal.Ansi) { return }
    Write-Host -NoNewline "$script:AfyxAnsi[$($LineCount)A`r$script:AfyxAnsi[0J"
}

function Test-AfyxAdvancedMenu {
    param([Parameter(Mandatory)]$Terminal, [scriptblock]$ReadKey)
    if (-not $Terminal.Interactive) { return $false }
    if ($ReadKey) { return $true }
    if (-not $Terminal.Ansi) { return $false }
    try { return $null -ne $Host.UI.RawUI } catch { return $false }
}

function Get-AfyxKeyAction {
    [CmdletBinding()]
    param([Parameter(Mandatory)]$RawKey)
    if ($null -eq $RawKey) { return $null }
    $props = $RawKey.PSObject.Properties

    if ($null -ne $props['KeyDown'] -and -not [bool]$props['KeyDown'].Value) {
        return $null
    }

    $virtualCode = if ($null -ne $props['VirtualKeyCode']) { [int]$props['VirtualKeyCode'].Value }
                   elseif ($null -ne $props['Key']) { [int][ConsoleKey]$props['Key'].Value }
                   else { 0 }

    $char = if ($null -ne $props['Character']) { [string]$props['Character'].Value }
            elseif ($null -ne $props['KeyChar']) { [string]$props['KeyChar'].Value }
            else { '' }

    switch ($virtualCode) {
        38 { return 'UpArrow' }
        40 { return 'DownArrow' }
        13 { return 'Enter' }
        27 { return 'Escape' }
        32 { return 'Spacebar' }
        81 { return 'Escape' }
    }

    if ($virtualCode -ge 49 -and $virtualCode -le 57) {
        return [string]($virtualCode - 48)
    }
    if ($virtualCode -ge 97 -and $virtualCode -le 105) {
        return [string]($virtualCode - 96)
    }

    if ($char -match '^[1-9]$') {
        return $char
    }

    if ($char -match '^(?i:q|esc)$') {
        return 'Escape'
    }

    if ($char -eq [char]13 -or $char -eq [char]10) {
        return 'Enter'
    }

    if ($char -eq ' ') {
        return 'Spacebar'
    }

    return $null
}

function Read-AfyxSingleChoice {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Prompt,
        [Parameter(Mandatory)][object[]]$Options,
        [string]$DefaultId = '',
        [Parameter(Mandatory)]$Terminal,
        [scriptblock]$ReadKey,
        [scriptblock]$ReadLine,
        [switch]$NoRender
    )
    if (-not $Options.Count) { throw 'At least one choice is required.' }
    $selected = 0
    for ($i = 0; $i -lt $Options.Count; $i++) { if ([string]$Options[$i].Id -eq $DefaultId) { $selected = $i; break } }
    if (-not (Test-AfyxAdvancedMenu -Terminal $Terminal -ReadKey $ReadKey)) {
        if (-not $NoRender) { $null = Show-AfyxChoiceFrame -Prompt $Prompt -Options $Options -Selected $selected -Checked @{} -Terminal $Terminal }
        $reader = if ($ReadLine) { $ReadLine } else { { Read-Host 'Selection' } }
        while ($true) {
            $answer = (& $reader).Trim()
            if (-not $answer -and $DefaultId) { return $DefaultId }
            if ($answer -match '^(?i:q|quit|esc|escape)$') { throw [OperationCanceledException]::new('Installer cancelled by user.') }
            if ($answer -match '^\d+$') {
                $at = [int]$answer - 1
                if ($at -ge 0 -and $at -lt $Options.Count -and (-not $Options[$at].PSObject.Properties['Enabled'] -or [bool]$Options[$at].Enabled)) { return [string]$Options[$at].Id }
            }
        }
    }
    $frameLines = if (-not $NoRender) { Show-AfyxChoiceFrame -Prompt $Prompt -Options $Options -Selected $selected -Checked @{} -Terminal $Terminal } else { 0 }
    while ($true) {
        $key = if ($ReadKey) { & $ReadKey } else { $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown') }
        $action = Get-AfyxKeyAction -RawKey $key
        if ($null -eq $action) { continue }
        switch -Regex ($action) {
            '^UpArrow$' { $selected = Get-AfyxEnabledOptionIndex -Options $Options -Start $selected -Direction -1 }
            '^DownArrow$' { $selected = Get-AfyxEnabledOptionIndex -Options $Options -Start $selected -Direction 1 }
            '^Escape$' { throw [OperationCanceledException]::new('Installer cancelled by user.') }
            '^Enter$' {
                $enabled = -not $Options[$selected].PSObject.Properties['Enabled'] -or [bool]$Options[$selected].Enabled
                if ($enabled) { return [string]$Options[$selected].Id }
            }
            '^[1-9]$' {
                $at = [int]$action - 1
                if ($at -ge 0 -and $at -lt $Options.Count -and (-not $Options[$at].PSObject.Properties['Enabled'] -or [bool]$Options[$at].Enabled)) { return [string]$Options[$at].Id }
            }
            default { }
        }
        if (-not $NoRender) {
            Reset-AfyxChoiceFrame -LineCount $frameLines -Terminal $Terminal
            $frameLines = Show-AfyxChoiceFrame -Prompt $Prompt -Options $Options -Selected $selected -Checked @{} -Terminal $Terminal
        }
    }
}

function Read-AfyxMultiChoice {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][string]$Prompt,
        [Parameter(Mandatory)][object[]]$Options,
        [string[]]$DefaultId = @(),
        [Parameter(Mandatory)]$Terminal,
        [scriptblock]$ReadKey,
        [scriptblock]$ReadLine,
        [switch]$NoRender
    )
    $checked = @{}
    foreach ($id in $DefaultId) { $checked[[string]$id] = $true }
    if (-not (Test-AfyxAdvancedMenu -Terminal $Terminal -ReadKey $ReadKey)) {
        if (-not $NoRender) { $null = Show-AfyxChoiceFrame -Prompt $Prompt -Options $Options -Selected 0 -Checked $checked -Terminal $Terminal -Multiple }
        $reader = if ($ReadLine) { $ReadLine } else { { Read-Host 'Selections (comma-separated numbers)' } }
        $answer = (& $reader).Trim()
        if ($answer -match '^(?i:q|quit|esc|escape)$') { throw [OperationCanceledException]::new('Installer cancelled by user.') }
        if (-not $answer) { return @($DefaultId) }
        $result = @()
        foreach ($part in @($answer -split ',')) {
            if ($part.Trim() -notmatch '^\d+$') { continue }
            $at = [int]$part.Trim() - 1
            if ($at -ge 0 -and $at -lt $Options.Count -and (-not $Options[$at].PSObject.Properties['Enabled'] -or [bool]$Options[$at].Enabled)) { $result += [string]$Options[$at].Id }
        }
        return @($result | Select-Object -Unique)
    }
    $selected = 0
    $frameLines = if (-not $NoRender) { Show-AfyxChoiceFrame -Prompt $Prompt -Options $Options -Selected $selected -Checked $checked -Terminal $Terminal -Multiple } else { 0 }
    while ($true) {
        $key = if ($ReadKey) { & $ReadKey } else { $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown') }
        $action = Get-AfyxKeyAction -RawKey $key
        if ($null -eq $action) { continue }
        switch -Regex ($action) {
            '^UpArrow$' { $selected = Get-AfyxEnabledOptionIndex -Options $Options -Start $selected -Direction -1 }
            '^DownArrow$' { $selected = Get-AfyxEnabledOptionIndex -Options $Options -Start $selected -Direction 1 }
            '^Escape$' { throw [OperationCanceledException]::new('Installer cancelled by user.') }
            '^Spacebar$' {
                $id = [string]$Options[$selected].Id
                if ($checked.ContainsKey($id)) { $checked.Remove($id) } else { $checked[$id] = $true }
            }
            '^Enter$' { return @($Options | Where-Object { $checked.ContainsKey([string]$_.Id) } | ForEach-Object { [string]$_.Id }) }
            '^[1-9]$' {
                $at = [int]$action - 1
                if ($at -ge 0 -and $at -lt $Options.Count -and (-not $Options[$at].PSObject.Properties['Enabled'] -or [bool]$Options[$at].Enabled)) {
                    $id = [string]$Options[$at].Id
                    if ($checked.ContainsKey($id)) { $checked.Remove($id) } else { $checked[$id] = $true }
                    $selected = $at
                }
            }
            default { }
        }
        if (-not $NoRender) {
            Reset-AfyxChoiceFrame -LineCount $frameLines -Terminal $Terminal
            $frameLines = Show-AfyxChoiceFrame -Prompt $Prompt -Options $Options -Selected $selected -Checked $checked -Terminal $Terminal -Multiple
        }
    }
}

function Read-AfyxConfirmation {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Prompt, [Parameter(Mandatory)]$Terminal, [scriptblock]$ReadKey, [scriptblock]$ReadLine, [switch]$NoRender)
    $options = @(
        [pscustomobject]@{ Id = 'yes'; Label = 'Apply this plan'; Detail = 'Mutation is explicitly authorized'; Enabled = $true },
        [pscustomobject]@{ Id = 'no'; Label = 'Cancel'; Detail = 'No configuration changes'; Enabled = $true }
    )
    return (Read-AfyxSingleChoice -Prompt $Prompt -Options $options -DefaultId 'no' -Terminal $Terminal -ReadKey $ReadKey -ReadLine $ReadLine -NoRender:$NoRender) -eq 'yes'
}

function Show-AfyxReceipt {
    [CmdletBinding()]
    param([Parameter(Mandatory)][object[]]$Items, [Parameter(Mandatory)]$Terminal, [string]$Title = 'Installation Receipt')
    Write-AfyxSection -Title $Title -Terminal $Terminal
    foreach ($item in $Items) { Write-AfyxStatus -Status ([string]$item.Status) -Name ([string]$item.Name) -Detail ([string]$item.Detail) -Terminal $Terminal }
}

Export-ModuleMember -Function Test-AfyxAnsiSupport, Test-AfyxInteractiveTerminal, New-AfyxTerminalContext, Get-AfyxStyledText, Format-AfyxWrappedText, Write-AfyxText, Show-AfyxBanner, Write-AfyxSection, Write-AfyxStatus, Get-AfyxOutcomeStatus, Get-AfyxKeyAction, Read-AfyxSingleChoice, Read-AfyxMultiChoice, Read-AfyxConfirmation, Show-AfyxReceipt
