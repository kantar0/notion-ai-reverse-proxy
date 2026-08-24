import { randomUUID } from "node:crypto";
import { createBrotliDecompress } from "node:zlib";
import { Readable } from "node:stream";

const NOTION_TOKEN = "v03%3AeyJhbGciOiJkaXIiLCJraWQiOiJwcm9kdWN0aW9uOnRva2VuLXYzOjIwMjQtMTEtMDciLCJlbmMiOiJBMjU2Q0JDLUhTNTEyIn0..tLirmMqlrahlbdhXpyysRw.deO6-nhMDDBVjXGA3Bq9S-FZct2bK79ka140voiiA02jmWRhETm_7LzNO107N_RUUrsiaY1OlMlMgj43p4RjVf12ipQHv5RKhx1sWuYGzQF5MUw-0RTi_3v8OpkR5e_pSreyEPAp2pyChYgdy1v_4G4XF-XO6pEV2A8_Uvwut5maO0Mr1VEllEMxp3ig1TA7mxdl0Own5LsRofLQjaP4dgYetGN1NT9MpUrSBaYk8l6YbQJ2X9LxVVSf3z7dGGv_UawLN7BE8SMdufPJh5lrtAzyfnlftuKhu0095MjqSI1qXhdo4b-P6f-Iek-Fm89P3h6D1BECQmPIdkqGvUMkbcdNy3tg74HbmHDTOfsnkps.2KgAtxvbBydeiaAixwhHhzNQf3iwDzzCncc5japKPzU";
const USER_ID = "646357f5-4b41-4f62-8767-b25670188037";
const SPACE_ID = "20a1ea7f-3832-81fb-a0a2-0003aeeff04b";
const CLIENT_VERSION = "23.13.20260822.0220";

const promptText = process.argv[2] || "¿Cuál es la capital de España?";

console.log(`\n🚀 Enviando prompt a Notion AI: "${promptText}"\n`);

const newThreadId = randomUUID();
const traceId = randomUUID();
const configStepId = randomUUID();
const contextStepId = randomUUID();
const userStepId = randomUUID();
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
  "referer": `https://app.notion.com/chat?t=${newThreadId}`,
  "notion-audit-log-platform": "web",
  "notion-client-version": CLIENT_VERSION,
  "x-notion-active-user-header": USER_ID,
  "x-notion-space-id": SPACE_ID,
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
  "Cookie": cookieHeader
};

// 1. Crear el thread
console.log("📝 [1/2] Creando Thread en Notion...");

await fetch("https://app.notion.com/api/v3/saveTransactionsFanout", {
  method: "POST",
  headers: commonHeaders,
  body: JSON.stringify({
    requestId: randomUUID(),
    transactions: [{
      id: randomUUID(),
      spaceId: SPACE_ID,
      debug: { userAction: "WorkflowActions.createNewThread", clientCommitTimeMs: now },
      operations: [
        {
          pointer: { table: "thread", id: newThreadId, spaceId: SPACE_ID },
          path: [],
          command: "set",
          args: {
            id: newThreadId,
            version: 1,
            parent_id: SPACE_ID,
            parent_table: "space",
            space_id: SPACE_ID,
            alive: true,
            type: "workflow",
            created_source: "ai_module",
            created_time: now,
            created_by_id: USER_ID,
            created_by_table: "notion_user",
            updated_time: now,
            updated_by_id: USER_ID,
            updated_by_table: "notion_user",
            messages: [configStepId, contextStepId, userStepId]
          }
        },
        {
          pointer: { table: "thread_message", id: configStepId, spaceId: SPACE_ID },
          path: [],
          command: "set",
          args: {
            id: configStepId,
            version: 1,
            step: {
              id: configStepId,
              type: "config",
              value: {
                type: "workflow",
                model: "fireworks-kimi-k3",
                reasoningEffort: "max",
                modelFromUser: true,
                useWebSearch: true,
                enableMarkdownVNext: true
              }
            },
            parent_id: newThreadId,
            parent_table: "thread",
            space_id: SPACE_ID,
            created_time: now,
            created_by_id: USER_ID,
            created_by_table: "notion_user"
          }
        },
        {
          pointer: { table: "thread_message", id: contextStepId, spaceId: SPACE_ID },
          path: [],
          command: "set",
          args: {
            id: contextStepId,
            version: 1,
            step: {
              id: contextStepId,
              type: "context",
              value: {
                timezone: "America/Caracas",
                userName: "Pedro Rojas",
                userId: USER_ID,
                userEmail: "thekantar0@gmail.com",
                spaceName: "Espacio de Pedro Rojas",
                spaceId: SPACE_ID,
                currentDatetime: isoDate,
                surface: "full_page_chat"
              }
            },
            parent_id: newThreadId,
            parent_table: "thread",
            space_id: SPACE_ID,
            created_time: now,
            created_by_id: USER_ID,
            created_by_table: "notion_user"
          }
        },
        {
          pointer: { table: "thread_message", id: userStepId, spaceId: SPACE_ID },
          path: [],
          command: "set",
          args: {
            id: userStepId,
            version: 1,
            step: {
              id: userStepId,
              type: "user",
              userId: USER_ID,
              value: [[promptText]],
              createdAt: isoDate
            },
            parent_id: newThreadId,
            parent_table: "thread",
            space_id: SPACE_ID,
            created_time: now,
            created_by_id: USER_ID,
            created_by_table: "notion_user"
          }
        }
      ]
    }]
  })
});

