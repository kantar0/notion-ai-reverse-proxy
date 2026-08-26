# Setup instructions for an AI agent

You are an AI agent that has been asked to deploy this stack on a user's
machine. This file is written for you. Follow it in order and do not skip the
verification steps.

This repository contains **no credentials and no working configuration**. Every
value that identifies a machine, an account or a tunnel must be supplied by the
user you are working with. If you find yourself about to reuse a hostname, token
or path from any document, stop: it is a placeholder, not a value.

---

## What you are deploying

Two independent components. They are useful separately; deploy only what the user
asked for.

| Component | What it gives the user | Reference |
| --- | --- | --- |
| MCP PC control server | Notion can read/write files and run commands on the user's machine | `docs/MCP_TUNNEL_HARDENING.md` |
| Notion AI CLI terminal | Notion AI answers from a terminal, scriptable | `docs/NOTION_AI_CLI_TERMINAL.md` |

Read the relevant reference document **before** writing any file. This page is
the checklist; those pages contain the reasoning and the failure modes.

---

## Values to collect from the user first

Ask for all of these up front. Do not guess any of them, and do not invent
defaults for the ones marked required.

| Value | Required | How to obtain it |
| --- | --- | --- |
| Project directory | yes | Ask. Must be inside the user's home directory. |
| Local port | no | Default `3337`. Change only if taken. |
| Bearer token | yes | **Generate a fresh random one**, 64 hex chars. Never reuse an example. |
| Tunnel provider + account | yes | The user's own account. They must be logged in to its CLI. |
| Reserved tunnel hostname | strongly recommended | Provider dashboard. Without it the URL changes on every restart. |
| Notion account with AI enabled | CLI only | Ask the user to confirm by sending one message in the Notion AI UI manually. |

Generate the token yourself rather than asking the user to think one up:

```powershell
-join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Max 256) })
```

If the user pastes a token into the chat, tell them to rotate it afterwards. A
secret that has been in a transcript is compromised.

---

## Part A — MCP server

### A1. Install

```powershell
cd "<PROJECT_DIR>"
npm install
```

### A2. Write `config.json`

Copy `integrations/mcp-pc-control/config.example.json` and fill it in. Field
names matter; read them from the example rather than assuming. `allowedRoots`
is the security boundary of the whole server — scope it to what the user
actually needs, never to a drive root.

Write it **without a BOM**, or `JSON.parse` will fail:

```powershell
[IO.File]::WriteAllText($path, $json, (New-Object Text.UTF8Encoding $false))
```

### A3. Verify locally before touching the tunnel

```powershell
node server.mjs      # in a separate window
curl http://127.0.0.1:<PORT>/health
```

Do not continue until this returns `{"ok":true,...}`. Debugging a tunnel on top
of a broken server wastes a lot of time.

### A4. Reserve a static hostname, then start the tunnel

Have the user reserve a domain in their provider's dashboard (ngrok: *Universal
Gateway -> Domains*; the free plan includes one). Write the bare hostname — no
`https://`, no path — into `tunnel-domain.txt`, then:

```powershell
ngrok http --domain=<TUNNEL_DOMAIN> <PORT>
```

If the user is on a plan without reserved domains, warn them explicitly: the
public URL will change on every tunnel restart and the MCP will have to be
reconnected in Notion by hand each time. That is the single biggest cause of
"it keeps disconnecting".

If the user's dashboard offers "Agent endpoint vs Cloud endpoint", that is not
the page for reserving a hostname; send them to Domains.

### A5. Verify from outside

A `200` from the host machine proves nothing (see §2.3 of the hardening doc). Ask
the user to open `<PUBLIC_URL>/health` from their phone on mobile data, or use an
external checker. If the user runs a VPN, expect trouble: mesh VPNs resolve the
hostname privately and answer themselves, and commercial VPNs break loopback
checks. Either add the tunnel binary to the VPN's split-tunnelling exclusions or
have the user disconnect while testing.

Do not use a generic web-page-fetching tool as an external probe. Those tools
report "content not available" for perfectly healthy endpoints and will send you
down the wrong path.

### A6. Register in Notion

URL `<PUBLIC_URL>/mcp`, authentication *Bearer token*, prefix `Bearer`, then the
token. Confirm with an `initialize` probe first (command in §5 of the hardening
doc) so you know whether a failure is the server or the Notion side.

### A7. Install the supervisor — do not skip this

Without it the setup works today and breaks tomorrow. Three layers:

