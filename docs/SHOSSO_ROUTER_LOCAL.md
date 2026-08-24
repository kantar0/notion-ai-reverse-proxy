# Shosso Router Local

Esta nota documenta el comportamiento del router local usado por Shosso para repartir trabajo entre distintas salidas disponibles con una política enfocada en **bajo consumo** y **menos desperdicio de contexto**.

## Qué hace

- elige la key o salida de Codex con menor uso estimado antes de cada spawn
- usa round-robin como desempate para evitar desbalance entre cuentas o claves
- registra telemetría local en `~/.bridgemind/shosso-router-usage.json`
- pasa variables de entorno frugales a los agentes, por ejemplo límites de lectura y salida
- reduce el contexto del supervisor para no reenviar scrollback innecesario
- mantiene cooldown / backoff cuando una key recibe `401`, `402` o `429`

## Qué no hace

- no elimina límites reales de OpenAI, Codex, Groq ni de ningún proveedor
- no evade billing, autenticación, cuotas ni rate limits
- no imprime ni guarda API keys completas en la telemetría; usa hashes cortos

## Ideas de diseño reflejadas

- **LiteLLM** para routing, fallback, budgets y load balancing
- **LLMLingua / LongLLMLingua** para compresión de prompt y contexto
- **GPTCache** para cache semántico y reducción de llamadas repetidas

## Configuración

La configuración editable vive en:

```text
~/.bridgemind/shosso-router.config.json
```

## Cuándo encaja en este repo

Este router es útil cuando el flujo no solo usa el reverse proxy de Notion AI, sino también:
- terminales asistidos
- spawns de CLIs adicionales
- cuentas o claves que conviene repartir con más cuidado

No sustituye al reverse proxy ni al MCP: actúa como capa de operación para hacer el flujo más eficiente.
