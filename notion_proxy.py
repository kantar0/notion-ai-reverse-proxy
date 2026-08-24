#!/usr/bin/env python3
import sys
import json
import uuid
import datetime
from curl_cffi import requests

# ==============================================================================
# NOTION AI REVERSE PROXY CLIENT
# ==============================================================================
NOTION_TOKEN = "v03%3AeyJhbGciOiJkaXIiLCJraWQiOiJwcm9kdWN0aW9uOnRva2VuLXYzOjIwMjQtMTEtMDciLCJlbmMiOiJBMjU2Q0JDLUhTNTEyIn0..X_9P9HPA5B2Y7YmMNeATYg.EeuOzMDW95Ghkj52lsSfI2HkKXgtz1s8XLMENetGYzpi6zdqSFJIC0fcX-rYD9nDH2cz_jDdQzBTGKOkv5eRMQP2xph9KZdxuGeAGCKymay8oG_hDdO1_Sakj9wEXzdA7_D7Zoz9ZZHHT2uc-pHZFRMKCuECbtlvxKyffaCaHZxXszbZsUVv30Jl94BiytmH9Ik-kJqTV0_SR0NmMZVOnO_QjRVLuaiZn0AVpIVBnzKsoumMwVT8b3Tf7r8tuuAyGx-rxsHjn61K2ybKcY0qyZmiP2O4kI0_AaTDhFaIPL7PT-ohr48sMgmSwStS5QaXVMnHrjrOIKd8FMw0UXL39CVbTqn_N0Gu05-0gdiaxlM.8xXaK1QOxQWgjtpLh0oRBykty9xIch2z2EDwOiN4hus"
USER_ID = "646357f5-4b41-4f62-8767-b25670188037"
SPACE_ID = "20a1ea7f-3832-81fb-a0a2-0003aeeff04b"
THREAD_ID = "3c41ea7f-3832-80a0-884f-00a91c630a56"
CLIENT_VERSION = "23.13.20260822.0220"

prompt_text = sys.argv[1] if len(sys.argv) > 1 else "Explica qué es un webhook en 2 líneas."

# Códigos de color ANSI
class Colors:
    CYAN = "\033[36m"
    GREEN = "\033[32m"
    MAGENTA = "\033[35m"
    YELLOW = "\033[33m"
    GRAY = "\033[90m"
    BOLD = "\033[1m"
    RESET = "\033[0m"

print(f"\n{Colors.CYAN}{Colors.BOLD}🚀 [Notion AI Proxy -> Kimi K3]{Colors.RESET} Enviando prompt: \"{prompt_text}\"\n")

# Sesión con fingerprint real de Google Chrome
session = requests.Session(impersonate="chrome124")

cookies = {
    "token_v2": NOTION_TOKEN,
    "notion_user_id": USER_ID,
    "notion_users": f'["{USER_ID}"]',
    "notion_browser_id": "c5c98da8-f31d-4004-a4a0-8f817efde05e",
    "device_id": "3c4d872b-594c-81b6-bf6b-003b79a286df",
    "__cf_bm": "q6f30uLpDzMRm0yffwiXGa1NaSNYFM9dTHKZKwEJIUI-1787383209.736305-1.0.1.1-Uhrh1JyKz.fUUgFWwcjJEVI6YY9.OQoDxJ3.nmE6KmrAFY7ueeY1Wx_nBKQd26imsxI2eFQX1T_WwRCfD02e96OTIk1K40yenBypeQusDOdDAu9UpeCvZ6sy9IORBGae",
    "_cfuvid": "kjAGLcBhF1tVmS3p_VjJdixMDFxu_E5oPmnWIThZ.ek-1787382280.1363142-1.0.1.1-ZtecjD0WjsunNLSN7u.h9GYOdvfqyf2LHpDCqiDEZ_U"
}

headers = {
    "accept": "application/x-ndjson",
    "accept-language": "es,en-US;q=0.9,en;q=0.8",
    "content-type": "application/json",
    "origin": "https://app.notion.com",
    "referer": f"https://app.notion.com/chat?t={THREAD_ID}",
    "notion-audit-log-platform": "web",
    "notion-client-version": CLIENT_VERSION,
    "x-notion-active-user-header": USER_ID,
    "x-notion-space-id": SPACE_ID,
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "priority": "u=1, i"
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
        "userId": USER_ID,
        "spaceId": SPACE_ID,
        "surface": "full_page_chat",
        "timezone": "America/Caracas",
        "userName": "Pedro Rojas",
        "spaceName": "Espacio de Pedro Rojas",
        "userEmail": "thekantar0@gmail.com",
        "spaceViewId": "3c41ea7f-3832-8186-b725-0006b69b4fac",
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
    "userId": USER_ID,
    "value": [[prompt_text]],
    "createdAt": iso_date
}

