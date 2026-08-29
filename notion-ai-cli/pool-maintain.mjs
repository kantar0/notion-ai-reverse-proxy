// pool-maintain — mantiene solo un colchón de workspaces CON cupo.
//
// Cierra el ciclo entero sin que nadie lance nada a mano:
//   medir cupo por espacio → crear los que falten (plan Free, por onboarding)
//   → conectar el MCP → poner sus permisos en automático → sincronizar el
//   registro de rotación → devolver la sesión que estaba activa.
//
// El cupo de Notion AI va por workspace y el aviso de agotado no significa lo
// mismo según el plan: si lo agotado es el trial de Business, esa cuenta sigue
// pudiendo estrenar espacios Free con cupo propio. Por eso se mide espacio por
// espacio y nunca se descarta una cuenta entera.
//
//   node pool-maintain.mjs [--minimo N] [--json]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { chromium } from 'playwright-core'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const SESSIONS = path.join(DIR, 'account-sessions')
const STATE = path.join(DIR, 'cli-state.json')
const CDP = process.env.CDP_URL || 'http://127.0.0.1:9223'
const arg = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null }
// El colchon se configura en cli-state (poolMinimo): con 3 el pool se secaba a
// las pocas peticiones, porque cada una consume una respuesta de un workspace.
function minimoDelEstado(){
  try{ return parseInt(JSON.parse(fs.readFileSync(path.join(DIR,'cli-state.json'),'utf8')).poolMinimo,10)||0 }catch{ return 0 }
}
const MINIMO = parseInt(arg('--minimo') || process.env.POOL_MINIMO || '', 10) || minimoDelEstado() || 12
const JSON_OUT = process.argv.includes('--json')
const say = (...a) => { if (!JSON_OUT) console.log(...a) }

const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null } }
// Notion cambia la ruta del chat entre despliegues (/ai vs /chat) y con la
// equivocada la pagina pierde el spaceId y se queda sin composer: todo saldria
// "sin cupo". El daemon guarda la que funciona en cli-state.chatRoute.
const RUTA = (readJson(path.join(path.dirname(fileURLToPath(import.meta.url)), 'cli-state.json')) || {}).chatRoute || '/ai'
const urlEspacio = id => 'https://app.notion.com' + RUTA + (id ? '?spaceId=' + id : '')
const writeState = patch => { const st = readJson(STATE) || {}; fs.writeFileSync(STATE, JSON.stringify({ ...st, ...patch }, null, 2)) }

// Una petición en curso usa el mismo motor: entrar ahora le robaría la pestaña.
// El marcador lo deja el daemon en bridge-requests/, no en la raiz (mirar la
// raiz no encontraba nada y el mantenimiento se metia en medio).
const REQ_DIR = path.join(DIR, 'bridge-requests')
if (fs.existsSync(REQ_DIR) && fs.readdirSync(REQ_DIR).some(f => f.endsWith('.working.json'))) {
  say('hay una petición en curso; no toco el motor')
  if (JSON_OUT) console.log(JSON.stringify({ skipped: 'busy' }))
  process.exit(0)
}

const cuentas = []
for (const f of fs.existsSync(SESSIONS) ? fs.readdirSync(SESSIONS) : []) {
  const s = readJson(path.join(SESSIONS, f))
  const email = s?.account?.email
  if (!email || !(s.cookies || []).some(c => c.name === 'token_v2')) continue
  if (!cuentas.some(c => c.email === email)) cuentas.push({ email, ses: s })
}
if (!cuentas.length) { say('sin sesiones guardadas'); process.exit(0) }

