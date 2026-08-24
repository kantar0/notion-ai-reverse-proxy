#!/usr/bin/env python3
"""
Notion AI to OpenAI API Advanced Reverse Proxy
- Ephemeral Threads (Zero chat clutter, automatic purge)
- Multi-Workspace & Multi-Account Support (20 credits per workspace)
- Tool Calling & System Prompt injection (Read, Write, MCP emulation)
- OpenAI Compatible (/v1/chat/completions, /v1/models)
- Real-time SSE Streaming
Author: Pedro Rojas & Pi
"""
import sys
import os
import json
import uuid
import time
import datetime
import re
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn
from curl_cffi import requests

PORT = 8318
TOKENS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tokens.json")
CLIENT_VERSION = "23.13.20260822.0220"

current_account_index = 0
current_space_index = 0

def load_accounts():
    if os.path.exists(TOKENS_FILE):
        try:
            with open(TOKENS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                return data.get("accounts", [])
        except Exception as e:
            print(f"Error cargando {TOKENS_FILE}: {e}")
    return []

def get_active_credentials():
    global current_account_index, current_space_index
    accounts = load_accounts()
    if not accounts:
        raise ValueError("No hay cuentas configuradas en tokens.json")
    
    acc = accounts[current_account_index % len(accounts)]
    spaces = acc.get("spaces")
    if spaces and isinstance(spaces, list) and len(spaces) > 0:
        active_space = spaces[current_space_index % len(spaces)]
        space_id = active_space.get("id") if isinstance(active_space, dict) else active_space
    else:
        space_id = acc.get("space_id")
        
    return {
        "account": acc,
        "token_v2": acc.get("token_v2"),
        "user_id": acc.get("user_id"),
        "space_id": space_id,
        "name": acc.get("name", "User"),
        "email": acc.get("email", "user@example.com")
    }

def rotate_workspace_or_account():
    global current_account_index, current_space_index
    accounts = load_accounts()
    if not accounts:
        return
    acc = accounts[current_account_index % len(accounts)]
    spaces = acc.get("spaces", [])
    
    # Si la cuenta actual tiene más workspaces, rotar de workspace
    if len(spaces) > 1 and current_space_index < len(spaces) - 1:
        current_space_index += 1
        print(f"🔄 Rotando a Workspace [{current_space_index + 1}/{len(spaces)}] de la cuenta actual.")
    else:
        # Rotar a la siguiente cuenta y reiniciar índice de workspace
        current_space_index = 0
        if len(accounts) > 1:
            current_account_index = (current_account_index + 1) % len(accounts)
            print(f"🔄 Rotando a Cuenta [{current_account_index + 1}/{len(accounts)}]: {accounts[current_account_index].get('name')}")

def extract_text(content):
    if isinstance(content, str):
        return content
    elif isinstance(content, list):
        text_parts = []
        for part in content:
            if isinstance(part, dict) and "text" in part:
                text_parts.append(part["text"])
            elif isinstance(part, str):
                text_parts.append(part)
        return "\n".join(text_parts)
    return str(content or "")

def format_tools_system_prompt(tools):
    if not tools:
        return ""
    prompt = "\n\n# AVAILABLE TOOLS / FUNCTION CALLING\nYou have access to the following tools:\n"
    for tool in tools:
        if isinstance(tool, dict) and tool.get("type") == "function":
            fn = tool.get("function", {})
            prompt += f"\n- Tool: `{fn.get('name')}`\n  Description: {fn.get('description', '')}\n  Parameters: {json.dumps(fn.get('parameters', {}))}\n"
    
    prompt += "\n## CRITICAL TOOL CALLING INSTRUCTIONS:\n"
    prompt += "If you need to call one or more tools, you MUST format your response strictly using this XML block format:\n"
    prompt += "<tool_call>\n{\"name\": \"tool_name\", \"arguments\": {\"param1\": \"value1\"}}\n</tool_call>\n"
    prompt += "Do not add markdown backticks around the json inside the <tool_call> tags. If you do not need tools, respond normally.\n"
    return prompt

def get_session():
    return requests.Session(impersonate="chrome124")

def ask_notion(messages, model="fireworks-kimi-k3", tools=None, stream=False):
    creds = get_active_credentials()
    notion_token = creds["token_v2"]
    user_id = creds["user_id"]
    space_id = creds["space_id"]

    session = get_session()
    
    # Crear un Thread efímero (UUID nuevo por solicitud)
    ephemeral_thread_id = str(uuid.uuid4())

    headers = {
        "accept": "application/x-ndjson",
        "accept-language": "es,en-US;q=0.9,en;q=0.8",
        "content-type": "application/json",
        "origin": "https://app.notion.com",
        "referer": f"https://app.notion.com/chat?t={ephemeral_thread_id}",
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
        "notion_browser_id": str(uuid.uuid4()),
        "device_id": str(uuid.uuid4())
    }

    now_ms = int(datetime.datetime.now().timestamp() * 1000)
    iso_date = datetime.datetime.now().isoformat() + "-04:00"

    # Procesar System Prompt y Formateo de Mensajes
    system_prompts = []
    conversation_text = []

    for msg in messages:
        role = msg.get("role")
        content = extract_text(msg.get("content", ""))
        if role == "system":
            system_prompts.append(content)
        elif role == "user":
            conversation_text.append(f"User: {content}")
        elif role == "assistant":
            conversation_text.append(f"Assistant: {content}")
        elif role == "tool":
            conversation_text.append(f"Tool Output ({msg.get('name', 'tool')}): {content}")

    full_system = "\n\n".join(system_prompts)
    if tools:
        full_system += format_tools_system_prompt(tools)

    if full_system:
        final_prompt = f"[System Instructions]\n{full_system}\n\n[Conversation]\n" + "\n\n".join(conversation_text)
    else:
        final_prompt = "\n\n".join(conversation_text)

    # Identificadores de pasos de Notion
    config_id = str(uuid.uuid4())
    context_id = str(uuid.uuid4())
    user_id_step = str(uuid.uuid4())
    trace_id = str(uuid.uuid4())

    config_step = {
        "id": config_id,
        "type": "config",
        "value": {
            "type": "workflow",
            "model": model,
            "reasoningEffort": "max",
            "modelFromUser": True,
            "useWebSearch": True,
            "enableMarkdownVNext": True
        }
    }

    context_step = {
        "id": context_id,
        "type": "context",
        "value": {
            "userId": user_id,
            "spaceId": space_id,
            "surface": "full_page_chat",
            "timezone": "America/Caracas",
            "userName": creds.get("name", "Pedro"),
            "spaceName": f"Espacio de {creds.get('name', 'Pedro')}",
            "userEmail": creds.get("email", "user@example.com"),
            "currentDatetime": iso_date
        }
    }

    user_step = {
        "id": user_id_step,
        "type": "user",
        "userId": user_id,
        "value": [[final_prompt]],
        "createdAt": iso_date
    }

    # 1. Crear hilo efímero en DB de Notion
    tx_payload = {
        "requestId": str(uuid.uuid4()),
        "transactions": [{
            "id": str(uuid.uuid4()),
            "spaceId": space_id,
            "debug": {"userAction": "WorkflowActions.createNewThread", "clientCommitTimeMs": now_ms},
            "operations": [
                {
                    "pointer": {"table": "thread", "id": ephemeral_thread_id, "spaceId": space_id},
                    "path": [],
                    "command": "set",
                    "args": {
                        "id": ephemeral_thread_id, "version": 1, "parent_id": space_id, "parent_table": "space",
                        "space_id": space_id, "alive": True, "type": "workflow", "created_source": "ai_module",
                        "created_time": now_ms, "created_by_id": user_id, "created_by_table": "notion_user",
                        "updated_time": now_ms, "updated_by_id": user_id, "updated_by_table": "notion_user",
                        "messages": [config_id, context_id, user_id_step]
                    }
                },
                {
                    "pointer": {"table": "thread_message", "id": config_id, "spaceId": space_id},
                    "path": [],
                    "command": "set",
                    "args": {
                        "id": config_id, "version": 1, "step": config_step,
                        "parent_id": ephemeral_thread_id, "parent_table": "thread", "space_id": space_id,
                        "created_time": now_ms, "created_by_id": user_id, "created_by_table": "notion_user"
                    }
                },
                {
                    "pointer": {"table": "thread_message", "id": context_id, "spaceId": space_id},
                    "path": [],
                    "command": "set",
                    "args": {
                        "id": context_id, "version": 1, "step": context_step,
                        "parent_id": ephemeral_thread_id, "parent_table": "thread", "space_id": space_id,
                        "created_time": now_ms, "created_by_id": user_id, "created_by_table": "notion_user"
                    }
                },
                {
                    "pointer": {"table": "thread_message", "id": user_id_step, "spaceId": space_id},
                    "path": [],
                    "command": "set",
                    "args": {
                        "id": user_id_step, "version": 1, "step": user_step,
                        "parent_id": ephemeral_thread_id, "parent_table": "thread", "space_id": space_id,
                        "created_time": now_ms, "created_by_id": user_id, "created_by_table": "notion_user"
                    }
                }
            ]
        }]
    }

    try:
        session.post("https://app.notion.com/api/v3/saveTransactionsFanout", headers=headers, cookies=cookies, json=tx_payload)
    except Exception as e:
        print(f"Error guardando transacciones: {e}")

    # 2. Ejecutar inferencia
    inf_payload = {
        "traceId": trace_id,
        "spaceId": space_id,
        "threadId": ephemeral_thread_id,
        "createThread": True,
        "debugOverrides": {
            "emitAgentSearchExtractedResults": True,
            "cachedInferences": {},
            "annotationInferences": {},
            "emitInferences": False
        },
        "generateTitle": False,
        "saveAllThreadOperations": True,
        "setUnreadState": False,
        "createdSource": "ai_module",
        "threadType": "workflow",
        "isPartialTranscript": False,
        "asPatchResponse": True,
        "patchResponseVersion": 2,
        "isUserInAnySalesAssistedSpace": False,
        "isSpaceSalesAssisted": False,
        "supportsCustomAgentNudgeTranscriptStep": True,
        "transcript": [config_step, context_step, user_step]
    }

    inf_res = session.post("https://app.notion.com/api/v3/runInferenceTranscript", headers=headers, cookies=cookies, json=inf_payload, stream=True)

    has_generated = False
    for line in inf_res.iter_lines():
        if not line:
            continue
        try:
            decoded = line.decode("utf-8")
            data = json.loads(decoded)

            # Extraer contenido de los parches JSON-Patch
            if data.get("type") == "patch" and "v" in data:
                for patch in data["v"]:
                    path = patch.get("p", "")
                    val = patch.get("v")

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
                            print(f"⚠️ Cuota alcanzada en workspace activo. Rotando...")
                            rotate_workspace_or_account()
                        yield f"\n[Notion AI: {item.get('message', 'Error')}]"

        except Exception:
            pass

    # 3. Purga automática de privacidad (Elimina el hilo al terminar la respuesta)
    delete_tx = {
        "requestId": str(uuid.uuid4()),
        "transactions": [{
            "id": str(uuid.uuid4()),
            "spaceId": space_id,
            "debug": {"userAction": "WorkflowActions.deleteThread"},
            "operations": [{
                "pointer": {"table": "thread", "id": ephemeral_thread_id, "spaceId": space_id},
                "path": ["alive"],
                "command": "set",
                "args": False
            }]
        }]
    }
    try:
        session.post("https://app.notion.com/api/v3/saveTransactionsFanout", headers=headers, cookies=cookies, json=delete_tx)
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
                    {"id": "claude-3-5-sonnet", "object": "model", "owned_by": "notion-ai"},
                    {"id": "gpt-4o", "object": "model", "owned_by": "notion-ai"}
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
            tools = data.get("tools", None)

            req_id = f"chatcmpl-{uuid.uuid4().hex[:12]}"
            created_ts = int(time.time())

            if stream:
                self.send_response(200)
                self._send_cors_headers()
                self.send_header("Content-Type", "text/event-stream")
                self.send_header("Cache-Control", "no-cache")
                self.send_header("Connection", "keep-alive")
                self.end_headers()

                full_output = ""
                for chunk in ask_notion(messages, model=model, tools=tools, stream=True):
                    full_output += chunk
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
                for chunk in ask_notion(messages, model=model, tools=tools, stream=False):
                    full_text += chunk

                # Parsear Tool Calls si existen en la respuesta
                tool_calls = []
                tool_pattern = r"<tool_call>\s*(\{.*?\})\s*</tool_call>"
                matches = re.findall(tool_pattern, full_text, re.DOTALL)
                
                clean_content = full_text
                if matches:
                    clean_content = re.sub(tool_pattern, "", full_text, flags=re.DOTALL).strip()
                    for idx, match_json in enumerate(matches):
                        try:
                            parsed_tool = json.loads(match_json)
                            tool_calls.append({
                                "id": f"call_{uuid.uuid4().hex[:8]}",
                                "type": "function",
                                "function": {
                                    "name": parsed_tool.get("name"),
                                    "arguments": json.dumps(parsed_tool.get("arguments", {}))
                                }
                            })
                        except Exception:
                            pass

                self.send_response(200)
                self._send_cors_headers()
                self.send_header("Content-Type", "application/json")
                self.end_headers()

                message_payload = {"role": "assistant", "content": clean_content or None}
                if tool_calls:
                    message_payload["tool_calls"] = tool_calls

                resp = {
                    "id": req_id,
                    "object": "chat.completion",
                    "created": created_ts,
                    "model": model,
                    "choices": [{
                        "index": 0,
                        "message": message_payload,
                        "finish_reason": "tool_calls" if tool_calls else "stop"
                    }],
                    "usage": {
                        "prompt_tokens": len(str(messages)) // 4,
                        "completion_tokens": len(full_text) // 4,
                        "total_tokens": (len(str(messages)) + len(full_text)) // 4
                    }
                }
                self.wfile.write(json.dumps(resp, ensure_ascii=False).encode("utf-8"))

        else:
            self.send_response(404)
            self.end_headers()


def run_server():
    server = ThreadingSimpleServer(("127.0.0.1", PORT), OpenAIHandler)
    print(f"🚀 Notion AI Multi-Workspace & Ephemeral Server listo en http://127.0.0.1:{PORT}/v1")
    print(f"📁 Cuentas: {TOKENS_FILE}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor detenido.")

if __name__ == "__main__":
    run_server()
