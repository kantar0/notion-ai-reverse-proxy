@echo off
setlocal EnableExtensions
cd /d %~dp0

for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "(Get-Content 'config.json' -Raw | ConvertFrom-Json).bearerToken"`) do set TOKEN=%%i
set /p TUNNELURL=URL publica Tailscale [Enter = https://desktop-qcbs0te.tail3cea3.ts.net]: 
if not defined TUNNELURL set "TUNNELURL=https://desktop-qcbs0te.tail3cea3.ts.net"

echo === MCP initialize via tunnel (retry/backoff 429/5xx + Retry-After) ===
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop';
$h=@{Authorization='Bearer %TOKEN%';'Content-Type'='application/json'};
$b='{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2025-06-18\",\"capabilities\":{},\"clientInfo\":{\"name\":\"diag\",\"version\":\"1.0\"}}}';
function Invoke-PostWithRetry([string]$Url,[hashtable]$Headers,[string]$Body){
  $max=8; $base=0.6;
  for($i=0;$i -lt $max;$i++){
    try{
      $r=Invoke-WebRequest -UseBasicParsing $Url -Method POST -Headers $Headers -Body $Body;
      return $r;
    } catch {
      if($_.Exception.Response){
        $code=[int]$_.Exception.Response.StatusCode.value__;
        $ra=$_.Exception.Response.Headers['Retry-After'];
        if($code -eq 429 -or $code -ge 500){
          $delay = if($ra){ [double]$ra } else { [Math]::Min(60, $base * [Math]::Pow(2,$i) + (Get-Random -Minimum 0 -Maximum 0.4)) };
          Write-Host ('Retry code ' + $code + ' in ' + $delay + 's');
          Start-Sleep -Seconds $delay;
          continue;
        }
      }
      throw;
    }
  }
  throw 'Max retries reached'
}
$r=Invoke-PostWithRetry ('%TUNNELURL%/mcp') $h $b; Write-Host ('Status: ' + [int]$r.StatusCode); Write-Host 'Session:' $r.Headers['mcp-session-id']; Write-Host $r.Content" 

echo.
pause
endlocal
