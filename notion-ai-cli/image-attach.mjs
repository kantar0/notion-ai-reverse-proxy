// image-attach.mjs
// Soporte de imagenes para el CLI de Notion.
// El usuario arrastra/pega una imagen -> la ruta llega dentro del texto del prompt.
// Aqui la detectamos, la sacamos del texto y adjuntamos el archivo real al composer.
import fs from 'node:fs'
import path from 'node:path'

export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif']
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// Acepta rutas con o sin comillas, con prefijo @ (terminal Shosso), file:///, UNC y barras mixtas.
const PATH_RE = /(?:@)?(?:file:\/\/\/?)?(?:[a-zA-Z]:[\\/]|\\\\)[^\r\n"'*?<>|]*?\.(?:png|jpe?g|gif|webp|bmp|avif)/gi

export function imageMimeFor(file) {
  const f = String(file || '').toLowerCase()
  if (f.endsWith('.png')) return 'image/png'
  if (f.endsWith('.gif')) return 'image/gif'
  if (f.endsWith('.webp')) return 'image/webp'
  if (f.endsWith('.bmp')) return 'image/bmp'
  if (f.endsWith('.avif')) return 'image/avif'
  return 'image/jpeg'
}

function normalizeCandidate(candidate) {
  let clean = String(candidate || '').trim()
  clean = clean.replace(/^@+/, '')
  clean = clean.replace(/^file:\/\/\/?/i, '')
  clean = clean.replace(/^["']+/, '').replace(/["']+$/, '')
  clean = clean.replace(/[).,;:]+$/, '')
  try { clean = decodeURIComponent(clean) } catch {}
  return clean.trim()
}

function isUsableImage(candidate) {
  try {
    const clean = normalizeCandidate(candidate)
    if (!clean) return null
    if (!fs.existsSync(clean)) return null
    if (!fs.statSync(clean).isFile()) return null
    return path.resolve(clean)
  } catch {
    return null
  }
}

// Extrae rutas de imagen del prompt y devuelve el texto ya limpio.
export function extractImagePaths(text) {
  const raw = String(text || '')
  const found = []
  const clean = raw.replace(PATH_RE, match => {
    const resolved = isUsableImage(match)
    if (resolved) { found.push(resolved); return ' ' }
    return match
  })
  const tidy = clean
    .replace(/\((?:image|imagen|img)\)/gi, ' ')
    .replace(/"\s*"|'\s*'/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
  return { clean: tidy, files: [...new Set(found)] }
}

const PREVIEW_SELECTOR = '[aria-label^="Preview "], [aria-label*="from context"], img[src*="file.notion.com"], img[src^="blob:"], img[src^="data:image"]'
const REMOVE_SELECTOR = '[aria-label^="Remove "][aria-label$=" from context"], [aria-label*="Remove file"], [aria-label*="Remove attachment"], [aria-label*="Quitar"]'

// Quita adjuntos viejos que hayan quedado pegados en el composer.
export async function clearComposerAttachments(cdp, log = () => {}) {
  const expression = [
    '(async()=>{try{',
    'const sel=', JSON.stringify(REMOVE_SELECTOR), ';',
    'const wait=ms=>new Promise(r=>setTimeout(r,ms));',
    'let removed=0;',
    'for(let i=0;i<8;i++){',
    '  const btn=[...document.querySelectorAll(sel)].find(b=>{const r=b.getBoundingClientRect();return r.width>0&&r.height>0});',
    '  if(!btn)break;',
    '  try{btn.click();removed++}catch(e){break}',
    '  await wait(250);',
    '}',
    'return JSON.stringify({removed:removed});',
    '}catch(err){return JSON.stringify({removed:0,reason:String(err&&err.message||err)})}})()',
  ].join('')
  try {
    const out = await cdp.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, 30000)
    const parsed = JSON.parse(String(out?.result?.value || '{}'))
    if (parsed.removed) log('[img] limpie ' + parsed.removed + ' adjunto(s) viejo(s) del chat')
    return parsed.removed || 0
  } catch (error) {
    log('[img] no pude limpiar adjuntos viejos: ' + error.message)
    return 0
  }
}

function buildInPageScript(config) {
  const cfg = JSON.stringify(config)
  const previewSel = JSON.stringify(PREVIEW_SELECTOR)
  return [
    '(async()=>{try{',
    'const cfg=', cfg, ';',
    'const previewSel=', previewSel, ';',
    'const wait=ms=>new Promise(r=>setTimeout(r,ms));',
    'const bin=atob(cfg.b64);const bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);',
    'const file=new File([bytes],cfg.name,{type:cfg.mime});',
    'const nodes=[...document.querySelectorAll(\'[contenteditable="true"][role="textbox"], textarea, [contenteditable="true"]\')].filter(e=>{const r=e.getBoundingClientRect();return r.width>20&&r.height>10});',
    'const el=nodes.at(-1)||nodes[0];',
    'if(!el)return JSON.stringify({ok:false,reason:"no encontre el campo del chat"});',
    'try{el.scrollIntoView({block:"center"})}catch(e){}',
    'el.focus();',
    'const before=document.querySelectorAll(previewSel).length;',
    'const makeDt=()=>{const dt=new DataTransfer();dt.items.add(file);return dt};',
    'let used="";',
    'const input=[...document.querySelectorAll(\'input[type="file"]\')].find(x=>!x.disabled);',
    'if(input){try{input.files=makeDt().files;input.dispatchEvent(new Event("input",{bubbles:true}));input.dispatchEvent(new Event("change",{bubbles:true}));used="file-input"}catch(e){}}',
    'if(!used){try{el.dispatchEvent(new ClipboardEvent("paste",{bubbles:true,cancelable:true,clipboardData:makeDt()}));used="paste"}catch(e){}}',
    'await wait(1600);',
    'if(document.querySelectorAll(previewSel).length<=before){',
    '  const r=el.getBoundingClientRect();',
    '  const base={bubbles:true,cancelable:true,composed:true,clientX:Math.round(r.left+r.width/2),clientY:Math.round(r.top+r.height/2)};',
    '  const dt=makeDt();',
    '  for(const type of ["dragenter","dragover","drop"]){try{el.dispatchEvent(new DragEvent(type,Object.assign({},base,{dataTransfer:dt})))}catch(e){}}',
    '  used=used?used+"+drop":"drop";',
    '  await wait(2000);',
    '}',
    'const preview=document.querySelectorAll(previewSel).length>before;',
    'return JSON.stringify({ok:!!used,used:used,preview:preview,name:cfg.name});',
    '}catch(err){return JSON.stringify({ok:false,reason:String(err&&err.message||err)})}})()',
  ].join('')
}

// Adjunta las imagenes al composer ya abierto. cdp = CdpClient del bridge.
export async function attachImagesToComposer(cdp, files, log = () => {}) {
  const results = []
  for (const file of files || []) {
    let b64 = ''
    try {
      const stat = fs.statSync(file)
      if (stat.size > 12 * 1024 * 1024) {
        results.push({ file, ok: false, reason: 'la imagen pesa mas de 12 MB' })
        log('[img] ' + path.basename(file) + ' -> omitida (mayor a 12 MB)')
        continue
      }
      b64 = fs.readFileSync(file).toString('base64')
    } catch (error) {
      results.push({ file, ok: false, reason: error.message })
      log('[img] ' + path.basename(file) + ' -> no pude leerla: ' + error.message)
      continue
    }
    const expression = buildInPageScript({ b64, mime: imageMimeFor(file), name: path.basename(file) })
    let raw = null
    try {
      const out = await cdp.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, 120000)
      raw = out?.result?.value
    } catch (error) {
      results.push({ file, ok: false, reason: error.message })
      log('[img] ' + path.basename(file) + ' -> fallo CDP: ' + error.message)
      continue
    }
    let parsed = {}
    try { parsed = JSON.parse(String(raw || '{}')) } catch {}
    const entry = { file, ok: !!parsed.ok, used: parsed.used || '', preview: !!parsed.preview, reason: parsed.reason || '' }
    results.push(entry)
    log('[img] ' + path.basename(file) + ' -> ' + (entry.ok
      ? ('adjuntada via ' + (entry.used || '?') + (entry.preview ? ' (preview visible)' : ' (sin preview)'))
      : ('fallo: ' + (entry.reason || 'desconocido'))))
    await sleep(900)
  }
  return results
}

// El prompt real incluye memoria e historial, donde pueden aparecer rutas viejas.
// Solo debemos adjuntar las imagenes de la solicitud actual del usuario.
const USER_MARKER = 'SOLICITUD DEL USUARIO:'

export function extractImagePathsFromPrompt(text) {
  const raw = String(text || '')
  const idx = raw.lastIndexOf(USER_MARKER)
  if (idx === -1) return extractImagePaths(raw)
  const cut = idx + USER_MARKER.length
  const head = raw.slice(0, cut)
  const scan = extractImagePaths(raw.slice(cut))
  return { clean: head + '\n' + scan.clean, files: scan.files }
}
