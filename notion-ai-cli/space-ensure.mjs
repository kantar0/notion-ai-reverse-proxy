// space-ensure — garantiza que SIEMPRE haya un workspace con cupo de Notion AI.
//
// Cada espacio nuevo de la cuenta trae su propio cupo del plan Free ("Trial of
// Notion AI"), así que cuando todos se quedan sin usage la salida es crear otro
// y seguir rotando. NO hace falta el trial de Business (ese exige método de pago
// y encima su allowance es de cuenta, no de espacio).
//
//   node space-ensure.mjs           crea uno solo si ninguno tiene cupo
//   node space-ensure.mjs --force   crea uno igualmente
//   node space-ensure.mjs --check   solo informa de cuáles tienen cupo
//
// Flujo de creación (interfaz, el único que da espacios con cupo real):
//   switcher → New workspace → "For work" → "Continue" (sin invitar)
//   → "Choose your Plan" → Continue del plan FREE
// Después: alta en cli-accounts.json, sesión por workspace, MCP y registro.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright-core'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const ACCOUNTS = path.join(DIR, 'cli-accounts.json')
const SESSION_DIR = path.join(DIR, 'account-sessions')
const HEADLESS = path.join(DIR, 'headless-session.json')
const STATE = path.join(DIR, 'cli-state.json')
const CDP = process.env.CDP_URL || 'http://127.0.0.1:9223'
const force = process.argv.includes('--force')
const checkOnly = process.argv.includes('--check')
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null } }
const chatUrl = id => 'https://app.notion.com/chat?spaceId=' + id

const browser = await chromium.connectOverCDP(CDP)
const page = browser.contexts()[0].pages().find(p => /notion/i.test(p.url()))
const sleep = ms => page.waitForTimeout(ms)

const listSpaces = () => page.evaluate(async () => {
  const rd = k => { try { return JSON.parse(localStorage.getItem(k) || 'null')?.value || null } catch { return null } }
  const un = x => { let v = x; for (let i = 0; i < 6 && v && typeof v === 'object' && 'value' in v; i++) v = v.value; return v || {} }
  const uid = rd('LRU:KeyValueStore2:current-user-id')
  const j = await (await fetch('/api/v3/getSpaces', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: '{}' })).json()
  const root = j?.[uid] || {}
  const u = un(root.notion_user?.[uid])
  return { uid, email: u.email || null, name: u.name || null,
    spaces: Object.entries(root.space || {}).map(([id, rec]) => ({ id, name: un(rec).name || id.slice(0, 8) })) }
})

/** ¿Tiene composer y sin aviso de cupo agotado? */
async function hasQuota(spaceId) {
  await page.goto(chatUrl(spaceId), { waitUntil: 'commit', timeout: 60000 }).catch(() => {})
  await sleep(12000)
  // Una navegación a medias destruye el contexto de la página: eso no significa
  // "sin cupo", así que se reintenta una vez antes de darlo por malo.
  for (let intento = 0; intento < 2; intento++) {
    try {
      return await page.evaluate(() => {
        const t = (document.body?.innerText || '').replace(/\s+/g, ' ')
        return document.querySelectorAll('[contenteditable="true"][role="textbox"], textarea').length > 0
          && !/used your trial|run out of free AI|for it to reset|podr[aá]s? usar la IA|cr[eé]ditos de Notion|Consigue cr[eé]ditos/i.test(t)
      })
    } catch { await sleep(3000) }
  }
  return false
}

// El CLI apunta en cli-state.json los workspaces que se quedaron sin responder
// (quotaExhausted). Tener composer no significa tener cupo: hasta que no envías
// no se sabe. Fiarse solo de la pantalla daba "5 con cupo" mientras ninguno
// contestaba, y por eso no se creaba el workspace nuevo que hacía falta.
const agotados = (() => {
  const st = readJson(STATE) || {}
  const mapa = st.quotaExhausted || {}
  const ahora = Date.now()
  return new Set(Object.entries(mapa).filter(([, t]) => ahora - t < 60 * 60 * 1000).map(([k]) => String(k).split('::')[1]))
})()