// 2. Disparar inferencia
console.log("⚡ [2/2] Invocando runInferenceTranscript...");

const infRes = await fetch("https://app.notion.com/api/v3/runInferenceTranscript", {
  method: "POST",
  headers: {
    ...commonHeaders,
    "accept": "application/x-ndjson",
    "accept-encoding": "identity" // Pedimos texto plano sin compresión o lo manejamos
  },
  body: JSON.stringify({
    traceId,
    spaceId: SPACE_ID,
    threadId: newThreadId,
    createThread: true,
    debugOverrides: {
      emitAgentSearchExtractedResults: true,
      cachedInferences: {},
      annotationInferences: {},
      emitInferences: false
    },
    generateTitle: true,
    saveAllThreadOperations: true,
    setUnreadState: true,
    createdSource: "ai_module",
    threadType: "workflow",
    isPartialTranscript: false,
    asPatchResponse: true,
    patchResponseVersion: 2,
    isUserInAnySalesAssistedSpace: false,
    isSpaceSalesAssisted: false,
    supportsCustomAgentNudgeTranscriptStep: true,
    transcript: [
      {
        id: configStepId,
        type: "config",
        value: {
          type: "workflow",
          model: "fireworks-kimi-k3",
          reasoningEffort: "max",
          modelFromUser: true,
          useWebSearch: true,
          enableMarkdownVNext: true
        }
      },
      {
        id: contextStepId,
        type: "context",
        value: {
          timezone: "America/Caracas",
          userName: "Pedro Rojas",
          userId: USER_ID,
          userEmail: "thekantar0@gmail.com",
          spaceName: "Espacio de Pedro Rojas",
          spaceId: SPACE_ID,
          currentDatetime: isoDate,
          surface: "full_page_chat"
        }
      },
      {
        id: userStepId,
        type: "user",
        userId: USER_ID,
        value: [[promptText]],
        createdAt: isoDate
      }
    ]
  })
});

const contentEncoding = infRes.headers.get("content-encoding");
let nodeStream = Readable.fromWeb(infRes.body);

if (contentEncoding === "br") {
  nodeStream = nodeStream.pipe(createBrotliDecompress());
}

console.log("\n💬 Respuesta de Notion AI:\n---");

nodeStream.on("data", (chunk) => {
  const text = chunk.toString("utf-8");
  console.log("\n[RAW CHUNK RECEIVED]:\n", text);
});

nodeStream.on("end", () => {
  console.log("\n---\n✅ Streaming finalizado.");
});
