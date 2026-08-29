# Notion bloquea los MCP propios — diagnóstico y la vuelta que sí funciona

**Fecha:** 2026-08-28. **Estado:** el bloqueo sigue activo del lado de Notion; el puente
descrito aquí lo esquiva y está en producción.

---

## 1. El síntoma

Cualquier herramienta de un servidor MCP propio falla desde Notion AI:

```
Tool 'list_files' has changed its operation type since the last admin approval.
An admin must re-approve it in the module settings before it can be used
```

Afecta a **todas** las herramientas (`run_command`, `check_health`…), no sólo a una.

## 2. Lo que se probó, y no funcionó

Cada punto descarta una hipótesis. Si te encuentras este error, **no pierdas tiempo aquí**:

| intento | resultado |
|---|---|
| Permisos ya en *Run automatically* (Read 5/5, Write 8/8) | mismo error |
| Alternar *Always ask* ↔ *Run automatically* | mismo error |
| Desmarcar y volver a marcar en *Customize selection* | mismo error |
| Desconectar y reconectar el módulo | mismo error |
| Reinstalar el servidor en el workspace | mismo error |
| Toggle de administrador *Enable custom MCP servers* (off→on) | mismo error |
| **URL nueva** del mismo servidor (`?v=2`, `?v=3`) | mismo error |
| **Nombre nuevo** del servidor (PC2, PC3) | mismo error |
| **Workspace recién creado**, sin aprobación previa | mismo error |
| **Servidor sin `annotations`** (sin declarar tipo) | mismo error |
| **Herramientas renombradas** (`sh_list_files`), que Notion nunca había visto | mismo error |

La última fila es la concluyente: una herramienta **inédita**, en un servidor **inédito**,
en un workspace **inédito**, sigue dando "cambió su tipo de operación desde la última
aprobación". No existe aprobación previa que comparar → **es un fallo de Notion**, no de
tu configuración.

Contexto: ese mismo día Notion desplegó varias builds (`assetsVersion` 1620 → 1830) que
además **cambiaron la ruta del chat** (`/chat` ↔ `/ai`) un par de veces.

**El servidor MCP está sano:** responde por HTTP sin problema. Sólo falla cuando lo llama
Notion. Compruébalo tú mismo:

```bash
node mcp-local.mjs list
node mcp-local.mjs call list_files '{"path":"~/Desktop"}'
```

## 3. La vuelta: que las herramientas las ejecute el CLI

Si Notion no puede llamar al MCP, que no lo llame. Notion razona; el CLI ejecuta.

### Camino A — determinista (el fiable)

Si la petición menciona una ruta (o el escritorio), el CLI **resuelve antes de preguntar**
y le entrega el dato ya leído:

```
usuario:  "cuántas carpetas hay en el escritorio"
CLI:      list_files ~/Desktop  →  RECUENTO EXACTO: 164 entradas = 75 carpetas + 89 archivos
Notion:   "Hay 75 carpetas en el escritorio"
```

En el log aparece como `[pc] adjunto list_files ~/Desktop`. No depende de que el modelo
quiera colaborar, por eso es el camino principal (`contextoDelPc()` y `escrituraEnPc()`).

### Camino B — bucle de herramientas

Notion pide la orden y el CLI la ejecuta (log `[puente]`):

```
Notion:  EJECUTAR {"tool":"write_text_file","args":{"path":"~/Desktop/x.txt","content":"hola"}}
CLI:     (ejecuta y devuelve el resultado)
Notion:  "Archivo creado en ~/Desktop/x.txt"
```

Funciona, pero el modelo es **irregular**: a veces ejecuta y a veces responde "no tengo
acceso a tu PC" a la misma petición, con el mismo prompt. De ahí que exista el camino A.

### Detalles que costaron encontrar

- El modelo escribe con **caracteres matemáticos unicode** (`𝑝 = 𝐽 𝑜 𝑖 𝑛 − 𝑃 𝑎 𝑡 ℎ`)
  que revientan cualquier comando → se normaliza con `String.normalize('NFKC')`.
- **Rompe su propio JSON** metiendo comillas dobles dentro del comando → hay un parser
  tolerante por índices, no `JSON.parse` a secas.
- **Cuenta mal**: dijo 48 carpetas donde había 75 → el recuento lo calcula el CLI y se le
  pasa ya hecho.

### Ejecutar comandos y abrir programas: NO por el MCP

Tres fallos encadenados hacían que "abre Chrome" respondiera *"listo"* sin abrir nada:

