$ErrorActionPreference = 'Stop'
$project = 'C:\Users\nesti\Desktop\mcp-pc-control-desktop-power\mcp-pc-control'
$server = Join-Path $project 'server.mjs'
$source = [IO.File]::ReadAllText($server)

if ($source.Contains("mcp.session.stale_reinitialize")) {
  Write-Output 'ALREADY_PATCHED'
  & node --check $server
  exit $LASTEXITCODE
}

$start = $source.IndexOf('async function handleMcp(')
$end = $source.IndexOf("app.post(['/mcp', '/']", $start)
if ($start -lt 0 -or $end -lt 0) {
  throw 'No se encontro el bloque handleMcp.'
}

$backup = Join-Path $project ('server.mjs.backup-session-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.bak')
Copy-Item $server $backup -Force

$newHandler = @'
async function handleMcp(req, res, bodyProvided = false) {
  const incomingSessionId = req.headers['mcp-session-id'];
  const initializeRequest = req.method === 'POST' && isInitializeRequest(req.body);
  let transport;

  if (incomingSessionId && transports[incomingSessionId]) {
    transport = transports[incomingSessionId];
    await log('mcp.session.reused', {
      sessionId: incomingSessionId,
      method: req.method,
      path: req.path,
    });
  } else if (initializeRequest) {
    if (incomingSessionId) {
      await log('mcp.session.stale_reinitialize', {
        staleSessionId: incomingSessionId,
        path: req.path,
      });
      delete req.headers['mcp-session-id'];
    }

    await log('mcp.post.init', { path: req.path });
    const created = await createTransportAndServer();
    transport = created.transport;
    if (transport.sessionId) {
      servers[transport.sessionId] = created.server;
    }
  } else if (incomingSessionId) {
    await log('mcp.session.not_found', {
      sessionId: incomingSessionId,
      method: req.method,
      path: req.path,
    });
    res.status(404).json({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Session not found; reinitialize' },
      id: null,
    });
    return;
  } else {
    await log('mcp.bad_request', {
      sessionId: null,
      method: req.method,
      path: req.path,
    });
    res.status(400).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Bad Request: initialize request required' },
      id: null,
    });
    return;
  }

  try {
    await transport.handleRequest(req, res, bodyProvided ? req.body : undefined);
  } catch (error) {
    await log('mcp.transport.error', {
      sessionId: transport?.sessionId || incomingSessionId || null,
      message: error.message,
    });
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'MCP transport error' },
        id: null,
      });
    }
  }
}

'@

$patched = $source.Substring(0, $start) + $newHandler + $source.Substring($end)
[IO.File]::WriteAllText($server, $patched, [Text.UTF8Encoding]::new($false))

& node --check $server
if ($LASTEXITCODE -ne 0) {
  Copy-Item $backup $server -Force
  throw 'Fallo node --check; backup restaurado.'
}

Write-Output ('PATCHED_BACKUP=' + $backup)
