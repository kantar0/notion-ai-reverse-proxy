// mcp-provision-all — deja TODAS las cuentas guardadas listas para la rotación.
//
// Por cada cuenta con sesión válida en account-sessions/:
//   1. carga su sesión en el motor invisible,
//   2. conecta el MCP en cada workspace suyo que no lo tenga (mcp-attach-ui),
//   3. registra sus módulos en mcp-workspace-registry.json (mcp-registry-sync),
//   4. da de alta sus workspaces en cli-accounts.json con la URL ?spaceId=.
// Al final restaura la sesión principal (headless-session.json).
//
//   node mcp-provision-all.mjs              todas las cuentas
//   node mcp-provision-all.mjs <email>      solo esa
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright-core'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const SESSION_DIR = path.join(DIR, 'account-sessions')
const ACCOUNTS = path.join(DIR, 'cli-accounts.json')
const REGISTRY = path.join(DIR, 'mcp-workspace-registry.json')
const HEADLESS = path.join(DIR, 'headless-session.json')
const CDP = 'http://127.0.0.1:9223'
const only = (process.argv[2] || '').trim().toLowerCase()
const sleep = ms => new Promise(r => setTimeout(r, ms))
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null } }
const chatUrl = spaceId => 'https://app.notion.com/chat?spaceId=' + spaceId

function accountSessions() {
  const out = new Map()
  for (const file of fs.existsSync(SESSION_DIR) ? fs.readdirSync(SESSION_DIR) : []) {
    if (!file.endsWith('.json')) continue
    const s = readJson(path.join(SESSION_DIR, file))
    const email = s?.account?.email
    if (!email || !(s.cookies || []).some(c => c.name === 'token_v2')) continue
    if (only && email.toLowerCase() !== only) continue
    if (!out.has(email)) out.set(email, s)
  }
  return out
}

const browser = await chromium.connectOverCDP(CDP)
const ctx = browser.contexts()[0]
const page = ctx.pages().find(p => /notion/i.test(p.url())) || ctx.pages()[0]

async function loadSession(session) {
  await ctx.clearCookies()
  await ctx.addCookies((session.cookies || []).map(c => ({
    name: c.name, value: c.value,
    domain: String(c.domain || '').includes('notion') ? c.domain : '.notion.so',
    path: c.path || '/', secure: true, httpOnly: !!c.httpOnly, sameSite: 'Lax',
  })))
  await page.goto('https://app.notion.com/chat', { waitUntil: 'commit', timeout: 60000 }).catch(() => {})
  await sleep(9000)
  return await page.evaluate(async () => {
    const rd = k => { try { return JSON.parse(localStorage.getItem(k) || 'null')?.value || null } catch { return null } }
    const un = x => { let v = x; for (let i = 0; i < 6 && v && typeof v === 'object' && 'value' in v; i++) v = v.value; return v || {} }
    const uid = rd('LRU:KeyValueStore2:current-user-id')
    if (!uid) return null
    const j = await (await fetch('/api/v3/getSpaces', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: '{}' })).json()
    const root = j?.[uid] || {}
    return { uid, email: un(root.notion_user?.[uid]).email || null, name: un(root.notion_user?.[uid]).name || null,
      spaces: Object.entries(root.space || {}).map(([id, rec]) => ({ id, name: un(rec).name || id.slice(0, 8) })) }
  })
}

