Set-StrictMode -Version Latest

function Test-ObjectProperty {
    param([object]$InputObject, [string]$Name)

    return $null -ne $InputObject -and $null -ne $InputObject.PSObject.Properties[$Name]
}

function Get-Int64Property {
    param([object]$InputObject, [string]$Name)

    if (-not (Test-ObjectProperty -InputObject $InputObject -Name $Name)) {
        return [long]0
    }
    return [long]$InputObject.$Name
}

function New-CodexUsage {
    [CmdletBinding()]
    param([object]$Telemetry)

    if ($null -eq $Telemetry) {
        return [pscustomobject]@{
            InputTokens          = [long]0
            CachedInputTokens    = [long]0
            CacheWriteInputTokens = [long]0
            OutputTokens         = [long]0
            ReasoningTokens      = [long]0
            TotalTokens          = [long]0
            CacheWriteAvailable  = $false
            ReasoningAvailable   = $false
            TotalDerived         = $false
        }
    }

    $inputTokenCount = Get-Int64Property $Telemetry 'input_tokens'
    $outputTokenCount = Get-Int64Property $Telemetry 'output_tokens'
    $hasTotal = Test-ObjectProperty $Telemetry 'total_tokens'

    return [pscustomobject]@{
        InputTokens           = $inputTokenCount
        CachedInputTokens     = Get-Int64Property $Telemetry 'cached_input_tokens'
        CacheWriteInputTokens = Get-Int64Property $Telemetry 'cache_write_input_tokens'
        OutputTokens          = $outputTokenCount
        ReasoningTokens       = Get-Int64Property $Telemetry 'reasoning_output_tokens'
        TotalTokens           = if ($hasTotal) { Get-Int64Property $Telemetry 'total_tokens' } else { $inputTokenCount + $outputTokenCount }
        CacheWriteAvailable   = Test-ObjectProperty $Telemetry 'cache_write_input_tokens'
        ReasoningAvailable    = Test-ObjectProperty $Telemetry 'reasoning_output_tokens'
        TotalDerived          = -not $hasTotal
    }
}

function Copy-CodexUsage {
    param([object]$Usage)

    return [pscustomobject]@{
        InputTokens           = [long]$Usage.InputTokens
        CachedInputTokens     = [long]$Usage.CachedInputTokens
        CacheWriteInputTokens = [long]$Usage.CacheWriteInputTokens
        OutputTokens          = [long]$Usage.OutputTokens
        ReasoningTokens       = [long]$Usage.ReasoningTokens
        TotalTokens           = [long]$Usage.TotalTokens
        CacheWriteAvailable   = [bool]$Usage.CacheWriteAvailable
        ReasoningAvailable    = [bool]$Usage.ReasoningAvailable
        TotalDerived          = [bool]$Usage.TotalDerived
    }
}

function Get-CodexUsageDelta {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [object]$Current,
        [Parameter(Mandatory)] [object]$Baseline
    )

    $numericFields = @(
        'InputTokens', 'CachedInputTokens', 'CacheWriteInputTokens',
        'OutputTokens', 'ReasoningTokens', 'TotalTokens'
    )
    $resetDetected = $false
    foreach ($field in $numericFields) {
        if ([long]$Current.$field -lt [long]$Baseline.$field) {
            $resetDetected = $true
            break
        }
    }

    $effectiveBaseline = if ($resetDetected) { New-CodexUsage } else { $Baseline }
    $values = @{}
    foreach ($field in $numericFields) {
        $values[$field] = [Math]::Max([long]0, ([long]$Current.$field - [long]$effectiveBaseline.$field))
    }

    return [pscustomobject]@{
        InputTokens           = $values.InputTokens
        CachedInputTokens     = $values.CachedInputTokens
        CacheWriteInputTokens = $values.CacheWriteInputTokens
        OutputTokens          = $values.OutputTokens
        ReasoningTokens       = $values.ReasoningTokens
        TotalTokens           = $values.TotalTokens
        CacheWriteAvailable   = [bool]$Current.CacheWriteAvailable
        ReasoningAvailable    = [bool]$Current.ReasoningAvailable
        TotalDerived          = [bool]$Current.TotalDerived
        ResetDetected         = $resetDetected
    }
}

