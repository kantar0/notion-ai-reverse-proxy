import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const DIR=path.dirname(fileURLToPath(import.meta.url))
const OUT=path.join(DIR,'mcp-workspace-registry.json')
const CDP='http://127.0.0.1:9223'
const CANONICAL_MCP_ORIGIN=(process.env.MCP_ORIGIN || 'https://TU-SERVIDOR-MCP.example.com')   // URL de TU servidor MCP (mcp-server.json / MCP_ORIGIN)
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
function readRegistrySafe(){try{const j=JSON.parse(fs.readFileSync(OUT,'utf8'));return{...j,rows:Array.isArray(j.rows)?j.rows:[]}}catch{return{rows:[]}}}
const unwrap=value=>{let v=value;for(let i=0;i<6&&v&&typeof v==='object'&&Object.prototype.hasOwnProperty.call(v,'value');i++)v=v.value;return v||{}}

function collectFanout(payload,spaces,pointers){
 const walk=x=>{
  if(!x||typeof x!=='object')return
  const v=unwrap(x)
  if(v&&typeof v==='object'&&v.id&&v.name&&v.settings&&('plan_type'in v||'subscription_tier'in v)){
   spaces.set(v.id,{spaceId:v.id,workspace:v.name,aiEnabled:v.settings.enable_ai_feature!==false&&!v.settings.disable_ai_feature,adminBlocked:v.settings.notion_admin_disabled_ai_feature===true||typeof v.settings.notion_admin_ai_disable_enforcement_token==='string'})
  }
  if(v&&typeof v==='object'&&v.space_id&&v.settings&&Array.isArray(v.settings.agent_chat_modules)){
   for(const item of v.settings.agent_chat_modules){const p=item?.pointer;if(p?.table==='workflow_module')pointers.set(p.spaceId+'|'+p.id,{spaceId:p.spaceId,moduleId:p.id,defaultEnabled:!!item.defaultEnabled})}
  }
  for(const child of Object.values(x))if(child&&typeof child==='object')walk(child)
 }
 walk(payload)
}

function canonicalizeServerUrl(rawUrl,officialName){
 const raw=String(rawUrl||'').trim()
 const isPcControl=/mcp-pc-control/i.test(String(officialName||''))
 let host=''
 try{host=new URL(raw).host}catch{}
 const isNgrok=/ngrok(-free)?\.(app|dev|io)$/i.test(host)
 if(!raw)return{serverUrl:CANONICAL_MCP_ORIGIN,originalServerUrl:raw,canonicalized:true}
 if(!isPcControl&&!isNgrok)return{serverUrl:raw,originalServerUrl:raw,canonicalized:false}
 let suffix=''
 try{const u=new URL(raw);suffix=(u.pathname==='/'?'':u.pathname)+(u.search||'')}catch{}
 const next=CANONICAL_MCP_ORIGIN+suffix
 return{serverUrl:next,originalServerUrl:raw,canonicalized:next!==raw}
}

async function probeModule(mod){
 const u=String(mod.serverUrl||'').trim()
 if(!u)return{ok:false,error:'sin serverUrl'}
 let origin
 try{origin=new URL(u).origin}catch{return{ok:false,error:'URL inválida'}}
 const candidates=[]
 if(/mcp-pc-control|ngrok-free/i.test(String(mod.officialName||'')+' '+u))candidates.push(origin+'/health')
 candidates.push(u)
 for(const url of [...new Set(candidates)]){
  const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),8000)
  try{
   const r=await fetch(url,{method:'GET',headers:{'ngrok-skip-browser-warning':'1','accept':'application/json,text/plain,*/*'},signal:ctl.signal,redirect:'follow'})
   const text=await r.text().catch(()=>'')
   if((url.endsWith('/health')&&r.ok&&/"ok"\s*:\s*true/i.test(text))||(!url.endsWith('/health')&&r.status!==404&&r.status<500))return{ok:true,status:r.status,checkedUrl:url}
  }catch(e){if(url===candidates[candidates.length-1])return{ok:false,error:e.name==='AbortError'?'timeout':String(e.message||e)}}finally{clearTimeout(timer)}
 }
 return{ok:false,error:'endpoint no disponible'}
}