const info = await listSpaces()
console.log(`cuenta ${info.email} · ${info.spaces.length} workspace(s)`)
const conCupo = []
for (const s of info.spaces) {
  const ok = !agotados.has(s.id) && await hasQuota(s.id)
  console.log(`  ${ok ? '✅' : '—'} ${s.id.slice(0, 8)}`)
  if (ok) conCupo.push(s.id)
}
console.log(`con cupo: ${conCupo.length}`)

if (checkOnly || (conCupo.length && !force)) {
  if (conCupo.length) {
    // dejar el CLI apuntando a uno que funcione
    const store = readJson(ACCOUNTS) || { accounts: [] }
    const row = store.accounts.find(a => a.spaceId === conCupo[0])
    if (row && !checkOnly) {
      const st = readJson(STATE) || {}
      Object.assign(st, { selectedAccountKey: row.key, selectedChatUrl: row.chatUrl, selectedChatTitle: row.workspace, lastSelectedAccount: row, threadManuallySelected: false })
      delete st.mcpActiveModuleId; delete st.mcpValidatedThreadModuleId
      fs.writeFileSync(STATE, JSON.stringify(st, null, 2))
      console.log('workspace activo →', conCupo[0].slice(0, 8))
    }
  }
  await browser.close()
  process.exit(0)
}

// ── ninguno con cupo: reciclar los agotados y crear otro ───────────────────
// El que ya gastó su cupo del plan Free se borra para no acumular basura (ojo:
// borrar NO desbloquea crear, el límite de Notion es de ritmo, 429). SOLO se
// borran los que están en space-recyclable.json y además estén sin cupo: los
// espacios originales del usuario nunca se tocan.
const RECYCLABLE = path.join(DIR, 'space-recyclable.json')
const recyclable = readJson(RECYCLABLE) || { spaceIds: [] }
// Como máximo dos por pasada: Notion limita cuántos espacios se crean seguidos,
// y borrarlos todos de golpe podría dejar la cuenta sin ninguno utilizable.
// SOLO los agotados: antes bastaba con estar en la lista blanca, y con --force
// se llegaron a borrar espacios que aún tenían cupo. El cupo manda.
const borrables = info.spaces.filter(s => recyclable.spaceIds.includes(s.id) && !conCupo.includes(s.id)).slice(0, 2)
if (borrables.length) {
  console.log(`\nreciclando ${borrables.length} workspace(s) agotado(s)…`)
  for (const s of borrables) {
    const r = await page.evaluate(async (sid) => {
      const rd = k => { try { return JSON.parse(localStorage.getItem(k) || 'null')?.value || null } catch { return null } }
      const uid = rd('LRU:KeyValueStore2:current-user-id')
      const res = await fetch('/api/v3/deleteSpace', { method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-notion-space-id': sid, 'x-notion-active-user-header': uid },
        body: JSON.stringify({ spaceId: sid }) })
      return res.status
    }, s.id)
    console.log(`  ${r === 200 ? '🗑' : '⚠'} ${s.id.slice(0, 8)} (HTTP ${r})`)
    if (r === 200) {
      recyclable.spaceIds = recyclable.spaceIds.filter(x => x !== s.id)
      const store0 = readJson(ACCOUNTS) || { accounts: [] }
      store0.accounts = store0.accounts.filter(a => a.spaceId !== s.id)
      fs.writeFileSync(ACCOUNTS, JSON.stringify(store0, null, 2))
    }
  }
  fs.writeFileSync(RECYCLABLE, JSON.stringify(recyclable, null, 2))
}

