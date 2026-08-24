# Flujo de trabajo: terminal + Notion AI + MCP de escritorio

Esta guía resume cómo usar las piezas de este repositorio dentro de un flujo práctico.

## Objetivo

Tener un terminal o cliente asistido que pueda:
1. enviar solicitudes a Notion AI
2. recibir respuestas en un formato útil para automatización
3. invocar herramientas MCP para trabajar sobre el escritorio o el sistema local

---

## Componentes

### Reverse proxy de Notion AI
Convierte Notion AI en una interfaz tipo OpenAI para que un terminal, script o cliente pueda hablar con él usando endpoints familiares.

### MCP de escritorio
El proyecto en `integrations/mcp-pc-control/` publica herramientas para operar sobre el PC Windows dentro de rutas permitidas.

### Router local de Shosso
Si tu flujo genera spawns o usa varias cuentas/salidas, el router local sirve para repartir mejor la carga y reducir desperdicio de tokens.

---

## Escenario típico

1. **Levantas el reverse proxy** de Notion AI.
2. **Levantas el MCP de escritorio** con un bearer token y `allowedRoots` definidos.
3. **Abres tu terminal o cliente asistido**.
4. El terminal manda una solicitud a Notion AI.
5. Cuando la tarea requiere tocar archivos, ejecutar comandos o abrir rutas, Notion AI usa las herramientas MCP del escritorio.
6. El resultado vuelve al terminal como texto claro o salida estructurada.

---

## Cómo iniciar el MCP de escritorio

Desde `integrations/mcp-pc-control/`:

```bash
npm install
node server.mjs
```

O usando los scripts incluidos en ese mismo proyecto cuando trabajes en Windows.

Configura siempre:
- `bearerToken` fuerte
- `allowedRoots` restringidos
- `config.json` local, nunca comiteado con secretos reales

---

## Cómo usarlo desde un terminal

Hay varias formas válidas:

### Opción 1 — terminal que hable con el proxy OpenAI-compatible
Configura tu terminal/cliente con:
- base URL del proxy
- model id soportado
- API key ficticia si el cliente la exige

### Opción 2 — terminal que opere sobre la UI/web de Notion AI
Si tu terminal ya automatiza la sesión real de Notion AI, el MCP de escritorio entra como capa de herramientas para tocar el PC mientras la conversación sigue ocurriendo en Notion.

### Opción 3 — flujo híbrido
Usa el proxy para automatización y el terminal UI para depuración, inspección o trabajo manual sobre el mismo sistema.

---

## Buenas prácticas

- Mantén el MCP con alcance mínimo necesario.
- No subas tokens ni config real al repo.
- Usa archivos de ejemplo para compartir instalación.
- Separa claramente:
  - credenciales
  - scripts operativos
  - documentación
  - código del proxy
  - código del MCP

---

## Resultado esperado

Al combinar estas piezas, otra persona puede replicar un flujo donde:
- Notion AI sirve como backend o como cerebro de la conversación
- el terminal actúa como interfaz operativa
- el MCP aporta acceso útil y controlado al escritorio

Eso convierte el sistema en algo más cercano a un entorno de trabajo asistido que a un simple chat aislado.