function Test-CodexUsageEqual {
    param([object]$Left, [object]$Right)

    if ($null -eq $Left -or $null -eq $Right) { return $false }
    foreach ($field in @('InputTokens', 'CachedInputTokens', 'CacheWriteInputTokens', 'OutputTokens', 'ReasoningTokens', 'TotalTokens')) {
        if ([long]$Left.$field -ne [long]$Right.$field) { return $false }
    }
    return $true
}

function Get-CodexUncachedInput {
    param([Parameter(Mandatory)] [object]$Usage)

    return [Math]::Max(
        [long]0,
        [long]$Usage.InputTokens - [long]$Usage.CachedInputTokens - [long]$Usage.CacheWriteInputTokens
    )
}

function Import-CodexPricing {
    [CmdletBinding()]
    param([Parameter(Mandatory)] [string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Pricing configuration not found: $Path"
    }
    return Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json -AsHashtable -Depth 20
}

function Get-CodexModelPricing {
    param([hashtable]$Pricing, [string]$Model)

    if (-not $Model -or -not $Pricing.ContainsKey('models')) { return $null }
    foreach ($key in $Pricing.models.Keys) {
        if ([string]::Equals([string]$key, $Model, [StringComparison]::OrdinalIgnoreCase)) {
            return $Pricing.models[$key]
        }
    }
    return $null
}

function Get-CodexUsageCost {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [object]$Usage,
        [Parameter(Mandatory)] [hashtable]$Pricing,
        [string]$Model
    )

    $modelPricing = Get-CodexModelPricing -Pricing $Pricing -Model $Model
    if ($null -eq $modelPricing) {
        return [pscustomobject]@{ Available = $false; Amount = $null; Band = $null }
    }

    $threshold = if ($modelPricing.ContainsKey('long_context_threshold_tokens')) {
        [long]$modelPricing.long_context_threshold_tokens
    } else {
        [long]::MaxValue
    }
    $bandName = if ([long]$Usage.InputTokens -ge $threshold) { 'long' } else { 'short' }
    if (-not $modelPricing.ContainsKey($bandName)) {
        return [pscustomobject]@{ Available = $false; Amount = $null; Band = $bandName }
    }

    $rates = $modelPricing[$bandName]
    $tokenCounts = [ordered]@{
        input       = Get-CodexUncachedInput $Usage
        cached      = [long]$Usage.CachedInputTokens
        cache_write = [long]$Usage.CacheWriteInputTokens
        output      = [long]$Usage.OutputTokens
    }
    [decimal]$cost = 0
    foreach ($category in $tokenCounts.Keys) {
        if ($tokenCounts[$category] -eq 0) { continue }
        if (-not $rates.ContainsKey($category) -or $null -eq $rates[$category]) {
            return [pscustomobject]@{ Available = $false; Amount = $null; Band = $bandName }
        }
        $cost += ([decimal]$tokenCounts[$category] * [decimal]$rates[$category]) / [decimal]$Pricing.unit_tokens
    }

    return [pscustomobject]@{ Available = $true; Amount = $cost; Band = $bandName }
}

function New-CodexUsageParserState {
    [CmdletBinding()]
    param()

    return [pscustomobject]@{
        Baseline             = New-CodexUsage
        LatestCumulative     = $null
        LatestTurnUsage      = $null
        CurrentModel         = $null
        CurrentTurnId        = $null
        TurnCost             = [decimal]0
        TurnCostAvailable    = $true
        TurnCostObserved     = $false
        CompletionCount      = 0
    }
}

function Reset-CodexTurnCost {
    param([Parameter(Mandatory)] [object]$State)

    $State.TurnCost = [decimal]0
    $State.TurnCostAvailable = $true
    $State.TurnCostObserved = $false
    $State.LatestTurnUsage = $null
}

function ConvertFrom-CodexTelemetryLine {
    [CmdletBinding()]
    param([Parameter(Mandatory)] [string]$Line)

    if ([string]::IsNullOrWhiteSpace($Line)) { return $null }
    $outerType = [regex]::Match($Line, '"type"\s*:\s*"([^"]+)"')
    if (-not $outerType.Success) { return $null }
    $outer = $outerType.Groups[1].Value
    if ($outer -notin @('turn_context', 'token_usage_record', 'event_msg')) { return $null }
    if ($outer -eq 'event_msg' -and $Line -notmatch '"type"\s*:\s*"(task_started|task_complete|token_count)"') {
        return $null
    }
    try {
        return $Line | ConvertFrom-Json -Depth 50 -ErrorAction Stop
    } catch {
        return $null
    }
}

