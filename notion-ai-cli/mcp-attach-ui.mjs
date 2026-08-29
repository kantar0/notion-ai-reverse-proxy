// mcp-attach-ui — conecta el servidor MCP (PC1) a workspaces de Notion pilotando
// su interfaz en el motor invisible. Sirve para CUALQUIER cuenta: la que este
// cargada en el motor.
//
// Por que la interfaz y no la API: crear los records a mano
// (workflow_module + external_connection + puntero en space_view) lo rechaza el
// servidor con "Client saveTransactions request targets tables blocked by
// policy", y no existe ningun endpoint /api/v3/*mcp* en el bundle. El unico
// camino es el flujo real:
//   chat → Settings → "MCP servers" → "Add MCP server" → tile "Custom MCP"
//   → URL → (el formulario se expande) → Name → Authentication → Connect
//
//   node mcp-attach-ui.mjs <spaceId>   conecta el MCP en ese workspace
//   node mcp-attach-ui.mjs --all       en todos los del usuario que no lo tengan
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const TEMPLATE = path.join(DIR, 'mcp-module-template.json')
const CDP = 'http://127.0.0.1:9223'
// Credenciales del servidor MCP propio. mcp-server.json manda; si no existe se
// usa la URL del modulo ya conectado (sin token, solo sirve si el servidor es
// abierto). El token NUNCA se imprime.
const SERVER_FILE = path.join(DIR, 'mcp-server.json')
const server = fs.existsSync(SERVER_FILE) ? JSON.parse(fs.readFileSync(SERVER_FILE, 'utf8')) : {}
const SERVER_URL = server.url || JSON.parse(fs.readFileSync(TEMPLATE, 'utf8')).serverUrl
const SERVER_NAME = process.env.MCP_NAME || server.name || 'PC1'
const SERVER_TOKEN = server.token || ''
const arg = (process.argv[2] || '').trim()
if (!arg) { console.error('Uso: node mcp-attach-ui.mjs <spaceId> | --all'); process.exit(1) }

const browser = await chromium.connectOverCDP(CDP)
const ctx = browser.contexts()[0]
const page = ctx.pages().find(p => /notion/i.test(p.url())) || ctx.pages()[0]
page.setDefaultTimeout(30000)
const sleep = ms => page.waitForTimeout(ms)

/** Espacios del usuario y cuantos MCP tiene cada uno (del fanout que emite la app). */
async function readSpaces() {
  const fanouts = []
  const grab = async r => { try { if (new URL(r.url()).pathname === '/api/v3/getSpacesFanout') fanouts.push(await r.json()) } catch {} }
  page.on('response', grab)
  await page.goto('https://www.notion.so/ai', { waitUntil: 'commit', timeout: 60000 }).catch(() => {})
  for (let i = 0; i < 30 && !fanouts.length; i++) await sleep(500)
  page.off('response', grab)
  const un = x => { let v = x; for (let i = 0; i < 6 && v && typeof v === 'object' && 'value' in v; i++) v = v.value; return v || {} }
  const views = {}, names = {}
  for (const payload of fanouts) {
    for (const user of Object.values(payload?.users || {})) {
      for (const rec of Object.values(user?.space_view || {})) {
        const v = un(rec)
        if (v?.space_id) views[v.space_id] = (v?.settings?.agent_chat_modules || []).length
      }
    }
    for (const sp of Object.values(payload?.spaces || {})) { const v = un(sp); if (v?.id) names[v.id] = v.name }
  }
  const detail = await page.evaluate(async () => {
    const rd = k => { try { return JSON.parse(localStorage.getItem(k) || 'null')?.value || null } catch { return null } }
    const un = x => { let v = x; for (let i = 0; i < 6 && v && typeof v === 'object' && 'value' in v; i++) v = v.value; return v || {} }
    const uid = rd('LRU:KeyValueStore2:current-user-id')
    const j = await (await fetch('/api/v3/getSpaces', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: '{}' })).json()
    const root = j?.[uid] || {}
    return { uid, email: un(root.notion_user?.[uid]).email || null,
      spaces: Object.entries(root.space || {}).map(([id, rec]) => ({ id, name: un(rec).name || id.slice(0, 8) })) }
  })
  return { ...detail, spaces: detail.spaces.map(s => ({ ...s, mcp: views[s.id] ?? 0 })) }
}

