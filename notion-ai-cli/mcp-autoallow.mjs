// mcp-autoallow — pone las herramientas de escritura del MCP en "Run
// automatically" en todos los workspaces de la cuenta cargada.
//
// Por defecto Notion deja las write tools en "Always ask": cada comando abre un
// "Do you want to continue? Reject / Allow" y, si nadie lo pulsa, la respuesta
// se queda a medias para siempre (desde Discord ni se ve el aviso). Con esto el
// MCP ejecuta sin preguntar, que es lo que necesita un CLI desatendido.
//
//   node mcp-autoallow.mjs             todos los workspaces de la cuenta
//   node mcp-autoallow.mjs <spaceId>   solo ese
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const CDP = process.env.CDP_URL || 'http://127.0.0.1:9223'
// El nombre del servidor sale de mcp-server.json: estaba escrito 'PC1' a mano y
// al renombrarlo dejaba de encontrarlo (decia "ya estaba en automatico" sin
// haber mirado siquiera el servidor correcto).
const NOMBRE = (() => { try { return JSON.parse(fs.readFileSync(path.join(DIR,'mcp-server.json'),'utf8')).name || 'PC1' } catch { return 'PC1' } })()

const target = (process.argv[2] || '').trim()

const browser = await chromium.connectOverCDP(CDP)
const page = browser.contexts()[0].pages().find(p => /notion/i.test(p.url()))
const sleep = ms => page.waitForTimeout(ms)

/** Clic por texto exacto sobre el ancestro clicable (lo que funciona en esta UI). */
const clic = (txt) => page.evaluate((t) => {
  const ds = [...document.querySelectorAll('[role="dialog"],[role="menu"],[role="listbox"]')]
  for (const d of ds.reverse()) {
    const c = [...d.querySelectorAll('*')].filter(e => (e.innerText || '').trim() === t)
    if (!c.length) continue
    let el = c[c.length - 1], p = el
    for (let i = 0; i < 4 && p; i++) { const r = p.getAttribute('role'); if (r === 'menuitem' || r === 'button' || r === 'option') { el = p; break } p = p.parentElement }
    el.click(); return true
  }
  return false
}, txt)
const panel = () => page.evaluate(() => ((([...document.querySelectorAll('[role="dialog"]')].pop() || {}).innerText) || '').replace(/\s+/g, ' '))

const spaces = await page.evaluate(async () => {
  const rd = k => { try { return JSON.parse(localStorage.getItem(k) || 'null')?.value || null } catch { return null } }
  const un = x => { let v = x; for (let i = 0; i < 6 && v && typeof v === 'object' && 'value' in v; i++) v = v.value; return v || {} }
  const uid = rd('LRU:KeyValueStore2:current-user-id')
  const j = await (await fetch('/api/v3/getSpaces', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: '{}' })).json()
  return Object.entries((j?.[uid] || {}).space || {}).map(([id, rec]) => ({ id, name: un(rec).name || id.slice(0, 8) }))
})

const lista = target ? spaces.filter(s => s.id === target || s.id.startsWith(target)) : spaces
console.log(`${lista.length} workspace(s) a revisar`)

for (const s of lista) {
  await page.goto(`https://app.notion.com/chat?spaceId=${s.id}`, { waitUntil: 'commit', timeout: 60000 }).catch(() => {})
  await sleep(11000)
  const gear = page.locator('[aria-label="Settings"]').first()
  if (!(await gear.count())) { console.log(`  ⚠ ${s.id.slice(0, 8)}: sin panel de chat`); continue }
  await gear.click({ force: true }).catch(() => {})
  await sleep(3500)
  if (!(await clic('MCP servers'))) { console.log(`  ⚠ ${s.id.slice(0, 8)}: sin sección MCP`); continue }
  await sleep(3500)

  // abrir el servidor propio; el nombre sale de mcp-server.json (estaba fijo a
  // 'PC1' y al renombrarlo dejaba de encontrarlo, diciendo que ya estaba bien)
  const abierto = await page.evaluate((nombre) => {
    const d = [...document.querySelectorAll('[role="dialog"]')].pop()
    if (!d) return false
    const el = [...d.querySelectorAll('*')].filter(e => (e.innerText || '').trim().split('\n')[0].startsWith(nombre)).pop()
    if (!el) return false
    let p = el; for (let i = 0; i < 4 && p; i++) { const r = p.getAttribute('role'); if (r === 'button' || r === 'menuitem') break; p = p.parentElement }
    ;(p || el).click(); return true
  }, NOMBRE)
  if (!abierto) { console.log(`  ⚠ ${s.id.slice(0, 8)}: sin servidor MCP conectado`); continue }
  await sleep(3500)

  const antes = await panel()
  if (!/Always ask/i.test(antes)) { console.log(`  ✓ ${s.id.slice(0, 8)}: ya estaba en automático`); continue }
  await clic('Always ask'); await sleep(2500)
  await clic('Run automatically'); await sleep(3000)
  const despues = await panel()
  console.log(`  ${/Always ask/i.test(despues) ? '⚠' : '✅'} ${s.id.slice(0, 8)}: ${/Always ask/i.test(despues) ? 'sigue preguntando' : 'write tools en automático'}`)
}
await browser.close()
