# Persistent Notion account capture and multi-workspace rotation

This guide documents a production-tested pattern for keeping a Notion AI CLI
synchronized with the real browser account, capturing every workspace available
to that account, and rotating between workspaces when AI usage is exhausted or
disabled.

It intentionally contains no real email addresses, user IDs, workspace IDs,
cookies, tokens, domains or personal paths. Replace all placeholders with values
from your own installation.

---

## 1. The failure this solves

A naive multi-account CLI usually has four independent pieces of state:

- the account selected in the CLI state file;
- the cookies loaded in the hidden browser;
- the workspace currently selected by Notion;
- the AI thread URL the daemon tries to open.

If any two disagree, the CLI can report one account while the browser is using
another, open a thread the active session cannot access, or incorrectly classify
a synchronization timeout as a quota error.

A second common bug is creating a brand-new browser profile every time the user
connects an account. The user signs in, closes the window, and the next `/popup`
command opens another empty profile. `/connect` then silently captures the old
hidden account instead of the account the user just authenticated.

The solution is to treat synchronization as an explicit state machine rather
than a collection of fallback values.

---

## 2. Persistent connection profile

Create one browser profile dedicated to account capture and reuse it forever:

```text
<BRIDGE_DIR>/notion-popup-profiles/notion-primary/
<BRIDGE_DIR>/popup-account-state.json
```

Launch it on a dedicated CDP port:

```powershell
msedge.exe `
  --new-window `
  --remote-debugging-port=9224 `
  --remote-debugging-address=127.0.0.1 `
  --remote-allow-origins=* `
  --user-data-dir="<BRIDGE_DIR>\notion-popup-profiles\notion-primary" `
  https://app.notion.com/chat
```

Rules:

1. If `popup-account-state.json` references an existing profile, reuse it.
2. If the popup is closed when `/connect` runs, reopen that same profile and
   wait for CDP.
3. If the popup exists but account capture fails, return an explicit error.
   Never silently fall back to the old hidden session.
4. The user should only need to authenticate once, unless Notion expires the
   session.

The popup profile is credential material. Keep it out of Git.

---

## 3. Detect the account from the browser, not stale CLI state

Read the active Notion user from the popup page:

```js
const read = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key) || "null")?.value || null;
  } catch {
    return null;
  }
};

const userId = read("LRU:KeyValueStore2:current-user-id");
const currentSpaceId = read("LRU:KeyValueStore2:current-space-id");
```

Then query Notion's own workspace bootstrap endpoint from inside the
authenticated page:

```js
const response = await fetch("/api/v3/getSpaces", {
  method: "POST",
  credentials: "include",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({}),
});
```

Use the response to obtain:

- account email and display name;
- every workspace ID available to the account;
- each workspace display name.

Do not use an email saved in `cli-state.json` as proof of the active browser
identity. State-file values are labels and fallbacks, not authentication
evidence.

---

## 4. One account can represent many rotatable workspaces

Notion AI availability and trial usage are workspace-scoped. Therefore, one
login with five workspaces must produce five rotation entries.

Use a stable key with both identities:

```text
<USER_ID>::<SPACE_ID>
```

For each workspace returned by `getSpaces`, create:

```json
{
  "key": "<USER_ID>::<SPACE_ID>",
  "userId": "<USER_ID>",
  "spaceId": "<SPACE_ID>",
  "email": "<ACCOUNT_EMAIL>",
  "workspace": "<WORKSPACE_NAME>",
  "chatUrl": "https://app.notion.com/chat"
}
```

Also write one session snapshot per workspace:

```text
account-sessions/<USER_ID>-<SPACE_ID>.json
```

The cookies can be shared because they belong to the same login, but every
snapshot must contain its own `spaceId` and account metadata.

This also solves duplicate workspace names. Two workspaces named `Outlook`
remain distinct because their `spaceId` values differ.

---

## 5. Force the requested workspace in the hidden browser

Restoring cookies is insufficient: Notion may reopen the last workspace used by
another rotation entry. Before loading the chat, inject both identity keys on
every new document:

```js
const identityScript = `
  try {
    localStorage.setItem(
      'LRU:KeyValueStore2:current-user-id',
      ${JSON.stringify(JSON.stringify({ value: "<USER_ID>" }))}
    )
    localStorage.setItem(
      'LRU:KeyValueStore2:current-space-id',
      ${JSON.stringify(JSON.stringify({ value: "<SPACE_ID>" }))}
    )
  } catch {}
`;

await cdp.call("Page.addScriptToEvaluateOnNewDocument", {
  source: identityScript,
});
```

After navigation, verify the workspace before reporting the restore as ready:

