// engine-health — comprueba que el motor invisible ACEPTA conexiones y lo
// reinicia si no.
//
// El motor puede quedarse en un estado en el que /json/version sigue
// devolviendo 200 (por eso los vigilantes lo daban por sano) pero playwright ya
// no consigue adjuntarse: se acumulan service workers atascados y el handshake
// expira. Ahí se cuelga el CLI entero, en silencio. La única comprobación que
// vale es intentar la conexión de verdad.
//
//   node engine-health.mjs [--json]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright-core'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const CDP = process.env.CDP_URL || 'http://127.0.0.1:9223'
const PUERTO = Number((CDP.match(/:(\d+)/) || [])[1] || 9223)
const JSON_OUT = process.argv.includes('--json')
const say = (...a) => { if (!JSON_OUT) console.log(...a) }

async function conecta(timeout = 12000) {   // sano responde en ~200 ms; mas espera solo retrasa el reinicio
  try {
    const b = await chromium.connectOverCDP(CDP, { timeout })
    const paginas = b.contexts()[0]?.pages().length ?? 0
    await b.close()
    return { ok: true, paginas }
  } catch (e) { return { ok: false, error: e.message.split('\n')[0] } }
}

function reinicia() {
  // Matar SOLO el proceso que escucha el puerto del motor: nunca los navegadores
  // del usuario.
  const net = spawnSync('netstat', ['-ano'], { encoding: 'utf8', windowsHide: true })
  const linea = String(net.stdout || '').split('\n').find(l => l.includes(':' + PUERTO) && /LISTENING/i.test(l))
  const pid = linea ? Number(linea.trim().split(/\s+/).pop()) : 0
  if (pid) spawnSync('powershell', ['-NoProfile', '-Command', `Stop-Process -Id ${pid} -Force -ErrorAction SilentlyContinue`], { encoding: 'utf8', windowsHide: true })
  spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(DIR, 'start-notion-cdp.ps1')],
    { cwd: DIR, encoding: 'utf8', windowsHide: true, timeout: 180000 })
  return pid
}

let estado = await conecta()
let reiniciado = false
if (!estado.ok) {
  say('motor sin aceptar conexiones (' + estado.error + '); reiniciando')
  const pid = reinicia()
  reiniciado = true
  say('  proceso ' + (pid || '?') + ' reemplazado')
  estado = await conecta(60000)
}
try {
  const f = path.join(DIR, 'cli-state.json')
  const st = JSON.parse(fs.readFileSync(f, 'utf8'))
  st.engineHealth = { at: new Date().toISOString(), ok: estado.ok, reiniciado }
  fs.writeFileSync(f, JSON.stringify(st, null, 2))
} catch {}

if (JSON_OUT) console.log(JSON.stringify({ ...estado, reiniciado }))
else say(estado.ok ? ('motor OK' + (reiniciado ? ' (reiniciado)' : '')) : 'motor SIGUE CAÍDO: ' + estado.error)
process.exit(estado.ok ? 0 : 1)
