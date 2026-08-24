import json
from curl_cffi import requests

NEW_TOKEN = "v03%3AeyJhbGciOiJkaXIiLCJraWQiOiJwcm9kdWN0aW9uOnRva2VuLXYzOjIwMjQtMTEtMDciLCJlbmMiOiJBMjU2Q0JDLUhTNTEyIn0..HOIiyG-BRydEVx30Eh8gIQ.QzkyqDhONmNg_BqZ0qRzYELI0kazlIEwwcYQSn6a3mOqIaqlRuHuR0nR1ZzyUDk_qua6e_R5d3IhMYX_hzOXvpfag20XH9O0NsMltfgI2kMvW10SNQou_v3hNggsSQDwR_LN1Y3YnRVruKVmmzuxg7kMCGzMwaCLXvM_m3YUcLxuxUa5Sk8gnOHEd9Buq6Bp0-hRbuBC86OFGobsL5oD8DGXiX-MHk0BeggnoJmtSr66figVCosY7HNj89KsMfA_wj8WZm0CkMHVdglvl-007Uj1v4TfVC5g34dWELoFmyxa4-ax1-mGA3P8H6lHUl-ObOwgPST3DxEiyf3F2cRaoRTQsB1dkck_vExV_QzwiC8.ShX87yzfKyE4pTYBWu_6W3DwzNkeL_euUT0ZbAwY7TQ"

session = requests.Session(impersonate="chrome124")
cookies = {"token_v2": NEW_TOKEN}
headers = {
    "content-type": "application/json",
    "origin": "https://app.notion.com",
    "referer": "https://app.notion.com/",
    "notion-client-version": "23.13.20260822.0220"
}

res = session.post("https://app.notion.com/api/v3/loadUserContent", headers=headers, cookies=cookies, json={})
print("Status loadUserContent:", res.status_code)

if res.status_code == 200:
    data = res.json()
    user_record = data.get("recordMap", {}).get("notion_user", {})
    user_ids = list(user_record.keys())
    user_id = user_ids[0] if user_ids else None
    
    space_record = data.get("recordMap", {}).get("space", {})
    space_ids = list(space_record.keys())
    space_id = space_ids[0] if space_ids else None
    
    user_name = user_record.get(user_id, {}).get("value", {}).get("value", {}).get("name", "Cuenta Nueva")
    user_email = user_record.get(user_id, {}).get("value", {}).get("value", {}).get("email", "")
    
    print(f"✅ Usuario detectado: {user_name} ({user_email})")
    print(f"✅ User ID: {user_id}")
    print(f"✅ Space ID: {space_id}")
else:
    print("Error:", res.text[:300])
