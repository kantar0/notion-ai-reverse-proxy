import json
import uuid
import datetime
from curl_cffi import requests

TOKEN = "v03%3AeyJhbGciOiJkaXIiLCJraWQiOiJwcm9kdWN0aW9uOnRva2VuLXYzOjIwMjQtMTEtMDciLCJlbmMiOiJBMjU2Q0JDLUhTNTEyIn0..-9h_AWZb_23ilc1uPcoF7w.o1ALxDIwtYqr_S-oVVbHuSQQJzSPJ7hBKeRGCIGonUlbGkiq38tTGuGAmSJ7OTydvC1aAIPC_b2KdbIVZFJNdrBrOYis7Bk7EfwGSSTbkHaQzp09r4ENgvJAMnUVqYoNPL5h9UlOvngflhl86C4igHMlivyJOFpbYJ12NEE8_0P50mD686sbtFcB9JeWf5GZ04qrFsT6wOqUtEll8rOuGTtVm2jZ7xs7iT7ldkYiLYUH44six53KTB_qStNep3IID27en23cCjhXR2sCDwAJQLnwZ9GnqIX5QjaNXu30WjbDochrOQ6LLWN0sLz1fxb7sbDLMfoZJbZFDQz7LGVA9S4Ol7Ri_nrXYEGpz0GazoU.DWmYsHiRwAxjdS9KzbdjvWaK6k-R9zZ3mtp8mKkysQg"
USER_ID = "3c4d872b-594c-81d1-a994-0002ffbc7296"
SPACE_ID = "656cb631-adb5-8139-a593-000324952786"
CLIENT_VERSION = "23.13.20260822.0220"

session = requests.Session(impersonate="chrome124")
cookies = {"token_v2": TOKEN, "notion_user_id": USER_ID}
headers = {
    "accept": "application/x-ndjson",
    "content-type": "application/json",
    "origin": "https://app.notion.com",
    "referer": "https://app.notion.com/chat",
    "notion-client-version": CLIENT_VERSION,
    "x-notion-active-user-header": USER_ID,
    "x-notion-space-id": SPACE_ID
}

new_thread_id = str(uuid.uuid4())
config_id = str(uuid.uuid4())
context_id = str(uuid.uuid4())
user_id_step = str(uuid.uuid4())
now_ms = int(datetime.datetime.now().timestamp() * 1000)
iso_date = datetime.datetime.now().isoformat() + "-04:00"

print(f"🚀 Creando hilo activo en Notion (thread_id: {new_thread_id})...")