// Conectar puede expirar si el motor está ocupado (una provisión cerrando, un
// service worker arrancando). Se reintenta en vez de morir: esto corre solo.
async function conectar() {
  let ultimo
  for (let i = 1; i <= 3; i++) {
    try { return await chromium.connectOverCDP(CDP, { timeout: 60000 }) }
    catch (e) {
      ultimo = e
      // El motor puede seguir respondiendo por HTTP y aun asi no dejar que
      // nadie se adjunte; engine-health lo comprueba de verdad y lo reinicia.
      say('  motor sin aceptar conexiones, reviso salud (' + i + ')')
      spawnSync(process.execPath, [path.join(DIR, 'engine-health.mjs'), '--json'],
        { cwd: DIR, encoding: 'utf8', windowsHide: true, timeout: 300000 })
    }
  }
  throw ultimo
}
const browser = await conectar()
const ctx = browser.contexts()[0]
const page = ctx.pages().find(p => /notion/i.test(p.url())) || ctx.pages()[0]
const sleep = ms => page.waitForTimeout(ms)

const cargar = async ses => {
  await ctx.clearCookies()
  await ctx.addCookies((ses.cookies || []).map(c => ({
    name: c.name, value: c.value,
    domain: String(c.domain || '').includes('notion') ? c.domain : '.notion.so',
    path: c.path || '/', secure: true, httpOnly: !!c.httpOnly, sameSite: 'Lax' })))
  await page.goto(urlEspacio(), { waitUntil: 'commit', timeout: 60000 }).catch(() => {})
  await sleep(9000)
}
const listSpaces = () => page.evaluate(async () => {
  const rd = k => { try { return JSON.parse(localStorage.getItem(k) || 'null')?.value || null } catch { return null } }
  const un = x => { let v = x; for (let i = 0; i < 6 && v && typeof v === 'object' && 'value' in v; i++) v = v.value; return v || {} }
  const uid = rd('LRU:KeyValueStore2:current-user-id')
  const j = await (await fetch('/api/v3/getSpaces', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: '{}' })).json()
  return { uid, spaces: Object.entries((j?.[uid] || {}).space || {}).map(([id, r]) => ({ id, name: un(r).name || id.slice(0, 8) })) }
}).catch(() => ({ uid: null, spaces: [] }))

// Medir es navegar de verdad: cambiar location.href dentro de un evaluate
// destruye el contexto y todo sale "sin cupo".
async function medir(spaceId) {
  await page.goto(urlEspacio(spaceId), { waitUntil: 'commit', timeout: 60000 }).catch(() => {})
  // Espera activa en vez de 12 s fijos: en cuanto aparece el composer (o el
  // aviso de agotado) ya se sabe la respuesta, y eso suele tardar 2-4 s. Medir
  // 20 espacios pasa de 4 minutos a menos de uno.
  for (let i = 0; i < 30; i++) {
    const listo = await page.evaluate(() => {
      const t = document.body.innerText || ''
      return document.querySelectorAll('[contenteditable="true"]').length > 0 ||
        /AI allowance|run out of free AI|cr[eé]ditos de Notion|AI is disabled for this workspace|Start new chat/i.test(t)
    }).catch(() => false)
    if (listo) break
    await sleep(500)
  }
  const base = await page.evaluate(() => {
    const t = document.body.innerText || ''
    const trial = /trial.?s? monthly AI allowance|tu (per[ií]odo de )?prueba/i.test(t)
    const free = /run out of free AI|free AI (trial|allowance)|cr[eé]ditos de Notion|podr[aá]s? usar la IA/i.test(t)
    const off = /AI is disabled for this workspace|IA (esta|está) deshabilitada/i.test(t)
    const composer = document.querySelectorAll('[contenteditable="true"]').length > 0
    return { composer, trial, free, off }
  }).catch(() => ({ composer: false, trial: false, free: false, off: false }))
  if (base.off) return { cupo: false, plan: 'ai-desactivada' }
  if (base.trial) return { cupo: false, plan: 'business-trial' }
  if (base.free) return { cupo: false, plan: 'free-agotado' }
  if (!base.composer) return { cupo: false, plan: 'sin-composer' }
  // Un espacio agotado TAMBIEN pinta el composer, asi que verlo no prueba nada:
  // asi se contaban como buenos espacios secos. La prueba real es escribir (sin
  // enviar) y ver si el boton de enviar se habilita; no gasta ninguna respuesta.
  // OJO: tiene que escribirse por CDP. El editor de Notion ignora execCommand,
  // asi que con el no se escribia NADA y todos los espacios salian agotados.
  const caja = await page.evaluate(() => {
    const c = [...document.querySelectorAll('[contenteditable="true"][role="textbox"], [contenteditable="true"]')].pop()
    if (!c) return null
    const r = c.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  }).catch(() => null)
  if (!caja) return { cupo: false, plan: 'sin-composer' }
  if (!cdpPagina) cdpPagina = await ctx.newCDPSession(page)
  for (const st of [{ type: 'mouseMoved', button: 'none', buttons: 0, clickCount: 0 },
                    { type: 'mousePressed', button: 'left', buttons: 1, clickCount: 1 },
                    { type: 'mouseReleased', button: 'left', buttons: 0, clickCount: 1 }])
    await cdpPagina.send('Input.dispatchMouseEvent', { x: caja.x, y: caja.y, ...st }).catch(() => {})
  await cdpPagina.send('Input.insertText', { text: 'x' }).catch(() => {})
  await sleep(1500)
  const vivo = await page.evaluate(() => {
    const c = [...document.querySelectorAll('[contenteditable="true"]')].pop()
    const escrito = ((c && c.innerText) || '').trim().length > 0
    const b = document.querySelector('[data-testid="agent-send-message-button"],[aria-label="Submit AI message"]')
    const activo = !!b && !(b.disabled || b.getAttribute('aria-disabled') === 'true')
    // Sin texto escrito la prueba no vale: se avisa para no dar por agotado algo
    // que si tiene cupo.
    return escrito ? activo : null
  }).catch(() => null)
  // Dejar el composer limpio: nada de basura en el chat del usuario.
  for (let i = 0; i < 3; i++)
    await cdpPagina.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 }).catch(() => {})
  if (vivo === null) return { cupo: true, plan: 'free-sin-medir' }   // ante la duda, NO tachar
  return { cupo: vivo, plan: vivo ? 'free' : 'free-agotado' }
}

