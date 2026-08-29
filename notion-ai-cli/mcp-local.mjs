// mcp-local — habla con el servidor MCP del PC directamente, sin pasar por Notion.
//
// Notion bloquea desde 2026-08-28 toda herramienta de un servidor MCP propio
// ("has changed its operation type since the last admin approval"), incluso con
// servidor, workspace y herramientas recien creados: es un fallo suyo y no hay
// ajuste que lo evite. El servidor, en cambio, responde perfectamente por HTTP.
// Asi que las herramientas las ejecuta el CLI y a Notion solo le llega el
// resultado ya resuelto.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const CFG = () => JSON.parse(fs.readFileSync(path.join(DIR, 'mcp-server.json'), 'utf8'))

function endpoint(cfg) {
  // La URL puede llevar sufijos que se usaron para dar de alta el servidor en
  // Notion (?v=2, /mcp...): el endpoint real es siempre <host>/mcp.
  const base = String(cfg.url || '').replace(/\/+$/, '').replace(/\/mcp(\?.*)?$/, '')
  return base + '/mcp'
}

let sesion = null
function cabeceras(cfg) {
  const h = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }
  if (cfg.token) h.authorization = 'Bearer ' + cfg.token
  if (sesion) h['mcp-session-id'] = sesion
  return h
}
function extraer(texto) {
  // El servidor contesta en formato SSE ("event: message\ndata: {...}")
  const linea = String(texto || '').split('\n').find(l => l.startsWith('data:'))
  try { return JSON.parse(linea ? linea.slice(5).trim() : texto) } catch { return null }
}
async function rpc(cfg, method, params, timeoutMs = 120000) {
  const r = await fetch(endpoint(cfg), {
    method: 'POST', headers: cabeceras(cfg),
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const s = r.headers.get('mcp-session-id'); if (s) sesion = s
  return extraer(await r.text())
}
async function conectar(cfg) {
  if (sesion) return
  await rpc(cfg, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'notion-ai-cli', version: '1' } })
  await fetch(endpoint(cfg), { method: 'POST', headers: cabeceras(cfg), body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) }).catch(() => {})
}

/** Lista las herramientas disponibles (nombre y descripción). */
export async function listarHerramientas() {
  const cfg = CFG()
  await conectar(cfg)
  const j = await rpc(cfg, 'tools/list', {})
  return (j?.result?.tools || []).map(t => ({ name: t.name, description: t.description || '' }))
}

/** Ejecuta una herramienta y devuelve su texto. */
export async function ejecutarHerramienta(nombre, args = {}) {
  const cfg = CFG()
  await conectar(cfg)
  const j = await rpc(cfg, 'tools/call', { name: String(nombre), arguments: args || {} })
  const partes = j?.result?.content || []
  const texto = partes.map(p => p.text || '').join('\n').trim()
  if (j?.error) return { ok: false, texto: String(j.error.message || 'error del servidor MCP') }
  return { ok: !j?.result?.isError, texto: texto || '(sin salida)' }
}

export async function estaVivo() {
  try { return (await listarHerramientas()).length > 0 } catch { return false }
}

if (process.argv[1] && process.argv[1].endsWith('mcp-local.mjs')) {
  const [, , cmd, nombre, json] = process.argv
  if (cmd === 'list') console.log((await listarHerramientas()).map(t => t.name).join('\n'))
  else if (cmd === 'call') console.log(JSON.stringify(await ejecutarHerramienta(nombre, JSON.parse(json || '{}')), null, 1))
  else console.log('uso: node mcp-local.mjs list | call <herramienta> \'<json>\'')
}
