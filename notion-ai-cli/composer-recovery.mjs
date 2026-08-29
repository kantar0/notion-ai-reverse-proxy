// composer-recovery.mjs - v163
// Auto-recuperacion adaptativa del composer de Notion AI.
// Clave: Notion ignora los .click() sinteticos en los botones de chat nuevo,
// asi que aqui se usan clics reales por CDP (Input.dispatchMouseEvent).

import { execFile } from 'node:child_process'

const SEL = '[contenteditable="true"][role="textbox"], [role="textbox"][contenteditable="true"], textarea, [contenteditable="true"]'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const noop = () => {}

// Evita repetir la cadena completa en cada intento del bucle de insertPrompt.
const COOLDOWN_MS = 25000
const lastRun = new Map()

async function countInputs(cdp) {
  const expr = '(()=>{const nodes=[...document.querySelectorAll(' + JSON.stringify(SEL) + ')].filter(e=>{const r=e.getBoundingClientRect();return r.width>20&&r.height>10});return nodes.length})()'
  try { return Number(await cdp.evaluate(expr, 15000)) || 0 } catch { return 0 }
}
async function hasComposer(cdp) { return (await countInputs(cdp)) > 0 }
async function waitComposer(cdp, seconds) {
  for (let i = 0; i < seconds; i++) {
    await sleep(1000)
    if (await hasComposer(cdp)) return true
  }
  return false
}
async function currentUrl(cdp) {
  try { return String(await cdp.evaluate('location.href', 10000) || '') } catch { return '' }
}
function threadIdOf(urlText) {
  try {
    const u = new URL(urlText)
    let t = u.searchParams.get('t')
    if (!t) {
      const m = u.pathname.match(/([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[/?#]|$)/i)
      t = m ? m[1] : null
    }
    return t ? t.replace(/-/g, '') : null
  } catch { return null }
}
function canonicalOf(urlText) {
  const id = threadIdOf(urlText || '')
  return id ? 'https://' + 'app.notion.com/chat?t=' + id : null
}

async function aiDisabled(cdp) {
  try {
    const t = String(await cdp.evaluate('(document.body.innerText||"")', 10000) || '')
    return /AI is disabled for this workspace|AI est[aá] deshabilitad|AI is not enabled/i.test(t)
  } catch { return false }
}
// Sin cupo: el aviso "You've run out of free AI responses" (o el de créditos).
// Con esto no hay composicón posible en ESTE workspace: recuperarlo es inútil y
// solo cuelga la cadena de 8 pasos ~2 min; hay que ceder ya para que rote.
async function sinCupo(cdp) {
  try {
    const t = String(await cdp.evaluate('(document.body.innerText||"")', 10000) || '')
    return /run out of free AI|used your trial|AI allowance|Upgrade Notion AI|use Notion credits|cr[eé]ditos de Notion/i.test(t)
  } catch { return false }
}

async function ensureViewport(cdp) {
  let size = ''
  try { size = String(await cdp.evaluate('innerWidth+"x"+innerHeight', 10000) || '') } catch {}
  const [w, h] = size.split('x').map(n => Number(n) || 0)
  if (w >= 800 && h >= 600) return size
  await cdp.call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }).catch(noop)
  await sleep(800)
  try { return String(await cdp.evaluate('innerWidth+"x"+innerHeight', 10000) || '') } catch { return size }
}

async function clickAt(cdp, x, y) {
  await cdp.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 }).catch(noop)
  await sleep(140)
  await cdp.call('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, buttons: 1 }).catch(noop)
  await cdp.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, buttons: 0 }).catch(noop)
}

// Devuelve el centro visible de un selector, tras hacerlo visible.
async function centerOf(cdp, selectorExpr) {
  let raw = 'null'
  try { raw = String(await cdp.evaluate(selectorExpr, 15000) || 'null') } catch {}
  if (!raw || raw === 'null') return null
  try { return JSON.parse(raw) } catch { return null }
}

async function dismissBanners(cdp) {
  let closed = 0
  for (let i = 0; i < 3; i++) {
    const p = await centerOf(cdp, '(()=>{const list=[...document.querySelectorAll("[role=\'button\'],button")];const b=list.find(e=>{const l=(e.getAttribute("aria-label")||"").trim();return l==="Dismiss"||l==="Close"||l==="Cerrar"});if(!b)return "null";const r=b.getBoundingClientRect();if(r.width<8||r.height<8)return "null";return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2})})()')
    if (!p) break
    await clickAt(cdp, p.x, p.y)
    closed++
    await sleep(900)
  }
  await cdp.call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 }).catch(noop)
  await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 }).catch(noop)
  await sleep(600)
  return closed
}

// CLAVE v163: clic real sobre "Start new chat" / "New chat" / "Notion AI".
async function clickNewChatReal(cdp) {
  const expr = '(()=>{const labels=["Start new chat","New chat","Nuevo chat"];let e=null;'
    + 'for(const l of labels){e=document.querySelector(\'[aria-label="\'+l+\'"]\');if(e)break}'
    + 'if(!e)return "null";try{e.scrollIntoView({block:"center"})}catch(err){}'
    + 'const r=e.getBoundingClientRect();if(r.width<4||r.height<4)return "null";'
    + 'return JSON.stringify({x:r.x+r.width/2,y:r.y+r.height/2})})()'
  const p = await centerOf(cdp, expr)
  if (!p) return false
  await clickAt(cdp, p.x, p.y)
  await sleep(1500)
  return true
}

