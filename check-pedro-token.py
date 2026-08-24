import json
import uuid
import datetime
from curl_cffi import requests

# Token de la cuenta principal de Pedro
TOKEN_PEDRO = "v03%3AeyJhbGciOiJkaXIiLCJraWQiOiJwcm9kdWN0aW9uOnRva2VuLXYzOjIwMjQtMTEtMDciLCJlbmMiOiJBMjU2Q0JDLUhTNTEyIn0..X_9P9HPA5B2Y7YmMNeATYg.EeuOzMDW95Ghkj52lsSfI2HkKXgtz1s8XLMENetGYzpi6zdqSFJIC0fcX-rYD9nDH2cz_jDdQzBTGKOkv5eRMQP2xph9KZdxuGeAGCKymay8oG_hDdO1_Sakj9wEXzdA7_D7Zoz9ZZHHT2uc-pHZFRMKCuECbtlvxKyffaCaHZxXszbZsUVv30Jl94BiytmH9Ik-kJqTV0_SR0NmMZVOnO_QjRVLuaiZn0AVpIVBnzKsoumMwVT8b3Tf7r8tuuAyGx-rxsHjn61K2ybKcY0qyZmiP2O4kI0_AaTDhFaIPL7PT-ohr48sMgmSwStS5QaXVMnHrjrOIKd8FMw0UXL39CVbTqn_N0Gu05-0gdiaxlM.8xXaK1QOxQWgjtpLh0oRBykty9xIch2z2EDwOiN4hus"
USER_PEDRO = "646357f5-4b41-4f62-8767-b25670188037"

session = requests.Session(impersonate="chrome124")
cookies = {"token_v2": TOKEN_PEDRO, "notion_user_id": USER_PEDRO}
headers = {
    "content-type": "application/json",
    "origin": "https://app.notion.com",
    "referer": "https://app.notion.com/",
    "notion-client-version": "23.13.20260822.0220"
}

res = session.post("https://app.notion.com/api/v3/loadUserContent", headers=headers, cookies=cookies, json={})
print("Status token Pedro:", res.status_code)
if res.status_code == 200:
    print("✅ El token de Pedro está 100% ACTIVO y VÁLIDO.")
else:
    print("❌ Error:", res.text[:200])
