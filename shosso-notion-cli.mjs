import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// ==========================================
// SHOSSO NOTION CLI - MODO SILENCIOSO
// Todo pasa por la terminal. Nada en la UI de Notion.
// ==========================================

const NOTION_ORIGIN   = 'https://www.notion.com';
const NOTION_API_BASE = 'https://www.notion.com/api/v3';
const STATE_JSON_PATH = path.join(os.homedir(), 'AppData', 'Roaming', 'Notion', 'state.json');
const CONFIG_DIR      = path.join(os.homedir(), '.bridgemind');
const TOKENS_CONFIG   = path.join(CONFIG_DIR, 'shosso-notion-tokens.json');
const PROJECTS_DIR    = path.join(CONFIG_DIR, 'projects');
const CLIENT_VERSION  = '23.13.20260822.0220';

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m',
  green: '\x1b[32m', cyan: '\x1b[36m', yellow: '\x1b[33m',
  magenta: '\x1b[35m', gray: '\x1b[90m', red: '\x1b[31m'
};

// ---- Argparse ----
const argv = process.argv.slice(2);
let promptText  = '';
let projectName = null;
let targetEmail = null;

for (let i = 0; i < argv.length; i++) {
  if      (argv[i] === '--project' && argv[i+1]) { projectName = argv[++i]; }
  else if (argv[i] === '--account' && argv[i+1]) { targetEmail = argv[++i]; }
  else if (!argv[i].startsWith('--'))             { promptText  = argv[i]; }
}

if (!promptText) {
  console.error(`\n${C.cyan}Uso:${C.reset} node shosso-notion-cli.mjs "Tu prompt" [--project NombreProyecto] [--account email]\n`);
  process.exit(1);
}

// ---- Leer tokens guardados ----
function readTokensConfig() {
  try {
    if (!fs.existsSync(TOKENS_CONFIG)) return { accounts: [] };
    return JSON.parse(fs.readFileSync(TOKENS_CONFIG, 'utf-8'));
  } catch { return { accounts: [] }; }
}

// ---- Detectar cuenta activa ----
// Prioridad: (1) state.json del app Notion Desktop
//            (2) shosso-notion-tokens.json (fallback sin app desktop)
function detectActiveAccount() {
  // 1. Intentar desde state.json (Notion Desktop)
  try {
    const state = JSON.parse(fs.readFileSync(STATE_JSON_PATH, 'utf-8'));
    const seen  = new Map();

    const collect = (s) => {
      if (!s?.currentUserId) return;
      if (!seen.has(s.currentUserId)) {
        seen.set(s.currentUserId, {
          userId:  s.currentUserId,
          spaceId: s.currentSpaceId || '',
          email:   s.currentUserEmail || '',
        });
      }
    };

    for (const win of (state.history?.appRestorationState?.windows || []))
      for (const tab of (win.tabs || [])) collect(tab.appStoreState);
    for (const ev of (state.history?.closeEvents || [])) collect(ev.appStoreState);

    const accounts = [...seen.values()];
    if (accounts.length) {
      if (targetEmail) return accounts.find(a => a.email === targetEmail) || null;
      return accounts[0];
    }
  } catch {
    // state.json no disponible — continuar al fallback
  }

  // 2. Fallback: leer directamente desde tokens config
  try {
    const cfg = readTokensConfig();
    const accounts = cfg.accounts || [];
    if (!accounts.length) return null;

    const match = targetEmail
      ? accounts.find(a => a.email === targetEmail)
      : accounts[0];

    if (!match) return null;

    return {
      userId:   match.user_id  || match.userId  || '',
      spaceId:  match.space_id || match.spaceId || '',
      email:    match.email || '',
      threadId: match.thread_id || match.threadId || null,
    };
  } catch (e) {
    console.error(`${C.red}⚠  tokens config: ${e.message}${C.reset}`);
    return null;
  }
}

// ---- Token desde config ----
function getToken(userId, email) {
  try {
    const cfg = readTokensConfig();
    return cfg.accounts?.find(a => a.user_id === userId || a.email === email)?.token_v2 || null;
  } catch { return null; }
}

// ---- ThreadId desde config (fallback al fijo) ----
function getThreadId(email) {
  try {
    const cfg = readTokensConfig();
    const acc = cfg.accounts?.find(a => a.email === email);
    return acc?.thread_id || acc?.threadId || null;
  } catch { return null; }
}

