[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$modulePath = Join-Path $root 'CodexUsage.psm1'
$watcherPath = Join-Path $root 'codex-usage-watch.ps1'
$stopHookPath = Join-Path $root 'codex-usage-stop.ps1'
$doctorPath = Join-Path $root 'codex-usage-doctor.ps1'
$pricingPath = Join-Path $root 'codex-usage-pricing.json'
$repositoryRoot = Split-Path -Parent (Split-Path -Parent $root)
$trackerInstallerPath = Join-Path $repositoryRoot 'scripts\install-codex-usage-tracker.ps1'
$mainInstallerPath = Join-Path $repositoryRoot 'install.ps1'
Import-Module $modulePath -Force
$pricing = Import-CodexPricing $pricingPath

function Assert-Equal {
    param([object]$Actual, [object]$Expected, [string]$Message)
    if ($Actual -ne $Expected) { throw "$Message. Expected '$Expected', got '$Actual'." }
}

function New-Event {
    param([string]$Type, [hashtable]$Payload)
    return [pscustomobject]@{ timestamp = [DateTime]::UtcNow.ToString('o'); type = $Type; payload = [pscustomobject]$Payload }
}

function New-UsageObject {
    param(
        [long]$InputTokens,
        [long]$CachedTokens,
        [long]$CacheWriteTokens,
        [long]$OutputTokens,
        [long]$ReasoningTokens
    )
    return [pscustomobject]@{
        input_tokens = $InputTokens
        cached_input_tokens = $CachedTokens
        cache_write_input_tokens = $CacheWriteTokens
        output_tokens = $OutputTokens
        reasoning_output_tokens = $ReasoningTokens
        total_tokens = $InputTokens + $OutputTokens
    }
}

function New-TurnEvents {
    param(
        [string]$TurnId,
        [string]$Model,
        [object]$Usage,
        [object]$TurnUsage,
        [object]$ThreadUsage
    )
    return @(
        New-Event 'event_msg' @{ type = 'task_started'; turn_id = $TurnId }
        New-Event 'turn_context' @{ turn_id = $TurnId; model = $Model }
        New-Event 'token_usage_record' @{
            turn_id = $TurnId
            usage = $Usage
            turn_token_usage = $TurnUsage
            thread_token_usage = $ThreadUsage
        }
        New-Event 'event_msg' @{ type = 'token_count'; info = @{ total_token_usage = $ThreadUsage } }
        New-Event 'event_msg' @{ type = 'task_complete'; turn_id = $TurnId; completed_at = [DateTime]::UtcNow.ToString('o') }
    )
}

function Invoke-Events {
    param([object]$State, [object[]]$Events)
    $result = [System.Collections.Generic.List[object]]::new()
    foreach ($event in $Events) {
        $completion = Update-CodexUsageState -State $State -Event $event -Pricing $pricing -SessionFile 'rollout-test.jsonl'
        if ($null -ne $completion) { $result.Add($completion) }
    }
    return $result.ToArray()
}

function Add-EventsToFile {
    param([string]$Path, [object[]]$Events)
    $lines = $Events | ForEach-Object { $_ | ConvertTo-Json -Compress -Depth 20 }
    [IO.File]::AppendAllText($Path, (($lines -join "`n") + "`n"), [Text.UTF8Encoding]::new($false))
}

function Start-TestWatcher {
    param([string]$SessionRoot, [string]$LatestPath, [int]$CompletionCount)
    $psi = [Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = (Get-Command pwsh).Source
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    foreach ($argument in @(
        '-NoLogo', '-NoProfile', '-File', $watcherPath,
        '-SessionRoot', $SessionRoot,
        '-PricingPath', $pricingPath,
        '-LatestUsagePath', $LatestPath,
        '-PollMilliseconds', '200',
        '-ExitAfterCompletions', [string]$CompletionCount
    )) { [void]$psi.ArgumentList.Add($argument) }
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $psi
    [void]$process.Start()
    return [pscustomobject]@{
        Process = $process
        Output = $process.StandardOutput.ReadToEndAsync()
        Error = $process.StandardError.ReadToEndAsync()
    }
}

function Invoke-TestScript {
    param([string]$Path, [string[]]$Arguments = @(), [string]$StandardInput, [hashtable]$Environment = @{})

    $psi = [Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = (Get-Command pwsh).Source
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.RedirectStandardInput = $true
    foreach ($name in $Environment.Keys) { $psi.Environment[[string]$name] = [string]$Environment[$name] }
    foreach ($argument in @('-NoLogo', '-NoProfile', '-File', $Path) + $Arguments) { [void]$psi.ArgumentList.Add($argument) }
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $psi
    [void]$process.Start()
    if ($null -ne $StandardInput) { $process.StandardInput.Write($StandardInput) }
    $process.StandardInput.Close()
    $output = $process.StandardOutput.ReadToEnd()
    $errorOutput = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    return [pscustomobject]@{ ExitCode = $process.ExitCode; Output = $output; Error = $errorOutput }
}

$usage1 = New-UsageObject 100 60 10 20 5
$thread1 = New-UsageObject 100 60 10 20 5
$usage2 = New-UsageObject 80 20 0 10 2
$thread2 = New-UsageObject 180 80 10 30 7
$turn1 = New-TurnEvents 'turn-1' 'gpt-5.6-sol' $usage1 $usage1 $thread1
$turn2 = New-TurnEvents 'turn-2' 'gpt-5.6-sol' $usage2 $usage2 $thread2

$state = New-CodexUsageParserState
$first = @(Invoke-Events $state $turn1)
$second = @(Invoke-Events $state $turn2)
Assert-Equal $first.Count 1 'First turn completion count'
Assert-Equal $second.Count 1 'Second turn completion count'
Assert-Equal $first[0].InputTokens 100 'First turn input'
Assert-Equal $first[0].CachedInputTokens 60 'First turn cached input'
Assert-Equal $first[0].CacheWriteInputTokens 10 'First turn cache write input'
Assert-Equal $first[0].UncachedInputTokens 30 'First turn uncached input'
Assert-Equal $first[0].OutputTokens 20 'First turn output'
Assert-Equal $first[0].ReasoningTokens 5 'First turn reasoning breakdown'
Assert-Equal $first[0].TotalTokens 120 'Reasoning must not be added to total'
Assert-Equal $first[0].ApiEquivalentCost ([decimal]0.000594) 'First turn API-equivalent cost'
Assert-Equal $second[0].InputTokens 80 'Second turn must be a delta, not cumulative'
Assert-Equal $second[0].TotalTokens 90 'Second turn total'

$restartState = New-CodexUsageParserState
[void](Invoke-Events $restartState $turn1)
$restartSecond = @(Invoke-Events $restartState $turn2)
Assert-Equal $restartSecond.Count 1 'Restart baseline completion count'
Assert-Equal $restartSecond[0].InputTokens 80 'Restart baseline must preserve per-turn delta'

$unknownState = New-CodexUsageParserState
$unknown = @(Invoke-Events $unknownState (New-TurnEvents 'unknown-1' 'unpriced-model' $usage1 $usage1 $thread1))
Assert-Equal $unknown[0].ApiEquivalentAvailable $false 'Unknown model pricing fallback'

$gapState = New-CodexUsageParserState
[void](Invoke-Events $gapState $turn1)
$abortedUsage = New-UsageObject 50 20 0 4 1
$abortedThread = New-UsageObject 150 80 10 24 6
[void](Invoke-Events $gapState @(
    New-Event 'event_msg' @{ type = 'task_started'; turn_id = 'aborted' }
    New-Event 'turn_context' @{ turn_id = 'aborted'; model = 'gpt-5.6-sol' }
    New-Event 'token_usage_record' @{ usage = $abortedUsage; turn_token_usage = $abortedUsage; thread_token_usage = $abortedThread }
))
$successUsage = New-UsageObject 70 30 0 8 2
$successThread = New-UsageObject 220 110 10 32 8
$afterGap = @(Invoke-Events $gapState (New-TurnEvents 'after-gap' 'gpt-5.6-sol' $successUsage $successUsage $successThread))
Assert-Equal $afterGap[0].UsageSource 'turn_token_usage' 'Aborted-turn gap source'
Assert-Equal $afterGap[0].InputTokens 70 'Aborted turn must not leak into next completed turn'

$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) ('codex-usage-tests-' + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($temporaryRoot) | Out-Null
try {
    $sessions = Join-Path $temporaryRoot 'sessions'
    $day1 = Join-Path $sessions '2026\09\24'
    [IO.Directory]::CreateDirectory($day1) | Out-Null
    $rollout1 = Join-Path $day1 'rollout-test-1.jsonl'
    [IO.File]::WriteAllText($rollout1, '', [Text.UTF8Encoding]::new($false))
    $latestPath = Join-Path $temporaryRoot 'latest.json'
    $watcher = Start-TestWatcher $sessions $latestPath 3
    try {
        Start-Sleep -Seconds 1
        if ($watcher.Process.HasExited) { throw "Live watcher exited before input: $($watcher.Error.GetAwaiter().GetResult())" }
        Add-EventsToFile $rollout1 $turn1
        Start-Sleep -Milliseconds 500
        Add-EventsToFile $rollout1 $turn2

        $rollout2 = Join-Path $day1 'rollout-test-2.jsonl'
        [IO.File]::WriteAllText($rollout2, '', [Text.UTF8Encoding]::new($false))
        Start-Sleep -Milliseconds 500
        $session2Usage = New-UsageObject 40 10 0 6 1
        Add-EventsToFile $rollout2 (New-TurnEvents 'session-2-turn-1' 'gpt-5.6-sol' $session2Usage $session2Usage $session2Usage)

        if (-not $watcher.Process.WaitForExit(15000)) {
            $watcher.Process.Kill($true)
            $watcher.Process.WaitForExit()
            throw "Live watcher did not exit after three completions. Output: $($watcher.Output.GetAwaiter().GetResult()) Error: $($watcher.Error.GetAwaiter().GetResult())"
        }
        $output = $watcher.Output.GetAwaiter().GetResult()
        $errors = $watcher.Error.GetAwaiter().GetResult()
        Assert-Equal $watcher.Process.ExitCode 0 "Live watcher exit code; stderr: $errors"
        Assert-Equal ([regex]::Matches($output, 'Codex Turn Usage').Count) 3 'Live watcher summary count'
    } finally {
        if (-not $watcher.Process.HasExited) { $watcher.Process.Kill($true) }
    }

    $restartWatcher = Start-TestWatcher $sessions $latestPath 1
    try {
        Start-Sleep -Seconds 1
        if ($restartWatcher.Process.HasExited) { throw "Restarted watcher exited before input: $($restartWatcher.Error.GetAwaiter().GetResult())" }
        $session2Turn2 = New-UsageObject 55 20 0 7 2
        $session2Total = New-UsageObject 95 30 0 13 3
        Add-EventsToFile $rollout2 (New-TurnEvents 'session-2-turn-2' 'gpt-5.6-sol' $session2Turn2 $session2Turn2 $session2Total)
        if (-not $restartWatcher.Process.WaitForExit(15000)) {
            $restartWatcher.Process.Kill($true)
            $restartWatcher.Process.WaitForExit()
            throw "Restarted watcher did not exit after one new completion. Output: $($restartWatcher.Output.GetAwaiter().GetResult()) Error: $($restartWatcher.Error.GetAwaiter().GetResult())"
        }
        $restartOutput = $restartWatcher.Output.GetAwaiter().GetResult()
        $restartErrors = $restartWatcher.Error.GetAwaiter().GetResult()
        Assert-Equal $restartWatcher.Process.ExitCode 0 "Restarted watcher exit code; stderr: $restartErrors"
        Assert-Equal ([regex]::Matches($restartOutput, 'Codex Turn Usage').Count) 1 'Restarted watcher must not replay history'
        if (-not $restartOutput.Contains('55 tokens')) { throw 'Restarted watcher did not report only the new turn.' }
    } finally {
        if (-not $restartWatcher.Process.HasExited) { $restartWatcher.Process.Kill($true) }
    }
} finally {
    if (Test-Path -LiteralPath $temporaryRoot) { Remove-Item -Recurse -Force -LiteralPath $temporaryRoot }
}

$integrationRoot = Join-Path ([IO.Path]::GetTempPath()) ('codex-usage-integration-' + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($integrationRoot) | Out-Null
try {
    $codexHome = Join-Path $integrationRoot '.codex'
    $sessionIdA = '01a00000-0000-7000-8000-000000000001'
    $sessionIdB = '01a00000-0000-7000-8000-000000000002'
    $integrationSessions = Join-Path $codexHome 'sessions'
    $sessionDirectory = Join-Path $integrationSessions '2026\09\24'
    [IO.Directory]::CreateDirectory($sessionDirectory) | Out-Null
    $transcriptA = Join-Path $sessionDirectory "rollout-test-$sessionIdA.jsonl"
    $transcriptB = Join-Path $sessionDirectory "rollout-test-$sessionIdB.jsonl"
    # Real Codex ordering invokes Stop before task_complete is appended. Include a
    # large unrelated prior line to ensure the hook reads the target turn tail only.
    [IO.File]::WriteAllText($transcriptA, ('{"type":"response_item","ignored":"' + ('x' * 1MB) + '"}' + "`n"), [Text.UTF8Encoding]::new($false))
    $turn2BeforeTaskComplete = @($turn2 | Where-Object {
        -not ($_.type -eq 'event_msg' -and $_.payload.type -eq 'task_complete')
    })
    Add-EventsToFile $transcriptA ($turn1 + $turn2BeforeTaskComplete)
    [IO.File]::AppendAllText($transcriptA, "{`"type`":`"token_usage_record`",broken`n", [Text.UTF8Encoding]::new($false))
    Add-EventsToFile $transcriptB (New-TurnEvents 'session-b-turn' 'unpriced-model' $usage1 $usage1 $thread1)

    $eventA = [ordered]@{
        session_id = $sessionIdA
        transcript_path = $transcriptA
        cwd = $integrationRoot
        hook_event_name = 'Stop'
        turn_id = 'turn-2'
        stop_hook_active = $false
        last_assistant_message = 'SENSITIVE TEST CONTENT MUST NOT APPEAR'
    } | ConvertTo-Json -Compress
    $hookTimer = [Diagnostics.Stopwatch]::StartNew()
    $hookA = Invoke-TestScript $stopHookPath @('-CodexHome', $codexHome, '-PricingPath', $pricingPath, '-RetryCount', '0') $eventA
    $hookTimer.Stop()
    Assert-Equal $hookA.ExitCode 0 "Stop hook exit code; stderr: $($hookA.Error)"
    if ($hookTimer.Elapsed.TotalSeconds -ge 3) { throw "Stop hook exceeded configured timeout: $($hookTimer.Elapsed)" }
    $hookAJson = $hookA.Output | ConvertFrom-Json -ErrorAction Stop
    Assert-Equal $hookAJson.continue $true 'Stop hook must preserve normal completion'
    if ($hookAJson.systemMessage -notmatch 'Codex Usage .* 90 tokens') { throw 'Stop hook did not correlate turn B to its exact usage.' }
    if ($hookAJson.systemMessage -notmatch 'Input 80 .* Output 10 .* Reasoning 2') { throw 'Stop hook compact breakdown is incorrect.' }
    if ($hookA.Output -match 'decision|additionalContext|SENSITIVE TEST CONTENT') { throw 'Stop hook output contains continuation or transcript content.' }

    $debugLog = Join-Path $codexHome 'tools\logs\codex-usage-debug.log'
    if (Test-Path -LiteralPath $debugLog) { throw 'Debug-disabled hook unexpectedly created a debug log.' }
    $debugHook = Invoke-TestScript $stopHookPath @('-CodexHome', $codexHome, '-PricingPath', $pricingPath, '-RetryCount', '0') $eventA @{ AFYX_CODEX_USAGE_DEBUG = '1' }
    Assert-Equal $debugHook.ExitCode 0 "Debug hook exit code; stderr: $($debugHook.Error)"
    Assert-Equal @($debugHook.Output.Trim().Split("`n", [StringSplitOptions]::RemoveEmptyEntries)).Count 1 'Hook stdout must contain exactly one JSON object'
    [void]($debugHook.Output | ConvertFrom-Json -ErrorAction Stop)
    $debugStages = @(Get-Content -LiteralPath $debugLog | ForEach-Object { ($_ | ConvertFrom-Json).stage })
    foreach ($stage in @('HOOK_OBSERVED', 'TRANSCRIPT_RESOLVED', 'TURN_RESOLVED', 'USAGE_EVENT_FOUND', 'MESSAGE_GENERATED', 'MESSAGE_EMITTED')) {
        if ($stage -notin $debugStages) { throw "Debug log missing successful stage: $stage" }
    }
    if ($debugHook.Output -match 'HOOK_OBSERVED|MESSAGE_GENERATED') { throw 'Debug stages leaked into hook stdout.' }

    $missingTurnEvent = [ordered]@{ session_id = $sessionIdA; transcript_path = $transcriptA; hook_event_name = 'Stop' } | ConvertTo-Json -Compress
    [void](Invoke-TestScript $stopHookPath @('-CodexHome', $codexHome, '-PricingPath', $pricingPath, '-RetryCount', '0') $missingTurnEvent @{ AFYX_CODEX_USAGE_DEBUG = '1' })
    $outsideTranscript = Join-Path $integrationRoot 'outside.jsonl'
    [IO.File]::WriteAllText($outsideTranscript, '', [Text.UTF8Encoding]::new($false))
    $outsideEvent = [ordered]@{ session_id = $sessionIdA; transcript_path = $outsideTranscript; hook_event_name = 'Stop'; turn_id = 'turn-2' } | ConvertTo-Json -Compress
    [void](Invoke-TestScript $stopHookPath @('-CodexHome', $codexHome, '-PricingPath', $pricingPath, '-RetryCount', '0') $outsideEvent @{ AFYX_CODEX_USAGE_DEBUG = '1' })
    $missingTranscript = Join-Path $sessionDirectory "rollout-missing-$sessionIdA.jsonl"
    $missingTranscriptEvent = [ordered]@{ session_id = $sessionIdA; transcript_path = $missingTranscript; hook_event_name = 'Stop'; turn_id = 'turn-2' } | ConvertTo-Json -Compress
    [void](Invoke-TestScript $stopHookPath @('-CodexHome', $codexHome, '-PricingPath', $pricingPath, '-RetryCount', '0') $missingTranscriptEvent @{ AFYX_CODEX_USAGE_DEBUG = '1' })
    $missingCorrelationEvent = [ordered]@{ session_id = $sessionIdA; transcript_path = $transcriptA; hook_event_name = 'Stop'; turn_id = 'turn-not-present' } | ConvertTo-Json -Compress
    [void](Invoke-TestScript $stopHookPath @('-CodexHome', $codexHome, '-PricingPath', $pricingPath, '-RetryCount', '0') $missingCorrelationEvent @{ AFYX_CODEX_USAGE_DEBUG = '1' })

    $sessionIdC = '01a00000-0000-7000-8000-000000000003'
    $transcriptC = Join-Path $sessionDirectory "rollout-test-$sessionIdC.jsonl"
    Add-EventsToFile $transcriptC @(
        (New-Event 'event_msg' @{ type = 'task_started'; turn_id = 'no-usage-turn' }),
        (New-Event 'turn_context' @{ turn_id = 'no-usage-turn'; model = 'gpt-5.6-sol' })
    )
    $noUsageEvent = [ordered]@{ session_id = $sessionIdC; transcript_path = $transcriptC; hook_event_name = 'Stop'; turn_id = 'no-usage-turn' } | ConvertTo-Json -Compress
    $noUsage = Invoke-TestScript $stopHookPath @('-CodexHome', $codexHome, '-PricingPath', $pricingPath, '-RetryCount', '0') $noUsageEvent @{ AFYX_CODEX_USAGE_DEBUG = '1' }
    $noUsageJson = $noUsage.Output | ConvertFrom-Json -ErrorAction Stop
    if ($noUsageJson.PSObject.Properties['systemMessage']) { throw 'Missing usage must return a safe response without a message.' }

    $pricingFailure = Invoke-TestScript $stopHookPath @('-CodexHome', $codexHome, '-PricingPath', (Join-Path $integrationRoot 'missing-pricing.json'), '-RetryCount', '0') $eventA @{ AFYX_CODEX_USAGE_DEBUG = '1' }
    [void]($pricingFailure.Output | ConvertFrom-Json -ErrorAction Stop)
    [void](Invoke-TestScript $stopHookPath @('-CodexHome', $codexHome, '-PricingPath', $pricingPath, '-RetryCount', '0') '{invalid' @{ AFYX_CODEX_USAGE_DEBUG = '1' })
    $failureStages = @(Get-Content -LiteralPath $debugLog | ForEach-Object { ($_ | ConvertFrom-Json).stage })
    foreach ($stage in @('TURN_ID_MISSING', 'TRANSCRIPT_REJECTED', 'TRANSCRIPT_NOT_FOUND', 'TURN_NOT_FOUND', 'USAGE_EVENT_NOT_FOUND', 'PRICING_FAILED', 'PAYLOAD_INVALID')) {
        if ($stage -notin $failureStages) { throw "Debug log missing failure stage: $stage" }
    }
    if ((Get-Content -Raw -LiteralPath $debugLog) -match 'SENSITIVE TEST CONTENT') { throw 'Debug log leaked assistant content.' }

    $eventB = [ordered]@{
        session_id = $sessionIdB
        transcript_path = $transcriptB
        hook_event_name = 'Stop'
        turn_id = 'session-b-turn'
        stop_hook_active = $false
        last_assistant_message = 'ignored'
    } | ConvertTo-Json -Compress
    $hookB = Invoke-TestScript $stopHookPath @('-CodexHome', $codexHome, '-PricingPath', $pricingPath, '-RetryCount', '0') $eventB
    $hookBJson = $hookB.Output | ConvertFrom-Json -ErrorAction Stop
    if ($hookBJson.systemMessage -notmatch 'API-equivalent N/A') { throw 'Unknown pricing must remain a successful N/A summary.' }

    $wrongSessionEvent = [ordered]@{
        session_id = $sessionIdB
        transcript_path = $transcriptA
        hook_event_name = 'Stop'
        turn_id = 'turn-2'
    } | ConvertTo-Json -Compress
    $wrongSession = Invoke-TestScript $stopHookPath @('-CodexHome', $codexHome, '-PricingPath', $pricingPath, '-RetryCount', '0') $wrongSessionEvent
    $wrongSessionJson = $wrongSession.Output | ConvertFrom-Json -ErrorAction Stop
    if ($wrongSessionJson.PSObject.Properties['systemMessage']) { throw 'Mismatched session metadata must not display another session usage.' }

    $hooksPath = Join-Path $codexHome 'hooks.json'
    $tasksPath = Join-Path $integrationRoot 'Code\User\tasks.json'
    $existingHooks = [ordered]@{
        description = 'User hooks'
        hooks = [ordered]@{
            PreToolUse = @([ordered]@{ matcher = 'Bash'; hooks = @([ordered]@{ type = 'command'; command = 'custom-pre' }) })
            Stop = @([ordered]@{ hooks = @([ordered]@{ type = 'command'; command = 'custom-stop'; statusMessage = 'Custom stop' }) })
        }
    } | ConvertTo-Json -Depth 20
    [IO.File]::WriteAllText($hooksPath, $existingHooks, [Text.UTF8Encoding]::new($false))

    $installArguments = @('-CodexHome', $codexHome, '-HooksPath', $hooksPath, '-VSCodeUserTasksPath', $tasksPath, '-Confirm:$false')
    $install1 = Invoke-TestScript $trackerInstallerPath $installArguments $null
    Assert-Equal $install1.ExitCode 0 "Tracker installer first run; stderr: $($install1.Error)"
    $install2 = Invoke-TestScript $trackerInstallerPath $installArguments $null
    Assert-Equal $install2.ExitCode 0 "Tracker installer repeat run; stderr: $($install2.Error)"
    $mergedHooks = Get-Content -Raw -LiteralPath $hooksPath | ConvertFrom-Json -Depth 50
    Assert-Equal @($mergedHooks.hooks.PreToolUse).Count 1 'Custom PreToolUse preservation'
    Assert-Equal @($mergedHooks.hooks.Stop | ForEach-Object { $_.hooks } | Where-Object { $_.command -eq 'custom-stop' }).Count 1 'Custom Stop preservation'
    Assert-Equal @($mergedHooks.hooks.Stop | ForEach-Object { $_.hooks } | Where-Object { $_.statusMessage -eq 'Afyx Codex Usage Tracking' }).Count 1 'Repeated install hook idempotency'

    $installedDoctor = Join-Path $codexHome 'tools\codex-usage-doctor.ps1'
    [IO.File]::SetLastWriteTimeUtc($transcriptB, [DateTime]::UtcNow)
    $doctor = Invoke-TestScript $installedDoctor @('-CodexHome', $codexHome, '-HooksPath', $hooksPath, '-SessionRoot', $integrationSessions, '-PricingPath', (Join-Path $codexHome 'tools\codex-usage-pricing.json')) $null
    Assert-Equal $doctor.ExitCode 0 "Usage doctor ready result; stderr: $($doctor.Error)"
    if ($doctor.Output -notmatch 'READY' -or $doctor.Output -notmatch 'Watcher replay.*latest completed turn replayed') { throw 'Doctor did not validate the complete synthetic installation.' }
    $doctorMissingHook = Invoke-TestScript $installedDoctor @('-CodexHome', $codexHome, '-HooksPath', (Join-Path $integrationRoot 'missing-hooks.json'), '-SessionRoot', $integrationSessions, '-PricingPath', (Join-Path $codexHome 'tools\codex-usage-pricing.json')) $null
    if ($doctorMissingHook.ExitCode -eq 0 -or $doctorMissingHook.Output -notmatch '\[FAIL\] Stop hook configured') { throw 'Doctor did not detect a missing hook.' }
    $doctorPs5 = Invoke-TestScript $doctorPath @('-PowerShellMajor', '5') $null
    if ($doctorPs5.ExitCode -eq 0 -or $doctorPs5.Output -notmatch 'requires PowerShell 7\+') { throw 'Doctor did not report the PowerShell 7+ requirement.' }
    $missingRuntimeRoot = Join-Path $integrationRoot 'missing-runtime'
    [IO.Directory]::CreateDirectory($missingRuntimeRoot) | Out-Null
    Copy-Item -LiteralPath $doctorPath -Destination (Join-Path $missingRuntimeRoot 'codex-usage-doctor.ps1')
    $doctorMissingFiles = Invoke-TestScript (Join-Path $missingRuntimeRoot 'codex-usage-doctor.ps1') @('-CodexHome', $codexHome, '-HooksPath', $hooksPath, '-SessionRoot', $integrationSessions) $null
    if ($doctorMissingFiles.ExitCode -eq 0 -or $doctorMissingFiles.Output -notmatch '\[FAIL\] Tracker runtime files') { throw 'Doctor did not detect missing tracker files.' }

    $installedStop = Join-Path $codexHome 'tools\codex-usage-stop.ps1'
    if (-not (Test-Path -LiteralPath $installedStop -PathType Leaf)) { throw 'Stop hook runtime was not installed.' }
    $previousCodexHome = $env:CODEX_HOME
    try {
        $env:CODEX_HOME = $codexHome
        # Hermetic Codex host: the installer refuses to run without a Codex CLI or VS Code extension, and CI runners have neither.
        $fakeCodexBin = Join-Path $integrationRoot 'fake-codex-bin'
        New-Item -ItemType Directory -Path $fakeCodexBin -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $fakeCodexBin 'codex.cmd') -Value '@echo off' -Encoding ascii
        $skip = Invoke-TestScript $mainInstallerPath @('-SkillsRoot', (Join-Path $integrationRoot 'skills'), '-SkipUsageTracker', '-WhatIf', '-Confirm:$false') $null @{ PATH = ($fakeCodexBin + [IO.Path]::PathSeparator + $env:PATH) }
        Assert-Equal $skip.ExitCode 0 "Main installer skip path; stderr: $($skip.Error)"
    if ($skip.Output -notmatch 'Usage Tracking: skipped') { throw 'Main installer did not report optional skip.' }
        if (-not (Test-Path -LiteralPath $installedStop -PathType Leaf)) { throw 'Declining tracker update removed an existing installation.' }
    } finally { $env:CODEX_HOME = $previousCodexHome }

    $uninstall = Invoke-TestScript $trackerInstallerPath ($installArguments + '-Uninstall') $null
    Assert-Equal $uninstall.ExitCode 0 "Tracker uninstall; stderr: $($uninstall.Error)"
    $afterUninstall = Get-Content -Raw -LiteralPath $hooksPath | ConvertFrom-Json -Depth 50
    Assert-Equal @($afterUninstall.hooks.PreToolUse).Count 1 'Uninstall custom PreToolUse preservation'
    Assert-Equal @($afterUninstall.hooks.Stop | ForEach-Object { $_.hooks } | Where-Object { $_.command -eq 'custom-stop' }).Count 1 'Uninstall custom Stop preservation'
    Assert-Equal @($afterUninstall.hooks.Stop | ForEach-Object { $_.hooks } | Where-Object { $_.statusMessage -eq 'Afyx Codex Usage Tracking' }).Count 0 'Afyx hook removal'
} finally {
    if (Test-Path -LiteralPath $integrationRoot) { Remove-Item -Recurse -Force -LiteralPath $integrationRoot }
}

Write-Host 'Codex usage tracker tests: PASS'