// Igual que el conmutador: el click() del DOM no dispara nada en los menus de
// Notion. Se localiza la caja del elemento VISIBLE y se pulsa por CDP.
async function jsClick(txt, sw = false) {
  const caja = await page.evaluate(({ t, sw }) => {
    const dentro = []
    for (const d of [...document.querySelectorAll('[role="dialog"],[role="menu"],.notion-overlay-container')].reverse())
      dentro.push(...d.querySelectorAll('*'))
    const todos = dentro.length ? dentro : [...document.querySelectorAll('div,button,span,a')]
    const c = todos.filter(e => {
      const s = (e.innerText || e.textContent || '').trim()
      if (!(sw ? s.startsWith(t) : s.toLowerCase() === t.toLowerCase())) return false
      const r = e.getBoundingClientRect()
      return r.width > 10 && r.height > 8 && r.top >= 0 && r.bottom <= innerHeight
    })
    if (!c.length) return null
    c.sort((a, b) => { const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); return ra.width * ra.height - rb.width * rb.height })
    const r = c[0].getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  }, { t: txt, sw })
  if (!caja) return false
  if (!cdpPagina) cdpPagina = await ctx.newCDPSession(page)
  for (const st of [{ type: 'mouseMoved', button: 'none', buttons: 0, clickCount: 0 },
                    { type: 'mousePressed', button: 'left', buttons: 1, clickCount: 1 },
                    { type: 'mouseReleased', button: 'left', buttons: 0, clickCount: 1 }])
    await cdpPagina.send('Input.dispatchMouseEvent', { x: caja.x, y: caja.y, ...st })
  return true
}
const menuTieneNuevo = () => page.evaluate(() =>
  [...document.querySelectorAll('[role="dialog"],[role="menu"]')].some(d => /New workspace|Nuevo espacio/i.test(d.innerText || '')))
