Set-StrictMode -Version Latest
function Write-AfyxInstallerProgress {
    param([string]$OperationId, [string]$ComponentId = '', [string]$Phase, [string]$State, [string]$Message)
    if ($env:AFYX_INSTALL_PROGRESS -ne '1') { return }
    $event = [ordered]@{ contract = 'AfyxInstallerProgress/v1'; operationId = $OperationId
        componentId = $(if ($ComponentId) { $ComponentId } else { $null }); phase = $Phase; state = $State
        completed = $(if ($State -eq 'completed') { 1 } else { $null }); total = $(if ($State -eq 'completed') { 1 } else { $null }); message = $Message
        timestamp = [DateTime]::UtcNow.ToString('o'); errorCode = $(if ($State -eq 'failed') { 'BACKEND_OPERATION_FAILED' } else { $null }) }
    [Console]::Out.WriteLine('AFYX_PROGRESS ' + (ConvertTo-Json -InputObject $event -Depth 3 -Compress))
}
Export-ModuleMember -Function Write-AfyxInstallerProgress
