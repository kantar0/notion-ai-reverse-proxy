import readline from 'node:readline/promises'
import process from 'node:process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync, spawn } from 'node:child_process'
import { listarHerramientas, ejecutarHerramienta } from './mcp-local.mjs'
import { extractImagePaths, extractImagePathsFromPrompt, attachImagesToComposer, clearComposerAttachments } from './image-attach.mjs'
import { ensureComposer } from './composer-recovery.mjs'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const LOCK_FILE = path.join(DIR, 'cli.lock.json')
const STATE_FILE = path.join(DIR, 'cli-state.json')
const MEMORY_FILE = path.join(DIR, 'terminal-memory.md')
const TRANSCRIPT_FILE = path.join(DIR, 'terminal-thread.md')
const REQ_DIR = path.join(DIR, 'bridge-requests')
const RES_DIR = path.join(DIR, 'bridge-responses')
const PROGRESS_DIR = path.join(DIR, 'bridge-progress')
const BUS_FILE = path.join(os.homedir(), '.bridgemind', 'messages.jsonl')
const LOG_FILE = path.join(DIR, 'bridge.log')
const DEBUG_RAW_FILE = path.join(DIR, 'last-hidden-raw.txt')
const ACCOUNTS_FILE = path.join(DIR, 'cli-accounts.json')
const HEADLESS_SESSION_FILE = path.join(DIR, 'headless-session.json')
const RESTORE_STATUS_FILE = path.join(DIR, 'restore-status.json')
const ACCOUNT_SESSION_DIR = path.join(DIR, 'account-sessions')
const POPUP_PROFILES_DIR = path.join(DIR, 'notion-popup-profiles')
const POPUP_STATE_FILE = path.join(DIR, 'popup-account-state.json')
const POPUP_CDP_HTTP = 'http://127.0.0.1:9224'
const PROXY_PANEL_URL = 'http://127.0.0.1:8317/management.html'
const CDP_HTTP = 'http://127.0.0.1:9223'
const VERSION = '13.2'
const MCP_REGISTRY_FILE = path.join(DIR, 'mcp-workspace-registry.json')
const MCP_REGISTRY_SYNC_SCRIPT = path.join(DIR, 'mcp-registry-sync.mjs')
const MCP_REGISTRY_TTL_MS = 60_000
const CANONICAL_MCP_ORIGIN = (process.env.MCP_ORIGIN || 'https://TU-SERVIDOR-MCP.example.com')   // URL de TU servidor MCP (mcp-server.json / MCP_ORIGIN)
const MCP_ENSURE_SCRIPT = path.join(DIR, 'ensure-mcp-connection.mjs')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const DEFAULT_MODE = 'hidden'
const MODEL_DEFINITIONS = [
  { id:'gpt-5.6', label:'GPT-5.6', aliases:['gpt-5.6','gpt 5.6','gpt56'] },
  { id:'claude-opus-5', label:'Opus 5', aliases:['claude-opus-5','opus-5','opus 5','opus5'] },
  { id:'fireworks-kimi-k3', label:'Kimi K3', aliases:['fireworks-kimi-k3','kimi-k3','kimi k3','kimik3'] },
  { id:'orange-mousse', label:'Orange Mousse', aliases:['orange-mousse','orange mousse'] },
  { id:'olive-jellyroll', label:'Olive Jellyroll', aliases:['olive-jellyroll','olive jellyroll'] },
  { id:'orchid-muffin', label:'Orchid Muffin', aliases:['orchid-muffin','orchid muffin'] },
  { id:'oval-kumquat-medium', label:'Oval Kumquat Medium', aliases:['oval-kumquat-medium','oval kumquat medium'] }
]
function normalizeModelInput(value){return String(value||'').trim().toLowerCase().replace(/[_]+/g,'-').replace(/\s+/g,' ')}
function resolveModel(value){
  const key=normalizeModelInput(value)
  return MODEL_DEFINITIONS.find(m=>m.aliases.some(a=>normalizeModelInput(a)===key))||null
}
function modelListText(){return MODEL_DEFINITIONS.map(m=>`- ${m.label}: ${m.id}`).join('\n')}

const INPUT_SEL = '[contenteditable="true"][role="textbox"]'
const BUSY_SEL = '[data-testid="agent-stop-inference-button"]'
const USER_SEL = '[data-agent-chat-user-step-id]'
const COPY_LABELS = ['Copy response', 'Copiar respuesta']
const COPY_SEL = COPY_LABELS.map(l => `[aria-label="${l}"]`).join(',')

// Prompt del modo MCP: ahi Notion SI puede llamar a las herramientas, y todo
// (razonar + herramientas + respuesta) ocurre en UN SOLO turno, que es lo que
// gasta una sola respuesta del cupo. Nada de lineas EJECUTAR: eso parte la
// conversacion en varias peticiones y multiplica el gasto.
const PREFIJO_MCP = `MODO CLI SHOSSO. Respondes en una terminal: español, texto plano, breve.
Tienes conectadas las herramientas de este PC (empiezan por sh_): sh_run_command, sh_list_files,
sh_read_text_file, sh_write_text_file, sh_search_files, sh_start_background_command y las demás.
ÚSALAS TÚ MISMO para resolver lo que te pidan, en este mismo turno, y luego contesta con el
resultado. Encadena las que hagan falta sin pedir permiso ni preguntar antes.
sh_run_command acepta cualquier comando de Windows: 'start <programa>' abre, 'taskkill /IM <exe> /F'
cierra, y con powershell -NoProfile -Command puedes consultar lo que sea del equipo (ventanas y sus
títulos, procesos, discos, red, servicios). Si algo no sale, prueba otra vía antes de rendirte.
No escribas líneas EJECUTAR: aquí las herramientas las llamas tú.
No crees páginas ni artefactos de Notion salvo que te lo pidan.
Rutas relativas a la carpeta del usuario ('~/Desktop').`

const BASE_PREFIX = `Eres un TRADUCTOR de peticiones a comandos de Windows.
NO ejecutas nada ni controlas ningún equipo: solo escribes la línea de comando que resolvería la petición.
Un programa externo la ejecuta después y te devuelve el RESULTADO; tú solo traduces.
Responde SOLO con una línea con esta forma, con el comando real en el sitio del texto en mayúsculas:
EJECUTAR {"tool":"run_command","args":{"command":"EL_COMANDO_QUE_TOCA"}}

CÓMO AVERIGUAR LO QUE TE PIDEN
PowerShell puede consultar CUALQUIER cosa del equipo, no solo abrir programas. Si te piden saber
algo (qué hay abierto, qué pestaña se está viendo, cuánta memoria queda, qué archivos hay, qué
está sonando...), escribe la consulta de PowerShell que lo saque y te devolverán su salida:
  powershell -NoProfile -Command "..."
Ideas de por dónde tirar, según lo que te pidan:
  · ventanas y pestañas abiertas   Get-Process con MainWindowTitle (el título dice la pestaña activa)
  · programas en marcha            Get-Process, Get-CimInstance Win32_Process
  · hardware, disco, memoria       Get-CimInstance, Get-Volume, Get-ComputerInfo
  · archivos y carpetas            Get-ChildItem (o las herramientas list_files / search_files)
  · red, servicios, tareas         Get-NetTCPConnection, Get-Service, Get-ScheduledTask
Si una consulta no basta, pide OTRA con lo que hayas aprendido: puedes encadenar varios pasos.

Otras herramientas, con la misma línea EJECUTAR cambiando "tool" y "args":
  list_files{path}, read_text_file{path}, write_text_file{path,content}, search_files{path,query}
Rutas relativas a la carpeta del usuario ('~/Desktop'). Comillas SIMPLES dentro del comando, nunca dobles.
NUNCA escribas el signo del dólar en el comando (ni variables ni el elemento actual de la tubería):
este chat lo convierte en fórmula y el comando llega roto. Se puede evitar siempre:
  Where-Object MainWindowTitle -ne ''      en lugar de la forma con llaves y el elemento actual
  Sort-Object -Property Nombre             y Select-Object -Property, -First, -ExpandProperty
Escribe la línea EJECUTAR UNA sola vez y solo para lo que te acaban de pedir.
Cuando te devuelvan el RESULTADO, responde al usuario en una frase corta, en español.
Si lo que te dicen NO necesita el equipo (un saludo, una charla, una pregunta general),
contesta con normalidad y SIN ninguna línea EJECUTAR.
NO_SE es solo para lo que un equipo no puede saber ni hacer de ninguna manera: si se puede
averiguar con PowerShell, búscalo en vez de decir NO_SE.`

function ensureDirs() { fs.mkdirSync(REQ_DIR,{recursive:true}); fs.mkdirSync(RES_DIR,{recursive:true}); fs.mkdirSync(PROGRESS_DIR,{recursive:true}); try{fs.mkdirSync(path.dirname(BUS_FILE),{recursive:true})}catch{} }
function ensureMemoryFile() { if(!fs.existsSync(MEMORY_FILE)) fs.writeFileSync(MEMORY_FILE,'# Memoria terminal\n\n') }
function ensureTranscriptFile() { if(!fs.existsSync(TRANSCRIPT_FILE)) fs.writeFileSync(TRANSCRIPT_FILE,'# Conversación terminal\n\n') }
function log(line) { fs.appendFileSync(LOG_FILE,`[${new Date().toISOString()}] ${line}\n`) }

