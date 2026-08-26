# Hardening a self-hosted MCP server so Notion never loses the connection

This document explains, from scratch, how to run a local MCP server (such as
`integrations/mcp-pc-control`) exposed through a tunnel, and how to keep the
connection alive **permanently**. It is written so that you can reproduce the
setup with your own machine, your own tunnel and your own token. No credentials,
domains or personal paths are included.

Everything below was learned by debugging a real deployment that kept dropping
after a few minutes. If your MCP "works and then dies", the cause is almost
certainly one of the four failure modes described here.

---

## 0. Conventions used in this guide

Replace these placeholders with your own values:

| Placeholder | Meaning | Example |
| --- | --- | --- |
| `<PROJECT_DIR>` | Folder containing your MCP server | `C:\Users\<you>\mcp-pc-control` |
| `<PORT>` | Local port the MCP server listens on | `3337` |
| `<TOKEN>` | Bearer token from your `config.json` | a 64-char random hex string |
| `<TUNNEL_DOMAIN>` | Your reserved tunnel hostname | `something-fixed.ngrok-free.dev` |
| `<PUBLIC_URL>` | `https://<TUNNEL_DOMAIN>` | — |

The MCP endpoint you register in Notion is always `<PUBLIC_URL>/mcp`.

---

## 1. Architecture

```
Notion (cloud)
  |  HTTPS + Authorization: Bearer <TOKEN>
  v
Tunnel edge  (ngrok / Cloudflare / any reverse tunnel)
  |  forwards to 127.0.0.1:<PORT>
  v
MCP server (Node, Express + MCP StreamableHTTP transport)
  |
  +-- keeps MCP sessions in memory, keyed by session id
```

Three independent things must be true at the same time, and each one is a
separate failure mode:

1. The MCP server process is listening on `<PORT>` and answers `/health`.
2. The tunnel process is alive **and** its public hostname is the same one
   registered in Notion.
3. The MCP session id that Notion holds is still known by the server process.

A supervisor must protect all three. Protecting only the first one is the
classic mistake.

---

## 2. The four failure modes (and the fix for each)

### 2.1 A watchdog that kills healthy processes

**Symptom:** the connection dies every few minutes, seemingly at random.
Notion reports `404` or `Session not found`.

**Cause:** a naive watchdog does this:

```powershell
# NEVER DO THIS
if (-not (healthy)) { Get-Process node | Stop-Process -Force }
```

Two bugs at once. First, `/health` can fail for reasons that have nothing to do
with the server (see 2.2). Second, killing the process destroys every in-memory
MCP session, so Notion's session id becomes invalid instantly.

**Fix — the golden rule:** *never kill a process that is alive.* Restart only
when you have hard evidence of death. Require **all** of these before killing:

- `/health` has failed continuously for a long grace period (180 s works well).
- A raw TCP connect to `127.0.0.1:<PORT>` also fails.
- There are zero `ESTABLISHED` client connections on `<PORT>`.

If nobody is listening on the port at all, there is nothing to kill: just start
the server. That is the only common case.

The same rule applies to the tunnel process. A watchdog that does
`Get-Process <tunnel> | Stop-Process -Force` will kill *every* tunnel agent,
including the one currently serving traffic. If you are on a free plan without a
reserved domain, the restarted tunnel gets a **new hostname** and every client
breaks with `404`.

### 2.2 A VPN breaking the loopback health check

**Symptom:** `/health` fails from the watchdog but `curl http://127.0.0.1:<PORT>/health`
works perfectly when you run it by hand.

**Cause:** many VPN clients install a system proxy and/or reroute the default
gateway. Runtimes that honour system proxy settings then try to reach `127.0.0.1`
*through the VPN*. Look for a symptom like `gateway and self IP changed` in your
tunnel's network diagnostics.

**Fix:** bypass the proxy explicitly in the health probe.

```powershell
$req = [System.Net.HttpWebRequest]::Create("http://127.0.0.1:$port/health")
$req.Proxy = $null          # <-- the important line
$req.Timeout = 8000
$resp = $req.GetResponse()
```

Combined with the golden rule from 2.1, a false negative here becomes harmless
instead of fatal.

### 2.3 A tunnel that is not actually reachable from the internet

**Symptom:** `curl <PUBLIC_URL>/health` returns `200` on the host machine, but
Notion still fails with `SSE error: MCP fetch request failed`.

**Cause:** a local `200` proves almost nothing. If the tunnel provider also
provides private-network DNS (as mesh VPNs do), your own machine may resolve the
public hostname to a private address and answer itself. That is a hairpin, not
internet reachability.

