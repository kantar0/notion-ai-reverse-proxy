// mcp-attach — conecta el servidor MCP (PC1) a un workspace de Notion SIN pasar
// por la interfaz, para cualquier cuenta.
//
// Conectar un MCP a mano solo lo deja disponible en ese espacio: cada workspace
// nuevo nacia sin MCP y quedaba fuera de la rotacion aunque tuviera cupo. Aqui
// se replican los tres records que crea la UI:
//   1. workflow_module  (module_type mcpServer, cuelga del usuario)
//   2. external_connection (parent = el modulo; el servidor no pide auth)
//   3. el puntero al modulo en space_view.settings.agent_chat_modules
//      (space_view = ajustes del usuario PARA ese espacio; ahi es donde Notion
//       lista los MCP, no en space.settings)
//
//   node mcp-attach.mjs                 → todos los espacios sin MCP de la cuenta cargada
//   node mcp-attach.mjs <spaceId>       → solo ese espacio
//   node mcp-attach.mjs --list          → que espacios tienen MCP y cuales no
//
// La cuenta sobre la que actua es la que este cargada en el motor invisible
// (headless-session.json). Para otra cuenta, carga antes su sesion.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const TEMPLATE = path.join(DIR, 'mcp-module-template.json')
const CDP = 'http://127.0.0.1:9223'
const arg = (process.argv[2] || '').trim()
const listOnly = arg === '--list'
const target = listOnly ? '' : arg

if (!fs.existsSync(TEMPLATE)) {
  console.error(`Falta ${TEMPLATE}: la plantilla sale de un módulo MCP ya conectado.`)
  process.exit(1)
}
const template = JSON.parse(fs.readFileSync(TEMPLATE, 'utf8'))

const browser = await chromium.connectOverCDP(CDP)
const page = browser.contexts()[0].pages().find(p => /notion/i.test(p.url()))
if (!page) { console.error('No hay pestaña de Notion en el motor invisible.'); process.exit(1) }

// El fanout no responde si se pide a pelo: se captura el que emite la propia app
// al cargar, que es donde vienen los space_view con sus modulos.
const fanouts = []
page.on('response', async r => { try { if (new URL(r.url()).pathname === '/api/v3/getSpacesFanout') fanouts.push(await r.json()) } catch {} })
await page.goto('https://www.notion.so/ai', { waitUntil: 'commit', timeout: 60000 }).catch(() => {})
for (let i = 0; i < 30 && !fanouts.length; i++) await page.waitForTimeout(500)
const spaceViews = {}
for (const payload of fanouts) {
  for (const user of Object.values(payload?.users || {})) {
    for (const [id, rec] of Object.entries(user?.space_view || {})) {
      let v = rec; for (let i = 0; i < 6 && v && typeof v === 'object' && 'value' in v; i++) v = v.value
      if (v?.space_id) spaceViews[v.space_id] = { id, modules: v?.settings?.agent_chat_modules || [] }
    }
  }
}
if (!Object.keys(spaceViews).length) { console.error('No pude leer los space_view (¿sesión cargada?).'); await browser.close(); process.exit(1) }

const result = await page.evaluate(async ({ template, target, listOnly, spaceViews }) => {
  const rd = k => { try { return JSON.parse(localStorage.getItem(k) || 'null')?.value || null } catch { return null } }
  const un = x => { let v = x; for (let i = 0; i < 6 && v && typeof v === 'object' && 'value' in v; i++) v = v.value; return v || {} }
  const uuid = () => crypto.randomUUID()
  const uid = rd('LRU:KeyValueStore2:current-user-id')
  if (!uid) return { error: 'no hay sesión cargada en el motor' }

  // Espacios de la cuenta + su space_view (donde se listan los MCP).
  const views = spaceViews
  const spacesRes = await (await fetch('/api/v3/getSpaces', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: '{}' })).json()
  const root = spacesRes?.[uid] || {}
  const email = un(root.notion_user?.[uid]).email || null
  const spaces = Object.entries(root.space || {}).map(([id, rec]) => ({ id, name: un(rec).name || id.slice(0, 8) }))

  const report = spaces.map(s => ({ ...s, viewId: views[s.id]?.id || null, mcp: (views[s.id]?.modules || []).length }))
  if (listOnly) return { email, uid, spaces: report }

  const pending = report.filter(s => s.mcp === 0 && (!target || s.id === target || s.id.startsWith(target)))
  if (target && !pending.length) {
    const already = report.find(s => s.id === target || s.id.startsWith(target))
    return { email, uid, done: [], skipped: already ? [`${already.name}: ya tiene ${already.mcp} módulo(s)`] : [`spaceId ${target} no está en esta cuenta`] }
  }

  const done = [], failed = []
  for (const s of pending) {
    if (!s.viewId) { failed.push(`${s.name}: sin space_view`); continue }
    const moduleId = uuid(), connId = uuid(), now = Date.now()
    const moduleData = { ...template, id: moduleId, connectionPointer: { id: connId, table: 'external_connection', spaceId: s.id } }
    const ops = [
      { pointer: { table: 'external_connection', id: connId, spaceId: s.id }, path: [], command: 'set', args: {
          id: connId, version: 1, parent_id: moduleId, parent_table: 'workflow_module', space_id: s.id,
          created_by_id: uid, created_by_table: 'notion_user', created_time: now,
          integration_type: 'mcpServer', external_id: template.serverUrl, status: 'connected',
          scopes: ['read', 'write'], data: { serverUrl: template.serverUrl } } },
      { pointer: { table: 'workflow_module', id: moduleId, spaceId: s.id }, path: [], command: 'set', args: {
          id: moduleId, version: 1, space_id: s.id, alive: true,
          created_by_id: uid, created_by_table: 'notion_user', created_time: now,
          last_edited_by_id: uid, last_edited_by_table: 'notion_user', last_edited_time: now,
          module_type: 'mcpServer', parent_id: uid, parent_table: 'notion_user', data: moduleData } },
      { pointer: { table: 'space_view', id: s.viewId, spaceId: s.id }, path: ['settings', 'agent_chat_modules'], command: 'listAfter', args: {
          value: { pointer: { id: moduleId, table: 'workflow_module', spaceId: s.id }, defaultEnabled: true } } },
    ]
    const body = { requestId: uuid(), transactions: [{ id: uuid(), spaceId: s.id, debug: { userAction: 'mcp-attach' }, operations: ops }] }
    const r = await fetch('/api/v3/saveTransactionsFanout', { method: 'POST', credentials: 'include',
      headers: { 'content-type': 'application/json', 'x-notion-space-id': s.id, 'x-notion-active-user-header': uid }, body: JSON.stringify(body) })
    const txt = await r.text()
    if (!r.ok) { failed.push(`${s.name}: HTTP ${r.status} ${txt.slice(0, 700)}`); continue }
    done.push({ space: s.name, spaceId: s.id, moduleId })
  }
  return { email, uid, done, failed }
}, { template, target, listOnly, spaceViews })

await browser.close()
console.log(JSON.stringify(result, null, 1))
