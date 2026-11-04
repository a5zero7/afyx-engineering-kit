[CmdletBinding()]
param(
    [string]$CodexHome = $(if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE '.codex' }),
    [string]$PricingPath = (Join-Path $PSScriptRoot 'codex-usage-pricing.json'),
    [string]$DebugLogPath,
    [ValidateRange(0, 10)] [int]$RetryCount = 3,
    [ValidateRange(0, 1000)] [int]$RetryMilliseconds = 150
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

$debugEnabled = [string]$env:AFYX_CODEX_USAGE_DEBUG -match '^(?i:1|true|yes|on)$'
if (-not $DebugLogPath) { $DebugLogPath = Join-Path $CodexHome 'tools\logs\codex-usage-debug.log' }
$debugContext = [ordered]@{ hook_event = $null; session_id = $null; turn_id = $null }
$lastStage = 'HOOK_NOT_OBSERVED'

function Write-DebugStage {
    param(
        [Parameter(Mandatory)] [string]$Stage,
        [string]$ErrorType,
        [string]$Message
    )

    $script:lastStage = $Stage
    if (-not $script:debugEnabled) { return }
    try {
        $parent = Split-Path -Parent $script:DebugLogPath
        if ($parent) { [IO.Directory]::CreateDirectory($parent) | Out-Null }
        if ((Test-Path -LiteralPath $script:DebugLogPath -PathType Leaf) -and
            (Get-Item -LiteralPath $script:DebugLogPath).Length -ge 1MB) {
            $rotated = "$script:DebugLogPath.1"
            if (Test-Path -LiteralPath $rotated -PathType Leaf) { Remove-Item -LiteralPath $rotated -Force }
            Move-Item -LiteralPath $script:DebugLogPath -Destination $rotated
        }
        $record = [ordered]@{
            timestamp = [DateTime]::UtcNow.ToString('o')
            stage = $Stage
            hook_event = $script:debugContext.hook_event
            session_id = $script:debugContext.session_id
            turn_id = $script:debugContext.turn_id
            error_type = $ErrorType
            message = $Message
        }
        $line = ($record | ConvertTo-Json -Compress -Depth 5) + "`n"
        [IO.File]::AppendAllText($script:DebugLogPath, $line, [Text.UTF8Encoding]::new($false))
    } catch {
        # Diagnostics are best-effort and must never affect the hook protocol.
    }
}

function Write-HookResult {
    param([string]$SystemMessage)

    $result = [ordered]@{ continue = $true }
    if ($SystemMessage) { $result.systemMessage = $SystemMessage }
    [Console]::Out.WriteLine(($result | ConvertTo-Json -Compress -Depth 5))
    [Console]::Out.Flush()
    if ($SystemMessage) { Write-DebugStage -Stage 'MESSAGE_EMITTED' }
    else { Write-DebugStage -Stage 'SAFE_RESPONSE_EMITTED' -Message $script:lastStage }
}

