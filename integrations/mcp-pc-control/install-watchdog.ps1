$ErrorActionPreference = 'Stop'
$project = 'C:\Users\nesti\Desktop\mcp-pc-control-desktop-power\mcp-pc-control'
$watchdog = Join-Path $project 'mcp-watchdog.ps1'
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$command = 'powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $watchdog + '"'
New-Item -Path $runKey -Force | Out-Null
New-ItemProperty -Path $runKey -Name 'Tai3ceaMcpWatchdog' -Value $command -PropertyType String -Force | Out-Null
$process = Start-Process powershell.exe -ArgumentList @('-NoProfile','-WindowStyle','Hidden','-ExecutionPolicy','Bypass','-File',$watchdog) -WindowStyle Hidden -PassThru
Write-Output "RUN_KEY=$command"
Write-Output "WATCHDOG_PID=$($process.Id)"