function Update-CodexUsageState {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [object]$State,
        [Parameter(Mandatory)] [object]$Event,
        [Parameter(Mandatory)] [hashtable]$Pricing,
        [string]$SessionFile
    )

    $outerType = [string]$Event.type
    $payload = if (Test-ObjectProperty $Event 'payload') { $Event.payload } else { $Event }
    $eventType = if (Test-ObjectProperty $payload 'type') { [string]$payload.type } else { $outerType }

    if ($outerType -eq 'turn_context') {
        if (Test-ObjectProperty $payload 'model') { $State.CurrentModel = [string]$payload.model }
        if (Test-ObjectProperty $payload 'turn_id') { $State.CurrentTurnId = [string]$payload.turn_id }
        return $null
    }

    if ($eventType -eq 'task_started') {
        if (Test-ObjectProperty $payload 'turn_id') { $State.CurrentTurnId = [string]$payload.turn_id }
        $State.CurrentModel = $null
        Reset-CodexTurnCost $State
        return $null
    }

    if ($outerType -eq 'token_usage_record') {
        if (Test-ObjectProperty $payload 'thread_token_usage') {
            $State.LatestCumulative = New-CodexUsage $payload.thread_token_usage
        }
        if (Test-ObjectProperty $payload 'turn_token_usage') {
            $State.LatestTurnUsage = New-CodexUsage $payload.turn_token_usage
        }
        if (Test-ObjectProperty $payload 'usage') {
            $callUsage = New-CodexUsage $payload.usage
            $cost = Get-CodexUsageCost -Usage $callUsage -Pricing $Pricing -Model $State.CurrentModel
            $State.TurnCostObserved = $true
            if ($cost.Available -and $State.TurnCostAvailable) {
                $State.TurnCost += [decimal]$cost.Amount
            } else {
                $State.TurnCostAvailable = $false
            }
        }
        return $null
    }

    if ($eventType -eq 'token_count' -and (Test-ObjectProperty $payload 'info')) {
        if (Test-ObjectProperty $payload.info 'total_token_usage') {
            $State.LatestCumulative = New-CodexUsage $payload.info.total_token_usage
        }
        return $null
    }

    if ($eventType -ne 'task_complete' -or $null -eq $State.LatestCumulative) {
        return $null
    }

    $cumulativeDelta = Get-CodexUsageDelta -Current $State.LatestCumulative -Baseline $State.Baseline
    $selectedUsage = $cumulativeDelta
    $usageSource = 'cumulative_delta'
    if ($null -ne $State.LatestTurnUsage -and -not (Test-CodexUsageEqual $cumulativeDelta $State.LatestTurnUsage)) {
        # A prior aborted turn can create a gap in the completed-turn baseline.
        # Current telemetry supplies an exact per-turn value, so prefer it in that case.
        $selectedUsage = Copy-CodexUsage $State.LatestTurnUsage
        $usageSource = 'turn_token_usage'
    }

    $completion = [pscustomobject]@{
        CompletedAt           = if (Test-ObjectProperty $payload 'completed_at') { $payload.completed_at } else { $Event.timestamp }
        TurnId                = if (Test-ObjectProperty $payload 'turn_id') { [string]$payload.turn_id } else { $State.CurrentTurnId }
        Model                 = if ($State.CurrentModel) { [string]$State.CurrentModel } else { 'unknown' }
        InputTokens           = [long]$selectedUsage.InputTokens
        CachedInputTokens     = [long]$selectedUsage.CachedInputTokens
        CacheWriteInputTokens = [long]$selectedUsage.CacheWriteInputTokens
        UncachedInputTokens   = Get-CodexUncachedInput $selectedUsage
        OutputTokens          = [long]$selectedUsage.OutputTokens
        ReasoningTokens       = [long]$selectedUsage.ReasoningTokens
        ReasoningAvailable    = [bool]$selectedUsage.ReasoningAvailable
        TotalTokens           = [long]$selectedUsage.TotalTokens
        TotalDerived          = [bool]$selectedUsage.TotalDerived
        UsageSource           = $usageSource
        ApiEquivalentAvailable = [bool]($State.TurnCostObserved -and $State.TurnCostAvailable)
        ApiEquivalentCost     = if ($State.TurnCostObserved -and $State.TurnCostAvailable) { [decimal]$State.TurnCost } else { $null }
        SessionFile           = if ($SessionFile) { Split-Path -Leaf $SessionFile } else { $null }
    }

    $State.Baseline = Copy-CodexUsage $State.LatestCumulative
    $State.CompletionCount++
    Reset-CodexTurnCost $State
    return $completion
}

