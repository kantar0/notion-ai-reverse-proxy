import json
from curl_cffi import requests

TOKEN = "v03%3AeyJhbGciOiJkaXIiLCJraWQiOiJwcm9kdWN0aW9uOnRva2VuLXYzOjIwMjQtMTEtMDciLCJlbmMiOiJBMjU2Q0JDLUhTNTEyIn0..-9h_AWZb_23ilc1uPcoF7w.o1ALxDIwtYqr_S-oVVbHuSQQJzSPJ7hBKeRGCIGonUlbGkiq38tTGuGAmSJ7OTydvC1aAIPC_b2KdbIVZFJNdrBrOYis7Bk7EfwGSSTbkHaQzp09r4ENgvJAMnUVqYoNPL5h9UlOvngflhl86C4igHMlivyJOFpbYJ12NEE8_0P50mD686sbtFcB9JeWf5GZ04qrFsT6wOqUtEll8rOuGTtVm2jZ7xs7iT7ldkYiLYUH44six53KTB_qStNep3IID27en23cCjhXR2sCDwAJQLnwZ9GnqIX5QjaNXu30WjbDochrOQ6LLWN0sLz1fxb7sbDLMfoZJbZFDQz7LGVA9S4Ol7Ri_nrXYEGpz0GazoU.DWmYsHiRwAxjdS9KzbdjvWaK6k-R9zZ3mtp8mKkysQg"

session = requests.Session(impersonate="chrome124")
cookies = {"token_v2": TOKEN}
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
    
    user_name = user_record.get(user_id, {}).get("value", {}).get("value", {}).get("name", "Cuenta")
    user_email = user_record.get(user_id, {}).get("value", {}).get("value", {}).get("email", "")
    
    print(f"✅ Usuario detectado: {user_name} ({user_email})")
    print(f"✅ User ID: {user_id}")
    print(f"✅ Space ID: {space_id}")
else:
    print("Error:", res.text[:300])
