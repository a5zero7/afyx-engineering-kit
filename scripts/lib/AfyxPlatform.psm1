# AfyxPlatform.psm1 — Shared Windows and cross-platform architecture detection module
# Compatible with Windows PowerShell 5.1, PowerShell 7+, and Set-StrictMode -Version Latest.

. (Join-Path $PSScriptRoot 'AfyxPlatform.ps1')

Export-ModuleMember -Function Get-AfyxOperatingSystemArchitecture, Get-AfyxPlatformDescription, Get-AfyxGraphTarget
