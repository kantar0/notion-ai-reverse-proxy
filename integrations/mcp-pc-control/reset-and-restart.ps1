# Script: reset-and-restart.ps1
# Reinicia adaptador de red + cierra MCP + npm install + inicia MCP + Tailscale

$logFile = "C:\Users\nesti\Desktop\mcp-pc-control-desktop-power\mcp-pc-control\reset-restart.log"
function Log($msg) { "$(Get-Date -Format 'HH:mm:ss') $msg" | Tee-Object -FilePath $logFile -Append | Out-Null }

Log "=== INICIO reset-and-restart ==="

# 1. Reiniciar adaptador de red (simular restart router)
Log "Reiniciando adaptador de red..."
try {
    $adapter = Get-NetAdapter | Where-Object { $_.Status -eq 'Up' -and $_.InterfaceDescription -notmatch 'Loopback|Tailscale|VPN|Virtual' } | Select-Object -First 1
    if ($adapter) {
        Log "Adaptador: $($adapter.Name)"
        Disable-NetAdapter -Name $adapter.Name -Confirm:$false
        Start-Sleep -Seconds 4
        Enable-NetAdapter -Name $adapter.Name -Confirm:$false
        Log "Adaptador reiniciado. Esperando reconexion..."
        Start-Sleep -Seconds 8
    } else {
        Log "No se encontro adaptador activo, saltando reset de red."
    }
} catch {
    Log "Error al reiniciar adaptador: $_"
}

# 2. Cerrar proceso MCP existente en puerto 3337
Log "Cerrando servidor MCP en puerto 3337..."
try {
    $pids = Get-NetTCPConnection -LocalPort 3337 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($p in $pids) {
        Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
        Log "Proceso $p terminado."
    }
} catch {
    Log "Error cerrando MCP: $_"
}
Start-Sleep -Seconds 2

# 3. npm install
Log "Ejecutando npm install..."
$dir = 'C:\Users\nesti\Desktop\mcp-pc-control-desktop-power\mcp-pc-control'
Set-Location $dir
$npmResult = & npm install 2>&1
Log "npm install: $($npmResult | Select-Object -Last 3 | Out-String)"

# 4. Iniciar servidor MCP en nueva ventana
Log "Iniciando MCP server..."
Start-Process cmd -ArgumentList '/k npm start' -WorkingDirectory $dir -WindowStyle Normal
Start-Sleep -Seconds 5

# 5. Esperar que el puerto 3337 este listo
Log "Esperando puerto 3337..."
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
    if (Get-NetTCPConnection -LocalPort 3337 -State Listen -ErrorAction SilentlyContinue) {
        $ready = $true; break
    }
    Start-Sleep -Seconds 1
}

if ($ready) {
    Log "Puerto 3337 listo!"
} else {
    Log "ADVERTENCIA: Puerto 3337 no respondio en 30s"
}

# 6. Tailscale Funnel
Log "Activando Tailscale Funnel..."
$ts = "$env:ProgramFiles\Tailscale\tailscale.exe"
if (Test-Path $ts) {
    & $ts up 2>&1 | Out-Null
    & $ts funnel --bg 3337 2>&1 | Out-Null
    Log "Tailscale Funnel activo: https://desktop-qcbs0te.tail3cea3.ts.net/mcp"
} else {
    Log "Tailscale no encontrado en $ts"
}

Log "=== FIN reset-and-restart. Conexion deberia estar disponible. ==="
