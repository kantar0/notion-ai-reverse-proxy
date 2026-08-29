# Notion AI CLI — control de PC y rotación de cupo

Terminal que usa **Notion AI** como motor y **tu PC** como manos: pregunta desde una
consola, Notion razona y las herramientas del sistema de archivos las ejecuta el CLI.

Incluye rotación automática entre workspaces y cuentas para no quedarse sin cupo, y un
motor de navegador invisible que habla con Notion por CDP.

> **Lee antes [`docs/NOTION_MCP_BLOQUEO_Y_PUENTE.md`](../docs/NOTION_MCP_BLOQUEO_Y_PUENTE.md)**:
> explica por qué las herramientas NO se llaman por el MCP de Notion y cómo se resolvió.

---

## Cómo funciona, en corto

```
  terminal-client.mjs  ──►  notion-ai-cli.mjs (daemon)  ──►  Edge invisible (CDP 9223)  ──►  Notion AI
                                     │
                                     └──►  mcp-local.mjs  ──►  tu servidor MCP  ──►  tu PC
```

1. Escribes en la terminal; el daemon deja la petición en `bridge-requests/`.
2. El daemon abre el chat de Notion en un Edge oculto y escribe el prompt.
3. Si hace falta el PC, **el CLI ejecuta la herramienta** y le pasa el resultado a Notion.
4. Notion redacta la respuesta y la terminal la muestra.

## Puesta en marcha

```bash
cp mcp-server.example.json mcp-server.json     # pon la URL y el token de TU servidor MCP
powershell -ExecutionPolicy Bypass -File start-notion-cdp.ps1
node notion-ai-cli.mjs --daemon &
node terminal-client.mjs
```

Necesitas una sesión de Notion iniciada; el CLI la toma del navegador y la guarda en
`account-sessions/` (ignorado por git: son **credenciales**).

## Piezas

| archivo | qué hace |
|---|---|
| `notion-ai-cli.mjs` | daemon: prompt, detección de respuesta, rotación, puente de herramientas |
| `terminal-client.mjs` | la consola (comandos `/cuentas`, `/pool`, `/nueva-cuenta`…) |
| `mcp-local.mjs` | **el puente**: habla con el servidor MCP por HTTP, sin pasar por Notion |
| `pool-maintain.mjs` | mide el cupo de cada workspace, crea los que falten y registra |
| `space-ensure.mjs` / `space-bulk.mjs` | crear workspaces del plan Free (uno / en lote) |
| `engine-health.mjs` | comprueba que el motor acepta conexiones y lo reinicia si no |
| `tabs-clean.mjs` | cierra las pestañas sobrantes del motor (evita que Edge se coma la RAM) |
| `mcp-*.mjs` | alta del MCP en workspaces (**sólo si desactivas el modo puente**) |

## Configuración (`cli-state.json`, se crea solo)

| clave | efecto |
|---|---|
| `mcpBridge` | `false` vuelve al modo antiguo (herramientas por el MCP de Notion). Por defecto el puente está activo. |
| `chatRoute` | ruta del chat detectada (`/chat` o `/ai`): Notion la cambia entre despliegues y el CLI la aprende sola. |
| `quotaExhausted` | workspaces medidos sin cupo, con el plan (`free`, `business-trial`, `ai-desactivada`). |
| `autoRotateAccounts` | rotación automática al agotarse el cupo. |

## Qué NO se publica

`mcp-server.json` (token), `account-sessions/` (cookies de Notion), `cli-accounts.json`,
`cli-state.json` y los perfiles del navegador. Están en `.gitignore`: son credenciales
con las que cualquiera entraría a tus cuentas y a tu PC.
