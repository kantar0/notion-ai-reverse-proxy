import readline from 'node:readline/promises'
import process from 'node:process'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

import os from 'node:os'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const REQ_DIR = path.join(DIR, 'bridge-requests')
const RES_DIR = path.join(DIR, 'bridge-responses')
const PROGRESS_DIR = path.join(DIR, 'bridge-progress')
const LOCK_FILE = path.join(DIR, 'cli.lock.json')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
// Estado de esta terminal para quien la maneje desde fuera (el puente de
// Discord): arrancando / lista / ocupada respondiendo / cerrada. Un archivo por
// panel, porque puede haber varias sesiones de Notion AI abiertas.
const AGENT_LABEL = process.env.SHOSSO_AGENT_LABEL || ''
const STATUS_DIR = path.join(os.homedir(), '.bridgemind', 'notion-status')
const STATUS_FILE = AGENT_LABEL
  ? path.join(STATUS_DIR, AGENT_LABEL.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') + '.json')
  : null
function publishTerminalState(state, extra = {}) {
  if (!STATUS_FILE) return
  try {
    fs.mkdirSync(STATUS_DIR, { recursive: true })
    fs.writeFileSync(STATUS_FILE, JSON.stringify({ label: AGENT_LABEL, state, pid: process.pid, at: new Date().toISOString(), ...extra }, null, 2))
  } catch {}
}
const MODEL_OPTIONS = [
  'gpt-5.6',
  'opus-5',
  'claude-opus-5',
  'kimi-k3',
  'fireworks-kimi-k3',
  'orange-mousse',
  'olive-jellyroll',
  'orchid-muffin',
  'oval-kumquat-medium'
]
const COMMANDS = [
  '/ayuda','/cuenta','/quien','/conectar','/lista','/usar','/sig','/estado','/uso','/estados','/plan','/rotacion','/descubrir','/discover','/nueva-cuenta','/nuevo-workspace','/pool','/popup','/proxy','/salir',
  '/pin','/pin-current','/thread','/threads','/welcome','/st','/status','/account','/cuenta','/accounts','/cuentas','/connect-account','/conectar-cuenta','/use-account','/usar-cuenta','/next-account','/siguiente-cuenta','/ai-status','/cuota','/ai-status-all','/cuotas','/rotation-plan','/plan-rotacion','/auto-rotate','/rotacion-auto',
  '/cls','/clear-selection','/ms','/memory-show','/mr','/memory-reset','/msave','/memory-save',
  '/sp','/set-project','/cp','/clear-project','/model','/modelo','/set-model','/models','/modelos','/mode','/get-mode',
  '/clear-model','/cwd','/workspace','/cd','/help','/exit'
]
function cliCompleter(line) {
  const text = String(line || '')
  if (text.startsWith('/model ') || text.startsWith('/modelo ') || text.startsWith('/set-model ')) {
    const prefix = text.replace(/^\/(?:model|modelo|set-model)\s+/, '')
    const base = text.startsWith('/set-model ') ? '/set-model ' : text.startsWith('/modelo ') ? '/modelo ' : '/model '
    const hits = MODEL_OPTIONS.filter(m => m.toLowerCase().startsWith(prefix.toLowerCase())).map(m => base + m)
    return [hits.length ? hits : MODEL_OPTIONS.map(m => base + m), text]
  }
  if (text.startsWith('/')) {
    const hits = COMMANDS.filter(c => c.startsWith(text))
    return [hits.length ? hits : COMMANDS, text]
  }
  return [[], text]
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch { return false }
}
function bridgeRunning() {
  try {
    const lock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'))
    return !!(lock?.pid && pidAlive(lock.pid))
  } catch {
    return false
  }
}
function ensureBridgeRunning() {
  if (bridgeRunning()) return true
  try {
    process.stdout.write('\x1b[33mBridge offline; reactivando...\x1b[0m\n')
    spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(DIR,'start-bridge-daemon.ps1')],{cwd:DIR,stdio:'ignore',windowsHide:true})
    const end=Date.now()+30000
    while(Date.now()<end){ if(bridgeRunning()) return true }
  } catch {}
  return bridgeRunning()
}
async function sendRequest(payload, onProgress = null) {
  fs.mkdirSync(REQ_DIR, { recursive: true })
  fs.mkdirSync(RES_DIR, { recursive: true })
  const id = `${Date.now()}-${randomUUID()}`
  const req = { id, createdAt: new Date().toISOString(), ...payload }
  const tmpPath = path.join(REQ_DIR, `${id}.tmp`)
  const reqPath = path.join(REQ_DIR, `${id}.json`)
  const resPath = path.join(RES_DIR, `${id}.json`)
  const progressPath = path.join(PROGRESS_DIR, `${id}.jsonl`)
  let progressOffset = 0
  const drainProgress = () => {
    if(!onProgress || !fs.existsSync(progressPath)) return
    try{
      const raw=fs.readFileSync(progressPath,'utf8')
      const chunk=raw.slice(progressOffset);progressOffset=raw.length
      for(const line of chunk.split(/\n+/).filter(Boolean)){try{onProgress(JSON.parse(line))}catch{}}
    }catch{}
  }
  fs.writeFileSync(tmpPath, JSON.stringify(req, null, 2))
  fs.renameSync(tmpPath, reqPath)

  const started = Date.now()
  let warned = false
  while (true) {
    drainProgress()
    if (fs.existsSync(resPath)) {
      drainProgress()
      const raw = fs.readFileSync(resPath, 'utf8')
      try { fs.unlinkSync(resPath) } catch {}
      try { fs.unlinkSync(reqPath) } catch {}
      try { fs.unlinkSync(progressPath) } catch {}
      return JSON.parse(raw)
    }
    if (!warned && Date.now() - started > 2500) {
      warned = true
      if (!ensureBridgeRunning()) return { ok: false, error: 'Bridge offline. No pude reactivarlo.' }
    }
    if (Date.now() - started > 8 * 60 * 1000) {
      return { ok: false, error: 'Timeout de 8 minutos. La solicitud fue cancelada en el cliente.' }
    }
    await sleep(250)
  }
}

