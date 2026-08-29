// space-bulk — crea varios workspaces con plan Free en una cuenta concreta.
//
// El cupo de Notion AI va por workspace: cada espacio nuevo del plan Free trae
// el suyo. Esto llena las cuentas secundarias de espacios utilizables para que
// la rotación tenga de dónde tirar sin depender de una sola cuenta.
//
//   node space-bulk.mjs <email> [cuantos]
//
// Notion limita el RITMO de creación (429): al primer rechazo se para y se
// devuelve lo conseguido, que es mejor que insistir en balde.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const SESSIONS = path.join(DIR, 'account-sessions')
const CDP = process.env.CDP_URL || 'http://127.0.0.1:9223'
const email = (process.argv[2] || '').trim()
const cuantos = Math.max(1, parseInt(process.argv[3] || '3', 10))
if (!email) { console.error('uso: node space-bulk.mjs <email> [cuantos]'); process.exit(1) }

const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null } }
const sesionDe = mail => {
  for (const f of fs.readdirSync(SESSIONS)) {
    const s = readJson(path.join(SESSIONS, f))
    if (s?.account?.email === mail && (s.cookies || []).some(c => c.name === 'token_v2')) return s
  }
  return null
}
const ses = sesionDe(email)
if (!ses) { console.error('sin sesión guardada para ' + email); process.exit(1) }

const browser = await chromium.connectOverCDP(CDP)
const ctx = browser.contexts()[0]
const page = ctx.pages().find(p => /notion/i.test(p.url())) || ctx.pages()[0]
const sleep = ms => page.waitForTimeout(ms)

await ctx.clearCookies()
await ctx.addCookies((ses.cookies || []).map(c => ({
  name: c.name, value: c.value,
  domain: String(c.domain || '').includes('notion') ? c.domain : '.notion.so',
  path: c.path || '/', secure: true, httpOnly: !!c.httpOnly, sameSite: 'Lax' })))

const listSpaces = () => page.evaluate(async () => {
  const rd = k => { try { return JSON.parse(localStorage.getItem(k) || 'null')?.value || null } catch { return null } }
  const un = x => { let v = x; for (let i = 0; i < 6 && v && typeof v === 'object' && 'value' in v; i++) v = v.value; return v || {} }
  const uid = rd('LRU:KeyValueStore2:current-user-id')
  const j = await (await fetch('/api/v3/getSpaces', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: '{}' })).json()
  return { uid, ids: Object.keys((j?.[uid] || {}).space || {}) }
})

// clic por texto exacto sobre el ancestro clicable (lo único que respeta esta UI)
const jsClick = (txt, sw = false) => page.evaluate(({ t, sw }) => {
  for (const d of [...document.querySelectorAll('[role="dialog"],[role="menu"]')].reverse()) {
    const c = [...d.querySelectorAll('*')].filter(e => { const s = (e.innerText || '').trim(); return sw ? s.startsWith(t) : s === t })
    if (!c.length) continue
    let el = c[c.length - 1], p = el
    for (let i = 0; i < 4 && p; i++) { const r = p.getAttribute('role'); if (r === 'menuitem' || r === 'button') { el = p; break } p = p.parentElement }
    el.click(); return true
  }
  return false
}, { t: txt, sw })
const menuTieneNuevo = () => page.evaluate(() =>
  [...document.querySelectorAll('[role="dialog"],[role="menu"]')].some(d => /New workspace|Nuevo espacio/i.test(d.innerText || '')))
