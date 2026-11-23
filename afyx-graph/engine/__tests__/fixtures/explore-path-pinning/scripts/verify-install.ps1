param([string]$InstallRoot)

if (-not (Test-Path "$InstallRoot/bin/afyx-graph.js")) {
  throw 'Synthetic install is incomplete'
}
