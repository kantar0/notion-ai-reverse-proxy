$ErrorActionPreference = 'Stop'
$project = 'C:\Users\nesti\Desktop\mcp-pc-control-desktop-power\mcp-pc-control'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

Copy-Item (Join-Path $project 'server.mjs') (Join-Path $project "server.mjs.backup-intermitencias-$stamp.bak") -Force
Copy-Item (Join-Path $project 'mcp-watchdog.ps1') (Join-Path $project "mcp-watchdog.ps1.backup-intermitencias-$stamp.bak") -Force
Write-Output ('backups creados con stamp ' + $stamp)

$serverPath = Join-Path $project 'server.mjs'
$server = Get-Content -LiteralPath $serverPath -Raw
$oldTtl = 'const SESSION_IDLE_TTL_MS = 30 * 60 * 1000;'
$newTtl = 'const SESSION_IDLE_TTL_MS = 24 * 60 * 60 * 1000; // 24h: Notion no re-inicializa tras un 404; la sesion debe sobrevivir gaps largos'
$oldMax = 'const MAX_SESSIONS = 64;'
$newMax = 'const MAX_SESSIONS = 512;'
if (-not $server.Contains($oldTtl)) { throw 'patron TTL no encontrado en server.mjs' }
if (-not $server.Contains($oldMax)) { throw 'patron MAX_SESSIONS no encontrado en server.mjs' }
$server = $server.Replace($oldTtl, $newTtl).Replace($oldMax, $newMax)
Set-Content -LiteralPath $serverPath -Value $server -NoNewline -Encoding UTF8
Write-Output 'server.mjs actualizado (TTL 24h, 512 sesiones)'

$wdPath = Join-Path $project 'mcp-watchdog.ps1'
$wd = Get-Content -LiteralPath $wdPath -Raw
$oldTimeout = '-TimeoutSec 2'
$newTimeout = '-TimeoutSec 10'
$oldFail = 'if ($failures -ge 2) {'
$newFail = 'if ($failures -ge 5) {'
if (-not $wd.Contains($oldTimeout)) { throw 'patron TimeoutSec no encontrado en mcp-watchdog.ps1' }
if (-not $wd.Contains($oldFail)) { throw 'patron failures no encontrado en mcp-watchdog.ps1' }
$wd = $wd.Replace($oldTimeout, $newTimeout).Replace($oldFail, $newFail)
Set-Content -LiteralPath $wdPath -Value $wd -NoNewline -Encoding UTF8
Write-Output 'mcp-watchdog.ps1 actualizado (timeout 10s, 5 fallos antes de reiniciar)'