// Clic real en la barra inferior, por si el textbox solo se monta al enfocar.
async function clickComposerBar(cdp) {
  const p = await centerOf(cdp, '(()=>{const b=document.querySelector(\'[data-testid="unified-chat-plus-menu-button"]\')||document.querySelector(\'[data-testid="agent-send-message-button"]\');if(!b)return "null";const r=b.getBoundingClientRect();if(r.width<5)return "null";return JSON.stringify({x:r.x+r.width/2+80,y:r.y+r.height/2})})()')
  if (!p) return false
  await clickAt(cdp, p.x, p.y)
  await sleep(1200)
  return true
}

async function navigate(cdp, url) {
  if (!url) return false
  try { await cdp.call('Page.navigate', { url }, 30000); return true } catch { return false }
}

// Ultimo recurso: restaurar cookies/sesion con el bootstrap headless existente.
function runBootstrap() {
  return new Promise(resolve => {
    execFile(process.execPath, ['bootstrap-headless-session.mjs'], { cwd: 'C:/Users/nesti/notion-ai-cli', timeout: 90000 }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: String(stdout || stderr || '').slice(0, 300) })
    })
  })
}

// Tras cualquier navegacion: cerrar banners, intentar clic real de chat nuevo y esperar.
async function settleAndTry(cdp, seconds) {
  await sleep(2500)
  await dismissBanners(cdp)
  if (await hasComposer(cdp)) return true
  if (await clickNewChatReal(cdp)) {
    if (await waitComposer(cdp, Math.min(seconds, 10))) return true
  }
  return await waitComposer(cdp, seconds)
}

/**
 * Garantiza que exista un composer donde escribir.
 * Devuelve { ok, strategy, steps, url }.
 */
export async function ensureComposer(cdp, log = noop, state = {}) {
  const steps = []
  const record = (name, detail) => { steps.push(detail ? name + '(' + detail + ')' : name); log('[recovery] ' + steps[steps.length - 1]) }
  const done = strategy => ({ ok: true, strategy, steps, url: null })

  if (await hasComposer(cdp)) return { ok: true, strategy: 'ya-disponible', steps, url: null }

  // Corte rapido: si el workspace tiene la IA apagada, el composer NUNCA se monta.
  if (await aiDisabled(cdp)) {
    log('[recovery] AI deshabilitada en este workspace: no hay composer posible')
    return { ok: false, strategy: 'ai-deshabilitado', steps, url: await currentUrl(cdp) }
  }
  if (await sinCupo(cdp)) {
    log('[recovery] workspace sin cupo: cedo de inmediato para rotar (no recupero un composer que no habrá)')
    return { ok: false, strategy: 'sin-cupo', steps, url: await currentUrl(cdp) }
  }


  const key = String(cdp?.targetId || 'default')
  const last = lastRun.get(key) || 0
  if (Date.now() - last < COOLDOWN_MS) {
    log('[recovery] en enfriamiento, no repito la cadena')
    return { ok: false, strategy: 'enfriamiento', steps, url: await currentUrl(cdp) }
  }
  lastRun.set(key, Date.now())

  // 1) viewport usable (0x0 rompe rects y clics reales)
  record('viewport', await ensureViewport(cdp))
  if (await hasComposer(cdp)) return done('viewport')

  // 2) cerrar banners y overlays que tapan la barra
  record('banners', String(await dismissBanners(cdp)))
  if (await hasComposer(cdp)) return done('banners')

  // 3) clic real sobre chat nuevo (lo que fallaba con .click())
  if (await clickNewChatReal(cdp)) {
    record('clic-real-chat-nuevo')
    if (await waitComposer(cdp, 10)) return done('clic-real-chat-nuevo')
  }

  // 4) clic real en la barra del composer
  if (await clickComposerBar(cdp)) {
    record('clic-barra')
    if (await hasComposer(cdp)) return done('clic-barra')
  }

  // 5) URL canonica del thread fijado
  const canon = canonicalOf(state.selectedChatUrl || await currentUrl(cdp))
  if (canon && await navigate(cdp, canon)) {
    record('nav-canonica', canon)
    if (await settleAndTry(cdp, 18)) return done('nav-canonica')
  }

  // 6) recargar
  try { await cdp.call('Page.reload', { ignoreCache: false }, 30000); record('reload') } catch {}
  if (await settleAndTry(cdp, 18)) return done('reload')
  if (await sinCupo(cdp)) {
    log('[recovery] tras recargar aparece el aviso de sin cupo: cedo para rotar')
    return { ok: false, strategy: 'sin-cupo', steps, url: await currentUrl(cdp) }
  }

  // 7) chat nuevo limpio
  if (await navigate(cdp, 'https://' + 'app.notion.com/chat')) {
    record('nav-chat-nuevo')
    if (await settleAndTry(cdp, 20)) return done('nav-chat-nuevo')
  }

  // 8) restaurar la sesion headless (cookies + UA) y reintentar
  const boot = await runBootstrap()
  record('bootstrap-sesion', boot.ok ? 'ok' : 'fallo')
  if (await settleAndTry(cdp, 20)) return done('bootstrap-sesion')

  const url = await currentUrl(cdp)
  log('[recovery] agotado sin composer en ' + url)
  return { ok: false, strategy: 'agotado', steps, url }
}

export { hasComposer, canonicalOf }
