import { randomUUID } from "node:crypto";

// ==========================================
// CONFIGURACIÓN NOTION AI
// ==========================================
const NOTION_TOKEN = "v03%3AeyJhbGciOiJkaXIiLCJraWQiOiJwcm9kdWN0aW9uOnRva2VuLXYzOjIwMjQtMTEtMDciLCJlbmMiOiJBMjU2Q0JDLUhTNTEyIn0..X_9P9HPA5B2Y7YmMNeATYg.EeuOzMDW95Ghkj52lsSfI2HkKXgtz1s8XLMENetGYzpi6zdqSFJIC0fcX-rYD9nDH2cz_jDdQzBTGKOkv5eRMQP2xph9KZdxuGeAGCKymay8oG_hDdO1_Sakj9wEXzdA7_D7Zoz9ZZHHT2uc-pHZFRMKCuECbtlvxKyffaCaHZxXszbZsUVv30Jl94BiytmH9Ik-kJqTV0_SR0NmMZVOnO_QjRVLuaiZn0AVpIVBnzKsoumMwVT8b3Tf7r8tuuAyGx-rxsHjn61K2ybKcY0qyZmiP2O4kI0_AaTDhFaIPL7PT-ohr48sMgmSwStS5QaXVMnHrjrOIKd8FMw0UXL39CVbTqn_N0Gu05-0gdiaxlM.8xXaK1QOxQWgjtpLh0oRBykty9xIch2z2EDwOiN4hus";
const USER_ID = "646357f5-4b41-4f62-8767-b25670188037";
const SPACE_ID = "20a1ea7f-3832-81fb-a0a2-0003aeeff04b";
const THREAD_ID = "3c41ea7f-3832-80a0-884f-00a91c630a56";
const CLIENT_VERSION = "23.13.20260822.0220";

const promptText = process.argv[2] || "¿Cuál es la velocidad de la luz?";

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
  gray: "\x1b[90m"
};

const cookieHeader = [
  `token_v2=${NOTION_TOKEN}`,
  `notion_user_id=${USER_ID}`,
  `notion_users=[%22${USER_ID}%22]`,
  `notion_browser_id=c5c98da8-f31d-4004-a4a0-8f817efde05e`,
  `device_id=3c4d872b-594c-81b6-bf6b-003b79a286df`,
  `__cf_bm=q6f30uLpDzMRm0yffwiXGa1NaSNYFM9dTHKZKwEJIUI-1787383209.736305-1.0.1.1-Uhrh1JyKz.fUUgFWwcjJEVI6YY9.OQoDxJ3.nmE6KmrAFY7ueeY1Wx_nBKQd26imsxI2eFQX1T_WwRCfD02e96OTIk1K40yenBypeQusDOdDAu9UpeCvZ6sy9IORBGae`
].join("; ");

const commonHeaders = {
  "content-type": "application/json",
  "origin": "https://app.notion.com",
  "referer": `https://app.notion.com/chat?t=${THREAD_ID}`,
  "notion-audit-log-platform": "web",
  "notion-client-version": CLIENT_VERSION,
  "x-notion-active-user-header": USER_ID,
  "x-notion-space-id": SPACE_ID,
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
  "Cookie": cookieHeader
};

async function execute() {
  console.log(`\n${ANSI.cyan}${ANSI.bold}🚀 Enviando Prompt a Notion AI:${ANSI.reset} "${promptText}"\n`);

  const traceId = randomUUID();
  const contextMsgId = randomUUID();
  const updatedConfigMsgId = randomUUID();
  const userMsgId = randomUUID();
  const now = Date.now();
  const isoDate = new Date().toISOString();

  // 1. Obtener los steps previos válidos (filtrando únicamente config, context y updated-config)
  process.stdout.write(`${ANSI.gray}🔄 Sincronizando historial... ${ANSI.reset}`);
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
  
  let validPriorSteps = [];
  if (messageIds.length > 0) {
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
    
    for (const id of messageIds) {
      const step = rawMessages[id]?.value?.value?.step;
      // IMPORTANTE: Solo steps de input, NUNCA 'error' ni 'assistant'
      if (step && (step.type === "config" || step.type === "context" || step.type === "updated-config")) {
        validPriorSteps.push(step);
      }
    }
  }

  console.log(`${ANSI.green}✓ (${validPriorSteps.length} pasos base)${ANSI.reset}`);

  // 2. Guardar nuevo mensaje en la base de datos
  process.stdout.write(`${ANSI.gray}📝 Guardando mensaje... ${ANSI.reset}`);
  
  const newContextStep = {
    id: contextMsgId,
    type: "context",
    value: {
      userId: USER_ID,
      spaceId: SPACE_ID,
      surface: "full_page_chat",
      timezone: "America/Caracas",
      userName: "Pedro Rojas",
      spaceName: "Espacio de Pedro Rojas",
      userEmail: "thekantar0@gmail.com",
      spaceViewId: "3c41ea7f-3832-8186-b725-0006b69b4fac",
      currentDatetime: isoDate
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
    createdAt: isoDate
  };

  await fetch("https://app.notion.com/api/v3/saveTransactionsFanout", {
    method: "POST",
    headers: commonHeaders,
    body: JSON.stringify({
      requestId: randomUUID(),
      transactions: [{
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
      }]
    })
  });

  console.log(`${ANSI.green}✓ OK${ANSI.reset}`);

  // 3. Invocación de Inferencia
  process.stdout.write(`${ANSI.gray}⚡ Invocando Kimi-K3... ${ANSI.reset}`);

  const transcript = [...validPriorSteps, newContextStep, newUpdatedConfigStep, newUserStep];

  const infRes = await fetch("https://app.notion.com/api/v3/runInferenceTranscript", {
    method: "POST",
    headers: {
      ...commonHeaders,
      "accept": "application/x-ndjson"
    },
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

  console.log(`${ANSI.green}Conectado.${ANSI.reset}\n`);

  const reader = infRes.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let inThinking = false;
  let hasOutput = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const json = JSON.parse(line);

        if (json.type === "patch-start" && json.data?.s) {
          for (const item of json.data.s) {
            if (item.type === "error") {
              console.log(`\n${ANSI.yellow}[Notion]: ${item.message} (${item.subType || ""})${ANSI.reset}`);
            }

            // Pensamiento
            if (item.step?.type === "thinking" || item.thinking) {
              if (!inThinking) {
                console.log(`\n${ANSI.magenta}${ANSI.bold}🧠 [Pensamiento]:${ANSI.reset}`);
                inThinking = true;
              }
              const thought = item.thinking || item.step?.value || item.delta || "";
              process.stdout.write(`${ANSI.gray}${thought}${ANSI.reset}`);
              hasOutput = true;
            }

            // Texto generado
            if (item.type === "chunk" || item.type === "text" || item.delta || (item.value && typeof item.value === "string")) {
              if (inThinking) {
                console.log(`\n\n${ANSI.green}${ANSI.bold}💬 [Respuesta]:${ANSI.reset}\n`);
                inThinking = false;
              }
              process.stdout.write(item.value || item.delta || item.text || "");
              hasOutput = true;
            }
          }
        } else if (json.type === "token") {
          process.stdout.write(json.text || "");
          hasOutput = true;
        }
      } catch {
        // Ignorar líneas no JSON
      }
    }
  }

  if (hasOutput) {
    console.log(`\n\n${ANSI.green}✅ Respuesta completada con éxito.${ANSI.reset}\n`);
  }
}

execute();
