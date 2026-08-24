import { randomUUID } from "node:crypto";

const cookieHeader = `notion_browser_id=c5c98da8-f31d-4004-a4a0-8f817efde05e; notion_check_cookie_consent=false; device_id=3c4d872b-594c-81b6-bf6b-003b79a286df; _gcl_au=1.1.904520406.1787379243; _ga=GA1.1.434490320.1787379244; _fbp=fb.1.1787379244302.605442743265446432; _ga_9ZJ8CB186L=GS2.1.s1787379243$o1$g1$t1787379252$j51$l0$h0; notion_user_id=646357f5-4b41-4f62-8767-b25670188037; notion_sync_user_id=%7B%22notion_user_id%22%3A%22646357f5-4b41-4f62-8767-b25670188037%22%2C%22is_logged_in%22%3Atrue%2C%22device_id%22%3A%22c5c98da8-f31d-4004-a4a0-8f817efde05e%22%2C%22version%22%3A4%7D; NEXT_LOCALE=en-US; p_sync_session=%7B%22tokenId%22%3A%22v02%3Async_session%3AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKiKbi5SMMNkkrJG3UfWiP7u9h-MytbYGKknbSPCj2F07ufgzyXVLfJgMcvr1LYLZ2CxhhjH8mcbcns5g2o4ZEnCBgJjuh7l7OAVt%22%2C%22userIds%22%3A%5B%22646357f5-4b41-4f62-8767-b25670188037%22%5D%7D; _cioid=646357f54b414f628767b25670188037; notion_locale=en-US/legacy; notion_users=[%22646357f5-4b41-4f62-8767-b25670188037%22]; _cfuvid=kjAGLcBhF1tVmS3p_VjJdixMDFxu_E5oPmnWIThZ.ek-1787382280.1363142-1.0.1.1-ZtecjD0WjsunNLSN7u.h9GYOdvfqyf2LHpDCqiDEZ_U; token_v2=v03%3AeyJhbGciOiJkaXIiLCJraWQiOiJwcm9kdWN0aW9uOnRva2VuLXYzOjIwMjQtMTEtMDciLCJlbmMiOiJBMjU2Q0JDLUhTNTEyIn0..X_9P9HPA5B2Y7YmMNeATYg.EeuOzMDW95Ghkj52lsSfI2HkKXgtz1s8XLMENetGYzpi6zdqSFJIC0fcX-rYD9nDH2cz_jDdQzBTGKOkv5eRMQP2xph9KZdxuGeAGCKymay8oG_hDdO1_Sakj9wEXzdA7_D7Zoz9ZZHHT2uc-pHZFRMKCuECbtlvxKyffaCaHZxXszbZsUVv30Jl94BiytmH9Ik-kJqTV0_SR0NmMZVOnO_QjRVLuaiZn0AVpIVBnzKsoumMwVT8b3Tf7r8tuuAyGx-rxsHjn61K2ybKcY0qyZmiP2O4kI0_AaTDhFaIPL7PT-ohr48sMgmSwStS5QaXVMnHrjrOIKd8FMw0UXL39CVbTqn_N0Gu05-0gdiaxlM.8xXaK1QOxQWgjtpLh0oRBykty9xIch2z2EDwOiN4hus; __cf_bm=q6f30uLpDzMRm0yffwiXGa1NaSNYFM9dTHKZKwEJIUI-1787383209.736305-1.0.1.1-Uhrh1JyKz.fUUgFWwcjJEVI6YY9.OQoDxJ3.nmE6KmrAFY7ueeY1Wx_nBKQd26imsxI2eFQX1T_WwRCfD02e96OTIk1K40yenBypeQusDOdDAu9UpeCvZ6sy9IORBGae`;

const promptText = process.argv[2] || "Escribe un saludo corto para Pedro";

