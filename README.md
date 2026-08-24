# Notion AI Reverse Proxy & Account Rotation Pool

Un servidor proxy de ingeniería inversa para la API de Notion AI compatible con el formato OpenAI `/v1/chat/completions`, que permite utilizar modelos como **Kimi K3**, **Claude 3.5 Sonnet / Opus**, y **GPT-4o** con capacidades extendidas mediante cuentas efímeras y rotación de tokens.

## 🚀 Características

- **Servidor OpenAI Compatible**: Endpoint `/v1/chat/completions` (HTTP & Server-Sent Events SSE streaming).
- **Soporte de Modelos**: Acceso a Kimi K3, Claude 3.5 Sonnet, GPT-4o a través de Notion AI Threads.
- **Mecanismo de Threads Efímeros**: Creación y descarte automático de hilos para maximizar el uso de créditos y mantener contextos limpios.
- **Automatización de Cuentas**:
  - `outlook-creator.mjs`: Creación automatizada de cuentas de correo `@outlook.com` con soporte para proxies HTTP/SOCKS5.
  - `notion-authenticator.mjs`: Registro automático en Notion y autenticación vía OTP.
  - `pool-daemon.mjs`: Daemon de aprovisionamiento continuo y rotación programada.

## 📦 Instalación

```bash
# Instalar dependencias de Node.js
pnpm install
npx playwright install chromium

# Instalar dependencias de Python (si se usa el servidor FastAPI/Flask)
pip install flask requests fastapi uvicorn
```

## ⚙️ Configuración

1. Copia el archivo de ejemplo de tokens:
```bash
cp tokens.example.json tokens.json
```
2. Añade tus credenciales de Notion (`token_v2`, `space_id`, `user_id`).

## 🛠️ Uso

### Iniciar Servidor Proxy (OpenAI Compatible)
```bash
python3 notion_openai_server.py
```
Por defecto escucha en `http://localhost:8000`.

### Iniciar Daemon de Aprovisionamiento y Rotación
```bash
INTERVAL_MINS=10 node pool-daemon.mjs
```

## 📄 Licencia
MIT
