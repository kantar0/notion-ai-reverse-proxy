# Motor invisible del CLI: NO abre la aplicacion visible de Notion.
$ErrorActionPreference = 'Stop'
$Port = 9223
$BridgeDir = "$env:USERPROFILE\notion-ai-cli"
$ProfileDir = "$BridgeDir\headless-browser-profile"
$PidFile = "$BridgeDir\headless-cdp.pid"
$GuardPidFile = "$BridgeDir\notion-desktop-guard.pid"
$GuardScript = "$BridgeDir\notion-desktop-guard.ps1"
$Browsers = @(
  'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
  'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
  'C:\Program Files\Google\Chrome\Application\chrome.exe',
  'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe'
)
function Test-Cdp {
  try { return (Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$Port/json/version" -TimeoutSec 2).StatusCode -eq 200 } catch { return $false }
}
function Test-Pid([int]$ProcessId) {
  if (-not $ProcessId) { return $false }
  return $null -ne (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}
function Ensure-DesktopGuard {
  $guardPid = 0
  try { if (Test-Path $GuardPidFile) { $guardPid = [int](Get-Content $GuardPidFile -Raw) } } catch { $guardPid = 0 }
  if ($guardPid -and (Test-Pid $guardPid)) { return }
  Remove-Item $GuardPidFile -Force -ErrorAction SilentlyContinue
  Start-Process powershell.exe -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$GuardScript) -WorkingDirectory $BridgeDir -WindowStyle Hidden | Out-Null
  for($i=0;$i -lt 30;$i++){
    Start-Sleep -Milliseconds 100
    try { if((Test-Path $GuardPidFile) -and (Test-Pid ([int](Get-Content $GuardPidFile -Raw)))) { return } } catch {}
  }
  throw 'No se pudo iniciar el guard de Notion Desktop.'
}
Ensure-DesktopGuard
if (Test-Cdp) { Write-Host '[browser-worker] Motor CDP ya activo; guard de Desktop activo.' -ForegroundColor Green; exit 0 }
$Browser = $Browsers | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $Browser) { throw 'No se encontro Edge o Chrome para el motor invisible.' }
if (-not (Test-Path "$BridgeDir\headless-session.json")) { throw 'Falta headless-session.json. Abre Notion una vez y ejecuta capture-headless-session.mjs.' }
New-Item -ItemType Directory -Force -Path $ProfileDir | Out-Null
$args = @(
  '--window-position=-32000,-32000',
  # 1x1 dejaba TODA la interfaz fuera del viewport: los clics reales fallaban y
  # Notion ni siquiera montaba partes del chat. La ventana sigue oculta (posicion
  # fuera de pantalla), pero con tamano usable.
  '--window-size=1440,900',
  '--start-minimized',
  '--disable-gpu',
  '--disable-software-rasterizer',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-features=Translate,MediaRouter',
  # El motor llego a 4,4 GB con una sola pestana: Notion deja service workers y
  # caches por espacio visitado, y Edge no libera hasta reiniciar. Estos limites
  # recortan el gasto sin tocar lo que el CLI necesita (una pestana con chat).
  '--renderer-process-limit=3',
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-sync',
  '--disable-dev-shm-usage',
  '--js-flags=--max-old-space-size=512',
  '--disk-cache-size=52428800',
  '--media-cache-size=10485760',
  "--remote-debugging-port=$Port",
  '--remote-debugging-address=127.0.0.1',
  '--remote-allow-origins=*',
  "--user-data-dir=$ProfileDir",
  'about:blank'
)
$p = Start-Process -FilePath $Browser -ArgumentList $args -WindowStyle Hidden -PassThru
$p.Id | Set-Content -Path $PidFile -Encoding ascii
for ($i=0; $i -lt 80; $i++) { Start-Sleep -Milliseconds 250; if (Test-Cdp) { break } }
if (-not (Test-Cdp)) { throw 'El motor invisible no abrio el puerto CDP.' }
Push-Location $BridgeDir
try { & node "$BridgeDir\bootstrap-headless-session.mjs"; if ($LASTEXITCODE -ne 0) { throw 'No se pudo cargar la sesion invisible.' } }
finally { Pop-Location }
Write-Host "[browser-worker] Motor invisible listo (PID inicial $($p.Id)); guard Desktop activo." -ForegroundColor Green
exit 0