function safeProgressText(value,max=240){
  return String(value||'').replace(/[\r\n\t]+/g,' ').replace(/\s+/g,' ').trim().slice(0,max)
}
function progressContext(req={}){
  const state=loadState()
  const cwd=String(state.activeCwd||req.cwd||DIR)
  return {
    cwd,
    project:String(state.activeProject||path.basename(cwd)||'Proyecto sin nombre'),
    model:String(state.activeModelLabel||state.activeModel||'gpt-5.6'),
    thread:String(state.selectedChatTitle||'Welcome to Notion')
  }
}
function createProgressEmitter(req={}){
  const requestId=String(req.id||'unknown')
  const progressPath=path.join(PROGRESS_DIR,requestId+'.jsonl')
  const startedAt=Date.now()
  let sequence=0
  try{fs.writeFileSync(progressPath,'')}catch{}
  return (state,message,extra={})=>{
    const ctx=progressContext(req)
    const event={
      requestId,sequence:++sequence,timestamp:new Date().toISOString(),state,
      kind:String(extra.kind||'status'),
      message:safeProgressText(message),cwd:ctx.cwd,project:ctx.project,
      model:ctx.model,thread:ctx.thread,elapsedMs:Date.now()-startedAt,
      tool:safeProgressText(extra.tool||'Task',40),
      action:safeProgressText(extra.action||message,180),
      detail:safeProgressText(extra.detail||'',240)
    }
    try{fs.appendFileSync(progressPath,JSON.stringify(event)+'\n')}catch{}
    try{
      const busMsg={
        id:'notion-cli-'+requestId+'-'+event.sequence,from:'notion-ai',to:'all',
        content:'[notion-cli:'+state+'] '+event.tool+'('+event.action+') | '+ctx.project+' | '+ctx.cwd,
        timestamp:Date.now(),kind:'progress',requestId,state,tool:event.tool,action:event.action,
        cwd:ctx.cwd,project:ctx.project,elapsedMs:event.elapsedMs
      }
      fs.appendFileSync(BUS_FILE,JSON.stringify(busMsg)+'\n')
    }catch{}
    log('PROGRESS '+requestId+' '+state+' '+event.tool+' '+event.action)
    return event
  }
}
// Publica la respuesta final en el bus del workspace usando la etiqueta del
// panel de Shosso que pidio el prompt ("Notion AI"). El puente de Discord
// (bridge.mjs → tailBus) reenvia al canal de la sesion todo lo que venga con
// el from de una sesion abierta desde Discord; sin esto, Discord ve el
// progreso pero nunca la respuesta.
function publishBusReply(label,text){
  const from=String(label||'').trim()
  const content=String(text||'').trim()
  if(!from||!content) return
  try{
    fs.appendFileSync(BUS_FILE,JSON.stringify({
      id:'notion-ai-reply-'+Date.now()+'-'+Math.random().toString(36).slice(2,8),
      from,to:'all',content:content.slice(0,6000),timestamp:Date.now(),kind:'reply'
    })+'\n')
  }catch(error){log('[bus] no pude publicar la respuesta: '+error.message)}
}
function loadState() { try { return JSON.parse(fs.readFileSync(STATE_FILE,'utf8')) } catch { return {} } }
function saveState(patch){
  const c=loadState();
  const pUrl=String(patch.selectedChatUrl||'');
  const cUrl=String(c.selectedChatUrl||'');
  const isProtected='selectedChatUrl' in patch&&!pUrl.includes('?t=')&&cUrl.includes('?t=')&&c.threadManuallySelected&&!('threadManuallySelected' in patch&&!patch.threadManuallySelected);
  if(isProtected){patch=Object.assign({},patch);delete patch.selectedChatUrl;delete patch.selectedChatTitle;}
  fs.writeFileSync(STATE_FILE,JSON.stringify({...c,...patch},null,2));
}
function readAccounts(){
  try{
    const raw=JSON.parse(fs.readFileSync(ACCOUNTS_FILE,'utf8'))
    const rows=Array.isArray(raw?.accounts)?raw.accounts:[]
    return {accounts:rows.map(normalizeAccountRow)}
  }catch{}
  return {accounts:[]}
}
function writeAccounts(data){
  const rows=Array.isArray(data?.accounts)?data.accounts.map(normalizeAccountRow):[]
  fs.writeFileSync(ACCOUNTS_FILE,JSON.stringify({accounts:rows},null,2))
}
function makeAccountKey(account={}){
  const uid=account.uid||account.userId||'unknown-user'
  const scope=account.spaceId||account.workspace||account.chatUrl||account.url||'default'
  return String(uid)+'::'+String(scope)
}
function normalizeAccountRow(row={}){
  const uid=row.uid||row.userId||null
  const out={...row}
  if(uid&&!out.uid) out.uid=uid
  if(uid&&!out.userId) out.userId=uid
  if(!out.chatUrl&&out.url) out.chatUrl=out.url
  out.key=row.key||makeAccountKey({...row,uid})
  return out
}
function formatAccountLabel(account={}){
  return [account.email,account.name,account.workspace].filter(Boolean).join(' | ')||account.userId||account.uid||'Cuenta no identificada'
}
function getSelectedAccountKey(){return loadState().selectedAccountKey||null}
function getAutoRotateAccounts(){return loadState().autoRotateAccounts!==false}
function loadMcpWorkspaceRegistry(){
  const data=readJsonSafe(MCP_REGISTRY_FILE,{rows:[]})
  return {...data,rows:Array.isArray(data?.rows)?data.rows:[]}
}
function getMcpWorkspaceStatus(account={}){
  const spaceId=account?.spaceId
  if(!spaceId) return null
  const registry=loadMcpWorkspaceRegistry()
  const row=registry.rows.find(x=>x.spaceId===spaceId)||null
  return row?{...row,registryGeneratedAt:registry.generatedAt||null}:null
}
// MODO PUENTE (permanente desde 2026-08-28). Las herramientas del PC las
// ejecuta el CLI (mcp-local.mjs), no Notion, porque Notion bloquea los MCP
// propios. Consecuencia: un workspace ya NO necesita tener el MCP conectado
// para servir; exigirlo dejaba fuera espacios perfectamente buenos y hacia que
// cada workspace nuevo (o cada cuenta nueva) necesitara una provision lenta.
// Se puede volver al modo antiguo con  cli-state.json → "mcpBridge": false.
let _puente=null, _puenteAt=0
function puenteActivo(){
  // Se consulta en bucles (una vez por workspace): se cachea 5 s para no leer
  // el estado del disco decenas de veces por peticion.
  if(_puente===null||Date.now()-_puenteAt>5000){ _puente=loadState().mcpBridge!==false; _puenteAt=Date.now() }
  return _puente
}
function isMcpReadyAccount(account={}){
  if(puenteActivo()) return true
  return getMcpWorkspaceStatus(account)?.ready===true
}
function refreshMcpWorkspaceRegistry(force=false){
  try{
    const current=loadMcpWorkspaceRegistry()
    const age=Date.now()-new Date(current.generatedAt||0).getTime()
    if(!force&&current.rows.length&&Number.isFinite(age)&&age>=0&&age<MCP_REGISTRY_TTL_MS)return current
    const r=spawnSync(process.execPath,[MCP_REGISTRY_SYNC_SCRIPT],{cwd:DIR,encoding:'utf8',windowsHide:true,timeout:120000})
    if(r.status!==0)log('[mcp-sync] scanner fallo: '+String(r.stderr||r.stdout||'sin detalle').slice(0,500))
    return loadMcpWorkspaceRegistry()
  }catch(error){log('[mcp-sync] '+error.message);return loadMcpWorkspaceRegistry()}
}
function upsertConnectedAccount(account){
  if(!account?.userId&&!account?.uid) return null
  const now=new Date().toISOString()
  const incoming=normalizeAccountRow({
    ...account,
    uid:account.uid||account.userId||null,
    chatUrl:account.chatUrl||account.url||null
  })
  const store=readAccounts()
  const idx=store.accounts.findIndex(x=>x.key===incoming.key)
  const prev=idx>=0?store.accounts[idx]:{}
  const row=normalizeAccountRow({
    ...prev,
    ...incoming,
    addedAt:prev.addedAt||now,
    connectedAt:prev.connectedAt||now,
    lastSeenAt:now
  })
  if(idx>=0) store.accounts[idx]=row
  else store.accounts.push(row)
  writeAccounts(store)
  saveState({lastConnectedAccount:row,version:VERSION})
  return row
}
function listConnectedAccounts(){
  return readAccounts().accounts.sort((a,b)=>String(b.lastSeenAt||'').localeCompare(String(a.lastSeenAt||'')))
}
function mergeKnownAccountDetails(account={}){
  const incoming=normalizeAccountRow(account)
  const rows=readAccounts().accounts.map(normalizeAccountRow)
  const known=rows.find(x=>x.key===incoming.key)||rows.find(x=>incoming.uid&&x.uid===incoming.uid&&x.email)||rows.find(x=>incoming.spaceId&&x.spaceId===incoming.spaceId)||rows.find(x=>incoming.chatUrl&&x.chatUrl===incoming.chatUrl)||null
  return normalizeAccountRow({...known,...incoming})
}
function sanitizeAccountFilePart(value=''){
  return String(value||'slot').replace(/[<>:"/\|?*]+/g,'-').replace(/\s+/g,'-').slice(0,120)||'slot'
}
function getAccountSessionFile(account={}){
  fs.mkdirSync(ACCOUNT_SESSION_DIR,{recursive:true})
  return path.join(ACCOUNT_SESSION_DIR,sanitizeAccountFilePart(makeAccountKey(account))+'.json')
}
function hasSavedSessionForAccount(account={}){
  try{return fs.existsSync(getAccountSessionFile(account))}catch{return false}
}
function readJsonSafe(file,fallback={}){
  try{return JSON.parse(fs.readFileSync(file,'utf8'))}catch{return fallback}
}
function getHeadlessSessionAccountKey(){
  const raw=readJsonSafe(HEADLESS_SESSION_FILE,{})
  return raw?.account?.key||makeAccountKey(raw?.account||{})||null
}
function getRestoreStatus(){return readJsonSafe(RESTORE_STATUS_FILE,{})}
function isAccountSessionActive(account={}){
  const key=makeAccountKey(account)
  const status=getRestoreStatus()
  return !!(key && status?.state==='ready' && status?.accountKey===key && getHeadlessSessionAccountKey()===key)
}
async function waitForAccountSession(account={},timeoutMs=150000){
  const key=makeAccountKey(account)
  if(!hasSavedSessionForAccount(account)) throw new Error('La cuenta seleccionada no tiene una sesión guardada: '+formatAccountLabel(account)+'. Abre ese workspace y usa /conectar una vez.')
  if(isAccountSessionActive(account)){
    saveState({restoreStatus:{state:'ready',accountKey:key,startedAt:new Date().toISOString()},version:VERSION})
    return account
  }
  const queued=queueSessionRestoreForAccount(account)
  if(!queued) throw new Error('No pude iniciar la restauración de la sesión: '+formatAccountLabel(account))
  const started=Date.now()
  while(Date.now()-started<timeoutMs){
    const status=getRestoreStatus()
    if(status?.accountKey===key && status?.state==='error') throw new Error('Falló la restauración de la sesión: '+String(status.error||'error desconocido'))
    if(isAccountSessionActive(account)){
      saveState({restoreStatus:{state:'ready',accountKey:key,startedAt:new Date().toISOString()},version:VERSION})
      return account
    }
    await sleep(500)
  }
  throw new Error('Timeout sincronizando la sesión de '+formatAccountLabel(account))
}
function chooseSynchronizedAccount(){
  // Los workspaces ya medidos sin cupo (o con la IA apagada) van al final: si no,
  // se elegia siempre el principal de la sesion del navegador aunque estuviera
  // seco, y cada peticion se gastaba minutos descubriendolo otra vez.
  const todas=listConnectedAccounts().filter(isSessionReadyAccount)
  if(!todas.length) return null
  const rows=[...todas.filter(a=>!estaAgotado(a.key)),...todas.filter(a=>estaAgotado(a.key))]
  const state=loadState()
  const selected=rows.find(a=>a.key===state.selectedAccountKey&&!estaAgotado(a.key))
  if(selected) return selected
  const liveKey=getHeadlessSessionAccountKey()
  const live=rows.find(a=>a.key===liveKey&&!estaAgotado(a.key))
  if(live) return live
  const restoredKey=getRestoreStatus()?.accountKey
  return rows.find(a=>a.key===restoredKey)||rows[0]
}
async function ensureSelectedAccountSynchronized(){
  const rows=listConnectedAccounts()
  const state=loadState()
  let account=rows.find(a=>a.key===state.selectedAccountKey)||null
  if(account&&estaAgotado(account.key)){
    const vivo=listConnectedAccounts().find(a=>isSessionReadyAccount(a)&&isMcpReadyAccount(a)&&!estaAgotado(a.key))
    if(vivo){ log('[sync] '+formatAccountLabel(account)+' esta descartado; uso '+formatAccountLabel(vivo)); selectConnectedAccount(vivo); account=vivo }
  }
  if(!isSessionReadyAccount(account)){
    const fallback=chooseSynchronizedAccount()
    if(!fallback) throw new Error('No hay ninguna cuenta lista para uso automático. Abre un workspace de Notion y usa /conectar una vez.')
    log('[sync] Selección inválida o sin sesión; usando '+formatAccountLabel(fallback))
    selectConnectedAccount(fallback)
    account=fallback
  }
  await waitForAccountSession(account)
  refreshMcpWorkspaceRegistry()
  let mcp=getMcpWorkspaceStatus(account)
  if(!mcp?.ready){
    const fallback=listConnectedAccounts().find(a=>a.key!==account.key&&isSessionReadyAccount(a)&&isMcpReadyAccount(a)&&!estaAgotado(a.key))
    if(fallback){
      log('[mcp-sync] '+formatAccountLabel(account)+' no tiene MCP activo; cambiando a '+formatAccountLabel(fallback))
      selectConnectedAccount(fallback)
      account=fallback
      await waitForAccountSession(account)
      refreshMcpWorkspaceRegistry(true)
      mcp=getMcpWorkspaceStatus(account)
    }
  }
  if(!mcp?.ready){
    log('[mcp-sync] Sin MCP listo en '+formatAccountLabel(account)+'; intentando conexion directa (Custom MCP)')
    try{
      const prov=spawnSync(process.execPath,[MCP_ENSURE_SCRIPT],{cwd:DIR,encoding:'utf8',windowsHide:true,timeout:180000})
      if(prov.status!==0)log('[mcp-sync] provisioner: '+String(prov.stderr||prov.stdout||'sin detalle').slice(0,300))
    }catch(error){log('[mcp-sync] provisioner fallo: '+error.message)}
    refreshMcpWorkspaceRegistry(true)
    mcp=getMcpWorkspaceStatus(account)
  }
  if(!mcp?.ready){
    const prev=loadState()
    mcp={name:prev.mcpRequiredName||prev.mcpExpectedName||'PC1',moduleId:prev.mcpActiveModuleId||null,serverUrl:CANONICAL_MCP_ORIGIN,fallback:true}
    log('[mcp-sync] MCP no detectado; usando endpoint canonico de respaldo '+CANONICAL_MCP_ORIGIN)
  }
  saveState({mcpExpectedName:mcp.name||null,mcpActiveModuleId:mcp.moduleId||null,mcpActiveServerUrl:mcp.serverUrl||null,mcpFallbackUsed:!!mcp.fallback,mcpLastVerifiedAt:new Date().toISOString(),version:VERSION})
  const latest=loadState()
  if(latest.selectedAccountKey!==account.key || latest.selectedChatUrl!==account.chatUrl){
    saveState({selectedAccountKey:account.key,selectedChatUrl:account.chatUrl,selectedChatTitle:account.workspace||account.email||account.name||'Workspace seleccionado',lastSelectedAccount:account,version:VERSION})
  }
  return account
}
async function persistActiveThreadFromClient(client){
  try{
    const url=await client.evaluate('location.href',10000)
    const title=await client.evaluate('document.title',10000)
    if(!url||!/notion/i.test(String(url))) return
    const state=loadState()
    const rows=readAccounts().accounts
    const idx=rows.findIndex(a=>a.key===state.selectedAccountKey)
    if(idx>=0){
      rows[idx]=normalizeAccountRow({...rows[idx],chatUrl:String(url),url:String(url),title:String(title||rows[idx].title||''),lastSeenAt:new Date().toISOString()})
      writeAccounts({accounts:rows})
      saveState({selectedChatOwnerKey:state.selectedAccountKey,selectedChatUrl:String(url),selectedChatTitle:rows[idx].workspace||simplifyChatTitle(String(title||''))||state.selectedChatTitle,lastSelectedAccount:rows[idx],lastActiveAccount:rows[idx],version:VERSION})
    }
  }catch(error){log('[sync] No pude persistir el thread activo: '+error.message)}
}
function saveSessionSnapshotForAccount(account={}){
  if(!fs.existsSync(HEADLESS_SESSION_FILE)) return null
  const raw=JSON.parse(fs.readFileSync(HEADLESS_SESSION_FILE,'utf8'))
  const enriched={...raw,account:normalizeAccountRow(account),savedAt:new Date().toISOString()}
  const file=getAccountSessionFile(account)
  fs.writeFileSync(file,JSON.stringify(enriched,null,2))
  return file
}
function restoreSessionSnapshotForAccount(account={}){
  const file=getAccountSessionFile(account)
  if(!fs.existsSync(file)) return false
  const saved=JSON.parse(fs.readFileSync(file,'utf8'))
  fs.writeFileSync(HEADLESS_SESSION_FILE,JSON.stringify(saved,null,2))
  return true
}
function queueSessionRestoreForAccount(account={}){
  const file=getAccountSessionFile(account)
  if(!fs.existsSync(file)) return false
  const restoreScript=path.join(DIR,'restore-account-session.mjs')
  const now=new Date().toISOString()
  saveState({restoreStatus:{state:'starting',accountKey:makeAccountKey(account),startedAt:now},version:VERSION})
  try{
    spawnSync('cmd.exe',['/c','start','""','/min','node',restoreScript,file],{cwd:DIR,stdio:'ignore',windowsHide:true})
    return true
  }catch(error){
    saveState({restoreStatus:{state:'error',accountKey:makeAccountKey(account),startedAt:now,error:error.message},version:VERSION})
    return false
  }
}
function findPreferredBrowser(){
  const browsers=[
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'
  ]
  return browsers.find(p=>fs.existsSync(p))||null
}
function getPersistentPopupProfile(label='',opciones={}){
  fs.mkdirSync(POPUP_PROFILES_DIR,{recursive:true})
  // Para AÑADIR una cuenta hace falta un perfil limpio: reutilizar el de siempre
  // abre el navegador ya logueado con la cuenta anterior, y se volvería a
  // capturar esa misma sin añadir nada nuevo.
  if(opciones.fresh){
    const slot=sanitizeAccountFilePart((label||'cuenta')+'-'+Date.now())
    const profileDir=path.join(POPUP_PROFILES_DIR,slot)
    fs.mkdirSync(profileDir,{recursive:true})
    return {slot,profileDir,reused:false,fresh:true}
  }
  const remembered=readJsonSafe(POPUP_STATE_FILE,{})
  if(remembered.profileDir&&fs.existsSync(remembered.profileDir)) return {slot:path.basename(remembered.profileDir),profileDir:remembered.profileDir,reused:true}
  const existing=fs.readdirSync(POPUP_PROFILES_DIR,{withFileTypes:true}).filter(x=>x.isDirectory()).map(x=>({name:x.name,full:path.join(POPUP_PROFILES_DIR,x.name),mtime:fs.statSync(path.join(POPUP_PROFILES_DIR,x.name)).mtimeMs})).sort((a,b)=>b.mtime-a.mtime)[0]
  if(existing) return {slot:existing.name,profileDir:existing.full,reused:true}
  const slot=sanitizeAccountFilePart(label||'notion-primary')
  const profileDir=path.join(POPUP_PROFILES_DIR,slot)
  fs.mkdirSync(profileDir,{recursive:true})
  return {slot,profileDir,reused:false}
}
function openNotionAccountPopup(label='',opciones={}){
  const browser=findPreferredBrowser()
  if(!browser) throw new Error('No encontré Edge o Chrome para abrir otra cuenta de Notion.')
  const profile=getPersistentPopupProfile(label,opciones)
  fs.writeFileSync(POPUP_STATE_FILE,JSON.stringify({...profile,port:9224,updatedAt:new Date().toISOString()},null,2))
  const notionUrl='https://'+'app.notion.com/chat'
  const ps="Start-Process -FilePath '"+browser.replace(/'/g,"''")+"' -ArgumentList @('--new-window','--remote-debugging-port=9224','--remote-debugging-address=127.0.0.1','--remote-allow-origins=*','--user-data-dir="+profile.profileDir.replace(/'/g,"''")+"','"+notionUrl+"')"
  spawnSync('powershell.exe',['-NoProfile','-Command',ps],{cwd:DIR,stdio:'ignore',windowsHide:true})
  return {...profile,url:notionUrl,port:9224,message:profile.reused?'Perfil de conexión reutilizado; no necesitas volver a iniciar sesión.':'Perfil persistente creado; inicia sesión una sola vez.'}
}
async function capturePopupAccountSession(){
  let targets
  try{targets=await (await fetch(POPUP_CDP_HTTP+'/json',{signal:AbortSignal.timeout(2500)})).json()}catch{return null}
  const target=targets.find(t=>t.type==='page'&&/notion\.(so|com)/i.test(t.url||''))
  if(!target?.webSocketDebuggerUrl) throw new Error('El perfil de conexión está abierto, pero no hay una pestaña de Notion lista.')
  const client=new CdpClient(target)
  await client.connect()
  try{
    await client.call('Network.enable',{},10000)
    const browserProbe=async function(){
      const read=k=>{try{return JSON.parse(localStorage.getItem(k)||'null')?.value||null}catch{return null}}
      const userId=read('LRU:KeyValueStore2:current-user-id')
      const currentSpaceId=read('LRU:KeyValueStore2:current-space-id')
      const selectedNode=[...document.querySelectorAll('[aria-checked=true],[role=menuitemradio]')].find(e=>/workspace|space|outlook|espacio/i.test(e.innerText||''))
      const out={userId,currentSpaceId,url:location.href,title:document.title,userAgent:navigator.userAgent,email:null,name:null,workspaces:[],selectedWorkspaceText:(selectedNode?.innerText||'').trim()||null}
      if(!userId)return out
      const r=await fetch('/api/v3/getSpaces',{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body:JSON.stringify({})})
      const p=JSON.parse(await r.text())
      const root=p?.[userId]||p
      const spaces=root?.space||{}
      const u=root?.notion_user?.[userId]?.value?.value?.value||root?.notion_user?.[userId]?.value?.value||{}
      out.email=u.email||null
      out.name=u.name||null
      out.workspaces=Object.entries(spaces).map(([spaceId,rec])=>{const sp=rec?.value?.value?.value||rec?.value?.value||{};return {spaceId,workspace:sp.name||sp.display_name||('Workspace '+spaceId.slice(0,8))}})
      return out
    }
    const raw=await client.evaluate('('+browserProbe.toString()+')()',30000)
    const info=typeof raw==='string'?JSON.parse(raw||'{}'):(raw||{})
    if(!info.userId) throw new Error('No detecté una cuenta iniciada en el perfil de conexión.')
    if(!Array.isArray(info.workspaces)||!info.workspaces.length) throw new Error('Detecté la cuenta, pero ningún workspace disponible.')
    const got=await client.call('Network.getAllCookies',{},30000)
    const cookies=(got.cookies||[]).filter(c=>/notion\.(so|com)$/i.test(String(c.domain||'').replace(/^\./,''))||/\.notion\.(so|com)$/i.test(String(c.domain||''))).map(c=>({name:c.name,value:c.value,domain:c.domain,path:c.path||'/',secure:!!c.secure,httpOnly:!!c.httpOnly,sameSite:c.sameSite,expires:c.expires>0?c.expires:undefined,priority:c.priority}))
    if(!cookies.some(c=>c.name==='token_v2')) throw new Error('La sesión de Notion no está completa: falta token_v2.')
    const fallbackUrl='https://'+'app.notion.com/chat'
    const sourceUrl=/notion\.(so|com)/i.test(String(info.url||''))?String(info.url):fallbackUrl
    const now=new Date().toISOString()
    const captured=[]
    for(const ws of info.workspaces){
      const account=normalizeAccountRow({uid:info.userId,userId:info.userId,spaceId:ws.spaceId,email:info.email,name:info.name,workspace:ws.workspace,chatUrl:fallbackUrl,url:fallbackUrl,title:ws.workspace,connectedAt:now,lastSeenAt:now})
      const session={version:4,capturedAt:now,origin:'https://'+'app.notion.com',href:fallbackUrl,chatUrl:fallbackUrl,sourceUrl,userAgent:info.userAgent,userId:info.userId,spaceId:ws.spaceId,threadId:null,cookies,account}
      fs.mkdirSync(ACCOUNT_SESSION_DIR,{recursive:true})
      fs.writeFileSync(getAccountSessionFile(account),JSON.stringify({...session,savedAt:now},null,2))
      captured.push({account:upsertConnectedAccount(account)||account,session})
    }
    const state=loadState()
    const selectedText=String(info.selectedWorkspaceText||'').toLowerCase()
    const preferred=captured.find(x=>x.account.spaceId===info.currentSpaceId)
      || captured.find(x=>state.selectedAccountKey===x.account.key)
      || captured.find(x=>selectedText&&selectedText.includes(String(x.account.workspace||'').toLowerCase()))
      || captured.find(x=>/^outlook$/i.test(String(x.account.workspace||'')))
      || captured[0]
    fs.writeFileSync(HEADLESS_SESSION_FILE,JSON.stringify(preferred.session,null,2))
    selectConnectedAccount(preferred.account)
    fs.writeFileSync(POPUP_STATE_FILE,JSON.stringify({...readJsonSafe(POPUP_STATE_FILE,{}),lastCapturedAccountKey:preferred.account.key,lastCapturedEmail:preferred.account.email,capturedAt:now,workspaceCount:captured.length,workspaceKeys:captured.map(x=>x.account.key)},null,2))
    log('[popup] Sesión multiespacio capturada: '+formatAccountLabel(preferred.account)+' | workspaces='+captured.length)
    return {...preferred.account,workspaceCount:captured.length,connectedWorkspaces:captured.map(x=>({spaceId:x.account.spaceId,workspace:x.account.workspace,key:x.account.key}))}
  }finally{try{client.close()}catch{}}
}
function openProxyPanel(){
  spawnSync('powershell.exe',['-NoProfile','-Command',"Start-Process 'http://127.0.0.1:8317/management.html'"],{cwd:DIR,stdio:'ignore',windowsHide:true})
  return {url:PROXY_PANEL_URL}
}
function resolveConnectedAccount(value){
  const rows=listConnectedAccounts()
  const raw=String(value||'').trim()
  if(!raw) throw new Error('Debes indicar un número o texto de cuenta/workspace.')
  if(/^\d+$/.test(raw)){
    const found=rows[Number(raw)-1]
    if(!found) throw new Error('No existe la cuenta/workspace #'+raw)
    return found
  }
  const key=raw.toLowerCase()
  const found=rows.find(a=>[a.key,a.uid,a.email,a.workspace,a.name,a.chatUrl].filter(Boolean).some(x=>String(x).toLowerCase().includes(key)))
  if(!found) throw new Error('No encontré una cuenta/workspace que coincida con: '+raw)
  return found
}
function selectConnectedAccount(value){
  const entry=typeof value==='object'&&value?normalizeAccountRow(value):resolveConnectedAccount(value)
  const patch={selectedAccountKey:entry.key,version:VERSION,selectedAt:new Date().toISOString()}
  if(entry.chatUrl) patch.selectedChatUrl=entry.chatUrl
  patch.selectedChatTitle=entry.workspace||entry.email||entry.name||entry.uid||'Workspace seleccionado'
  patch.lastSelectedAccount=entry
  const hasSavedSession=hasSavedSessionForAccount(entry)
  if(!hasSavedSession) throw new Error('La cuenta no tiene una sesión guardada: '+formatAccountLabel(entry)+'. Abre ese workspace y usa /conectar una vez.')
  const alreadyActive=isAccountSessionActive(entry)
  patch.restoreStatus=alreadyActive
    ? {state:'ready',accountKey:entry.key,startedAt:new Date().toISOString()}
    : {state:'queued',accountKey:entry.key,startedAt:new Date().toISOString()}
  saveState(patch)
  const restoreQueued=alreadyActive?false:queueSessionRestoreForAccount(entry)
  return {...entry,hasSavedSession,restoreQueued,alreadyActive}
}
function selectNextConnectedAccount(){
  refreshMcpWorkspaceRegistry()
  const rows=listRotatableAccounts([])
  if(!rows.length) throw new Error('No hay cuentas conectadas.')
  const pool=rows.filter(hasSavedSessionForAccount)
  const ordered=pool.length?pool:rows
  const current=getSelectedAccountKey()
  const idx=current?ordered.findIndex(x=>x.key===current):-1
  const next=ordered[(idx+1+ordered.length)%ordered.length]
  return selectConnectedAccount(next)
}
// Vista multi-cuenta: agrupa los workspaces por correo, como el CLI de Codex
// con sus perfiles, para ver de un vistazo qué cuentas hay conectadas.
function formatAccountsByOwner(accounts){
  const current=getSelectedAccountKey()
  if(!accounts.length) return 'No hay cuentas conectadas. Usa /nueva-cuenta para añadir una.'
  const porCuenta=new Map()
  for(const a of accounts){
    const k=a.email||a.uid||'(sin identificar)'
    if(!porCuenta.has(k)) porCuenta.set(k,[])
    porCuenta.get(k).push(a)
  }
  const lines=['Cuentas conectadas: '+porCuenta.size+' · rotación '+(getAutoRotateAccounts()?'on':'off'),'']
  let n=0
  for(const [correo,filas] of porCuenta){
    const listos=filas.filter(a=>isMcpReadyAccount(a)&&hasSavedSessionForAccount(a)).length
    lines.push(correo+'  ('+filas.length+' workspace'+(filas.length===1?'':'s')+', '+listos+' en rotación)')
    for(const a of filas){
      n++
      const activa=a.key===current?'*':' '
      const estado=[hasSavedSessionForAccount(a)?'sesión':'sin sesión',isMcpReadyAccount(a)?'MCP':'sin MCP',estaAgotado(a.key)?(planAgotado(a.key)==='business-trial'?'trial agotado (el plan Free sigue libre)':'sin cupo Free'):'con cupo'].join(', ')
      lines.push('  '+activa+' '+String(n).padStart(2)+'. '+(a.workspace||a.spaceId?.slice(0,8))+'  ['+estado+']')
    }
    lines.push('')
  }
  lines.push('Comandos: /usar N · /nueva-cuenta · /nuevo-workspace')
  return lines.join('\n')

}
function formatAccountsText(accounts){
  const current=getSelectedAccountKey()
  const rotate=getAutoRotateAccounts()?'on':'off'
  if(!accounts.length) return 'No hay cuentas conectadas. Abre Notion con el workspace deseado y usa /conectar.'
  const active=accounts.find(a=>a.key===current)
  const lines=['Rotación automática: '+rotate]
  if(active) lines.push('Cuenta activa: '+formatAccountLabel(active))
  lines.push('')
  for(const [i,a] of accounts.entries()){
    const marker=a.key===current?'* ':'  '
    lines.push(marker+String(i+1)+'. '+formatAccountLabel(a))
    lines.push('   Sesión guardada: '+(hasSavedSessionForAccount(a)?'sí':'no'))
    if(a.lastSeenAt) lines.push('   Última vez: '+a.lastSeenAt)
    if(a.key===current) lines.push('   Estado: activa ahora')
    lines.push('')
  }
  return lines.join('\n').trim()
}
// Memoria de cupo: un workspace del plan Free que se acaba de agotar no vuelve
// a estar disponible en un rato. Recordarlo evita perder minutos probándolo otra
// vez en cada rotación, que es lo que hacía la rotación tan lenta.
// Se guarda tambien el plan al que pertenece el cupo agotado: un espacio con el
// trial de Business seco no dice nada del plan Free de esa cuenta (ver
// clasificarAviso), y sin ese dato el CLI daba la cuenta entera por perdida.
function marcarAgotado(key,plan='free'){
  if(!key) return
  const st=loadState()
  saveState({quotaExhausted:{...(st.quotaExhausted||{}),[key]:{t:Date.now(),plan}},version:VERSION})
}
function leerAgotado(key){
  const v=(loadState().quotaExhausted||{})[key]
  if(!v) return null
  return typeof v==='number'?{t:v,plan:'free'}:v          // formato viejo: solo la marca de tiempo
}
function estaAgotado(key){
  const v=leerAgotado(key)
  return !!v && (Date.now()-v.t) < 60*60*1000
}
function planAgotado(key){ return leerAgotado(key)?.plan||null }
function listRotatableAccounts(excludeKeys=[]){
  const skip=new Set(excludeKeys.filter(Boolean))
  return listConnectedAccounts().filter(a=>a.spaceId&&a.chatUrl&&hasSavedSessionForAccount(a)&&isMcpReadyAccount(a)&&!skip.has(a.key)&&!estaAgotado(a.key))
}
function isSessionReadyAccount(account={}){
  return !!(account && account.spaceId && account.chatUrl && hasSavedSessionForAccount(account))
}
function formatRotationPlanText(accounts){
  if(!accounts.length) return 'No hay workspaces listos para rotación automática. Guarda una sesión con /conectar dentro de cada workspace que quieras usar.'
  return accounts.map((a,i)=>{const m=getMcpWorkspaceStatus(a);return String(i+1)+'. '+formatAccountLabel(a)+' | MCP '+String(m?.name||'?')+' verificado'}).join('\n')
}
// Notion cambia la redaccion del aviso de cupo cada tanto y, cuando se agota,
// QUITA el campo de escritura del DOM. Si el patron no reconoce el texto nuevo,
// el CLI cree que hay cupo y se queda minutos buscando un composer inexistente.
// Visto el 2026-08-27: "You've used your trial's monthly AI allowance. You can
// use Notion credits now, or wait until Sep 25 for it to reset."
const QUOTA_TEXT_PATTERN = "used your trial('|’)?s? ?(monthly )?AI allowance|run out of free AI responses|use Notion credits|Notion Credits|Chat limit exceeded|for it to reset|Upgrade Notion AI|podr[aá]s? usar la IA|usar la IA en \d+|cr[eé]ditos de Notion|Consigue cr[eé]ditos|has usado tu (asignaci[oó]n|cuota)|sin cr[eé]ditos|l[ií]mite de chat"
// El aviso de agotado NO significa lo mismo según el plan del espacio:
//   · business-trial → se acabó el cupo DEL TRIAL. La cuenta sigue pudiendo
//     estrenar espacios del plan Free, y esos nacen con cupo propio (probado
//     2026-08-28 en una cuenta cuyo trial decía "wait until Sep 17").
//   · free           → ese espacio ya gastó su cupo del plan Free: hay que
//     rotar a otro o crear uno nuevo.
// Confundirlos llevaba a dar la cuenta entera por seca y no crear nada.
// Cuantos workspaces del plan Free se intentan crear al dar de alta una cuenta.
// No es un tope de Notion: se piden y se para en cuanto Notion corta por ritmo.
const FREE_WORKSPACE_TARGET = 4

// Mantenimiento del colchon de workspaces con cupo. Corre aparte (spawn, no
// spawnSync) porque tarda minutos y bloquear el daemon dejaria el panel mudo;
// pool-maintain se salta el turno solo si hay una peticion en curso.
// Salud del motor: /json/version puede responder 200 mientras playwright ya no
// consigue adjuntarse (service workers atascados). Ese estado colgaba el CLI
// entero en silencio, asi que se comprueba conectando de verdad.
let saludCorriendo=false, saludUltima=0
// Sin revisiones por reloj: la salud del motor se comprueba en vivo justo
// antes de cada peticion, que es cuando importa.
// Un motor caido se veia como "sin composer" y de ahi el CLI concluia "sin
// cupo" y rotaba de workspace anunciandolo: diagnostico falso. Estos errores
// son del navegador, no de Notion.
function esErrorDeMotor(mensaje){
  return /Runtime\.enable|connectOverCDP|Target closed|Target page, context or browser has been closed|browserType|Protocol error|WebSocket|Timeout .*exceeded/i.test(String(mensaje||''))
}
function esperarMotorSano(){
  return new Promise(resolve=>{
    const hijo=spawn(process.execPath,[path.join(DIR,'engine-health.mjs'),'--json'],{cwd:DIR,windowsHide:true,stdio:['ignore','pipe','ignore']})
    let out=''
    hijo.stdout.on('data',d=>{out+=String(d)})
    hijo.on('close',()=>{ try{ resolve(JSON.parse(out.trim()||'{}')) }catch{ resolve({ok:false}) } })
    hijo.on('error',()=>resolve({ok:false}))
  })
}
function revisarMotor(){
  if(saludCorriendo) return
  saludCorriendo=true; saludUltima=Date.now()
  const hijo=spawn(process.execPath,[path.join(DIR,'engine-health.mjs'),'--json'],{cwd:DIR,windowsHide:true,stdio:['ignore','pipe','ignore']})
  let out=''
  hijo.stdout.on('data',d=>{out+=String(d)})
  hijo.on('close',()=>{
    saludCorriendo=false
    try{ const r=JSON.parse(out.trim()||'{}'); if(r.reiniciado) log('[motor] no aceptaba conexiones; reiniciado ('+(r.ok?'ok':'sigue caido')+')') }catch{}
  })
  hijo.on('error',()=>{saludCorriendo=false})
}
// Cierra las pestañas sobrantes del motor. Se lanza aparte para no frenar la
// respuesta al usuario.
let limpiezaCorriendo=false
function limpiarPestanas(){
  if(limpiezaCorriendo) return
  limpiezaCorriendo=true
  const hijo=spawn(process.execPath,[path.join(DIR,'tabs-clean.mjs')],{cwd:DIR,windowsHide:true,stdio:['ignore','pipe','ignore']})
  let out=''
  hijo.stdout.on('data',d=>{out+=String(d)})
  hijo.on('close',()=>{ limpiezaCorriendo=false; const l=out.trim(); if(l&&!/cerradas 0\)/.test(l)) log('[tabs] '+l) })
  hijo.on('error',()=>{limpiezaCorriendo=false})
}
let poolCorriendo=false, poolUltimo=0, poolPendiente=null
// El colchon de workspaces se repone por evento (al quedarse sin cupo), no
// cada media hora.
function lanzarPoolMaintain(motivo='ciclo'){
  if(poolCorriendo) return false
  // Nunca en medio de una peticion: usan el mismo motor y el mantenimiento le
  // robaria la pestaña justo cuando esta esperando la respuesta.
  try{
    const enCurso=fs.readdirSync(REQ_DIR).some(n=>n.endsWith('.working.json'))
    if(enCurso){ poolPendiente=motivo; log('[pool] hay una peticion en curso; lo dejo para cuando termine'); return false }
  }catch{}
  poolPendiente=null
  poolCorriendo=true; poolUltimo=Date.now()
  log('[pool] mantenimiento en marcha ('+motivo+')')
  const hijo=spawn(process.execPath,[path.join(DIR,'pool-maintain.mjs'),'--json'],{cwd:DIR,windowsHide:true,stdio:['ignore','pipe','pipe']})
  let salida=''
  hijo.stdout.on('data',d=>{salida+=String(d)})
  hijo.on('close',()=>{
    poolCorriendo=false
    try{
      const r=JSON.parse(salida.trim().split('\n').pop()||'{}')
      if(r.skipped) log('[pool] turno saltado: '+r.skipped)
      else log('[pool] '+r.conCupo+'/'+r.minimo+' con cupo'+(r.creados&&r.creados.length?' · creados '+r.creados.map(c=>c.spaceId.slice(0,8)).join(', '):''))
    }catch{ log('[pool] terminado sin resumen') }
  })
  hijo.on('error',e=>{poolCorriendo=false; log('[pool] error: '+e.message)})
  return true
}

const TRIAL_TEXT_PATTERN = "trial('|’)?s? ?(monthly )?AI allowance|tu (per[ií]odo de )?prueba"
function clasificarAviso(texto){
  const t=String(texto||'')
  if(!new RegExp(QUOTA_TEXT_PATTERN,'i').test(t)) return {agotado:false,plan:'free'}
  return {agotado:true,plan:new RegExp(TRIAL_TEXT_PATTERN,'i').test(t)?'business-trial':'free'}
}

function isQuotaErrorMessage(message){
  const text=String(message||'')
  return /No pude escribir el prompt|sin cupo o créditos|se quedó sin avanzar|trial ai allowance|Notion Credits|premium-feature-unavailable|Chat limit exceeded|AI DESHABILITADA|AI disabled|No pude sincronizar la cuenta y el thread|MCP no disponible|Failed to connect to MCP server|HTTP 404|mcpServer_pc211/i.test(text)
}
function findPremiumFeatureNode(value,depth=0){
  if(!value||depth>8) return null
  if(Array.isArray(value)){for(const item of value){const hit=findPremiumFeatureNode(item,depth+1);if(hit)return hit}return null}
  if(typeof value==='object'){
    if(value.type==='premium-feature-unavailable'&&value.featureAvailability?.limit) return value
    for(const item of Object.values(value)){const hit=findPremiumFeatureNode(item,depth+1);if(hit)return hit}
  }
  return null
}
function extractQuotaInfoFromRaw(raw){
  const text=String(raw||'').trim()
  if(!text) return null
  for(const line of text.split(/\n+/)){
    let parsed
    try{parsed=JSON.parse(line)}catch{continue}
    const hit=findPremiumFeatureNode(parsed)
    const limit=hit?.featureAvailability?.limit
    const current=Number(limit?.current)
    const total=Number(limit?.total)
    if(Number.isFinite(current)&&Number.isFinite(total)){
      const remaining=Math.max(0,Number((total-current).toFixed(2)))
      return {type:limit?.type||null,current,total,remaining,blocked:current>=total,source:'last-hidden-raw'}
    }
  }
  return null
}
function simplifyChatTitle(title=''){
  const t=String(title||'').trim()
  if(!t) return 'Chat actual'
  if(/welcome to notion|te damos la bienvenida a notion/i.test(t)) return 'Inicio de Notion'
  if(/^notion( | notion)?$/i.test(t)) return 'Pantalla de Notion'
  return t.replace(/\s*\|\s*Notion$/i,'').trim()
}
function formatAiStatusText(status={}){
  const lines=[]
  const accountLabel=formatAccountLabel(status.account||{})
  lines.push('Cuenta: '+accountLabel)
  const workspace=status.workspace||status.account?.workspace||'Workspace actual'
  lines.push('Workspace: '+workspace)
  lines.push('Chat: '+simplifyChatTitle(status.title||status.account?.title||''))
  const stateLabel=status.blocked===true?'sin cupo':status.blocked===false?'lista':'no detectado'
  lines.push('AI: '+stateLabel)
  // Distinguir el plan importa: si lo agotado es el trial de Business, la cuenta
  // sigue pudiendo estrenar espacios del plan Free con cupo propio.
  if(status.blocked===true) lines.push(status.plan==='business-trial'
    ? 'Plan: trial de Business agotado — un workspace nuevo del plan Free sí tendría cupo'
    : 'Plan: Free agotado en este workspace — toca rotar o crear otro')
  if(status.quota){
    lines.push('Uso visible: '+status.quota.current+'/'+status.quota.total)
    lines.push('Disponible estimado: '+status.quota.remaining)
  }else if(status.waitText){
    lines.push('Reintento aproximado: '+status.waitText)
  }else if(status.blocked===false){
    lines.push('Uso: disponible ahora')
  }else{
    lines.push('Uso: no pude medirlo todavía')
  }
  if(status.message&&status.blocked!==false) lines.push('Aviso: '+status.message)
  return lines.join('\n')
}
function formatAiStatusAllText(rows){
  if(!rows.length) return 'No hay workspaces conectados para revisar.'
  return rows.map((row,i)=>{
    const statusLabel=row.error?('pendiente: '+row.error):(row.blocked===true?'sin cupo':row.blocked===false?'disponible ahora':'sin confirmar')
    const used=row.quota?(' | uso visible '+row.quota.current+'/'+row.quota.total):''
    return String(i+1)+'. '+formatAccountLabel(row.account||row)+' | '+statusLabel+used
  }).join('\n')
}
function pidAlive(pid) { if(!Number.isInteger(pid)||pid<=0) return false; try{process.kill(pid,0);return true}catch{return false} }
function acquireInstance() {
  let lock=null; try{lock=JSON.parse(fs.readFileSync(LOCK_FILE,'utf8'))}catch{}
  if(lock?.pid&&lock.pid!==process.pid&&pidAlive(lock.pid)) throw new Error(`Ya hay una instancia activa (PID ${lock.pid}).`)
  try{fs.unlinkSync(LOCK_FILE)}catch{}
  fs.writeFileSync(LOCK_FILE,JSON.stringify({pid:process.pid,version:VERSION,startedAt:new Date().toISOString()},null,2))
}
function releaseInstance() { try{const l=JSON.parse(fs.readFileSync(LOCK_FILE,'utf8'));if(l.pid===process.pid)fs.unlinkSync(LOCK_FILE)}catch{} }
function getSharedBoardPath(){
  const state=loadState()
  const cwd=String(state.activeCwd||DIR)
  return path.join(cwd,'.shosso-team-board.md')
}
function ensureSharedBoardFile(){
  const file=getSharedBoardPath()
  try{fs.mkdirSync(path.dirname(file),{recursive:true})}catch{}
  if(!fs.existsSync(file)){
    const stamp=new Date().toISOString()
    fs.writeFileSync(file,[
      '# Team Board · session '+stamp,
      '',
      '<!--',
      'Shared workspace memory for Shosso CLIs.',
      'Keep brief factual notes, current task, decisions, and next steps here.',
      '-->',
      ''
    ].join('\n'))
  }
  return file
}
function readSharedBoard(){
  try{return fs.readFileSync(ensureSharedBoardFile(),'utf8')}catch{return ''}
}
function escapeRegex(text=''){
  return String(text).replace(/[.*+?^${}()|[\]\\]/g,'\$&')
}
function getBoardSection(text, heading){
  const escaped=escapeRegex(heading)
  const match=String(text||'').match(new RegExp('(?:^|\n)## '+escaped+'\n([\s\S]*?)(?=\n## |$)','i'))
  return match?String(match[1]||'').trim():''
}
function upsertBoardSection(text, heading, body){
  const escaped=escapeRegex(heading)
  const section='## '+heading+'\n\n'+String(body||'').trim()
  const pattern=new RegExp('(?:^|\n)## '+escaped+'\n[\s\S]*?(?=\n## |$)','i')
  const current=String(text||'').trimEnd()
  if(pattern.test(current)) return current.replace(pattern,'\n'+section).replace(/^\n/,'').trimEnd()+'\n'
  return current+'\n\n'+section+'\n'
}
function keepLastBoardEntries(body,maxEntries=8){
  const entries=String(body||'').trim().split(/\n(?=- )/g).filter(Boolean)
  return entries.slice(-maxEntries).join('\n')
}
function buildWorkspaceMemoryPack(){
  const board=readSharedBoard()
  const focus=getBoardSection(board,'Current Focus')
  const loops=keepLastBoardEntries(getBoardSection(board,'Open Loops'),6)
  const decisions=keepLastBoardEntries(getBoardSection(board,'Decisions'),6)
  const shared=keepLastBoardEntries(getBoardSection(board,'Shared CLI Memory'),12)
  const turns=keepLastBoardEntries(getBoardSection(board,'Workspace Turn Memory'),8)
  return [
    focus?'## Current Focus\n\n'+focus:'',
    loops?'## Open Loops\n\n'+loops:'',
    decisions?'## Decisions\n\n'+decisions:'',
    shared?'## Shared CLI Memory\n\n'+shared:'',
    turns?'## Workspace Turn Memory\n\n'+turns:''
  ].filter(Boolean).join('\n\n')
}
function appendSharedBoardMemory(note){
  const file=ensureSharedBoardFile()
  const stamp=new Date().toISOString()
  let text=''
  try{text=fs.readFileSync(file,'utf8')}catch{}
  const prev=getBoardSection(text,'Shared CLI Memory')
  const body=keepLastBoardEntries((prev?prev+'\n':'')+'- '+stamp+' '+String(note||'').trim(),12)
  text=upsertBoardSection(text,'Shared CLI Memory',body)
  fs.writeFileSync(file,text,'utf8')
}
function appendWorkspaceTurnMemory(userText,answer){
  const file=ensureSharedBoardFile()
  const stamp=new Date().toISOString()
  let text=''
  try{text=fs.readFileSync(file,'utf8')}catch{}
  const ask=compactText(userText,240)
  const out=compactText(answer,360)
  const currentTurns=getBoardSection(text,'Workspace Turn Memory')
  const currentLoops=getBoardSection(text,'Open Loops')
  const currentDecisions=getBoardSection(text,'Decisions')
  const nextEntry='- '+stamp+' Usuario: '+ask+'\n  Resultado: '+out
  const turns=keepLastBoardEntries((currentTurns?currentTurns+'\n':'')+nextEntry,8)
  const loops=keepLastBoardEntries((currentLoops?currentLoops+'\n':'')+'- '+stamp+' '+ask,6)
  const decisions=keepLastBoardEntries((currentDecisions?currentDecisions+'\n':'')+'- '+stamp+' '+out,6)
  text=upsertBoardSection(text,'Current Focus',['- Objetivo actual: '+ask,'- Último resultado: '+out,'- Última actualización: '+stamp].join('\n'))
  text=upsertBoardSection(text,'Open Loops',loops)
  text=upsertBoardSection(text,'Decisions',decisions)
  text=upsertBoardSection(text,'Workspace Turn Memory',turns)
  fs.writeFileSync(file,text,'utf8')
}
function readLocalMemory(){ ensureMemoryFile(); return fs.readFileSync(MEMORY_FILE,'utf8') }
function readRecentTranscript(maxChars=4000){ ensureTranscriptFile(); const text=fs.readFileSync(TRANSCRIPT_FILE,'utf8'); return text.slice(-maxChars) }
function readMemory() {
  const local=readLocalMemory()
  const board=readSharedBoard().trim()
  if(!board) return local
  return [
    '# Memoria terminal',
    '',
    '## Board compartido',
    board,
    '',
    '## Memoria local',
    local.trim()||'(vacía)'
  ].join('\n')
}
function writeMemory(c) { fs.writeFileSync(MEMORY_FILE,c) }
function appendMemory(n) {
  ensureMemoryFile()
  const line='- '+new Date().toISOString()+' '+n+'\n'
  fs.appendFileSync(MEMORY_FILE,line)
  try{appendSharedBoardMemory(n)}catch{}
}
function clearMemory() {
  writeMemory('# Memoria terminal\n\n')
  try{
    const file=ensureSharedBoardFile()
    let text=fs.readFileSync(file,'utf8')
    text=text.replace(/\n## Shared CLI Memory[\s\S]*$/i,'')
    fs.writeFileSync(file,text.trimEnd()+'\n\n','utf8')
  }catch{}
}
function appendTranscript(role,text) { ensureTranscriptFile(); fs.appendFileSync(TRANSCRIPT_FILE,`## ${role} · ${new Date().toISOString()}\n\n${String(text||'').trim()}\n\n`) }
function compactText(t,max=280){const c=String(t||'').replace(/\s+/g,' ').trim();return c.length<=max?c:c.slice(0,max-1).trimEnd()+'...'}
function sanitizeForTerminal(t) {
  let s = String(t || '').trim()
  s = s.replace(new RegExp('<mention[^>]*>([^<]*)<\/mention>', 'g'), '$1')
  s = s.replace(new RegExp('<mention[^>]*\/>', 'g'), '')
  s = s.replace(new RegExp('<[^>]+>', 'g'), '')
  s = s.replace(new RegExp('\[\^\{\{[^\]]+\}\}\]', 'g'), '')
  return s.trim()
}
function buildVisiblePrompt(userText) {
  const{activeProject=''}=loadState(); const task=compactText(userText)
  return activeProject.trim()?`Proyecto activo: ${activeProject.trim()}\nSolicitud puntual: ${task}`:`Solicitud puntual: ${task}`
}
// Prompt CORTO para conversacion: si la peticion no pide nada del PC, no se le
// ofrecen herramientas. Con el prompt completo, un simple "hey" le hacia
// responder con ordenes EJECUTAR que el CLI ignora pero que el panel muestra
// como actividad, y parecia que el saludo disparaba comandos.
function buildScopedPrompt(userText, reqId) {
  const state=loadState()
  const workspaceMemory=buildWorkspaceMemoryPack().trim().slice(0,8000)
  const memory=readLocalMemory().trim().slice(0,4000)
  const transcript=readRecentTranscript(3000).trim()
  return [
    puenteActivo()?BASE_PREFIX:PREFIJO_MCP,'',
    '=== INICIO DE CONTEXTO DE SESIÓN CLI ===',' ',
    'PROYECTO ACTIVO:',state.activeProject||'(sin proyecto activo)',
    'CARPETA DE TRABAJO:',state.activeCwd||DIR,'',
    'MEMORIA DEL WORKSPACE:',workspaceMemory||'(vacía)','',
    'MEMORIA LOCAL:',memory||'(vacía)','',
    'HILO RECIENTE TERMINAL:',transcript||'(vacío)','',
    'SOLICITUD DEL USUARIO:',userText,'',
    `[reqId:${reqId}]`,
    '=== FIN DE CONTEXTO. RESPONDE SOLO A LA SOLICITUD ANTERIOR ===',
  ].join('\n')
}


// â”€â”€ CDP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
class CdpClient {
  constructor(t){this.target=t;this.targetId=t.id;this.wsUrl=t.webSocketDebuggerUrl;this.ws=null;this.nextId=0;this.pending=new Map()}
  async connect(){
    this.ws=new WebSocket(this.wsUrl)
    await new Promise((res,rej)=>{const t=setTimeout(()=>rej(new Error('Timeout CDP')),10000);this.ws.onopen=()=>{clearTimeout(t);res()};this.ws.onerror=()=>{clearTimeout(t);rej(new Error('Error CDP'))}})
    this.ws.onmessage=ev=>{const m=JSON.parse(ev.data);if(!m.id||!this.pending.has(m.id))return;const p=this.pending.get(m.id);this.pending.delete(m.id);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result)}
    this.ws.onclose=()=>{for(const p of this.pending.values())p.reject(new Error('CDP cerrado'));this.pending.clear()}
    await this.call('Runtime.enable');await this.call('Page.enable').catch(()=>{})
  }
  call(method,params={},timeoutMs=30000){
    return new Promise((res,rej)=>{
      const id=++this.nextId
      const t=setTimeout(()=>{if(!this.pending.has(id))return;this.pending.delete(id);rej(new Error(`Timeout ${method}`))},timeoutMs)
      this.pending.set(id,{resolve:v=>{clearTimeout(t);res(v)},reject:e=>{clearTimeout(t);rej(e)}})
      this.ws.send(JSON.stringify({id,method,params}))
    })
  }
  async evaluate(expr,timeoutMs=30000){
    const out=await this.call('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true},timeoutMs)
    if(out.exceptionDetails){const _ex=out.exceptionDetails;const _desc=(_ex.exception&&(_ex.exception.description||String(_ex.exception.value)))||_ex.text||'Error evaluando';log('[cdp-ex] '+_desc.slice(0,800));throw new Error(_desc.slice(0,400));}
    return out.result?.value
  }
  async activate(){await this.call('Page.bringToFront').catch(()=>{});try{await fetch(`${CDP_HTTP}/json/activate/${this.targetId}`)}catch{};await sleep(250)}
  close(){try{this.ws?.close()}catch{}}
}
async function chatState(cdp){
  const r=await cdp.evaluate(`JSON.stringify({title:document.title,url:location.href,visible:document.visibilityState,focused:document.hasFocus(),input:!!document.querySelector('${INPUT_SEL}'),startNewChat:!!document.querySelector('[aria-label=\"Start new chat\"], [aria-label=\"New chat\"]'),busy:!!document.querySelector('${BUSY_SEL}'),userCount:document.querySelectorAll('${USER_SEL}').length,copyCount:document.querySelectorAll('${COPY_SEL}').length})`)
  return JSON.parse(r)
}
async function inspectChats(){
  const targets=await(await fetch(`${CDP_HTTP}/json`)).json()
  const chats=[]
  for(const t of targets.filter(x=>x.type==='page'&&/^https?:\/\//.test(x.url))){
    const c=new CdpClient(t)
    try{await c.connect();const s=await chatState(c);if(!s.input&&!s.startNewChat){c.close();continue};chats.push({client:c,state:s})}
    catch{c.close()}
  }
  return chats
}
function closeChatClients(chats,except=null){for(const c of chats)if(c.client!==except)c.client.close()}
function scoreChat(c){const s=c.state||{};return(s.focused?1000:0)+(s.visible==='visible'?300:0)+(s.input?100:0)+s.copyCount}
async function getFocusedChat(){const chats=await inspectChats();if(!chats.length)throw new Error('No hay chat de Notion AI disponible');const chosen=[...chats].sort((a,b)=>scoreChat(b)-scoreChat(a))[0];closeChatClients(chats,chosen.client);return chosen}
async function pinCurrentChat(){const chosen=await getFocusedChat();try{const s=await chatState(chosen.client);saveState({selectedChatUrl:s.url,selectedChatTitle:s.title,version:VERSION,selectedAt:new Date().toISOString()});return{url:s.url,title:s.title}}finally{try{chosen.client.close()}catch{}}}
function clearSelectedChat(){const c=loadState();delete c.selectedChatUrl;delete c.selectedChatTitle;delete c.selectedAt;c.version=VERSION;fs.writeFileSync(STATE_FILE,JSON.stringify(c,null,2))}
function extractThreadIdFromUrl(urlText){
  try{
    const u=new URL(urlText)
    let t=u.searchParams.get('t')
    if(!t){
      const m=u.pathname.match(/([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[/?#]|$)/i)
      t=m?.[1]||null
    }
    if(t&&!t.includes('-')&&t.length===32)t=t.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/,'$1-$2-$3-$4-$5')
    return t||null
  }catch{return null}
}
function buildCanonicalChatUrl(urlText){
  const threadId=extractThreadIdFromUrl(urlText||'')
  if(!threadId) return String(urlText||'')
  return 'https://'+'app.notion.com/chat?t='+threadId.replace(/-/g,'')
}
function normalizeTitleText(t){return String(t||'').replace(/\s+/g,' ').replace(/\b(Now|\d+h|Yesterday|Today)\b/g,'').trim()}
async function discoverAllThreads(){
  var ZEN_PROF=process.env.ZEN_PROFILE||'';   // perfil de Zen Browser (opcional): ver README
  var SFS=[
    ZEN_PROF+'/sessionstore-backups/recovery.jsonlz4',
    ZEN_PROF+'/zen-sessions.jsonlz4',
    ZEN_PROF+'/sessionstore-backups/recovery.baklz4',
  ];
  function lz4Dec(inp,maxSz){
    var out=Buffer.alloc(maxSz||inp.length*4);
    var ip=0,op=0,x=0;
    while(ip<inp.length){
      var tok=inp[ip++];var litLen=tok>>4;var mLen=tok&15;
      if(litLen===15){do{x=inp[ip++];litLen+=x;}while(x===255);}
      if(op+litLen>out.length)break;
      inp.copy(out,op,ip,ip+litLen);op+=litLen;ip+=litLen;
      if(ip>=inp.length)break;
      var off=inp[ip]|(inp[ip+1]<<8);ip+=2;
      if(mLen===15){do{x=inp[ip++];mLen+=x;}while(x===255);}
      mLen+=4;var mp=op-off;
      for(var ii=0;ii<mLen;ii++)out[op++]=out[mp++];
    }
    return out.slice(0,op);
  }
  var allT=[];
  for(var fi=0;fi<SFS.length;fi++){
    try{
      var buf=fs.readFileSync(SFS[fi]);
      if(!buf.slice(0,8).toString('ascii').startsWith('mozLz40'))continue;
      var origSz=buf.readUInt32LE(8);
      var dec=lz4Dec(buf.slice(12),origSz+1024);
      var sess=JSON.parse(dec.toString('utf8'));
      var wins=sess.windows||[];
      for(var wi=0;wi<wins.length;wi++){
        var tabs=wins[wi].tabs||[];
        for(var ti=0;ti<tabs.length;ti++){
          var tab=tabs[ti];
          var entries=tab.entries||[];
          var last=entries[entries.length-1]||{};
          var turl=last.url||tab.url||''  ;
          var ttitle=last.title||tab.title||''  ;
          if(!turl.includes('notion'))continue;
          var qpos=turl.indexOf('?t=');
          if(qpos<0)continue;
          var tid=turl.slice(qpos+3).split('&')[0];
          if(!tid||tid.length<10)continue;
          ttitle=ttitle.replace(/\s*\|\s*Notion\s*$/,'')  ||' (sin titulo)';
          allT.push({title:ttitle,url:turl,threadId:tid});
        }
      }
      log('[threads] Zen: '+allT.length+'  threads desde '+SFS[fi].split('/').pop());
      if(allT.length>0)break;
    }catch(e){log('[threads] zenErr: '+e.message.slice(0,80));}
  }
  return allT;
}

async function getSidebarThreads(){
  const client=await getCdpForHidden()
  try{
    const raw=await client.evaluate(`(()=>{const rows=[];const seen=new Set();for(const el of document.querySelectorAll('[role="menuitem"]')){const text=(el.innerText||el.textContent||'').trim().replace(/\s+/g,' ');if(!text)continue;if(!/Welcome to Notion|Revisar MCP|Notion/i.test(text))continue;const title=text.replace(/\b(Now|\d+h|Yesterday|Today)\b/g,'').trim();if(!title||seen.has(title))continue;seen.add(title);rows.push({title,text});}return JSON.stringify(rows)})()`,30000)
    return JSON.parse(raw||'[]')
  }finally{try{client.close()}catch{}}
}
async function listThreads(){
  var allT=await discoverAllThreads().catch(function(){return [];});
  var _stSaved=loadState();var _savedThreads=(_stSaved.savedThreads||[]).map(function(sv){return {title:sv.title,url:sv.url,threadId:extractThreadIdFromUrl(sv.url),source:'saved'};});var _seenUrls=new Set(allT.map(function(x){return x.url;}));_savedThreads.slice().reverse().forEach(function(sv){if(!_seenUrls.has(sv.url)){allT.unshift(sv);}});
  if(allT.length>0){
    var st=loadState();
    var sel=st.selectedChatUrl||st.selectedChatTitle||'';
    var rows=allT.map(function(t,i){
      var isSel=!!(sel&&(t.url===sel||t.title===sel));
      return {index:i+1,title:t.title,url:t.url,threadId:t.threadId,selected:isSel};
    });
    var lines=rows.map(function(r){return '['+r.index+']'+(r.selected?' *':'')+' '+r.title+(r.source==='saved'?' [★]':'')+(r.threadId?' | '+r.threadId.slice(0,8)+'...':'');});
    return {rows:rows,text:lines.join(String.fromCharCode(10))};
  }
  var chats=await inspectChats();
  try{
    var rows2=chats.map(function(ch,i){return {index:i+1,title:ch.state.title||'(sin titulo)',url:ch.state.url,threadId:extractThreadIdFromUrl(ch.state.url),selected:loadState().selectedChatUrl===ch.state.url,source:'tab'};});
    var txt2=rows2.length?rows2.map(function(r){return '['+r.index+']'+(r.selected?' *':'')+' '+r.title;}).join(String.fromCharCode(10)):'No hay chats de Notion AI abiertos.';
    return {rows:rows2,text:txt2};
  }finally{closeChatClients(chats);}
}
async function clickSidebarThread(wanted){
  const client=await getCdpForHidden()
  try{
    const ok=await client.evaluate(`(()=>{const wanted=${JSON.stringify(String(wanted||''))}.toLowerCase();const items=[...document.querySelectorAll('[role="menuitem"]')];let el=null;if(/^\\d+$/.test(wanted)){const matches=items.filter(x=>/Welcome to Notion|Revisar MCP|Notion/i.test((x.innerText||x.textContent||'')));el=matches[Number(wanted)-1]}else{el=items.find(x=>(x.innerText||x.textContent||'').toLowerCase().includes(wanted))}if(!el&&/welcome/.test(wanted))el=items.find(x=>/Welcome to Notion/i.test(x.innerText||x.textContent||''));if(!el)return false;el.scrollIntoView({block:'center'});el.click();return true})()`,30000)
    if(!ok)return null
    await sleep(1500)
    const raw=await client.evaluate(`JSON.stringify({title:document.title,url:location.href})`,30000)
    return JSON.parse(raw||'{}')
  }finally{try{client.close()}catch{}}
}
async function selectThread(value){
  var wanted=String(value||'').trim();
  var allT=await discoverAllThreads().catch(function(){return [];});
  var _stSaved=loadState();var _savedThreads=(_stSaved.savedThreads||[]).map(function(sv){return {title:sv.title,url:sv.url,threadId:extractThreadIdFromUrl(sv.url),source:'saved'};});var _seenUrls=new Set(allT.map(function(x){return x.url;}));_savedThreads.slice().reverse().forEach(function(sv){if(!_seenUrls.has(sv.url)){allT.unshift(sv);}});
  var chosen=null;
  var asNum=parseInt(wanted,10);
  if(!isNaN(asNum)&&asNum>0&&String(asNum)===wanted){
    chosen=allT[asNum-1];
  }else{
    chosen=allT.find(function(t){return (t.title||'').toLowerCase().indexOf(wanted.toLowerCase())>=0;});
    if(!chosen)chosen=allT.find(function(t){return t.threadId&&t.threadId.indexOf(wanted.slice(0,8))===0;});
  }
  if(chosen&&chosen.url){
    var targets=[];
    try{targets=await(await fetch(CDP_HTTP+'/json')).json();}catch(e){}
    var nt=targets.find(function(t){return t.type==='page'&&(t.url||'').indexOf('notion')>=0;});
    if(nt){
      var cl=new CdpClient(nt);
      await cl.connect();
      try{
        await cl.call('Page.navigate',{url:chosen.url});
        await new Promise(function(r){setTimeout(r,1500);});
        var s=await chatState(cl).catch(function(){return {};});
        var finalUrl=s.url||chosen.url;var finalTitle=s.title||chosen.title;
        saveState({selectedChatUrl:finalUrl,selectedChatTitle:finalTitle,threadManuallySelected:true,version:VERSION,selectedAt:new Date().toISOString()});
        log('[thread] Seleccionado: '+finalTitle+' url: '+finalUrl);
        return {url:finalUrl,title:finalTitle,threadId:extractThreadIdFromUrl(finalUrl)};
      }finally{try{cl.close();}catch(e){}}
    }
  }
  var clicked=await clickSidebarThread(wanted).catch(function(){return null;});
  if(clicked&&clicked.url){
    saveState({selectedChatUrl:clicked.url,selectedChatTitle:clicked.title,version:VERSION,selectedAt:new Date().toISOString()});
    return {url:clicked.url,title:clicked.title,threadId:extractThreadIdFromUrl(clicked.url)};
  }
  throw new Error('Thread no encontrado. Usa /thread para ver la lista.');
}

async function connectSelectedChat(){
  const state=loadState()
  const chats=await inspectChats()
  let chosen=null
  if(state.selectedChatUrl||state.selectedChatTitle){
    chosen=chats.find(c=>c.state.url===state.selectedChatUrl)||chats.find(c=>state.selectedChatTitle&&c.state.title===state.selectedChatTitle)||null
  }
  if(!chosen) chosen=chats.find(c=>c.state.visible==='visible')||chats.find(c=>c.state.focused)||chats[0]||null
  if(!chosen){closeChatClients(chats);throw new Error('No encuentro ningun chat de Notion AI abierto. Ábrelo y usa /pin si quieres fijarlo.')}
  closeChatClients(chats,chosen.client);await chosen.client.activate().catch(()=>{})
  saveState({selectedChatUrl:chosen.state.url,selectedChatTitle:chosen.state.title,lastConnectedAt:new Date().toISOString(),version:VERSION})
  return chosen.client
}
async function insertPrompt(cdp,text){
  await cdp.activate()
  const imageScan=extractImagePathsFromPrompt(text)
  const pendingImages=imageScan.files
  let imagesAttached=false
  if(pendingImages.length){
    const baseImageText=imageScan.clean||'Mira la imagen adjunta y describela con detalle.'
    const imageNames=pendingImages.map(p=>String(p).split(/[\\/]/).pop()).join(', ')
    text=baseImageText+' IMPORTANTE: analiza unicamente las imagenes adjuntas de este mensaje: '+imageNames+'. Ignora las imagenes de mensajes anteriores del chat y no las menciones.'
    log('[img] '+pendingImages.length+' imagen(es) detectada(s) en el prompt: '+imageNames)
  }
  const expected=String(text).replace(/\s+/g,' ').trim()
  const promptSel='[contenteditable=\"true\"][role=\"textbox\"], [role=\"textbox\"][contenteditable=\"true\"], textarea, [contenteditable=\"true\"]'
  async function surface(){
    const expr = `(()=>{const nodes=[...document.querySelectorAll(${JSON.stringify('[contenteditable=\"true\"][role=\"textbox\"], [role=\"textbox\"][contenteditable=\"true\"], textarea, [contenteditable=\"true\"]')})].filter(e=>{const r=e.getBoundingClientRect();return r.width>20&&r.height>10});const input=nodes.at(-1)||nodes[0]||null;const start=document.querySelector('[aria-label=\"Start new chat\"]')||document.querySelector('[aria-label=\"New chat\"]');const body=(document.body?.innerText||'').slice(-4000);const allowance=body.match(new RegExp(${JSON.stringify(QUOTA_TEXT_PATTERN)},'i'));const current=input?(input.innerText||input.value||''):'';return JSON.stringify({hasInput:!!input,hasStart:!!start,allowance:allowance?allowance[0]:'',title:document.title,url:location.href,current})})()`
    const raw=await cdp.evaluate(expr).catch(()=>'{\"hasInput\":false,\"hasStart\":false,\"allowance\":\"\",\"current\":\"\"}')
    try{return JSON.parse(String(raw||''))}catch{return {hasInput:false,hasStart:false,allowance:'',current:''}}
  }
  async function clickNewChat(){
    const expr = `(()=>{for(const label of ['Start new chat','New chat']){const e=document.querySelector('[aria-label=\"'+label+'\"]');if(e){e.scrollIntoView({block:\"center\"});e.click();return true}}return false})()`
    return await cdp.evaluate(expr).catch(()=>false)
  }
  async function clearPrompt(){
    const expr = `(()=>{const nodes=[...document.querySelectorAll(${JSON.stringify('[contenteditable=\"true\"][role=\"textbox\"], [role=\"textbox\"][contenteditable=\"true\"], textarea, [contenteditable=\"true\"]')})].filter(e=>{const r=e.getBoundingClientRect();return r.width>20&&r.height>10});const e=nodes.at(-1)||nodes[0];if(!e)return false;e.focus();if(e.tagName===\"TEXTAREA\"){e.value=\"\";}else{e.innerHTML=\"\";e.textContent=\"\";}e.dispatchEvent(new InputEvent(\"input\",{bubbles:true,inputType:\"deleteContentBackward\"}));return true})()`
    return await cdp.evaluate(expr).catch(()=>false)
  }
  async function directWrite(){
    const payload=JSON.stringify(String(text))
    const expr = `(()=>{const nodes=[...document.querySelectorAll(${JSON.stringify('[contenteditable=\"true\"][role=\"textbox\"], [role=\"textbox\"][contenteditable=\"true\"], textarea, [contenteditable=\"true\"]')})].filter(e=>{const r=e.getBoundingClientRect();return r.width>20&&r.height>10});const e=nodes.at(-1)||nodes[0];if(!e)return false;const value=${'${payload}'};e.focus();if(e.tagName===\"TEXTAREA\"){e.value=\"\";e.dispatchEvent(new Event(\"input\",{bubbles:true}));e.value=value;e.dispatchEvent(new Event(\"input\",{bubbles:true}));return true;}e.innerHTML=\"\";e.textContent=value;e.dispatchEvent(new InputEvent(\"input\",{bubbles:true,inputType:\"insertText\",data:value}));return true})()`.replace('${payload}', payload)
    return await cdp.evaluate(expr).catch(()=>false)
  }
  // Notion ignora el Enter sintetico de CDP en su editor nuevo: el texto se
  // quedaba escrito en el composer y la peticion nunca salia. Su boton de enviar
  // si responde a un clic real, asi que se pulsa ese y el Enter queda de reserva.
  async function composerHasText(){
    try{
      const raw=await cdp.evaluate(`(()=>{const n=[...document.querySelectorAll('[contenteditable="true"][role="textbox"], textarea')].at(-1);return JSON.stringify({t:!!((n&&(n.innerText||n.value)||'').trim())})})()`,10000)
      return JSON.parse(String(raw||'{}')).t===true
    }catch{ return true }
  }
  // Devuelve el aviso de limite SOLO si el boton de enviar esta inerte: con el
  // boton vivo, un cartel de "upgrade" suelto en la pagina no impide enviar.
  async function avisoDeCupo(){
    // El patron se aplica AQUI, no dentro de la pagina: interpolarlo en un
    // literal /regex/ rompia el JS evaluado (SyntaxError) y la deteccion nunca
    // llegaba a correr.
    const raw=await cdp.evaluate(`(()=>{
      const b=document.querySelector('[data-testid="agent-send-message-button"],[aria-label="Submit AI message"]');
      if(!b||!(b.disabled||b.getAttribute('aria-disabled')==='true')) return '[]';
      const t=(document.body&&document.body.innerText)||'';
      return JSON.stringify(t.split(String.fromCharCode(10)).map(x=>x.trim()).filter(Boolean).slice(0,300));
    })()`).catch(()=>'[]')
    let lineas=[]; try{ lineas=JSON.parse(String(raw||'[]')) }catch{}
    const re=new RegExp(QUOTA_TEXT_PATTERN,'i')
    return String(lineas.find(x=>re.test(x))||'').slice(0,140)
  }
  async function submitPrompt(){
    // Notion habilita el boton de enviar un instante despues de recibir el
    // texto: pulsarlo de inmediato no hace nada, asi que se espera y se
    // reintenta comprobando que el composer se vacie.
    await sleep(1200)
    for(let intento=0;intento<3;intento++){
      await submitOnce()
      await sleep(1500)
      if(!(await composerHasText())) return true
      // Sin cupo, Notion deja escribir pero DESHABILITA el boton: el texto se
      // queda en el composer y la peticion no llega a publicarse nunca. Antes
      // se reintentaba en bucle; ahora se corta y se rota de workspace.
      const aviso=await avisoDeCupo()
      if(aviso) throw new Error('Notion AI sin cupo o créditos en este workspace: '+aviso)
      log('[submit] el composer sigue con texto; reintento '+(intento+1))
      await sleep(1200)
    }
    return false
  }
  async function submitOnce(){
    // Lo que de verdad envia: el click() del propio boton. Los eventos de raton
    // por CDP y el Enter sintetico los ignora el editor nuevo de Notion.
    try{
      const ok=await cdp.evaluate(`(()=>{const b=document.querySelector('[data-testid="agent-send-message-button"],[aria-label="Submit AI message"]');if(!b)return 'no';b.click();return 'si'})()`,10000)
      if(String(ok)==='si'){ log('[submit] enviado con click() del botón'); return true }
    }catch(error){ log('[submit] click() falló: '+error.message) }
    try{
      const raw=await cdp.evaluate(`(()=>{const b=document.querySelector('[data-testid="agent-send-message-button"],[aria-label="Submit AI message"]');if(!b)return 'null';const r=b.getBoundingClientRect();if(r.width<4||r.height<4)return 'null';return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)})})()`,10000)
      const box=JSON.parse(String(raw||'null'))
      if(box){
        // Secuencia completa: sin el mouseMoved previo ni el campo buttons, React
        // descarta el clic y el prompt se queda escrito sin enviarse.
        const steps=[
          {type:'mouseMoved',button:'none',buttons:0,clickCount:0},
          {type:'mousePressed',button:'left',buttons:1,clickCount:1},
          {type:'mouseReleased',button:'left',buttons:0,clickCount:1},
        ]
        for(const step of steps) await cdp.call('Input.dispatchMouseEvent',{x:box.x,y:box.y,...step}).catch(e=>log('[submit] clic falló: '+e.message))
        log('[submit] botón de enviar pulsado en '+box.x+','+box.y)
        if(await seVacio()) return true
        log('[submit] el clic no publicó: sigue escrito. Reintento con Enter')
      }
      log('[submit] no encontré el botón de enviar; uso Enter')
    }catch(error){ log('[submit] error localizando el botón: '+error.message) }
    // Reserva: si no hay boton visible, se intenta el Enter (funciona en la
    // interfaz antigua; en la nueva Notion lo ignora).
    await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13,text:'\r',unmodifiedText:'\r'}).catch(()=>{})
    await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13}).catch(()=>{})
    return await seVacio()
  }
  // Que el composer quede VACIO es la unica senal de que Notion acepto el
  // mensaje. Sin esto, un clic que React descarta deja el prompt escrito y el
  // CLI espera una respuesta que nunca va a llegar ("no llegó a publicarse").
  async function seVacio(){
    for(let i=0;i<12;i++){
      await sleep(500)
      const t=String((await surface().catch(()=>({current:'?'}))).current||'').replace(/\s+/g,' ').trim()
      if(!t) return true
    }
    return false
  }
  // Sin cupo, Notion NO quita siempre el composer: a veces lo deja escribir y
  // solo deshabilita el boton de enviar ("You've run out of free AI responses").
  // Sin mirar el boton, el CLI reescribia y repulsaba en bucle y la peticion
  // nunca llegaba a publicarse en el chat.
  async function botonInerte(){
    const raw=await cdp.evaluate(`(()=>{const b=document.querySelector('[data-testid="agent-send-message-button"],[aria-label="Submit AI message"]');return JSON.stringify(b?!!(b.disabled||b.getAttribute('aria-disabled')==='true'):false)})()`).catch(()=>'false')
    return String(raw).includes('true')
  }
  for(let attempt=0;attempt<6;attempt++){
    let s=await surface()
    if(s.allowance&&await botonInerte()) throw new Error('Notion AI sin cupo o créditos en este workspace: '+String(s.allowance).slice(0,120))
    if(!s.hasInput&&s.hasStart){
      await clickNewChat().catch(()=>false)
      await sleep(1500)
      s=await surface()
    }
    // Sin cupo, Notion quita el campo de escritura: ningun recovery lo devuelve.
    // Cortar aqui evita ~3 min de reintentos y deja rotar a otro workspace ya.
    if(!s.hasInput&&s.allowance) throw new Error('Notion AI sin cupo o créditos en este workspace: '+String(s.allowance).slice(0,120))
    if(!s.hasInput){
      try{
        const rec=await ensureComposer(cdp,log,loadState())
        log('[recovery] resultado: '+JSON.stringify(rec)); if(rec&&rec.strategy==='ai-deshabilitado') throw new Error('AI DESHABILITADA en el workspace de la cuenta del CLI (Abigail Moya\'s Space). Notion AI no puede responder ni usar el MCP de control de PC desde esa cuenta. Cambia la cuenta activa del CLI a una con Notion AI habilitado.')
      }catch(e){ const __m=String(e&&e.message||e); log('[recovery] error: '+__m); if(/AI DESHABILITADA/.test(__m)) throw e }
      s=await surface()
    }
    if(!s.hasInput&&s.allowance) throw new Error('Notion AI sin cupo o créditos en este workspace/thread')
    const ok=await clearPrompt()
    if(!ok){await sleep(350);continue}
    if(!imagesAttached){
      imagesAttached=true
      await clearComposerAttachments(cdp,log)
      if(pendingImages.length){
        await attachImagesToComposer(cdp,pendingImages,log)
        await sleep(1200)
      }
    }
    // focus() programatico no basta con el editor de Notion: Input.insertText
    // escribe donde tenga el foco REAL el navegador, asi que si no se pincha el
    // composer el texto se pierde y la solicitud nunca se registra.
    try{
      const boxRaw=await cdp.evaluate(`(()=>{const nodes=[...document.querySelectorAll('[contenteditable="true"][role="textbox"], textarea')].filter(e=>{const r=e.getBoundingClientRect();return r.width>20&&r.height>10});const e=nodes.at(-1);if(!e)return 'null';const r=e.getBoundingClientRect();return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)})})()`,10000)
      const box=JSON.parse(String(boxRaw||'null'))
      if(box){
        for(const type of ['mousePressed','mouseReleased']){
          await cdp.call('Input.dispatchMouseEvent',{type,x:box.x,y:box.y,button:'left',clickCount:1}).catch(()=>{})
        }
        await sleep(250)
      }
    }catch{}
    await cdp.call('Input.insertText',{text:String(text)}).catch(()=>{})
    await sleep(500)
    let cur=String((await surface()).current||'').replace(/\s+/g,' ').trim()
    log('[insert] intento '+attempt+' · composer="'+cur.slice(0,60)+'" · esperado="'+expected.slice(0,60)+'"')
    if(cur===expected||cur.startsWith(expected.slice(0,60))){
      if(await submitPrompt()) return
      await sleep(400); continue
    }
    const wrote=await directWrite()
    if(!wrote){await sleep(350);continue}
    await sleep(400)
    cur=String((await surface()).current||'').replace(/\s+/g,' ').trim()
    if(cur===expected||cur.startsWith(expected.slice(0,60))){
      if(await submitPrompt()) return
      await sleep(400); continue
    }
    await sleep(350)
  }
  const endState=await surface()
  if(endState.allowance) throw new Error('Notion AI sin cupo o créditos en este workspace/thread')
  throw new Error('No pude escribir el prompt en el worker real')
}
async function scanVisibleActivity(cdp){
  const raw=await cdp.evaluate(`(()=>{
    const labels=["Copy response","Copiar respuesta"];
    const buttons=[...document.querySelectorAll('button,[aria-label]')].filter(el=>labels.includes(el.getAttribute('aria-label')||''));
    const copy=buttons.at(-1);
    if(!copy)return '[]';
    let turn=copy;
    for(let i=0;i<6&&turn;i++)turn=turn.parentElement;
    if(!turn)return '[]';
    const text=(turn.innerText||'').replace(/\\r/g,'');
    return JSON.stringify(text.split(/\\n+/).map(x=>x.replace(/\\s+/g,' ').trim()).filter(Boolean).slice(-180));
  })()`).catch(()=> '[]')
  let lines=[];try{lines=JSON.parse(raw||'[]')}catch{}
  const out=[]
  const specs=[
    // Formato real del MCP en la interfaz de Notion:
    //   "PC1-cc4d / run_command Input cwd C:\… command powershell -NoProfile …"
    // Sin esto sólo se veía "Worker real activo", sin decir qué estaba haciendo.
    ['PowerShell',/run_command[\s\S]*?command\s+(powershell|pwsh)\s+(.*)/i],
    ['Terminal',/run_command[\s\S]*?command\s+(.*)/i],
    ['Read',/read_text_file[\s\S]*?(?:path|file)\s+(.*)/i],
    ['Write',/write_text_file[\s\S]*?(?:path|file)\s+(.*)/i],
    ['Glob',/list_files[\s\S]*?(?:path|dir|cwd)\s+(.*)/i],
    ['Grep',/search_files[\s\S]*?(?:query|pattern)\s+(.*)/i],
    ['PowerShell',/(?:powershell|pwsh|run_powershell)\s*[:( -]?\s*(.*)/i],
    ['Bash',/(?:^|\b)(?:bash|shell command|run_command)\s*[:( -]?\s*(.*)/i],
    ['Read',/(?:read(?:ing)?|leyendo|read_text_file|open file)\s*[:( -]?\s*(.*)/i],
    ['Write',/(?:write|writing|escribiendo|write_text_file|create file)\s*[:( -]?\s*(.*)/i],
    ['Edit',/(?:edit|editing|editando|patch)\s*[:( -]?\s*(.*)/i],
    ['Glob',/(?:glob|list(?:ing)? (?:files|folders)|listar (?:archivos|carpetas)|revisando (?:archivos|carpetas))\s*[:( -]?\s*(.*)/i],
    ['Grep',/(?:grep|searching in files|buscando en archivos)\s*[:( -]?\s*(.*)/i],
    ['WebFetch',/(?:webfetch|fetching|cargando url)\s*[:( -]?\s*(.*)/i]
  ]
  for(const line of lines){
    if(line.length>500)continue
    let matched=false
    for(const [tool,re] of specs){
      const hit=line.match(re)
      if(hit){
        out.push({kind:'activity',tool,action:(hit[1]||line).trim().slice(0,300),detail:line.slice(0,500)})
        matched=true
        break
      }
    }
    if(!matched&&/^(thinking|pensando|analyzing|analizando|searching|buscando|working|trabajando)\b/i.test(line)){
      out.push({kind:'thought',tool:'Thinking',action:line.slice(0,300),detail:line.slice(0,500)})
    }
  }
  return out
}

async function extractLatestResponse(cdp){
  const text=await cdp.evaluate(`(()=>{const JUNK=/^(Pensamiento|Thinking|Pensando...?|Descubriendo...?|Discovering|\\d+\\s+pasos?|\\d+\\s+steps?)$/i;const LJ=l=>/^(Pensamiento|Thinking|Pensando...?|Descubriendo...?|Discovering|\\d+\\s+pasos?|\\d+\\s+steps?|P|KIWI|\\/)$/i.test(l)||/^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(l);const b=[...document.querySelectorAll('${COPY_SEL}')].at(-1);if(!b)return'';let turn=b;for(let i=0;i<4&&turn;i++)turn=turn.parentElement;if(!turn)return'';const col=[...turn.children].sort((a,c)=>((c.innerText||'').length)-((a.innerText||'').length))[0];const kids=col?[...col.children]:[];const parts=[];for(const kid of kids){const t=(kid.innerText||'').trim();if(!t)continue;if(JUNK.test(t))continue;const lines=t.split('\\n').map(l=>l.trim()).filter(Boolean);if(lines.length&&lines.every(LJ))continue;parts.push(lines.filter(l=>!LJ(l)).join('\\n'));}const clean=parts.join('\\n\\n').trim();if(clean)return clean;return((col?.innerText)||(turn.innerText)||'').split('\\n').filter(l=>!LJ(l.trim())).join('\\n').trim();})()`).catch(()=>'')
  return String(text||'').trim()
}
async function waitUntil(fn,ms,interval=500,label='condición'){const s=Date.now();while(Date.now()-s<ms){try{const v=await fn();if(v)return v}catch{};await sleep(interval)};throw new Error(`Timeout esperando ${label}`)}
async function waitForCompletedResponse(cdp,before,progress=()=>{},ms=10*60_000){
  const started=Date.now()
  const seen=new Set()
  while(Date.now()-started<ms){
    const events=await scanVisibleActivity(cdp)
    for(const event of events){
      const key=[event.kind,event.tool,event.action,event.detail].join('|')
      if(seen.has(key))continue
      seen.add(key)
      progress('working',event.action,event)
    }
    const st=await chatState(cdp)
    if(!st.busy&&st.copyCount>before.copyCount){
      const answer=await extractLatestResponse(cdp)
      if(answer)return answer
    }
    if(!st.busy&&Date.now()-started>2500){
      const answer=await extractLatestResponse(cdp)
      if(answer)return answer
    }
    await sleep(650)
  }
  throw new Error('Timeout esperando respuesta del worker real')
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// PARSER v9.7: filtra thinking a nivel de step Y a nivel de item de contenido
// Guardamos siempre el raw para poder diagnosticar.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const THINKING_STEP_TYPES = new Set([
  'agent-thinking', 'thinking', 'agent-reasoning', 'reasoning',
  'agent-scratchpad', 'scratchpad', 'model-thinking', 'agent-thoughts',
  'thought', 'agent-thought', 'agent-inner-monologue', 'inner-monologue'
])
const THINKING_ITEM_TYPES = new Set([
  'thinking', 'reasoning', 'scratchpad', 'thought', 'inner-monologue'
])
const RESPONSE_STEP_TYPES = new Set(['agent-inference','agent-response','inference','response'])

function isThinkingItem(v) {
  if (!v || typeof v !== 'object') return false
  if (v.thinking === true || v.isThinking === true) return true
  if (THINKING_ITEM_TYPES.has(v.type)) return true
  return false
}

function parseHiddenResponseRaw(raw) {
  const rawStr = String(raw || '')
  const stepBuckets = new Map()
  const thinkingIndexes = new Set()
  let inferenceIndexes = []

  // Formato JSON array (no NDJSON)
  const trimmed = rawStr.trimStart()
  if (trimmed.startsWith('[') && trimmed.length > 1) {
    try {
      const arr = JSON.parse(rawStr)
      const texts = []
      for (const item of Array.isArray(arr) ? arr : []) {
        if (THINKING_STEP_TYPES.has(item?.type)) continue
        const val = item?.value || item?.content || item?.text
        if (typeof val === 'string' && val.trim()) texts.push(val.trim())
        if (Array.isArray(val)) {
          for (const p of val) {
            if (isThinkingItem(p)) continue
            const t = p?.content || p?.text || ''
            if (t.trim()) texts.push(t.trim())
          }
        }
      }
      if (texts.length) return texts.join('\n').trim()
    } catch {}
  }

  // Formato NDJSON
  const lines = rawStr.split(/\n+/).filter(Boolean)
  for (const line of lines) {
    let j; try { j = JSON.parse(line) } catch { continue }

    // patch-sync: detectar tipos de steps (thinking vs inference)
    if (j.type === 'patch-sync' && Array.isArray(j.data?.s)) {
      j.data.s.forEach((item, idx) => {
        if (!item) return
        if (THINKING_STEP_TYPES.has(item.type)) {
          thinkingIndexes.add(idx)
          return
        }
        if (RESPONSE_STEP_TYPES.has(item.type)) {
          inferenceIndexes.push(idx)
          // Items ya presentes en el patch-sync
          const texts = (Array.isArray(item.value) ? item.value : []).filter(p => !isThinkingItem(p)).map(p => String(p?.content || p?.text || '')).filter(Boolean)
          if (texts.length) stepBuckets.set(idx, texts)
        }
      })
    }

    // patches incrementales
    if (j.type === 'patch' && Array.isArray(j.v)) {
      for (const op of j.v) {
        const sm = /^\/s\/(\d+)/.exec(op?.p || '')
        if (!sm) continue
        const idx = Number(sm[1])
        if (thinkingIndexes.has(idx)) continue // step completo de thinking: skip

        // Append de item: /s/N/value/-
        let m = /^\/s\/(\d+)\/value\/-$/.exec(op.p)
        if (op.o === 'a' && m) {
          if (isThinkingItem(op.v)) continue // item de thinking dentro de step: skip
          if (op.v?.type !== 'text') continue // solo items de texto
          const p = stepBuckets.get(idx) || []
          p.push(String(op.v.content || op.v.text || ''))
          stepBuckets.set(idx, p)
          continue
        }

        // Replace de contenido de item: /s/N/value/M/content
        m = /^\/s\/(\d+)\/value\/(\d+)\/content$/.exec(op.p)
        if (op.o === 'x' && m) {
          const p = stepBuckets.get(idx) || []
          p[Number(m[2])] = String(op.v || '')
          stepBuckets.set(idx, p)
          continue
        }

        // Replace de texto directo: /s/N/text
        m = /^\/s\/(\d+)\/text$/.exec(op.p)
        if (op.o === 'x' && m) {
          const p = stepBuckets.get(idx) || []
          p.push(String(op.v || ''))
          stepBuckets.set(idx, p)
        }
      }
    }

    // Formato alternativo: objetos con type de inference directo en el stream
    if (j.type && RESPONSE_STEP_TYPES.has(j.type)) {
      const existing = stepBuckets.get(-1) || []
      if (isThinkingItem(j)) continue
      const t = j.content || j.text || j.value || ''
      if (typeof t === 'string' && t.trim()) { existing.push(t.trim()); stepBuckets.set(-1, existing) }
    }
  }

  // Tomar el último step de inference que no sea thinking
  const validIdx = inferenceIndexes.filter(i => !thinkingIndexes.has(i))
  const pick = validIdx.length
    ? validIdx[validIdx.length - 1]
    : [...stepBuckets.keys()].filter(i => !thinkingIndexes.has(i)).sort((a, b) => b - a)[0]

  const primary = pick !== undefined ? (stepBuckets.get(pick) || []).join('').trim() : ''
  if (primary) return primary

  const allTexts = []
  for (const [i, texts] of stepBuckets) if (!thinkingIndexes.has(i)) allTexts.push(...texts)
  return allTexts.join('').trim()
}

// Analiza el raw y devuelve un resumen de tipos de steps para debug
function analyzeRaw(raw) {
  const lines = String(raw || '').split(/\n+/).filter(Boolean)
  const stepTypes = new Map()
  const itemTypes = new Map()
  let patchCount = 0
  for (const line of lines) {
    let j; try { j = JSON.parse(line) } catch { continue }
    if (j.type === 'patch-sync' && Array.isArray(j.data?.s)) {
      j.data.s.forEach((s, i) => { stepTypes.set(i, s?.type || '(null)') })
    }
    if (j.type === 'patch' && Array.isArray(j.v)) {
      patchCount += j.v.length
      for (const op of j.v) { if (op.v?.type) { const c = (itemTypes.get(op.v.type)||0)+1; itemTypes.set(op.v.type,c) } }
    }
  }
  return { stepTypes: Object.fromEntries(stepTypes), itemTypes: Object.fromEntries(itemTypes), patchCount, totalLines: lines.length }
}

// â”€â”€ buildHiddenRunExpression v9.7 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function extractHiddenError(raw){
  const text=String(raw||'').trim()
  if(!text) return 'Notion devolviÃƒÆ’Ã‚Â³ HTTP 200 sin cuerpo. La conexiÃƒÆ’Ã‚Â³n terminÃƒÆ’Ã‚Â³ antes de entregar la respuesta.'
  const candidates=[]
  for(const line of text.split(/\n+/)){
    let j;try{j=JSON.parse(line)}catch{continue}
    const walk=(v,depth=0)=>{
      if(!v||depth>6)return
      if(typeof v==='string')return
      if(Array.isArray(v)){for(const x of v)walk(x,depth+1);return}
      if(typeof v==='object'){
        const msg=v.error||v.message||v.errorMessage||v.displayMessage
        const sub=v.subType||v.subtype||v.code
        if(typeof msg==='string'&&msg.trim())candidates.push((sub?sub+': ':'')+msg.trim())
        for(const x of Object.values(v))walk(x,depth+1)
      }
    }
    walk(j)
  }
  return candidates.find(x=>!/^http\s*200$/i.test(x))||''
}

function buildHiddenRunExpression(userText, hiddenContext, model = 'gpt-5.6') {
  return [
    '(async function runHidden() {',
    '  try {',
    '    var url = new URL(location.href);',
    "    var rawT = new URL(location.href).searchParams.get('t');",
    "    var threadId = rawT || null;",
    "    if (threadId && threadId.indexOf('-') < 0) threadId = threadId.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');",
    "    if (!threadId) return {ok:false,error:'No se encontró un thread activo de Notion AI'};",
    "    var userIdRaw = localStorage.getItem('LRU:KeyValueStore2:current-user-id');",
    "    var spaceIdRaw = localStorage.getItem('LRU:KeyValueStore2:current-space-id');",
    "    var userId = userIdRaw ? JSON.parse(userIdRaw).value : null;",
    "    var spaceId = (spaceIdRaw ? JSON.parse(spaceIdRaw).value : null) || 'a5221cf1-2845-810a-8e57-000307861c12';",
    '    var nowIso = new Date().toISOString();',
    "    var configValue = {type:'workflow',model:" + JSON.stringify(model) + ",reasoningEffort:'default',modelFromUser:true};",
    '    var transcript = [',
    "      {id:crypto.randomUUID(),type:'config',value:configValue},",
    "      {id:crypto.randomUUID(),type:'context',value:{userId:userId,spaceId:spaceId,surface:'full_page_chat',timezone:'America/Caracas',currentDatetime:nowIso}},",
    "      {id:crypto.randomUUID(),type:'updated-config'},",
    "      {id:crypto.randomUUID(),type:'user',userId:userId,value:[[" + JSON.stringify(hiddenContext + '\n\n' + userText) + "]],createdAt:nowIso}",
    '    ];',
    "    var body = JSON.stringify({traceId:crypto.randomUUID(),spaceId:spaceId,threadId:threadId,createThread:false,generateTitle:false,saveAllThreadOperations:false,setUnreadState:false,createdSource:'ai_module',threadType:'workflow',isPartialTranscript:true,asPatchResponse:true,patchResponseVersion:2,isUserInAnySalesAssistedSpace:false,isSpaceSalesAssisted:false,supportsCustomAgentNudgeTranscriptStep:true,transcript:transcript});",
    "    var res = await fetch('/api/v3/runInferenceTranscript',{",
    "      method:'POST',credentials:'include',",
    "      headers:{'content-type':'application/json','accept':'application/x-ndjson','notion-audit-log-platform':'web','x-notion-active-user-header':userId || '','x-notion-space-id':spaceId || ''},",
    '      body:body',
    '    });',
    "    var reader = res.body && res.body.getReader ? res.body.getReader() : null; var decoder = new TextDecoder('utf-8'); var raw = '';",
    '    if (reader) { var chunk; while (!(chunk = await reader.read()).done) raw += decoder.decode(chunk.value,{stream:true}); } else { raw = await res.text(); }',
    '    return {ok:res.ok,status:res.status,raw:raw,threadId:threadId,spaceId:spaceId,userId:userId};',
    '  } catch(e) { return {ok:false,error:String(e && (e.stack || e.message || e))}; }',
    '})()'
  ].join('\n')
}

// â”€â”€ runHiddenPrompt v9.7 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function runHiddenPrompt(cdp, userText, progress=()=>{}) {
  const reqId = Math.random().toString(36).slice(2, 10)
  const hiddenContext = buildScopedPrompt(userText, reqId)
  const { activeModel: model = 'gpt-5.6' } = loadState()
  let lastErr
  for (let attempt = 1; attempt <= 2; attempt++) {
    let heartbeat
    try {
      progress('sending','Enviando la solicitud al modelo',{tool:'WebFetch',action:'runInferenceTranscript',detail:'Intento '+attempt+' de 2'})
      const waitStarted=Date.now()
      heartbeat=setInterval(()=>{
        const sec=Math.floor((Date.now()-waitStarted)/1000)
        progress('working','Notion AI continÃƒÆ’Ã‚Âºa analizando y usando herramientas',{tool:'Task',action:'Inferencia activa Ãƒâ€šÃ‚Â· '+sec+'s',detail:'Esperando eventos y respuesta final'})
      },12000)
      const result = await cdp.evaluate(buildHiddenRunExpression(userText, hiddenContext, model), 7*60_000)
      clearInterval(heartbeat);heartbeat=null
      progress('parsing','Procesando eventos y respuesta',{tool:'Read',action:'Respuesta de Notion AI',detail:'HTTP '+(result?.status??'?')})
      if (result?.raw !== undefined) {
        const analysis = analyzeRaw(result.raw)
        fs.writeFileSync(DEBUG_RAW_FILE, String(result.raw || '(vacÃƒÆ’Ã‚Â­o)'))
        fs.writeFileSync(path.join(DIR,'last-hidden-analysis.json'), JSON.stringify({analysis,status:result.status,threadId:result.threadId,receivedBytes:String(result.raw||'').length},null,2))
      }
      if (!result?.ok) throw new Error(result?.error || extractHiddenError(result?.raw) || ('HTTP ' + (result?.status ?? '?')))
      if (String(result.raw || '').trim() === '[' || /\n\[$/.test(String(result.raw || '').trim())) throw new Error('Notion AI estÃƒÆ’Ã‚Â¡ ocupado por otra inferencia')
      const answer = parseHiddenResponseRaw(result.raw)
      if (!answer) throw new Error(extractHiddenError(result.raw)||`HTTP ${result.status} sin respuesta textual utilizable`)
      log(`[hidden] ok attempt=${attempt} chars=${answer.length} thread=${result.threadId}`)
      return answer
    } catch (err) {
      if(heartbeat)clearInterval(heartbeat)
      lastErr = err; log(`[hidden] attempt=${attempt} err: ${err.message}`)
      if (attempt < 2) {
        progress('retrying','La primera ejecuciÃƒÆ’Ã‚Â³n no terminÃƒÆ’Ã‚Â³ correctamente; reintentando',{tool:'Task',action:'Reintento automÃƒÆ’Ã‚Â¡tico 2/2',detail:err.message})
        await sleep(5000)
      }
    }
  }
  throw lastErr
}
// â”€â”€ processPrompt â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function ensureCdpAvailable() {
  for (let i=0;i<2;i++) {
    try {
      const r=await fetch(`${CDP_HTTP}/json`)
      if(r.ok) return await r.json()
    } catch {}
    log('[cdp] No disponible; arrancando Notion CDP...')
    spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(DIR,'start-notion-cdp.ps1')],{cwd:DIR,stdio:'ignore',windowsHide:true})
    await sleep(2500)
  }
  const r=await fetch(`${CDP_HTTP}/json`)
  return await r.json()
}
// Workspace en caliente: se deja el SIGUIENTE candidato con cupo ya cargado en
// una pestaña aparte del motor. Cuando el actual se agota, rotar deja de
// significar "arrancar la app de Notion otra vez" (lo más lento del salto).
let precalentado=null   // { spaceId, targetId }
async function cdpTargets(){
  try{ return await (await fetch(CDP_HTTP+'/json',{signal:AbortSignal.timeout(5000)})).json() }catch{ return [] }
}
async function cerrarTarget(id){
  if(!id) return
  try{ await fetch(CDP_HTTP+'/json/close/'+id,{signal:AbortSignal.timeout(5000)}) }catch{}
}
async function precalentarSiguiente(){
  try{
    const actual=getSelectedAccountKey()
    const siguiente=listRotatableAccounts([actual])[0]
    if(!siguiente?.spaceId) return
    if(precalentado?.spaceId===siguiente.spaceId){
      const vivos=await cdpTargets()
      if(vivos.some(t=>t.id===precalentado.targetId)) return   // ya está listo
    }
    await cerrarTarget(precalentado?.targetId)
    const url=spaceChatUrl(siguiente.spaceId)
    let res=await fetch(CDP_HTTP+'/json/new?'+encodeURIComponent(url),{method:'PUT',signal:AbortSignal.timeout(8000)}).catch(()=>null)
    if(!res||!res.ok) res=await fetch(CDP_HTTP+'/json/new?'+encodeURIComponent(url),{signal:AbortSignal.timeout(8000)}).catch(()=>null)
    const t=res&&res.ok?await res.json().catch(()=>null):null
    if(t?.id){ precalentado={spaceId:siguiente.spaceId,targetId:t.id}; log('[precalentado] '+siguiente.workspace+' ('+siguiente.spaceId.slice(0,8)+') listo para el salto') }
  }catch(error){ log('[precalentado] '+String(error.message||error).slice(0,100)) }
}
/** Si el destino ya estaba precargado, se deja SOLO esa pestaña: el salto es inmediato. */
async function usarPrecalentado(spaceId){
  if(!precalentado||precalentado.spaceId!==spaceId) return false
  const targets=await cdpTargets()
  if(!targets.some(t=>t.id===precalentado.targetId)) { precalentado=null; return false }
  for(const t of targets){
    if(t.type==='page'&&/notion/i.test(t.url||'')&&t.id!==precalentado.targetId) await cerrarTarget(t.id)
  }
  log('[precalentado] salto inmediato a '+spaceId.slice(0,8))
  precalentado=null
  return true
}
async function getCdpForHidden() {
  const synchronizedAccount=await ensureSelectedAccountSynchronized()
  const targets = await ensureCdpAvailable()
  const state = loadState()
  let pages = targets.filter(x => x.type === 'page' && /^https?:/i.test(x.url || '') && /notion/i.test(x.url || ''))
  if (!pages.length) {
    spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(DIR,'start-notion-cdp.ps1')],{cwd:DIR,stdio:'ignore',windowsHide:true})
    await sleep(3500)
    const retryTargets = await ensureCdpAvailable()
    pages = retryTargets.filter(x => x.type === 'page' && /^https?:/i.test(x.url || '') && /notion/i.test(x.url || ''))
    if(!pages.length) throw new Error('No hay paginas de Notion con CDP. Reabre Notion.')
  }
  const preferred = pages.find(p => state.selectedChatUrl && p.url === state.selectedChatUrl)
    || pages.find(p => state.selectedChatTitle && p.title?.includes(state.selectedChatTitle))
    || pages.find(p => /welcome.?to.?notion/i.test(p.title || ''))
    || pages[0]
  const client = new CdpClient(preferred)
  await client.connect()
  let workspaceSwitched=false
  if(synchronizedAccount?.spaceId){
    const actualSpace=await client.evaluate("(()=>{try{return JSON.parse(localStorage.getItem('LRU:KeyValueStore2:current-space-id')||'null')?.value||null}catch{return null}})()",10000).catch(()=>null)
    if(actualSpace!==synchronizedAccount.spaceId){
      log('[sync] Corrigiendo workspace real '+String(actualSpace||'ninguno')+' -> '+synchronizedAccount.spaceId)
      const identity=JSON.stringify({userId:synchronizedAccount.userId||synchronizedAccount.uid||null,spaceId:synchronizedAccount.spaceId})
      await client.evaluate("(()=>{const x="+identity+";if(x.userId)localStorage.setItem('LRU:KeyValueStore2:current-user-id',JSON.stringify({value:x.userId}));localStorage.setItem('LRU:KeyValueStore2:current-space-id',JSON.stringify({value:x.spaceId}));return true})()",10000)
      // Sin ?spaceId= Notion ignora el localStorage y devuelve el espacio por
      // defecto: la espera de sincronizacion no se cumplia nunca.
      // /ai?spaceId= REDIRIGE a /chat perdiendo el spaceId, y esa pantalla no
      // monta composer ni boton de chat nuevo: la espera de sincronizacion no se
      // cumplia nunca y toda peticion moria en 'Timeout esperando sincronizacion'.
      // Si NINGUNA ruta abre el espacio, ese workspace no sirve (borrado, sin
      // acceso o con la IA apagada): se descarta y se rota, en vez de seguir
      // esperando un composer que no va a aparecer.
      if(!(await abrirEspacio(client,synchronizedAccount.spaceId))){
        marcarAgotado(makeAccountKey(synchronizedAccount),'sin-acceso')
        try{client.close()}catch{}
        throw new Error('AI DESHABILITADA o workspace inaccesible: '+formatAccountLabel(synchronizedAccount))
      }
      // Medida inmediata del espacio recien abierto: saber AHORA si sirve cuesta
      // 2-3 s, mientras que descubrirlo por silencio cuesta los 45 s del
      // vigilante mas la rotacion. Con esto la respuesta no paga esa espera.
      const estado=await medirEspacioAbierto(client)
      if(!estado.usable){
        if(estado.plan==='sesion-caida'){
          try{client.close()}catch{}
          throw new Error('SESION CAIDA en '+formatAccountLabel(synchronizedAccount)+': hay que restaurar las cookies')
        }
        if(estado.plan==='onboarding'){
          // La pantalla esta secuestrada por el asistente de alta, pero el
          // workspace puede tener cupo de sobra: se rota SIN tacharlo, o el pool
          // se iria vaciando por un problema que no es de cupo.
          log('[medida] '+formatAccountLabel(synchronizedAccount)+' atrapado en el asistente de alta; roto sin tacharlo')
          try{client.close()}catch{}
          throw new Error('Notion AI se quedó sin avanzar: asistente de alta en '+formatAccountLabel(synchronizedAccount))
        }
        marcarAgotado(makeAccountKey(synchronizedAccount),estado.plan)
        log('[medida] '+formatAccountLabel(synchronizedAccount)+' descartado al instante ('+estado.plan+')')
        try{client.close()}catch{}
        throw new Error('Notion AI sin cupo o créditos en '+formatAccountLabel(synchronizedAccount)+' ('+estado.plan+')')
      }
      await sleep(4000)
      await waitUntil(async()=>{try{return await client.evaluate("(()=>{let s=null;try{s=JSON.parse(localStorage.getItem('LRU:KeyValueStore2:current-space-id')||'null')?.value||null}catch{};return s==="+JSON.stringify(synchronizedAccount.spaceId)+"&&!!document.querySelector('[contenteditable=\"true\"][role=\"textbox\"], [aria-label=\"Start new chat\"], [aria-label=\"New chat\"]')})()",10000)}catch{return false}},45000,500,'sincronizacion de workspace MCP')
      workspaceSwitched=true
      saveState({selectedChatUrl:'https://'+'app.notion.com/chat?spaceId='+synchronizedAccount.spaceId,selectedChatTitle:synchronizedAccount.workspace||'Workspace MCP',lastSelectedAccount:synchronizedAccount,version:VERSION})
    }
  }
  // Un cambio de módulo MCP invalida el thread anterior: Notion congela el catálogo de herramientas por thread.
  // Con el puente no hay modulo MCP que sincronizar: ese bloque abria threads
  // nuevos y esperaba composers por un MCP que ya no se usa, y costaba ~30 s en
  // cada peticion (ademas de las rotaciones inutiles cuando no cuadraba).
  if(!puenteActivo()&&state.mcpActiveModuleId&&state.mcpValidatedThreadModuleId!==state.mcpActiveModuleId){
    if(state.threadManuallySelected&&String(state.selectedChatUrl||'').includes('?t=')){
      log('[mcp-sync] threadManuallySelected=true; preservando thread, validando módulo sin switch');
      saveState({mcpValidatedThreadModuleId:state.mcpActiveModuleId,version:VERSION});
    } else {
    if(state.threadManuallySelected&&String(state.selectedChatUrl||'').includes('?t=')){
      log('[mcp-sync] threadManuallySelected=true; preservando thread, validando módulo sin switch');
      saveState({mcpValidatedThreadModuleId:state.mcpActiveModuleId,version:VERSION});
    } else {
    log('[mcp-sync] Módulo MCP cambió; creando thread fresco para '+String(loadState().mcpExpectedName||state.mcpActiveModuleId))
    if(synchronizedAccount?.spaceId){
      const identity=JSON.stringify({userId:synchronizedAccount.userId||synchronizedAccount.uid||null,spaceId:synchronizedAccount.spaceId})
      await client.evaluate("(()=>{const x="+identity+";if(x.userId)localStorage.setItem('LRU:KeyValueStore2:current-user-id',JSON.stringify({value:x.userId}));localStorage.setItem('LRU:KeyValueStore2:current-space-id',JSON.stringify({value:x.spaceId}));return true})()",10000)
    }
    // Sin &spaceId la app abre SIEMPRE el espacio principal, aunque la cuenta
    // sincronizada sea otra: el thread "fresco" nacia en el workspace de siempre.
    // La ruta del chat la fija Notion y cambia entre despliegues: con la
    // equivocada esta pantalla no monta composer y se perdian 90 s aqui.
    const freshModuleUrl='https://app.notion.com'+rutaChatActual()+'?mcpModule='+encodeURIComponent(String(state.mcpActiveModuleId))+(synchronizedAccount?.spaceId?'&spaceId='+encodeURIComponent(synchronizedAccount.spaceId):'')
    await client.call('Page.navigate',{url:freshModuleUrl},30000)
    await sleep(4500)
    // Si este workspace se quedo sin cupo no hay composer que esperar: cortar ya
    // para que la rotacion pruebe otro en vez de agotar 90 s aqui.
    try{
      const q=JSON.parse(String(await client.evaluate(`JSON.stringify({composer:!!document.querySelector('[contenteditable=\"true\"][role=\"textbox\"], textarea'),body:(document.body?.innerText||'').slice(-1500)})`,10000)||'{}'))
      if(!q.composer&&new RegExp(QUOTA_TEXT_PATTERN,'i').test(String(q.body||''))){
        throw new Error('Notion AI sin cupo o créditos en '+formatAccountLabel(synchronizedAccount))
      }
    }catch(quotaError){ if(/sin cupo o créditos/i.test(quotaError.message)) throw quotaError }
    await waitUntil(async()=>{try{return await client.evaluate("!!document.querySelector('[contenteditable=\"true\"][role=\"textbox\"], [aria-label=\"Start new chat\"], [aria-label=\"New chat\"]')",10000)}catch{return false}},90000,500,'thread fresco para MCP')
    workspaceSwitched=true
    saveState({selectedChatUrl:freshModuleUrl,selectedChatTitle:(synchronizedAccount?.workspace||'Workspace MCP')+' | '+String(loadState().mcpExpectedName||'MCP'),mcpValidatedThreadModuleId:state.mcpActiveModuleId||null,version:VERSION})
    }// end else-threadManuallySelected
    }// end else-threadManuallySelected
  }
  // Verifica que el thread seleccionado pertenezca realmente al workspace MCP activo.
  let selectedThreadValid=false
  const candidateThread=extractThreadIdFromUrl(state.selectedChatUrl)
  if(!workspaceSwitched&&candidateThread&&synchronizedAccount?.spaceId){
    const probeExpr="(async()=>{try{const threadId="+JSON.stringify(candidateThread)+",spaceId="+JSON.stringify(synchronizedAccount.spaceId)+",userId="+JSON.stringify(synchronizedAccount.userId||synchronizedAccount.uid||null)+";const body={requests:[{pointer:{table:'thread',id:threadId,spaceId},version:-1}],spacePointer:{table:'space',id:spaceId}};const r=await fetch('/api/v3/syncRecordValuesSpaceInitial',{method:'POST',credentials:'include',headers:{'content-type':'application/json','x-notion-space-id':spaceId,'x-notion-active-user-header':userId},body:JSON.stringify(body)});const p=await r.json();return !!(p?.recordMap?.thread?.[threadId])}catch{return false}})()"
    // El atajo solo vale si el hilo es DE ESTA cuenta: aceptar cualquier ?t=
    // hacia navegar a un hilo de otro workspace, Notion recargaba con un chat
    // nuevo y la peticion se perdia con su cupo ya gastado.
    const dueno=state.selectedChatOwnerKey||''
    const actual=makeAccountKey(synchronizedAccount)
    if(state.selectedChatUrl&&state.selectedChatUrl.includes('?t=')&&dueno&&dueno===actual){
  selectedThreadValid=true;
  log('[mcp-sync] Thread con ?t= de esta misma cuenta: aceptado');
}else if(state.selectedChatUrl&&state.selectedChatUrl.includes('?t=')&&dueno&&dueno!==actual){
  selectedThreadValid=false;
  log('[mcp-sync] El hilo guardado es de otra cuenta; estreno chat en este workspace');
}else{
  selectedThreadValid=await client.evaluate(probeExpr,30000).catch(()=>false);
}
  }
  if(state.selectedChatUrl&&!selectedThreadValid){
    log('[mcp-sync] Thread seleccionado no pertenece al workspace '+String(synchronizedAccount?.spaceId||'')+'; abriendo chat nuevo')
    if(synchronizedAccount?.spaceId){
      const identity=JSON.stringify({userId:synchronizedAccount.userId||synchronizedAccount.uid||null,spaceId:synchronizedAccount.spaceId})
      await client.evaluate("(()=>{const x="+identity+";if(x.userId)localStorage.setItem('LRU:KeyValueStore2:current-user-id',JSON.stringify({value:x.userId}));localStorage.setItem('LRU:KeyValueStore2:current-space-id',JSON.stringify({value:x.spaceId}));return true})()",10000)
    }
    // mcpWorkspace no significa nada para Notion: el parametro que abre un
    // espacio concreto es spaceId. Con el otro, el chat "nuevo" nacia siempre en
    // el workspace principal y se esperaba un composer que alli no existe.
    const freshAiUrl='https://app.notion.com'+rutaChatActual()+'?spaceId='+encodeURIComponent(String(synchronizedAccount?.spaceId||''))
    await client.call('Page.navigate',{url:freshAiUrl},30000)
    await sleep(4500)
    await waitUntil(async()=>{try{return await client.evaluate("!!document.querySelector('[contenteditable=\"true\"][role=\"textbox\"], [aria-label=\"Start new chat\"], [aria-label=\"New chat\"]')",10000)}catch{return false}},45000,500,'nuevo chat del workspace MCP').catch(e=>{ log('[mcp-sync] el chat nuevo tardó; sigo igual ('+String(e.message||e).slice(0,60)+')') })
    workspaceSwitched=true
    saveState({selectedChatUrl:freshAiUrl,threadManuallySelected:false,selectedChatTitle:(synchronizedAccount?.workspace||'Workspace MCP')+' | MCP',lastSelectedAccount:synchronizedAccount,version:VERSION})
  }
  // Un thread guardado puede vivir en un workspace ya descartado (sin cupo o con
  // la IA apagada): navegar a el se saltaba toda la comprobacion y la peticion
  // moria alli. Si el thread no es del workspace activo, se ignora.
  if(state.selectedChatUrl&&synchronizedAccount?.spaceId){
    // Los chats guardados como ?t=<thread> no llevan el workspace en la URL, asi
    // que se compara con la cuenta que lo guardo: si la peticion va a otra, ese
    // hilo es de otro espacio (y puede ser uno con la IA apagada).
    const dueno=state.selectedChatOwnerKey
    const suSpace=String(state.selectedChatUrl).match(/spaceId=([0-9a-f-]{36})/i)?.[1]
      ||(dueno&&dueno!==makeAccountKey(synchronizedAccount)?String(dueno).split('::')[1]:null)
    if(suSpace&&suSpace!==synchronizedAccount.spaceId){
      log('[thread] el chat guardado es de otro workspace ('+suSpace.slice(0,8)+'); lo ignoro')
      state.selectedChatUrl=null
      saveState({selectedChatUrl:spaceChatUrl(synchronizedAccount.spaceId),threadManuallySelected:false,version:VERSION})
    }
  }
  // El modo hidden usa el chat dedicado solo después de validar su workspace.
  if(state.selectedChatUrl&&(!workspaceSwitched||(state.threadManuallySelected&&String(state.selectedChatUrl||'').includes('?t=')))&&selectedThreadValid){
    try{
      const desiredUrl=buildCanonicalChatUrl(state.selectedChatUrl)
      const current=await client.evaluate('location.href')
      const currentThread=extractThreadIdFromUrl(current)
      const selectedThread=extractThreadIdFromUrl(state.selectedChatUrl)
      const probeRaw=await client.evaluate(`JSON.stringify({hasPrompt:!!document.querySelector('[contenteditable=\"true\"][role=\"textbox\"], [aria-label=\"Start new chat\"], [aria-label=\"New chat\"]'),hasComposer:!!document.querySelector('[contenteditable=\"true\"][role=\"textbox\"], textarea'),body:(document.body?.innerText||'').slice(-2000)})`,10000).catch(()=>'{\"hasPrompt\":false,\"body\":\"\"}')
      const probe=JSON.parse(String(probeRaw||'{}'))
      const blocked=/No access to this page|Request access|Open in Notion/i.test(String(probe.body||''))
      // Cupo agotado: Notion retira el composer, asi que ni navegar ni recuperar
      // lo devuelven. Cortar aqui deja que la rotacion pruebe otra cuenta ya.
      if(!probe.hasComposer&&new RegExp(QUOTA_TEXT_PATTERN,'i').test(String(probe.body||''))){
        throw new Error('Notion AI sin cupo o créditos en '+formatAccountLabel(synchronizedAccount))
      }
      if(desiredUrl && (!currentThread || !selectedThread || currentThread!==selectedThread || blocked || !probe.hasPrompt)){
        log(`[cdp] Navegando al thread dedicado: ${state.selectedChatTitle||selectedThread||'seleccionado'}`)
        // Inyectar identidad de la cuenta sincronizada antes de navegar al thread
        if(synchronizedAccount?.spaceId){
          const _tid=JSON.stringify({userId:synchronizedAccount.userId||synchronizedAccount.uid||null,spaceId:synchronizedAccount.spaceId});
          await client.evaluate("(()=>{const x="+_tid+";if(x.userId)localStorage.setItem('LRU:KeyValueStore2:current-user-id',JSON.stringify({value:x.userId}));localStorage.setItem('LRU:KeyValueStore2:current-space-id',JSON.stringify({value:x.spaceId}));return true})()",10000).catch(()=>false);
        }
        await client.call('Page.navigate',{url:desiredUrl},30000)
        await sleep(3500)
        await waitUntil(async()=>{try{return await client.evaluate("!!document.querySelector('[contenteditable=\"true\"][role=\"textbox\"], [aria-label=\"Start new chat\"], [aria-label=\"New chat\"]')",10000)}catch{return false}},30000,500,'carga thread dedicado')
        saveState({selectedChatUrl:desiredUrl,selectedChatTitle:state.selectedChatTitle||'Welcome to Notion',version:VERSION,selectedAt:new Date().toISOString()})
      }
    }catch(error){
      if(/sin cupo o créditos/i.test(error.message)){
        log('[sync] '+error.message+' — sin composer que recuperar; devuelvo el error para rotar')
        try{client.close()}catch{}
        throw error
      }
      log('[sync] Thread dedicado inválido; intentando autorrecuperación: '+error.message)
      try{
        // Sin ?spaceId= Notion abre el espacio POR DEFECTO de la cuenta (el que
        // suele estar seco), asi que la recuperacion deshacia la rotacion y
        // acababa siempre en el workspace sin cupo.
        await abrirEspacio(client,synchronizedAccount?.spaceId)
        await sleep(3000)
        await waitUntil(async()=>{try{return await client.evaluate("!!document.querySelector('[contenteditable=\"true\"][role=\"textbox\"], [aria-label=\"Start new chat\"], [aria-label=\"New chat\"]')",10000)}catch{return false}},30000,500,'carga inicio de chat')
        const hasInput=await client.evaluate("!!document.querySelector('[contenteditable=\"true\"][role=\"textbox\"]')",10000).catch(()=>false)
        if(!hasInput){
          await client.evaluate("(()=>{const e=document.querySelector('[aria-label=\"Start new chat\"]')||document.querySelector('[aria-label=\"New chat\"]');if(e){e.click();return true}return false})()",10000)
          await waitUntil(async()=>{try{return await client.evaluate("!!document.querySelector('[contenteditable=\"true\"][role=\"textbox\"]')",10000)}catch{return false}},30000,500,'nuevo thread sincronizado')
        }
        await persistActiveThreadFromClient(client)
        log('[sync] Thread autorrecuperado para '+formatAccountLabel(synchronizedAccount))
      }catch(recoveryError){
        client.close()
        throw new Error('No pude sincronizar la cuenta y el thread automáticamente: '+recoveryError.message+' (origen: '+error.message+')')
      }
    }
  }
  return client
}

// â”€â”€ processPrompt â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Foto del estado del chat anclada al CONTENIDO, no a contadores: cuando Notion
// abre un thread nuevo la URL cambia y los contadores de referencia quedan
// desfasados, que es lo que hacía fallar "solicitud registrada" y perder
// respuestas que sí habían llegado.
async function chatSnapshot(cdp,reqId){
  const expr=`(()=>{try{
    const btns=[...document.querySelectorAll('[aria-label="Copy response"],[aria-label="Copiar respuesta"]')];
    const body=document.body?document.body.innerText||'':'';
    // La respuesta es lo que viene DESPUES del cierre del prompt. Subir por el
    // DOM desde "Copy response" arrastraba el turno del usuario y devolvia el
    // propio prompt como si fuera la contestacion.
    // Anclar la respuesta al reqId de ESTE prompt: si se repite la misma
    // pregunta, la contestación anterior es idéntica y no habría forma de
    // distinguirlas, y el CLI se quedaba esperando una respuesta "nueva".
    const reqId=${JSON.stringify(reqId||'')};
    const marca=reqId?('reqId:'+reqId):'RESPONDE SOLO A LA SOLICITUD ANTERIOR ===';
    const corte=body.lastIndexOf(marca);
    const tieneMarca=corte>=0;
    let answer=corte>=0?body.slice(corte+marca.length):'';
    // Cortar por la MARCA de cierre, no por su forma exacta: Notion cuela
    // caracteres sueltos ("]= ==") y el patron fijo no limpiaba nada, asi que la
    // respuesta se leia como si fuera el contexto y se esperaba para siempre.
    const cierre=answer.toUpperCase().lastIndexOf('SOLICITUD ANTERIOR');
    if(cierre>=0) answer=answer.slice(cierre+'SOLICITUD ANTERIOR'.length);
    answer=answer.replace(/^[\s=\]]+/,'');
    // Mejor fuente: el contenedor de la ÚLTIMA respuesta (la que lleva su botón
    // "Copy response"). Se sube por el DOM hasta justo antes de englobar el
    // prompt; asi no se cuela ni el turno del usuario ni el pie de la pagina
    // (donde viven los "Organizing"/"Exploring" mientras trabaja).
    const ultimoBtn=btns[btns.length-1];
    if(ultimoBtn){
      let nodo=ultimoBtn, mejor='';
      for(let i=0;i<8&&nodo;i++){
        nodo=nodo.parentElement;
        const t=nodo?nodo.innerText||'':'';
        if(!t) continue;
        if(/FIN DE CONTEXTO|SOLICITUD DEL USUARIO|MODO CLI SHOSSO/i.test(t)) break;
        mejor=t;
      }
      // Solo sirve si esa respuesta va DESPUES de la marca de esta peticion en
      // el DOM: si no, es el turno anterior del hilo y sus ordenes viejas se
      // volvian a ejecutar (reabria el bloc de notas y el explorador).
      // Se compara por posicion, no por texto: el innerText del contenedor no
      // coincide caracter a caracter con el del body y todo quedaba descartado.
      let posterior=true;
      if(tieneMarca&&marca){
        const nodos=[...document.querySelectorAll('div,p,span,li')];
        const conMarca=nodos.filter(n=>(n.textContent||'').includes(marca)).pop();
        if(conMarca) posterior=!!(conMarca.compareDocumentPosition(ultimoBtn)&Node.DOCUMENT_POSITION_FOLLOWING);
      }
      if(mejor.trim()&&posterior) answer=mejor;
    }
    answer=answer.replace(/^\\s*\\d{1,2}:\\d{2}\\s*(AM|PM|a\\.?\\s?m\\.?|p\\.?\\s?m\\.?)?\\s*/i,'');
    answer=answer.replace(/(Auto|Notion AI finished|La IA de Notion termin[oó]\\.?|Notion AI termin[oó]\\.?)/gi,'');
    // Notion cuela un aviso para abrir su app de escritorio DENTRO del turno:
    // se mezclaba con la contestacion y el CLI no reconocia la respuesta ("Hola"
    // llegaba como "Hola Open in Notion's desktop app? Download ... Open in app").
    answer=answer.replace(/Open in Notion.{0,3}s desktop app[?][\\s\\S]*?Open in app/gi,'');
    answer=answer.replace(/(Don.{0,3}t have the app[?]|Always open in app|Open in app|Download)/gi,'');
    const composers=[...document.querySelectorAll('[contenteditable=\\"true\\"][role=\\"textbox\\"], textarea')];
    const composer=composers[composers.length-1];
    return JSON.stringify({
      copies:btns.length,
      answer:answer.replace(/\\s+/g,' ').trim().slice(0,8000),
      finished:/Notion AI finished|La IA de Notion termin|Notion AI termin/i.test(body),
      sinCupo:new RegExp(${JSON.stringify(QUOTA_TEXT_PATTERN)},'i').test(body),
      tieneMarca,
      pidePermiso:[...document.querySelectorAll('*')].some(e=>/^(Allow|Permitir)$/i.test((e.innerText||'').trim())&&e.getBoundingClientRect().width>10),
      busy:!!document.querySelector('[aria-label="Stop response"],[aria-label="Stop"],[aria-label="Detener"]'),
      composerEmpty:!((composer&&(composer.innerText||composer.value))||'').trim()
    })
  }catch(e){return JSON.stringify({error:String(e.message||e)})}})()`
  try{
    const raw=String(await cdp.evaluate(expr,15000)||'{}')
    const out=JSON.parse(raw)
    if(out.error) log('[snapshot] la página devolvió error: '+out.error)
    return out
  }catch(error){
    // Devolver {} en silencio dejaba el bucle esperando eternamente: sin datos
    // no hay respuesta ni progreso que evaluar.
    log('[snapshot] no pude leer el chat: '+String(error.message||error).slice(0,120))
    return {failed:true}
  }
}
async function runThreadPrompt(cdp,promptText,progress=()=>{},label='worker real'){
  progress('waiting','Esperando que el thread quede libre',{tool:'Task',action:'Thread libre'})
  await waitUntil(async()=>{const s=await chatSnapshot(cdp);return s.busy===false},10*60_000,700,'thread libre')
  const antes=await chatSnapshot(cdp)
  progress('sending','Escribiendo la solicitud en el worker real',{tool:'Write',action:label})
  await insertPrompt(cdp,promptText)

  // 1) Confirmar el envío: el composer se vacía, o ya hay una respuesta más, o
  //    el modelo empezó a trabajar. Cualquiera de las tres vale.
  // Confirmación REAL del envío: el prompt lleva un [reqId:xxxx] único, así que
  // se comprueba que aparece en la conversación. Fiarse de que el composer se
  // vacíe daba por enviados mensajes que nunca salieron, y luego se esperaba
  // eternamente una respuesta que no iba a llegar.
  const marcaEnvio=(String(promptText).match(/\[reqId:([a-z0-9]+)\]/i)||[])[1]||null
  const promptEnPantalla=async()=>{
    if(!marcaEnvio) return true
    try{ return await cdp.evaluate(`(document.body?document.body.innerText||'':'').includes(${JSON.stringify('reqId:'+marcaEnvio)})`,10000)===true }catch{ return false }
  }
  let enviado=false
  for(let intento=1;intento<=2&&!enviado;intento++){
    for(let i=0;i<20&&!enviado;i++){ await sleep(1500); enviado=await promptEnPantalla() }
    if(!enviado&&intento===1){
      // Si Notion YA está generando, el prompt salió aunque no se vea todavía en
      // el texto de la página. Reinsertar aquí gastaba OTRA respuesta del cupo y
      // encima tiraba la que se estaba escribiendo.
      const generando=await cdp.evaluate(`(()=>{const t=(document.body&&document.body.innerText)||'';return /is generating a response|Notion AI finished/i.test(t)?'si':'no'})()`).catch(()=>'no')
      if(String(generando).includes('si')){
        log('[insert] no veo el prompt, pero Notion ya está generando: doy por enviado')
        enviado=true
        break
      }
      log('[insert] el prompt no aparece en el chat; reintento el envío')
      await insertPrompt(cdp,promptText).catch(e=>log('[insert] reintento falló: '+e.message))
    }
  }
  if(!enviado) throw new Error('La solicitud no llegó a publicarse en el chat de Notion')
  // Referencia tomada CON el prompt ya publicado: a partir de aquí, un botón
  // "Copy response" de más significa respuesta nueva y terminada (Notion solo lo
  // pone cuando ha acabado). Antes se contaba antes de enviar y el recuento
  // quedaba desfasado en cuanto Notion recargaba el hilo.
  const base=await chatSnapshot(cdp,marcaEnvio)
  const copiasBase=base.copies||0

  // 2) Esperar la respuesta: nueva burbuja + texto estable (misma lectura tres
  //    veces) o el marcador "Notion AI finished". Nada de contadores previos.
  progress('working','Notion AI está trabajando en el worker real',{tool:'Task',action:'Worker real activo'})
  // Tope por peticion. Eran 10 min: como la cola es serializada (un solo
  // navegador), una peticion atascada dejaba al usuario sin servicio todo ese
  // rato. Con 4 min ya han cabido los reenvios y la rotacion; si no contesto,
  // no va a contestar.
  const limite=Date.now()+4*60_000
  let estable=0, ultimo='', vistos=new Set(), reenvios=0, atascos=0, huellaPrevia='', ultimoCambio=Date.now()
  let arranco=false, envioEn=Date.now(), lecturasMuertas=0, vueltas=0
  let marcaConfirmada=false
  const esAccion=pidePc(String(promptText||'').replace(/^[\s\S]*SOLICITUD DEL USUARIO:/,''))
  // Cada lectura con tope propio: si el navegador deja de contestar, la petición
  // se quedaba colgada sin poder ni comprobar su propio límite de 10 minutos.
  const conTope=(p,ms,alt)=>Promise.race([p,new Promise(r=>setTimeout(()=>r(alt),ms))])
  while(Date.now()<limite){
    const s=await conTope(chatSnapshot(cdp,marcaEnvio),20000,{failed:true})
    // Latido: sin esto, cuando el bucle se quedaba esperando no habia forma de
    // saber que veia (ni si seguia vivo).
    if(++vueltas%10===0) log('[espera] v'+vueltas+' marca='+s.tieneMarca+' busy='+s.busy+' fin='+s.finished+' resp='+String(s.answer||'').slice(0,40))
    // Tras recargarse Notion, el cliente CDP queda apuntando a una pagina que ya
    // no existe: las lecturas salen vacias sin dar error y el bucle esperaba
    // indefinidamente. Cinco lecturas muertas seguidas = hay que rehacer la
    // conexion y repetir la peticion.
    if(s.failed||s.error||(s.tieneMarca===undefined&&!s.answer)){
      if(++lecturasMuertas>=5) throw new Error('CONTEXTO PERDIDO: la página de Notion se recargó y hay que rehacer la conexión')
    } else lecturasMuertas=0
    if(s.failed){ await sleep(2000); continue }
    for(const ev of await conTope(scanVisibleActivity(cdp),15000,[])){
      const k=[ev.tool,ev.action].join('|')
      // En una conversacion normal, las ordenes que el modelo arrastra del hilo
      // NO se ejecutan; mostrarlas como actividad hacia creer que un "Hi" estaba
      // abriendo videos. Se ocultan.
      const crudo=String(ev.action||'')+' '+String(ev.detail||'')
      // Nunca mostrar como "actividad" trozos de nuestro propio prompt.
      if(/FIN DE CONTEXTO|SOLICITUD DEL USUARIO|RECUERDA:|PROGRAMAS YA ABIERTOS|MODO CLI SHOSSO|\[reqId:/i.test(crudo)) continue
      if(!esAccion&&/EJECUTAR|run_command|start |taskkill|powershell/i.test(crudo)) continue
      if(!vistos.has(k)){ vistos.add(k); progress('working',ev.action,ev) }
    }
    // Si Notion contesta con el aviso de cupo, no hay respuesta que esperar:
    // cortar ya para que la rotación pruebe otro workspace.
    if(s.sinCupo&&!(s.answer||'').trim()) throw new Error('Notion AI sin cupo o créditos en este workspace')
    // Red de seguridad: si Notion pide confirmación para ejecutar una
    // herramienta ("Do you want to continue? Reject / Allow"), se acepta sola.
    // Sin esto la respuesta se queda a medias esperando un clic humano.
    if(s.pidePermiso){
      const ok=await cdp.evaluate(`(()=>{const b=[...document.querySelectorAll('*')].filter(e=>/^(Allow|Permitir|Continuar)$/i.test((e.innerText||'').trim()));const el=b[b.length-1];if(!el)return false;let p=el;for(let i=0;i<4&&p;i++){if(p.getAttribute('role')==='button'){el=p;break}p=p.parentElement}el.click();return true})()`,10000).catch(()=>false)
      if(ok){ log('[permiso] acepté la ejecución de la herramienta'); progress('working','Autorizando la herramienta',{tool:'Task',action:'Permiso concedido'}) }
      await sleep(1500)
    }
    // "Organizing", "Thinking"… son indicadores de progreso, no la respuesta:
    // aceptarlos devolvía basura en lugar del texto final.
    // Mientras trabaja, la pantalla muestra etiquetas de progreso ("Exploring",
    // "Organizing"…), que no son la respuesta. La señal fiable de que terminó es
    // el pie "Notion AI finished" / "La IA de Notion terminó": se espera a eso.
    // La estabilidad queda de respaldo, pero exigiendo un buen rato quieto.
    // Los indicadores de trabajo llegan con la palabra duplicada ("Crafting
    // Crafting", "Organizing Organizing"): el DOM repite etiqueta y aria. Es una
    // forma reconocible sin depender de una lista de palabras, y el botón de
    // parar no sirve de señal porque su aria-label no es el que se esperaba.
    // Solo se descartan los indicadores (palabra duplicada) y el vacío: exigir
    // 3 caracteres tiraba respuestas legítimas y cortas como "4", "75" u "ok",
    // que se quedaban esperando hasta agotar el tiempo.
    const esProgreso=t=>{
      // Se colaba como respuesta el rotulo de progreso con adornos delante
      // ("=== 4:32 AM Exploring Exploring Notion AI is generating a response"),
      // asi que primero se quitan los adornos y la marca de hora.
      let x=String(t||'').replace(/\s+/g,' ').trim()
      x=x.replace(/^[\s=\]]+/,'').replace(/^\d{1,2}:\d{2}\s*(AM|PM|a\.?\s?m\.?|p\.?\s?m\.?)?\s*/i,'')
      // Mientras genera, el rotulo esta SIEMPRE presente: es la senal fiable.
      if(/is generating a response/i.test(x)) return true
      x=x.replace(/Notion AI (is generating a response|finished)[.…]?/gi,'')
      // Los rotulos cambian en cada version (Brewing, Discovering, Exploring...):
      // en vez de listarlos, se descarta cualquier texto que sea una palabra
      // repetida, que es la forma que tienen todos.
      x=x.replace(/\b(\w+)( \1)+\b/gi,'')
      x=x.replace(/[\s.·—-]+/g,' ').trim()
      return !x
    }
    // El texto del prompt NO es una respuesta: se colaba el contexto entero
    // ("=== FIN DE CONTEXTO", "SOLICITUD DEL USUARIO:", "[reqId:...]") y acababa
    // mostrandose al usuario como si Notion hubiera contestado eso.
    const esContexto=t=>/FIN DE CONTEXTO|SOLICITUD DEL USUARIO|INICIO DE CONTEXTO|MODO CLI SHOSSO|\[reqId:|hidden-worker/i.test(String(t||''))
    // La interfaz añade y quita un punto al final mientras refresca ("LISTO" ↔
    // "LISTO ."), así que comparar en crudo reseteaba la cuenta en cada lectura
    // y la respuesta no se daba nunca por estable.
    const norm=t=>String(t||'').replace(/\s+/g,' ').replace(/[\s.·•…]+$/,'').trim()
    // Notion cierra cada respuesta poniéndole su botón "Copy response": esa es
    // la señal que da la propia interfaz cuando ha terminado, y es determinista.
    // Antes se esperaba a que el texto "se quedara quieto", y respuestas ya
    // terminadas se quedaban esperando en balde.
    // Vale con que el texto de la última respuesta sea DISTINTO del que había
    // antes de enviar, no sea un indicador de progreso y no cambie entre dos
    // lecturas. Comparar contadores de botones fallaba cuando el thread ya
    // traía una respuesta: nunca "aumentaban" y se perdía la contestación.
    // Notion deja pegada al texto la cabecera de lo que va haciendo ("Noodling
    // Noodling", "Thought …"): se recorta antes de comparar.
    // El turno arrastra el rastro de pasos y herramientas ("3 steps Thought
    // Listed MCP server tools P PC1-612d / run_command 75"): se recorta todo eso
    // y queda la respuesta ("75").
    const limpiar=t=>String(t||'')
      .replace(/^(?:(\S+)(?: \1)+\s*)+/,'')            // "Noodling Noodling"
      .replace(/^\d+\s+steps?\b/i,'')                   // "3 steps"
      .replace(/\bListed (?:MCP server tools|connections|tools|files)\b/gi,'')
      .replace(/\bThought\b/gi,'')
      .replace(/\bP?\s*PC1[-\w]*\s*\/\s*\w+\b/gi,'')    // "P PC1-612d / run_command"
      .replace(/\bInput\b[\s\S]*?\bOutput\b/gi,'')      // parámetros de la llamada
      .replace(/\s+/g,' ').trim()
    // Si el prompt ya no está en pantalla, Notion abrió otro hilo por el medio
    // y la pregunta se perdió: reenviarla en vez de esperar una respuesta que
    // nunca va a aparecer (era la causa de los "Trabajando…" eternos).
    // Notion recarga la pagina sola al desplegar version nueva (la URL pasa a
    // /ai?assetsVersion=...). Al volver abre el espacio POR DEFECTO y el chat de
    // la peticion desaparece; el snapshot no puede leer nada y el bucle se
    // quedaba esperando para siempre. Se vigila la URL, que nunca miente.
    try{
      const sp=loadState().lastSelectedAccount?.spaceId
      const url=String(await cdp.evaluate('location.href',8000).catch(()=>''))
      if(sp&&url&&/assetsVersion=/.test(url)&&!url.includes(sp)&&reenvios<3){
        reenvios++
        log('[reenganche] Notion recargó por versión nueva; vuelvo al workspace y reenvío ('+reenvios+'/3)')
        progress('retrying','Notion se recargó; retomo tu petición',{tool:'Task',action:'Retomar petición'})
        await abrirEspacio(cdp,sp)
        await insertPrompt(cdp,promptText).catch(e=>log('[insert] reenvío falló: '+e.message))
        arranco=false; envioEn=Date.now()
        await sleep(4000)
        continue
      }
    }catch(e){ log('[reenganche] '+String(e.message||e).slice(0,90)) }
    if(marcaEnvio&&s.tieneMarca===false&&!marcaConfirmada){
      // Al enviar el PRIMER mensaje, Notion crea el hilo y navega a ?t=: durante
      // ese parpadeo la marca no está en la página y el CLI creía que el prompt
      // se había perdido, reenviando y gastando otra respuesta del cupo. Se
      // confirma con calma antes de decidir.
      let confirmado=false
      for(let i=0;i<6&&!confirmado;i++){
        await sleep(2500)
        const otra=await chatSnapshot(cdp,marcaEnvio).catch(()=>null)
        if(otra&&otra.tieneMarca) confirmado=true
        else{
          const gen=await cdp.evaluate(`(()=>{const t=(document.body&&document.body.innerText)||'';return /is generating a response/i.test(t)?'si':'no'})()`).catch(()=>'no')
          if(String(gen).includes('si')) confirmado=true
        }
      }
      if(confirmado){
        // Una sola vez: si se confirma en cada vuelta, la peticion se queda
        // dando vueltas aqui hasta agotar el tope sin llegar a leer nada.
        marcaConfirmada=true
        log('[insert] la marca tardó en aparecer (hilo recién creado); sigo esperando la respuesta')
        continue
      }
      if(reenvios<3){
        reenvios++
        // Notion se recarga sola cuando despliega version nueva (la URL pasa a
        // /ai?assetsVersion=...) y al volver abre el espacio POR DEFECTO, que
        // suele tener la IA apagada: reenviar ahi no sirve de nada. Hay que
        // volver primero al workspace de la peticion.
        try{
          const sp=loadState().lastSelectedAccount?.spaceId
          const url=String(await cdp.evaluate('location.href',8000).catch(()=>''))
          if(sp&&!url.includes(sp)&&!/[?&]t=/.test(url)){
            log('[reenganche] la página se recargó fuera del workspace; vuelvo a '+sp.slice(0,8))
            await abrirEspacio(cdp,sp)
          }
        }catch(e){ log('[reenganche] '+e.message) }
        log('[insert] el prompt desapareció del chat (hilo nuevo); lo reenvío')
        await insertPrompt(cdp,promptText).catch(e=>log('[insert] reenvío falló: '+e.message))
        arranco=false; envioEn=Date.now()      // el reenvio reinicia el arranque
        await sleep(4000)
        continue
      }
      throw new Error('El chat de Notion cambió de hilo y la solicitud se perdió')
    }
    // Vigilante de atasco: a veces Notion se queda en "Organizing…" y no
    // responde nunca. Si el texto no cambia durante 3 minutos, se reenvía la
    // pregunta; al segundo atasco se rinde para que la rotación pruebe otro
    // workspace, en vez de dejar al usuario esperando indefinidamente.
    // Arranque: si Notion no empieza a generar (ni boton de parar, ni texto
    // nuevo) en los primeros segundos, ese workspace no va a contestar aunque
    // tenga composer: el cupo agotado a veces deja el campo puesto y calla.
    // Es una señal, no una espera a ciegas, y ahorra los 45 s del vigilante.
    if(!arranco){
      if(s.busy||s.finished||(s.answer&&norm(limpiar(s.answer))!==norm(limpiar(base.answer)))) arranco=true
      // El silencio NO significa que no vaya a contestar: con un thread recien
      // creado y el MCP cargando, Notion tarda a veces dos minutos en arrancar
      // (medido). Solo se abandona si Notion DICE que no hay cupo; si el prompt
      // esta publicado y no hay aviso, se espera. Cortar antes tiraba respuestas
      // que si llegaban y disparaba rotaciones inutiles.
      else if(s.sinCupo){
        log('[arranque] Notion avisa de falta de cupo; descarto este workspace')
        throw new Error('Notion AI sin cupo o créditos en este workspace')
      }
    }
    const huella=String(s.answer||'').slice(0,200)
    if(huella!==huellaPrevia){ huellaPrevia=huella; ultimoCambio=Date.now() }
    // Mientras Notion muestre su boton de detener esta generando de verdad,
    // aunque el texto tarde en cambiar (una herramienta del MCP puede tardar
    // minutos). Declarar atasco ahi era abandonar respuestas en marcha y rotar
    // de workspace inventando una falta de cupo.
    else if(s.busy){ ultimoCambio=Date.now() }
    // Con el prompt publicado y sin aviso de cupo, el silencio es Notion
    // tardando: abandonar aqui era justo lo que dejaba peticiones sin respuesta.
    // PERO si lo unico que hay es su indicador de progreso ("Vibing Vibing")
    // clavado minuto y medio, Notion se ha quedado colgado: se reenvia la misma
    // pregunta en el mismo workspace, que es lo que lo destraba.
    else if(s.tieneMarca&&!s.sinCupo){
      const soloProgreso=esProgreso(norm(limpiar(s.answer)))||!String(s.answer||'').trim()
      // Agotados los reenvios, el workspace no va a contestar: se descarta y se
      // rota, en vez de reenviar en bucle para siempre.
      if(soloProgreso&&Date.now()-ultimoCambio>150000&&reenvios>=1){
        log('[colgado] '+reenvios+' reenvíos sin respuesta; descarto este workspace')
        throw new Error('Notion AI se quedó sin avanzar en este workspace')
      }
      if(soloProgreso&&Date.now()-ultimoCambio>150000&&reenvios<1){
        reenvios++
        log('[colgado] Notion lleva 150 s en su indicador de progreso; reenvío la pregunta ('+reenvios+'/1)')
        progress('retrying','Notion se quedó colgado; repito la pregunta',{tool:'Task',action:'Repetir petición'})
        await insertPrompt(cdp,promptText).catch(e=>log('[insert] reenvío falló: '+e.message))
        arranco=false; envioEn=Date.now(); ultimoCambio=Date.now()
        await sleep(4000)
        continue
      }
    }
    else if(Date.now()-ultimoCambio>45000){
      // Un workspace del plan Free rinde muy pocas respuestas: cuando se le
      // acaban, unas veces avisa y otras se queda mudo. Ese silencio se trata
      // como falta de cupo y se rota YA, en vez de insistir aquí tres minutos.
      log('[atasco] 45 s sin avanzar; lo doy por agotado y roto de workspace')
      throw new Error('Notion AI se quedó sin avanzar en este workspace')
    }
    const actual=norm(limpiar(s.answer))
    // Con el reqId de ESTA peticion presente y Notion diciendo que termino, el
    // texto anclado a esa marca ES la respuesta: no hay que compararlo con lo
    // que habia antes. Comparar ahi colgaba la peticion cuando la contestacion
    // coincidia con la anterior del mismo chat ("hi" -> "Hola" dos veces).
    // Una orden del puente ya completa ("EJECUTAR {...}") es respuesta cerrada:
    // Notion no siempre marca "finished" en esos turnos y la peticion se
    // quedaba dando vueltas con la orden ya escrita en pantalla.
    if(s.tieneMarca&&actual&&!esContexto(actual)&&/EJECUTAR\s*\{[\s\S]*\}/.test(actual)){
      if(actual===norm(ultimo)) return actual
      ultimo=actual
    }
    // Texto anclado al reqId de ESTA peticion: es su respuesta, aunque Notion no
    // marque "finished" (a veces no lo hace y la peticion se quedaba dando
    // vueltas con la contestacion ya escrita en pantalla). Se exigen tres
    // lecturas identicas para no cortar a mitad de redaccion.
    // En un hilo recien creado el turno del usuario no aparece en la pagina, asi
    // que la marca nunca esta: si el envio ya se confirmo, la respuesta vale
    // igual. Sin esto se descartaba una contestacion ya escrita (y ya pagada).
    if((s.tieneMarca||marcaConfirmada)&&actual&&!esProgreso(actual)&&!esContexto(actual)){
      if(actual===norm(ultimo)){ if(++estable>=(s.finished?1:2)) return actual }
      else { estable=0; ultimo=actual }
    }
    if(actual&&actual!==norm(limpiar(base.answer))&&!esProgreso(actual)&&!esContexto(actual)){
      // Tres lecturas idénticas seguidas: mientras escribe el texto crece y no
      // se cumple; en cuanto termina, se cumple en unos segundos.
      if(actual===norm(ultimo)){ estable++ } else { estable=0; ultimo=actual }
      if(estable>=2) return actual
    }
    await sleep(2000)
  }
  if(ultimo) return String(ultimo).replace(/[\s.·•…]+$/,'').trim()   // algo llegó: mejor eso que un timeout
  throw new Error('Timeout esperando respuesta del worker real')
}
async function executeHiddenPrompt(userText,progress=()=>{}){
  // Cada petición estrena hilo. Reutilizar el anterior hacía que el prompt se
  // escribiera en el composer pero no llegara a publicarse: la primera pregunta
  // siempre funcionaba (abría hilo nuevo) y la segunda se quedaba colgada.
  try{
    const st=loadState()
    if(String(st.selectedChatUrl||'').includes('?t=')){
      const sp=st.lastSelectedAccount?.spaceId||st.lastActiveAccount?.spaceId
      saveState({selectedChatUrl:sp?spaceChatUrl(sp):null,threadManuallySelected:false,version:VERSION})
      log('[thread] suelto el hilo anterior; esta petición estrena chat')
    }
  }catch{}
  progress('connecting','Conectando con el worker real de Notion',{tool:'WebFetch',action:'CDP 127.0.0.1:9223'})
  const client=await getCdpForHidden()
  try{
    let extraPc=''
    if(pidePc(userText)){
      const abiertos=await programasAbiertos().catch(()=>'')
      if(abiertos) extraPc=String.fromCharCode(10)+'PROGRAMAS YA ABIERTOS EN EL PC: '+abiertos+
        String.fromCharCode(10)+'(si el programa ya está abierto NO lo vuelvas a lanzar: actúa sobre él)'
    }
    const scopedPrompt=buildScopedPrompt(userText+extraPc,Math.random().toString(36).slice(2,10))
    const a=sanitizeForTerminal(await runThreadPrompt(client,scopedPrompt,progress,'Prompt oculto'))
        // Con el puente no se usa el MCP de Notion: si la respuesta menciona fallos
    // de MCP es ruido suyo, no hay nada que reprovisionar.
    if(!puenteActivo()&&/Failed to connect to MCP server|HTTP 404|mcpServer_pc211/i.test(a)){
      log('[mcp-sync] La respuesta indica MCP caido; reprovisionando antes de reintentar')
      try{spawnSync(process.execPath,[MCP_ENSURE_SCRIPT],{cwd:DIR,encoding:'utf8',windowsHide:true,timeout:180000})}catch(error){log('[mcp-sync] reprovision fallo: '+error.message)}
      try{refreshMcpWorkspaceRegistry(true)}catch{}
      throw new Error('MCP no disponible en el workspace actual: '+a.slice(0,300))
    }
    saveState({mcpValidatedThreadModuleId:loadState().mcpActiveModuleId||null,mcpThreadSynchronizedAt:new Date().toISOString(),version:VERSION})
    await persistActiveThreadFromClient(client)
    saveState({lastSuccessAt:new Date().toISOString(),version:VERSION,lastMode:'hidden'})
    appendTranscript('IA [hidden-worker]',a)
    try{appendWorkspaceTurnMemory(userText,a)}catch{}
    return a
  }finally{try{client.close()}catch{}}
}
async function confirmRotatableAccount(candidate){
  let lastStatus=null
  for(let attempt=0;attempt<5;attempt++){
    lastStatus=await getAiStatus()
    if(lastStatus?.blocked===true) return lastStatus
    if(lastStatus?.blocked===false && (lastStatus?.hasInput||lastStatus?.hasStartNewChat)) return lastStatus
    await sleep(1500 + attempt*750)
  }
  if(lastStatus?.blocked===false && !lastStatus?.hasInput && !lastStatus?.hasStartNewChat){
    return {...lastStatus,blocked:true,message:lastStatus?.message||'AI deshabilitada o composer no disponible en este workspace'}
  }
  return lastStatus
}
async function rotateToAvailableAccount(progress=()=>{},triedKeys=[],reason=''){
  const currentKey=getSelectedAccountKey()
  // El cupo de Notion AI va POR WORKSPACE (cada espacio tiene su propio trial),
  // asi que los demas espacios de la misma cuenta son candidatos validos y van
  // primero: no hay que cambiar de sesion para usarlos.
  const current=listConnectedAccounts().find(a=>a.key===currentKey)||null
  const candidates=listRotatableAccounts([currentKey,...triedKeys])
    .sort((a,b)=>Number(b.uid===current?.uid)-Number(a.uid===current?.uid))
  for(const candidate of candidates){
    // Anunciar "sin cupo" sin haberlo comprobado era mentir al usuario: el
    // mismo camino se recorre cuando el motor falla. Solo se dice si el propio
    // aviso de Notion lo confirma.
    const porCupo=new RegExp(QUOTA_TEXT_PATTERN,'i').test(String(reason||''))
    const aviso=porCupo?'Este workspace se quedó sin cupo; cambio a otro y sigo con tu petición'
                       :'Cambio de workspace y sigo con tu petición'
    progress('retrying',aviso,{tool:'Task',action:aviso,detail:formatAccountLabel(candidate)})
    selectConnectedAccount(candidate)
    await usarPrecalentado(candidate.spaceId)   // si ya estaba cargado, el salto es inmediato
    // Antes se sondeaba el estado del candidato hasta 5 veces (más de un minuto
    // por workspace, y de ahí lo lenta que era la rotación). Se prueba directo:
    // si no tiene cupo, el propio envío lo descubre en segundos y se sigue.
    const status=process.env.NOTION_VERIFY_ROTATION==='1'?await confirmRotatableAccount(candidate):{blocked:false,hasInput:true}
    if(status?.blocked===true){
      progress('retrying','El workspace alterno también está bloqueado',{tool:'Task',action:'Siguiente workspace',detail:formatAccountLabel(candidate)})
      continue
    }
    if(status?.blocked!==false){
      progress('retrying','No pude confirmar cupo o contexto en el workspace alterno',{tool:'Task',action:'Siguiente workspace',detail:formatAccountLabel(candidate)})
      continue
    }
    progress('connecting','Workspace alterno confirmado con contexto compartido',{tool:'Task',action:'Workspace activo',detail:formatAccountLabel(candidate)})
    return candidate
  }
  return null
}
// Cada workspace nuevo de la cuenta trae su propio cupo del plan Free, asi que
// cuando se agotan TODOS la salida no es rendirse: se crea otro y se sigue.
function createSpaceWithQuota(progress=()=>{}){
  progress('retrying','Sin cupo en ningún workspace; creando uno nuevo',{tool:'Task',action:'Nuevo workspace'})
  const r=spawnSync(process.execPath,[path.join(DIR,'space-ensure.mjs')],{cwd:DIR,encoding:'utf8',windowsHide:true,timeout:900000})
  const salida=String(r.stdout||'').trim().split('\n').slice(-3).join(' | ')
  log('[space-ensure] '+salida)
  if(r.status===2){ log('[space-ensure] Notion no permite crear más workspaces ahora'); return false }
  return /workspace nuevo|cupo: DISPONIBLE/i.test(String(r.stdout||''))
}
async function runHiddenPromptWithRotation(userText,progress=()=>{}){
  const tried=new Set()
  let espacioCreado=false, reintentosHilo=0, reintentosMotor=0, reintentosSesion=0, reintentosContexto=0
  // El motor se cuelga a menudo tras muchas navegaciones (sigue respondiendo por
  // HTTP pero ya no deja adjuntarse) y entonces TODA la peticion muere en
  // timeouts sueltos. Comprobarlo antes cuesta ~1 s cuando esta sano.
  {
    saludUltima=Date.now()
    const salud=await esperarMotorSano()
    if(salud.reiniciado) log('[motor] estaba colgado antes de empezar; reiniciado ('+(salud.ok?'ok':'sigue caido')+')')
  }
  // Si el workspace activo ya se sabe inservible (sin cupo o con la IA
  // apagada), cambiarse ANTES de navegar: descubrirlo por las malas cuesta
  // ~40 s de sincronizacion y recuperacion por cada espacio muerto.
  try{
    if(estaAgotado(getSelectedAccountKey())){
      const alternativa=listRotatableAccounts([getSelectedAccountKey()])[0]
      if(alternativa){
        log('[inicio] el workspace activo esta descartado ('+(planAgotado(getSelectedAccountKey())||'sin cupo')+'); arranco en '+formatAccountLabel(alternativa))
        selectConnectedAccount(alternativa)
      }
    }
  }catch(error){ log('[inicio] no pude adelantar la rotacion: '+error.message) }
  while(true){
    const currentKey=getSelectedAccountKey()
    if(currentKey) tried.add(currentKey)
    try{return await executeHiddenPrompt(userText,progress)}
    catch(error){
      // Perder el hilo no es motivo para rendirse: Notion recarga el chat de vez
      // en cuando y la pregunta se queda sin publicar. Se reintenta entera, en
      // silencio, antes de dar nada por fallido.
      if(/cambió de hilo|no llegó a publicarse/i.test(error.message)&&reintentosHilo<2){
        reintentosHilo++
        log('[retry] el chat se recargó; repito la petición ('+reintentosHilo+'/2)')
        continue
      }
      // El motor puede caerse a mitad de peticion; entonces no hay composer y
      // parecia falta de cupo. Se revisa el motor y se repite en el MISMO
      // workspace en vez de rotar por un diagnostico equivocado.
      // Sesion caida: restaurar las cookies de la cuenta activa y repetir. Rotar
      // aqui no arregla nada (sin sesion falla cualquier workspace) y ademas iba
      // marcando como secos espacios que si sirven.
      if(/SESION CAIDA/i.test(error.message)&&reintentosSesion<2){
        reintentosSesion++
        progress('retrying','Reconectando la sesión de Notion',{tool:'Task',action:'Restaurar sesión'})
        try{
          const cuenta=listConnectedAccounts().find(a=>a.key===getSelectedAccountKey())
          if(cuenta){ queueSessionRestoreForAccount(cuenta); await waitForAccountSession(cuenta) }
          log('[sesion] restaurada; repito la petición ('+reintentosSesion+'/2)')
          continue
        }catch(e2){ log('[sesion] no pude restaurar: '+e2.message) }
      }
      if(/CONTEXTO PERDIDO/i.test(error.message)&&reintentosContexto<2){
        reintentosContexto++
        log('[contexto] la página se recargó; rehago la conexión y repito ('+reintentosContexto+'/2)')
        progress('retrying','Notion se recargó; retomo tu petición',{tool:'Task',action:'Retomar petición'})
        continue
      }
      if(esErrorDeMotor(error.message)&&reintentosMotor<1){
        reintentosMotor++
        progress('retrying','El motor no respondía; lo reinicio y sigo con tu petición',{tool:'Task',action:'Reiniciar motor',detail:error.message.slice(0,120)})
        const salud=await esperarMotorSano()
        log('[retry] motor revisado: '+(salud.ok?'ok':'sigue caido')+(salud.reiniciado?' (reiniciado)':''))
        if(salud.ok) continue
      }
      if(!getAutoRotateAccounts()||!isQuotaErrorMessage(error.message)) throw error
      if(isQuotaErrorMessage(error.message)){ marcarAgotado(getSelectedAccountKey(),clasificarAviso(error.message).plan)
        lanzarPoolMaintain('sin cupo') }   // repone el colchon sin esperar al ciclo
      const next=await rotateToAvailableAccount(progress,[...tried],error.message)
      if(next){ tried.add(next.key); continue }
      if(!espacioCreado&&createSpaceWithQuota(progress)){
        espacioCreado=true      // solo un intento por peticion, para no encadenar creaciones
        tried.clear()
        continue
      }
      throw new Error(String(error.message||error)+' | Sin cupo en los workspaces conocidos y no pude crear otro (Notion limita cuántos se crean seguidos). Reintenta en un rato o conecta otra cuenta con /popup.')
    }
  }
}
// Notion pide la accion, el CLI la ejecuta contra el servidor MCP del PC y le
// devuelve el resultado. Es la vuelta al bloqueo de Notion a los MCP propios:
// el servidor responde perfecto por HTTP, solo falla cuando lo llama Notion.
// ¿La peticion del usuario justifica tocar el PC? Un "hey" no puede acabar
// ejecutando MinimizeAll porque el hilo arrastre una orden de hace tres
// mensajes: si no pidio nada del sistema, las ordenes EJECUTAR se ignoran.
function pidePc(texto){
  const t=String(texto||'').toLowerCase()
  if(t.trim().length<3) return false
  // Por palabras, no por una expresion larga: la version con regex casaba con
  // cualquier cosa (hasta con "hey") y dejaba pasar ordenes que el hilo
  // arrastraba de mensajes anteriores.
  const CLAVES=['abre','abrir','abrelo','abrela','lanza','ejecuta','inicia','corre','arranca',
    'cierra','cerrar','cierralo','cierrala','mata','termina','finaliza','minimiza','maximiza','restaura',
    'lee','leer','escribe','escribir','crea','crear','guarda','guardar','borra','borrar','elimina',
    'mueve','mover','renombra','busca','buscar','lista','listar','muestra','mostrar',
    'carpeta','archivo','fichero','escritorio','desktop','disco','proceso','puerto','comando',
    'powershell','instala','descarga','captura','pantalla','ventana','programa','aplicacion',
    'cuantos','cuantas','ram','cpu','memoria',
    've','vete','entra','navega','visita','carga','web','url','youtube','google','spotify']
  const palabras=t.split(/[^a-z0-9áéíóúñ]+/i).filter(Boolean)
  if(palabras.some(p=>CLAVES.some(k=>p.startsWith(k)))) return true
  // rutas escritas a mano: ~/algo, C:\\algo, ./algo
  return /~[/\\\\]|[a-z]:[/\\\\]|[.][/]/i.test(t)
}
function extraerOrdenes(texto){
  // Todas las ordenes validas de UNA respuesta, en orden. Con un unico turno
  // por peticion, encadenar varias acciones solo es posible asi.
  const t=String(texto||'')
  const fuera=[], vistas=new Set()
  const re=/EJECUTAR\s*\{/gi
  let m
  while((m=re.exec(t))){
    // La comprobacion de "linea de guia" necesita el texto ANTERIOR, asi que se
    // mira aqui, sobre el original, antes de recortar el trozo.
    const nl=t.lastIndexOf(String.fromCharCode(10),m.index)
    if(/(->|→)\s*$/.test(t.slice(nl+1,m.index))) continue
    // Solo HASTA la siguiente orden: si se le pasa el resto del texto,
    // extraerOrden devuelve la ultima que encuentre y se pierden las de enmedio.
    const sig=t.slice(m.index+1).search(/EJECUTAR\s*\{/i)
    const o=extraerOrden(sig>=0?t.slice(m.index,m.index+1+sig):t.slice(m.index))
    if(!o) continue
    const huella=o.tool+' '+JSON.stringify(o.args)
    if(vistas.has(huella)) continue
    vistas.add(huella); fuera.push(o)
  }
  return fuera
}
function extraerOrden(texto){
  const t=String(texto||'')
  // El modelo escribe varias ordenes seguidas mientras razona (abrir youtube,
  // luego buscar, luego el video): la ULTIMA es la que de verdad quiere. Antes
  // se ejecutaba la primera y se quedaba a medias abriendo pestañas sueltas.
  // Literal, NO construido desde una cadena: al escaparlo dos veces el patron
  // quedaba en "EJECUTARs*..." y no reconocia ninguna orden.
  // Hasta la ULTIMA llave de la linea, no la primera: un script de PowerShell
  // lleva llaves dentro ("{ 1 } else { Start-Process calc }") y cortar en la
  // primera dejaba el comando en "powershell -NoProfile -Command", que no hace
  // nada. Esa respuesta ya estaba pagada.
  const todas=[...t.matchAll(/EJECUTAR\s*(\{.*\})/gim)]
  // Descartar las lineas de MUESTRA: el prompt viaja escrito en el propio hilo,
  // asi que sus ejemplos se leian como ordenes y se ejecutaban de verdad (llego
  // a abrir el bloc de notas, el explorador y a matar Spotify de una tacada).
  // Se ignora lo que traiga un hueco por rellenar o venga de una linea de guia.
  const utiles=todas.filter(x=>{
    const bruto=String(x[1]||'')
    // Huecos por rellenar: <programa>, o el hueco EN MAYUSCULAS del formato,
    // que el modelo llego a copiar tal cual.
    if(/<[^>]{1,40}>/.test(bruto)) return false
    if(/"(command|path|query)"\s*:\s*"[A-Z][A-Z_]{3,}"/.test(bruto)) return false
    // Notion pinta como formula todo lo que lleve un dolar: el comando llega
    // con letras matematicas ("𝑀 𝑎 𝑖 𝑛") y no se puede ejecutar.
    if(/[\u{1D400}-\u{1D7FF}]/u.test(bruto)) return false
    const nl=t.lastIndexOf(String.fromCharCode(10),x.index)
    return !/(->|→)\s*$/.test(t.slice(nl+1,x.index))
  })
  const m=utiles.length?utiles[utiles.length-1]:null
  if(!m) return null
  try{
    const o=JSON.parse(m[1])
    if(o&&o.tool) return {tool:String(o.tool),args:o.args||{}}
  }catch{}
  // El modelo mete comillas dobles dentro del comando y rompe su propio JSON
  // ("command":"cmd /c "dir ..."'). Se rescatan los campos a mano en vez de
  // devolverle al usuario la linea cruda.
  const tool=(m[1].match(/"tool"\s*:\s*"([a-z_]+)"/i)||[])[1]
  if(!tool) return null
  const bruto=m[1]
  const CAMPOS=['command','path','cwd','query','content','from','to']
  const args={}
  for(const campo of CAMPOS){
    const marca='"'+campo+'":'
    let i=bruto.indexOf(marca)
    if(i<0){ const alt=bruto.indexOf('"'+campo+'" :'); if(alt<0) continue; i=alt }
    let j=bruto.indexOf('"',i+marca.length)          // comilla que abre el valor
    if(j<0) continue
    // El valor acaba en la ultima comilla anterior al siguiente campo (o al
    // cierre): asi sobreviven las comillas dobles que el modelo mete dentro.
    let corte=bruto.length
    for(const otro of CAMPOS){
      if(otro===campo) continue
      const k=bruto.indexOf(',"'+otro+'"',j)
      if(k>=0&&k<corte) corte=k
    }
    const trozo=bruto.slice(j+1,corte)
    const fin=trozo.lastIndexOf('"')
    const valor=(fin>=0?trozo.slice(0,fin):trozo).replace(/\\"/g,'"').trim()
    if(valor) args[campo]=valor
  }
  return Object.keys(args).length?{tool,args}:null
}
// El modelo coopera a ratos: unas veces pide la orden EJECUTAR y otras responde
// que "no tiene acceso al PC". Cuando la peticion nombra una ruta concreta no
// hace falta su permiso: el CLI la resuelve antes de preguntar y le pasa el dato
// hecho. Asi la respuesta no depende de su humor.
async function contextoDelPc(texto){
  const t=String(texto||'')
  const m=t.match(/(~\/[^\s"']+|(?:\.\.?\/)?[A-Za-z0-9_.-]+\/[^\s"']+)/)
  const mencionaEscritorio=/escritorio|desktop/i.test(t)
  const ruta=m?m[1]:(mencionaEscritorio?'~/Desktop':null)
  if(!ruta) return null
  const pareceArchivo=/\.[A-Za-z0-9]{1,6}$/.test(ruta)
  try{
    const r=await ejecutarHerramienta(pareceArchivo?'read_text_file':'list_files',{path:ruta})
    if(!r.ok) return null
    let dato=String(r.texto||'').slice(0,6000)
    try{
      const filas=JSON.parse(r.texto)
      if(Array.isArray(filas)&&filas.length&&filas[0]&&filas[0].type){
        const dirs=filas.filter(x=>x.type==='directory').length
        dato='RECUENTO EXACTO: '+filas.length+' entradas = '+dirs+' carpetas + '+(filas.length-dirs)+' archivos.'+String.fromCharCode(10)+dato
      }
    }catch{}
    log('[pc] adjunto '+(pareceArchivo?'read_text_file':'list_files')+' '+ruta)
    return 'DATOS DEL PC (ya leidos por el CLI, ruta '+ruta+'):'+String.fromCharCode(10)+dato
  }catch(error){ log('[pc] no pude leer '+ruta+': '+error.message); return null }
}
// Crear/escribir archivos tambien tiene que funcionar sin depender de que el
// modelo acepte: si la peticion trae ruta Y contenido, lo escribe el CLI y a
// Notion solo le llega la confirmacion.
async function escrituraEnPc(texto){
  const t=String(texto||'')
  if(!/(crea|crear|escribe|escribir|guarda|guardar|genera|generar)/i.test(t)) return null
  const ruta=(t.match(/(~\/[^\s"',]+\.[A-Za-z0-9]{1,6})/)||[])[1]
  if(!ruta) return null
  const cuerpo=(t.match(/(?:con (?:el )?(?:texto|contenido)|que diga|diciendo)\s*:?\s*([\s\S]+)$/i)||[])[1]
  if(!cuerpo||!cuerpo.trim()) return null
  const contenido=cuerpo.trim()
  const r=await ejecutarHerramienta('write_text_file',{path:ruta,content:contenido}).catch(e=>({ok:false,texto:e.message}))
  log('[pc] write_text_file '+ruta+' -> '+(r.ok?'ok':'fallo'))
  return r.ok
    ? 'HECHO por el CLI: archivo '+ruta+' escrito con el contenido: '+contenido
    : 'NO se pudo escribir '+ruta+': '+String(r.texto||'').slice(0,200)
}
// Los comandos NO se mandan al servidor MCP: alli se ejecutan sin sesion de
// escritorio y sin PATH completo ("Error: spawn cmd.exe ENOENT"), asi que
// "abre Chrome" devolvia ok sin abrir nada. El daemon corre en la sesion del
// usuario, de modo que lanzarlos aqui si abre ventanas de verdad.
function rutaReal(p){
  const base=os.homedir()
  let r=String(p||'').trim().replace(/^~[/\\]?/,'')
  if(/^[A-Za-z]:/.test(r)) return r
  return r?path.join(base,r):base
}
// "cmd /c start X" no abre nada lanzado desde el daemon: cmd termina y se lleva
// al hijo por delante. Para ABRIR algo hay que usar Start-Process y soltarlo.
function comandoDeApertura(comando){
  const c=String(comando||'').trim()
  const m=c.match(/^(?:cmd(?:\.exe)?\s+\/c\s+)?start\s+(?:"[^"]*"\s+|''\s+)?(.+)$/i)
  if(!m) return null
  let resto=m[1].trim()
  if(!resto) return null
  // "start chrome https://..." son DOS cosas: programa y argumento. Tratarlo
  // todo como nombre daba Start-Process -FilePath "chrome https://..." y
  // "El sistema no puede encontrar el archivo".
  let prog=null, args=null
  const conComillas=resto.match(/^"([^"]+)"\s*(.*)$/)
  if(conComillas){ prog=conComillas[1]; args=conComillas[2].trim()||null }
  else {
    const partes=resto.split(/\s+/)
    prog=partes.shift()
    args=partes.length?partes.join(' '):null
    // Una ruta con espacios y sin comillas ("start C:/Program Files/x.exe") se
    // toma entera; pero si lo que sigue al programa es claramente un argumento
    // (una URL, aunque venga entrecomillada, o una opcion), NO se junta.
    const pareceArgumento=args&&/^["']?(https?:|--|\/|-)/i.test(args)
    if(args&&!pareceArgumento&&/[\/]/.test(resto)){ prog=resto; args=null }
  }
  prog=String(prog||'').replace(/^["']|["']$/g,'').trim()
  // El modelo entrecomilla las URLs ("start chrome 'https://...'") y Chrome
  // recibia las comillas como parte de la direccion.
  if(args) args=String(args).trim().replace(/^["']+|["']+$/g,'').trim()||null
  return prog?{prog,args}:null
}
async function existeComando(nombre){
  const n=String(nombre).replace(/["']/g,'').trim()
  if(!n||/[\/]/.test(n)) return false
  const guion=[
    '$n=' + JSON.stringify(n),
    'if(Get-Command $n -ErrorAction SilentlyContinue){"SI";exit}',
    'foreach($r in @("HKLM:","HKCU:")){',
    '  $p=Join-Path $r ("SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\\" + $n + ".exe")',
    '  if(Test-Path $p){"SI";exit}',
    '}',
    '"NO"',
  ].join(String.fromCharCode(10))
  try{
    const r=await psEval(guion,15000)
    return /\bSI\b/.test(String((r&&r.texto)||r||''))
  }catch{ return false }
}
function abrirLocal(objetivo,cwd,argumentos,reintentado){
  return new Promise(resolve=>{
    // Se COMPRUEBA que la ventana existe de verdad: dar por bueno el lanzamiento
    // hacia que el CLI dijera "listo, ya esta abierto" sin haber abierto nada
    // (pasa si el daemon corre sin sesion grafica: entonces no hay escritorio
    // donde dibujar la ventana).
    // Si lo que se abre es una URL o un documento, no hay proceso con ese nombre:
    // se comprueba que haya aparecido un navegador (o se acepta sin verificar).
    const esUrl=/^(https?:|www\.)/i.test(String(objetivo).trim())
    const esAcceso=/\.(lnk|url)$/i.test(String(objetivo))   // abre OTRO ejecutable: no vale comprobar su nombre
    const nombre=esUrl?'':String(objetivo).replace(/^.*[\/]/,'').replace(/\.(exe|lnk)$/i,'').replace(/:+$/,'')
    const sonda=esUrl?'chrome,msedge,firefox,brave,opera':nombre
    // Un .lnk apunta a otro ejecutable ("HaxBall AAA.lnk" -> app.exe): se resuelve
    // el destino y se comprueba ESE nombre, que es el que aparece en procesos.
    const guion='$ErrorActionPreference="Stop";'+
      (esAcceso?('$sh=New-Object -ComObject WScript.Shell;'+
                 '$destino=$sh.CreateShortcut('+JSON.stringify(objetivo)+').TargetPath;'+
                 '$sonda=[System.IO.Path]::GetFileNameWithoutExtension($destino);'):'$sonda=$null;')+
      'if(-not $sonda){$sonda=@('+sonda.split(',').map(n=>JSON.stringify(n)).join(',')+')};'+
      // Si YA esta abierto se contesta en el acto y no se lanza nada: reabrir lo
      // que ya estaba abierto era lo que hacia repetir el intento una y otra vez.
      (esUrl?'':'$ya=Get-Process -Name $sonda -ErrorAction SilentlyContinue; if($ya){"YA_ABIERTO:"+@($ya).Count; exit};')+
      'Start-Process -FilePath '+JSON.stringify(objetivo)+
        (argumentos?' -ArgumentList '+JSON.stringify(String(argumentos)):'')+
        ' -WorkingDirectory '+JSON.stringify(rutaReal(cwd||''))+';'+
      // Espera con reintentos: 3 s fijos daban falso negativo con aplicaciones
      // que tardan en arrancar (Spotify abria y se reportaba "fallo").
      '$p=$null; for($i=0;$i -lt 22 -and -not $p;$i++){ Start-Sleep -Milliseconds 900;'+
      '  $p=Get-Process -Name $sonda -ErrorAction SilentlyContinue };'+
      'if($p){"ABIERTO:"+@($p).Count}else{"LANZADO_SIN_VENTANA"}'
    const ps=spawn('powershell',['-NoProfile','-Command',guion],{windowsHide:true,stdio:['ignore','pipe','pipe']})
    let out='',err='',cerrado=false
    // Tope: la comprobacion espera hasta 20 s por dentro; si PowerShell se
    // cuelga, sin esto la peticion no terminaba nunca.
    const tope=setTimeout(()=>{ if(cerrado) return; cerrado=true; try{ps.kill()}catch{}
      resolve({ok:true,texto:'lancé '+objetivo+' (no pude confirmar la ventana a tiempo)'}) },35000)
    ps.stdout.on('data',d=>{out+=String(d)})
    ps.stderr.on('data',d=>{err+=String(d)})
    ps.on('error',e=>{ if(cerrado) return; cerrado=true; clearTimeout(tope); resolve({ok:false,texto:'no pude abrir '+objetivo+': '+e.message}) })
    ps.on('close',()=>{
      if(cerrado) return; cerrado=true; clearTimeout(tope)
      const t=out.trim()
      if(/^YA_ABIERTO:/.test(t)) return resolve({ok:true,texto:objetivo+' ya estaba abierto'})
      if(/^ABIERTO:/.test(t)) return resolve({ok:true,texto:'abierto: '+objetivo+' ('+t.split(':')[1]+' procesos)'})
      if(err.trim()) return resolve({ok:false,texto:'no se pudo abrir '+objetivo+': '+err.trim().slice(0,200)})
      // Sin proceso visible: si era una URL o un documento pudo abrirse igual en
      // una ventana ya existente, asi que no se afirma que haya fallado.
      if(esUrl) return resolve({ok:true,texto:'abierto: '+objetivo})
      // El nombre no estaba en el PATH ("start spotify" no abre nada porque
      // Spotify no se registra ahi). La IA acerto con la intencion; el CLI se
      // encarga de encontrar el programa y reintentar con su ruta real.
      if(!reintentado&&!/[\/]/.test(String(objetivo))){
        // Ojo: muchos programas arrancan con OTRO nombre de proceso ("calc"
        // levanta CalculatorApp), asi que no verlo no significa que fallara.
        // Solo se busca cuando el nombre NO existe en el equipo, como pasa con
        // Spotify, que no se registra en el PATH.
        existeComando(String(objetivo)).then(existe=>{
          if(existe) return resolve({ok:true,texto:'abierto: '+objetivo})
          return buscarPrograma(String(objetivo)).then(ruta=>{
            if(!ruta) return resolve({ok:false,texto:'no encontré "'+objetivo+'" en este equipo'})
            log('[pc] "'+objetivo+'" no estaba en el PATH; lo abro desde '+ruta)
            resolve(abrirLocal(ruta,cwd,argumentos,true))
          })
        }).catch(()=>resolve({ok:false,texto:'no pude abrir '+objetivo}))
        return
      }
      resolve({ok:false,texto:'lancé '+objetivo+' pero no veo su ventana (¿se cerró enseguida?)'})
    })
  })
}
// PowerShell directo, sin cmd por medio: evita el infierno de comillas anidadas
// al pasar guiones que ya llevan las suyas.
function psEval(guion,topeMs=45000){
  return new Promise(resolve=>{
    // Tope duro: sin esto un PowerShell colgado dejaba la peticion esperando
    // para siempre, y el panel en "trabajando" sin fin.
    let cerrado=false
    const tope=setTimeout(()=>{ if(cerrado) return; cerrado=true; try{ps.kill()}catch{}
      resolve({ok:false,texto:'la orden tardó demasiado y se canceló'}) },topeMs)
    // -EncodedCommand (UTF-16LE en base64): pasar el guion con -Command hacia que
    // Windows re-serializara los argumentos y rompiera las comillas internas, asi
    // que guiones que funcionaban a mano devolvian vacio.
    // Salida en UTF-8: sin esto los acentos volvian rotos ("pï¿½ginas") porque
    // PowerShell escribe en la pagina de codigos de la consola.
    const conUtf8='[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;'+String.fromCharCode(10)+String(guion)
    const b64=Buffer.from(conUtf8,'utf16le').toString('base64')
    const ps=spawn('powershell',['-NoProfile','-EncodedCommand',b64],{windowsHide:true,stdio:['ignore','pipe','pipe']})
    let out='',err=''
    ps.stdout.on('data',d=>{out+=String(d)})
    ps.stderr.on('data',d=>{err+=String(d)})
    ps.on('error',e=>{ if(cerrado) return; cerrado=true; clearTimeout(tope); resolve({ok:false,texto:e.message}) })
    ps.on('close',code=>{ if(cerrado) return; cerrado=true; clearTimeout(tope); resolve({ok:code===0,texto:(out||err||'').trim()}) })
  })
}
function ejecutarLocal(comando,cwd){
  const apertura=comandoDeApertura(comando)
  if(apertura) return abrirLocal(apertura.prog,cwd,apertura.args)
  // Consultas de PowerShell: van por -EncodedCommand. Pasarlas por cmd rompia
  // las comillas dobles que el modelo mete dentro del script y PowerShell
  // acababa recibiendo argumentos sueltos ("Los valores válidos son Text o XML").
  const ps=String(comando||'').match(/^\s*(?:powershell|pwsh)(?:\.exe)?\s+(.*)$/is)
  if(ps){
    const resto=ps[1]
    const c=resto.match(/-c(?:ommand)?\s+([\s\S]+)$/i)
    if(c){
      let guion=c[1].trim()
      // El script suele venir entre comillas: se quitan solo las de fuera.
      if(/^"[\s\S]*"$/.test(guion)||/^'[\s\S]*'$/.test(guion)) guion=guion.slice(1,-1)
      return psEval(guion,45000)
    }
  }
  return new Promise(resolve=>{
    const shell=process.env.ComSpec||'C:\Windows\System32\cmd.exe'
    const hijo=spawn(shell,['/d','/s','/c',String(comando)],
      {cwd:rutaReal(cwd||''),windowsHide:true,detached:false,stdio:['ignore','pipe','pipe']})
    let out='',err=''
    hijo.stdout.on('data',d=>{out+=String(d)})
    hijo.stderr.on('data',d=>{err+=String(d)})
    const tope=setTimeout(()=>{try{hijo.kill()}catch{}; resolve({ok:true,texto:(out||'(lanzado en segundo plano)').slice(0,4000)})},20000)
    hijo.on('close',code=>{clearTimeout(tope)
      resolve({ok:code===0,texto:((out+(err?String.fromCharCode(10)+err:''))||'(sin salida, codigo '+code+')').slice(0,4000)})})
    hijo.on('error',e=>{clearTimeout(tope); resolve({ok:false,texto:'no pude ejecutar: '+e.message})})
  })
}
async function ejecutarOrden(tool,args){
  if(tool==='run_command'||tool==='start_background_command')
    return await ejecutarLocal(args.command,args.cwd)
  return await ejecutarHerramienta(tool,args)
}
// Abrir programas/archivos tampoco puede depender del modelo: arrastra ordenes
// de mensajes anteriores del hilo (pidiendole el HaxBall repetia el "start
// chrome" y hasta una busqueda de Google del mensaje de antes). Si la peticion
// dice "abre X", lo abre el CLI y a Notion solo le llega la confirmacion.
const APPS = { chrome:'chrome', 'google chrome':'chrome', edge:'msedge', firefox:'firefox',
  notepad:'notepad', bloc:'notepad', explorador:'explorer', explorer:'explorer',
  calculadora:'calc', spotify:'spotify', discord:'discord', code:'code', vscode:'code' }
// Busca un programa por nombre en el Escritorio y en los menus de Inicio (del
// usuario y de la maquina). Antes solo miraba el Escritorio y a las apps
// conocidas les anteponia esa carpeta, asi que "discord" acababa en la ruta
// inventada ~/Desktop/discord.
async function buscarPrograma(consulta){
  const q=String(consulta||'').trim()
  if(!q) return null
  // Se busca en TODO lo que Windows conoce, para no tener que ir anadiendo
  // aplicaciones a mano cada vez que se instala una:
  //   1. App Paths del registro (chrome, spotify, code... lo que se registra al instalar)
  //   2. los menus de Inicio (usuario y maquina) y el Escritorio
  //   3. %LOCALAPPDATA%\Programs (instalaciones por usuario, tipo Discord)
  const guion=[
    '$q='+JSON.stringify(q)+';',
    '$pal=@($q -split "\\s+" | Where-Object { $_.Length -gt 2 });',
    '$c=New-Object System.Collections.ArrayList;',
    'foreach($k in @("HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths","HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths")){',
    '  Get-ChildItem $k -ErrorAction SilentlyContinue | ForEach-Object {',
    '    $n=[System.IO.Path]::GetFileNameWithoutExtension($_.PSChildName);',
    '    $v=(Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue)."(default)";',
    '    if($v){ [void]$c.Add([pscustomobject]@{N=$n.ToLower();R=$v}) } } }',
    '$dirs=@("$env:USERPROFILE\\Desktop","$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs","$env:ProgramData\\Microsoft\\Windows\\Start Menu\\Programs","$env:LOCALAPPDATA\\Programs");',
    'Get-ChildItem -Path $dirs -Recurse -File -ErrorAction SilentlyContinue |',
    '  Where-Object { $_.Extension -eq ".lnk" -or $_.Extension -eq ".exe" } |',
    '  ForEach-Object { [void]$c.Add([pscustomobject]@{N=$_.BaseName.ToLower();R=$_.FullName}) };',
    '$m=$c | ForEach-Object { $x=$_; $p=0; foreach($w in $pal){ if($x.N -like "*$($w.ToLower())*"){$p++} };',
    '  if($p -gt 0){ [pscustomobject]@{R=$x.R;P=$p;L=$x.N.Length} } } |',
    '  Sort-Object -Property @{Expression="P";Descending=$true},@{Expression="L";Descending=$false} |',
    '  Select-Object -First 1 -ExpandProperty R;',
    'if($m){$m}else{"NADA"}'
  ].join('')
  const r=await psEval(guion)
  const ruta=String(r.texto||'').trim().split(/\r?\n/).pop()
  log('[buscar] '+q+' -> '+String(ruta||'(vacio)').slice(0,90))
  return (!ruta||ruta==='NADA')?null:ruta
}
// Abrir una direccion web: "ve a youtube.com", "abre chrome y ve a youtube.com".
// Antes solo se abria el programa y la URL se perdia.
function extraerUrl(texto){
  const t=String(texto||'')
  const m=t.match(/(https?:\/\/[^\s"']+|(?:www\.)?[a-z0-9-]+\.(?:com|net|org|es|io|tv|gg|dev|app|co)(?:\/[^\s"']*)?)/i)
  if(!m) return null
  let u=m[1].replace(/[.,;]+$/,'')
  if(!/^https?:/i.test(u)) u='https://'+u
  return u
}
// Lista de programas con ventana abierta. Sin esto el modelo no sabia que
// Chrome ya estaba abierto y volvia a lanzarlo una y otra vez.
let _abiertos={t:0,txt:''}
async function programasAbiertos(){
  if(Date.now()-_abiertos.t<15000) return _abiertos.txt
  const r=await psEval('Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | '+
    'Select-Object -ExpandProperty ProcessName -Unique | Sort-Object', 15000).catch(()=>null)
  const txt=String(r&&r.texto||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean).join(', ').slice(0,400)
  _abiertos={t:Date.now(),txt}
  return txt
}
async function webEnPc(texto){
  const bruto=String(texto||'').trim(), bajo=bruto.toLowerCase()
  const url=extraerUrl(bruto)
  if(!url) return null
  // Solo si de verdad se pide navegar, no si la direccion aparece de pasada.
  if(!/(^|[^a-z])(ve|vete|entra|navega|abre|abrir|pon|carga|visita)([^a-z]|$)/.test(bajo)) return null
  const nav = bajo.includes('chrome')?'chrome' : (bajo.includes('edge')?'msedge' : (bajo.includes('firefox')?'firefox':null))
  const guion = nav
    ? 'Start-Process -FilePath '+JSON.stringify(nav)+' -ArgumentList '+JSON.stringify(url)+'; "OK"'
    : 'Start-Process '+JSON.stringify(url)+'; "OK"'
  const r=await psEval(guion,20000)
  log('[pc] web '+url+(nav?' en '+nav:'')+' -> '+(r.ok?'ok':'fallo '+String(r.texto||'').slice(0,60)))
  saveState({ultimoObjetivo:nav||'navegador',version:VERSION})
  return r.ok?('HECHO por el CLI: abierto '+url+(nav?' en '+nav:''))
             :('NO se pudo abrir '+url+': '+String(r.texto||'').slice(0,150))
}
// Buscar/reproducir algo en un sitio. Es un patron general (sitio + termino),
// no una lista de aplicaciones: "busca X en youtube", "pon X en spotify",
// "reproduce un video de X". Existe porque el modelo tarda minutos o se cuelga
// justo en lo mas cotidiano.
const SITIOS = {
  youtube:'https://www.youtube.com/results?search_query=',
  google:'https://www.google.com/search?q=',
  spotify:'https://open.spotify.com/search/',
  twitch:'https://www.twitch.tv/search?term=',
  amazon:'https://www.amazon.com/s?k=',
  wikipedia:'https://es.wikipedia.org/w/index.php?search=',
}
async function busquedaEnPc(texto){
  const bruto=String(texto||'').trim(), bajo=bruto.toLowerCase()
  const VERBOS=['busca','buscar','buscame','reproduce','reproducir','pon','ponme','poneme','corre','abre','abreme','mira','ver']
  const palabras=bajo.split(/[^a-z0-9áéíóúñ]+/i).filter(Boolean)
  if(!palabras.some(w=>VERBOS.some(v=>w.startsWith(v)))) return null
  let sitio=null, clave=null
  for(const k of Object.keys(SITIOS)){ if(bajo.includes(k)){ sitio=SITIOS[k]; clave=k; break } }
  // "abre un video de X", "pon la cancion Y": si no dice donde, es YouTube.
  if(!sitio&&/(video|videos|vídeo|vídeos|cancion|canción|tema|musica|música|clip|gameplay)/.test(bajo)){
    sitio=SITIOS.youtube; clave='youtube'
  }
  if(!sitio) return null
  // El termino es lo que queda al quitar el sitio, los verbos y las muletillas.
  const FUERA=new Set([clave,'busca','buscar','buscame','reproduce','reproducir','pon','ponme','poneme',
    'corre','abre','abreme','mira','ver','un','una','el','la','los','las','lo','de','del','en','y','a',
    'video','videos','cancion','tema','algo','cualquiera','porfa','favor','por','mi','pc','me'])
  const termino=palabras.filter(w=>!FUERA.has(w)).join(' ').trim()
  if(!termino) return null          // "abre youtube" a secas: es apertura, no busqueda
  const url=sitio+encodeURIComponent(termino)
  const r=await psEval('Start-Process '+JSON.stringify(url)+'; "OK"',20000)
  log('[pc] buscar "'+termino+'" en '+clave+' -> '+(r.ok?'ok':'fallo'))
  saveState({ultimoObjetivo:clave,version:VERSION})
  return r.ok?('HECHO por el CLI: abierta la búsqueda de "'+termino+'" en '+clave)
             :('NO se pudo buscar en '+clave+': '+String(r.texto||'').slice(0,150))
}
async function aperturaEnPc(texto){
  // Deteccion por palabras, no por una expresion larga: la version con regex
  // no casaba en ejecucion y fallaba en silencio.
  const bruto=String(texto||'').trim()
  const bajo=bruto.toLowerCase()
  const VERBOS=['abrelo','ábrelo','abrela','ábrela','abreme','ábreme','abrime',
    'abre','abrir','lanzalo','lánzalo','lanza','lanzar','ejecutalo','ejecútalo',
    'ejecuta','ejecutar','inicialo','inícialo','inicia','iniciar','pon']
  let corte=-1, largo=0, conPronombre=false
  for(const v of VERBOS){
    const i=bajo.indexOf(v)
    if(i<0) continue
    const sig=bajo[i+v.length]
    if(sig!==undefined&&sig!==' '&&sig!=='.'&&sig!==',') continue
    if(corte<0||i<corte){ corte=i; largo=v.length; conPronombre=/(lo|la|los|las)$/.test(v) }
  }
  if(corte<0) return null
  let objetivo=bruto.slice(corte+largo).trim()
  objetivo=objetivo.replace(/^(el|la|los|las|un|una)\s+/i,'')
  objetivo=objetivo.replace(/^(programa|aplicaci[oó]n|app|archivo|fichero)\s+/i,'')
  // Coletillas que no forman parte del nombre: "abre el youtube EN MI PC" no
  // encontraba nada porque buscaba "youtube en mi pc".
  objetivo=objetivo.replace(/\s+(en|de|desde)\s+(mi|el|la)\s+(pc|ordenador|computadora|equipo|maquina|escritorio)[^]*$/i,'')
  objetivo=objetivo.replace(/\s*(por favor|porfa|porfavor|ahora|ya|please)\s*$/i,'')
  objetivo=objetivo.replace(/[.?!,]+$/,'').trim()
  // "abrelo" no nombra nada: se refiere a lo ultimo de lo que hablamos (lo que
  // se abrio o se cerro). Sin esto la peticion caia en el modelo, que repetia
  // ordenes viejas del hilo.
  if(conPronombre||!objetivo||/^(eso|esto|aquello|ahora|ya|de nuevo|otra vez)$/i.test(objetivo)){
    const ult=loadState().ultimoObjetivo||loadState().ultimoAbierto?.objetivo
    if(!ult) return 'No sé qué abrir: dime el nombre del programa'
    objetivo=typeof ult==='string'?ult:String(ult.objetivo||'')
    log('[pc] pronombre -> último objetivo: '+objetivo)
  }
  if(!objetivo||objetivo.length>60) return null
  // "pon human nature de michael jackson en spotify" NO es "abrir un programa":
  // el atajo abria Spotify y se comia la cancion. Si la peticion trae mas que un
  // nombre, se deja al camino general (el modelo con EJECUTAR), que puede usar
  // protocolos como spotify:search:.
  const palabrasObj=objetivo.split(/\s+/).filter(Boolean)
  const bajoObj=objetivo.toLowerCase()
  // Conocida solo si el objetivo ES el nombre del programa (o poco mas): asi
  // "bloc de notas" sigue siendo un atajo y "human nature ... en spotify" no.
  const conocida=!!APPS[bajoObj]||(palabrasObj.length<=3&&Object.keys(APPS).some(k=>bajoObj.includes(k)))
  if(!conocida&&palabrasObj.length>3){
    log('[pc] "'+objetivo.slice(0,40)+'" es más que un programa; lo dejo al modelo')
    return null
  }
  const clave=objetivo.toLowerCase()
  // 1) aplicacion conocida
  // 1) aplicacion conocida: se pasa el nombre TAL CUAL a Start-Process (antes se
  //    le anteponia el Escritorio y "discord" acababa en ~/Desktop/discord).
  let destino=APPS[clave]||null
  if(!destino){
    const k=Object.keys(APPS).filter(x=>clave===x||clave.includes(x)).sort((a,b)=>b.length-a.length)[0]
    if(k) destino=APPS[k]
  }
  let esRutaCompleta=false
  // 2) si no, se busca en Escritorio y menus de Inicio (encuentra Discord, Spotify...)
  if(!destino){
    const hallado=await buscarPrograma(objetivo)
    if(hallado){ destino=hallado; esRutaCompleta=true }
  }
  // Sin programa instalado con ese nombre: si parece un servicio ("abre youtube",
  // "abre gmail"), se abre su web. Antes se rendia y la peticion caia al modelo.
  if(!destino&&palabrasObj.length===1&&/^[a-z0-9][a-z0-9.-]{2,30}$/i.test(objetivo)){
    const sitio='https://'+objetivo.replace(/\s+/g,'').toLowerCase()+(/\./.test(objetivo)?'':'.com')
    const r=await psEval('Start-Process '+JSON.stringify(sitio)+'; "OK"',20000)
    log('[pc] web (sin programa) '+sitio+' -> '+(r.ok?'ok':'fallo'))
    if(r.ok){ saveState({ultimoObjetivo:objetivo,version:VERSION}); return 'HECHO por el CLI: abierto '+sitio }
  }
  if(!destino) return null
  // Ruta COMPLETA: con el nombre a secas Start-Process no lo encuentra aunque se
  // le pase el directorio de trabajo.
  const ruta=(esRutaCompleta||/^[A-Za-z]:/.test(destino))?destino:destino
  const r=await ejecutarLocal('start "'+ruta+'"','~/Desktop')
  log('[pc] abrir '+destino+' -> '+(r.ok?'ok':'fallo'))
  // Se recuerda para poder atender "cierralo" despues, sin nombrar nada.
  if(r.ok) saveState({ultimoAbierto:{objetivo,destino,at:Date.now()},ultimoObjetivo:objetivo,version:VERSION})
  return (r.ok?'HECHO por el CLI: ':'NO se pudo abrir: ')+destino+' — '+String(r.texto||'').slice(0,200)
}
// Cerrar programas, tambien sin depender del modelo: pedia
// taskkill /IM "HaxBall AAA.exe" cuando el proceso real es app.exe (el nombre
// del acceso directo no es el del ejecutable), fallaba y el cliente seguia
// abierto.
const NO_CERRAR = ['explorer','node','electron','msedge','chrome.*headless','powershell','cmd','conhost','dwm','csrss','winlogon','services','svchost','shosso','bridgemind']
function esProtegido(nombre){
  const n=String(nombre||'').toLowerCase()
  return NO_CERRAR.some(x=>new RegExp('^'+x+'$').test(n))
}
// Acciones de ventana (minimizar, maximizar, restaurar). Faltaban: "minimiza el
// discord" acababa en el modelo, que no tiene forma de hacerlo.
const ACCIONES_VENTANA = { minimiza:6, minimizar:6, minimizalo:6, minimízalo:6,
  maximiza:3, maximizar:3, maximizalo:3, maximízalo:3,
  restaura:9, restaurar:9, restauralo:9, restáuralo:9 }
async function ventanaEnPc(texto){
  const bruto=String(texto||'').trim(), bajo=bruto.toLowerCase()
  let verbo=null, corte=-1
  for(const v of Object.keys(ACCIONES_VENTANA)){
    const i=bajo.indexOf(v)
    if(i<0) continue
    const sig=bajo[i+v.length]
    if(sig!==undefined&&sig!==' '&&sig!=='.'&&sig!==',') continue
    if(corte<0||i<corte){ corte=i; verbo=v }
  }
  if(!verbo) return null
  let objetivo=bruto.slice(corte+verbo.length).trim()
    .replace(/^(el|la|los|las|un|una)\s+/i,'')
    .replace(/^(programa|aplicaci[oó]n|app|cliente|ventana)\s+(de\s+)?/i,'')
    .replace(/[.?!,]+$/,'').trim()
  if(/lo$|la$/.test(verbo)&&!objetivo){
    const ult=loadState().ultimoAbierto
    objetivo=ult&&ult.objetivo||''
  }
  if(!objetivo) return 'No sé qué ventana: dime el nombre del programa'
  const clave=objetivo.toLowerCase()
  let proceso=APPS[clave]||null
  if(!proceso){
    const k=Object.keys(APPS).filter(x=>clave===x||clave.includes(x)).sort((a,b)=>b.length-a.length)[0]
    if(k) proceso=APPS[k]
  }
  if(!proceso) proceso=clave.split(/\s+/)[0]
  const modo=ACCIONES_VENTANA[verbo]
  const guion='Add-Type -Name W -Namespace N -MemberDefinition \'[DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h,int c);\';'+
    '$p=Get-Process '+JSON.stringify(proceso)+' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 };'+
    'if($p){ foreach($x in $p){ [N.W]::ShowWindowAsync($x.MainWindowHandle,'+modo+') | Out-Null }; "HECHO:"+$p.Count } else { "SIN_VENTANA" }'
  const r=await psEval(guion)
  const salida=String(r.texto||'')
  log('[pc] ventana '+verbo+' '+proceso+' -> '+salida.trim().slice(0,30))
  if(/HECHO:/.test(salida)) return 'HECHO por el CLI: '+verbo+' '+objetivo+' ('+proceso+')'
  if(/SIN_VENTANA/.test(salida)) return 'NO se pudo: '+objetivo+' no tiene ventana abierta'
  return 'NO se pudo '+verbo+' '+objetivo+': '+salida.slice(0,120)
}
async function cierreEnPc(texto){
  const bruto=String(texto||'').trim(), bajo=bruto.toLowerCase()
  const VERBOS=['cierralo','ciérralo','cierrala','ciérrala','cierralos','ciérralos','cierrame','ciérrame',
    'cierra','cerrar','cierralo','matalo','mátalo','mata','matar','termina','terminar','finaliza','finalizar']
  let corte=-1,largo=0,conPronombre=false
  for(const v of VERBOS){
    const i=bajo.indexOf(v)
    if(i<0) continue
    const sig=bajo[i+v.length]
    if(sig!==undefined&&sig!==' '&&sig!=='.'&&sig!==',') continue   // evitar cazar dentro de otra palabra
    if(corte<0||i<corte){ corte=i; largo=v.length; conPronombre=/(lo|la|los|las)$/.test(v) }
  }
  if(corte<0) return null
  let objetivo=bruto.slice(corte+largo).trim()
    .replace(/^(el|la|los|las|un|una)\s+/i,'')
    .replace(/^(programa|aplicaci[oó]n|app|cliente|ventana)\s+(de\s+)?/i,'')
    .replace(/\s+(ahora|ya|porfa|por favor)$/i,'')
    .replace(/[.?!,]+$/,'').trim()
  // "cierralo ahora" no nombra nada: se refiere a lo ultimo que abrimos.
  if(conPronombre||!objetivo||/^(eso|esto|aquello|ahora|ya)$/i.test(objetivo)){
    const ult=loadState().ultimoAbierto
    if(!ult||!ult.objetivo) return 'No sé qué cerrar: dime el nombre del programa'
    objetivo=ult.objetivo
    log('[pc] "ciérralo" -> último abierto: '+objetivo)
  }
  if(!objetivo||objetivo.length>60) return null
  const clave=objetivo.toLowerCase()
  // nombre del ejecutable: app conocida, o el destino real del acceso directo
  let proceso=APPS[clave]||null
  if(!proceso){
    const k=Object.keys(APPS).filter(x=>clave===x||clave.includes(x)).sort((a,b)=>b.length-a.length)[0]
    if(k) proceso=APPS[k]
  }
  if(!proceso){
    const r=await ejecutarHerramienta('list_files',{path:'~/Desktop'}).catch(()=>null)
    let nombres=[]
    try{ const j=JSON.parse(r&&r.texto||'[]'); if(Array.isArray(j)) nombres=j.map(x=>x.name).filter(Boolean) }catch{}
    const palabras=clave.split(/\s+/).filter(p=>p.length>2)
    const mejor=nombres.filter(c=>/\.(lnk|exe)$/i.test(c))
      .map(c=>({c,pts:palabras.filter(p=>c.toLowerCase().includes(p)).length}))
      .filter(x=>x.pts>0).sort((a,b)=>b.pts-a.pts||a.c.length-b.c.length)[0]
    if(mejor){
      const ruta=path.join(os.homedir(),'Desktop',mejor.c)
      const q=await psEval('$s=New-Object -ComObject WScript.Shell; [System.IO.Path]::GetFileNameWithoutExtension($s.CreateShortcut('+JSON.stringify(ruta)+').TargetPath)')
      proceso=String(q.texto||'').trim().split(/\r?\n/).pop()||null
    }
  }
  if(!proceso) return null
  if(esProtegido(proceso)) return 'NO cierro '+proceso+': es un proceso del sistema o del propio entorno'
  const r=await psEval('$p=Get-Process '+JSON.stringify(proceso)+' -ErrorAction SilentlyContinue; if($p){$n=$p.Count; $p | Stop-Process -Force; "CERRADO:"+$n}else{"NO_ESTABA"}')
  const salida=String(r.texto||'')
  log('[pc] cerrar '+proceso+' -> '+salida.trim().slice(0,40))
  saveState({ultimoObjetivo:objetivo,version:VERSION})   // para un "abrelo" despues
  if(/CERRADO:/.test(salida)) return 'HECHO por el CLI: cerrado '+objetivo+' ('+proceso+', '+(salida.match(/CERRADO:(\d+)/)||[])[1]+' procesos)'
  if(/NO_ESTABA/.test(salida)) return 'HECHO por el CLI: '+objetivo+' ya no estaba abierto'
  return 'NO se pudo cerrar '+objetivo+': '+salida.slice(0,150)
}
async function processPrompt(userText, progress=()=>{}) {
  const { runMode = DEFAULT_MODE } = loadState()
  appendTranscript('Usuario', userText)
  progress('analyzing','Analizando la solicitud y el contexto del workspace',{tool:'Task',action:'Analizar solicitud',detail:'Modo '+runMode})
  if (runMode === 'hidden') {
    let ultimoResultado=null
    const ordenesVistas=new Set()
    // Si la peticion nombra una ruta, se resuelve YA y se le da hecha.
    // La IA interpreta PRIMERO. Los atajos del CLI quedan como RED DE
    // SEGURIDAD: solo entran si ella se niega, no responde o no acierta con la
    // orden. Antes iban delante y la IA casi nunca llegaba a decidir nada, que
    // es justo lo contrario de lo que tiene sentido: el puente existe para que
    // pueda usar el PC entero, no para ejecutar una lista de casos.
    const atajos=loadState().atajosPc!==false
    async function redDeSeguridad(){
      if(!atajos) return null
      const intentos=[busquedaEnPc,webEnPc,ventanaEnPc,cierreEnPc,aperturaEnPc,escrituraEnPc]
      for(const fn of intentos){
        const r=await fn(userText).catch(e=>{log('[pc] '+fn.name+' falló: '+String(e&&e.message||e).slice(0,90));return null})
        if(r) return r
      }
      return null
    }
    // Datos de solo lectura (una ruta mencionada) se adjuntan porque ayudan y no
    // tienen efectos: la decision sigue siendo de la IA.
    const previo=await contextoDelPc(userText).catch(()=>null)
    if(previo){
      progress('working','Leyendo tu PC',{tool:'Terminal',action:'Datos del PC'})
      ultimoResultado=previo
    }
    let ejecutoAlgo=false
    // La IA decide, pero no te hace esperar: si en 40 s no ha ejecutado nada,
    // el CLI resuelve y responde. El flujo de la IA se marca como respondido
    // para que no ejecute la accion por duplicado despues.
    let yaRespondido=false
    const carrera=pidePc(userText)&&atajos
      ? new Promise(r=>setTimeout(async()=>{
          if(ejecutoAlgo||yaRespondido) return r(null)
          const salvado=await redDeSeguridad().catch(()=>null)
          if(salvado&&!ejecutoAlgo&&!yaRespondido){ yaRespondido=true; log('[pc] la IA tardaba; lo resuelve el CLI'); return r(salvado) }
          r(null)
        },40000))
      : new Promise(()=>{})
    const promesaIA=runHiddenPromptWithRotation(previo?(previo+String.fromCharCode(10,10)+'Con esos datos responde: '+userText):userText,progress)
    // Carrera de verdad: gana el primero que tenga algo util.
    const ganador=await Promise.race([
      promesaIA.then(r=>({quien:'ia',r})),
      carrera.then(r=>r?{quien:'cli',r}:new Promise(()=>{})),
    ])
    if(ganador.quien==='ia'){ yaRespondido=false }
    let respuesta=ganador.quien==='ia'?ganador.r:null
    const rescate=ganador.quien==='cli'?ganador.r:null
    if(rescate){
      progress('complete','Hecho',{tool:'Terminal',action:'Completado'})
      const limpio=String(rescate).replace(/^HECHO por el CLI:\s*/,'').replace(/^NO se pudo/,'No se pudo').trim()
      appendTranscript('IA [cli]',limpio)
      return limpio
    }
    // Bucle de herramientas: como mucho 5 pasos, para que un malentendido no
    // encadene ordenes sin fin.
    for(let paso=1;paso<=5;paso++){
      if(yaRespondido) break          // el CLI ya resolvio: no duplicar la accion
      // Todas las ordenes de la respuesta, en el orden en que las escribio: la
      // primera se ejecuta aqui y el resto se encadenan al presentar, que es
      // como lo haria el MCP dentro de un solo turno.
      const ordenes=extraerOrdenes(respuesta)
      const orden=ordenes.length?ordenes[0]:null
      const pendientes=ordenes.slice(1)
      if(!orden&&/EJECUTAR/i.test(String(respuesta||''))){
        // Escribio la linea pero sin comando de verdad (copio el hueco del
        // formato): se le pide la orden real en vez de darlo por perdido.
        log('[puente] la orden venía sin comando real; pido que la escriba')
        respuesta=await runHiddenPromptWithRotation(
          'Esa línea no sirve: o le falta el comando real, o llevaba un signo de dólar y este chat lo '+
          'convirtió en fórmula. Escribe la línea EJECUTAR con el comando real, SIN ningún dólar '+
          "(usa 'Where-Object Propiedad -ne \'\'' en vez de la forma con llaves), para: "+userText,progress)
        continue
      }
      // El modelo repite la MISMA orden una y otra vez aunque ya le hayamos dado
      // el resultado (se vieron 5 vueltas con "cmd /c start chrome"). Repetirla
      // no aporta: se corta y se le exige la respuesta con lo que ya tiene.
      if(orden){
        // Huella por comando COMPLETO: agrupar por accion ("start chrome") cortaba
        // secuencias legitimas (buscar en YouTube y luego abrir el video). Solo
        // se corta la orden identica repetida, que es el bucle de verdad.
        const huella=orden.tool+' '+JSON.stringify(orden.args)
        if(ordenesVistas.has(huella)){
          log('[puente] orden repetida ('+orden.tool+'); cierro con lo que ya hay')
          // Con el resultado ya en la mano, pedirle que lo redacte gasta OTRA
          // respuesta del cupo para no aportar nada nuevo.
          if(!loadState().redactarConIA){
            progress('complete','Hecho',{tool:'Terminal',action:'Completado'})
            const listo=String(ultimoResultado||'').trim()||'Hecho.'
            appendTranscript('IA [cli]',listo)
            return listo
          }
          respuesta=await runHiddenPromptWithRotation(
            'Ya se ejecuto eso. Resultado:'+String.fromCharCode(10)+String(ultimoResultado||'(sin salida)').slice(0,4000)+
            String.fromCharCode(10,10)+'Responde AHORA al usuario, sin EJECUTAR. Peticion: '+userText,progress)
          break
        }
        ordenesVistas.add(huella)
      }
      if(!orden){
        // Pidio una orden pero con el JSON mal formado: se le devuelve lo que ya
        // se obtuvo y se le exige contestar, en vez de soltarle al usuario la
        // linea cruda "EJECUTAR {...}".
        if(/EJECUTAR/i.test(String(respuesta||''))&&ultimoResultado!==null&&!loadState().redactarConIA){
          progress('complete','Hecho',{tool:'Terminal',action:'Completado'})
          const listo=String(ultimoResultado||'').trim()||'Hecho.'
          appendTranscript('IA [cli]',listo)
          return listo
        }
        if(/EJECUTAR/i.test(String(respuesta||''))&&ultimoResultado!==null){
          respuesta=await runHiddenPromptWithRotation(
            'Ya tienes este resultado del PC:'+String.fromCharCode(10)+ultimoResultado.slice(0,6000)+
            String.fromCharCode(10,10)+'Responde AHORA al usuario con eso. NO escribas EJECUTAR. Su peticion era: '+userText,progress)
        }
        break
      }
      progress('working','Ejecutando '+orden.tool+' en tu PC',{tool:orden.tool==='run_command'?'PowerShell':'Terminal',action:orden.tool,detail:JSON.stringify(orden.args).slice(0,100)})
      log('[puente] '+orden.tool+' '+JSON.stringify(orden.args).slice(0,120))
      // El modelo escribe a veces con caracteres matematicos unicode
      // ("𝑝 = 𝐽 𝑜 𝑖 𝑛 − 𝑃 𝑎 𝑡 ℎ"): NFKC los devuelve a ASCII y el comando vuelve
      // a ser ejecutable.
      const limpios={}
      for(const [k,v] of Object.entries(orden.args||{})) limpios[k]=typeof v==='string'?v.normalize('NFKC'):v
      orden.args=limpios
      let salida
      try{ salida=await ejecutarOrden(orden.tool,orden.args) }
      catch(error){ salida={ok:false,texto:'fallo al ejecutar: '+error.message} }
      let recorte=String(salida.texto||'').slice(0,6000)
      // Contar lo hace el CLI: el modelo se equivocaba al contar sobre el
      // listado (dijo 48 carpetas donde habia 75).
      try{
        const filas=JSON.parse(salida.texto)
        if(Array.isArray(filas)&&filas.length&&filas[0]&&filas[0].type){
          const dirs=filas.filter(x=>x.type==='directory').length
          recorte='RECUENTO EXACTO (ya contado, usalo tal cual): '+filas.length+' entradas = '+
            dirs+' carpetas + '+(filas.length-dirs)+' archivos.'+String.fromCharCode(10)+recorte
        }
      }catch{}
      ultimoResultado=recorte
      // UN turno por peticion: la IA traduce y el CLI ejecuta y presenta. Pedirle
      // ademas que redactara costaba OTRA respuesta del cupo, que en el plan Free
      // es el recurso escaso. Con redactarConIA:true en cli-state vuelve a redactar.
      if(!loadState().redactarConIA){
        const restantes=(pendientes||[]).slice()
        for(const extra of restantes){
          const huella=extra.tool+' '+JSON.stringify(extra.args)
          if(ordenesVistas.has(huella)) continue
          ordenesVistas.add(huella)
          log('[puente] encadeno '+extra.tool+' '+JSON.stringify(extra.args).slice(0,90))
          const limpiosExtra={}
          for(const [k,v] of Object.entries(extra.args||{})) limpiosExtra[k]=typeof v==='string'?v.normalize('NFKC'):v
          let otra
          try{ otra=await ejecutarOrden(extra.tool,limpiosExtra) }
          catch(error){ otra={ok:false,texto:'fallo al ejecutar: '+error.message} }
          recorte+=String.fromCharCode(10)+String(otra.texto||'').slice(0,2000)
        }
        progress('complete','Hecho',{tool:'Terminal',action:'Completado'})
        const salidaFinal=String(recorte||'').trim()||'La orden se ejecutó, pero no devolvió salida.'
        appendTranscript('IA [cli]',salidaFinal)
        return salidaFinal
      }
      try{
        respuesta=await runHiddenPromptWithRotation(
        'RESULTADO de '+orden.tool+' ('+(salida.ok?'ok':'error')+'):'+String.fromCharCode(10)+recorte+
        String.fromCharCode(10,10)+'Responde ya al usuario con esto. Su peticion era: '+userText,progress)
      }catch(e){
        log('[puente] sin poder redactar ('+String(e&&e.message||e).slice(0,80)+'); entrego el resultado tal cual')
        progress('complete','Hecho',{tool:'Terminal',action:'Completado'})
        const crudo=String(recorte||'').trim()
        appendTranscript('IA [cli]',crudo)
        return crudo||'La orden se ejecutó, pero no devolvió salida.'
      }
    }
    // Si se niega ("no tengo acceso a tu PC"), casi siempre es que el hilo
    // arrastra una negativa suya anterior: se estrena chat y se repite una vez.
    if(/no (tengo|puedo) (acceso|ejecutar)|no tengo acceso directo|sin acceso a tu (PC|equipo)/i.test(String(respuesta||''))&&ultimoResultado===null){
      log('[puente] se negó a usar el PC; estreno chat y repito')
      progress('retrying','Estreno un chat limpio y repito',{tool:'Task',action:'Chat nuevo'})
      const st=loadState()
      delete st.selectedChatUrl; delete st.selectedChatOwnerKey; st.threadManuallySelected=false; st.version=VERSION
      fs.writeFileSync(STATE_FILE,JSON.stringify(st,null,2))
      // No basta con estrenar chat: hay peticiones (leer un archivo) que le
      // disparan el rechazo. Se le repite la orden ya escrita, para que solo
      // tenga que copiarla.
      respuesta=await runHiddenPromptWithRotation(
        userText+String.fromCharCode(10,10)+
        'RECUERDA: el CLI ejecuta por ti. Responde SOLO con UNA linea EJECUTAR, la que resuelva lo que te pidieron. Nada mas.',progress)
      for(let paso=1;paso<=3;paso++){
        const orden=extraerOrden(respuesta)
        if(!orden) break
        progress('working','Ejecutando '+orden.tool+' en tu PC',{tool:'Terminal',action:orden.tool,detail:JSON.stringify(orden.args).slice(0,100)})
        log('[puente] '+orden.tool+' '+JSON.stringify(orden.args).slice(0,120))
        ejecutoAlgo=true
        const limpios={}
        for(const [k,v] of Object.entries(orden.args||{})) limpios[k]=typeof v==='string'?v.normalize('NFKC'):v
        let salida
        try{ salida=await ejecutarOrden(orden.tool,limpios) }
        catch(error){ salida={ok:false,texto:'fallo al ejecutar: '+error.message} }
        let recorte=String(salida.texto||'').slice(0,6000)
        try{
          const filas=JSON.parse(salida.texto)
          if(Array.isArray(filas)&&filas.length&&filas[0]&&filas[0].type){
            const dirs=filas.filter(x=>x.type==='directory').length
            recorte='RECUENTO EXACTO (ya contado, usalo tal cual): '+filas.length+' entradas = '+dirs+' carpetas + '+(filas.length-dirs)+' archivos.'+String.fromCharCode(10)+recorte
          }
        }catch{}
        ultimoResultado=recorte
        respuesta=await runHiddenPromptWithRotation('RESULTADO de '+orden.tool+':'+String.fromCharCode(10)+recorte+String.fromCharCode(10,10)+'Responde ya al usuario. Peticion: '+userText,progress)
      }
    }
    // RED DE SEGURIDAD: la IA tuvo su oportunidad. Si pediste algo del PC y no
    // llego a ejecutar nada (se nego, dio instrucciones o no acerto con la
    // orden), lo resuelve el CLI y se responde con eso.
    if(pidePc(userText)&&!ejecutoAlgo){
      const seNiega=/no (tengo|puedo)|no dispongo|sin acceso|pega (aqui|el)|no es posible/i.test(String(respuesta||''))
      const sinAccion=!/HECHO|abierto|cerrado|listo|hecho/i.test(String(respuesta||''))
      if(seNiega||sinAccion){
        const salvado=await redDeSeguridad()
        if(salvado){
          log('[pc] la IA no ejecutó nada; lo resuelve el CLI')
          progress('complete','Hecho',{tool:'Terminal',action:'Completado'})
          const limpio=String(salvado).replace(/^HECHO por el CLI:\s*/,'').replace(/^NO se pudo/,'No se pudo').trim()
          appendTranscript('IA [cli]',limpio)
          return limpio
        }
      }
    }
    // Si agoto los pasos y sigue pidiendo herramientas, se le exige la respuesta
    // final con lo ya obtenido: al usuario nunca le llega un "EJECUTAR {...}".
    if(/EJECUTAR/i.test(String(respuesta||''))&&ultimoResultado!==null&&!loadState().redactarConIA){
      // Ultima fuga del bucle: el dato ya esta, redactarlo cuesta otra respuesta.
      progress('complete','Hecho',{tool:'Terminal',action:'Completado'})
      const listo=String(ultimoResultado||'').trim()||'Hecho.'
      appendTranscript('IA [cli]',listo)
      return listo
    }
    if(/EJECUTAR/i.test(String(respuesta||''))&&ultimoResultado!==null){
      respuesta=await runHiddenPromptWithRotation(
        'Este es el resultado del PC:'+String.fromCharCode(10)+ultimoResultado.slice(0,6000)+
        String.fromCharCode(10,10)+'Responde AHORA con eso, sin escribir EJECUTAR. Peticion: '+userText,progress)
    }
    return respuesta
  }
  if (runMode === 'auto') {
    let hc; try { progress('connecting','Probando el worker real oculto',{tool:'WebFetch',action:'Modo hidden'});hc=await getCdpForHidden(); const scopedPrompt=buildScopedPrompt(userText,Math.random().toString(36).slice(2,10)); const a=await runThreadPrompt(hc,scopedPrompt,progress,'Prompt oculto'); saveState({lastSuccessAt:new Date().toISOString(),version:VERSION,lastMode:'hidden'}); appendTranscript('IA [auto->hidden-worker]',a); try{appendWorkspaceTurnMemory(userText,a)}catch{}; return a }
    catch(e){log('[auto] hidden fallo: '+e.message);progress('retrying','El worker oculto falló; cambiando al chat visible',{tool:'Task',action:'Fallback visible',detail:e.message})} finally{try{hc?.close()}catch{}}
    const vc=await connectSelectedChat()
    try{
      progress('waiting','Esperando que el thread quede libre',{tool:'Task',action:'Thread libre'})
      const before=await waitUntil(async()=>{const s=await chatState(vc);return!s.busy?s:false},10*60_000,700,'thread libre')
      progress('sending','Escribiendo la solicitud en el thread',{tool:'Write',action:'Prompt visible'})
      await insertPrompt(vc,buildVisiblePrompt(userText))
      await waitUntil(async()=>{const s=await chatState(vc);return s.userCount>before.userCount||s.busy||s.copyCount>before.copyCount},30_000,300,'solicitud registrada')
      progress('working','Notion AI está trabajando en el thread',{tool:'Task',action:'Inferencia visible'})
      const a=sanitizeForTerminal(await waitForCompletedResponse(vc,before,progress))
      saveState({lastSuccessAt:new Date().toISOString(),version:VERSION,lastMode:'visible'}); appendTranscript('IA [auto->visible]',a); try{appendWorkspaceTurnMemory(userText,a)}catch{}; return a
    }finally{try{vc.close()}catch{}}
  }
  if (runMode === 'visible') {
    progress('connecting','Conectando con el thread visible',{tool:'WebFetch',action:'Chat visible'})
    const client=await connectSelectedChat()
    try{
      progress('waiting','Esperando que el thread quede libre',{tool:'Task',action:'Thread libre'})
      const before=await waitUntil(async()=>{const s=await chatState(client);return!s.busy?s:false},10*60_000,700,'thread libre')
      progress('sending','Escribiendo la solicitud en el thread',{tool:'Write',action:'Prompt visible'})
      await insertPrompt(client,buildVisiblePrompt(userText))
      await waitUntil(async()=>{const s=await chatState(client);return s.userCount>before.userCount||s.busy||s.copyCount>before.copyCount},30_000,300,'solicitud')
      progress('working','Notion AI está trabajando en el thread',{tool:'Task',action:'Inferencia visible'})
      const a=sanitizeForTerminal(await waitForCompletedResponse(client,before,progress))
      saveState({lastSuccessAt:new Date().toISOString(),version:VERSION,lastMode:'visible'}); appendTranscript('IA [visible]',a); try{appendWorkspaceTurnMemory(userText,a)}catch{}; return a
    }finally{try{client.close()}catch{}}
  }
  throw new Error('Modo desconocido: '+runMode)
}
async function getActiveAccountFromClient(client) {
  const state=loadState()
  const fallback={
    userId: state?.lastSelectedAccount?.userId||state?.lastSelectedAccount?.uid||state?.lastConnectedAccount?.userId||state?.lastConnectedAccount?.uid||state?.lastActiveAccount?.userId||null,
    spaceId: state?.lastSelectedAccount?.spaceId||state?.lastConnectedAccount?.spaceId||state?.lastActiveAccount?.spaceId||null,
    workspace: state?.lastSelectedAccount?.workspace||state?.lastConnectedAccount?.workspace||state?.lastActiveAccount?.workspace||null,
    email: state?.lastSelectedAccount?.email||state?.lastConnectedAccount?.email||state?.lastActiveAccount?.email||null,
    name: state?.lastSelectedAccount?.name||state?.lastConnectedAccount?.name||state?.lastActiveAccount?.name||null,
    chatUrl: state?.selectedChatUrl||state?.lastSelectedAccount?.chatUrl||state?.lastConnectedAccount?.chatUrl||state?.lastActiveAccount?.url||null,
    title: state?.selectedChatTitle||state?.lastActiveAccount?.title||null
  }
  const expr = String.raw`(async()=>{try{
    const fallback = ${JSON.stringify(fallback)};
    const read = k => { try { return JSON.parse(localStorage.getItem(k)||'null')?.value || null } catch { return null } };
    const userId = read('LRU:KeyValueStore2:current-user-id') || fallback.userId || null;
    const spaceId = read('LRU:KeyValueStore2:current-space-id') || fallback.spaceId || null;
    const out = {
      userId,
      uid: userId,
      spaceId,
      url: location.href || fallback.chatUrl || null,
      title: document.title || fallback.title || null,
      name: fallback.name || null,
      email: fallback.email || null,
      workspace: fallback.workspace || null
    };
    try {
      if (userId && spaceId) {
        const res = await fetch('/api/v3/getSpaces', {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ spaceIds: [spaceId] })
        });
        const txt = await res.text();
        const payload = txt ? JSON.parse(txt) : null;
        const root = (payload && payload[userId]) || null;
        const userRec = root?.notion_user?.[userId]?.value?.value?.value || root?.notion_user?.[userId]?.value?.value || {};
        const spaceRec = root?.space?.[spaceId]?.value?.value?.value || root?.space?.[spaceId]?.value?.value || {};
        out.name = userRec?.name || out.name || null;
        out.email = userRec?.email || out.email || null;
        out.workspace = spaceRec?.name || spaceRec?.display_name || out.workspace || null;
      }
    } catch (e) {
      out.getSpacesError = String(e.message || e);
    }
    if (!out.email && userId && spaceId) {
      try {
        const billingKey = 'LRU:LocalPreferenceStore3:' + userId + ':{BillingDataStore4}:' + spaceId;
        const billingRaw = localStorage.getItem(billingKey);
        const parsed = billingRaw ? JSON.parse(billingRaw) : null;
        const billing = parsed?.value?.data?.value || parsed?.value?.value || null;
        if (billing?.email) out.email = billing.email;
        if (billing?.name && !out.name) out.name = billing.name;
      } catch {}
    }
    if (!out.workspace) {
      const navText = [...document.querySelectorAll('nav,aside,[role="navigation"]')].map(el => el.innerText || '').join('\n').split(/\n+/).map(x => x.trim()).filter(Boolean);
      out.workspace = navText.find(x => x.length > 2 && x.length < 80 && !/^(chat|buscar|ia de notion|nuevo agente|new chat|home|today|hoy|ayer|historial)$/i.test(x)) || null;
    }
    return JSON.stringify(out)
  } catch (e) {
    return JSON.stringify({ error: String(e.message || e), url: location.href, title: document.title })
  }})()`
  const raw=await client.evaluate(expr,30000)
  return JSON.parse(raw||'{}')
}
async function snapshotSelectionState(){
  const s=loadState()
  return {selectedAccountKey:s.selectedAccountKey||null,selectedChatUrl:s.selectedChatUrl||null,selectedChatTitle:s.selectedChatTitle||null,lastSelectedAccount:s.lastSelectedAccount||null}
}
function restoreSelectionState(snapshot={}){
  saveState({selectedAccountKey:snapshot.selectedAccountKey||null,selectedChatUrl:snapshot.selectedChatUrl||null,selectedChatTitle:snapshot.selectedChatTitle||null,lastSelectedAccount:snapshot.lastSelectedAccount||null,version:VERSION})
}
async function withTemporaryAccountSelection(account, task){
  const snap=await snapshotSelectionState()
  selectConnectedAccount(account)
  try{return await task()}
  finally{restoreSelectionState(snap)}
}
async function getActiveAccount() {
  let client
  try {
    client=await getCdpForHidden()
    const account=mergeKnownAccountDetails(await getActiveAccountFromClient(client))
    if(account.userId){
      saveState({lastActiveAccount:account,version:VERSION})
      upsertConnectedAccount(account)
    }
    return account
  } catch(error) {
    return mergeKnownAccountDetails(loadState().lastActiveAccount||{error:error.message})
  } finally { try{client?.close()}catch{} }
}
async function connectCurrentAccount(){
  let popupAccount=await capturePopupAccountSession()
  if(popupAccount) return popupAccount
  if(fs.existsSync(POPUP_STATE_FILE)){
    openNotionAccountPopup()
    for(let attempt=0;attempt<12&&!popupAccount;attempt++){
      await sleep(500)
      popupAccount=await capturePopupAccountSession()
    }
    if(popupAccount) return popupAccount
    throw new Error('No pude leer el perfil persistente de Notion. Déjalo abierto unos segundos y vuelve a usar /conectar; no se guardó la cuenta anterior por error.')
  }
  const account=mergeKnownAccountDetails(await getActiveAccount())
  if(account.error) throw new Error(account.error)
  const stored=upsertConnectedAccount(account)
  if(stored){saveSessionSnapshotForAccount(stored);selectConnectedAccount(stored)}
  return stored||account
}
async function getAiStatus(){
  let client
  try{
    client=await getCdpForHidden()
    const account=await getActiveAccountFromClient(client)
    const uiRaw=await client.evaluate(`JSON.stringify((()=>{const text=(document.body?.innerText||'').replace(/\s+/g,' ').trim();const excerpt=text.slice(-5000);const m=excerpt.match(new RegExp(${JSON.stringify(QUOTA_TEXT_PATTERN)},'i'));const wait=excerpt.match(/use AI again in\s+([^\.,]+)|wait until\s+([^\.,]+?)\s+for it to reset/i);return {title:document.title,url:location.href,message:m?m[0]:'',waitText:wait?String(wait[1]||wait[2]||'').trim()||null:null,blocked:!!m,hasInput:!!document.querySelector('[contenteditable=\"true\"][role=\"textbox\"], textarea'),hasStartNewChat:!!document.querySelector('[aria-label=\"Start new chat\"]')}})())`,30000).catch(()=>'{"blocked":null}')
    const ui=JSON.parse(uiRaw||'{}')
    ui.plan=clasificarAviso(ui.message||'').plan          // trial de Business vs plan Free
    let quota=null
    if(ui.blocked&&fs.existsSync(DEBUG_RAW_FILE)){quota=extractQuotaInfoFromRaw(fs.readFileSync(DEBUG_RAW_FILE,'utf8'))}
    const enriched=upsertConnectedAccount(account)||normalizeAccountRow({uid:account.userId,...account,chatUrl:account.url})
    const status={account:enriched,workspace:enriched.workspace||null,blocked:typeof ui.blocked==='boolean'?ui.blocked:null,message:ui.message||'',waitText:ui.waitText||null,title:ui.title||account.title||null,url:ui.url||account.url||null,quota,hasInput:ui.hasInput,hasStartNewChat:ui.hasStartNewChat,note:quota ? 'El valor exacto sale del bloqueo premium-feature-unavailable más reciente.' : 'Si Notion no expone el límite exacto, el CLI muestra disponibilidad, mensaje visible y tiempo estimado de reintento.'}
    if(account.userId) saveState({lastAiStatus:status,lastActiveAccount:account,version:VERSION})
    return status
  }catch(error){
    return {error:error.message,blocked:null,note:'No pude inspeccionar el estado de AI en la sesión de Notion.'}
  }finally{try{client?.close()}catch{}}
}
async function getAiStatusAll(){
  const accounts=listConnectedAccounts()
  const rows=[]
  for(const account of accounts){
    if(!hasSavedSessionForAccount(account)){
      rows.push({account,blocked:null,error:'sesión no guardada; abre ese workspace y usa /conectar'})
      continue
    }
    if(!isSessionReadyAccount(account)){
      rows.push({account,blocked:null,error:'workspace no listo para prueba automática; ábrelo en Notion y usa /conectar en ese workspace'})
      continue
    }
    try{
      const status=await Promise.race([
        withTemporaryAccountSelection(account,()=>getAiStatus()),
        new Promise((_,reject)=>setTimeout(()=>reject(new Error('tiempo agotado al revisar este workspace')),20000))
      ])
      rows.push(status)
    }catch(error){
      rows.push({account,blocked:null,error:error.message})
    }
  }
  return rows
}
function getRotationPlan(){
  return listRotatableAccounts([])
}
// fast=true responde con lo ultimo conocido en disco y NO toca el navegador:
// el arranque del terminal solo necesita el encabezado (cuenta/workspace/modelo)
// y consultar el CDP ahi costaba decenas de segundos.
async function getStatus(fast=false) {
  const s=loadState(); const m=readMemory()
  const activeAccount=fast
    ? mergeKnownAccountDetails(s.lastActiveAccount||s.lastSelectedAccount||s.lastConnectedAccount||{})
    : await getActiveAccount()
  return{version:VERSION,runMode:s.runMode||DEFAULT_MODE,lastMode:s.lastMode||null,activeAccount,selectedChatUrl:s.selectedChatUrl||null,selectedChatTitle:s.selectedChatTitle||null,selectedAccountKey:s.selectedAccountKey||null,autoRotateAccounts:getAutoRotateAccounts(),connectedAccountsCount:listConnectedAccounts().length,activeProject:s.activeProject||null,activeCwd:s.activeCwd||DIR,activeModel:s.activeModel||'gpt-5.6',memoryChars:m.length,memoryPreview:m.slice(0,500)}
}
let serial=Promise.resolve()
function enqueue(task){const p=serial.then(task,task);serial=p.catch(()=>{});return p}

async function handleBridgeRequest(workingPath,req){
  const responsePath=path.join(RES_DIR,`${req.id}.json`)
  const progressBase=createProgressEmitter(req)
  // Quien pregunta desde Discord sólo veía silencio hasta la respuesta final: el
  // progreso salía al bus con from:'notion-ai', que el puente no reenvía. Aquí
  // se publican hitos con la etiqueta del panel (sí reenviada), espaciados para
  // no inundar el canal.
  let ultimoAviso=0, ultimoTexto=''
  const progress=(state,message,extra={})=>{
    const ev=progressBase(state,message,extra)
    try{
      if(!req.agentLabel) return ev
      const ahora=Date.now()
      // Etiqueta con verbo y herramienta real, en vez del genérico "Worker real
      // activo": se ve qué ejecuta (PowerShell, lectura de archivos, búsqueda…).
      const verbos={PowerShell:'⚙ PowerShell',Terminal:'⚙ Terminal',Bash:'⚙ Bash',Read:'📖 Leyendo',Write:'✍ Escribiendo',
        Glob:'📁 Listando',Grep:'🔎 Buscando',WebFetch:'🌐 Consultando',Thinking:'💭 Pensando',Task:'🧠 Trabajando'}
      const etiqueta=verbos[String(extra.tool||'Task')]||'🧠 Trabajando'
      let detalle=String(extra.action||message||'').replace(/\s+/g,' ').trim().slice(0,120)
      // El escaneo lee el hilo entero e incluye trozos del contexto que envía el
      // propio CLI (memoria, transcripción). Eso no es actividad: se descarta.
      if(/MEMORIA LOCAL|Memoria terminal|TRANSCRIPCI|CONTEXTO|SOLICITUD DEL USUARIO|MODO CLI SHOSSO|\d{4}-\d{2}-\d{2}T/i.test(detalle)) detalle=''
      const texto=`${etiqueta}${detalle&&detalle!=='Worker real activo'?' · '+detalle:'…'}`
      if(state==='queued'){
        // Acuse de recibo: una sola línea, y arranca el contador para que el
        // siguiente aviso no salga pegado a este.
        ultimoAviso=ahora; ultimoTexto=''
        publishBusReply(req.agentLabel,'📩 Recibido · trabajando en tu petición…')
        return ev
      }
      const primeraVez=state==='working'&&!ultimoAviso
      if(state==='retrying'||primeraVez||(state==='working'&&ahora-ultimoAviso>30000&&detalle&&texto!==ultimoTexto)){
        ultimoAviso=ahora; ultimoTexto=texto
        publishBusReply(req.agentLabel,state==='retrying'?'🧠 Trabajando…':texto)
      }
    }catch{}
    return ev
  }
  try{
    let result
    if(req.action==='pin-current'){const p=await pinCurrentChat();result={ok:true,id:req.id,text:`Seleccionado: ${p.title} | ${p.url}`,meta:p};log(`PIN ${req.id}`)}
    else if(req.action==='clear-selection'){clearSelectedChat();result={ok:true,id:req.id,text:'Seleccion borrada.'};log(`CLEAR ${req.id}`)}
    else if(req.action==='status'){const s=await getStatus(req.fast===true);result={ok:true,id:req.id,text:JSON.stringify(s,null,2),meta:s};log(`STATUS ${req.id}${req.fast===true?' (fast)':''}`)}
    else if(req.action==='thread-list'){const t=await listThreads();result={ok:true,id:req.id,text:t.text,meta:t.rows};log(`THREAD_LIST ${req.id}`)}
    else if(req.action==='thread-select'){const p=await selectThread(req.value);result={ok:true,id:req.id,text:`Thread seleccionado: ${p.title} | ${p.threadId||p.url}`,meta:p};log(`THREAD_SELECT ${req.id}`)}
    else if(req.action==='account'){const a=await getActiveAccount();result={ok:!a.error,id:req.id,text:'Cuenta: '+(a.email||a.userId||'sin detectar')+'\nNombre: '+(a.name||'Sin nombre visible')+'\nWorkspace: '+(a.workspace||'Workspace actual')+'\nChat: '+simplifyChatTitle(a.title||''),meta:a};log(`ACCOUNT ${req.id}`)}
    else if(req.action==='connect-account'){const a=await connectCurrentAccount();result={ok:true,id:req.id,text:'Conectado: '+formatAccountLabel(a)+'\nCorreo: '+(a.email||'No detectado todavía')+'\nWorkspace: '+(a.workspace||'Workspace actual')+'\nSesión guardada: '+(fs.existsSync(getAccountSessionFile(a))?'sí':'no'),meta:a};log(`CONNECT_ACCOUNT ${req.id}`)}
    else if(req.action==='accounts'){const rows=listConnectedAccounts();result={ok:true,id:req.id,text:formatAccountsByOwner(rows),meta:rows};log(`ACCOUNTS ${req.id}`)}
    else if(req.action==='select-account'){const a=selectConnectedAccount(req.value);result={ok:true,id:req.id,text:'Cuenta activa: '+formatAccountLabel(a)+'\nSesión guardada: '+(a.hasSavedSession?'sí':'no')+(a.restoreQueued?'\nRestaurando sesión en segundo plano...':'')+(a.hasSavedSession&&!a.restoreQueued?'\nNo pude iniciar la restauración automática.':''),meta:a};log(`SELECT_ACCOUNT ${req.id}`)}
    else if(req.action==='next-account'){const a=selectNextConnectedAccount();result={ok:true,id:req.id,text:'Cuenta activa: '+formatAccountLabel(a)+'\nSesión guardada: '+(a.hasSavedSession?'sí':'no')+(a.restoreQueued?'\nRestaurando sesión en segundo plano...':'')+(a.hasSavedSession&&!a.restoreQueued?'\nNo pude iniciar la restauración automática.':''),meta:a};log(`NEXT_ACCOUNT ${req.id}`)}
    else if(req.action==='new-account'){
      // Abre la ventana de login y espera a que la sesión esté lista; después
      // provisiona la cuenta entera (workspaces + MCP + registro).
      const conocidas=new Set(listConnectedAccounts().map(a=>a.uid).filter(Boolean))
      const popup=openNotionAccountPopup(req.value,{fresh:true})   // perfil limpio: si no, reabre la sesión anterior
      log('[nueva-cuenta] ventana abierta con perfil limpio: '+popup.slot)
      let capturada=null
      for(let i=0;i<120&&!capturada;i++){ await sleep(5000); const c=await capturePopupAccountSession().catch(()=>null); if(c&&!conocidas.has(c.uid)) capturada=c }   // ignora la cuenta ya conocida
      if(!capturada){ result={ok:false,id:req.id,error:'No detecté la sesión. Inicia sesión en la ventana que se abrió y vuelve a intentarlo.'} }
      else{
        // Una cuenta recien conectada solo aporta cupo si tiene workspaces: el
        // cupo de Notion AI va por espacio y cada uno del plan Free trae el
        // suyo. Se crean de entrada hasta que Notion corta por ritmo (429),
        // que es el limite real; asi el alta deja la cuenta ya rentable.
        const bulk=spawnSync(process.execPath,[path.join(DIR,'space-bulk.mjs'),String(capturada.email||''),String(FREE_WORKSPACE_TARGET)],{cwd:DIR,encoding:'utf8',windowsHide:true,timeout:1800000})
        const creados=(String(bulk.stdout||'').match(/^total nuevos: .*/m)||[''])[0]||'sin creacion automatica'
        log('[nueva-cuenta] '+creados)
        const prov=spawnSync(process.execPath,[path.join(DIR,'mcp-provision-all.mjs'),String(capturada.email||'')],{cwd:DIR,encoding:'utf8',windowsHide:true,timeout:900000})
        const resumen=String(prov.stdout||'').trim().split('\n').slice(-3).join(' · ')
        result={ok:true,id:req.id,text:'Cuenta conectada: '+formatAccountLabel(capturada)+'\nWorkspaces del plan Free creados: '+creados+'\n'+resumen,meta:capturada}
      }
      log(`NEW_ACCOUNT ${req.id} ${capturada?'ok':'fallo'}`)
    }
    else if(req.action==='pool'){
      // Estado del colchon; si no hay mantenimiento en curso, se lanza uno.
      const st=loadState(), ps=st.poolStatus||null
      const lanzado=lanzarPoolMaintain('a mano')
      const bloq=Object.entries(st.spaceCreateBlockedBy||{}).filter(([,t])=>t>Date.now()).map(([e])=>e)
      const lineas=[ps?('Ultima medicion: '+ps.conCupo+'/'+ps.minimo+' workspaces con cupo · '+ps.creados+' creado(s) · '+new Date(ps.at).toLocaleString()):'Sin mediciones todavia']
      if(bloq.length) lineas.push('Cuentas cortadas por ritmo de Notion: '+bloq.join(', '))
      lineas.push(lanzado?'Mantenimiento en marcha (mide, crea lo que falte, conecta MCP y sincroniza).':'Ya habia un mantenimiento en marcha.')
      result={ok:true,id:req.id,text:lineas.join('\n'),meta:ps}
      log(`POOL ${req.id}`)
    }
    else if(req.action==='new-workspace'){
      const r=spawnSync(process.execPath,[path.join(DIR,'space-ensure.mjs'),'--force'],{cwd:DIR,encoding:'utf8',windowsHide:true,timeout:900000})
      const salida=String(r.stdout||'').trim().split('\n')

      const nuevo=salida.find(l=>/workspace nuevo:/i.test(l))
      result=r.status===0&&nuevo
        ? {ok:true,id:req.id,text:salida.slice(-4).join('\n')}

        : {ok:false,id:req.id,error:(salida.slice(-2).join(' ')||String(r.stderr||'').slice(0,200)||'no se pudo crear el workspace')}
      log(`NEW_WORKSPACE ${req.id} ${r.status}`)
    }
    else if(req.action==='popup-account'){const popup=openNotionAccountPopup(req.value);result={ok:true,id:req.id,text:'Popup abierto para conectar otra cuenta de Notion.\nPerfil: '+popup.slot+'\nCuando termines de iniciar sesión, usa /conectar desde esa cuenta para guardarla.',meta:popup};log(`POPUP_ACCOUNT ${req.id}`)}
    else if(req.action==='open-proxy-panel'){const proxy=openProxyPanel();result={ok:true,id:req.id,text:'Panel local de CLI Proxy API abierto.\nURL: '+proxy.url,meta:proxy};log(`OPEN_PROXY_PANEL ${req.id}`)}
    else if(req.action==='ai-status'){const s=await getAiStatus();result={ok:!s.error,id:req.id,text:formatAiStatusText(s),meta:s};log(`AI_STATUS ${req.id}`)}
    else if(req.action==='ai-status-all'){const rows=await getAiStatusAll();result={ok:true,id:req.id,text:formatAiStatusAllText(rows),meta:rows};log(`AI_STATUS_ALL ${req.id}`)}
    else if(req.action==='rotation-plan'){const rows=getRotationPlan();result={ok:true,id:req.id,text:formatRotationPlanText(rows),meta:rows};log(`ROTATION_PLAN ${req.id}`)}
    else if(req.action==='discover-workspaces'){
      try{
        const d=await discoverZenWorkspaces()
        const text='Workspaces detectados: '+d.total+(d.added.length?'\nNuevos:\n'+d.added.map(a=>'- '+formatAccountLabel(a)).join('\n'):'\n(sin workspaces nuevos)')
        result={ok:true,id:req.id,text,meta:d.accounts};log(`DISCOVER_WORKSPACES ${req.id} total=${d.total} nuevos=${d.added.length}`)
      }catch(error){result={ok:false,id:req.id,error:error.message};log(`DISCOVER_WORKSPACES_ERR ${req.id} ${error.message}`)}
    }
    else if(req.action==='set-auto-rotate'){const on=!/^(off|0|false|no)$/i.test(String(req.value||'on'));saveState({autoRotateAccounts:on,version:VERSION});result={ok:true,id:req.id,text:'Rotación automática: '+(on?'on':'off'),meta:{autoRotateAccounts:on}};log(`SET_AUTO_ROTATE ${req.id} ${on}`)}
    else if(req.action==='get-auto-rotate'){const on=getAutoRotateAccounts();result={ok:true,id:req.id,text:'Rotación automática: '+(on?'on':'off'),meta:{autoRotateAccounts:on}};log(`GET_AUTO_ROTATE ${req.id}`)}
    else if(req.action==='memory-show'){result={ok:true,id:req.id,text:readMemory()};log(`MEM_SHOW ${req.id}`)}
    else if(req.action==='memory-reset'){clearMemory();result={ok:true,id:req.id,text:'Memoria reiniciada.'};log(`MEM_RESET ${req.id}`)}
    else if(req.action==='memory-save'){appendMemory(String(req.value||'').trim());result={ok:true,id:req.id,text:'Memoria actualizada.'};log(`MEM_SAVE ${req.id}`)}
    else if(req.action==='set-project'){saveState({activeProject:String(req.value||'').trim(),version:VERSION});result={ok:true,id:req.id,text:`Proyecto: ${String(req.value||'').trim()}`};log(`SET_PROJECT ${req.id}`)}
    else if(req.action==='clear-project'){const s=loadState();delete s.activeProject;s.version=VERSION;fs.writeFileSync(STATE_FILE,JSON.stringify(s,null,2));result={ok:true,id:req.id,text:'Proyecto borrado.'};log(`CLEAR_PROJECT ${req.id}`)}
    else if(req.action==='set-workspace'){const value=path.resolve(String(req.value||'').trim());if(!fs.existsSync(value)||!fs.statSync(value).isDirectory())result={ok:false,id:req.id,error:`Carpeta no encontrada: ${value}`};else{saveState({activeCwd:value,activeProject:path.basename(value),version:VERSION});result={ok:true,id:req.id,text:`Workspace: ${value}`,meta:{activeCwd:value,activeProject:path.basename(value)}};log(`SET_WORKSPACE ${req.id} ${value}`)}}
    else if(req.action==='get-workspace'){const s=loadState();const value=s.activeCwd||DIR;result={ok:true,id:req.id,text:`Workspace: ${value}`,meta:{activeCwd:value,activeProject:s.activeProject||path.basename(value)}};log(`GET_WORKSPACE ${req.id}`)}
    else if(req.action==='model-list'){result={ok:true,id:req.id,text:modelListText(),meta:MODEL_DEFINITIONS};log(`MODEL_LIST ${req.id}`)}
    else if(req.action==='model-current'){const st=loadState();const active=resolveModel(st.activeModel||'gpt-5.6')||MODEL_DEFINITIONS[0];result={ok:true,id:req.id,text:`Modelo activo: ${active.label}\nID: ${active.id}`,meta:active};log(`MODEL_CURRENT ${req.id}`)}
    else if(req.action==='set-model'){const requested=String(req.value||'').trim();const model=resolveModel(requested);if(!model){result={ok:false,id:req.id,error:`Modelo no valido: ${requested||'(vacio)'}\nUsa /modelos para ver los modelos compatibles.`};log(`SET_MODEL_REJECT ${req.id} ${requested}`)}else{saveState({activeModel:model.id,activeModelLabel:model.label,version:VERSION});result={ok:true,id:req.id,text:`Modelo activo: ${model.label}\nID: ${model.id}`,meta:model};log(`SET_MODEL ${req.id} ${requested} -> ${model.id}`)}}
    else if(req.action==='clear-model'){const s=loadState();delete s.activeModel;s.version=VERSION;fs.writeFileSync(STATE_FILE,JSON.stringify(s,null,2));result={ok:true,id:req.id,text:'Modelo restablecido.'};log(`CLEAR_MODEL ${req.id}`)}
    else if(req.action==='set-mode'){const allowed=['hidden','visible','auto'];const raw=String(req.value||'').trim().toLowerCase();const mn=/^(hidden|invisible)$/.test(raw)?'hidden':raw;if(!allowed.includes(mn))result={ok:false,id:req.id,error:`Modo invalido: hidden|invisible|visible|auto`};else{saveState({runMode:mn,version:VERSION});result={ok:true,id:req.id,text:`Modo: ${mn}`};log(`SET_MODE ${req.id} ${raw} -> ${mn}`)}}
    else if(req.action==='get-mode'){const{runMode=DEFAULT_MODE}=loadState();result={ok:true,id:req.id,text:`Modo actual: ${runMode}`};log(`GET_MODE ${req.id}`)}
    else if(req.action==='debug-raw'){try{const r=fs.readFileSync(DEBUG_RAW_FILE,'utf8');const a=fs.existsSync(path.join(DIR,'last-hidden-analysis.json'))?JSON.parse(fs.readFileSync(path.join(DIR,'last-hidden-analysis.json'),'utf8')):null;result={ok:true,id:req.id,text:`=== ANALYSIS ===\n${JSON.stringify(a,null,2)}\n\n=== RAW (primeros 2000 chars) ===\n${r.slice(0,2000)}`}}catch(e){result={ok:false,id:req.id,error:e.message}};log(`DEBUG_RAW ${req.id}`)}
    else{
      // Acuse inmediato: quien pregunta desde Discord veía silencio hasta que
      // hubiera actividad, sin saber siquiera si su mensaje habia llegado.
      progress('queued','Solicitud recibida por el bridge',{tool:'Task',action:'En cola'});log(`REQ ${req.id} -> ${String(req.prompt).slice(0,80)}`);const a=await conLimite(processPrompt(String(req.prompt||''),progress),TOPE_PETICION,
          'La petición se pasó de '+Math.round(TOPE_PETICION/60000)+' minutos y la corté. Vuelve a intentarlo; si se repite, mira el log del bridge.');progress('complete','Respuesta completada',{tool:'Task',action:'Completado',detail:a.length+' caracteres'});result={ok:true,id:req.id,text:a};publishBusReply(req.agentLabel,a);log(`RES ${req.id} ok (${a.length} chars)`)
      // Soltar el hilo usado: reutilizarlo hacía que el SIGUIENTE prompt se
      // escribiera en el composer pero no llegara a publicarse (la primera
      // pregunta siempre iba bien porque abría hilo nuevo, la segunda se colgaba).
      precalentarSiguiente().catch(()=>{})   // deja listo el siguiente workspace
      try{
        const st=loadState()
        const sp=st.lastSelectedAccount?.spaceId||st.lastActiveAccount?.spaceId
        if(sp) saveState({selectedChatUrl:spaceChatUrl(sp),threadManuallySelected:false,version:VERSION})
      }catch{}}
    fs.writeFileSync(responsePath,JSON.stringify(result,null,2))
  }catch(error){
    progress('error','La solicitud terminÃƒÆ’Ã‚Â³ con error',{tool:'Task',action:'Error',detail:error.message});fs.writeFileSync(responsePath,JSON.stringify({ok:false,id:req.id,error:error.message},null,2));publishBusReply(req.agentLabel,'⚠ Notion AI: '+error.message);log(`ERR ${req.id} ${error.message}`)
  }finally{
    try{fs.unlinkSync(workingPath)}catch{}
    // Cada rotacion/precalentado deja una pestaña abierta: sin esto se acumulaban
    // (21 pestañas = 4,4 GB de RAM solo del motor).
    limpiarPestanas()
    if(poolPendiente){ const m=poolPendiente; poolPendiente=null; lanzarPoolMaintain(m) }
  }
}

// Acciones que solo leen/escriben disco: se atienden al instante en vez de
// esperar detras del prompt en curso (la cola serializada es solo para lo que
// usa el navegador). Antes, abrir el terminal mientras Notion respondia dejaba
// el arranque bloqueado minutos.
// Red de seguridad: pase lo que pase (Notion colgado, un proceso que no
// responde, una promesa que nunca resuelve), la peticion TERMINA. Sin esto el
// panel se quedaba en "trabajando" indefinidamente y bloqueaba la cola.
const TOPE_PETICION=6*60*1000
function conLimite(promesa,ms,alternativa){
  let t
  return Promise.race([
    Promise.resolve(promesa).finally(()=>clearTimeout(t)),
    new Promise(r=>{ t=setTimeout(()=>r(alternativa),ms) }),
  ])
}
const LIGHT_ACTIONS=new Set(['pool','accounts','select-account','next-account','rotation-plan','get-auto-rotate','set-auto-rotate','clear-selection','memory-show','memory-reset','memory-save','set-project','clear-project','set-workspace','get-workspace','model-list','model-current','set-model','clear-model','set-mode','get-mode','debug-raw'])
function isLightRequest(req={}){
  const action=String(req.action||'').trim()
  if(action==='status') return req.fast===true
  return LIGHT_ACTIONS.has(action)
}
// Un reinicio del daemon deja .working.json huerfanos: nadie los procesa y el
// cliente que los espera se cuelga hasta su timeout de 8 minutos. Al arrancar,
// se les responde con un error claro y se borran.
function recoverOrphanRequests(){
  try{
    for(const name of fs.readdirSync(REQ_DIR).filter(n=>n.endsWith('.working.json'))){
      const wrk=path.join(REQ_DIR,name)
      let req={};try{req=JSON.parse(fs.readFileSync(wrk,'utf8'))}catch{}
      const id=req.id||path.basename(name,'.working.json')
      const resPath=path.join(RES_DIR,`${id}.json`)
      if(!fs.existsSync(resPath))fs.writeFileSync(resPath,JSON.stringify({ok:false,id,error:'El bridge se reinicio mientras procesaba esta solicitud. Vuelve a enviarla.'},null,2))
      try{fs.unlinkSync(wrk)}catch{}
      log('[recover] solicitud huerfana descartada: '+id)
    }
  }catch(error){log('[recover] '+error.message)}
}

let draining=false
async function drainBridgeQueue(){
  if(draining)return;draining=true
  try{
    const files=fs.readdirSync(REQ_DIR).filter(n=>n.endsWith('.json')&&!n.endsWith('.working.json')).sort()
    for(const name of files){
      const src=path.join(REQ_DIR,name);const wrk=path.join(REQ_DIR,name.replace(/\.json$/i,'.working.json'))
      try{fs.renameSync(src,wrk)}catch{continue}
      let req;try{req=JSON.parse(fs.readFileSync(wrk,'utf8'))}catch(e){try{fs.writeFileSync(path.join(RES_DIR,`${path.basename(name,'.json')}.json`),JSON.stringify({ok:false,error:`JSON invalido: ${e.message}`},null,2))}catch{};try{fs.unlinkSync(wrk)}catch{};continue}
      if(isLightRequest(req)) handleBridgeRequest(wrk,req).catch(e=>log(`light req err: ${e.message}`))
      else enqueue(()=>handleBridgeRequest(wrk,req))
    }
  }finally{draining=false}
}

async function interactiveLoop(){
  const rl=readline.createInterface({input:process.stdin,output:process.stdout})
  const{runMode=DEFAULT_MODE}=loadState()
  console.log(`\x1b[36mNotion AI Bridge v${VERSION}\x1b[0m`)
  console.log(`\x1b[90mThread: Welcome to Notion | Modo: ${runMode} | /mode hidden|visible|auto | /pin | /debug-raw | /exit\x1b[0m`)
  while(true){
    const line=(await rl.question('\n\x1b[37mTu > \x1b[0m')).trim()
    if(!line)continue
    if(line==='/exit')break
    if(line.startsWith('/mode ')||line.startsWith('/set-mode ')){
      const allowed=['hidden','visible','auto'];const rawVal=line.split(' ').slice(1).join(' ').trim().toLowerCase();const val=/^(hidden|invisible)$/.test(rawVal)?'hidden':rawVal
      if(!allowed.includes(val)){console.log('Validos: hidden|invisible|visible|auto');continue}
      saveState({runMode:val,version:VERSION})
      console.log(`Modo: \x1b[36m${val}\x1b[0m`);if(val==='visible')console.log('\x1b[33mAVISO: modo visible escribe en el chat de Notion.\x1b[0m')
      continue
    }
    if(line==='/mode'||line==='/get-mode'){const{runMode:rm=DEFAULT_MODE,lastMode=null}=loadState();console.log(`Modo: \x1b[36m${rm}\x1b[0m | Ultimo: ${lastMode||'(ninguno)'}`);continue}
    if(line==='/pin-current'||line==='/pin'){try{const p=await pinCurrentChat();console.log(`Seleccionado: ${p.title} | ${p.url}`)}catch(e){console.error(e.message)};continue}
    if(line==='/clear-selection'||line==='/cls'){clearSelectedChat();console.log('Seleccion borrada.');continue}
    if(line==='/status'||line==='/st'){try{console.log(JSON.stringify(await getStatus(),null,2))}catch(e){console.error(e.message)};continue}
    if(line==='/account'||line==='/cuenta'||line==='/quien'){try{const a=await getActiveAccount();console.log('Cuenta: '+(a.email||a.userId||'sin detectar')+'\nNombre: '+(a.name||'Sin nombre visible')+'\nWorkspace: '+(a.workspace||'Workspace actual')+'\nChat: '+simplifyChatTitle(a.title||''))}catch(e){console.error(e.message)};continue}
    if(line==='/connect-account'||line==='/conectar-cuenta'||line==='/conectar'){try{const a=await connectCurrentAccount();console.log('Conectado: '+formatAccountLabel(a)+'\nSesión guardada: '+(fs.existsSync(getAccountSessionFile(a))?'sí':'no'))}catch(e){console.error(e.message)};continue}
    if(line==='/accounts'||line==='/cuentas'||line==='/lista'){console.log(formatAccountsText(listConnectedAccounts()));continue}
    if(line==='/discover'||line==='/descubrir'){try{const d=await discoverZenWorkspaces();console.log('Workspaces detectados: '+d.total+(d.added.length?'\nNuevos:\n'+d.added.map(a=>'- '+formatAccountLabel(a)).join('\n'):''))}catch(e){console.error(e.message)};continue}
    if(line==='/popup'){try{const popup=openNotionAccountPopup();console.log('Popup abierto: '+popup.slot)}catch(e){console.error(e.message)};continue}
    if(line==='/proxy'){try{openProxyPanel();console.log('Panel de CLI Proxy API abierto.')}catch(e){console.error(e.message)};continue}
    if(line.startsWith('/use-account ')||line.startsWith('/usar-cuenta ')||line.startsWith('/usar ')){try{const a=selectConnectedAccount(line.replace(/^\/(?:use-account|usar-cuenta|usar) /,'').trim());console.log('Workspace activo: '+formatAccountLabel(a))}catch(e){console.error(e.message)};continue}
    if(line==='/next-account'||line==='/siguiente-cuenta'||line==='/sig'){try{const a=selectNextConnectedAccount();console.log('Workspace activo: '+formatAccountLabel(a))}catch(e){console.error(e.message)};continue}
    if(line==='/ai-status'||line==='/cuota'||line==='/estado'||line==='/uso'){try{console.log(formatAiStatusText(await getAiStatus()))}catch(e){console.error(e.message)};continue}
    if(line==='/ai-status-all'||line==='/cuotas'||line==='/estados'){try{console.log(formatAiStatusAllText(await getAiStatusAll()))}catch(e){console.error(e.message)};continue}
    if(line==='/rotation-plan'||line==='/plan-rotacion'||line==='/plan'){console.log(formatRotationPlanText(getRotationPlan()));continue}
    if(line==='/auto-rotate'||line==='/rotacion-auto'||line==='/rotacion'){console.log('Rotación: '+(getAutoRotateAccounts()?'on':'off'));continue}
    if(line.startsWith('/auto-rotate ')||line.startsWith('/rotacion-auto ')||line.startsWith('/rotacion ')){const raw=line.replace(/^\/(?:auto-rotate|rotacion-auto|rotacion) /,'').trim();const on=!/^(off|0|false|no)$/i.test(raw||'on');saveState({autoRotateAccounts:on,version:VERSION});console.log('Rotación: '+(on?'on':'off'));continue}
    if(line==='/memory-show'||line==='/ms'){console.log(readMemory());continue}
    if(line==='/memory-reset'||line==='/mr'){clearMemory();console.log('Memoria reiniciada.');continue}
    if(line.startsWith('/memory-save ')||line.startsWith('/msave ')){appendMemory(line.replace(/^\/(?:memory-save|msave) /,''));console.log('Memoria actualizada.');continue}
    if(line.startsWith('/set-project ')||line.startsWith('/sp ')){const v=line.replace(/^\/(?:set-project|sp) /,'');saveState({activeProject:v,version:VERSION});console.log('Proyecto guardado.');continue}
    if(line==='/clear-project'||line==='/cp'){const s=loadState();delete s.activeProject;s.version=VERSION;fs.writeFileSync(STATE_FILE,JSON.stringify(s,null,2));console.log('Proyecto borrado.');continue}
    if(line.startsWith('/set-model ')||line.startsWith('/model ')){const mn=line.replace(/^\/(?:set-model|model) /,'').trim();if(!mn){console.log('Uso: /model NOMBRE');continue};saveState({activeModel:mn,version:VERSION});console.log(`Modelo: ${mn}`);continue}
    if(line==='/clear-model'){const s=loadState();delete s.activeModel;s.version=VERSION;fs.writeFileSync(STATE_FILE,JSON.stringify(s,null,2));console.log('Modelo restablecido.');continue}
    if(line==='/debug-raw'||line==='/dr'){
      try{
        const a=fs.existsSync(path.join(DIR,'last-hidden-analysis.json'))?JSON.parse(fs.readFileSync(path.join(DIR,'last-hidden-analysis.json'),'utf8')):null
        const r=fs.existsSync(DEBUG_RAW_FILE)?fs.readFileSync(DEBUG_RAW_FILE,'utf8'):'(no hay raw todavia)'
        console.log(`\n\x1b[33m=== ANALYSIS ===\x1b[0m\n${JSON.stringify(a,null,2)}\n\n\x1b[33m=== RAW (primeros 1500 chars) ===\x1b[0m\n${r.slice(0,1500)}`)
      }catch(e){console.error(e.message)}
      continue
    }
    try{
      const answer=await enqueue(()=>processPrompt(line))
      const{lastMode='?'}=loadState()
      console.log(`\n\x1b[36m--- Notion AI [${lastMode}] ---\x1b[0m\n${answer}\n\x1b[90m------------------------------\x1b[0m`)
    }catch(e){console.error(`\x1b[31m${e.message}\x1b[0m`)}
  }
  rl.close()
}

process.on('uncaughtException',e=>{log(`FATAL: ${e.stack||e.message}`)})
process.on('unhandledRejection',e=>{log(`FATAL: ${e?.stack||e}`)})

// zen-functions.js — patch zen-v1 para notion-ai-cli.mjs
// NO ejecutar directamente. Insertado por patch-bridge-zen.mjs

// === ZEN BROWSER AUTO-DETECT (patch zen-v1) ===
// Cada workspace tiene su propio cupo de Notion AI, pero SOLO se llega al suyo
// con ?spaceId= en la URL: navegar a /chat a secas (o inyectar current-space-id
// en localStorage) devuelve siempre el espacio principal, asi que "rotar" a otro
// workspace acababa escribiendo en el mismo chat sin cupo.
// Notion CAMBIA la ruta del chat entre despliegues: el 2026-08-28 por la manana
// /ai?spaceId= redirigia a /chat, y por la tarde (build 23.13.20260828.1620) es
// /chat?spaceId= la que redirige a /chat PERDIENDO el spaceId y dejando la
// pagina sin composer. Fijar una ruta a mano se rompe con el siguiente
// despliegue, asi que se guarda la que funciono y se prueban ambas.
const RUTAS_CHAT=['/ai','/chat']
function rutaChatActual(){
  const r=loadState().chatRoute
  return RUTAS_CHAT.includes(r)?r:RUTAS_CHAT[0]
}
function spaceChatUrl(spaceId,ruta){
  const base='https://'+'app.notion.com'+(ruta||rutaChatActual())
  return spaceId ? base+'?spaceId='+spaceId : base
}
/** Lee en segundos si el espacio abierto sirve: composer disponible y sin aviso
 *  de cupo agotado ni IA apagada. Sale en cuanto lo sabe. */
async function medirEspacioAbierto(client,intentos=16){
  for(let i=0;i<intentos;i++){
    const raw=await client.evaluate(`JSON.stringify((()=>{const t=(document.body&&document.body.innerText)||'';return {alta:/Who else is on your team|could not create your workspace|Invite your team/i.test(t),composer:!!document.querySelector('[contenteditable=\"true\"][role=\"textbox\"], [contenteditable=\"true\"]'),start:!!document.querySelector('[aria-label=\"Start new chat\"],[aria-label=\"New chat\"]'),login:/\/login/.test(location.href)||/Log in to your Notion account|Inicia sesi[oó]n en tu cuenta/i.test(t),off:/AI is disabled for this workspace|IA (esta|está) deshabilitada/i.test(t),trial:/trial.?s? monthly AI allowance/i.test(t),seco:new RegExp(${JSON.stringify(QUOTA_TEXT_PATTERN)},'i').test(t)}})())`,8000).catch(()=>null)
    let e=null; try{ e=JSON.parse(String(raw||'')) }catch{}
    if(e){
      // Sin sesion la pantalla es el login: eso NO es falta de cupo. Marcarlo
      // como seco iba tachando workspaces buenos uno tras otro.
      if(e.login) return {usable:false,plan:'sesion-caida'}
      // Notion puede secuestrar la pantalla con su asistente de alta ("Who else
      // is on your team?", "We could not create your workspace"): hay composer o
      // no, pero el chat no esta, y la peticion se quedaba esperando en vano.
      if(e.alta) return {usable:false,plan:'onboarding'}
      if(e.off) return {usable:false,plan:'ai-desactivada'}
      if(e.seco&&!e.composer) return {usable:false,plan:e.trial?'business-trial':'free'}
      if(e.composer||e.start) return {usable:true,plan:'free'}
    }
    await sleep(500)
  }
  return {usable:false,plan:'sin-respuesta'}
}
/** Abre el espacio probando las rutas conocidas; recuerda la que sirve. */
async function abrirEspacio(client,spaceId){
  const orden=[rutaChatActual(),...RUTAS_CHAT.filter(r=>r!==rutaChatActual())]
  for(const ruta of orden){
    await client.call('Page.navigate',{url:spaceChatUrl(spaceId,ruta)},30000).catch(()=>{})
    await sleep(6000)
    const ok=await client.evaluate("(()=>{const u=location.href;const dentro=!"+JSON.stringify(spaceId)+"||u.includes("+JSON.stringify(spaceId)+");const listo=!!document.querySelector('[contenteditable=\"true\"][role=\"textbox\"], [contenteditable=\"true\"], [aria-label=\"Start new chat\"], [aria-label=\"New chat\"]');return dentro&&listo})()",12000).catch(()=>false)
    if(ok===true||String(ok)==='true'){
      if(rutaChatActual()!==ruta){ saveState({chatRoute:ruta,version:VERSION}); log('[ruta] Notion sirve el chat en '+ruta) }
      return true
    }
    log('[ruta] '+ruta+' no abrio el espacio; pruebo la siguiente')
  }
  return false
}
function unwrapRecordValue(record){
  let v=record
  for(let i=0;i<6&&v&&typeof v==='object'&&Object.prototype.hasOwnProperty.call(v,'value');i++)v=v.value
  return (v&&typeof v==='object')?v:{}
}
async function readZenNotionCookies(){
  const {DatabaseSync}=await import('node:sqlite')
  const zenBase=path.join(os.homedir(),'AppData','Roaming','zen','Profiles')
  if(!fs.existsSync(zenBase)) throw new Error('Zen Browser no encontrado en este sistema.')
  const dbs=fs.readdirSync(zenBase,{withFileTypes:true})
    .filter(e=>e.isDirectory())
    .map(e=>path.join(zenBase,e.name,'cookies.sqlite'))
    .filter(p=>fs.existsSync(p))
    .sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs)
  if(!dbs.length) throw new Error('No se encontro perfil de Zen con cookies.sqlite')
  const cookiesPath=dbs[0]
  const tmpDir=path.join(os.tmpdir(),'zen-cap-'+Date.now())
  fs.mkdirSync(tmpDir,{recursive:true})
  const tmpDb=path.join(tmpDir,'cookies.sqlite')
  fs.copyFileSync(cookiesPath,tmpDb)
  if(fs.existsSync(cookiesPath+'-wal')) fs.copyFileSync(cookiesPath+'-wal',path.join(tmpDir,'cookies.sqlite-wal'))
  if(fs.existsSync(cookiesPath+'-shm')) fs.copyFileSync(cookiesPath+'-shm',path.join(tmpDir,'cookies.sqlite-shm'))
  let notionCookies=[]
  try{
    const db=new DatabaseSync(tmpDb,{readOnly:true})
    const ssm={0:'no_restriction',1:'lax',2:'strict'}
    const rows=db.prepare("SELECT name,value,host,path,expiry,isSecure,isHttpOnly,sameSite FROM moz_cookies WHERE host LIKE '%notion%'").all()
    db.close()
    notionCookies=rows.map(r=>({name:r.name,value:r.value,domain:r.host,path:r.path||'/',secure:r.isSecure===1,httpOnly:r.isHttpOnly===1,sameSite:ssm[r.sameSite]||'no_restriction',expires:r.expiry>0?r.expiry:undefined}))
  }finally{try{fs.rmSync(tmpDir,{recursive:true})}catch{}}
  const tokenV2=notionCookies.find(c=>c.name==='token_v2')
  if(!tokenV2) throw new Error('token_v2 no encontrado en Zen. Inicia sesion en Notion en Zen Browser.')
  return {cookies:notionCookies,cookieHeader:notionCookies.map(c=>c.name+'='+c.value).join('; ')}
}
async function captureZenBrowserSession(){
  const {cookies:notionCookies,cookieHeader}=await readZenNotionCookies()
  const NOTION_API="https://"+"www.notion.so/api/v3/loadUserContent"
  let apiData=null
  try{
    const res=await fetch(NOTION_API,{method:'POST',headers:{'Content-Type':'application/json','Cookie':cookieHeader,'User-Agent':'Mozilla/5.0'},body:'{}',signal:AbortSignal.timeout(15000)})
    apiData=await res.json()
  }catch(e){log('[zen] API error: '+e.message)}
  const nu=apiData&&apiData.recordMap&&apiData.recordMap.notion_user||{}
  const uid=Object.keys(nu)[0]
  if(!uid) throw new Error('No se pudo leer el userId con las cookies de Zen. Sesion posiblemente expirada.')
  const uv=unwrapRecordValue(nu[uid])
  const email=uv.email||null
  const name=uv.name||null
  const spaces=apiData&&apiData.recordMap&&apiData.recordMap.space||{}
  if(!Object.keys(spaces).length) throw new Error('Zen OK pero sin workspaces Notion en la API.')
  const now=new Date().toISOString()
  const chatUrl='https://'+'app.notion.com/chat'
  const captured=[]
  for(const [spaceId,spaceRec] of Object.entries(spaces)){
    const sv=unwrapRecordValue(spaceRec)
    const workspace=sv.name||sv.display_name||('Workspace '+spaceId.slice(0,8))
    const wsUrl=spaceChatUrl(spaceId)
    const account=normalizeAccountRow({uid,userId:uid,spaceId,email,name,workspace,chatUrl:wsUrl,url:wsUrl,connectedAt:now,lastSeenAt:now,source:'zen'})
    const session={version:5,capturedAt:now,origin:'https://'+'app.notion.com',href:wsUrl,chatUrl:wsUrl,sourceUrl:wsUrl,userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',userId:uid,spaceId,threadId:null,cookies:notionCookies,account}
    fs.mkdirSync(ACCOUNT_SESSION_DIR,{recursive:true})
    fs.writeFileSync(getAccountSessionFile(account),JSON.stringify({...session,savedAt:now},null,2))
    captured.push({account:upsertConnectedAccount(account)||account,session})
  }
  const state=loadState()
  const preferred=captured.find(x=>x.account.key===state.selectedAccountKey)||captured[0]
  fs.writeFileSync(HEADLESS_SESSION_FILE,JSON.stringify(preferred.session,null,2))
  saveState({selectedAccountKey:preferred.account.key,selectedChatUrl:preferred.account.chatUrl,selectedChatTitle:preferred.account.workspace,lastSelectedAccount:preferred.account,version:VERSION})
  log('[zen] Capturado: '+formatAccountLabel(preferred.account)+' | workspaces='+captured.length)
  return{...preferred.account,workspaceCount:captured.length,source:'zen',connectedWorkspaces:captured.map(x=>({spaceId:x.account.spaceId,workspace:x.account.workspace,key:x.account.key}))}
}
async function discoverZenWorkspaces(){
  const {cookies:notionCookies,cookieHeader}=await readZenNotionCookies()
  const res=await fetch("https://"+"www.notion.so/api/v3/loadUserContent",{method:'POST',headers:{'Content-Type':'application/json','Cookie':cookieHeader,'User-Agent':'Mozilla/5.0'},body:'{}',signal:AbortSignal.timeout(15000)})
  const apiData=await res.json()
  const nu=apiData&&apiData.recordMap&&apiData.recordMap.notion_user||{}
  const uid=Object.keys(nu)[0]
  if(!uid) throw new Error('No se pudo leer el userId con las cookies de Zen.')
  const uv=unwrapRecordValue(nu[uid])
  const spaces=apiData&&apiData.recordMap&&apiData.recordMap.space||{}
  if(!Object.keys(spaces).length) throw new Error('Zen OK pero sin workspaces Notion en la API.')
  const now=new Date().toISOString()
  const chatUrl='https://'+'app.notion.com/chat'
  const known=new Set(readAccounts().accounts.map(a=>a.key))
  const seen=[],added=[]
  for(const [spaceId,spaceRec] of Object.entries(spaces)){
    const sv=unwrapRecordValue(spaceRec)
    const workspace=sv.name||sv.display_name||('Workspace '+spaceId.slice(0,8))
    const wsUrl=spaceChatUrl(spaceId)
    const account=normalizeAccountRow({uid,userId:uid,spaceId,email:uv.email||null,name:uv.name||null,workspace,chatUrl:wsUrl,url:wsUrl,connectedAt:now,lastSeenAt:now,source:'zen'})
    if(!hasSavedSessionForAccount(account)){
      fs.mkdirSync(ACCOUNT_SESSION_DIR,{recursive:true})
      fs.writeFileSync(getAccountSessionFile(account),JSON.stringify({version:5,capturedAt:now,savedAt:now,origin:'https://'+'app.notion.com',href:wsUrl,chatUrl:wsUrl,sourceUrl:wsUrl,userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',userId:uid,spaceId,threadId:null,cookies:notionCookies,account},null,2))
    }
    const stored=upsertConnectedAccount(account)||account
    seen.push(stored)
    if(!known.has(stored.key)) added.push(stored)
  }
  return {total:seen.length,added,accounts:seen}
}
async function autoDetectBestSession(){
  const raw=readJsonSafe(HEADLESS_SESSION_FILE,{})
  const age=raw&&raw.capturedAt?Date.now()-new Date(raw.capturedAt).getTime():Infinity
  const MAX_AGE=30*60*1000
  if(age<MAX_AGE&&raw&&raw.account&&raw.account.email){
    log('[autoDetect] Sesion reciente ('+Math.round(age/60000)+'min): '+formatAccountLabel(raw.account))
    return{source:'cached',account:raw.account}
  }
  log('[autoDetect] Sesion vencida o sin cuenta. Buscando en Zen Browser...')
  try{
    const r=await captureZenBrowserSession()
    log('[autoDetect] Zen OK: '+formatAccountLabel(r))
    return r
  }catch(zenErr){
    log('[autoDetect] Zen no disponible: '+zenErr.message)
  }
  log('[autoDetect] Intentando CDP Notion Desktop (puerto 9223)...')
  try{
    const r=await connectCurrentAccount()
    log('[autoDetect] CDP OK: '+formatAccountLabel(r))
    return{...r,source:'cdp'}
  }catch(cdpErr){
    log('[autoDetect] CDP no disponible: '+cdpErr.message)
  }
  log('[autoDetect] Sin actualizacion de sesion. Usando datos existentes.')
  return null
}
// === FIN PATCH zen-v1 ===

const daemonMode=process.argv.includes('--daemon')
const selfTest=process.argv.includes('--selftest')
try{
  fs.writeFileSync(LOG_FILE,'')
  
// === LIVE ACCOUNT SYNC (patch live-v1) ===
async function startLiveAccountSync(){
  const zenBase=path.join(os.homedir(),'AppData','Roaming','zen','Profiles');
  let lastZenMtime=0;
  let lastAccountKey='';
  let lastDiscoverAt=0;
  const DISCOVER_EVERY_MS=10*60*1000;
  // Estado inicial
  try{
    if(fs.existsSync(zenBase)){
      const dbs=fs.readdirSync(zenBase,{withFileTypes:true})
        .filter(e=>e.isDirectory())
        .map(e=>path.join(zenBase,e.name,'cookies.sqlite'))
        .filter(p=>fs.existsSync(p))
        .sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs);
      if(dbs.length>0) lastZenMtime=fs.statSync(dbs[0]).mtimeMs;
    }
  }catch(e){log('[liveSync] init mtime error: '+e.message);}
  try{
    const raw=readJsonSafe(HEADLESS_SESSION_FILE)||{};
    lastAccountKey=raw.account?.key||raw.userId||'';
  }catch{}
  log('[liveSync] Monitor activo. Revisando cada 3min.');
  // Ciclo de sincronizacion
  setInterval(async()=>{
    try{
      // NUNCA en medio de una peticion: cambiar de cuenta o refrescar la sesion
      // mueve el hilo del chat y se pierde la respuesta que Notion ya estaba
      // escribiendo ("el chat cambió de hilo y la solicitud se perdió"), con su
      // cupo ya gastado. Se salta el turno y se hace en el siguiente.
      try{
        if(fs.readdirSync(REQ_DIR).some(n=>n.endsWith('.working.json'))) return
      }catch{}
      // 1. Detectar cambios en cookies de Zen
      let zenChanged=false;
      if(fs.existsSync(zenBase)){
        try{
          const dbs=fs.readdirSync(zenBase,{withFileTypes:true})
            .filter(e=>e.isDirectory())
            .map(e=>path.join(zenBase,e.name,'cookies.sqlite'))
            .filter(p=>fs.existsSync(p))
            .sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs);
          if(dbs.length>0){
            const mtime=fs.statSync(dbs[0]).mtimeMs;
            if(mtime!==lastZenMtime){zenChanged=true; lastZenMtime=mtime;}
          }
        }catch{}
      }
      // 2. Si cambiaron las cookies: actualizar sesion
      if(zenChanged){
        log('[liveSync] Cambio en Zen detectado. Actualizando...');
        try{
          const r=await captureZenBrowserSession();
          const newKey=r.key||r.userId||'';
          if(newKey&&newKey!==lastAccountKey){
            log('[liveSync] Nueva cuenta activa: '+formatAccountLabel(r));
            lastAccountKey=newKey;
          } else {
            log('[liveSync] Sesion refrescada: '+formatAccountLabel(r));
          }
        }catch(e){log('[liveSync] Error Zen: '+e.message);}
      }
      // 3. Refrescar si la sesion tiene mas de 6 horas
      try{
        const raw=readJsonSafe(HEADLESS_SESSION_FILE)||{};
        const age=raw.capturedAt?Date.now()-new Date(raw.capturedAt).getTime():Infinity;
        if(age>6*60*60*1000){
          log('[liveSync] Sesion antigua ('+Math.round(age/3600000)+'h). Refrescando...');
          await autoDetectBestSession().catch(e=>log('[liveSync] Refresh error: '+e.message));
        }
      }catch{}
      // 4. Redescubrir workspaces del usuario (incluye los creados despues del ultimo login)
      if(zenChanged||Date.now()-lastDiscoverAt>=DISCOVER_EVERY_MS){
        lastDiscoverAt=Date.now();
        try{
          const d=await discoverZenWorkspaces();
          if(d.added.length) log('[liveSync] Workspaces nuevos: '+d.added.map(a=>formatAccountLabel(a)).join(' ; '));
          else log('[liveSync] Workspaces sincronizados: '+d.total);
        }catch(e){log('[liveSync] Descubrimiento error: '+e.message);}
      }
      // 5. Mantener el colchon de workspaces con cupo: mide, crea los que
      // falten (plan Free), les conecta el MCP con permisos automaticos y
      // sincroniza el registro de rotacion. Sin esto habia que lanzarlo a mano.

    }catch(e){log('[liveSync] Error ciclo: '+e.message);}
  },3*60*1000);
}
// === FIN LIVE ACCOUNT SYNC ===

ensureDirs();ensureMemoryFile();ensureTranscriptFile();acquireInstance();recoverOrphanRequests()
  // La cola arranca ANTES de detectar la sesion: autoDetect tarda segundos
  // (cookies de Zen + API) y hacia esperar a quien abriera el terminal.
  setInterval(()=>{drainBridgeQueue().catch(e=>log(`queue err: ${e.message}`))},400)
  autoDetectBestSession().catch(e=>log("[autoDetect] Error inicio: "+e.message))
  startLiveAccountSync().catch(e=>log("[liveSync] Error inicio: "+e.message))
  log(`Bridge v${VERSION} pid=${process.pid} daemon=${daemonMode} mode=${DEFAULT_MODE}`)
  if(selfTest){const chats=await inspectChats().catch(()=>[]);console.log(`SELFTEST v${VERSION} chats=${chats.length}`);closeChatClients(chats);releaseInstance();process.exit(0)}
  if(daemonMode){console.log(`Bridge daemon v${VERSION} pid=${process.pid}`);process.stdin.resume()}
  else{await interactiveLoop();releaseInstance();process.exit(0)}
}catch(error){
  log(`Error inicio: ${error.message}`);console.error(`Error: ${error.message}`);releaseInstance();process.exit(1)
}



