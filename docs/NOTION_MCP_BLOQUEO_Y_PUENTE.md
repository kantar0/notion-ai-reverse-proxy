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

## 3.bis Por qué el puente gasta más cupo, y qué hacer

Con MCP, **una petición = una respuesta del cupo**: el razonamiento, las llamadas a herramientas y
la contestación caben en un solo turno. El puente rompe eso en dos: una respuesta para traducir la
petición a un comando y otra para redactar el resultado. En el plan Free, donde el cupo es el
recurso escaso, eso es el doble de gasto por cada cosa que pidas.

**No se puede simular el MCP desde fuera.** Inyectar el resultado de una herramienta *dentro* de un
turno en curso es precisamente lo que hace ese canal; mientras Notion genera, no acepta ninguna
entrada. No hay otra puerta.

Lo que sí devuelve el gasto a una sola respuesta: **que el CLI presente el resultado**. La IA
traduce (1 respuesta), el CLI ejecuta y muestra la salida, y no se gasta un segundo turno en
redactarla. Para que una petición de varios pasos siga funcionando con un solo turno, se ejecutan
**todas** las órdenes de esa respuesta, en el orden en que las escribió. Con `redactarConIA: true`
en `cli-state.json` vuelve el modo de dos turnos.

Cuatro cosas gastaban respuestas sin dar nada a cambio, y hay que quitarlas todas para que una
petición cueste de verdad una sola:

- **Reenviar cuando Notion ya está generando.** Si la marca del `[reqId:]` no aparece todavía, mira
  antes si hay un *"is generating a response"* en la página: el prompt salió, y reenviar tira la
  respuesta en curso y paga otra.
- **Enviar el primer mensaje crea el hilo.** Notion navega a `?t=…` y durante ese parpadeo la marca
  no está en la página: parece que el prompt se perdió. Confírmalo con calma **una sola vez**, no en
  cada vuelta, o la petición se queda dando vueltas hasta agotar el tope.
- **En un hilo recién creado el turno del usuario no aparece**, así que la marca nunca llega. Si el
  envío ya se confirmó, acepta la respuesta sin ella: si no, descartas una contestación ya escrita
  y ya pagada.
- **Nada de sincronizar en medio de una petición.** Refrescar la sesión o cambiar de cuenta mueve el
  hilo del chat y la respuesta se pierde con su cupo gastado ("el chat cambió de hilo").

Y no aceptes cualquier hilo `?t=` guardado: comprueba que es **de la cuenta activa**. Si es de otro
workspace, Notion recarga con un chat nuevo y la petición se pierde.

- **No cortes el JSON de la orden en la primera llave.** Un script de PowerShell lleva llaves
  dentro (`if (...) { 'ya' } else { Start-Process calc }`), y un patrón perezoso deja el comando en
  `powershell -NoProfile -Command`, que solo imprime la ayuda. La respuesta ya estaba pagada, y
  encima obliga al usuario a repetir la petición: dos respuestas por nada. Recorta hasta la última
  llave de la línea.

- **No le pidas que redacte algo que ya tienes.** Tres caminos del bucle (orden repetida, JSON mal
  formado, pasos agotados) terminaban preguntando a la IA con el resultado ya en la mano. Eso es una
  respuesta entera del cupo para no aportar nada: presenta el dato y cierra.

**El alta de workspaces por interfaz: tres cosas que la rompen.** Es la única vía que da espacios
con cupo (los de `createSpace` nacen sin él), así que conviene tenerla fina:

1. **El conmutador de espacios no se abre con `click()`.** Notion solo reacciona a eventos de
   confianza: hay que pulsarlo por CDP (`Input.dispatchMouseEvent`, con el `mouseMoved` previo).
   Con `el.click()` no pasa nada y parece que el menú no existe.
2. **"New workspace" está al final de la lista de TODOS tus espacios.** Con diez workspaces queda
   fuera de la vista: el texto aparece en el DOM (y engaña a cualquier comprobación por texto) pero
   no hay nada que pulsar hasta bajar el scroll del overlay.
3. **Los ítems del menú tampoco responden al `click()` del DOM**, por lo mismo: localiza la caja del
   elemento visible y pulsa por CDP.

Y el 429 de `createSpace` es **real y por cuenta** (`TooManyRequestsError`): unas cuantas creaciones
seguidas lo activan y hay que esperar. No lo confundas con un fallo de interfaz — mira si la sesión
sigue viva antes de apartar la cuenta una hora.

**Y sube la oferta, no solo el ahorro.** El cupo va por workspace, así que el colchón del pool ES
la reserva: con el mínimo en 3 se secaba a las pocas peticiones. Se configura en `cli-state.json`
(`poolMinimo`) y el mantenimiento repone solo, repartiendo la creación entre cuentas y respetando
el 429 de ritmo (que es por cuenta: se anota la cortada y se sigue por otra).