function printHelp() {
  console.log('\x1b[90mComandos simples:\x1b[0m')
  console.log('  /ayuda        ver ayuda')
  console.log('  /cuenta       ver cuenta y workspace actual')
  console.log('  /conectar     guardar el workspace actual')
  console.log('  /lista        ver cuentas y workspaces conectados')
  console.log('  /nueva-cuenta abrir login para conectar OTRA cuenta de Notion')
  console.log('  /nuevo-workspace  crear un workspace nuevo en la cuenta activa')
  console.log('  /pool             colchon de workspaces con cupo (se mantiene solo)')
  console.log('  /usar N       activar manualmente un workspace guardado')
  console.log('  /sig          rotación manual de respaldo')
  console.log('  /estado       ver estado de AI aquí')
  console.log('  /estados      revisar todos los workspaces guardados')
  console.log('  /plan         ver cuáles están listos para rotación')
  console.log('  /popup        abrir otra ventana para conectar otra cuenta')
  console.log('  /proxy        abrir panel local de CLI Proxy API')
  console.log('  /rotacion on|off')
  console.log('  /salir')
  console.log('\x1b[90mCon /rotacion on, el cambio de workspace debe ocurrir automáticamente cuando el actual se quede sin cupo. /sig queda solo como respaldo manual.\x1b[0m')
  console.log('\x1b[90mTambién siguen funcionando los aliases antiguos.\x1b[0m')
}
function printQuickStart(){
  console.log('\x1b[90mComandos rápidos: /cuenta /conectar /lista /estado /estados /plan /popup /proxy /rotacion on|off /salir\x1b[0m')
}