// Si Notion ya nos dijo que no (429), no gastar minutos reintentando en cada
// petición: se espera a que pase el límite de ritmo.
const bloqueadoHasta = (readJson(STATE) || {}).spaceCreateBlockedUntil || 0
if (Date.now() < bloqueadoHasta && !force) {
  const min = Math.ceil((bloqueadoHasta - Date.now()) / 60000)
  console.error(`⚠ Notion aún limita la creación de workspaces; se puede reintentar en ~${min} min.`)
  await browser.close(); process.exit(2)
}
console.log('\nsin cupo en ningún workspace: creando uno nuevo…')
const jsClick = (txt, sw = false) => page.evaluate(({ t, sw }) => {
  const ds = [...document.querySelectorAll('[role="dialog"],[role="menu"]')]
  for (const d of ds.reverse()) {
    const c = [...d.querySelectorAll('*')].filter(e => { const s = (e.innerText || '').trim(); return sw ? s.startsWith(t) : s === t })
    if (!c.length) continue
    let el = c[c.length - 1], p = el
    for (let i = 0; i < 4 && p; i++) { const r = p.getAttribute('role'); if (r === 'menuitem' || r === 'button') { el = p; break } p = p.parentElement }
    el.click(); return true
  }
  return false
}, { t: txt, sw })
const dialog = () => page.evaluate(() => ((([...document.querySelectorAll('[role="dialog"]')].pop() || {}).innerText) || '').replace(/\s+/g, ' ').slice(0, 80))

// Crear el workspace: todo el flujo dentro de un bucle, porque Notion puede
// rechazarlo al final ("We could not create your workspace") cuando se han hecho
// varias creaciones seguidas. Se reintenta espaciando los intentos.
const menuTieneNuevo = () => page.evaluate(() =>
  [...document.querySelectorAll('[role="dialog"],[role="menu"]')].some(d => /New workspace|Nuevo espacio/i.test(d.innerText || '')))
const pulsarSwitcher = () => page.evaluate(() => {
  const el = [...document.querySelectorAll('[role="button"],div[tabindex],button')]
    .find(e => { const r = e.getBoundingClientRect(); return r.top < 40 && r.left < 40 && r.width > 150 && r.height > 20 })
  if (!el) return false
  el.click(); return true
})

let creado = false, ultimoEstado = ''
for (let vuelta = 1; vuelta <= 3 && !creado; vuelta++) {
  if (vuelta > 1) { console.log(`  reintento ${vuelta}: espero ${vuelta * 40}s`); await sleep(vuelta * 40000) }
  await page.goto('https://app.notion.com/chat', { waitUntil: 'commit', timeout: 60000 }).catch(() => {})
  await sleep(10000)

  // abrir el menú (click() de JS sobre el botón del sidebar; ratón de respaldo)
  let abrio = false
  for (let i = 1; i <= 3 && !abrio; i++) {
    await pulsarSwitcher(); await sleep(3500)
    abrio = await menuTieneNuevo()
    if (!abrio) { await page.mouse.click(135, 20); await sleep(3000); abrio = await menuTieneNuevo() }
    if (!abrio) await sleep(4000)
  }
  if (!abrio) { console.log('  (no se abrió el menú de workspaces)'); continue }

  if (!(await jsClick('New workspace'))) { console.log('  (el menú no ofrecía "New workspace")'); continue }
  await sleep(13000)
  ultimoEstado = await dialog()
  if (!/could not create|something went wrong/i.test(ultimoEstado)) {
    await jsClick('For work', true); await sleep(9000)
    await jsClick('Continue'); await sleep(11000)
    await jsClick('Continue'); await sleep(12000)      // plan Free
    ultimoEstado = await dialog()
  }
  const ahora = await listSpaces()
  creado = ahora.spaces.some(x => !info.spaces.some(o => o.id === x.id))
  if (!creado) console.log(`  Notion rechazó la creación: ${ultimoEstado.slice(0, 70)}`)
}
if (!creado) {
  // Notion responde 429 (UserRateLimitResponse) cuando se crean varios espacios
  // seguidos. Es un límite de RITMO, no de cuántos tengas: borrar los agotados
  // no lo desbloquea. Se anota cuándo volver a intentarlo para no gastar
  // minutos reintentando en balde en cada petición.
  try {
    const st = readJson(STATE) || {}
    st.spaceCreateBlockedUntil = Date.now() + 60 * 60 * 1000
    fs.writeFileSync(STATE, JSON.stringify(st, null, 2))
  } catch {}
  console.error('⚠ Notion limita la creación de workspaces (429 rate limit). Reintentaré pasada una hora.')
  await browser.close(); process.exit(2)
}