try {
    Write-DebugStage -Stage 'HOOK_OBSERVED'
    # last_assistant_message is intentionally never accessed, copied, logged, or hashed.
    $rawEvent = [Console]::In.ReadToEnd()
    if ([string]::IsNullOrWhiteSpace($rawEvent)) {
        Write-DebugStage -Stage 'PAYLOAD_INVALID' -Message 'empty hook payload'
        Write-HookResult
        exit 0
    }
    try { $hookEvent = $rawEvent | ConvertFrom-Json -Depth 20 -ErrorAction Stop }
    catch {
        Write-DebugStage -Stage 'PAYLOAD_INVALID' -ErrorType $_.Exception.GetType().FullName -Message 'hook payload is not valid JSON'
        Write-HookResult
        exit 0
    }

    $debugContext.hook_event = if ($hookEvent.PSObject.Properties['hook_event_name']) { [string]$hookEvent.hook_event_name } else { $null }
    if ($debugContext.hook_event -ne 'Stop') {
        Write-DebugStage -Stage 'PAYLOAD_INVALID' -Message 'hook_event_name is not Stop'
        Write-HookResult
        exit 0
    }

    $turnId = if ($hookEvent.PSObject.Properties['turn_id']) { [string]$hookEvent.turn_id } else { $null }
    $sessionId = if ($hookEvent.PSObject.Properties['session_id']) { [string]$hookEvent.session_id } else { $null }
    $transcriptPath = if ($hookEvent.PSObject.Properties['transcript_path']) { [string]$hookEvent.transcript_path } else { $null }
    $debugContext.session_id = $sessionId
    $debugContext.turn_id = $turnId
    if (-not $turnId) {
        Write-DebugStage -Stage 'TURN_ID_MISSING' -Message 'turn_id is absent'
        Write-HookResult
        exit 0
    }
    if (-not $transcriptPath) {
        Write-DebugStage -Stage 'TRANSCRIPT_NOT_FOUND' -Message 'transcript_path is absent'
        Write-HookResult
        exit 0
    }

    try {
        $sessionRoot = [IO.Path]::GetFullPath((Join-Path $CodexHome 'sessions'))
        $resolvedTranscript = [IO.Path]::GetFullPath($transcriptPath)
    } catch {
        Write-DebugStage -Stage 'TRANSCRIPT_REJECTED' -ErrorType $_.Exception.GetType().FullName -Message 'transcript path is invalid'
        Write-HookResult
        exit 0
    }
    $rootPrefix = $sessionRoot.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if (-not $resolvedTranscript.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase) -or
        (-not $sessionId) -or (Split-Path -Leaf $resolvedTranscript) -notmatch [regex]::Escape($sessionId)) {
        Write-DebugStage -Stage 'TRANSCRIPT_REJECTED' -Message 'transcript/session correlation rejected'
        Write-HookResult
        exit 0
    }
    if (-not (Test-Path -LiteralPath $resolvedTranscript -PathType Leaf)) {
        Write-DebugStage -Stage 'TRANSCRIPT_NOT_FOUND' -Message 'correlated transcript does not exist'
        Write-HookResult
        exit 0
    }
    Write-DebugStage -Stage 'TRANSCRIPT_RESOLVED'

    try { Import-Module (Join-Path $PSScriptRoot 'CodexUsage.psm1') -Force -ErrorAction Stop | Out-Null }
    catch {
        Write-DebugStage -Stage 'USAGE_PARSE_FAILED' -ErrorType $_.Exception.GetType().FullName -Message 'usage module import failed'
        Write-HookResult
        exit 0
    }
    try { $pricing = Import-CodexPricing -Path $PricingPath }
    catch {
        Write-DebugStage -Stage 'PRICING_FAILED' -ErrorType $_.Exception.GetType().FullName -Message 'pricing configuration could not be loaded'
        Write-HookResult
        exit 0
    }

    $completion = $null
    $failureStage = $null
    for ($attempt = 0; $attempt -le $RetryCount; $attempt++) {
        $failureStage = $null
        $failureStageReference = [ref]$failureStage
        $completion = Get-CodexTurnCompletion -TranscriptPath $resolvedTranscript -TurnId $turnId -Pricing $pricing -FailureStage $failureStageReference
        if ($null -ne $completion) { break }
        if ($attempt -lt $RetryCount -and $RetryMilliseconds -gt 0) { Start-Sleep -Milliseconds $RetryMilliseconds }
    }
    if ($null -eq $completion) {
        if ($failureStage -notin @('TURN_NOT_FOUND', 'USAGE_EVENT_NOT_FOUND', 'USAGE_PARSE_FAILED')) { $failureStage = 'USAGE_PARSE_FAILED' }
        Write-DebugStage -Stage $failureStage -Message 'no safe completion could be produced'
        Write-HookResult
        exit 0
    }

    Write-DebugStage -Stage 'TURN_RESOLVED'
    Write-DebugStage -Stage 'USAGE_EVENT_FOUND'
    $message = Format-CodexUsageUiMessage -Completion $completion
    if ([string]::IsNullOrWhiteSpace($message)) {
        Write-DebugStage -Stage 'USAGE_PARSE_FAILED' -Message 'usage message formatter returned empty output'
        Write-HookResult
        exit 0
    }
    Write-DebugStage -Stage 'MESSAGE_GENERATED'
    Write-HookResult -SystemMessage $message
} catch {
    Write-DebugStage -Stage 'USAGE_PARSE_FAILED' -ErrorType $_.Exception.GetType().FullName -Message 'unexpected tracker failure'
    Write-HookResult
}