// Resuelve alias cortos a sus acciones
function parseCommand(line) {
  // ── Modo de transporte ──
  if (line === '/mode' || line === '/get-mode')
    return { action: 'get-mode' }
  if (line.startsWith('/mode ') || line.startsWith('/set-mode ')) {
    const val = line.replace(/^\/(?:mode|set-mode) /, '').trim()
    return { action: 'set-mode', value: val }
  }
  // ── Alias cortos ──
  if (line === '/ayuda') return { action: '__help__' }
  if (line === '/salir') return { action: '__exit__' }
  if (line === '/cuenta' || line === '/quien') return { action: 'account' }
  if (line === '/conectar') return { action: 'connect-account' }
  if (line === '/lista') return { action: 'accounts' }
  if (line.startsWith('/usar ')) return { action: 'select-account', value: line.slice(6).trim() }
  if (line === '/sig') return { action: 'next-account' }
  if (line === '/estado' || line === '/uso') return { action: 'ai-status' }
  if (line === '/estados') return { action: 'ai-status-all' }
  if (line === '/plan') return { action: 'rotation-plan' }
  if (line === '/popup') return { action: 'popup-account' }
  if (line === '/proxy') return { action: 'open-proxy-panel' }
  if (line === '/rotacion') return { action: 'get-auto-rotate' }
  if (line.startsWith('/rotacion ')) return { action: 'set-auto-rotate', value: line.slice(10).trim() }
  if (line === '/pin')                  return { action: 'pin-current' }
  if (line === '/thread' || line === '/threads') return { action: 'thread-list' }
  if (line.startsWith('/thread '))      return { action: 'thread-select', value: line.slice(8).trim() }
  if (line === '/welcome')              return { action: 'thread-select', value: 'Welcome to Notion' }
  if (line === '/st')                   return { action: 'status' }
  if (line === '/account' || line === '/cuenta') return { action: 'account' }
  if (line === '/accounts' || line === '/cuentas') return { action: 'accounts' }
  if (line === '/connect-account' || line === '/conectar-cuenta') return { action: 'connect-account' }
  if (line.startsWith('/use-account ')) return { action: 'select-account', value: line.slice(13).trim() }
  if (line.startsWith('/usar-cuenta ')) return { action: 'select-account', value: line.slice(13).trim() }
  if (line === '/next-account' || line === '/siguiente-cuenta') return { action: 'next-account' }
  if (line === '/ai-status' || line === '/cuota') return { action: 'ai-status' }
  if (line === '/ai-status-all' || line === '/cuotas') return { action: 'ai-status-all' }
  if (line === '/rotation-plan' || line === '/plan-rotacion') return { action: 'rotation-plan' }
  if (line === '/discover' || line === '/descubrir') return { action: 'discover-workspaces' }
  if (line === '/nueva-cuenta' || line === '/new-account' || line === '/add-account') return { action: 'new-account' }
  if (line === '/nuevo-workspace' || line === '/new-workspace' || line === '/nuevo-espacio') return { action: 'new-workspace' }
  if (line === '/pool' || line === '/cupo') return { action: 'pool' }
  if (line === '/auto-rotate' || line === '/rotacion-auto') return { action: 'get-auto-rotate' }
  if (line.startsWith('/auto-rotate ')) return { action: 'set-auto-rotate', value: line.slice(13).trim() }
  if (line.startsWith('/rotacion-auto ')) return { action: 'set-auto-rotate', value: line.slice(15).trim() }
  if (line === '/cls')                  return { action: 'clear-selection' }
  if (line === '/ms')                   return { action: 'memory-show' }
  if (line === '/mr')                   return { action: 'memory-reset' }
  if (line.startsWith('/msave '))       return { action: 'memory-save',  value: line.slice(7).trim() }
  if (line.startsWith('/sp '))          return { action: 'set-project',  value: line.slice(4).trim() }
  if (line === '/cp')                   return { action: 'clear-project' }
  if (line === '/cwd' || line === '/workspace') return { action: 'get-workspace' }
  if (line.startsWith('/cd '))           return { action: 'set-workspace', value: line.slice(4).trim() }
  if (line.startsWith('/workspace '))    return { action: 'set-workspace', value: line.slice(11).trim() }
  if (line.startsWith('/model '))       return { action: 'set-model', value: line.slice(7).trim() }
  if (line.startsWith('/modelo '))      return { action: 'set-model', value: line.slice(8).trim() }
  if (line === '/model' || line === '/modelo') return { action: 'model-current' }
  if (line === '/models' || line === '/modelos') return { action: 'models' }
  if (line === '/clear-model')          return { action: 'clear-model' }
  // ── Formas largas ──
  if (line === '/pin-current')          return { action: 'pin-current' }
  if (line === '/list-threads')         return { action: 'thread-list' }
  if (line === '/status')               return { action: 'status' }
  if (line === '/clear-selection')      return { action: 'clear-selection' }
  if (line === '/memory-show')          return { action: 'memory-show' }
  if (line === '/memory-reset')         return { action: 'memory-reset' }
  if (line.startsWith('/memory-save ')) return { action: 'memory-save',  value: line.slice(13).trim() }
  if (line.startsWith('/set-project ')) return { action: 'set-project',  value: line.slice(13).trim() }
  if (line === '/clear-project')        return { action: 'clear-project' }
  if (line.startsWith('/set-model '))   return { action: 'set-model',    value: line.slice(11).trim() }
  return null
}

