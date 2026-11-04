param([string[]]$Components = @('engine'))

function Resolve-Archive {
  param([string]$Component)
  return Join-Path $PSScriptRoot "artifacts/$Component.zip"
}

$staging = Join-Path $env:TEMP 'afyx-synthetic-stage'
$rollback = Join-Path $env:TEMP 'afyx-synthetic-rollback'

foreach ($component in $Components) {
  $archive = Resolve-Archive $component
  & "$PSScriptRoot/scripts/install-afyx-graph.ps1" `
    -ArchivePath $archive `
    -StagingPath $staging `
    -RollbackPath $rollback
}

& "$PSScriptRoot/scripts/verify-install.ps1" -InstallRoot $staging
