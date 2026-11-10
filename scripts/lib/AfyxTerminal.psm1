Set-StrictMode -Version Latest

$script:AfyxAnsi = [char]27
$script:AfyxPalette = @{
    Primary   = '38;2;34;211;238'
    Secondary = '38;2;139;92;246'
    Accent    = '38;2;96;165;250'
    Success   = '38;2;52;211;153'
    Warning   = '38;2;251;191;36'
    Error     = '38;2;251;113;133'
    Text      = '38;2;229;242;255'
    Muted     = '38;2;147;164;187'
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
        try { $Width = [Math]::Max(40, [int]$Host.UI.RawUI.WindowSize.Width) }
        catch { $Width = 80 }
    }
    [pscustomobject]@{
        Interactive = Test-AfyxInteractiveTerminal -ForceInteractive:$ForceInteractive -ForcePlain:$ForcePlain
        Ansi = Test-AfyxAnsiSupport -ForcePlain:$ForcePlain
        Width = $Width
        Height = $(try { [Math]::Max(20, [int]$Host.UI.RawUI.WindowSize.Height) } catch { 24 })
    }
}

function Get-AfyxStyledText {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][AllowEmptyString()][string]$Text,
        [ValidateSet('Primary', 'Secondary', 'Accent', 'Success', 'Warning', 'Error', 'Text', 'Muted')][string]$Tone = 'Text',
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
        [ValidateSet('Primary', 'Secondary', 'Accent', 'Success', 'Warning', 'Error', 'Text', 'Muted')][string]$Tone = 'Text',
        [Parameter(Mandatory)]$Terminal,
        [string]$Indent = ''
    )
    if (Test-AfyxDashboard -Terminal $Terminal) {
        $Terminal.DashboardState.Events += [pscustomobject]@{ Text = "$Indent$Text"; Tone = $Tone }
        Show-AfyxDashboard -Terminal $Terminal -ForceFull
        return
    }
    foreach ($line in @(Format-AfyxWrappedText -Text $Text -Width $Terminal.Width -Indent $Indent)) {
        Write-Host (Get-AfyxStyledText -Text $line -Tone $Tone -Terminal $Terminal)
    }
}

function Show-AfyxBanner {
    [CmdletBinding()]
    param([Parameter(Mandatory)]$Terminal, [string]$Subtitle = 'Code Engineering Kit')
    Write-Host ''
    $width = [Math]::Max(34, [Math]::Min(76, $Terminal.Width - 4))
    $top = if ($Terminal.Ansi) { [string][char]0x256D + ([string][char]0x2500 * $width) + [char]0x256E } else { '+' + ('-' * $width) + '+' }
    $bottom = if ($Terminal.Ansi) { [string][char]0x2570 + ([string][char]0x2500 * $width) + [char]0x256F } else { '+' + ('-' * $width) + '+' }
    Write-Host (Get-AfyxStyledText -Text $top -Tone Primary -Terminal $Terminal)
    $lines = @('  A F Y X  /  ENGINEERING KIT', "  $Subtitle", '  I choose my path, even in the unknown.')
    foreach ($line in $lines) {
        foreach ($part in @(Format-AfyxWrappedText -Text $line -Width ($width - 2))) {
            $edge = if ($Terminal.Ansi) { [string][char]0x2502 } else { '|' }
            $padded = $part.PadRight($width)
            Write-Host ((Get-AfyxStyledText -Text $edge -Tone Primary -Terminal $Terminal) + (Get-AfyxStyledText -Text $padded -Tone Text -Terminal $Terminal) + (Get-AfyxStyledText -Text $edge -Tone Primary -Terminal $Terminal))
        }
    }
    Write-Host (Get-AfyxStyledText -Text $bottom -Tone Primary -Terminal $Terminal)
}

function Show-AfyxStep {
    [CmdletBinding()]
    param([Parameter(Mandatory)][ValidateRange(1, 5)][int]$Current, [Parameter(Mandatory)]$Terminal)
    if (Test-AfyxDashboard -Terminal $Terminal) {
        $Terminal.DashboardState.Step = $Current
        $Terminal.DashboardState.Prompt = ''
        $Terminal.DashboardState.Options = @()
        Show-AfyxDashboard -Terminal $Terminal -ForceFull
        return
    }
    $steps = @('Detect', 'Select', 'Configure', 'Install', 'Finish')
    $parts = @()
    for ($i = 0; $i -lt $steps.Count; $i++) {
        $tone = if (($i + 1) -eq $Current) { 'Primary' } elseif (($i + 1) -lt $Current) { 'Success' } else { 'Muted' }
        $parts += Get-AfyxStyledText -Text "[$($i + 1) $($steps[$i])]" -Tone $tone -Terminal $Terminal
    }
    if ($Terminal.Width -lt 72) {
        Write-AfyxText -Terminal $Terminal -Tone Primary -Text "Step $Current/5: $($steps[$Current - 1])"
    } else {
        Write-Host ('  ' + ($parts -join ' > '))
    }
}