/** Clic real (trusted) sobre el primer elemento cuyo texto encaje. */
async function clickText(re, { maxKids = 4, scope = '[role="dialog"]' } = {}) {
  const box = await page.evaluate(({ src, maxKids, scope }) => {
    const rx = new RegExp(src, 'i')
    const roots = scope ? [...document.querySelectorAll(scope)] : [document.body]
    const root = roots[roots.length - 1] || document.body
    const el = [...root.querySelectorAll('[role="button"],button,div')]
      .find(e => rx.test((e.innerText || '').trim()) && e.children.length <= maxKids && e.getBoundingClientRect().width > 20)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }, { src: re, maxKids, scope })
  if (!box) return false
  await page.mouse.click(box.x, box.y)
  return true
}

/** Clic en el ULTIMO nodo cuyo texto sea exactamente `text` (el hoja, no el contenedor). */
async function clickExactText(text) {
  const box = await page.evaluate((t) => {
    const ds = [...document.querySelectorAll('[role="dialog"],[role="menu"],[role="listbox"]')]
    const d = ds[ds.length - 1] || document.body
    const el = [...d.querySelectorAll('*')].filter(e => (e.innerText || '').trim() === t).pop()
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }, text)
  if (!box) return false
  await page.mouse.click(box.x, box.y)
  return true
}