**Medido:** con esto, "abre la calculadora" pasó de nueve envíos sin resultado a **un solo envío**,
con la aplicación abierta en 42 segundos.

**Comprobado el 2026-08-29:** el error de "operation type" ya no aparece, pero **el MCP no está
disponible en los workspaces del plan Free**: darlo de alta por API lo rechaza Notion
(`Client saveTransactions request targets tables blocked by policy`), en los espacios que ya tenían
módulos la IA contesta *"no puedo usar sh_run_command… no están disponibles aquí"*, y el chat no
muestra ningún control de conectores. El MCP venía del trial de **Business**.

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

**El signo del dólar se convierte en fórmula.** El chat interpreta `$…$` como matemáticas, así
que un `$_.MainWindowTitle` vuelve como `𝑀 𝑎 𝑖 𝑛 𝑊 𝑖 𝑛 𝑑 𝑜 𝑤 …` y el comando llega
inservible. Normalizar con NFKC **no** lo recupera: se han perdido los `$` y los `_`. Prohíbe el
dólar en el prompt y enseña la forma equivalente sin él (`Where-Object MainWindowTitle -ne ''`),
y descarta como corrupta cualquier orden con caracteres del bloque matemático (U+1D400–U+1D7FF).

**PowerShell con comillas dobles no sobrevive a `cmd /c`.** El comando llega partido y
PowerShell responde cosas como *"Los valores válidos son Text o XML"*. Detecta
`powershell … -Command …`, extrae el script y pásalo por `-EncodedCommand` (UTF-16LE en base64):
así da igual qué comillas use el modelo.

**No decidas por lista de palabras si la petición toca el PC.** Con una lista, *"revisa qué
pestañas tengo abiertas"* no entraba y el CLI ni lo intentaba. Deja que el modelo lo decida: dale
un solo prompt que también le permita contestar sin comando cuando no haga falta el equipo.

**Enséñale a AVERIGUAR, no una lista de comandos.** Si solo ve ejemplos de "abrir cosas",
responde `NO_SE` a todo lo demás. Diciéndole que PowerShell puede consultar cualquier cosa del
sistema (ventanas, procesos, disco, red, servicios) y que puede encadenar consultas, resuelve
peticiones que nunca estuvieron en ninguna lista.

**Los ejemplos del prompt se ejecutan.** El prompt viaja escrito dentro del propio hilo, así
que si tus ejemplos llevan la palabra clave (`EJECUTAR {...}`), el CLI los lee del chat y los
ejecuta como si fueran la petición: llegó a abrir el bloc de notas, el explorador, Chrome y un
vídeo, y a matar Spotify con `taskkill`, todo de una tacada. **Los ejemplos no pueden estar en
el formato ejecutable**: enseña la forma una vez y describe los comandos sin la palabra clave.
Como red, descarta las órdenes con huecos (`<programa>`, `COMANDO`) y las que cuelgan de una
línea de guía (`->`).

**No leas la última respuesta del hilo, lee LA TUYA.** Si te anclas al botón "Copy response"
sin comprobar dónde está, cuando tu respuesta aún no ha llegado te quedas con el turno
anterior — y vuelves a ejecutar sus órdenes. Compara la posición en el DOM
(`compareDocumentPosition` contra el nodo que lleva tu `[reqId:…]`), nunca por texto: el
`innerText` del contenedor no coincide carácter a carácter con el del `body` y descartarías
también las respuestas buenas.

**Antes de abrir algo, mira si ya está abierto.** Reabrir lo que ya corría era lo que hacía
repetir el intento una y otra vez. Un `Get-Process` previo contesta en el acto, y para "traer
al frente" el comando es `AppActivate`, no un segundo `start`.

**Sin cupo NO siempre desaparece el campo de escritura.** Notion te deja escribir y sólo
**deshabilita el botón de enviar**, con el aviso arriba del todo: *"You've run out of free AI
responses"*. Si sólo compruebas que existe el composer, el texto se queda escrito, se repulsa
en bucle y **la petición nunca llega a publicarse** — que es justo como lo ve el usuario. La
señal fiable es el botón: `disabled` o `aria-disabled="true"` → sin cupo → rota ya.

**El programa abierto casi nunca se llama como el comando.** `calc` levanta `CalculatorApp`,
así que buscar un proceso con el nombre del comando da falsos "no abrió". Comprueba si el
comando **existe** (PATH + `App Paths` del registro) antes de darlo por fallido; sólo cuando
de verdad no existe (caso de Spotify) hay que buscar el ejecutable y reintentar con su ruta.
Ese respaldo aporta el *cómo*, nunca decide el *qué*.

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
