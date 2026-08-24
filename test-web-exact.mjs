import { randomUUID } from "node:crypto";

const NOTION_TOKEN = "v03%3AeyJhbGciOiJkaXIiLCJraWQiOiJwcm9kdWN0aW9uOnRva2VuLXYzOjIwMjQtMTEtMDciLCJlbmMiOiJBMjU2Q0JDLUhTNTEyIn0..X_9P9HPA5B2Y7YmMNeATYg.EeuOzMDW95Ghkj52lsSfI2HkKXgtz1s8XLMENetGYzpi6zdqSFJIC0fcX-rYD9nDH2cz_jDdQzBTGKOkv5eRMQP2xph9KZdxuGeAGCKymay8oG_hDdO1_Sakj9wEXzdA7_D7Zoz9ZZHHT2uc-pHZFRMKCuECbtlvxKyffaCaHZxXszbZsUVv30Jl94BiytmH9Ik-kJqTV0_SR0NmMZVOnO_QjRVLuaiZn0AVpIVBnzKsoumMwVT8b3Tf7r8tuuAyGx-rxsHjn61K2ybKcY0qyZmiP2O4kI0_AaTDhFaIPL7PT-ohr48sMgmSwStS5QaXVMnHrjrOIKd8FMw0UXL39CVbTqn_N0Gu05-0gdiaxlM.8xXaK1QOxQWgjtpLh0oRBykty9xIch2z2EDwOiN4hus";
const USER_ID = "646357f5-4b41-4f62-8767-b25670188037";
const SPACE_ID = "20a1ea7f-3832-81fb-a0a2-0003aeeff04b";
const THREAD_ID = "3c41ea7f-3832-80a0-884f-00a91c630a56";
const CLIENT_VERSION = "23.13.20260822.0220";

const promptText = process.argv[2] || "¿Qué hora es?";

// Generar IDs con el mismo prefijo que usa Notion en este thread
function makeNotionId() {
  const hex = randomUUID().replace(/-/g, "").slice(12);
  return `3c41ea7f-3832-${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 20)}`;
}

const contextMsgId = makeNotionId();
const updatedConfigMsgId = makeNotionId();
const userMsgId = makeNotionId();
const traceId = randomUUID();
const now = Date.now();

// Formato de fecha con timezone como Notion (-04:00)
const nowObj = new Date();
const pad = (n) => String(n).padStart(2, "0");
const tzDate = `${nowObj.getFullYear()}-${pad(nowObj.getMonth() + 1)}-${pad(nowObj.getDate())}T${pad(nowObj.getHours())}:${pad(nowObj.getMinutes())}:${pad(nowObj.getSeconds())}.${String(nowObj.getMilliseconds()).padStart(3, "0")}-04:00`;

const cookieHeader = [
  `notion_browser_id=c5c98da8-f31d-4004-a4a0-8f817efde05e`,
  `notion_check_cookie_consent=false`,
  `device_id=3c4d872b-594c-81b6-bf6b-003b79a286df`,
  `_gcl_au=1.1.904520406.1787379243`,
  `_ga=GA1.1.434490320.1787379244`,
  `_fbp=fb.1.1787379244302.605442743265446432`,
  `_ga_9ZJ8CB186L=GS2.1.s1787379243$o1$g1$t1787379252$j51$l0$h0`,
  `notion_user_id=${USER_ID}`,
  `notion_sync_user_id=%7B%22notion_user_id%22%3A%22${USER_ID}%22%2C%22is_logged_in%22%3Atrue%2C%22device_id%22%3A%22c5c98da8-f31d-4004-a4a0-8f817efde05e%22%2C%22version%22%3A4%7D`,
  `NEXT_LOCALE=en-US`,
  `p_sync_session=%7B%22tokenId%22%3A%22v02%3Async_session%3AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKiKbi5SMMNkkrJG3UfWiP7u9h-MytbYGKknbSPCj2F07ufgzyXVLfJgMcvr1LYLZ2CxhhjH8mcbcns5g2o4ZEnCBgJjuh7l7OAVt%22%2C%22userIds%22%3A%5B%22${USER_ID}%22%5D%7D`,
  `_cioid=${USER_ID}`,
  `notion_locale=en-US/legacy`,
  `notion_users=[%22${USER_ID}%22]`,
  `_cfuvid=kjAGLcBhF1tVmS3p_VjJdixMDFxu_E5oPmnWIThZ.ek-1787382280.1363142-1.0.1.1-ZtecjD0WjsunNLSN7u.h9GYOdvfqyf2LHpDCqiDEZ_U`,
  `token_v2=${NOTION_TOKEN}`,
  `__cf_bm=q6f30uLpDzMRm0yffwiXGa1NaSNYFM9dTHKZKwEJIUI-1787383209.736305-1.0.1.1-Uhrh1JyKz.fUUgFWwcjJEVI6YY9.OQoDxJ3.nmE6KmrAFY7ueeY1Wx_nBKQd26imsxI2eFQX1T_WwRCfD02e96OTIk1K40yenBypeQusDOdDAu9UpeCvZ6sy9IORBGae`
].join("; ");