1. **El servidor MCP no encuentra `cmd.exe`** (`Error: spawn cmd.exe ENOENT`): su PATH no
   incluye System32. Antes de eso devolvía `ok:true, statusCode:0` sin ejecutar nada.
   → `run_command` y `start_background_command` los ejecuta **el daemon**, que corre en la
   sesión del usuario (`ejecutarOrden()`); el resto de herramientas siguen yendo al MCP.
2. **`cmd /c start X` no abre ventanas** cuando lo lanza un proceso hijo: `cmd` termina y
   se lleva la aplicación por delante. → se traducen a `Start-Process`
   (`comandoDeApertura()` + `abrirLocal()`).
3. **Se daba por bueno el lanzamiento.** → ahora se **comprueba que el proceso existe**
   (`Get-Process`) y, si no aparece, se dice; nada de "ya está abierto" a ciegas.

Detalle de entorno: si el daemon se lanza desde un contexto **sin sesión gráfica** (por
ejemplo, un servicio o una shell sin escritorio), no hay dónde dibujar la ventana. El
daemon debe nacer en la sesión interactiva del usuario.

**El modelo repite la misma orden** una y otra vez aunque ya tenga el resultado (se vieron
5 vueltas seguidas con `cmd /c start chrome`, 229 s). Las órdenes ya ejecutadas se
memorizan por petición: si se repite una, se corta y se le exige la respuesta.

## 4. Consecuencia: el MCP deja de ser requisito

Con el puente activo (`cli-state.mcpBridge !== false`, por defecto):

- Un workspace **no necesita el MCP conectado** para servir.
- Se salta la sincronización de módulo y thread MCP: eran **~30 s por petición** y
  causaba rotaciones inútiles.
- Las cuentas y workspaces nuevos se registran **sin provisión** (de minutos a segundos),
  así que entran solos.

Para volver al modo antiguo si Notion lo arregla: `"mcpBridge": false` en `cli-state.json`.

---

## 5. Otros hallazgos del mismo día (útiles si automatizas Notion)

**La ruta del chat cambia entre despliegues.** Por la mañana `/ai?spaceId=` redirigía a
`/chat`; por la tarde era `/chat?spaceId=` la que redirigía **perdiendo el spaceId** y
dejaba la página sin composer. No la fijes: pruébalas y recuerda la que funcione
(`abrirEspacio()` + `cli-state.chatRoute`).

**El motor puede quedar vivo pero inservible.** `/json/version` sigue devolviendo `200`
mientras `connectOverCDP` expira en el handshake (se acumulan service workers). Ningún
vigilante que mire el HTTP lo detecta. La única comprobación válida es **conectar de
verdad**: `engine-health.mjs`.

**Notion no siempre marca "Notion AI finished".** Si esperas esa señal, pierdes respuestas
que ya están en pantalla. Ancla el texto al identificador de tu propia petición
(`[reqId:xxxx]` dentro del prompt) y acepta cuando dos lecturas coincidan.

**No confundas "sin sesión" con "sin cupo".** Al rotar entre cuentas, si las cookies no se
restauran aparece la pantalla de login: sin composer. Tratarlo como falta de cupo hace que
vayas tachando workspaces buenos uno tras otro.

**El aviso del trial de Business no es un límite de cuenta.** Un espacio con el trial
agotado dice *"wait until <fecha> for it to reset"* y parece que la cuenta entera está
seca. Es falso: en esa misma cuenta, **un workspace nuevo del plan Free nace con cupo**.
Mide siempre espacio por espacio.

**Las pestañas se acumulan y Edge se come la RAM.** Cada rotación o precalentado abre una
pestaña; con 21 abiertas el motor llegó a **4,4 GB**. `tabs-clean.mjs` deja una y el
daemon lo lanza tras cada petición; con los límites de `start-notion-cdp.ps1`
(`--renderer-process-limit=3`, sin extensiones, heap y cachés acotadas) baja a **~1 GB**.

## 6. Estrategia de cupo (plan Free)

El cupo de Notion AI va **por workspace**, no por cuenta: cada espacio nuevo del plan Free
trae el suyo. Nada de trials de Business (piden tarjeta y su cupo es aparte).

`pool-maintain.mjs` cierra el ciclo solo: mide → crea los que falten → registra → devuelve
la sesión que estaba activa. Se dispara **por evento** (al quedarse sin cupo), no por reloj.

Ojo: `createSpace` devuelve **429** tras crear varios seguidos. Es límite de **ritmo** y
**por cuenta**: borrar espacios no lo desbloquea, pero otras cuentas sí pueden seguir
creando (se anota en `cli-state.spaceCreateBlockedBy`).
