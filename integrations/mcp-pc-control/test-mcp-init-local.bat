@echo off
setlocal EnableExtensions
cd /d %~dp0

for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "(Get-Content 'config.json' -Raw | ConvertFrom-Json).bearerToken"`) do set TOKEN=%%i

echo === MCP initialize local (Accept: json + event-stream) ===
powershell -NoProfile -ExecutionPolicy Bypass -Command "$h=@{Authorization='Bearer %TOKEN%';'Content-Type'='application/json';Accept='application/json, text/event-stream'}; $b='{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2025-06-18\",\"capabilities\":{},\"clientInfo\":{\"name\":\"diag\",\"version\":\"1.0\"}}}'; try { $r=Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:3337/mcp' -Method POST -Headers $h -Body $b; Write-Host ('Status: ' + [int]$r.StatusCode); Write-Host 'Session:' $r.Headers['mcp-session-id']; Write-Host $r.Content } catch { if ($_.Exception.Response) { Write-Host ('Status: ' + [int]$_.Exception.Response.StatusCode.value__) ; $sr = New-Object IO.StreamReader($_.Exception.Response.GetResponseStream()); $sr.ReadToEnd() } else { $_.Exception.Message } }"
echo.
pause
endlocal