async function main() {
  console.log('\x1b[36mNotion AI Terminal Client\x1b[0m')
  console.log('\x1b[90mUsa el bridge ya activo. No crea otra instancia.\x1b[0m')
  publishTerminalState('starting')
  // fast: el encabezado sale de lo ya guardado en disco. El status completo
  // consulta el navegador y tardaba ~30 s (mas si habia un prompt en curso).
  const startupStatus = await sendRequest({ action: 'status', fast: true })
  if (startupStatus.ok) {
    const a=startupStatus.meta?.activeAccount||{}
    const label=[a.email,a.name,a.workspace].filter(Boolean).join(' | ')||a.userId||'no identificada'
    console.log(`\x1b[32mCuenta activa: ${label}\x1b[0m`)
    if(a.workspace)console.log(`\x1b[90mWorkspace: ${a.workspace}\x1b[0m`)
    if(startupStatus.meta?.activeModel)console.log(`\x1b[35mModelo activo: ${startupStatus.meta.activeModel}\x1b[0m`)
    if(startupStatus.meta?.activeProject)console.log(`\x1b[36mProyecto: ${startupStatus.meta.activeProject}\x1b[0m`)
    if(startupStatus.meta?.activeCwd)console.log(`\x1b[90mCarpeta: ${startupStatus.meta.activeCwd}\x1b[0m`)
  } else {
    console.log('\x1b[33mCuenta activa: no disponible\x1b[0m')
  }
  printQuickStart()
  publishTerminalState('ready')
  let rl = readline.createInterface({ input: process.stdin, output: process.stdout, completer: cliCompleter })
  while (true) {
    let line = ''
    try {
      line = (await rl.question('\n\x1b[37mTú › \x1b[0m')).trim()
    } catch (error) {
      const msg = String(error?.message || error || '')
      if (/readline was closed|aborted/i.test(msg)) {
        console.log('\x1b[33mLa entrada se cerró. Intentando recuperar la consola...\x1b[0m')
        try { rl.close() } catch {}
        rl = readline.createInterface({ input: process.stdin, output: process.stdout, completer: cliCompleter })
        continue
      }
      throw error
    }
    if (!line) continue
    if (line === '/exit' || line === '/salir') break
    if (line === '/help' || line === '/ayuda') { printHelp(); continue }

    let payload
    if (line.startsWith('/')) {
      payload = parseCommand(line)
      if (!payload) {
        console.log('\x1b[33mComando desconocido. Usa /ayuda.\x1b[0m')
        continue
      }
      if (payload.action === '__help__') { printHelp(); continue }
      if (payload.action === '__exit__') break
      if (payload.action === 'models') {
        console.log('\x1b[36mModelos disponibles:\x1b[0m')
        for (const m of MODEL_OPTIONS) console.log('  ' + m)
        console.log('\x1b[90mUsa: /modelo NOMBRE o /model NOMBRE. TAB autocompleta.\x1b[0m')
        continue
      }
    } else {
      // agentLabel: etiqueta del panel de Shosso que hospeda esta terminal
      // ("Notion AI"). El daemon publica la respuesta al bus con ese from, que
      // es lo que el puente de Discord reenvia al canal de la sesion.
      payload = { action: 'prompt', prompt: line, agentLabel: process.env.SHOSSO_AGENT_LABEL || '' }
    }

    let workingTimer = null
    let workingStarted = Date.now()
    let currentProgress = null
    let lastProgressKey = ''
    let contextPrinted = false
    const frames = ['|','/','-','\\']
    let frame = 0
    const clearStatus=()=>process.stdout.write('\r\x1b[2K')
    // \r + borrar-linea solo limpia UNA linea visual: si el indicador es mas
    // ancho que la ventana hace wrap, y cada repintado deja un trozo suelto que
    // se acumula (al agrandar la ventana aparecen todos de golpe). Se recorta al
    // ancho para que ocupe siempre una sola linea.
    const draw=()=>{
      if(payload.action!=='prompt')return
      const seconds=Math.floor((Date.now()-workingStarted)/1000)
      const msg=currentProgress?.action||currentProgress?.message||'Trabajando'
      const ancho=Math.max(20,(process.stdout.columns||80)-1)
      const cola=' | '+seconds+'s'
      const cabeza=frames[frame++%frames.length]+' '
      const hueco=ancho-cabeza.length-cola.length
      const texto=msg.length>hueco?msg.slice(0,Math.max(3,hueco-1))+'…':msg
      process.stdout.write('\r\x1b[2K\x1b[33m'+cabeza+texto+cola+'\x1b[0m')
    }
    const onProgress=(event)=>{
      currentProgress=event
      const key=[event.kind,event.state,event.tool,event.action,event.detail].join('|')
      if(key===lastProgressKey)return
      lastProgressKey=key
      clearStatus()
      if(!contextPrinted){
        console.log('\x1b[90mProyecto: '+(event.project||'(sin proyecto)')+'\x1b[0m')
        console.log('\x1b[90mCarpeta:  '+(event.cwd||'(sin carpeta)')+'\x1b[0m')
        console.log('\x1b[90mModelo:   '+(event.model||'(predeterminado)')+' | Thread: '+(event.thread||'(predeterminado)')+'\x1b[0m')
        contextPrinted=true
      }
      // Do not print synthetic phases as if they were real tool calls.
      // Only verified activity events may appear as Bash/PowerShell/Read/etc.
      if(event.kind==='activity'){
        console.log('\x1b[36m> '+(event.tool||'Tool')+'('+(event.action||'')+')\x1b[0m')
        if(event.detail&&event.detail!==event.action)console.log('\x1b[90m  '+event.detail+'\x1b[0m')
      }else if(event.kind==='thought'){
        console.log('\x1b[35m[thinking] '+(event.action||event.message||'Pensando')+'\x1b[0m')
      }
      draw()
    }
    if(payload.action==='prompt'){draw();workingTimer=setInterval(draw,250);publishTerminalState('busy',{since:new Date().toISOString()})}
    let result
    try {
      result = await sendRequest(payload,onProgress)
    } finally {
      if (workingTimer) clearInterval(workingTimer)
      clearStatus()
      if (payload.action==='prompt') publishTerminalState('ready')
    }
    if (result.ok) {
      console.log(`\n\x1b[36m━━━ Notion AI ━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m\n${String(result.text || '')}\n\x1b[90m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m`)
    } else {
      console.log(`\x1b[31m${String(result.error || 'Error desconocido')}\x1b[0m`)
    }
  }
  rl.close()
  publishTerminalState('closed')
}

main().catch(error => {
  publishTerminalState('closed')
  const msg = String(error?.message || error || '')
  if (/readline was closed|aborted/i.test(msg)) {
    console.error('La consola se cerró. Vuelve a abrir el agente si hace falta.')
    process.exit(0)
  }
  console.error('Error cliente:', msg)
  process.exit(1)
})