function Format-CodexUsageSummary {
    [CmdletBinding()]
    param([Parameter(Mandatory)] [object]$Completion)

    $culture = [Globalization.CultureInfo]::InvariantCulture
    $number = { param([long]$Value) $Value.ToString('N0', $culture) }
    $cost = if ($Completion.ApiEquivalentAvailable) {
        '~$' + ([decimal]$Completion.ApiEquivalentCost).ToString('0.000000', $culture)
    } else {
        'N/A'
    }

    $lines = [System.Collections.Generic.List[string]]::new()
    $lines.Add('╭─ Codex Turn Usage ──────────────────────────────────╮')
    $lines.Add(('│ Model          : {0}' -f $Completion.Model))
    $lines.Add(('│ Input          : {0,14} tokens' -f (& $number $Completion.InputTokens)))
    $lines.Add(('│   Uncached     : {0,14} tokens' -f (& $number $Completion.UncachedInputTokens)))
    $lines.Add(('│   Cached       : {0,14} tokens' -f (& $number $Completion.CachedInputTokens)))
    if ([long]$Completion.CacheWriteInputTokens -gt 0) {
        $lines.Add(('│   Cache write  : {0,14} tokens' -f (& $number $Completion.CacheWriteInputTokens)))
    }
    $lines.Add(('│ Output         : {0,14} tokens' -f (& $number $Completion.OutputTokens)))
    if ($Completion.ReasoningAvailable) {
        $lines.Add(('│   Reasoning    : {0,14} tokens' -f (& $number $Completion.ReasoningTokens)))
    }
    $lines.Add(('│ Total          : {0,14} tokens' -f (& $number $Completion.TotalTokens)))
    $lines.Add(('│ API-equivalent : {0}' -f $cost))
    $lines.Add('╰──────────────────────────────────────────────────────╯')
    return $lines.ToArray()
}

function Format-CodexUsageUiMessage {
    [CmdletBinding()]
    param([Parameter(Mandatory)] [object]$Completion)

    $culture = [Globalization.CultureInfo]::InvariantCulture
    $number = { param([long]$Value) $Value.ToString('N0', $culture) }
    $cost = if ($Completion.ApiEquivalentAvailable) {
        '~$' + ([decimal]$Completion.ApiEquivalentCost).ToString('0.000000', $culture)
    } else {
        'API-equivalent N/A'
    }
    $headline = 'Codex Usage · {0} tokens · {1}' -f (& $number $Completion.TotalTokens), $cost
    $parts = [System.Collections.Generic.List[string]]::new()
    $parts.Add(('Input {0}' -f (& $number $Completion.InputTokens)))
    $parts.Add(('Cached {0}' -f (& $number $Completion.CachedInputTokens)))
    if ([long]$Completion.CacheWriteInputTokens -gt 0) {
        $parts.Add(('Cache Write {0}' -f (& $number $Completion.CacheWriteInputTokens)))
    }
    $parts.Add(('Output {0}' -f (& $number $Completion.OutputTokens)))
    if ($Completion.ReasoningAvailable) {
        $parts.Add(('Reasoning {0}' -f (& $number $Completion.ReasoningTokens)))
    }
    return $headline + "`n" + ($parts -join ' · ')
}

