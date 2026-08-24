import json
import uuid
import datetime
from curl_cffi import requests

NEW_TOKEN = "v03%3AeyJhbGciOiJkaXIiLCJraWQiOiJwcm9kdWN0aW9uOnRva2VuLXYzOjIwMjQtMTEtMDciLCJlbmMiOiJBMjU2Q0JDLUhTNTEyIn0..HOIiyG-BRydEVx30Eh8gIQ.QzkyqDhONmNg_BqZ0qRzYELI0kazlIEwwcYQSn6a3mOqIaqlRuHuR0nR1ZzyUDk_qua6e_R5d3IhMYX_hzOXvpfag20XH9O0NsMltfgI2kMvW10SNQou_v3hNggsSQDwR_LN1Y3YnRVruKVmmzuxg7kMCGzMwaCLXvM_m3YUcLxuxUa5Sk8gnOHEd9Buq6Bp0-hRbuBC86OFGobsL5oD8DGXiX-MHk0BeggnoJmtSr66figVCosY7HNj89KsMfA_wj8WZm0CkMHVdglvl-007Uj1v4TfVC5g34dWELoFmyxa4-ax1-mGA3P8H6lHUl-ObOwgPST3DxEiyf3F2cRaoRTQsB1dkck_vExV_QzwiC8.ShX87yzfKyE4pTYBWu_6W3DwzNkeL_euUT0ZbAwY7TQ"
USER_ID = "3c4d872b-594c-81d1-a994-0002ffbc7296"
SPACE_ID = "656cb631-adb5-8139-a593-000324952786"
THREAD_ID = "22113d95-1335-4db0-9c5d-601292a7213b"
CLIENT_VERSION = "23.13.20260822.0220"

session = requests.Session(impersonate="chrome124")
cookies = {"token_v2": NEW_TOKEN, "notion_user_id": USER_ID}
headers = {
    "accept": "application/x-ndjson",
    "content-type": "application/json",
    "origin": "https://app.notion.com",
    "referer": f"https://app.notion.com/chat?t={THREAD_ID}",
    "notion-client-version": CLIENT_VERSION,
    "x-notion-active-user-header": USER_ID,
    "x-notion-space-id": SPACE_ID
}

context_id = str(uuid.uuid4())
updated_config_id = str(uuid.uuid4())
user_id_step = str(uuid.uuid4())
now_ms = int(datetime.datetime.now().timestamp() * 1000)
iso_date = datetime.datetime.now().isoformat() + "-04:00"

prompt = "Di exactamente: Conexión comprobada con Kimi K3."

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
                    "id": context_id, "version": 1,
                    "step": {
                        "id": context_id, "type": "context",
                        "value": {"userId": USER_ID, "spaceId": SPACE_ID, "surface": "full_page_chat", "timezone": "America/Caracas", "userName": "hello", "spaceName": "Espacio de hello", "userEmail": "hello@agenciakiwi.com", "currentDatetime": iso_date}
                    },
                    "parent_id": THREAD_ID, "parent_table": "thread", "space_id": SPACE_ID,
                    "created_time": now_ms, "created_by_id": USER_ID, "created_by_table": "notion_user"
                }
            },
            {
                "pointer": {"table": "thread_message", "id": updated_config_id, "spaceId": SPACE_ID},
                "path": [],
                "command": "set",
                "args": {
                    "id": updated_config_id, "version": 1, "step": {"id": updated_config_id, "type": "updated-config"},
                    "parent_id": THREAD_ID, "parent_table": "thread", "space_id": SPACE_ID,
                    "created_time": now_ms, "created_by_id": USER_ID, "created_by_table": "notion_user"
                }
            },
            {
                "pointer": {"table": "thread_message", "id": user_id_step, "spaceId": SPACE_ID},
                "path": [],
                "command": "set",
                "args": {
                    "id": user_id_step, "version": 1,
                    "step": {"id": user_id_step, "type": "user", "userId": USER_ID, "value": [[prompt]], "createdAt": iso_date},
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
print("DB Status:", tx_res.status_code)

inf_payload = {
    "traceId": str(uuid.uuid4()),
    "spaceId": SPACE_ID,
    "threadId": THREAD_ID,
    "createThread": False,
    "debugOverrides": {"emitAgentSearchExtractedResults": True, "cachedInferences": {}, "annotationInferences": {}, "emitInferences": False},
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
    "transcript": [
        {"id": "config-id-init", "type": "config", "value": {"type": "workflow", "model": "fireworks-kimi-k3", "reasoningEffort": "max", "modelFromUser": True, "useWebSearch": True, "enableMarkdownVNext": True}},
        {"id": context_id, "type": "context", "value": {"userId": USER_ID, "spaceId": SPACE_ID, "surface": "full_page_chat", "timezone": "America/Caracas", "userName": "hello", "spaceName": "Espacio de hello", "userEmail": "hello@agenciakiwi.com", "currentDatetime": iso_date}},
        {"id": updated_config_id, "type": "updated-config"},
        {"id": user_id_step, "type": "user", "userId": USER_ID, "value": [[prompt]], "createdAt": iso_date}
    ]
}

inf_res = session.post("https://app.notion.com/api/v3/runInferenceTranscript", headers=headers, cookies=cookies, json=inf_payload, stream=True)
print("Inferencia Status:", inf_res.status_code)

for line in inf_res.iter_lines():
    if not line:
        continue
    print(line.decode("utf-8"))