**How to test properly:** verify from a network you do not control — a phone on
mobile data, or any external HTTP checker. If DNS lookups against a public
resolver such as `8.8.8.8` time out on your machine, your DNS is being
intercepted and local tests are meaningless.

**Fix:** use a tunnel that publishes to the public internet and terminates TLS
for you, and confirm reachability from outside before blaming the MCP server.

### 2.4 Sessions that do not survive a server restart

**Symptom:** the server restarts cleanly and `/health` is `200`, but Notion has
to be reconnected by hand.

**Cause:** MCP sessions live in a process-local map. A fresh process does not
know the session id the client keeps sending, so it replies `404`.

**Fix:** when an unknown session id arrives, do not fail. Recreate a transport
bound to *that same id* and continue. In practice:

```js
// pseudo-code inside your POST /mcp handler
let transport = transports.get(sessionId)
if (!transport && sessionId) {
  // session revival: rebuild state for an id we have never seen
  transport = createTransportAndServer(sessionId)   // force the generator to reuse it
  transports.set(sessionId, transport)
  log('mcp.session.revived', { sessionId })
}
```

The key detail is that your transport's `sessionIdGenerator` must be able to
return a **fixed** id instead of a fresh random one:

```js
sessionIdGenerator: () => fixedSessionId || randomUUID()
```

Also add a TTL and a cap on the session map so revival cannot leak memory.
With this in place the server becomes disposable: it can be killed and restarted
and the client never notices.

---

## 3. A supervisor that cannot fail silently

The last bug is the sneakiest: **the watchdog itself dies.** A long-lived
PowerShell loop can disappear without writing anything to its log, and if the
only thing that starts it is a login item, nothing ever brings it back. The MCP
then survives exactly until the first hiccup.

Defence in depth, three layers:

1. **Heartbeat.** Log a line every 5 minutes (`heartbeat: alive pid=...`). If the
   log stops, you know precisely when the supervisor died.
2. **Fatal logging.** Wrap the main loop in `try/catch/finally` and add a `trap`
   so any terminating error is written before the process exits.
3. **A watchdog for the watchdog.** A scheduled task, every 5 minutes, that
   checks whether the supervisor is alive and relaunches it if not. This is what
   turns "it stays up for a while" into "it stays up".

The resulting chain is:

```
Scheduled task (every 5 min)
   -> supervisor loop (every 2 s)
        -> MCP server process
        -> tunnel process + public hostname
```

### Detecting your own supervisor without false positives

A subtle trap: if you look for processes whose command line contains
`mcp-watchdog`, your *own* query process matches, because its command line
contains that string too. You then believe a supervisor is alive when there is
none. Two defences:

```powershell
$pattern = '*-File*mcp-' + 'watch' + 'dog.ps1*'   # split so this line cannot self-match
$alive = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
  Where-Object { $_.CommandLine -like $pattern -and $_.ProcessId -ne $PID })
```

Match on `-File <script>.ps1` and always exclude `$PID`.

### Spawning a process that outlives its parent (Windows, no admin)

`Start-Process` and most "run in background" helpers create a child that dies
when the launcher's session goes away. To get a truly detached process without
administrator rights, create it through WMI:

```powershell
$cmd = 'powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "<PROJECT_DIR>\mcp-watchdog.ps1"'
Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $cmd }
```

For the periodic check, `Register-ScheduledTask` often fails with *Access denied*
(`0x80070005`) unless elevated, while plain `schtasks.exe` succeeds for a
user-level task:

```powershell
schtasks.exe /create /tn 'MCP-Ensure-Watchdog' /sc minute /mo 5 /tr $action /f
```

Add a `HKCU:\Software\Microsoft\Windows\CurrentVersion\Run` entry as well so the
supervisor also comes back after a reboot or logout.

### Single instance without shooting yourself in the foot

