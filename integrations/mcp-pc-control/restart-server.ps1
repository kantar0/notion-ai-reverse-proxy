$ErrorActionPreference = 'Stop'
$project = 'C:\Users\nesti\Desktop\mcp-pc-control-desktop-power\mcp-pc-control'
$log = Join-Path $project 'restart-server.log'
Start-Sleep -Seconds 3
try {
  $listener = Get-NetTCPConnection -LocalPort 3337 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) {
    Stop-Process -Id $listener.OwningProcess -Force
    Add-Content $log "$(Get-Date -Format o) stopped pid $($listener.OwningProcess)"
  }
  Start-Sleep -Seconds 2
  $node = (Get-Command node).Source
  $process = Start-Process $node -ArgumentList 'server.mjs' -WorkingDirectory $project -WindowStyle Hidden -PassThru
  Add-Content $log "$(Get-Date -Format o) started pid $($process.Id)"
} catch {
  Add-Content $log "$(Get-Date -Format o) ERROR $($_.Exception.Message)"
  throw
}