async function attach(space) {
  console.log(`\n== ${space.name} (${space.id.slice(0, 8)})`)
  await page.goto(`https://app.notion.com/chat?spaceId=${space.id}`, { waitUntil: 'commit', timeout: 60000 }).catch(() => {})
  await sleep(10000)

  // El engranaje del composer abre el panel con "MCP servers". Tarda en montar,
  // asi que se espera; y si el espacio tiene la IA apagada no aparecera nunca.
  const gear = page.locator('[aria-label="Settings"]').first()
  for (let i = 0; i < 12 && !(await gear.count()); i++) await sleep(2500)
  if (!(await gear.count())) {
    const apagada = await page.evaluate(() => /AI is disabled|IA está desactivada|disabled for this workspace/i.test(document.body?.innerText || ''))
    return { space: space.name, ok: false, why: apagada ? 'la IA está deshabilitada en este workspace' : 'no encontré el panel del chat' }
  }
  await gear.click({ force: true }).catch(() => {})
  await sleep(4000)
  if (!(await clickText('^MCP servers'))) return { space: space.name, ok: false, why: 'sin fila "MCP servers"' }
  await sleep(4000)
  if (!(await clickText('^Add MCP server'))) return { space: space.name, ok: false, why: 'sin "Add MCP server"' }
  await sleep(6000)

  const tile = page.getByRole('button', { name: /Custom MCP/i }).first()
  if (!(await tile.count())) return { space: space.name, ok: false, why: 'sin tile "Custom MCP"' }
  await tile.click({ force: true }).catch(() => {})
  await sleep(5000)

  const url = page.locator('input[placeholder="https://example.com/mcp"]').first()
  if (!(await url.count())) return { space: space.name, ok: false, why: 'sin formulario de URL' }
  await url.click({ force: true })
  await page.keyboard.press('Control+A')
  await page.keyboard.type(SERVER_URL, { delay: 12 })

  // El formulario solo despliega Name/Authentication cuando acepta la URL.
  const name = page.locator('input[placeholder="Example MCP Server"]').first()
  let expanded = false
  for (let i = 0; i < 20 && !expanded; i++) { await sleep(1000); expanded = (await name.count()) > 0 }
  if (!expanded) return { space: space.name, ok: false, why: 'la URL no desplegó el formulario' }
  // Notion exige nombre único dentro del workspace ("Another MCP server in your
  // workspace is using this name"), así que se le añade el prefijo del espacio.
  const uniqueName = `${SERVER_NAME}-${space.id.slice(0, 4)}`
  if (!(await name.inputValue().catch(() => ''))) { await name.click({ force: true }); await page.keyboard.type(uniqueName, { delay: 20 }) }
  await sleep(800)
  // Notion sondea el servidor para deducir como se autentica: mientras tanto el
  // formulario muestra "Loading..." y Connect no hace nada. Hay que esperarlo.
  let form = ''
  for (let i = 0; i < 30; i++) {
    form = await page.evaluate(() => {
      const ds = [...document.querySelectorAll('[role="dialog"]')]
      return (ds[ds.length - 1]?.innerText || '').replace(/\s+/g, ' ')
    })
    if (!/Loading/i.test(form)) break
    await sleep(2000)
  }
  console.log('   formulario:', form.slice(0, 160))

  if (process.env.MCP_STOP_AT_FORM === '1') {
    const snap = await page.evaluate(() => {
      const ds = [...document.querySelectorAll('[role="dialog"]')]
      const d = ds[ds.length - 1]
      return { texto: (d?.innerText || '').replace(/\s+/g, ' ').slice(0, 400),
        inputs: [...(d?.querySelectorAll('input') || [])].map(e => ({ ph: e.getAttribute('placeholder') || '', val: (e.value || '').slice(0, 60) })),
        oauthNodes: [...(d?.querySelectorAll('*') || [])].filter(e => (e.innerText || '').trim() === 'OAuth').length }
    })
    console.log('   [form]', JSON.stringify(snap))
    return { space: space.name, ok: false, why: 'parada de inspección (MCP_STOP_AT_FORM=1)' }
  }

  // Authentication: el servidor no pide credenciales → "None" si se ofrece.
  // El control es un div anidado: hay que ir al ULTIMO nodo cuyo texto sea
  // exactamente "OAuth", no al contenedor que tambien lo contiene.
  const openedAuth = await page.evaluate(() => {
    const ds = [...document.querySelectorAll('[role="dialog"]')]
    const d = ds[ds.length - 1]
    if (!d) return null
    const el = [...d.querySelectorAll('*')].filter(e => (e.innerText || '').trim() === 'OAuth').pop()
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  if (openedAuth) {
    await page.mouse.click(openedAuth.x, openedAuth.y)
    await sleep(2500)
    const opciones = await page.evaluate(() => {
      const ds = [...document.querySelectorAll('[role="dialog"],[role="menu"],[role="listbox"]')]
      const d = ds[ds.length - 1]
      return [...new Set([...(d?.querySelectorAll('[role="menuitem"],[role="option"],div') || [])].map(e => (e.innerText || '').replace(/\s+/g, ' ').trim()).filter(x => x && x.length < 26))].slice(0, 10)
    })
    console.log('   autenticación:', JSON.stringify(opciones))
    // El desplegable ofrece OAuth y Bearer token. Este servidor usa Bearer: con
    // OAuth, Connect intenta redirigir a un proveedor que no existe y no pasa
    // nada. Se elige la opcion pulsandola (Escape cerraba el formulario entero).
    if (SERVER_TOKEN) {
      await clickExactText('Bearer token')
      await sleep(2500)
      const tokenInput = page.locator('[role="dialog"] input[type="password"], [role="dialog"] input:not([placeholder="https://example.com/mcp"]):not([placeholder="Example MCP Server"])').last()
      if (await tokenInput.count()) {
        await tokenInput.click({ force: true })
        await page.keyboard.type(SERVER_TOKEN, { delay: 6 })   // el token no se registra en ningun log
        console.log('   token introducido')
      } else console.log('   ⚠ no encontré el campo del token')
    } else {
      await clickExactText('OAuth')
    }
    await sleep(2000)
  }

  await clickExactText('Connect')
  for (let i = 0; i < 18; i++) {
    await sleep(5000)
    const txt = await page.evaluate(() => {
      const ds = [...document.querySelectorAll('[role="dialog"]')]
      return (ds[ds.length - 1]?.innerText || '').replace(/\s+/g, ' ')
    })
    if (/connected|conectado|\btools\b|herramientas/i.test(txt)) return { space: space.name, ok: true, detalle: txt.slice(0, 120) }
    if (/error|failed|couldn.t|no se pudo/i.test(txt)) return { space: space.name, ok: false, why: txt.slice(0, 160) }
    if (!/Custom MCP server/i.test(txt)) return { space: space.name, ok: true, detalle: 'formulario cerrado sin error' }
  }
  return { space: space.name, ok: false, why: 'sin confirmación tras 90 s' }
}

const info = await readSpaces()
console.log(`cuenta: ${info.email} · ${info.spaces.length} workspace(s)`)
for (const s of info.spaces) console.log(`  ${s.mcp ? '✓' : '·'} ${s.name} (${s.id.slice(0, 8)}) — ${s.mcp} MCP`)

const targets = arg === '--all'
  ? info.spaces.filter(s => !s.mcp)
  : info.spaces.filter(s => s.id === arg || s.id.startsWith(arg))
if (!targets.length) { console.log('\nNada que hacer.'); await browser.close(); process.exit(0) }

const results = []
for (const s of targets) results.push(await attach(s))
await browser.close()
console.log('\n--- resultado ---')
for (const r of results) console.log(`${r.ok ? '✅' : '⚠'} ${r.space}: ${r.detalle || r.why || ''}`)