// ---- Memoria de proyecto ----
function slugify(n) { return n.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''); }

function getProjectMemory(slug) {
  const f = path.join(PROJECTS_DIR, slug, 'memory.md');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf-8') : null;
}

function appendProjectMemory(slug, prompt, response) {
  const dir = path.join(PROJECTS_DIR, slug);
  fs.mkdirSync(dir, { recursive: true });
  const f      = path.join(dir, 'memory.md');
  const header = fs.existsSync(f) ? '' : `# Proyecto: ${projectName}\n\n`;
  const entry  = `## ${new Date().toLocaleString('es-VE')}\n**Prompt:** ${prompt}\n**Respuesta:**\n${response}\n\n---\n\n`;
  fs.appendFileSync(f, header + entry, 'utf-8');
}

// ---- Main ----
async function execute() {
  // 1. Detectar cuenta
  const account = detectActiveAccount();
  if (!account) {
    console.error(`${C.red}❌ No se detectó cuenta activa.\nEjecuta: node shosso-setup.mjs${C.reset}`);
    process.exit(1);
  }

  const token = getToken(account.userId, account.email);
  if (!token) {
    console.error(`${C.red}❌ Sin token para ${account.email}.\nEjecuta: node shosso-setup.mjs${C.reset}`);
    process.exit(1);
  }

  // Usar threadId de la cuenta o generar uno de emergencia
  const THREAD_ID = account.threadId || getThreadId(account.email) || '3c41ea7f-3832-80a0-884f-00a91c630a56';

  console.log(`\n${C.cyan}${C.bold}╔══ SHOSSO NOTION CLI ═══════════════════════════════╗${C.reset}`);
  console.log(`${C.cyan}  Cuenta  :${C.reset} ${account.email}`);
  console.log(`${C.cyan}  User ID :${C.reset} ${account.userId}`);
  console.log(`${C.cyan}  Space ID:${C.reset} ${account.spaceId}`);
  console.log(`${C.cyan}  Thread  :${C.reset} ${THREAD_ID}`);
  console.log(`${C.cyan}  Modo    :${C.reset} ${C.bold}SILENCIOSO${C.reset} - nada llega a la UI de Notion`);
  if (projectName) console.log(`${C.cyan}  Proyecto:${C.reset} ${projectName}`);
  console.log(`${C.cyan}  Prompt  :${C.reset} "${promptText}"`);
  console.log(`${C.cyan}${C.bold}╚═════════════════════════════════════════════════════╝${C.reset}\n`);

  const USER_ID  = account.userId;
  const SPACE_ID = account.spaceId;

  const cookie = [
    `token_v2=${token}`,
    `notion_user_id=${USER_ID}`,
    `notion_users=[%22${USER_ID}%22]`,
  ].join('; ');

  const headers = {
    'content-type':                'application/json',
    'origin':                      NOTION_ORIGIN,
    'referer':                     `${NOTION_ORIGIN}/chat?t=${THREAD_ID}`,
    'notion-audit-log-platform':   'web',
    'notion-client-version':       CLIENT_VERSION,
    'x-notion-active-user-header': USER_ID,
    'x-notion-space-id':           SPACE_ID,
    'user-agent':                  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
    'Cookie':                      cookie,
  };

  // 2. Construir transcript
  const isoDate = new Date().toISOString();

  let memoryContext = '';
  let projectSlug   = null;
  if (projectName) {
    projectSlug  = slugify(projectName);
    const memory = getProjectMemory(projectSlug);
    if (memory) {
      memoryContext = `\n\n=== MEMORIA DEL PROYECTO: ${projectName} ===\n${memory}\n=== FIN MEMORIA ===`;
      console.log(`${C.gray}📝 Memoria cargada: ${memory.length} chars${C.reset}\n`);
    }
  }

  const transcript = [
    {
      id:   randomUUID(),
      type: 'context',
      value: {
        userId:          USER_ID,
        spaceId:         SPACE_ID,
        surface:         'full_page_chat',
        timezone:        'America/Caracas',
        userName:        account.email.split('@')[0],
        spaceName:       'NotionAI Space',
        userEmail:       account.email,
        spaceViewId:     THREAD_ID,
        currentDatetime: isoDate,
        ...(memoryContext ? { additionalContext: memoryContext } : {}),
      },
    },
    { id: randomUUID(), type: 'updated-config' },
    {
      id:        randomUUID(),
      type:      'user',
      userId:    USER_ID,
      value:     [[promptText]],
      createdAt: isoDate,
    },
  ];

  // 3. Inferencia silenciosa
  //    saveAllThreadOperations: false  -> nada se escribe al thread
  //    setUnreadState: false           -> no marca como no leído
  //    isPartialTranscript: true       -> usamos nuestro propio transcript
  process.stdout.write(`${C.gray}⚡ Conectando con Notion AI... ${C.reset}`);

  const res = await fetch(`${NOTION_API_BASE}/runAi`, {
    method:  'POST',
    headers: { ...headers, accept: 'application/x-ndjson' },
    body: JSON.stringify({
      traceId:                                randomUUID(),
      spaceId:                                SPACE_ID,
      threadId:                               THREAD_ID,
      createThread:                           false,
      debugOverrides: {
        emitAgentSearchExtractedResults:      true,
        cachedInferences:                     {},
        annotationInferences:                 {},
        emitInferences:                       false,
      },
      generateTitle:                          false,
      saveAllThreadOperations:                false,
      setUnreadState:                         false,
      createdSource:                          'ai_module',
      threadType:                             'workflow',
      isPartialTranscript:                    true,
      asPatchResponse:                        true,
      patchResponseVersion:                   2,
      isUserInAnySalesAssistedSpace:          false,
      isSpaceSalesAssisted:                   false,
      supportsCustomAgentNudgeTranscriptStep: true,
      transcript,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.log(`${C.red}ERROR HTTP ${res.status}${C.reset}`);
    console.error(body.slice(0, 800));
    process.exit(1);
  }
  console.log(`${C.green}OK${C.reset}\n`);

  // 4. Stream de respuesta
  const reader  = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buf          = '';
  let inThinking   = false;
  let hasOutput    = false;
  let fullResponse = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const j = JSON.parse(line);

        if (j.type === 'patch-start' && j.data?.s) {
          for (const item of j.data.s) {
            if (item.type === 'error') {
              console.log(`\n${C.yellow}[Notion Error]: ${item.message} (${item.subType || ''})${C.reset}`);
            }
            if (item.step?.type === 'thinking' || item.thinking) {
              if (!inThinking) {
                process.stdout.write(`\n${C.magenta}${C.bold}🧠 Pensando...${C.reset}\n`);
                inThinking = true;
              }
              const t = item.thinking || item.step?.value || item.delta || '';
              process.stdout.write(`${C.gray}${t}${C.reset}`);
              hasOutput = true;
            }
            if (item.type === 'chunk' || item.type === 'text' ||
                item.delta || (item.value && typeof item.value === 'string')) {
              if (inThinking) {
                process.stdout.write(`\n\n${C.green}${C.bold}💬 Respuesta:${C.reset}\n\n`);
                inThinking = false;
              }
              const chunk = item.value || item.delta || item.text || '';
              if (chunk) {
                process.stdout.write(chunk);
                fullResponse += chunk;
                hasOutput = true;
              }
            }
          }
        } else if (j.type === 'token') {
          const t = j.text || '';
          process.stdout.write(t);
          fullResponse += t;
          hasOutput = true;
        }
      } catch { /* ignorar líneas no-JSON */ }
    }
  }

  if (!hasOutput) {
    console.log(`\n${C.yellow}⚠  Sin respuesta. Verifica el token: node shosso-setup.mjs${C.reset}`);
    process.exit(1);
  }

  console.log(`\n\n${C.green}${C.bold}✅ Completado.${C.reset} ${C.gray}(Notion UI no fue modificada)${C.reset}\n`);

  if (projectSlug && fullResponse.trim()) {
    appendProjectMemory(projectSlug, promptText, fullResponse.trim());
    console.log(`${C.cyan}💾 Memoria del proyecto "${projectName}" actualizada.${C.reset}\n`);
  }
}

execute().catch(err => {
  console.error(`${C.red}❌ Error: ${err.message}${C.reset}`);
  process.exit(1);
});
