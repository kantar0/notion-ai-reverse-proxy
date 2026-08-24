$ErrorActionPreference = 'Stop'
$p = Join-Path $PSScriptRoot 'server.mjs'
$s = Get-Content $p -Raw -Encoding UTF8
if ($s -match 'mcp\.session\.expired') {
  Write-Output 'LIVE_SESSION_RECOVERY_ALREADY_PRESENT'
  exit 0
}
$backup = $p + '.backup-live-recovery-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.bak'
Copy-Item $p $backup -Force

$old = @'
const transports = {};
const servers = {};
'@
$new = @'
const transports = {};
const servers = {};
const sessionMeta = {};
const SESSION_IDLE_TTL_MS = 30 * 60 * 1000;
const MAX_SESSIONS = 64;
'@
if (-not $s.Contains($old)) { throw 'session declarations marker missing' }
$s = $s.Replace($old, $new)

$old = @'
      transports[sessionId] = transport;
      log('mcp.session.initialized', { sessionId });
'@
$new = @'
      transports[sessionId] = transport;
      sessionMeta[sessionId] = { createdAt: Date.now(), lastSeen: Date.now() };
      log('mcp.session.initialized', { sessionId });
'@
if (-not $s.Contains($old)) { throw 'session initialized marker missing' }
$s = $s.Replace($old, $new)

$old = @'
      delete transports[sessionId];
      delete servers[sessionId];
'@
$new = @'
      delete transports[sessionId];
      delete servers[sessionId];
      delete sessionMeta[sessionId];
'@
if (-not $s.Contains($old)) { throw 'session close marker missing' }
$s = $s.Replace($old, $new)

$old = @'
    transport = transports[incomingSessionId];
    await log('mcp.session.reused', {
'@
$new = @'
    transport = transports[incomingSessionId];
    if (sessionMeta[incomingSessionId]) sessionMeta[incomingSessionId].lastSeen = Date.now();
    await log('mcp.session.reused', {
'@
if (-not $s.Contains($old)) { throw 'session reuse marker missing' }
$s = $s.Replace($old, $new)

$marker = 'async function handleMcp(req, res, bodyProvided = false) {'
$idx = $s.IndexOf($marker)
if ($idx -lt 0 -or $idx -ne $s.LastIndexOf($marker)) { throw 'handleMcp marker mismatch' }
$cleanup = @'
const sessionCleanupTimer = setInterval(async () => {
  const now = Date.now();
  const entries = Object.entries(sessionMeta).sort((a, b) => a[1].lastSeen - b[1].lastSeen);
  const overflow = Math.max(0, entries.length - MAX_SESSIONS);
  for (let index = 0; index < entries.length; index += 1) {
    const [sessionId, meta] = entries[index];
    if (index >= overflow && now - meta.lastSeen <= SESSION_IDLE_TTL_MS) continue;
    const transport = transports[sessionId];
    await log('mcp.session.expired', {
      sessionId,
      idleMs: now - meta.lastSeen,
      reason: index < overflow ? 'capacity' : 'idle',
    });
    delete transports[sessionId];
    delete servers[sessionId];
    delete sessionMeta[sessionId];
    try { await transport?.close(); } catch (error) {
      await log('mcp.session.close_error', { sessionId, message: error.message });
    }
  }
}, 60 * 1000);
sessionCleanupTimer.unref?.();

'@
$s = $s.Insert($idx, $cleanup)
Set-Content $p $s -Encoding UTF8
Write-Output ('PATCHED ' + $p)
Write-Output ('BACKUP ' + $backup)