// El conmutador de espacios NO se abre con click(): Notion solo reacciona a
// eventos de confianza, que unicamente llegan por CDP.
let cdpPagina = null
async function pulsarSwitcher() {
  const caja = await page.evaluate(() => {
    const el = [...document.querySelectorAll('div[role="button"],[role="button"],div[tabindex],button')]
      .find(e => { const r = e.getBoundingClientRect(); return r.top < 45 && r.left < 40 && r.width > 150 && r.height > 20 })
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
  })
  if (!caja) return false
  if (!cdpPagina) cdpPagina = await ctx.newCDPSession(page)
  for (const st of [{ type: 'mouseMoved', button: 'none', buttons: 0, clickCount: 0 },
                    { type: 'mousePressed', button: 'left', buttons: 1, clickCount: 1 },
                    { type: 'mouseReleased', button: 'left', buttons: 0, clickCount: 1 }])
    await cdpPagina.send('Input.dispatchMouseEvent', { x: caja.x, y: caja.y, ...st })
  return true
}
// El menu lista TODOS los espacios de la cuenta y "New workspace" queda al
// final, fuera de la vista: sin bajar el scroll el texto existe en el DOM pero
// no hay nada que pulsar.
const bajarMenu = () => page.evaluate(() => {
  for (const ov of document.querySelectorAll('[role="dialog"],[role="menu"],.notion-overlay-container'))
    for (const e of [ov, ...ov.querySelectorAll('*')])
      if (e.scrollHeight > e.clientHeight + 20) e.scrollTop = e.scrollHeight
})

async function crearUno(previos) {
  await page.goto(urlEspacio(), { waitUntil: 'commit', timeout: 60000 }).catch(() => {})
  await sleep(9000)
  let abrio = false
  for (let i = 1; i <= 3 && !abrio; i++) {
    await pulsarSwitcher(); await sleep(3500)
    await bajarMenu(); await sleep(1200)
    abrio = await menuTieneNuevo()
    if (!abrio) { await page.mouse.click(135, 20); await sleep(2500); abrio = await menuTieneNuevo() }
  }
  if (!abrio || !(await jsClick('New workspace'))) return null
  await sleep(12000)
  await jsClick('For work', true); await sleep(8000)
  await jsClick('Continue'); await sleep(10000)
  await jsClick('Continue'); await sleep(12000)          // plan Free
  const ahora = await listSpaces()
  const nuevo = ahora.spaces.find(s => !previos.includes(s.id))
  return nuevo ? nuevo.id : null
}

// El 429 de Notion es por cuenta y de ritmo: se anota por email para no gastar
// minutos reintentando en la que está cortada mientras otras sí pueden crear.
const st0 = readJson(STATE) || {}
const bloqueo = { ...(st0.spaceCreateBlockedBy || {}) }
const activa = (st0.lastSelectedAccount && st0.lastSelectedAccount.email) || (st0.lastActiveAccount && st0.lastActiveAccount.email) || null

// Empezar por la cuenta activa: es la que va a usar el panel ahora mismo.
cuentas.sort((a, b) => (a.email === activa ? -1 : 0) - (b.email === activa ? -1 : 0))
// Los agotados recientes se dan por agotados sin volver a abrirlos: cada
// medición cuesta ~12s y reprobarlos era lo que hacía esto eterno.
const agotados = st0.quotaExhausted || {}
const agotadoReciente = key => {
  const v = agotados[key]
  const t = typeof v === 'number' ? v : (v && v.t)
  return !!t && Date.now() - t < 60 * 60 * 1000
}

let conCupo = 0
const detalle = []
const creados = []
const tocadas = new Set()