function Write-AfyxSection {
    [CmdletBinding()]
    param([Parameter(Mandatory)][string]$Title, [Parameter(Mandatory)]$Terminal)
    if (Test-AfyxDashboard -Terminal $Terminal) {
        $Terminal.DashboardState.Section = $Title
        $Terminal.DashboardState.Prompt = ''
        $Terminal.DashboardState.Options = @()
        $Terminal.DashboardState.Events = @()
        $Terminal.DashboardState.Scroll[1] = 0
        $Terminal.DashboardState.Scroll[2] = 0
        Show-AfyxDashboard -Terminal $Terminal -ForceFull
        return
    }
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
    if (Test-AfyxDashboard -Terminal $Terminal) {
        $Terminal.DashboardState.Events += [pscustomobject]@{
            Text = "[$($Status.ToUpperInvariant())] $Name$(if ($Detail) { " - $Detail" })"
            Tone = Get-AfyxStatusTone -Status $Status
        }
        $Terminal.DashboardState.Scroll[2] = [int]::MaxValue
        Show-AfyxDashboard -Terminal $Terminal -ForceFull
        return
    }
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
    if (Test-AfyxDashboard -Terminal $Terminal) {
        $Terminal.DashboardState.Prompt = $Prompt
        $Terminal.DashboardState.Options = @($Options)
        $Terminal.DashboardState.Selected = $Selected
        $Terminal.DashboardState.Checked = $Checked
        $Terminal.DashboardState.Multiple = [bool]$Multiple
        if ($Terminal.Width -lt 96 -and $Terminal.DashboardState.Focus -eq 1) {
            $Terminal.DashboardState.Scroll[1] = [Math]::Max(0, $Selected - 4)
        }
        Show-AfyxDashboard -Terminal $Terminal
        return 0
    }
    $border = if ($Terminal.Ansi) { [string][char]0x2500 } else { '-' }
    $lineCount = @(Format-AfyxWrappedText -Text $Prompt -Width $Terminal.Width).Count + 2
    Write-AfyxText -Terminal $Terminal -Tone Secondary -Text (('  ' + $border * ([Math]::Max(20, [Math]::Min(72, $Terminal.Width - 4)))))
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
    Write-AfyxText -Terminal $Terminal -Tone Secondary -Text (('  ' + $border * ([Math]::Max(20, [Math]::Min(72, $Terminal.Width - 4)))))
    return $lineCount
}