const commonHeaders = {
  "accept": "application/x-ndjson",
  "accept-language": "es,en-US;q=0.9,en;q=0.8",
  "content-type": "application/json",
  "origin": "https://app.notion.com",
  "referer": `https://app.notion.com/chat?t=${THREAD_ID}`,
  "notion-audit-log-platform": "web",
  "notion-client-version": CLIENT_VERSION,
  "x-notion-active-user-header": USER_ID,
  "x-notion-space-id": SPACE_ID,
  "sec-ch-ua": '"Not=A?Brand";v="99", "Google Chrome";v="151", "Chromium";v="151"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
  "Cookie": cookieHeader
};

const newContextStep = {
  id: contextMsgId,
  type: "context",
  value: {
    userId: USER_ID,
    spaceId: SPACE_ID,
    surface: "full_page_chat",
    timezone: "America/Caracas",
    userName: "Pedro Rojas",
    spaceName: "Espacio de\u00a0Pedro Rojas",
    userEmail: "thekantar0@gmail.com",
    spaceViewId: "3c41ea7f-3832-8186-b725-0006b69b4fac",
    currentDatetime: tzDate
  }
};

const newUpdatedConfigStep = {
  id: updatedConfigMsgId,
  type: "updated-config"
};

const newUserStep = {
  id: userMsgId,
  type: "user",
  userId: USER_ID,
  value: [[promptText]],
  createdAt: tzDate
};

// 1. Guardar la transacción exactamente como el navegador
await fetch("https://app.notion.com/api/v3/saveTransactionsFanout", {
  method: "POST",
  headers: commonHeaders,
  body: JSON.stringify({
    requestId: randomUUID(),
    transactions: [
      {
        id: randomUUID(),
        spaceId: SPACE_ID,
        debug: { userAction: "WorkflowActions.addStepsToExistingThreadAndRun", clientCommitTimeMs: now },
        operations: [
          {
            pointer: { table: "thread_message", id: contextMsgId, spaceId: SPACE_ID },
            path: [],
            command: "set",
            args: {
              id: contextMsgId,
              version: 1,
              step: newContextStep,
              parent_id: THREAD_ID,
              parent_table: "thread",
              space_id: SPACE_ID,
              created_time: now,
              created_by_id: USER_ID,
              created_by_table: "notion_user"
            }
          },
          {
            pointer: { table: "thread_message", id: updatedConfigMsgId, spaceId: SPACE_ID },
            path: [],
            command: "set",
            args: {
              id: updatedConfigMsgId,
              version: 1,
              step: newUpdatedConfigStep,
              parent_id: THREAD_ID,
              parent_table: "thread",
              space_id: SPACE_ID,
              created_time: now,
              created_by_id: USER_ID,
              created_by_table: "notion_user"
            }
          },
          {
            pointer: { table: "thread_message", id: userMsgId, spaceId: SPACE_ID },
            path: [],
            command: "set",
            args: {
              id: userMsgId,
              version: 1,
              step: newUserStep,
              parent_id: THREAD_ID,
              parent_table: "thread",
              space_id: SPACE_ID,
              created_time: now,
              created_by_id: USER_ID,
              created_by_table: "notion_user"
            }
          },
          {
            pointer: { table: "thread", id: THREAD_ID, spaceId: SPACE_ID },
            path: ["messages"],
            command: "listAfterMulti",
            args: { ids: [contextMsgId, updatedConfigMsgId, userMsgId] }
          }
        ]
      },
      {
        id: randomUUID(),
        spaceId: SPACE_ID,
        debug: { userAction: "unifiedChatInputActions.updateThreadUpdatedTime", clientCommitTimeMs: now + 2 },
        operations: [
          {
            pointer: { table: "thread", id: THREAD_ID, spaceId: SPACE_ID },
            path: [],
            command: "update",
            args: { updated_time: now + 2, updated_by_id: USER_ID, updated_by_table: "notion_user" }
          }
        ]
      }
    ]
  })
});