const despues = await listSpaces()
const nuevo = despues.spaces.find(s => !info.spaces.some(o => o.id === s.id))
if (!nuevo) { console.error('no se creó ningún workspace'); await browser.close(); process.exit(1) }
// Se pudo crear: se levanta la marca de límite por si venía de un intento previo.
try { const st0 = readJson(STATE) || {}; delete st0.spaceCreateBlockedUntil; fs.writeFileSync(STATE, JSON.stringify(st0, null, 2)) } catch {}
console.log('workspace nuevo:', nuevo.id)
console.log('cupo:', await hasQuota(nuevo.id) ? 'DISPONIBLE' : 'sin cupo')

// alta en el CLI: fila + sesión propia
const store = readJson(ACCOUNTS) || { accounts: [] }
const base = readJson(HEADLESS)
const now = new Date().toISOString()
const key = `${info.uid}::${nuevo.id}`
const row = { uid: info.uid, userId: info.uid, spaceId: nuevo.id, email: info.email, name: info.name,
  workspace: nuevo.name, chatUrl: chatUrl(nuevo.id), url: chatUrl(nuevo.id), key,
  addedAt: now, connectedAt: now, lastSeenAt: now, source: 'space-ensure' }
const idx = store.accounts.findIndex(a => a.key === key)
if (idx >= 0) store.accounts[idx] = { ...store.accounts[idx], ...row }; else store.accounts.push(row)
fs.writeFileSync(ACCOUNTS, JSON.stringify(store, null, 2))
if (base?.cookies?.length) {
  fs.mkdirSync(SESSION_DIR, { recursive: true })
  fs.writeFileSync(path.join(SESSION_DIR, key.replace(/[<>:"/\\|?*]+/g, '-').slice(0, 120) + '.json'),
    JSON.stringify({ version: 5, capturedAt: now, savedAt: now, origin: 'https://app.notion.com',
      href: chatUrl(nuevo.id), chatUrl: chatUrl(nuevo.id), sourceUrl: chatUrl(nuevo.id),
      userAgent: base.userAgent || 'Mozilla/5.0', userId: info.uid, spaceId: nuevo.id, threadId: null,
      cookies: base.cookies, account: row }, null, 2))
}
// El espacio recién creado queda marcado como reciclable: cuando agote su cupo
// se podrá borrar para hacer sitio al siguiente.
try {
  const rec = readJson(RECYCLABLE) || { spaceIds: [] }
  if (!rec.spaceIds.includes(nuevo.id)) { rec.spaceIds.push(nuevo.id); fs.writeFileSync(RECYCLABLE, JSON.stringify(rec, null, 2)) }
} catch {}

const st = readJson(STATE) || {}
Object.assign(st, { selectedAccountKey: key, selectedChatUrl: row.chatUrl, selectedChatTitle: row.workspace, lastSelectedAccount: row, threadManuallySelected: false })
delete st.mcpActiveModuleId; delete st.mcpValidatedThreadModuleId
fs.writeFileSync(STATE, JSON.stringify(st, null, 2))
await browser.close()

const run = (s, a = []) => spawnSync(process.execPath, [path.join(DIR, s), ...a], { cwd: DIR, encoding: 'utf8', windowsHide: true, timeout: 900000 })
// Con el puente (cli-state.mcpBridge !== false) las herramientas del PC las
// ejecuta el CLI, no Notion: conectar el MCP al espacio nuevo no aporta nada y
// son varios minutos. El espacio queda igual de utilizable.
const PUENTE = (readJson(STATE) || {}).mcpBridge !== false
if (!PUENTE) {
run('mcp-attach-ui.mjs', [nuevo.id])
run('mcp-autoallow.mjs', [nuevo.id])   // write tools en "Run automatically": si no, pide permiso en cada comando
run('mcp-registry-sync.mjs')
}
const reg = readJson(path.join(DIR, 'mcp-workspace-registry.json')) || {}
console.log(`listo · registro: ${reg.summary?.total ?? '?'} workspaces · ${reg.summary?.ready ?? '?'} rotables`)