# 1. Guardar turno en DB
print(f"{Colors.GRAY}📝 Guardando turno en Notion DB... {Colors.RESET}", end="", flush=True)
tx_payload = {
    "requestId": str(uuid.uuid4()),
    "transactions": [{
        "id": str(uuid.uuid4()),
        "spaceId": SPACE_ID,
        "debug": {"userAction": "WorkflowActions.addStepsToExistingThreadAndRun", "clientCommitTimeMs": now_ms},
        "operations": [
            {
                "pointer": {"table": "thread_message", "id": context_id, "spaceId": SPACE_ID},
                "path": [],
                "command": "set",
                "args": {
                    "id": context_id, "version": 1, "step": context_step,
                    "parent_id": THREAD_ID, "parent_table": "thread", "space_id": SPACE_ID,
                    "created_time": now_ms, "created_by_id": USER_ID, "created_by_table": "notion_user"
                }
            },
            {
                "pointer": {"table": "thread_message", "id": updated_config_id, "spaceId": SPACE_ID},
                "path": [],
                "command": "set",
                "args": {
                    "id": updated_config_id, "version": 1, "step": updated_config_step,
                    "parent_id": THREAD_ID, "parent_table": "thread", "space_id": SPACE_ID,
                    "created_time": now_ms, "created_by_id": USER_ID, "created_by_table": "notion_user"
                }
            },
            {
                "pointer": {"table": "thread_message", "id": user_id_step, "spaceId": SPACE_ID},
                "path": [],
                "command": "set",
                "args": {
                    "id": user_id_step, "version": 1, "step": user_step,
                    "parent_id": THREAD_ID, "parent_table": "thread", "space_id": SPACE_ID,
                    "created_time": now_ms, "created_by_id": USER_ID, "created_by_table": "notion_user"
                }
            },
            {
                "pointer": {"table": "thread", "id": THREAD_ID, "spaceId": SPACE_ID},
                "path": ["messages"],
                "command": "listAfterMulti",
                "args": {"ids": [context_id, updated_config_id, user_id_step]}
            }
        ]
    }]
}

tx_res = session.post("https://app.notion.com/api/v3/saveTransactionsFanout", headers=headers, cookies=cookies, json=tx_payload)
print(f"{Colors.GREEN}✓ OK{Colors.RESET}")

# 2. Sincronizar historial base
print(f"{Colors.GRAY}🔄 Sincronizando historial del hilo... {Colors.RESET}", end="", flush=True)
sync_res = session.post("https://app.notion.com/api/v3/syncRecordValuesSpaceInitial", headers=headers, cookies=cookies, json={
    "requests": [{"pointer": {"table": "thread", "id": THREAD_ID, "spaceId": SPACE_ID}, "version": -1}],
    "spacePointer": {"table": "space", "id": SPACE_ID}
})

msg_ids = sync_res.json().get("recordMap", {}).get("thread", {}).get(THREAD_ID, {}).get("value", {}).get("value", {}).get("messages", [])

valid_steps = []
if msg_ids:
    msg_res = session.post("https://app.notion.com/api/v3/syncRecordValuesSpaceInitial", headers=headers, cookies=cookies, json={
        "requests": [{"pointer": {"table": "thread_message", "id": mid, "spaceId": SPACE_ID}, "version": -1} for mid in msg_ids],
        "spacePointer": {"table": "space", "id": SPACE_ID}
    })
    raw_msgs = msg_res.json().get("recordMap", {}).get("thread_message", {})
    for mid in msg_ids:
        st = raw_msgs.get(mid, {}).get("value", {}).get("value", {}).get("step")
        if st and st.get("type") in ["config", "context", "updated-config"]:
            valid_steps.append(st)

print(f"{Colors.GREEN}✓ ({len(valid_steps)} pasos base){Colors.RESET}")

transcript = valid_steps + [context_step, updated_config_step, user_step]

# 3. Invocación de inferencia con streaming
print(f"{Colors.GRAY}⚡ Conectando con Kimi-K3... {Colors.RESET}", end="", flush=True)

inf_payload = {
    "traceId": trace_id,
    "spaceId": SPACE_ID,
    "threadId": THREAD_ID,
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
print(f"{Colors.GREEN}Conectado.{Colors.RESET}\n")

in_thinking = False
in_response = False

for line in inf_res.iter_lines():
    if not line:
        continue
    try:
        decoded = line.decode("utf-8")
        data = json.loads(decoded)

        # JSON-Patch streaming events
        if data.get("type") == "patch" and "v" in data:
            for patch in data["v"]:
                path = patch.get("p", "")
                val = patch.get("v")

                # Chunks de pensamiento (Thinking / CoT)
                if "value/0/content" in path:
                    if not in_thinking:
                        print(f"{Colors.MAGENTA}{Colors.BOLD}🧠 [Pensamiento de Kimi-K3]:{Colors.RESET}")
                        in_thinking = True
                    if isinstance(val, str):
                        print(f"{Colors.GRAY}{val}{Colors.RESET}", end="", flush=True)

                # Chunks de respuesta final (Text)
                elif "value/1/content" in path or "value/-" in path:
                    if in_thinking and not in_response:
                        print(f"\n\n{Colors.GREEN}{Colors.BOLD}💬 [Respuesta de Notion AI]:{Colors.RESET}\n")
                        in_response = True
                    
                    if isinstance(val, dict) and "content" in val:
                        print(val["content"], end="", flush=True)
                    elif isinstance(val, str):
                        print(val, end="", flush=True)

        elif data.get("type") == "patch-start" and "data" in data and "s" in data["data"]:
            for item in data["data"]["s"]:
                if item.get("type") == "error":
                    print(f"\n{Colors.YELLOW}[Aviso]: {item.get('message')} ({item.get('subType')}){Colors.RESET}")

    except Exception:
        pass

print(f"\n\n{Colors.GREEN}✅ Turno completado exitosamente.{Colors.RESET}\n")