// 2. Traer el historial base de context/config steps
const syncRes = await fetch("https://app.notion.com/api/v3/syncRecordValuesSpaceInitial", {
  method: "POST",
  headers: commonHeaders,
  body: JSON.stringify({
    requests: [{ pointer: { table: "thread", id: THREAD_ID, spaceId: SPACE_ID }, version: -1 }],
    spacePointer: { table: "space", id: SPACE_ID }
  })
});
const syncData = await syncRes.json();
const messageIds = syncData.recordMap?.thread?.[THREAD_ID]?.value?.value?.messages || [];

const msgRes = await fetch("https://app.notion.com/api/v3/syncRecordValuesSpaceInitial", {
  method: "POST",
  headers: commonHeaders,
  body: JSON.stringify({
    requests: messageIds.map((id) => ({ pointer: { table: "thread_message", id, spaceId: SPACE_ID }, version: -1 })),
    spacePointer: { table: "space", id: SPACE_ID }
  })
});
const msgData = await msgRes.json();
const rawMessages = msgData.recordMap?.thread_message || {};

const transcript = [];
for (const id of messageIds) {
  const step = rawMessages[id]?.value?.value?.step;
  // Solo los pasos de contexto/config de entrada anteriores, NUNCA user antiguos ni assistant ni error
  if (step && (step.type === "config" || step.type === "context" || step.type === "updated-config")) {
    transcript.push(step);
  }
}
// Añadir el nuevo context, nuevo updated-config y el UNICO user step
transcript.push(newContextStep, newUpdatedConfigStep, newUserStep);

// 3. Ejecutar inferencia
const infRes = await fetch("https://app.notion.com/api/v3/runInferenceTranscript", {
  method: "POST",
  headers: commonHeaders,
  body: JSON.stringify({
    traceId,
    spaceId: SPACE_ID,
    threadId: THREAD_ID,
    createThread: false,
    debugOverrides: {
      emitAgentSearchExtractedResults: true,
      cachedInferences: {},
      annotationInferences: {},
      emitInferences: false
    },
    generateTitle: false,
    saveAllThreadOperations: true,
    setUnreadState: true,
    createdSource: "ai_module",
    threadType: "workflow",
    isPartialTranscript: true,
    asPatchResponse: true,
    patchResponseVersion: 2,
    isUserInAnySalesAssistedSpace: false,
    isSpaceSalesAssisted: false,
    supportsCustomAgentNudgeTranscriptStep: true,
    transcript
  })
});

console.log("Inferencia status:", infRes.status);
const reader = infRes.body.getReader();
const decoder = new TextDecoder("utf-8");
let buffer = "";

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  const lines = buffer.split("\n");
  buffer = lines.pop() || "";
  for (const line of lines) {
    if (!line.trim()) continue;
    console.log(line);
  }
}
