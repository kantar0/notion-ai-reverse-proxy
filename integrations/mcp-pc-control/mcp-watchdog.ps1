$ErrorActionPreference = 'Continue'
$project = 'C:\Users\nesti\Desktop\mcp-pc-control-desktop-power\mcp-pc-control'
$logFile = Join-Path $project 'mcp-watchdog.log'
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
$tailscale = Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'
$stableHost = 'desktop-qcbs0te.tail3cea3.ts.net'
$healthUrl = 'http://127.0.0.1:3337/health'
$createdNew = $false
$mutex = New-Object System.Threading.Mutex($true, 'Local\Tai3ceaMcpWatchdogV2', [ref]$createdNew)
if (-not $createdNew) { exit 0 }

function Write-WatchdogLog([string]$message) {
  Add-Content -Path $logFile -Value "$(Get-Date -Format o) $message" -Encoding UTF8
}

function Test-ServerHealth {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 10
    return ([int]$r.StatusCode -eq 200)
  } catch {
    return $false
  }
}

function Start-ServerAndWait {
  if (-not $script:node) { $script:node = (Get-Command node -ErrorAction Stop).Source }
  $process = Start-Process $script:node -ArgumentList 'server.mjs' -WorkingDirectory $project -WindowStyle Hidden -PassThru
  Write-WatchdogLog "server started pid=$($process.Id)"
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-ServerHealth) {
      Write-WatchdogLog "server healthy pid=$($process.Id)"
      return $true
    }
  }
  Write-WatchdogLog "server failed health after start pid=$($process.Id)"
  return $false
}

function Restart-UnhealthyServer {
  $listeners = Get-NetTCPConnection -LocalPort 3337 -State Listen -ErrorAction SilentlyContinue
  foreach ($listener in $listeners) {
    try {
      Stop-Process -Id $listener.OwningProcess -Force -ErrorAction Stop
      Write-WatchdogLog "stopped unhealthy pid=$($listener.OwningProcess)"
    } catch {
      Write-WatchdogLog "failed stopping pid=$($listener.OwningProcess): $($_.Exception.Message)"
    }
  }
  Start-Sleep -Milliseconds 300
  [void](Start-ServerAndWait)
}

Write-WatchdogLog 'live recovery supervisor v2 started'
$failures = 0
$lastFunnelCheck = [datetime]::MinValue
try {
  while ($true) {
    try {
      if (Test-ServerHealth) {
        $failures = 0
      } else {
        $failures++
        Write-WatchdogLog "health failure $failures"
        if ($failures -ge 5) {
          Restart-UnhealthyServer
          $failures = 0
        }
      }

      if ((Get-Date) - $lastFunnelCheck -gt [timespan]::FromSeconds(30)) {
        $lastFunnelCheck = Get-Date
        if (Test-Path $tailscale) {
          $status = (& $tailscale funnel status 2>&1 | Out-String)
          if ($status -notmatch [regex]::Escape($stableHost) -or $status -notmatch '127\.0\.0\.1:3337') {
            & $tailscale up 2>&1 | Out-Null
            & $tailscale funnel --bg 3337 2>&1 | Out-Null
            Write-WatchdogLog 'tailscale funnel restored'
          }
        } else {
          Write-WatchdogLog 'tailscale executable not found'
        }
      }
    } catch {
      Write-WatchdogLog "loop error: $($_.Exception.Message)"
    }
    Start-Sleep -Seconds 2
  }
} finally {
  $mutex.ReleaseMutex() | Out-Null
  $mutex.Dispose()
}
