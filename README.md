# Notion AI Reverse Proxy + Desktop MCP Workflow

Este repositorio reúne dos piezas que encajan bien para trabajar con Notion AI desde un flujo práctico de escritorio:

1. **Reverse proxy de Notion AI** con interfaz compatible con OpenAI.
2. **Servidor MCP para control del PC** limitado a rutas permitidas y pensado para usarse desde Notion AI o desde un terminal asistido.

Además incluye notas del **router local de Shosso** para operar con menor consumo de tokens y una guía de uso para que otra persona pueda entender rápidamente cómo usar el terminal y el MCP juntos.

---

## Qué contiene

### 1) Reverse proxy de Notion AI
Permite exponer Notion AI como una API estilo OpenAI (`/v1/chat/completions`) para usarlo desde scripts, terminales, herramientas locales o clientes que esperan ese formato.

Casos de uso típicos:
- probar prompts desde terminal
- conectar clientes compatibles con OpenAI
- automatizar hilos de Notion AI
- experimentar con rotación de cuentas o threads

Archivos principales:
- `notion_openai_server.py`
- `notion_proxy.py`
- `notion-ai-client.mjs`
- `NOTION_AI_PROXY_GUIDE.md`
- `notion-ai-architecture-analysis.md`

### 2) Integración MCP para control del PC
Se añadió una copia utilizable del proyecto de control de escritorio en:

- `integrations/mcp-pc-control/`

Ese MCP expone herramientas para:
- listar archivos y carpetas
- buscar archivos
- leer y escribir texto
- crear carpetas
- mover o renombrar rutas
- borrar rutas
- ejecutar comandos
- abrir archivos y carpetas con la app por defecto
- comprobar salud básica de URLs, puertos y procesos
- iniciar comandos ocultos en segundo plano

Está pensado para trabajar sobre Windows con un alcance restringido por `allowedRoots`.

### 3) Router local de Shosso
Se documenta el comportamiento del router local en:

- `docs/SHOSSO_ROUTER_LOCAL.md`

Resume cómo se reparten spawns entre cuentas / claves disponibles con una política de bajo consumo, sin prometer eliminar límites reales del proveedor.

### 4) Guía de terminal + MCP
Se añadió una guía práctica en:

- `docs/TERMINAL_AND_MCP_WORKFLOW.md`

Explica cómo usar el reverse proxy, el MCP y un terminal asistido dentro del mismo flujo de trabajo.

---

## Estructura recomendada de uso

### Opción A — usar Notion AI como API local
1. Configura tus credenciales/tokens.
2. Inicia el servidor del proxy.
3. Conecta un cliente compatible con OpenAI contra la base URL local.

### Opción B — usar Notion AI con control del PC vía MCP
1. Levanta el MCP de escritorio desde `integrations/mcp-pc-control/`.
2. Configura el endpoint y el bearer token en tu cliente MCP.
3. Usa Notion AI o un terminal asistido para invocar herramientas del PC.

### Opción C — combinar todo
1. El terminal envía solicitudes a Notion AI.
2. Notion AI usa el MCP del escritorio para inspeccionar o modificar el sistema.
3. El router local ayuda a mantener el costo bajo cuando el flujo involucra spawns o CLIs adicionales.

---

## Documentación incluida

- `NOTION_AI_PROXY_GUIDE.md` → guía extensa del proxy y del modelo de hilos
- `notion-ai-architecture-analysis.md` → análisis del flujo interno de Notion AI
- `docs/SHOSSO_ROUTER_LOCAL.md` → nota del router local de Shosso
- `docs/TERMINAL_AND_MCP_WORKFLOW.md` → cómo usar terminal + MCP juntos
- `integrations/mcp-pc-control/README.md` → guía específica del servidor MCP de escritorio

---

## Notas de seguridad

### Reverse proxy
- protege y rota credenciales con cuidado
- no publiques tokens reales en el repo
- usa archivos de ejemplo para configuración compartible

### MCP de escritorio
- limita siempre `allowedRoots`
- usa un bearer token fuerte
- revisa bien las herramientas destructivas antes de habilitarlas para terceros
- no subas `config.json` con secretos reales

---

## Estado de esta integración

Esta versión del repo ya deja documentado un flujo completo para:
- trabajar con Notion AI por API
- conectar control de escritorio por MCP
- operar desde terminal con una arquitectura más clara y replicable

Si quieres extenderlo, el siguiente paso natural es añadir ejemplos concretos de cliente (curl, Python, Node, Claude/Codex/Shosso) apuntando al proxy y al MCP al mismo tiempo.

---

## Guías nuevas: despliegue estable y setup desde cero

Estas tres guías están escritas para que cualquier persona (o cualquier IA) monte
el stack en **su propia máquina, con sus propios datos**. No contienen tokens,
dominios, cuentas ni rutas de nadie: todo son placeholders del tipo
`<PROJECT_DIR>`, `<PORT>`, `<TOKEN>`, `<TUNNEL_DOMAIN>`.

- `docs/AI_AGENT_SETUP.md` → **empieza por aquí si eres una IA.** Checklist de
  despliegue paso a paso: qué valores pedirle al usuario, cómo generar el token,
  cómo verificar cada capa y qué reglas no romper nunca.
- `docs/MCP_TUNNEL_HARDENING.md` → cómo mantener un servidor MCP propio conectado
  a Notion de forma permanente. Explica los cuatro modos de fallo reales
  (watchdog que mata procesos sanos, VPN que rompe el health check por loopback,
  túnel que parece accesible pero no lo es, y sesiones MCP que no sobreviven a un
  reinicio) con la corrección de cada uno, más el supervisor de tres capas y cómo
  fijar la URL pública para no tener que reconectar nunca más.
- `docs/NOTION_AI_CLI_TERMINAL.md` → la terminal de Notion AI: arquitectura
  (cliente ligero + daemon puente + cliente de Notion por CDP), formato de
  `cli-accounts.json` y `cli-state.json`, arranque del stack, todos los comandos
  disponibles, el subcomando de diagnóstico del MCP y una tabla de
  troubleshooting con los errores que aparecen de verdad.

### Requisito que bloquea todo el CLI

La cuenta de Notion que use el CLI **necesita Notion AI habilitado en el
workspace seleccionado**. Si no lo tiene, el composer nunca devuelve respuesta y
todas las peticiones expiran sin error útil. Compruébalo a mano en la UI antes de
configurar nada.

### Regla de oro del watchdog

No mates nunca un proceso que está vivo. Reinicia solo con evidencia dura de
muerte: fallo continuado del health check durante un periodo de gracia largo,
**más** un connect TCP fallido, **más** cero conexiones establecidas. Y jamás
mates procesos de túnel por nombre de imagen: te llevas por delante el que está
sirviendo el tráfico y, sin dominio reservado, la URL pública cambia y todos los
clientes rompen.