function Reset-AfyxChoiceFrame {
    param([int]$LineCount, [Parameter(Mandatory)]$Terminal)
    if ($LineCount -lt 1 -or -not $Terminal.Ansi -or (Test-AfyxDashboard -Terminal $Terminal)) { return }
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
        37 { return 'LeftArrow' }
        38 { return 'UpArrow' }
        39 { return 'RightArrow' }
        40 { return 'DownArrow' }
        33 { return 'PageUp' }
        34 { return 'PageDown' }
        35 { return 'End' }
        36 { return 'Home' }
        9 {
            if ($props['ControlKeyState'] -and ([int]$props['ControlKeyState'].Value -band [int][System.Management.Automation.Host.ControlKeyStates]::ShiftPressed)) { return 'ShiftTab' }
            if ($props['Modifiers'] -and ([int]$props['Modifiers'].Value -band [int][ConsoleModifiers]::Shift)) { return 'ShiftTab' }
            return 'Tab'
        }
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

function Read-AfyxMenuKey {
    param([Parameter(Mandatory)]$Terminal, [scriptblock]$ReadKey)
    if ($ReadKey) { return (& $ReadKey) }
    if (Test-AfyxDashboard -Terminal $Terminal) {
        try {
            while (-not $Host.UI.RawUI.KeyAvailable) {
                $width = [int]$Host.UI.RawUI.WindowSize.Width
                $height = [int]$Host.UI.RawUI.WindowSize.Height
                if ($width -ne $Terminal.Width -or $height -ne $Terminal.Height) {
                    Show-AfyxDashboard -Terminal $Terminal -ForceFull
                }
                Start-Sleep -Milliseconds 80
            }
        } catch {
            # Hosts without KeyAvailable still support the blocking ReadKey path.
        }
    }
    return $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
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
        $key = Read-AfyxMenuKey -Terminal $Terminal -ReadKey $ReadKey
        $action = Get-AfyxKeyAction -RawKey $key
        if ($null -eq $action) { continue }
        switch -Regex ($action) {
            '^Tab$' { Move-AfyxDashboardFocus -Terminal $Terminal }
            '^ShiftTab$' { Move-AfyxDashboardFocus -Terminal $Terminal -Direction -1 }
            '^LeftArrow$' { Move-AfyxDashboardFocus -Terminal $Terminal -Direction -1 }
            '^RightArrow$' { Move-AfyxDashboardFocus -Terminal $Terminal -Direction 1 }
            '^PageUp$' { Move-AfyxDashboardScroll -Terminal $Terminal -Direction -5 }
            '^PageDown$' { Move-AfyxDashboardScroll -Terminal $Terminal -Direction 5 }
            '^Home$' { Set-AfyxDashboardScroll -Terminal $Terminal -Position 0 }
            '^End$' { Set-AfyxDashboardScroll -Terminal $Terminal -Position ([int]::MaxValue) }
            '^UpArrow$' { if ((Test-AfyxDashboard -Terminal $Terminal) -and $Terminal.DashboardState.Focus -ne 1) { Move-AfyxDashboardScroll -Terminal $Terminal -Direction -1 } else { $selected = Get-AfyxEnabledOptionIndex -Options $Options -Start $selected -Direction -1 } }
            '^DownArrow$' { if ((Test-AfyxDashboard -Terminal $Terminal) -and $Terminal.DashboardState.Focus -ne 1) { Move-AfyxDashboardScroll -Terminal $Terminal -Direction 1 } else { $selected = Get-AfyxEnabledOptionIndex -Options $Options -Start $selected -Direction 1 } }
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
        $key = Read-AfyxMenuKey -Terminal $Terminal -ReadKey $ReadKey
        $action = Get-AfyxKeyAction -RawKey $key
        if ($null -eq $action) { continue }
        switch -Regex ($action) {
            '^Tab$' { Move-AfyxDashboardFocus -Terminal $Terminal }
            '^ShiftTab$' { Move-AfyxDashboardFocus -Terminal $Terminal -Direction -1 }
            '^LeftArrow$' { Move-AfyxDashboardFocus -Terminal $Terminal -Direction -1 }
            '^RightArrow$' { Move-AfyxDashboardFocus -Terminal $Terminal -Direction 1 }
            '^PageUp$' { Move-AfyxDashboardScroll -Terminal $Terminal -Direction -5 }
            '^PageDown$' { Move-AfyxDashboardScroll -Terminal $Terminal -Direction 5 }
            '^Home$' { Set-AfyxDashboardScroll -Terminal $Terminal -Position 0 }
            '^End$' { Set-AfyxDashboardScroll -Terminal $Terminal -Position ([int]::MaxValue) }
            '^UpArrow$' { if ((Test-AfyxDashboard -Terminal $Terminal) -and $Terminal.DashboardState.Focus -ne 1) { Move-AfyxDashboardScroll -Terminal $Terminal -Direction -1 } else { $selected = Get-AfyxEnabledOptionIndex -Options $Options -Start $selected -Direction -1 } }
            '^DownArrow$' { if ((Test-AfyxDashboard -Terminal $Terminal) -and $Terminal.DashboardState.Focus -ne 1) { Move-AfyxDashboardScroll -Terminal $Terminal -Direction 1 } else { $selected = Get-AfyxEnabledOptionIndex -Options $Options -Start $selected -Direction 1 } }
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
    # Text-only / redirected prompt: accept Y/N explicitly while retaining numbered and Enter behavior.
    $sourceLine = if ($ReadLine) { $ReadLine } else { { Read-Host 'Selection' } }
    $mappedLine = {
        $answer = ([string](& $sourceLine)).Trim()
        if ($answer -match '^(?i:y|yes)$') { return '1' }
        if ($answer -match '^(?i:n|no)$') { return '2' }
        return $answer
    }.GetNewClosure()
    return (Read-AfyxSingleChoice -Prompt $Prompt -Options $options -DefaultId 'no' -Terminal $Terminal -ReadKey $ReadKey -ReadLine $mappedLine -NoRender:$NoRender) -eq 'yes'
}

function Show-AfyxReceipt {
    [CmdletBinding()]
    param([Parameter(Mandatory)][object[]]$Items, [Parameter(Mandatory)]$Terminal, [string]$Title = 'Installation Receipt')
    if (Test-AfyxDashboard -Terminal $Terminal) {
        $Terminal.DashboardState.Step = 5
        $Terminal.DashboardState.Section = $Title
        $Terminal.DashboardState.Prompt = ''
        $Terminal.DashboardState.Options = @()
        $Terminal.DashboardState.Events = @($Items | ForEach-Object {
            [pscustomobject]@{ Text = "[$([string]$_.Status)] $([string]$_.Name) - $([string]$_.Detail)"; Tone = Get-AfyxStatusTone -Status ([string]$_.Status) }
        })
        $Terminal.DashboardState.Scroll[1] = 0
        $Terminal.DashboardState.Scroll[2] = 0
        Show-AfyxDashboard -Terminal $Terminal -ForceFull
        return
    }
    Write-AfyxSection -Title $Title -Terminal $Terminal
    foreach ($item in $Items) { Write-AfyxStatus -Status ([string]$item.Status) -Name ([string]$item.Name) -Detail ([string]$item.Detail) -Terminal $Terminal }
}

function ConvertFrom-AfyxJson {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true, ValueFromPipeline = $true)][string]$InputObject,
        [int]$Depth = 10
    )
    process {
        if ([string]::IsNullOrWhiteSpace($InputObject)) { return $null }
        if ($PSVersionTable.PSVersion.Major -ge 6) {
            return ($InputObject | ConvertFrom-Json -Depth $Depth)
        }
        return ($InputObject | ConvertFrom-Json)
    }
}