Use a mutex so two supervisors never fight, but keep two details in mind:
prefer the `Local\` namespace (a `Global\` mutex can fail outright in a
non-elevated session and kill the process on startup), and wrap the creation in
`try/catch` so a mutex failure degrades to "run anyway" instead of "exit".

```powershell
try {
  $createdNew = $false
  $mutex = New-Object System.Threading.Mutex($true, 'Local\MyMcpWatchdog', [ref]$createdNew)
  if (-not $createdNew) { exit 0 }   # another instance owns it
} catch { $mutex = $null }           # continue without the mutex
```

---

## 4. Make the public URL immutable

Even a perfect supervisor cannot help if the hostname changes, because the URL
is stored on the Notion side. On free tunnel plans a restart usually means a new
random hostname.

**Reserve a static hostname.** ngrok, for example, grants every account one free
static domain under *Universal Gateway -> Domains*. Then always start the tunnel
pinned to it:

```powershell
ngrok http --domain=<TUNNEL_DOMAIN> <PORT>
```

Make this data-driven rather than hard-coded: keep the hostname in a file such as
`tunnel-domain.txt`, and have the supervisor read it. If the file is present it
adds `--domain=`; if it is absent it falls back to an ephemeral tunnel. That way
the same script works before and after you reserve the domain.

Also have the supervisor record the live hostname in `tunnel-public-url.txt` and
log loudly when it changes:

```
WARNING: public URL changed from <old> to <new> -> reconnect the MCP in Notion
```

Discover the live hostname from the local tunnel agent API instead of parsing
logs. ngrok exposes `http://127.0.0.1:4040/api/tunnels`; scan `4040-4045`,
because a second agent takes the next free port — which is exactly how you end
up with a zombie tunnel and a working one at the same time.

```powershell
$data = Invoke-RestMethod "http://127.0.0.1:$apiPort/api/tunnels" -TimeoutSec 3
foreach ($t in $data.tunnels) {
  if ($t.config.addr -match "$port" -and $t.public_url -like 'https://*') { return $t.public_url }
}
```

To tell a real tunnel from a zombie, ask the agent API for recent requests and
count those whose `User-Agent` identifies the Notion MCP client. Zero traffic on
one agent and steady traffic on another means the first is the zombie.

---

## 5. Registering the server in Notion

1. Confirm the server locally: `curl http://127.0.0.1:<PORT>/health` -> `{"ok":true,...}`.
2. Confirm the tunnel from **another network**: `curl <PUBLIC_URL>/health`.
3. Confirm MCP itself speaks, with authentication:

```powershell
Invoke-WebRequest -UseBasicParsing -Method POST -Uri '<PUBLIC_URL>/mcp' `
  -Headers @{ Authorization = 'Bearer <TOKEN>'; Accept = 'application/json, text/event-stream' } `
  -ContentType 'application/json' `
  -Body '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}'
```

A `200` with `serverInfo` in the body means the server is ready. If you get
`401`, check that you sent the header as `Bearer <TOKEN>` — a bare token without
the prefix fails, and so does a literal placeholder you forgot to substitute.

4. In Notion, add the MCP server with URL `<PUBLIC_URL>/mcp`, authentication
   *Bearer token*, prefix `Bearer`, and your token.

**Read the token from the right field.** If your `config.json` uses
`bearerToken`, then `(Get-Content config.json -Raw | ConvertFrom-Json).token` is
silently empty and any rotation script will fail with *The property 'token'
cannot be found on this object*. Print the field names first:

```powershell
((Get-Content config.json -Raw | ConvertFrom-Json).PSObject.Properties.Name) -join ', '
```

---

## 6. Operational notes

- **Write files without a BOM.** A leading BOM makes `JSON.parse` fail on
  `config.json` and produces confusing startup errors. Use
  `[IO.File]::WriteAllText($path, $text, (New-Object Text.UTF8Encoding $false))`.
- **Rotate a leaked token immediately.** If a token appears in a screenshot,
  chat or log, replace it in `config.json`, restart the server (the supervisor
  will bring it back within seconds) and update it in Notion.
- **Prefer short commands.** Long multi-step shell one-liners fail opaquely with
  no stdout when driven through a remote tool. Write a `.ps1` to disk and run it
  with `-File`.
- **Audit your autostart entries.** Duplicate launchers are a common source of
  two servers or two tunnel agents fighting over the same port. Check the `Run`
  registry key, the Startup folder and scheduled tasks, and delete anything that
  restarts or reinstalls the stack behind your back.
- **Validate before you deploy.** Syntax-check a script without running it:

```powershell
$e = $null; $t = $null
[System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$t, [ref]$e)
$e.Count   # 0 means it parses
```

---

## 7. Verifying the whole thing

The only test that matters is destructive. Kill the MCP server process on
purpose while a client is connected:

1. The supervisor should log `no listener` a few times, then `server started`
   and `server healthy` — typically within 10-15 seconds.
2. Your client should keep working **without reconnecting**, thanks to session
   revival (2.4).
3. The public hostname should be unchanged (4).

Then kill the supervisor too, and confirm the scheduled task revives it within
5 minutes. If both tests pass, the deployment is genuinely resilient.

A reference implementation of the supervisor lives in
`integrations/mcp-pc-control/`.
