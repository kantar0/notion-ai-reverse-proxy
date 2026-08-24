# MCP local para tu PC — Desktop power edition

MCP compatible con Notion para trabajar sobre tu PC Windows. La publicación externa es **100% Tailscale Funnel** con URL estática. El túnel anterior de URL cambiante se eliminó el 2026-08-21 por causar desconexiones periódicas.

## Carpeta permitida

Por defecto queda limitada a:

```text
C:\Users\nesti
```

## Qué puede hacer

- listar archivos y carpetas
- buscar archivos por nombre
- leer archivos de texto
- escribir o anexar texto
- crear carpetas
- mover o renombrar archivos y carpetas
- borrar archivos o carpetas
- ejecutar comandos dentro de rutas permitidas
- abrir archivos y carpetas con la app por defecto

## Transporte y auth

- endpoint MCP remoto: `/mcp`
- discovery: `/.well-known/mcp.json`
- autenticación: `Bearer token`

## Endpoint local (fijo)

- MCP local: `http://127.0.0.1:3337/mcp`
- Health: `http://127.0.0.1:3337/health`

El endpoint local NO cambia nunca.

## URL pública estática (Tailscale Funnel)

- URL pública fija: `https://desktop-qcbs0te.tail3cea3.ts.net`
- El Funnel publica `http://127.0.0.1:3337` hacia internet por el puerto 443 de Tailscale.
- Comando para asegurarlo manualmente:

```bat
"C:\Program Files\Tailscale\tailscale.exe" funnel --bg 3337
```

- El watchdog (`mcp-watchdog.ps1`, con inicio automático en Windows) revisa `/health` cada 2 segundos y el Funnel cada 30 segundos, y reinicia lo que falle. Se instala con `install-watchdog.ps1`.

## Uso

1. Ejecuta `install-and-run.bat` (instala dependencias, levanta el servidor y asegura el Funnel)
2. En Notion usa:
   - URL: `https://desktop-qcbs0te.tail3cea3.ts.net` (la URL base, sin `/mcp`)
   - Auth: `Bearer token`
   - Token: el valor de `bearerToken` en `config.json`

## Manejo de 429 / fallos de red (retry/backoff)

Los scripts de prueba reintentan con exponential backoff + jitter y respetan `Retry-After`:

- `test-tunnel-auth.bat`
- `test-mcp-init-tunnel.bat`

Ambos aceptan Enter para usar directamente la URL fija de Tailscale.

## Seguridad

- todo queda limitado a `C:\Users\nesti`
- el token es obligatorio: no imprimirlo ni pegarlo en documentos
- el log queda en `mcp-diagnostic.log`
- las acciones destructivas deben revisarse con cuidado

## Scripts útiles

- `install-and-run.bat`
- `test-local-auth.bat`
- `test-tunnel-auth.bat`
- `test-mcp-init-local.bat`
- `test-mcp-init-tunnel.bat`
- `open-diagnostic-log.bat`
- `mcp-watchdog.ps1` / `install-watchdog.ps1`

## Nota histórica

El túnel de URL cambiante que se usaba antes fue retirado por completo el 2026-08-21. Sus archivos quedaron fuera de este proyecto en `C:\Users\nesti\cloudflare-residuos-mcp-20260821` por si se necesita consultarlos; ya no son necesarios para operar.
