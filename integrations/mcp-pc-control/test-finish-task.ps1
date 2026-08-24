$ErrorActionPreference = 'Stop'
$config = Get-Content -Raw 'config.json' | ConvertFrom-Json
$headers = @{
  Authorization = "Bearer $($config.bearerToken)"
  'Content-Type' = 'application/json'
  Accept = 'application/json, text/event-stream'
}

$initBody = @{
  jsonrpc = '2.0'
  id = 1
  method = 'initialize'
  params = @{
    protocolVersion = '2025-06-18'
    capabilities = @{}
    clientInfo = @{ name = 'finish-task-test'; version = '1.0.0' }
  }
} | ConvertTo-Json -Depth 10 -Compress

$init = Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:3337/mcp' -Method POST -Headers $headers -Body $initBody
$sessionId = $init.Headers['mcp-session-id']
if (-not $sessionId) { throw 'El servidor no devolvio mcp-session-id' }
$headers['mcp-session-id'] = $sessionId

$initializedBody = @{
  jsonrpc = '2.0'
  method = 'notifications/initialized'
  params = @{}
} | ConvertTo-Json -Depth 5 -Compress
Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:3337/mcp' -Method POST -Headers $headers -Body $initializedBody | Out-Null

$callBody = @{
  jsonrpc = '2.0'
  id = 2
  method = 'tools/call'
  params = @{
    name = 'finish_task'
    arguments = @{
      cwd = 'C:\Users\nesti\Desktop\mcp-pc-control-desktop-power\mcp-pc-control'
      task = 'Agregar memoria automatica y quitar confirmaciones'
      summary = 'Se actualizo el MCP PC Control a la version 0.9.0. Se agrego finish_task para crear o anexar TASK_MEMORY.md al cerrar tareas, se incorporo la politica de leer esa memoria al retomar trabajo y se desactivaron las anotaciones que provocaban el boton Quieres continuar. El servidor fue reiniciado y la configuracion nueva esta activa.'
      status = 'Completado y probado'
      nextSteps = @(
        'Al retomar la subida de la version 0.19.308 al updater, leer primero TASK_MEMORY.md del proyecto correspondiente.'
        'Abrir una conversacion nueva o reconectar el MCP para que Notion refresque visualmente el catalogo y muestre finish_task.'
      )
      filesChanged = @(
        'server.mjs'
        'package.json'
        'upgrade-task-memory-v0.9.0.cjs'
        'server.mjs.backup-2026-08-19T07-22-37-415Z'
      )
      notes = 'La memoria queda por proyecto, en TASK_MEMORY.md, con la entrada mas reciente al final.'
    }
  }
} | ConvertTo-Json -Depth 15 -Compress

$result = Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:3337/mcp' -Method POST -Headers $headers -Body $callBody
Write-Output "SESSION=$sessionId"
Write-Output $result.Content