function Test-AfyxDashboard {
    param([Parameter(Mandatory)]$Terminal)
    return [bool]($Terminal.PSObject.Properties['DashboardState'] -and $Terminal.DashboardState.Enabled)
}

function Enable-AfyxDashboard {
    [CmdletBinding()]
    param([Parameter(Mandatory)]$Terminal, [string[]]$Providers = @())
    if (-not $Terminal.Interactive -or -not $Terminal.Ansi) { return }
    $state = [pscustomobject]@{
        Enabled = $true
        Step = 1
        Section = 'Environment'
        Prompt = ''
        Options = @()
        Selected = 0
        Checked = @{}
        Multiple = $false
        Providers = @($Providers)
        Events = @()
        Focus = 1
        Scroll = @{ 0 = 0; 1 = 0; 2 = 0 }
        LastFrame = @()
        LastWidth = 0
    }
    $Terminal | Add-Member -NotePropertyName DashboardState -NotePropertyValue $state -Force
    Show-AfyxDashboard -Terminal $Terminal -ForceFull
}

function Fit-AfyxDashboardLine {
    param([AllowEmptyString()][string]$Text, [int]$Width)
    if ($Width -lt 1) { return '' }
    $clean = ($Text -replace '[\r\n\t]', ' ')
    if ($clean.Length -gt $Width) {
        if ($Width -eq 1) { return '>' }
        return $clean.Substring(0, $Width - 1) + '>'
    }
    return $clean.PadRight($Width)
}

