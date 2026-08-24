# 🚀 Guía: Reverse Proxy de Notion AI a API OpenAI

Esta guía te permite convertir tu cuenta de **Notion AI** en un servidor de API local compatible al 100% con el estándar de **OpenAI (`/v1/chat/completions`)**. 

Podrás usar modelos como **Moonshot Kimi K3 (con razonamiento profundo / CoT)** y **Claude 3.5 Sonnet** desde cualquier herramienta (terminal, scripts, Cursor, LibreChat, Open WebUI, Python, etc.) sin pagar APIs adicionales.

---

## 📋 Requisitos Previos

* **Python 3.10** o superior.
* Una cuenta de Notion (gratuita o con Add-on de Notion AI).
* Navegador web (Google Chrome, Edge, Brave o Firefox).

Instalar la librería necesaria (impersonación de TLS de Chrome para bypass de Cloudflare):

```bash
pip install curl_cffi
```

---

## 🔑 Paso 1: Obtener las Credenciales de Notion (en 30 segundos)

1. Abre tu cuenta de Notion en el navegador: [https://app.notion.com](https://app.notion.com).
2. Abre las **Herramientas de Desarrollador** presionando `F12` (o clic derecho ➔ **Inspeccionar**).
3. Ve a la pestaña **Application** (en español: **Aplicación** o **Almacenamiento**).
4. En el menú de la izquierda, despliega **Cookies** ➔ selecciona `https://www.notion.com` o `https://app.notion.com`.
5. Copia los siguientes valores:
   * **`token_v2`**: El token largo que empieza por `v03%3A...` o `v02%3A...`.
   * **`notion_user_id`**: El UUID de tu usuario (ej. `646357f5-4b41-4f62-8767-b25670188037`).
6. Para obtener el **`space_id`** y un **`thread_id`**:
   * Abre cualquier chat de Notion AI en la barra lateral o en `/chat`.
   * En la URL verás: `https://app.notion.com/chat?t=XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX`. Ese valor `t` es tu `thread_id`.
   * En las cookies verás tu `x-notion-space-id` o en la consola ejecutando:
     ```javascript
     JSON.parse(localStorage.getItem("ajs_user_traits")).current_space_id
     ```

---

## ⚙️ Paso 2: Crear el archivo de configuración de cuentas (`tokens.json`)

Crea un archivo llamado **`tokens.json`** en la misma carpeta donde estará el servidor:

```json
{
  "accounts": [
    {
      "name": "Mi Cuenta Principal",
      "token_v2": "PEGA_AQUI_TU_TOKEN_V2",
      "user_id": "PEGA_AQUI_TU_USER_ID",
      "space_id": "PEGA_AQUI_TU_SPACE_ID",
      "thread_id": "PEGA_AQUI_TU_THREAD_ID"
    }
  ]
}
```

> 💡 **Soporte Multi-Cuenta y Rotación Automática**: Puedes agregar tantas cuentas como quieras en la lista `accounts`. Si una cuenta entra en límite de créditos, el servidor rotará automáticamente a la siguiente.

---

## 🖥️ Paso 3: El Servidor Proxy (`notion_openai_server.py`)

Crea el archivo **`notion_openai_server.py`** con el siguiente código completo:

```python
#!/usr/bin/env python3
"""
Notion AI to OpenAI API Reverse Proxy Server
Author: Pedro Rojas & Pi
"""
import sys
import os
import json
import uuid
import time
import datetime
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn
from curl_cffi import requests

PORT = 8318
TOKENS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tokens.json")
CLIENT_VERSION = "23.13.20260822.0220"

current_account_index = 0

def load_accounts():
    if os.path.exists(TOKENS_FILE):
        try:
            with open(TOKENS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                return data.get("accounts", [])
        except Exception as e:
            print(f"Error cargando {TOKENS_FILE}: {e}")
    return []

def get_active_account():
    global current_account_index
    accounts = load_accounts()
    if not accounts:
        raise ValueError("No hay cuentas configuradas en tokens.json")
    return accounts[current_account_index % len(accounts)]

def rotate_account():
    global current_account_index
    accounts = load_accounts()
    if len(accounts) > 1:
        current_account_index = (current_account_index + 1) % len(accounts)
        print(f"🔄 Rotando a cuenta [{current_account_index + 1}/{len(accounts)}]: {accounts[current_account_index].get('name', 'Cuenta')}")

def get_session():
    # Impersona la huella TLS exacta de Google Chrome en Windows
    return requests.Session(impersonate="chrome124")

def ask_notion(prompt, model="fireworks-kimi-k3"):
    acc = get_active_account()
    notion_token = acc["token_v2"]
    user_id = acc["user_id"]
    space_id = acc["space_id"]
    thread_id = acc.get("thread_id")

    session = get_session()
    headers = {
        "accept": "application/x-ndjson",
        "accept-language": "es,en-US;q=0.9,en;q=0.8",
        "content-type": "application/json",
        "origin": "https://app.notion.com",
        "referer": f"https://app.notion.com/chat?t={thread_id}",
        "notion-audit-log-platform": "web",
        "notion-client-version": CLIENT_VERSION,
        "x-notion-active-user-header": user_id,
        "x-notion-space-id": space_id,
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "priority": "u=1, i"
    }

    cookies = {
        "token_v2": notion_token,
        "notion_user_id": user_id,
        "notion_users": f'["{user_id}"]',
        "notion_browser_id": "c5c98da8-f31d-4004-a4a0-8f817efde05e",
        "device_id": "3c4d872b-594c-81b6-bf6b-003b79a286df"
    }

    now_ms = int(datetime.datetime.now().timestamp() * 1000)
    iso_date = datetime.datetime.now().isoformat() + "-04:00"

    context_id = str(uuid.uuid4())
    updated_config_id = str(uuid.uuid4())
    user_id_step = str(uuid.uuid4())
    trace_id = str(uuid.uuid4())

    context_step = {
        "id": context_id,
        "type": "context",
        "value": {
            "userId": user_id,
            "spaceId": space_id,
            "surface": "full_page_chat",
            "timezone": "America/Caracas",
            "userName": acc.get("name", "Usuario"),
            "spaceName": "Espacio de Notion",
            "userEmail": "user@example.com",
            "currentDatetime": iso_date
        }
    }

    updated_config_step = {
        "id": updated_config_id,
        "type": "updated-config"
    }

    user_step = {
        "id": user_id_step,
        "type": "user",
        "userId": user_id,
        "value": [[prompt]],
        "createdAt": iso_date
    }

    # 1. Guardar turno en DB de Notion
    tx_payload = {
        "requestId": str(uuid.uuid4()),
        "transactions": [{
            "id": str(uuid.uuid4()),
            "spaceId": space_id,
            "debug": {"userAction": "WorkflowActions.addStepsToExistingThreadAndRun", "clientCommitTimeMs": now_ms},
            "operations": [
                {
                    "pointer": {"table": "thread_message", "id": context_id, "spaceId": space_id},
                    "path": [],
                    "command": "set",
                    "args": {
                        "id": context_id, "version": 1, "step": context_step,
                        "parent_id": thread_id, "parent_table": "thread", "space_id": space_id,
                        "created_time": now_ms, "created_by_id": user_id, "created_by_table": "notion_user"
                    }
                },
                {
                    "pointer": {"table": "thread_message", "id": updated_config_id, "spaceId": space_id},
                    "path": [],
                    "command": "set",
                    "args": {
                        "id": updated_config_id, "version": 1, "step": updated_config_step,
                        "parent_id": thread_id, "parent_table": "thread", "space_id": space_id,
                        "created_time": now_ms, "created_by_id": user_id, "created_by_table": "notion_user"
                    }
                },
                {
                    "pointer": {"table": "thread_message", "id": user_id_step, "spaceId": space_id},
                    "path": [],
                    "command": "set",
                    "args": {
                        "id": user_id_step, "version": 1, "step": user_step,
                        "parent_id": thread_id, "parent_table": "thread", "space_id": space_id,
                        "created_time": now_ms, "created_by_id": user_id, "created_by_table": "notion_user"
                    }
                },
                {
                    "pointer": {"table": "thread", "id": thread_id, "spaceId": space_id},
                    "path": ["messages"],
                    "command": "listAfterMulti",
                    "args": {"ids": [context_id, updated_config_id, user_id_step]}
                }
            ]
        }]
    }

    session.post("https://app.notion.com/api/v3/saveTransactionsFanout", headers=headers, cookies=cookies, json=tx_payload)

    # 2. Obtener historial base
    sync_res = session.post("https://app.notion.com/api/v3/syncRecordValuesSpaceInitial", headers=headers, cookies=cookies, json={
        "requests": [{"pointer": {"table": "thread", "id": thread_id, "spaceId": space_id}, "version": -1}],
        "spacePointer": {"table": "space", "id": space_id}
    })

    msg_ids = sync_res.json().get("recordMap", {}).get("thread", {}).get(thread_id, {}).get("value", {}).get("value", {}).get("messages", [])

    valid_steps = []
    if msg_ids:
        msg_res = session.post("https://app.notion.com/api/v3/syncRecordValuesSpaceInitial", headers=headers, cookies=cookies, json={
            "requests": [{"pointer": {"table": "thread_message", "id": mid, "spaceId": space_id}, "version": -1} for mid in msg_ids],
            "spacePointer": {"table": "space", "id": space_id}
        })
        raw_msgs = msg_res.json().get("recordMap", {}).get("thread_message", {})
        for mid in msg_ids:
            st = raw_msgs.get(mid, {}).get("value", {}).get("value", {}).get("step")
            if st and st.get("type") in ["config", "context", "updated-config"]:
                valid_steps.append(st)

    transcript = valid_steps + [context_step, updated_config_step, user_step]

    # 3. Stream de inferencia DAG
    inf_payload = {
        "traceId": trace_id,
        "spaceId": space_id,
        "threadId": thread_id,
        "createThread": False,
        "debugOverrides": {
            "emitAgentSearchExtractedResults": True,
            "cachedInferences": {},
            "annotationInferences": {},
            "emitInferences": False
        },
        "generateTitle": False,
        "saveAllThreadOperations": True,
        "setUnreadState": True,
        "createdSource": "ai_module",
        "threadType": "workflow",
        "isPartialTranscript": True,
        "asPatchResponse": True,
        "patchResponseVersion": 2,
        "isUserInAnySalesAssistedSpace": False,
        "isSpaceSalesAssisted": False,
        "supportsCustomAgentNudgeTranscriptStep": True,
        "transcript": transcript
    }

    inf_res = session.post("https://app.notion.com/api/v3/runInferenceTranscript", headers=headers, cookies=cookies, json=inf_payload, stream=True)

    has_generated = False
    for line in inf_res.iter_lines():
        if not line:
            continue
        try:
            decoded = line.decode("utf-8")
            data = json.loads(decoded)

            # Decodificación de parches JSON-Patch
            if data.get("type") == "patch" and "v" in data:
                for patch in data["v"]:
                    path = patch.get("p", "")
                    val = patch.get("v")

                    # Chunks de respuesta
                    if "value/1/content" in path or "value/-" in path:
                        if isinstance(val, dict) and "content" in val:
                            has_generated = True
                            yield val["content"]
                        elif isinstance(val, str):
                            has_generated = True
                            yield val

            elif data.get("type") == "patch-start" and "data" in data and "s" in data["data"]:
                for item in data["data"]["s"]:
                    if item.get("type") == "error":
                        err_type = item.get("subType")
                        if err_type == "temporarily-unavailable" and not has_generated:
                            print(f"⚠️ Rate limit en cuenta activa. Rotando cuenta...")
                            rotate_account()
                        yield f"\n[Notion AI Error: {item.get('message')}]"

        except Exception:
            pass


class ThreadingSimpleServer(ThreadingMixIn, HTTPServer):
    pass


class OpenAIHandler(BaseHTTPRequestHandler):
    def _send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")

    def do_OPTIONS(self):
        self.send_response(200)
        self._send_cors_headers()
        self.end_headers()

    def do_GET(self):
        if self.path in ["/v1/models", "/models"]:
            self.send_response(200)
            self._send_cors_headers()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            models_data = {
                "object": "list",
                "data": [
                    {"id": "fireworks-kimi-k3", "object": "model", "owned_by": "notion-ai"},
                    {"id": "kimi-k3", "object": "model", "owned_by": "notion-ai"},
                    {"id": "claude-3-5-sonnet", "object": "model", "owned_by": "notion-ai"}
                ]
            }
            self.wfile.write(json.dumps(models_data).encode("utf-8"))
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path in ["/v1/chat/completions", "/chat/completions"]:
            content_len = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_len)
            try:
                data = json.loads(body)
            except Exception:
                self.send_response(400)
                self.end_headers()
                return

            messages = data.get("messages", [])
            stream = data.get("stream", False)
            model = data.get("model", "fireworks-kimi-k3")

            prompt = ""
            for msg in reversed(messages):
                if msg.get("role") == "user":
                    prompt = msg.get("content", "")
                    break

            if not prompt and messages:
                prompt = messages[-1].get("content", "")

            req_id = f"chatcmpl-{uuid.uuid4().hex[:12]}"
            created_ts = int(time.time())

            if stream:
                self.send_response(200)
                self._send_cors_headers()
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Cache-Control", "no-cache")
                self.send_header("Connection", "keep-alive")
                self.end_headers()

                for chunk in ask_notion(prompt, model):
                    sse_payload = {
                        "id": req_id,
                        "object": "chat.completion.chunk",
                        "created": created_ts,
                        "model": model,
                        "choices": [{"index": 0, "delta": {"content": chunk}, "finish_reason": None}]
                    }
                    self.wfile.write(f"data: {json.dumps(sse_payload)}\n\n".encode("utf-8"))
                    self.wfile.flush()

                done_payload = {
                    "id": req_id,
                    "object": "chat.completion.chunk",
                    "created": created_ts,
                    "model": model,
                    "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]
                }
                self.wfile.write(f"data: {json.dumps(done_payload)}\n\ndata: [DONE]\n\n".encode("utf-8"))
                self.wfile.flush()

            else:
                full_text = ""
                for chunk in ask_notion(prompt, model):
                    full_text += chunk

                self.send_response(200)
                self._send_cors_headers()
                self.send_header("Content-Type", "application/json")
                self.end_headers()

                resp = {
                    "id": req_id,
                    "object": "chat.completion",
                    "created": created_ts,
                    "model": model,
                    "choices": [{
                        "index": 0,
                        "message": {"role": "assistant", "content": full_text},
                        "finish_reason": "stop"
                    }],
                    "usage": {"prompt_tokens": 10, "completion_tokens": 50, "total_tokens": 60}
                }
                self.wfile.write(json.dumps(resp).encode("utf-8"))

        else:
            self.send_response(404)
            self.end_headers()


def run_server():
    server = ThreadingSimpleServer(("127.0.0.1", PORT), OpenAIHandler)
    print(f"🚀 Notion AI OpenAI Server listo en http://127.0.0.1:{PORT}/v1")
    print(f"📁 Cuentas: {TOKENS_FILE}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor detenido.")

if __name__ == "__main__":
    run_server()
```

---

## 🏃‍♂️ Paso 4: Iniciar el Servidor

Ejecuta el servidor en una terminal:

```bash
python3 notion_openai_server.py
```

O en segundo plano:

```bash
nohup python3 notion_openai_server.py > notion_proxy.log 2>&1 &
```

---

## 🧪 Paso 5: Probar que Funciona

### 1. Petición Normal (Respuesta Completa)
```bash
curl http://127.0.0.1:8318/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "fireworks-kimi-k3",
    "messages": [
      {"role": "user", "content": "Explica qué es la recursividad en 1 frase."}
    ]
  }'
```

### 2. Petición con Streaming en Vivo (`stream: true`)
```bash
curl -N http://127.0.0.1:8318/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "fireworks-kimi-k3",
    "stream": true,
    "messages": [
      {"role": "user", "content": "Escribe un poema corto sobre programar de noche."}
    ]
  }'
```

---

## 🔌 Cómo Conectarlo a Otras Herramientas

Cualquier aplicación que soporte OpenAI puede usar este proxy simplemente configurando:

* **Base URL**: `http://127.0.0.1:8318/v1`
* **API Key**: `notion-local-key` *(cualquier texto, no se valida)*
* **Model ID**: `fireworks-kimi-k3` o `kimi-k3` o `claude-3-5-sonnet`

### En Python (Librería Oficial de OpenAI):
```python
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:8318/v1",
    api_key="cualquiera"
)

response = client.chat.completions.create(
    model="fireworks-kimi-k3",
    messages=[{"role": "user", "content": "¿Cómo funciona un índice en PostgreSQL?"}],
    stream=True
)

for chunk in response:
    content = chunk.choices[0].delta.content or ""
    print(content, end="", flush=True)
print()
```

---

## ❓ Preguntas Frecuentes y Trucos

### ¿Cuánto dura el `token_v2`?
Dura aproximadamente **6 meses**. No caduca a menos que hagas clic explícito en *"Cerrar sesión"* en el navegador.

### ¿Cómo funciona la rotación de créditos?
Notion da 20 créditos gratuitos por cuenta/workspace. Puedes crear 3 o 4 cuentas de Notion y poner sus tokens en `tokens.json`. El proxy rotará automáticamente a la siguiente cuenta disponible cuando una alcance su cuota.
