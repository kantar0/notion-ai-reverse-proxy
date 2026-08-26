# Notion AI CLI terminal — setup and usage

This document explains how the Notion AI command-line terminal works and how to
set it up on your own machine, with your own accounts. It contains no
credentials, session files, account identifiers or personal paths.

The goal of the tool is simple: **type a prompt in a terminal, get Notion AI's
answer back as text**, without touching the browser UI by hand.

---

## 1. How it works

Notion AI has no public completion API, so the CLI drives the real Notion client
through the Chrome DevTools Protocol (CDP) and reads the rendered answer back.
There are three processes:

```
your terminal            bridge daemon                 Notion client
(thin client)            (long-lived)                  (CDP-controlled)
     |                        |                              |
     |  writes request JSON   |                              |
     +----------------------->|  CDP: focus composer,        |
     |                        |  type prompt, submit  ------->|
     |                        |                              |
     |                        |<-- poll DOM until the answer  |
     |   reads response JSON  |    stops streaming            |
     |<-----------------------+                              |
```

1. **The thin client** (`shosso.mjs` in this repo's workflow) is what you run.
   It never talks to Notion. It writes a request file, waits for a response file,
   prints it and exits. Because it is stateless, it starts instantly and you can
   call it from scripts.
2. **The bridge daemon** (`notion-ai-cli.mjs`) is the only process that talks to
   Notion. It owns the CDP connection, the account state and the queue.
3. **The Notion client** runs with remote debugging enabled so CDP can attach.
   It can be visible or hidden.

File-based IPC between client and daemon:

| Path | Purpose |
| --- | --- |
| `<BRIDGE_DIR>/bridge-requests/` | one JSON per pending request |
| `<BRIDGE_DIR>/bridge-responses/` | one JSON per completed answer |
| `<BRIDGE_DIR>/bridge-progress/` | streaming progress while a turn is running |
| `<BRIDGE_DIR>/cli.lock.json` | daemon PID; how the client knows it is alive |

Requests are written to a `.tmp` file and then renamed into place, so the daemon
never reads a half-written file. Do that in your own implementation too:

```js
fs.writeFileSync(tmpPath, JSON.stringify(req, null, 2))
fs.renameSync(tmpPath, reqPath)      // atomic handoff
```

---

## 2. Prerequisites

- Node.js 20 or newer (`fetch` and `AbortSignal.timeout` are used).
- The Notion desktop app or Chromium, launchable with a remote-debugging port.
- **A Notion workspace where Notion AI is enabled for your account.**

That last point is not optional and it is the single most common reason the CLI
"does nothing": if the signed-in account has no AI access in the selected
workspace, the composer never produces an answer and every request times out.
Verify in the browser first — open Notion AI manually with that exact account and
send one message. If you cannot, the CLI cannot either.

---

## 3. Layout and configuration

Pick a working directory, referred to below as `<BRIDGE_DIR>`, and keep the
daemon plus its state there:

```
<BRIDGE_DIR>/
  notion-ai-cli.mjs          # bridge daemon
  cli-accounts.json          # the accounts you can use
  cli-state.json             # current selection, model, mode, memory
  cli.lock.json              # written by the daemon (do not edit)
  account-sessions/          # one saved session per account
  browser-profile/           # persistent browser profile for CDP
  bridge-requests/ bridge-responses/ bridge-progress/
  start-notion-cdp.ps1       # launches the client with the debug port
  start-bridge-daemon.ps1    # launches the daemon detached
  auto-start-stack.ps1       # does both, idempotently
```

### `cli-accounts.json`

One entry per Notion account you want to drive. Shape:

```json
{
  "accounts": [
    {
      "key": "<STABLE_KEY>",
      "label": "<FRIENDLY_NAME>",
      "email": "<ACCOUNT_EMAIL>",
      "spaceId": "<WORKSPACE_ID>",
      "chatUrl": "<URL_OF_A_DEDICATED_AI_CHAT>"
    }
  ]
}
```

Notes that will save you hours:

- `spaceId` and `chatUrl` are both **required** for an account to be usable. A
  rotation helper typically filters with
  `spaceId && chatUrl && hasSavedSessionForAccount(key)`, so an account missing
  any of the three is silently skipped and you get "no accounts available"
  with no explanation.
- `chatUrl` should point at a chat thread you reserve for the CLI. Reusing a
  thread you also use interactively causes the daemon to read your own messages
  as if they were answers.
- Create the file yourself; never copy someone else's. It identifies accounts.

### `cli-state.json`

Runtime state, safe to delete (you lose only your selection):

```json
{
  "selectedAccountKey": "<STABLE_KEY>",
  "selectedChatUrl": "<URL_OF_A_DEDICATED_AI_CHAT>",
  "selectedChatTitle": "<TITLE>",
  "activeModel": "<MODEL_NAME>",
  "runMode": "hidden",
  "autoRotateAccounts": false,
  "aiBlockedAccountKeys": [],
  "activeCwd": "<WORKING_DIR_FOR_PROMPT_CONTEXT>"
}
```

- `runMode`: `hidden` drives an off-screen window, `visible` uses a normal
  window (much easier to debug), `auto` decides per request. **Start with
  `visible`** until the round trip works, then switch to `hidden`.
- `autoRotateAccounts`: when `true`, the daemon moves to another account after a
  quota or AI-disabled error. Keep it **`false`** during setup: rotation hides
  the real error behind a cascade of failures on other accounts.
- `aiBlockedAccountKeys`: accounts the daemon has proved have no AI access. Add
  keys here manually to exclude them from rotation.

Always back up this file before editing, and write it **without a BOM** — a
leading BOM makes `JSON.parse` fail and the daemon starts with default state.

### `account-sessions/`

One file per account holding the browser session captured after you log in
manually once. There is no way around the manual login: launch the client with
`start-notion-cdp.ps1`, sign in, then run your capture step. If the session file
for an account is missing, that account is not rotatable no matter what
`cli-accounts.json` says.

These files are credentials. They belong in `.gitignore` and nowhere else.

---

## 4. Starting the stack

The client auto-starts everything, so normally you just run a prompt. Under the
hood:

```powershell
# 1. Notion client with the debug port open
powershell -ExecutionPolicy Bypass -File .\start-notion-cdp.ps1     # e.g. port 9223

# 2. Bridge daemon, detached
powershell -ExecutionPolicy Bypass -File .\start-bridge-daemon.ps1

# 3. Both of the above, only if needed
powershell -ExecutionPolicy Bypass -File .\auto-start-stack.ps1
```

The client detects the daemon by reading `cli.lock.json` and probing the PID:

```js
function pidAlive(pid) {
  try { process.kill(pid, 0); return true } catch { return false }
}
```

If the daemon is missing it runs the auto-start script, then waits up to ~15 s
for the lock file to appear before giving up. Pick a **non-default debug port**
(9223 rather than 9222) so you do not collide with an ordinary browser session.

---

## 5. Usage

Send a prompt:

```bash
node shosso.mjs "summarise the meeting notes from this week"
```

Commands (short form / long form):

| Short | Long | Effect |
| --- | --- | --- |
| `st` | `--status` | current account, model, mode, queue state |
| `pin` | `--pin-current` | pin the chat currently open as the target thread |
| `cls` | `--clear-selection` | forget the pinned thread |
| `ms` | `--memory-show` | print the persistent memory block |
| `mr` | `--memory-reset` | wipe it |
| `msave TEXT` | `--memory-save TEXT` | append a durable note |
| `sp TEXT` | `--set-project TEXT` | set the project context added to prompts |
| `cp` | `--clear-project` | clear it |
| `model NAME` | `--set-model NAME` | switch the model |
| — | `--clear-model` | back to the default |
| `mode MODE` | `--set-mode MODE` | `hidden` \| `visible` \| `auto` |
| — | `--get-mode` | print the current mode |
| `mcp` | `--mcp` | diagnose the MCP connection (see §6) |

Running it with no arguments prints the usage summary. The last answer is also
written to `last-output.txt` next to the client, which is handy for piping.

Requests are queued: a second prompt waits for the first to finish rather than
corrupting the composer. Client-side timeout is 15 minutes; if the daemon dies
mid-request the client notices within ~3 s and tells you to restart it.

---

## 6. The `mcp` subcommand

`node shosso.mjs mcp` runs entirely locally — no daemon, no Notion AI — so it
still works when everything else is broken. It answers one question: *is the MCP
server reachable and is Notion actually using it?* It:

1. reads the bearer token and port from the MCP server's `config.json`;
2. sends an `initialize` call to `http://127.0.0.1:<PORT>/mcp`;
3. scans the tunnel agent API on ports `4040-4045` for tunnels pointing at
   `<PORT>`;
4. for each one, counts recent requests whose `User-Agent` identifies the Notion
   MCP client, which distinguishes the live tunnel from a zombie;
5. compares the live hostname against the recorded one and warns when they
   differ — that mismatch is the classic cause of mid-call `404`s;
6. prints exact reconnection steps when something is wrong.

It never prints the token. Keep that property in anything you build on top.

When adapting it, make these configurable instead of hard-coded: the MCP project
directory, the port, the recorded-URL filename and the MCP connection name shown
in Notion. A detector pinned to one machine's paths reports false failures
everywhere else.

---

## 7. Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Every request times out, composer stays empty | The account has no Notion AI access in the selected workspace. Verify manually in the browser. |
| "No accounts available" | An account lacks `spaceId`, `chatUrl` or a saved session file. All three are required. |
| Daemon starts and dies immediately | Malformed or BOM-prefixed `cli-state.json` / `cli-accounts.json`. Restore the backup, rewrite without BOM. |
| CDP cannot attach | The client was not launched with the debug port, or another process owns it. Use a dedicated port and profile. |
| Answers contain your own text | `chatUrl` points at a shared thread. Reserve a dedicated one. |
| Works visible, fails hidden | Selector or focus assumptions that only hold for a real window. Debug in `visible`, then re-test `hidden`. |
| Commands fail with `'Get-Content' is not recognized` or `& was unexpected` | You are in `cmd.exe`. These are PowerShell commands. |
| Accented text prints as mojibake | Output written with the wrong encoding. Write UTF-8 without BOM. |

General advice: the daemon is the only stateful part, so "restart the daemon" —
not "restart everything" — fixes most transient problems. Keep its stdout and
stderr in log files; a silent daemon death is otherwise invisible.

---

## 8. Security

- `account-sessions/`, `cli-accounts.json`, `cli-state.json`, `auth-capture.json`,
  browser profiles and every `*.log` must be git-ignored. They contain session
  cookies equivalent to your password.
- Never paste a bearer token or session blob into a chat, an issue or a
  screenshot. If you do, rotate it.
- The CLI can act as you inside Notion. Treat prompts that arrive from untrusted
  sources as untrusted input, not as instructions.