const configValue = {
  type: "workflow",
  model: "fireworks-kimi-k3",
  isHipaa: false,
  isMobile: false,
  writerMode: false,
  searchScopes: [{ type: "everything" }],
  useWebSearch: true,
  isCustomAgent: false,
  manageWorkers: false,
  modelFromUser: true,
  enableComputer: false,
  internetAccess: false,
  enableQueryMail: false,
  reasoningEffort: "max",
  useReadOnlyMode: false,
  enableAgentDiffs: true,
  enableScriptAgent: true,
  enableWebResearch: false,
  isOnboardingAgent: false,
  enableCustomAgents: true,
  enableAgentSkillsV2: true,
  enableMarkdownVNext: true,
  enableQueryCalendar: false,
  isCustomAgentCreate: false,
  useCustomAgentDraft: false,
  enableAgentAskSurvey: true,
  enableCrdtOperations: false,
  enableScriptAgentGtm: false,
  isCustomAgentBuilder: false,
  useRulePrioritization: true,
  enableAgentAutomations: true,
  enableAgentThreadTools: false,
  enableScriptAgentSlack: true,
  isAgentResearchRequest: false,
  databaseAgentConfigMode: false,
  enableAgentIntegrations: true,
  enableAgentGenerateImage: false,
  enableSystemPromptAsPage: false,
  enableUserSessionContext: false,
  enableScriptAgentAdvanced: false,
  enableSoftwareFactoryPage: false,
  enableSuggestedEditsTools: true,
  enableCsvAttachmentSupport: true,
  enableNotionMailDeprecated: false,
  enableSkillsInCustomAgents: false,
  enableMailExplicitToolCalls: true,
  enableScriptAgentMcpServers: true,
  enableAgentCardCustomization: true,
  enableUpdatePageOrderUpdates: true,
  useContextualCoreDocsAutoLoad: false,
  useDocPreviewsForCoreAutoLoad: true,
  enableExperimentalIntegrations: false,
  updatePageStaleViewGuardEnabled: true,
  enableAgentSupportPropertyReorder: true,
  enableCustomAgentCreateGuidanceV2: true,
  enableMailNotificationPreferences: false,
  showDatabaseAgentsDiscoverability: false,
  enableMailAgentMultiProviderSupport: true,
  enableLargeToolResultComputerOffload: false,
  enableScriptAgentGoogleDriveInCustomAgent: false,
  enableScriptAgentGoogleDriveOAuthInCustomAgent: false,
  enableScriptAgentSearchConnectorsInCustomAgent: false
};

const userMsgId = randomUUID();
const contextMsgId = randomUUID();
const updatedConfigMsgId = randomUUID();
const now = Date.now();
const isoDate = new Date().toISOString();

const SPACE_ID = "20a1ea7f-3832-81fb-a0a2-0003aeeff04b";
const THREAD_ID = "3c41ea7f-3832-80a0-884f-00a91c630a56";
const USER_ID = "646357f5-4b41-4f62-8767-b25670188037";

// 1. Guardar mensaje
await fetch("https://app.notion.com/api/v3/saveTransactionsFanout", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "origin": "https://app.notion.com",
    "referer": `https://app.notion.com/chat?t=${THREAD_ID}`,
    "notion-audit-log-platform": "web",
    "notion-client-version": "23.13.20260822.0220",
    "x-notion-active-user-header": USER_ID,
    "x-notion-space-id": SPACE_ID,
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    "Cookie": cookieHeader
  },
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
            step: {
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
            step: { id: updatedConfigMsgId, type: "updated-config" },
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
    }]
  })
});

// 2. Inferencia
const res = await fetch("https://app.notion.com/api/v3/runInferenceTranscript", {
  method: "POST",
  headers: {
    "accept": "application/x-ndjson",
    "content-type": "application/json",
    "origin": "https://app.notion.com",
    "referer": `https://app.notion.com/chat?t=${THREAD_ID}`,
    "notion-audit-log-platform": "web",
    "notion-client-version": "23.13.20260822.0220",
    "x-notion-active-user-header": USER_ID,
    "x-notion-space-id": SPACE_ID,
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    "Cookie": cookieHeader
  },
  body: JSON.stringify({
    traceId: randomUUID(),
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
  })
});

console.log("Status:", res.status);
const reader = res.body.getReader();
const decoder = new TextDecoder();
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
