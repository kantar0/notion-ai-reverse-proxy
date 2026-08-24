@echo off
cd /d C:\Users\nesti\Desktop\mcp-pc-control-desktop-power\mcp-pc-control
powershell -NoProfile -WindowStyle Hidden -Command "$p=Get-NetTCPConnection -LocalPort 3337 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique; if($p){ Stop-Process -Id $p -Force -ErrorAction SilentlyContinue }; Start-Sleep -Seconds 2; Set-Location 'C:\Users\nesti\Desktop\mcp-pc-control-desktop-power\mcp-pc-control'; npm start > mcp-restart.log 2>&1"