function Get-CodexTurnCompletion {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)] [string]$TranscriptPath,
        [Parameter(Mandatory)] [string]$TurnId,
        [Parameter(Mandatory)] [hashtable]$Pricing,
        [ref]$FailureStage
    )

    if (-not (Test-Path -LiteralPath $TranscriptPath -PathType Leaf)) {
        if ($null -ne $FailureStage) { $FailureStage.Value = 'TRANSCRIPT_NOT_FOUND' }
        return $null
    }

    # Stop runs before Codex writes task_complete. Read only the exact turn's tail,
    # then use the existing parser with a local completion boundary supplied by Stop.
    $stream = [IO.File]::Open(
        $TranscriptPath,
        [IO.FileMode]::Open,
        [IO.FileAccess]::Read,
        [IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete
    )
    try {
        [long]$length = $stream.Length
        [long]$window = [Math]::Min([long](512KB), $length)
        [long]$maximumWindow = [Math]::Min([long](64MB), $length)
        $turnLines = $null
        do {
            [long]$offset = $length - $window
            [void]$stream.Seek($offset, [IO.SeekOrigin]::Begin)
            $bytes = [byte[]]::new([int]$window)
            $read = 0
            while ($read -lt $bytes.Length) {
                $count = $stream.Read($bytes, $read, $bytes.Length - $read)
                if ($count -eq 0) { break }
                $read += $count
            }
            $text = [Text.Encoding]::UTF8.GetString($bytes, 0, $read)
            $lines = @([regex]::Split($text, "`r?`n"))
            if ($offset -gt 0 -and $lines.Count -gt 1) { $lines = @($lines[1..($lines.Count - 1)]) }

            $turnPattern = '"turn_id"\s*:\s*"' + [regex]::Escape($TurnId) + '"'
            for ($index = $lines.Count - 1; $index -ge 0; $index--) {
                if ($lines[$index] -match '"type"\s*:\s*"task_started"' -and $lines[$index] -match $turnPattern) {
                    $turnLines = @($lines[$index..($lines.Count - 1)])
                    break
                }
            }
            if ($null -ne $turnLines -or $offset -eq 0) { break }
            if ($window -ge $maximumWindow) { break }
            $window = [Math]::Min($maximumWindow, $window * 2)
        } while ($true)
    } finally {
        $stream.Dispose()
    }

    if ($null -eq $turnLines) {
        if ($null -ne $FailureStage) { $FailureStage.Value = 'TURN_NOT_FOUND' }
        return $null
    }
    $state = New-CodexUsageParserState
    $usageEventObserved = $false
    foreach ($line in $turnLines) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        if ($line -match '"type"\s*:\s*"token_usage_record"' -and
            $line -match ('"turn_id"\s*:\s*"' + [regex]::Escape($TurnId) + '"')) {
            $usageEventObserved = $true
        }
        $event = ConvertFrom-CodexTelemetryLine -Line $line
        if ($null -eq $event) { continue }
        $completion = Update-CodexUsageState -State $state -Event $event -Pricing $Pricing -SessionFile $TranscriptPath
        if ($null -ne $completion -and [string]::Equals([string]$completion.TurnId, $TurnId, [StringComparison]::Ordinal)) {
            return $completion
        }
    }

    if (-not [string]::Equals([string]$state.CurrentTurnId, $TurnId, [StringComparison]::Ordinal)) {
        if ($null -ne $FailureStage) { $FailureStage.Value = 'TURN_NOT_FOUND' }
        return $null
    }
    if (-not $usageEventObserved) {
        if ($null -ne $FailureStage) { $FailureStage.Value = 'USAGE_EVENT_NOT_FOUND' }
        return $null
    }
    if ($null -eq $state.LatestTurnUsage -or $null -eq $state.LatestCumulative) {
        if ($null -ne $FailureStage) { $FailureStage.Value = 'USAGE_PARSE_FAILED' }
        return $null
    }
    $boundary = [pscustomobject]@{
        timestamp = [DateTime]::UtcNow.ToString('o')
        type = 'event_msg'
        payload = [pscustomobject]@{ type = 'task_complete'; turn_id = $TurnId }
    }
    $completion = Update-CodexUsageState -State $state -Event $boundary -Pricing $Pricing -SessionFile $TranscriptPath
    if ($null -eq $completion -and $null -ne $FailureStage) { $FailureStage.Value = 'USAGE_PARSE_FAILED' }
    return $completion
}

Export-ModuleMember -Function @(
    'ConvertFrom-CodexTelemetryLine',
    'Copy-CodexUsage',
    'Format-CodexUsageSummary',
    'Format-CodexUsageUiMessage',
    'Get-CodexTurnCompletion',
    'Get-CodexUncachedInput',
    'Get-CodexUsageCost',
    'Get-CodexUsageDelta',
    'Import-CodexPricing',
    'New-CodexUsage',
    'New-CodexUsageParserState',
    'Test-CodexUsageEqual',
    'Update-CodexUsageState'
)