const pulsarSwitcher = () => page.evaluate(() => {
  const el = [...document.querySelectorAll('[role="button"],div[tabindex],button')]
    .find(e => { const r = e.getBoundingClientRect(); return r.top < 40 && r.left < 40 && r.width > 150 && r.height > 20 })
  if (!el) return false
  el.click(); return true
})
// Medir el cupo hay que hacerlo navegando de verdad (page.goto): cambiar
// location.href dentro de un evaluate destruye el contexto y la medición
// siempre salía "sin cupo".
async function medirCupo(spaceId) {
  await page.goto(`https://app.notion.com/chat?spaceId=${spaceId}`, { waitUntil: 'commit', timeout: 60000 }).catch(() => {})
  await sleep(13000)
  return await page.evaluate(() => {
    const t = document.body.innerText || ''
    const trial = /trial'?s? monthly AI allowance|tu prueba/i.test(t)
    const free = /run out of free AI|free AI (trial|allowance)|cr[eé]ditos de Notion|podr[aá]s? usar la IA/i.test(t)
    return { cupo: document.querySelectorAll('[contenteditable="true"]').length > 0 && !trial && !free,
             plan: trial ? 'business-trial-agotado' : free ? 'free-agotado' : 'free' }
  }).catch(() => ({ cupo: false, plan: 'desconocido' }))
}

await page.goto('https://app.notion.com/chat', { waitUntil: 'commit', timeout: 60000 }).catch(() => {})
await sleep(12000)
let antes = await listSpaces()
console.log(`${email} · uid ${String(antes.uid || '').slice(0, 8)} · ${antes.ids.length} workspaces`)

const nuevos = []
for (let n = 1; n <= cuantos; n++) {
  await page.goto('https://app.notion.com/chat', { waitUntil: 'commit', timeout: 60000 }).catch(() => {})
  await sleep(9000)
  let abrio = false
  for (let i = 1; i <= 3 && !abrio; i++) {
    await pulsarSwitcher(); await sleep(3000)
    abrio = await menuTieneNuevo()
    if (!abrio) { await page.mouse.click(135, 20); await sleep(2500); abrio = await menuTieneNuevo() }
  }
  if (!abrio) { console.log('  ⚠ no se abrió el menú de workspaces'); break }
  if (!(await jsClick('New workspace'))) { console.log('  ⚠ el menú no ofrecía "New workspace"'); break }
  await sleep(12000)
  await jsClick('For work', true); await sleep(8000)
  await jsClick('Continue'); await sleep(10000)
  await jsClick('Continue'); await sleep(12000)          // plan Free
  const ahora = await listSpaces()
  const nuevo = ahora.ids.find(id => !antes.ids.includes(id))
  if (!nuevo) { console.log(`  ⚠ Notion rechazó la creación (límite de ritmo). Paro con ${nuevos.length} creados.`); break }
  const m = await medirCupo(nuevo)
  console.log(`  ✅ ${nuevo}  cupo: ${m.cupo ? 'DISPONIBLE' : 'sin cupo (' + m.plan + ')'}`)
  nuevos.push({ id: nuevo, cupo: m.cupo, plan: m.plan })
  antes = ahora
  if (n < cuantos) await sleep(20000)                    // espaciar para no chocar con el 429
}
console.log(`total nuevos: ${nuevos.length} (con cupo: ${nuevos.filter(x => x.cupo).length})`)

// El motor es el mismo que usa el panel: dejarlo con otra cuenta cargada le
// cambia la sesion al usuario a media conversacion. Se devuelve a la activa.
try {
  const st = readJson(path.join(DIR, 'cli-state.json')) || {}
  const activa = st.lastSelectedAccount?.email || st.lastActiveAccount?.email
  if (activa && activa !== email) {
    const s2 = sesionDe(activa)
    if (s2) {
      await ctx.clearCookies()
      await ctx.addCookies((s2.cookies || []).map(c => ({
        name: c.name, value: c.value,
        domain: String(c.domain || '').includes('notion') ? c.domain : '.notion.so',
        path: c.path || '/', secure: true, httpOnly: !!c.httpOnly, sameSite: 'Lax' })))
      await page.goto('https://app.notion.com/chat', { waitUntil: 'commit', timeout: 60000 }).catch(() => {})
      await sleep(8000)
      console.log('sesion restaurada: ' + activa)
    }
  }
} catch {}
await browser.close()
