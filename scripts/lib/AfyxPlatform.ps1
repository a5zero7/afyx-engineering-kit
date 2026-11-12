# AfyxPlatform.ps1 — Shared Windows and cross-platform architecture detection helper
# Compatible with Windows PowerShell 5.1, PowerShell 7+, and Set-StrictMode -Version Latest.

Set-StrictMode -Version Latest

function Get-AfyxOperatingSystemArchitecture {
    <#
    .SYNOPSIS
        Detects the physical/host Windows OS architecture safely without failing on missing .NET APIs.
    .OUTPUTS
        [string] 'x64', 'arm64', 'x86', or 'unknown'
    #>
    [CmdletBinding()]
    param()

    # 1. Safely inspect RuntimeInformation via reflection to avoid PropertyNotFoundStrict in PS 5.1
    try {
        $rtType = [Type]::GetType('System.Runtime.InteropServices.RuntimeInformation, System.Runtime.InteropServices.RuntimeInformation', $false)
        if (-not $rtType) {
            $rtType = [Type]::GetType('System.Runtime.InteropServices.RuntimeInformation', $false)
        }
        if ($rtType) {
            $prop = $rtType.GetProperty('OSArchitecture')
            if ($prop) {
                $val = $prop.GetValue($null, $null)
                if ($val) {
                    $strVal = $val.ToString().ToUpperInvariant()
                    switch ($strVal) {
                        'X64'   { return 'x64' }
                        'ARM64' { return 'arm64' }
                        'X86'   { return 'x86' }
                        'ARM'   { return 'arm' }
                    }
                }
            }
        }
    } catch {
        # Fall through to environment inspection
    }

    # 2. Check PROCESSOR_ARCHITEW6432 (set when a 32-bit process runs on 64-bit OS) then PROCESSOR_ARCHITECTURE
    $archCandidate = $env:PROCESSOR_ARCHITEW6432
    if (-not $archCandidate) {
        $archCandidate = $env:PROCESSOR_ARCHITECTURE
    }
    if ($archCandidate) {
        $norm = $archCandidate.Trim().ToUpperInvariant()
        switch ($norm) {
            'AMD64' { return 'x64' }
            'ARM64' { return 'arm64' }
            'X86'   {
                try {
                    if ([System.Environment]::Is64BitOperatingSystem) { return 'x64' }
                } catch { }
                return 'x86'
            }
        }
    }

    # 3. Fallback via CIM / WMI
    try {
        $cs = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
        if ($cs -and $cs.OSArchitecture) {
            $desc = $cs.OSArchitecture.ToString()
            if ($desc -match 'ARM') { return 'arm64' }
            if ($desc -match '64')  { return 'x64' }
            if ($desc -match '32')  { return 'x86' }
        }
    } catch { }

    try {
        if ([System.Environment]::Is64BitOperatingSystem) { return 'x64' }
    } catch { }

    return 'unknown'
}

function Get-AfyxPlatformDescription {
    <#
    .SYNOPSIS
        Returns a formatted OS and architecture description string (e.g. 'Microsoft Windows 11 / X64').
    #>
    [CmdletBinding()]
    param()

    $osDesc = $null
    try {
        $rtType = [Type]::GetType('System.Runtime.InteropServices.RuntimeInformation, System.Runtime.InteropServices.RuntimeInformation', $false)
        if (-not $rtType) {
            $rtType = [Type]::GetType('System.Runtime.InteropServices.RuntimeInformation', $false)
        }
        if ($rtType) {
            $prop = $rtType.GetProperty('OSDescription')
            if ($prop) {
                $val = $prop.GetValue($null, $null)
                if ($val) { $osDesc = [string]$val }
            }
        }
    } catch { }

    if (-not $osDesc) {
        try {
            $cs = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
            if ($cs -and $cs.Caption) {
                $osDesc = "$($cs.Caption) $($cs.Version)"
            }
        } catch { }
    }

    if (-not $osDesc) {
        $osDesc = [System.Environment]::OSVersion.VersionString
    }

    $arch = (Get-AfyxOperatingSystemArchitecture).ToUpperInvariant()
    return "$osDesc / $arch"
}

function Get-AfyxGraphTarget {
    <#
    .SYNOPSIS
        Maps the detected OS architecture to the canonical Afyx Graph target string.
    #>
    [CmdletBinding()]
    param()

    $arch = Get-AfyxOperatingSystemArchitecture
    switch ($arch) {
        'x64'   { return 'win32-x64' }
        'arm64' { return 'win32-arm64' }
        'x86'   { return 'win32-x86' }
        default { return "win32-$arch" }
    }
}