```js
const activeSpaceId = JSON.parse(
  localStorage.getItem("LRU:KeyValueStore2:current-space-id") || "null",
)?.value;

if (activeSpaceId !== requestedSpaceId) {
  throw new Error("The hidden browser loaded the wrong workspace");
}
```

A restore is ready only when all three match:

- selected rotation key;
- restored session account key;
- browser `current-space-id`.

---

## 6. Synchronize before every prompt

Before opening a thread or writing into the composer:

1. Resolve `selectedAccountKey` to a saved workspace entry.
2. Reject entries without a saved session.
3. Compare the selected key with the active headless snapshot and restore
   status.
4. Queue a restore when they differ.
5. Wait until restore status is `ready` for that exact key.
6. Only then connect CDP and navigate to the chat.

If the selected entry has no valid session, automatically select a session-ready
entry instead of leaving account, workspace and thread in a contradictory state.

Avoid this anti-pattern:

```js
const email =
  state.lastSelectedAccount?.email ||
  state.lastConnectedAccount?.email ||
  state.lastActiveAccount?.email;
```

It produces a plausible label even when the browser is authenticated as somebody
else.

---

## 7. Recover stale or inaccessible threads

A thread URL belongs to a particular account and workspace. After rotation, an
old thread may show `Request access`, `No access to this page`, or never expose
a composer.

Self-healing procedure:

1. Navigate to `https://app.notion.com/chat`.
2. Wait for either the composer or `Start new chat`.
3. Click `Start new chat` when necessary.
4. Wait for the composer.
5. Persist the resulting thread URL back to the selected workspace entry.

Do not classify a dedicated-thread timeout as a quota error until
account/workspace synchronization has been verified.

---

## 8. Availability-aware rotation

Rotation candidates must satisfy all of these:

```text
spaceId is present
chatUrl is present
saved session exists
candidate key was not already tried
```

Rotate on errors that mean the current workspace cannot serve the request:

- trial allowance exhausted;
- Notion Credits exhausted;
- chat limit exceeded;
- AI disabled in the workspace;
- account/workspace/thread synchronization cannot be recovered.

Before selecting a candidate as available, confirm that the page has either a
composer or a `Start new chat` control. A page with no quota banner but no
composer is not usable.

Maintain a `tried` set per request so rotation terminates deterministically.

---

## 9. Static MCP tunnel: the hostname and local port must both match

A reserved ngrok domain keeps the hostname stable, but it does not keep the
agent process or endpoint alive.

Verify the real MCP port locally:

```powershell
curl.exe -i http://127.0.0.1:<MCP_PORT>/health
```

Then start ngrok with the same port and the reserved domain:

```powershell
ngrok http --domain=<STATIC_DOMAIN> <MCP_PORT>
```

The ngrok screen must show:

```text
https://<STATIC_DOMAIN> -> http://localhost:<MCP_PORT>
```

Finally test the public path:

```powershell
curl.exe -i https://<STATIC_DOMAIN>/health
```

A supervisor that starts `ngrok http <MCP_PORT>` without `--domain` creates a
random hostname after every restart, even when a static domain exists in the
account. A supervisor that forwards the static domain to the wrong local port is
equally broken.

Keep the domain and port in configuration files and have the supervisor read
them. Never duplicate them as unrelated hard-coded constants.

---

## 10. End-to-end validation checklist

Account capture:

- [ ] `/popup` reuses the same profile.
- [ ] `/connect` reports the account visible in that profile.
- [ ] every workspace from `getSpaces` has a unique `<USER_ID>::<SPACE_ID>`
      entry.
- [ ] every workspace has a session snapshot.

Workspace synchronization:

- [ ] restore status is `ready` for the selected key.
- [ ] hidden-browser `current-space-id` equals the selected workspace.
- [ ] a stale thread automatically falls back to a fresh chat.

Rotation:

- [ ] duplicate workspace names remain distinct.
- [ ] AI-disabled workspaces are skipped.
- [ ] exhausted workspaces move to the next candidate.
- [ ] the request stops after every candidate has been tried once.

MCP tunnel:

- [ ] local `/health` returns `200`.
- [ ] the tunnel uses the reserved hostname.
- [ ] the tunnel forwards to the real MCP port.
- [ ] public `/health` returns `200`.
- [ ] the supervisor does not replace the static tunnel with a random URL.

---

## 11. Security requirements

Never commit:

- `token_v2` or any browser cookies;
- account-session JSON files;
- browser profile directories;
- bearer tokens;
- real user or workspace IDs;
- personal tunnel domains unless intentionally publishing infrastructure
  details.

Commit only generic code, schemas and placeholder-based documentation.
