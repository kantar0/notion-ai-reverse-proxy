$project = 'C:\Users\nesti\Desktop\mcp-pc-control-desktop-power\mcp-pc-control'
$log = Join-Path $project 'watchdog-recovery-test.log'
Start-Sleep -Seconds 3
$listener = Get-NetTCPConnection -LocalPort 3337 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
  Add-Content $log "$(Get-Date -Format o) stopping pid $($listener.OwningProcess)"
  Stop-Process -Id $listener.OwningProcess -Force
} else {
  Add-Content $log "$(Get-Date -Format o) no listener found"
}
