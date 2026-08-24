# auto-reinstall.ps1
# Reinicia e instala el MCP PC Control cada hora (via Task Scheduler)
# Log: auto-reinstall.log en el mismo directorio

$dir     = 'C:\Users\nesti\Desktop\mcp-pc-control-desktop-power\mcp-pc-control'
$logFile = "$dir\auto-reinstall.log"
$maxLog  = 500   # lineas maximas en el log (rota para no crecer infinito)

function Log($msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
    Add-Content -Path $logFile -Value $line
    Write-Host $line
}

# Rotar log si supera el limite
if (Test-Path $logFile) {
    $lines = Get-Content $logFile
    if ($lines.Count -gt $maxLog) {
        $lines | Select-Object -Last 300 | Set-Content $logFile
    }
}

Log '=== AUTO-REINSTALL INICIO ==='

# 1. Cerrar proceso MCP existente en puerto 3337
Log 'Cerrando proceso en puerto 3337...'
try {
    $pids = Get-NetTCPConnection -LocalPort 3337 -State Listen -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($p in $pids) {
        Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
        Log "  Proceso $p terminado."
    }
    if (-not $pids) { Log '  No habia proceso activo en 3337.' }
} catch { Log "  Error cerrando: $_" }
Start-Sleep -Seconds 2

# 2. npm install (actualiza dependencias si cambiaron)
Log 'Ejecutando npm install...'
try {
    Set-Location $dir
    $result = & npm install 2>&1 | Out-String
    $resumen = ($result -split "`n" | Where-Object { $_ -match 'added|updated|up to date|warn|error' }) -join ' | '
    Log "  npm: $resumen"
} catch { Log "  Error npm install: $_" }

# 3. Iniciar MCP server en nueva ventana
Log 'Iniciando MCP server (nueva ventana CMD)...'
try {
    Start-Process cmd -ArgumentList '/k npm start' -WorkingDirectory $dir -WindowStyle Normal
} catch { Log "  Error al iniciar server: $_" }

# 4. Esperar que el puerto 3337 quede listo (max 45 seg)
Log 'Esperando puerto 3337...'
$ok = $false
for ($i = 0; $i -lt 45; $i++) {
    if (Get-NetTCPConnection -LocalPort 3337 -State Listen -ErrorAction SilentlyContinue) {
        $ok = $true; break
    }
    Start-Sleep -Seconds 1
}
if ($ok) { Log 'Puerto 3337 ACTIVO.' }
else      { Log 'ADVERTENCIA: puerto 3337 no respondio en 45s.' }

# 5. Tailscale Funnel
Log 'Activando Tailscale Funnel...'
try {
    $ts = "$env:ProgramFiles\Tailscale\tailscale.exe"
    if (Test-Path $ts) {
        & $ts up          2>&1 | Out-Null
        & $ts funnel --bg 3337 2>&1 | Out-Null
        Log 'Tailscale Funnel activo: https://desktop-qcbs0te.tail3cea3.ts.net/mcp'
    } else {
        Log "Tailscale no encontrado en: $ts"
    }
} catch { Log "Error Tailscale: $_" }

Log '=== AUTO-REINSTALL FIN ==='
