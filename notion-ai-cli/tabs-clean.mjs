// tabs-clean — cierra las pestañas sobrantes del motor invisible.
//
// Cada rotacion, precalentado o script de alta abre una pestaña de Notion y casi
// ninguna se cerraba: se acumularon 21 y Edge llego a 11 GB de RAM (34 procesos).
// Se conserva UNA pestaña de Notion (la mas reciente, que es la que usa el
// daemon) y, si se indica, la precalentada.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const CDP = (process.env.CDP_URL || 'http://127.0.0.1:9223').replace(/\/+$/, '')
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null } }

const lista = await (await fetch(CDP + '/json/list', { signal: AbortSignal.timeout(8000) })).json()
const paginas = lista.filter(t => t.type === 'page')
const notion = paginas.filter(t => /notion\.(com|so)/i.test(t.url || ''))
// La pestaña precalentada se respeta: cerrarla anularia el salto instantaneo.
const st = readJson(path.join(DIR, 'cli-state.json')) || {}
const proteger = new Set([st.precalentadoTargetId].filter(Boolean))
// Se queda la ultima de la lista (la mas reciente en uso) mas las protegidas.
if (notion.length) proteger.add(notion[notion.length - 1].id)

let cerradas = 0
for (const t of paginas) {
  if (proteger.has(t.id)) continue
  if (!/notion\.(com|so)/i.test(t.url || '') && !/^about:blank$/i.test(t.url || '')) continue
  try {
    await fetch(CDP + '/json/close/' + t.id, { signal: AbortSignal.timeout(5000) })
    cerradas++
  } catch {}
}
console.log(`pestañas: ${paginas.length} → ${paginas.length - cerradas} (cerradas ${cerradas})`)