1. The supervisor loop: watches the server and the tunnel, restarts only on hard
   evidence of death, keeps the hostname pinned, logs a heartbeat every 5 min.
2. A user-level scheduled task every 5 minutes that relaunches the supervisor if
   it is gone. Use `schtasks.exe`, not `Register-ScheduledTask`, which needs
   elevation.
3. An `HKCU:\...\Run` entry so it also survives a reboot.

Adapt `integrations/mcp-pc-control/mcp-watchdog.ps1` to the user's paths. Obey
these rules — each one comes from a real outage:

- Never `Stop-Process -Force` a process that is responding. Require a long grace
  period **and** a failed TCP connect **and** zero established clients.
- Never kill tunnel processes by image name; you will kill the working one.
- Set `$req.Proxy = $null` in the health probe so a VPN cannot fake a failure.
- Exclude `$PID` when detecting your own supervisor, and match on
  `-File <script>.ps1`, or the query process matches itself.
- Spawn the supervisor with `Invoke-CimMethod Win32_Process Create`;
  `Start-Process` children die with their parent's session.
- Use a `Local\` mutex inside `try/catch`, never `Global\`.
- Wrap the loop in `try/catch/finally` plus `trap` so a fatal error is logged.

Syntax-check before deploying, and never put PowerShell escape backticks inside
file content you generate — they are a reliable source of broken scripts:

```powershell
$e=$null; $t=$null
[System.Management.Automation.Language.Parser]::ParseFile($path,[ref]$t,[ref]$e); $e.Count
```

### A8. Prove it with a destructive test

Kill the server process while a client is connected. Expect: the supervisor
replaces it within ~15 s, `/health` returns `200`, and **the client keeps working
without reconnecting** (session revival). Then kill the supervisor and confirm
the scheduled task revives it within 5 minutes. Only after both tests pass should
you tell the user it is stable.

### A9. Clean up competing launchers

Audit the `Run` key, the Startup folder and scheduled tasks. Remove anything that
reinstalls or restarts the stack on a timer. Two supervisors, or an hourly
reinstaller, will fight your setup and produce failures that look random.

---

## Part B — Notion AI CLI

1. Confirm Node 20+.
2. Create the working directory and the empty IPC folders
   (`bridge-requests`, `bridge-responses`, `bridge-progress`).
3. **Confirm AI access before anything else.** Have the user send one message in
   the Notion AI UI with the exact account they intend to use. If they cannot,
   stop — the CLI cannot work around a disabled feature, and every request will
   time out with no useful error.
4. Launch the client with a dedicated remote-debugging port (9223, not 9222) and
   a dedicated profile. Have the user log in manually; there is no headless
   shortcut. Save the session under `account-sessions/`.
5. Write `cli-accounts.json` with the user's own accounts. Every account needs
   `spaceId`, `chatUrl` and a saved session file, or it is silently unusable.
   `chatUrl` must be a thread reserved for the CLI.
6. Write `cli-state.json` with `runMode: "visible"` and
   `autoRotateAccounts: false`. Both make failures visible instead of hiding
   them behind rotation. Back up the file before any later edit.
7. Start the daemon, then verify with `--status` and one real prompt.
8. Only now switch `runMode` to `hidden` and re-test, and enable rotation if the
   user has several AI-enabled accounts. Record accounts without AI access in
   `aiBlockedAccountKeys`.

---

## Working rules

- **Never commit secrets.** Tokens, `account-sessions/`, `cli-accounts.json`,
  `cli-state.json`, `auth-capture.json`, browser profiles, `*.log`,
  `tunnel-public-url.txt`. Check `.gitignore` before your first commit.
- **Never publish the user's data.** Hostnames, emails, workspace ids, absolute
  home-directory paths and machine names are all identifying. Use placeholders.
- **Prefer short commands.** Long chained one-liners driven through a remote tool
  fail with empty output. Write a `.ps1` and run it with `-File`.
- **Everything UTF-8 without BOM**, on Windows especially.
- **Distinguish PowerShell from cmd.** If the user reports
  `'Get-Content' is not recognized` or `& was unexpected at this time`, they ran
  a PowerShell command in `cmd.exe`. Say which shell to use.
- **Diagnose in order:** server -> tunnel -> external reachability -> auth ->
  Notion registration. Skipping a layer is how you end up rebuilding the wrong
  one.
- **Write down what you changed**, including scheduled tasks, registry entries
  and the reason for each. The next agent, or you in a week, will need it.
