param(
  [string]$ArchivePath,
  [string]$StagingPath,
  [string]$RollbackPath
)

Expand-Archive -LiteralPath $ArchivePath -DestinationPath $StagingPath
if (-not (Test-Path "$StagingPath/bin/afyx-graph.js")) {
  Move-Item -LiteralPath $RollbackPath -Destination $StagingPath
  throw 'Synthetic verification failed'
}
