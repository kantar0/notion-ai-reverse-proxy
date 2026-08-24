$ErrorActionPreference = 'Continue'
$log = Join-Path $PSScriptRoot 'live-recovery-test.log'
Set-Content $log "$(Get-Date -Format o) TEST_START"
Start-Sleep -Seconds 2
$listener = Get-NetTCPConnection -LocalPort 3337 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $listener) {
  Add-Content $log "$(Get-Date -Format o) NO_LISTENER"
  exit 1
}
$oldPid = $listener.OwningProcess
Add-Content $log "$(Get-Date -Format o) STOPPING pid=$oldPid"
Stop-Process -Id $oldPid -Force -ErrorAction Stop
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 500
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3337/health' -TimeoutSec 1
    if ([int]$r.StatusCode -eq 200) {
      $newPid = (Get-NetTCPConnection -LocalPort 3337 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess
      Add-Content $log "$(Get-Date -Format o) RECOVERED oldPid=$oldPid newPid=$newPid elapsedMs=$((($i + 1) * 500))"
      exit 0
    }
  } catch {}
}
Add-Content $log "$(Get-Date -Format o) FAILED oldPid=$oldPid"
exit 1
