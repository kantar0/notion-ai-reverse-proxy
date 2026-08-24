import { randomUUID } from "node:crypto";

const NOTION_TOKEN = "v03%3AeyJhbGciOiJkaXIiLCJraWQiOiJwcm9kdWN0aW9uOnRva2VuLXYzOjIwMjQtMTEtMDciLCJlbmMiOiJBMjU2Q0JDLUhTNTEyIn0..tLirmMqlrahlbdhXpyysRw.deO6-nhMDDBVjXGA3Bq9S-FZct2bK79ka140voiiA02jmWRhETm_7LzNO107N_RUUrsiaY1OlMlMgj43p4RjVf12ipQHv5RKhx1sWuYGzQF5MUw-0RTi_3v8OpkR5e_pSreyEPAp2pyChYgdy1v_4G4XF-XO6pEV2A8_Uvwut5maO0Mr1VEllEMxp3ig1TA7mxdl0Own5LsRofLQjaP4dgYetGN1NT9MpUrSBaYk8l6YbQJ2X9LxVVSf3z7dGGv_UawLN7BE8SMdufPJh5lrtAzyfnlftuKhu0095MjqSI1qXhdo4b-P6f-Iek-Fm89P3h6D1BECQmPIdkqGvUMkbcdNy3tg74HbmHDTOfsnkps.2KgAtxvbBydeiaAixwhHhzNQf3iwDzzCncc5japKPzU";
const USER_ID = "646357f5-4b41-4f62-8767-b25670188037";
const SPACE_ID = "20a1ea7f-3832-81fb-a0a2-0003aeeff04b";
const THREAD_ID = "3c41ea7f-3832-80a0-884f-00a91c630a56";
const CLIENT_VERSION = "23.13.20260822.0220";

const promptText = process.argv[2] || "Responde con un chiste corto de programadores.";

console.log(`\n🚀 Ejecutando flujo completo de Notion AI para prompt: "${promptText}"\n`);

const traceId = randomUUID();
const contextMsgId = randomUUID();
const updatedConfigMsgId = randomUUID();
const userMsgId = randomUUID();
const now = Date.now();
const isoDate = new Date().toISOString();

