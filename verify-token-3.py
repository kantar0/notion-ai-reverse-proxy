import json
from curl_cffi import requests

TOKEN = "v03%3AeyJhbGciOiJkaXIiLCJraWQiOiJwcm9kdWN0aW9uOnRva2VuLXYzOjIwMjQtMTEtMDciLCJlbmMiOiJBMjU2Q0JDLUhTNTEyIn0..dmwZq_MVsD5jjlyIT347Qw.Mrfn4bGlS-AQLzbqA5KhXlNVqjEoDEAisMXVAdxTAj-WR0L_IpPU7ZOmw5-oZXbrqsu62Nkflee8HFChRPoSWTd6tZo9V-dJmKmrD9eOLvy1YCmrdgMPB-DMHIplHg9HG8VjWOu_SuHdedYHBAYahLj8Jmp2qklMIKEJCJmHFp0ifznVXgxXQIsiPc8QHFz93KLUDAc9N0Aa6xO80-PQyZ2hKk9nVVYKAuhRG_xALKu3sHO9qIuygx7ih9zbIp98WTmJilWbBmhMrEBI4cr8UE7foqjYxlRSrIdyWZdDj8HRwtJKK3OqIFoiyqX7UHdCjvSollIIKwoVW4ishLI0ljUvNGW0pPnfOUMnR78HHno.QMYF-acFORXWVkkg9nA_9-pXqDwNn2Gc1O6ElwzD3bM"

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
