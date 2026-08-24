const NOTION_TOKEN = "v03%3AeyJhbGciOiJkaXIiLCJraWQiOiJwcm9kdWN0aW9uOnRva2VuLXYzOjIwMjQtMTEtMDciLCJlbmMiOiJBMjU2Q0JDLUhTNTEyIn0..tLirmMqlrahlbdhXpyysRw.deO6-nhMDDBVjXGA3Bq9S-FZct2bK79ka140voiiA02jmWRhETm_7LzNO107N_RUUrsiaY1OlMlMgj43p4RjVf12ipQHv5RKhx1sWuYGzQF5MUw-0RTi_3v8OpkR5e_pSreyEPAp2pyChYgdy1v_4G4XF-XO6pEV2A8_Uvwut5maO0Mr1VEllEMxp3ig1TA7mxdl0Own5LsRofLQjaP4dgYetGN1NT9MpUrSBaYk8l6YbQJ2X9LxVVSf3z7dGGv_UawLN7BE8SMdufPJh5lrtAzyfnlftuKhu0095MjqSI1qXhdo4b-P6f-Iek-Fm89P3h6D1BECQmPIdkqGvUMkbcdNy3tg74HbmHDTOfsnkps.2KgAtxvbBydeiaAixwhHhzNQf3iwDzzCncc5japKPzU";
const USER_ID = "646357f5-4b41-4f62-8767-b25670188037";
const SPACE_ID = "20a1ea7f-3832-81fb-a0a2-0003aeeff04b";

const cookieHeader = [
  `token_v2=${NOTION_TOKEN}`,
  `notion_user_id=${USER_ID}`,
  `notion_users=[%22${USER_ID}%22]`,
  `notion_browser_id=c5c98da8-f31d-4004-a4a0-8f817efde05e`,
  `device_id=3c4d872b-594c-81b6-bf6b-003b79a286df`
].join("; ");

const res = await fetch("https://app.notion.com/api/v3/getAiCompletion", {
  method: "POST",
  headers: {
    "accept": "application/x-ndjson, text/event-stream, */*",
    "content-type": "application/json",
    "origin": "https://app.notion.com",
    "referer": "https://app.notion.com/",
    "notion-client-version": "23.13.20260822.0220",
    "x-notion-active-user-header": USER_ID,
    "Cookie": cookieHeader
  },
  body: JSON.stringify({
    type: "prompt",
    spaceId: SPACE_ID,
    prompt: "Cuenta hasta 3",
    isBlockAction: false
  })
});

console.log("Status:", res.status, res.statusText);
const body = await res.text();
console.log("Response:", body);