const cookieHeader = [
  `token_v2=${NOTION_TOKEN}`,
  `notion_user_id=${USER_ID}`,
  `notion_users=[%22${USER_ID}%22]`,
  `notion_browser_id=c5c98da8-f31d-4004-a4a0-8f817efde05e`,
  `device_id=3c4d872b-594c-81b6-bf6b-003b79a286df`
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

// PASO 1: Persistir la transacción en el Thread
console.log("📝 [1/2] Guardando mensaje en el Thread...");

const saveTransactionPayload = {
  requestId: randomUUID(),
  transactions: [
    {
      id: randomUUID(),
      spaceId: SPACE_ID,
      debug: {
        userAction: "WorkflowActions.addStepsToExistingThreadAndRun",
        clientCommitTimeMs: now
      },
      operations: [
        {
          pointer: { table: "thread_message", id: contextMsgId, spaceId: SPACE_ID },
          path: [],
          command: "set",
          args: {
            id: contextMsgId,
            version: 1,
            step: {
              id: contextMsgId,
              type: "context",
              value: {
                timezone: "America/Caracas",
                userName: "Pedro Rojas",
                userId: USER_ID,
                userEmail: "thekantar0@gmail.com",
                spaceName: "Espacio de Pedro Rojas",
                spaceId: SPACE_ID,
                spaceViewId: "3c41ea7f-3832-8186-b725-0006b69b4fac",
                currentDatetime: isoDate,
                surface: "full_page_chat"
              }
            },
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
            step: {
              id: updatedConfigMsgId,
              type: "updated-config",
              value: { availableConnectors: [] }
            },
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
            step: {
              id: userMsgId,
              type: "user",
              userId: USER_ID,
              value: [[promptText]],
              createdAt: isoDate
            },
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
      debug: {
        userAction: "unifiedChatInputActions.updateThreadUpdatedTime",
        clientCommitTimeMs: now + 2
      },
      operations: [
        {
          pointer: { table: "thread", id: THREAD_ID, spaceId: SPACE_ID },
          path: [],
          command: "update",
          args: {
            updated_time: now + 2,
            updated_by_id: USER_ID,
            updated_by_table: "notion_user"
          }
        }
      ]
    }
  ]
};

const txRes = await fetch("https://app.notion.com/api/v3/saveTransactionsFanout", {
  method: "POST",
  headers: commonHeaders,
  body: JSON.stringify(saveTransactionPayload)
});

console.log(`   Status transacción: ${txRes.status} ${txRes.statusText}`);

// PASO 2: Disparar inferencia
console.log("⚡ [2/2] Disparando runInferenceTranscript...");

const configValue = {
  type: "workflow",
  enableAgentAutomations: true,
  enableAgentIntegrations: true,
  enableCustomAgents: true,
  enableExperimentalIntegrations: false,
  enableScriptAgent: true,
  enableScriptAgentAdvanced: false,
  enableScriptAgentSearchConnectorsInCustomAgent: false,
  enableScriptAgentGoogleDriveInCustomAgent: false,
  enableScriptAgentGoogleDriveOAuthInCustomAgent: false,
  enableScriptAgentSlack: true,
  enableScriptAgentMcpServers: true,
  enableAgentDiffs: true,
  enableCsvAttachmentSupport: true,
  showDatabaseAgentsDiscoverability: false,
  enableAgentThreadTools: false,
  enableCrdtOperations: false,
  enableAgentCardCustomization: true,
  enableSystemPromptAsPage: false,
  enableUserSessionContext: false,
  enableLargeToolResultComputerOffload: false,
  enableScriptAgentGtm: false,
  enableComputer: false,
  enableCustomAgentCreateGuidanceV2: true,
  enableSoftwareFactoryPage: false,
  enableAgentGenerateImage: false,
  enableQueryCalendar: false,
  enableQueryMail: false,
  enableMailExplicitToolCalls: true,
  enableMailNotificationPreferences: false,
  enableMailAgentMultiProviderSupport: true,
  enableNotionMailDeprecated: false,
  enableWebResearch: false,
  useRulePrioritization: true,
  searchScopes: [{ type: "everything" }],
  useWebSearch: true,
  isHipaa: false,
  internetAccess: false,
  manageWorkers: false,
  useReadOnlyMode: false,
  writerMode: false,
  model: "claude-3-5-sonnet",
  reasoningEffort: "max",
  modelFromUser: false,
  isCustomAgentBuilder: false,
  isCustomAgentCreate: false,
  isAgentResearchRequest: false,
  useCustomAgentDraft: false,
  enableMarkdownVNext: true,
  enableSuggestedEditsTools: true,
  enableAgentSkillsV2: true,
  enableSkillsInCustomAgents: false,
  updatePageStaleViewGuardEnabled: true,
  enableUpdatePageOrderUpdates: true,
  enableAgentSupportPropertyReorder: true,
  enableAgentAskSurvey: true,
  databaseAgentConfigMode: false,
  isOnboardingAgent: false,
  isMobile: false,
  isCustomAgent: false,
  useContextualCoreDocsAutoLoad: false,
  useDocPreviewsForCoreAutoLoad: true
};

const inferencePayload = {
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
  transcript: [
    {
      id: "3c41ea7f-3832-80f5-aac8-00aab5e4a61a",
      type: "config",
      value: configValue
    },
    {
      id: contextMsgId,
      type: "context",
      value: {
        timezone: "America/Caracas",
        userName: "Pedro Rojas",
        userId: USER_ID,
        userEmail: "thekantar0@gmail.com",
        spaceName: "Espacio de Pedro Rojas",
        spaceId: SPACE_ID,
        spaceViewId: "3c41ea7f-3832-8186-b725-0006b69b4fac",
        currentDatetime: isoDate,
        surface: "full_page_chat"
      }
    },
    {
      id: updatedConfigMsgId,
      type: "updated-config"
    },
    {
      id: userMsgId,
      type: "user",
      userId: USER_ID,
      value: [[promptText]],
      createdAt: isoDate
    }
  ]
};

const infRes = await fetch("https://app.notion.com/api/v3/runInferenceTranscript", {
  method: "POST",
  headers: {
    ...commonHeaders,
    "accept": "application/x-ndjson"
  },
  body: JSON.stringify(inferencePayload)
});

console.log(`   Status Inferencia: ${infRes.status} ${infRes.statusText}`);

const reader = infRes.body.getReader();
const decoder = new TextDecoder("utf-8");
let buffer = "";

console.log("\n💬 Respuesta de Notion AI en Streaming:\n");

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
          if (item.type === "chunk" && item.value) {
            process.stdout.write(item.value);
          } else if (item.type === "error") {
            console.log("\n[Error en paso]:", item.message);
          }
        }
      } else if (json.type === "token") {
        process.stdout.write(json.text || "");
      } else {
        // Mostrar eventos del transcript (búsquedas, tools, etc.)
        if (json.type) {
          // Si no es un recordMap gigante, mostrar tipo
          if (json.type !== "record-map") {
            console.log(`\n[Evento]: ${json.type}`);
          }
        }
      }
    } catch {
      process.stdout.write(line);
    }
  }
}

console.log("\n\n✅ Finalizado.");