function Expand-AfyxDashboardItems {
    param([object[]]$Items, [int]$Width)
    $expanded = @()
    $limit = [Math]::Max(8, $Width)
    $hangIndent = '  '
    foreach ($item in $Items) {
        $remaining = [string]$item.Text
        $tone = if ($item.PSObject.Properties['Tone']) { [string]$item.Tone } else { 'Text' }
        $selected = [bool]($item.PSObject.Properties['Selected'] -and $item.Selected)
        $isFirstLine = $true
        while ($remaining.Length -gt $limit) {
            $effectiveLimit = if ($isFirstLine) { $limit } else { [Math]::Max(6, $limit - $hangIndent.Length) }
            $cut = -1
            $spaceCut = $remaining.LastIndexOf(' ', [Math]::Min($remaining.Length - 1, $effectiveLimit - 1), $effectiveLimit)
            if ($spaceCut -ge [Math]::Floor($effectiveLimit / 3)) {
                $cut = $spaceCut
            } else {
                $delims = @(';', ',', '\', '/')
                foreach ($delim in $delims) {
                    $dCut = $remaining.LastIndexOf($delim, [Math]::Min($remaining.Length - 1, $effectiveLimit - 1), $effectiveLimit)
                    if ($dCut -ge [Math]::Floor($effectiveLimit / 3) -and $dCut -gt $cut) {
                        $cut = $dCut + 1
                    }
                }
            }
            if ($cut -le 0 -or $cut -gt $effectiveLimit) { $cut = $effectiveLimit }
            $chunk = $remaining.Substring(0, $cut)
            $lineText = if ($isFirstLine) { $chunk } else { "$hangIndent$chunk" }
            $expanded += [pscustomobject]@{ Text = $lineText; Tone = $tone; Selected = $selected }
            $remaining = $remaining.Substring($cut).TrimStart()
            $selected = $false
            $isFirstLine = $false
        }
        $lastLine = if ($isFirstLine) { $remaining } else { "$hangIndent$remaining" }
        $expanded += [pscustomobject]@{ Text = $lastLine; Tone = $tone; Selected = $selected }
    }
    return $expanded
}

function Select-AfyxDashboardWindow {
    param([object[]]$Items, [int]$Capacity, $State, [int]$Panel)
    $capacity = [Math]::Max(1, $Capacity)
    $last = [Math]::Max(0, $Items.Count - $capacity)
    $start = [Math]::Max(0, [Math]::Min([long]$State.Scroll[$Panel], [long]$last))
    $State.Scroll[$Panel] = [int]$start
    return @($Items | Select-Object -Skip $start -First $capacity)
}

function Format-AfyxDashboardSegment {
    param([string]$Text, [string]$Tone, [string]$Background, $Terminal)
    if (-not $Terminal.Ansi) { return $Text }
    $foreground = $script:AfyxPalette[$Tone]
    if (-not $foreground) { $foreground = $script:AfyxPalette.Text }
    $backgroundCode = switch ($Background) {
        'Focus' { '48;2;34;211;238' }
        'Base' { '48;2;11;16;32' }
        default { '48;2;17;25;43' }
    }
    if ($Background -eq 'Focus') { $foreground = '38;2;11;16;32' }
    return "$script:AfyxAnsi[$foreground;$backgroundCode" + "m$Text$script:AfyxAnsi[0m"
}

function New-AfyxDashboardPanel {
    param(
        [string]$Title,
        [object[]]$Items,
        [int]$Width,
        [int]$Height,
        $Terminal,
        [bool]$Focused = $false,
        [int]$TotalCount = 0,
        [int]$StartIndex = 0
    )
    $horizontal = [string][char]0x2500
    $vertical = [string][char]0x2502
    $top = [string][char]0x256D + ($horizontal * ($Width - 2)) + [char]0x256E
    $bottom = [string][char]0x2570 + ($horizontal * ($Width - 2)) + [char]0x256F
    $borderTone = if ($Focused) { 'Primary' } else { 'Secondary' }
    $result = @((Format-AfyxDashboardSegment -Text $top -Tone $borderTone -Background Base -Terminal $Terminal))
    $interior = [Math]::Max(0, $Height - 2)
    $contentWidth = [Math]::Max(4, $Width - 4)

    for ($index = 0; $index -lt $interior; $index++) {
        $item = if ($index -eq 0) {
            $headerText = " $Title"
            if ($TotalCount -gt ($interior - 1)) {
                $endIndex = [Math]::Min($TotalCount, $StartIndex + $interior - 1)
                $upArrow = if ($StartIndex -gt 0) { '^' } else { ' ' }
                $downArrow = if ($endIndex -lt $TotalCount) { 'v' } else { ' ' }
                $headerText = " $Title $upArrow[$($StartIndex + 1)-$endIndex/$TotalCount]$downArrow"
            }
            [pscustomobject]@{ Text = $headerText; Tone = $borderTone; Selected = $false }
        } elseif (($index - 1) -lt $Items.Count) {
            $Items[$index - 1]
        } else {
            [pscustomobject]@{ Text = ''; Tone = 'Text'; Selected = $false }
        }
        $tone = if ($item.PSObject.Properties['Tone']) { [string]$item.Tone } else { 'Text' }
        $selected = [bool]($item.PSObject.Properties['Selected'] -and $item.Selected)
        $background = if ($selected) { 'Focus' } else { 'Surface' }
        $content = Fit-AfyxDashboardLine -Text ([string]$item.Text) -Width $contentWidth
        $result += (Format-AfyxDashboardSegment -Text $vertical -Tone $borderTone -Background Base -Terminal $Terminal) +
            (Format-AfyxDashboardSegment -Text " $content " -Tone $tone -Background $background -Terminal $Terminal) +
            (Format-AfyxDashboardSegment -Text $vertical -Tone $borderTone -Background Base -Terminal $Terminal)
    }
    $result += Format-AfyxDashboardSegment -Text $bottom -Tone $borderTone -Background Base -Terminal $Terminal
    return $result
}

function Get-AfyxDashboardFrame {
    [CmdletBinding()]
    param([Parameter(Mandatory)]$Terminal)
    $state = $Terminal.DashboardState
    $width = [Math]::Max(40, [int]$Terminal.Width)
    $height = [Math]::Max(20, [int]$Terminal.Height)
    $wide = $width -ge 96
    $brandLines = @(
        ' AFYX  /  ENGINEERING KIT'
        ' MIDNIGHT CIRCUIT  |  ALPHA INSTALLER'
        " $($state.Section)  |  Component versions and source identity in the review"
    )
    $header = @($brandLines | ForEach-Object { Fit-AfyxDashboardLine -Text $_ -Width $width })
    $frame = @($header | ForEach-Object { Format-AfyxDashboardSegment -Text $_ -Tone Primary -Background Base -Terminal $Terminal })
    $steps = @('DETECT', 'SELECT', 'CONFIGURE', 'REVIEW/APPLY', 'FINISH')
    if ($wide) {
        $stepParts = @()
        for ($index = 0; $index -lt $steps.Count; $index++) {
            $mark = if (($index + 1) -eq $state.Step) { '>' } elseif (($index + 1) -lt $state.Step) { '+' } else { ' ' }
            $stepParts += "$mark$($index + 1) $($steps[$index])"
        }
        $stepText = '  ' + ($stepParts -join '  --  ')
    } else {
        $stepText = "  STEP $($state.Step)/5  $($steps[$state.Step - 1])"
    }
    $frame += Format-AfyxDashboardSegment -Text (Fit-AfyxDashboardLine -Text $stepText -Width $width) -Tone Secondary -Background Base -Terminal $Terminal

    $choice = @()
    if ($state.Prompt) {
        $choice += [pscustomobject]@{ Text = "$($state.Prompt)"; Tone = 'Accent'; Selected = $false }
        for ($index = 0; $index -lt $state.Options.Count; $index++) {
            $option = $state.Options[$index]
            $enabled = -not $option.PSObject.Properties['Enabled'] -or [bool]$option.Enabled
            $mark = if ($state.Multiple) { if ($state.Checked.ContainsKey([string]$option.Id)) { '[x]' } else { '[ ]' } } else { "[$($index + 1)]" }
            $cursor = if ($index -eq $state.Selected) { '>' } else { ' ' }
            $choice += [pscustomobject]@{
                Text = "$cursor $mark $($option.Label)"
                Tone = if ($enabled) { 'Text' } else { 'Muted' }
                Selected = ($index -eq $state.Selected -and $enabled)
            }
            if (($index -eq $state.Selected -or $state.Options.Count -le 4) -and $option.PSObject.Properties['Detail'] -and $option.Detail) {
                $choice += [pscustomobject]@{ Text = "    $($option.Detail)"; Tone = 'Muted'; Selected = $false }
            }
        }
    } else {
        $choice += [pscustomobject]@{ Text = "$($state.Section)"; Tone = 'Accent'; Selected = $false }
        $choice += @($state.Events)
    }
    $providers = @($state.Providers | ForEach-Object { [pscustomobject]@{ Text = "$_"; Tone = 'Text'; Selected = $false } })
    if (-not $providers.Count) { $providers = @([pscustomobject]@{ Text = 'Detection pending'; Tone = 'Muted'; Selected = $false }) }
    $activity = @($state.Events)
    if (-not $activity.Count) { $activity = @([pscustomobject]@{ Text = 'Awaiting selection'; Tone = 'Muted'; Selected = $false }) }
    $panelHeight = $height - 5
    if ($wide) {
        $gap = '  '
        $usable = $width - 4
        $leftWidth = [Math]::Floor($usable * 0.25)
        $middleWidth = [Math]::Floor($usable * 0.44)
        $rightWidth = $usable - $leftWidth - $middleWidth
        $providers = @(Expand-AfyxDashboardItems -Items $providers -Width ($leftWidth - 4))
        $choice = @(Expand-AfyxDashboardItems -Items $choice -Width ($middleWidth - 4))
        $activity = @(Expand-AfyxDashboardItems -Items $activity -Width ($rightWidth - 4))
        $leftHeight = [Math]::Min($panelHeight, [Math]::Max(6, $providers.Count + 3))
        $middleHeight = [Math]::Min($panelHeight, [Math]::Max(8, $choice.Count + 3))
        $rightHeight = [Math]::Min($panelHeight, [Math]::Max(8, $activity.Count + 3))
        $contentHeight = [Math]::Max($leftHeight, [Math]::Max($middleHeight, $rightHeight))
        $left = New-AfyxDashboardPanel -Title 'PROVIDERS / HOST' -Items @(Select-AfyxDashboardWindow -Items $providers -Capacity ($leftHeight - 3) -State $state -Panel 0) -Width $leftWidth -Height $leftHeight -Terminal $Terminal -Focused ($state.Focus -eq 0) -TotalCount $providers.Count -StartIndex ([int]$state.Scroll[0])
        $middle = New-AfyxDashboardPanel -Title 'SELECTION / STATUS' -Items @(Select-AfyxDashboardWindow -Items $choice -Capacity ($middleHeight - 3) -State $state -Panel 1) -Width $middleWidth -Height $middleHeight -Terminal $Terminal -Focused ($state.Focus -eq 1) -TotalCount $choice.Count -StartIndex ([int]$state.Scroll[1])
        $right = New-AfyxDashboardPanel -Title 'PLAN / ACTIVITY' -Items @(Select-AfyxDashboardWindow -Items $activity -Capacity ($rightHeight - 3) -State $state -Panel 2) -Width $rightWidth -Height $rightHeight -Terminal $Terminal -Focused ($state.Focus -eq 2) -TotalCount $activity.Count -StartIndex ([int]$state.Scroll[2])
        $blankLeft = Format-AfyxDashboardSegment -Text (' ' * $leftWidth) -Tone Muted -Background Base -Terminal $Terminal
        $blankMiddle = Format-AfyxDashboardSegment -Text (' ' * $middleWidth) -Tone Muted -Background Base -Terminal $Terminal
        $blankRight = Format-AfyxDashboardSegment -Text (' ' * $rightWidth) -Tone Muted -Background Base -Terminal $Terminal
        for ($index = 0; $index -lt $contentHeight; $index++) {
            $frame += $(if ($index -lt $left.Count) { $left[$index] } else { $blankLeft }) + $gap + $(if ($index -lt $middle.Count) { $middle[$index] } else { $blankMiddle }) + $gap + $(if ($index -lt $right.Count) { $right[$index] } else { $blankRight })
        }
        while ($frame.Count -lt $height - 1) {
            $frame += Format-AfyxDashboardSegment -Text (' ' * $width) -Tone Muted -Background Base -Terminal $Terminal
        }
    } else {
        $mainHeight = [Math]::Max(8, $height - 14)
        $subHeight = [Math]::Max(4, [Math]::Floor(($height - $mainHeight - 5) / 2))
        $choice = @(Expand-AfyxDashboardItems -Items $choice -Width ($width - 4))
        $providers = @(Expand-AfyxDashboardItems -Items $providers -Width ($width - 4))
        $activity = @(Expand-AfyxDashboardItems -Items $activity -Width ($width - 4))
        $frame += New-AfyxDashboardPanel -Title 'SELECTION / STATUS' -Items @(Select-AfyxDashboardWindow -Items $choice -Capacity ($mainHeight - 3) -State $state -Panel 1) -Width $width -Height $mainHeight -Terminal $Terminal -Focused ($state.Focus -eq 1) -TotalCount $choice.Count -StartIndex ([int]$state.Scroll[1])
        $frame += New-AfyxDashboardPanel -Title 'PROVIDERS / HOST' -Items @(Select-AfyxDashboardWindow -Items $providers -Capacity ($subHeight - 3) -State $state -Panel 0) -Width $width -Height $subHeight -Terminal $Terminal -Focused ($state.Focus -eq 0) -TotalCount $providers.Count -StartIndex ([int]$state.Scroll[0])
        $frame += New-AfyxDashboardPanel -Title 'PLAN / ACTIVITY' -Items @(Select-AfyxDashboardWindow -Items $activity -Capacity ($subHeight - 3) -State $state -Panel 2) -Width $width -Height $subHeight -Terminal $Terminal -Focused ($state.Focus -eq 2) -TotalCount $activity.Count -StartIndex ([int]$state.Scroll[2])
    }
    $footer = if ($wide) { '  UP/DOWN scroll/move  TAB/ARROWS switch panel  SPACE toggle  ENTER continue  ESC cancel' } else { '  UP/DOWN move  TAB panel  SPACE toggle  ENTER select  ESC cancel' }
    $frame += Format-AfyxDashboardSegment -Text (Fit-AfyxDashboardLine -Text $footer -Width $width) -Tone Muted -Background Base -Terminal $Terminal
    return $frame
}

function Show-AfyxDashboard {
    [CmdletBinding()]
    param([Parameter(Mandatory)]$Terminal, [switch]$ForceFull)
    if (-not (Test-AfyxDashboard -Terminal $Terminal)) { return }
    try {
        $Terminal.Width = [Math]::Max(40, [int]$Host.UI.RawUI.WindowSize.Width)
        $Terminal.Height = [Math]::Max(20, [int]$Host.UI.RawUI.WindowSize.Height)
    } catch { }
    $state = $Terminal.DashboardState
    $frame = @(Get-AfyxDashboardFrame -Terminal $Terminal)
    $escape = [char]27
    $changes = ''
    if ($state.LastWidth -ne $Terminal.Width -or $state.LastFrame.Count -ne $frame.Count) {
        $changes += "$escape[2J"
        $ForceFull = $true
    }
    for ($index = 0; $index -lt $frame.Count; $index++) {
        if ($ForceFull -or $index -ge $state.LastFrame.Count -or $frame[$index] -cne $state.LastFrame[$index]) {
            $changes += "$escape[$($index + 1);1H$escape[2K$($frame[$index])"
        }
    }
    if ($changes) {
        Write-Host -NoNewline "$escape[?25l$changes$escape[$($frame.Count + 1);1H$escape[?25h"
    }
    $state.LastFrame = $frame
    $state.LastWidth = $Terminal.Width
}

function Move-AfyxDashboardFocus {
    param([Parameter(Mandatory)]$Terminal, [int]$Direction = 1)
    if (-not (Test-AfyxDashboard -Terminal $Terminal)) { return }
    $Terminal.DashboardState.Focus = ($Terminal.DashboardState.Focus + $Direction + 3) % 3
    Show-AfyxDashboard -Terminal $Terminal
}

function Move-AfyxDashboardScroll {
    param([Parameter(Mandatory)]$Terminal, [int]$Direction)
    if (-not (Test-AfyxDashboard -Terminal $Terminal)) { return }
    $panel = [int]$Terminal.DashboardState.Focus
    $Terminal.DashboardState.Scroll[$panel] = [Math]::Max(0, [long]$Terminal.DashboardState.Scroll[$panel] + $Direction)
    Show-AfyxDashboard -Terminal $Terminal
}

function Set-AfyxDashboardScroll {
    param([Parameter(Mandatory)]$Terminal, [int]$Position)
    if (-not (Test-AfyxDashboard -Terminal $Terminal)) { return }
    $panel = [int]$Terminal.DashboardState.Focus
    $Terminal.DashboardState.Scroll[$panel] = [Math]::Max(0, [long]$Position)
    Show-AfyxDashboard -Terminal $Terminal
}

function Disable-AfyxDashboard {
    [CmdletBinding()]
    param([Parameter(Mandatory)]$Terminal)
    if (-not (Test-AfyxDashboard -Terminal $Terminal)) { return }
    $escape = [char]27
    $height = if ($Terminal.DashboardState.LastFrame.Count) { $Terminal.DashboardState.LastFrame.Count } else { 24 }
    Write-Host "$escape[$($height + 1);1H$escape[?25h"
    $Terminal.DashboardState.Enabled = $false
}

Export-ModuleMember -Function Test-AfyxAnsiSupport, Test-AfyxInteractiveTerminal, New-AfyxTerminalContext, Get-AfyxStyledText, Format-AfyxWrappedText, Write-AfyxText, Show-AfyxBanner, Show-AfyxStep, Write-AfyxSection, Write-AfyxStatus, Get-AfyxOutcomeStatus, Get-AfyxKeyAction, Read-AfyxSingleChoice, Read-AfyxMultiChoice, Read-AfyxConfirmation, Show-AfyxReceipt, ConvertFrom-AfyxJson, Enable-AfyxDashboard, Get-AfyxDashboardFrame, Show-AfyxDashboard, Move-AfyxDashboardFocus, Move-AfyxDashboardScroll, Set-AfyxDashboardScroll, Disable-AfyxDashboard, Test-AfyxDashboard