const TODOS = process.argv.includes('--todos')          // mapa completo: nadie tropieza luego con un espacio sin medir
const SOLO_MEDIR = process.argv.includes('--solo-medir')  // levantar el mapa sin crear nada
for (const c of cuentas) {
  if (!TODOS && conCupo >= MINIMO) break
  await cargar(c.ses)
  const info = await listSpaces()
  if (!info.uid) { detalle.push({ email: c.email, error: 'sesión caducada' }); continue }
  for (const s of info.spaces) {
    if (!TODOS && conCupo >= MINIMO) break
    if (!TODOS && agotadoReciente(info.uid + '::' + s.id)) { detalle.push({ email: c.email, uid: info.uid, spaceId: s.id, cupo: false, plan: 'agotado (recordado)' }); continue }
    const m = await medir(s.id)
    say('  ' + s.id.slice(0, 8) + '  ' + (m.cupo ? 'CON CUPO' : 'descartado (' + m.plan + ')') + '  ' + s.name.slice(0, 28))
    detalle.push({ email: c.email, uid: info.uid, spaceId: s.id, ...m })
    if (m.cupo) conCupo++
  }
  // Faltan: crear aquí mismo mientras esta cuenta no esté cortada por ritmo.
  while (!SOLO_MEDIR && conCupo < MINIMO && !(bloqueo[c.email] > Date.now())) {
    const previos = (await listSpaces()).spaces.map(x => x.id)
    const nuevo = await crearUno(previos)
    if (!nuevo) {
      // Antes se daba por hecho que era el 429 de ritmo y se apartaba la cuenta
      // una hora. Puede ser eso... o que el flujo de alta de Notion haya
      // cambiado y el menu ni se abra, que es un fallo NUESTRO y no se arregla
      // esperando. Se distingue: si la sesion sigue viva, no es ritmo.
      const viva = !!(await listSpaces()).uid
      bloqueo[c.email] = Date.now() + (viva ? 10 : 60) * 60 * 1000
      say('  ' + c.email + (viva
        ? ': no pude abrir el alta de workspace (la interfaz de Notion no responde al menú); reintento en 10min'
        : ': sesión caducada, hay que volver a iniciarla; reintento en 1h'))
      break
    }
    const m = await medir(nuevo)
    say('  ' + c.email + ': creado ' + nuevo.slice(0, 8) + ' · ' + (m.cupo ? 'con cupo' : 'sin cupo (' + m.plan + ')'))
    creados.push({ email: c.email, spaceId: nuevo, ...m })
    tocadas.add(c.email)
    if (m.cupo) conCupo++
  }
}

// Devolver el motor a la cuenta que estaba activa: es el mismo navegador que
// usa el panel, y dejarlo en otra cuenta le cambia la sesión al usuario a mitad
// de conversación.
if (activa) {
  const vuelta = cuentas.find(c => c.email === activa)
  if (vuelta) { await cargar(vuelta.ses); say('sesión restaurada: ' + activa) }
}
await browser.close()

// Provisionar lo creado: sin MCP y sin permisos automáticos un workspace nuevo
// no sirve para nada (la rotación lo ignora y cada comando pide "Allow").
for (const email of tocadas) {
  const r = spawnSync(process.execPath, [path.join(DIR, 'mcp-provision-all.mjs'), email],
    { cwd: DIR, encoding: 'utf8', windowsHide: true, timeout: 1800000 })
  const linea = String(r.stdout || '').match(/registro final: .*/)
  say('  provisionado ' + email + ': ' + (linea ? linea[0] : 'sin registro'))
}

// Compartir lo medido con el daemon: usan el mismo `quotaExhausted`, así la
// rotación no vuelve a probar espacios que acabo de ver secos, y guarda el plan
// para no confundir un trial de Business agotado con la cuenta entera sin cupo.
const memoria = { ...agotados }
for (const d of detalle) {
  if (!d.spaceId || !d.uid) continue
  const key = d.uid + '::' + d.spaceId
  if (d.cupo) delete memoria[key]
  else if (d.plan === 'business-trial' || d.plan === 'free-agotado' || d.plan === 'ai-desactivada') memoria[key] = { t: Date.now(), plan: d.plan === 'business-trial' ? 'business-trial' : d.plan === 'ai-desactivada' ? 'ai-desactivada' : 'free' }
}
writeState({ quotaExhausted: memoria, spaceCreateBlockedBy: bloqueo, conCupoIds: detalle.filter(x => x && x.cupo && x.spaceId).map(x => x.spaceId), poolStatus: { at: new Date().toISOString(), conCupo, minimo: MINIMO, creados: creados.length } })
const salida = { conCupo, minimo: MINIMO, creados, detalle, sesionActiva: activa }
if (JSON_OUT) console.log(JSON.stringify(salida))
else say('pool: ' + conCupo + '/' + MINIMO + ' con cupo · ' + creados.length + ' creado(s)')