let browser
try{
 browser=await chromium.connectOverCDP(CDP)
 const context=browser.contexts()[0]
 const page=context.pages().find(p=>/notion/i.test(p.url()))||context.pages()[0]
 if(!page)throw new Error('No hay página Notion en CDP')
 const fanouts=[]
 page.on('response',async r=>{try{if(new URL(r.url()).pathname==='/api/v3/getSpacesFanout'){const txt=await r.text();fanouts.push(JSON.parse(txt))}}catch{}})
 await page.goto(['https:','','www.notion.so','ai'].join('/'),{waitUntil:'domcontentloaded',timeout:30000}).catch(()=>{})
 for(let i=0;i<20&&fanouts.length<2;i++)await sleep(500)
 const spaces=new Map(),pointers=new Map()
 for(const payload of fanouts)collectFanout(payload,spaces,pointers)
 if(!pointers.size)throw new Error('Notion no devolvió agent_chat_modules')
 const rows=[]
 const currentUserId=await page.evaluate(()=>{const read=k=>{try{return JSON.parse(localStorage.getItem(k)||'null')?.value||null}catch{return null}};return read('LRU:KeyValueStore2:current-user-id')})
 for(const p of pointers.values()){
  const payload=await page.evaluate(async ({pointer,currentUserId})=>{
   const body={requests:[{pointer:{id:pointer.moduleId,table:'workflow_module',spaceId:pointer.spaceId},version:-1}],spacePointer:{table:'space',id:pointer.spaceId}}
   const r=await fetch('/api/v3/syncRecordValuesSpaceInitial',{method:'POST',credentials:'include',headers:{'content-type':'application/json','x-notion-space-id':pointer.spaceId,'x-notion-active-user-header':currentUserId},body:JSON.stringify(body)})
   return await r.json()
  },{pointer:p,currentUserId}).catch(e=>({error:String(e.message||e)}))
  const rec=unwrap(payload?.recordMap?.workflow_module?.[p.moduleId])
  const data=rec?.data||{}
  const base={...p,...(spaces.get(p.spaceId)||{}),name:data.name||'',...canonicalizeServerUrl(data.serverUrl,data.officialName),officialName:data.officialName||'',connectionId:data.connectionPointer?.id||'',alive:rec?.alive!==false,tools:Array.isArray(data.tools)?data.tools.map(t=>t.name):[]}
  const blocked=base.adminBlocked===true
  const probe=blocked?{ok:false,skipped:true,error:'IA deshabilitada administrativamente por Notion en este espacio'}:await probeModule(base)
  rows.push({...base,blocked,blockedReason:blocked?'notion_admin_disabled_ai_feature':null,probe,ready:!blocked&&base.aiEnabled!==false&&base.alive!==false&&probe.ok===true})
 }
 const current=await page.evaluate(()=>{const read=k=>{try{return JSON.parse(localStorage.getItem(k)||'null')?.value||null}catch{return null}};return{userId:read('LRU:KeyValueStore2:current-user-id'),spaceId:read('LRU:KeyValueStore2:current-space-id')}})
 // Este escaner solo ve la cuenta cargada en el motor. Sobrescribir el archivo
 // borraba los workspaces de las demas cuentas (registrados con
 // mcp-registry-sync-all.mjs) y los sacaba de la rotacion en el siguiente
 // refresco: se fusiona por spaceId en vez de pisar.
 const merged=new Map()
 for(const prev of (readRegistrySafe().rows||[])) merged.set(prev.spaceId,prev)
 for(const row of rows) merged.set(row.spaceId,row)
 const allRows=[...merged.values()]
 const summary={total:allRows.length,ready:allRows.filter(r=>r.ready).length,blocked:allRows.filter(r=>r.blocked).length,broken:allRows.filter(r=>!r.ready&&!r.blocked).length}
 const out={version:1,generatedAt:new Date().toISOString(),userId:current.userId,currentSpaceId:current.spaceId,summary,rows:allRows,scannedRows:rows.length}
 fs.writeFileSync(OUT,JSON.stringify(out,null,2))
 console.log(JSON.stringify(out,null,2))
 process.exit(0)
}catch(error){
 // Un fallo del escaneo (motor caido, sin modulos MCP) NO es prueba de que los
 // workspaces ya registrados dejaran de servir: antes se guardaba rows:[] y eso
 // dejaba la rotacion sin candidatos en silencio.
 const prev=readRegistrySafe()
 const out={...prev,version:1,generatedAt:prev.generatedAt||new Date().toISOString(),lastErrorAt:new Date().toISOString(),error:String(error.message||error),rows:prev.rows||[]}
 fs.writeFileSync(OUT,JSON.stringify(out,null,2));console.error(error);process.exit(1)
}