tx_payload = {
    "requestId": str(uuid.uuid4()),
    "transactions": [{
        "id": str(uuid.uuid4()),
        "spaceId": SPACE_ID,
        "debug": {"userAction": "WorkflowActions.createNewThread", "clientCommitTimeMs": now_ms},
        "operations": [
            {
                "pointer": {"table": "thread", "id": new_thread_id, "spaceId": SPACE_ID},
                "path": [],
                "command": "set",
                "args": {
                    "id": new_thread_id, "version": 1, "parent_id": SPACE_ID, "parent_table": "space",
                    "space_id": SPACE_ID, "alive": True, "type": "workflow", "created_source": "ai_module",
                    "created_time": now_ms, "created_by_id": USER_ID, "created_by_table": "notion_user",
                    "updated_time": now_ms, "updated_by_id": USER_ID, "updated_by_table": "notion_user",
                    "messages": [config_id, context_id, user_id_step]
                }
            },
            {
                "pointer": {"table": "thread_message", "id": config_id, "spaceId": SPACE_ID},
                "path": [],
                "command": "set",
                "args": {
                    "id": config_id, "version": 1,
                    "step": {
                        "id": config_id,
                        "type": "config",
                        "value": {
                            "type": "workflow",
                            "model": "fireworks-kimi-k3",
                            "reasoningEffort": "max",
                            "modelFromUser": True,
                            "useWebSearch": True,
                            "enableMarkdownVNext": True
                        }
                    },
                    "parent_id": new_thread_id, "parent_table": "thread", "space_id": SPACE_ID,
                    "created_time": now_ms, "created_by_id": USER_ID, "created_by_table": "notion_user"
                }
            },
            {
                "pointer": {"table": "thread_message", "id": context_id, "spaceId": SPACE_ID},
                "path": [],
                "command": "set",
                "args": {
                    "id": context_id, "version": 1,
                    "step": {
                        "id": context_id,
                        "type": "context",
                        "value": {
                            "userId": USER_ID,
                            "spaceId": SPACE_ID,
                            "surface": "full_page_chat",
                            "timezone": "America/Caracas",
                            "userName": "hello",
                            "spaceName": "Espacio de hello",
                            "userEmail": "hello@agenciakiwi.com",
                            "currentDatetime": iso_date
                        }
                    },
                    "parent_id": new_thread_id, "parent_table": "thread", "space_id": SPACE_ID,
                    "created_time": now_ms, "created_by_id": USER_ID, "created_by_table": "notion_user"
                }
            },
            {
                "pointer": {"table": "thread_message", "id": user_id_step, "spaceId": SPACE_ID},
                "path": [],
                "command": "set",
                "args": {
                    "id": user_id_step, "version": 1,
                    "step": {
                        "id": user_id_step,
                        "type": "user",
                        "userId": USER_ID,
                        "value": [["Hola Kimi, confirma conexión"]],
                        "createdAt": iso_date
                    },
                    "parent_id": new_thread_id, "parent_table": "thread", "space_id": SPACE_ID,
                    "created_time": now_ms, "created_by_id": USER_ID, "created_by_table": "notion_user"
                }
            }
        ]
    }]
}

tx_res = session.post("https://app.notion.com/api/v3/saveTransactionsFanout", headers=headers, cookies=cookies, json=tx_payload)
print("DB Status:", tx_res.status_code)

inf_payload = {
    "traceId": str(uuid.uuid4()),
    "spaceId": SPACE_ID,
    "threadId": new_thread_id,
    "createThread": True,
    "debugOverrides": {"emitAgentSearchExtractedResults": True, "cachedInferences": {}, "annotationInferences": {}, "emitInferences": False},
    "generateTitle": True,
    "saveAllThreadOperations": True,
    "setUnreadState": True,
    "createdSource": "ai_module",
    "threadType": "workflow",
    "isPartialTranscript": False,
    "asPatchResponse": True,
    "patchResponseVersion": 2,
    "isUserInAnySalesAssistedSpace": False,
    "isSpaceSalesAssisted": False,
    "supportsCustomAgentNudgeTranscriptStep": True,
    "transcript": [
        {"id": config_id, "type": "config", "value": {"type": "workflow", "model": "fireworks-kimi-k3", "reasoningEffort": "max", "modelFromUser": True, "useWebSearch": True, "enableMarkdownVNext": True}},
        {"id": context_id, "type": "context", "value": {"userId": USER_ID, "spaceId": SPACE_ID, "surface": "full_page_chat", "timezone": "America/Caracas", "userName": "hello", "spaceName": "Espacio de hello", "userEmail": "hello@agenciakiwi.com", "currentDatetime": iso_date}},
        {"id": user_id_step, "type": "user", "userId": USER_ID, "value": [["Hola Kimi, confirma conexión"]], "createdAt": iso_date}
    ]
}

inf_res = session.post("https://app.notion.com/api/v3/runInferenceTranscript", headers=headers, cookies=cookies, json=inf_payload, stream=True)
print("Inferencia Status:", inf_res.status_code)

for line in inf_res.iter_lines():
    if not line:
        continue
    text = line.decode("utf-8")
    if "value/1/content" in text or "text" in text:
        print(text[:120])

with open("active_thread.txt", "w") as f:
    f.write(new_thread_id)