/** Registra en cli-accounts.json todos los workspaces de la cuenta. */
function upsertAccounts(info, session) {
  const store = readJson(ACCOUNTS) || { accounts: [] }
  const now = new Date().toISOString()
  let added = 0
  for (const s of info.spaces) {
    const key = `${info.uid}::${s.id}`
    const row = {
      uid: info.uid, userId: info.uid, spaceId: s.id, email: info.email, name: info.name,
      workspace: s.name, chatUrl: chatUrl(s.id), url: chatUrl(s.id), key,
      addedAt: now, connectedAt: now, lastSeenAt: now, source: 'provision',
    }
    const idx = store.accounts.findIndex(a => a.key === key)
    if (idx >= 0) store.accounts[idx] = { ...store.accounts[idx], ...row, addedAt: store.accounts[idx].addedAt || now }
    else { store.accounts.push(row); added++ }
    // snapshot de sesion por workspace, que es lo que la rotacion exige
    const file = path.join(SESSION_DIR, key.replace(/[<>:"/\\|?*]+/g, '-').replace(/\s+/g, '-').slice(0, 120) + '.json')
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, JSON.stringify({ version: 5, capturedAt: now, savedAt: now,
        origin: 'https://app.notion.com', href: chatUrl(s.id), chatUrl: chatUrl(s.id), sourceUrl: chatUrl(s.id),
        userAgent: session.userAgent || 'Mozilla/5.0', userId: info.uid, spaceId: s.id, threadId: null,
        cookies: session.cookies, account: row }, null, 2))
    }
  }
  fs.writeFileSync(ACCOUNTS, JSON.stringify(store, null, 2))
  return added
}

const run = (script, args = []) => {
  const r = spawnSync(process.execPath, [path.join(DIR, script), ...args], { cwd: DIR, encoding: 'utf8', windowsHide: true, timeout: 900000 })
  return { status: r.status, out: String(r.stdout || ''), err: String(r.stderr || '') }
}

const resumen = []
for (const [email, session] of accountSessions()) {
  console.log(`\n═══ ${email}`)
  const info = await loadSession(session)
  if (!info?.uid) { console.log('   sesión caducada; se omite'); resumen.push({ email, estado: 'sesión caducada' }); continue }
  console.log(`   ${info.spaces.length} workspace(s): ${info.spaces.map(s => s.name).join(', ').slice(0, 90)}`)
  const added = upsertAccounts(info, session)
  if (added) console.log(`   ${added} workspace(s) nuevos en cli-accounts.json`)

  // Con el puente (cli-state.mcpBridge !== false) las herramientas las ejecuta
  // el CLI, no Notion: conectar el MCP a cada workspace no aporta nada y son
  // varios minutos por cuenta. Se registra el workspace y listo.
  const PUENTE = (readJson(path.join(DIR, 'cli-state.json')) || {}).mcpBridge !== false
  if (PUENTE || process.argv.includes('--sin-mcp')) {
    console.log('   modo puente: registro sin conectar MCP')
    resumen.push({ email, workspaces: info.spaces.length, estado: 'ok' })
    continue
  }
  const attach = run('mcp-attach-ui.mjs', ['--all'])
  for (const line of attach.out.split('\n').filter(l => /^(✅|⚠|   )/.test(l)).slice(-6)) console.log('   ' + line.trim())

  // Sin esto las write tools quedan en "Always ask" y cada comando abre un
  // dialogo de permiso que nadie pulsa (desde Discord ni se ve): la respuesta
  // se queda a medias para siempre.
  const auto = run('mcp-autoallow.mjs')
  const autoOk = (auto.out.match(/write tools en automatico|write tools en automático|ya estaba en autom/gi) || []).length
  if (autoOk) console.log(`   permisos MCP en automatico: ${autoOk} workspace(s)`)

  const sync = run('mcp-registry-sync.mjs')
  const reg = readJson(REGISTRY) || {}
  console.log(`   registro: ${reg.summary?.total ?? '?'} workspaces · ${reg.summary?.ready ?? '?'} rotables${sync.status !== 0 ? ' (escáner murió al cerrar; filas válidas)' : ''}`)
  resumen.push({ email, workspaces: info.spaces.length, estado: 'ok' })
}

// Volver a la cuenta principal para no dejar el motor en otra sesión.
const main = readJson(HEADLESS)
if (main?.cookies?.length) { await loadSession(main); console.log(`\nsesión restaurada: ${main.account?.email || '?'}`) }
await browser.close()

const reg = readJson(REGISTRY) || {}
console.log('\n--- resumen ---')
for (const r of resumen) console.log(`${String(r.email).padEnd(32)} ${r.estado}${r.workspaces ? ` · ${r.workspaces} workspace(s)` : ''}`)
console.log(`registro final: ${reg.summary?.total ?? '?'} workspaces · ${reg.summary?.ready ?? '?'} rotables`)
