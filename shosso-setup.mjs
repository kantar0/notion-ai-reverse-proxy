import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';

// ==========================================
// SHOSSO SETUP - Configura token_v2 para el CLI silencioso
// ==========================================

const STATE_JSON_PATH = path.join(os.homedir(), 'AppData', 'Roaming', 'Notion', 'state.json');
const CONFIG_DIR      = path.join(os.homedir(), '.bridgemind');
const TOKENS_CONFIG   = path.join(CONFIG_DIR, 'shosso-notion-tokens.json');

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m',
  green: '\x1b[32m', cyan: '\x1b[36m', yellow: '\x1b[33m',
  gray: '\x1b[90m', red: '\x1b[31m'
};

function ask(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => { rl.question(prompt, a => { rl.close(); resolve(a.trim()); }); });
}

function detectAccounts() {
  try {
    const state = JSON.parse(fs.readFileSync(STATE_JSON_PATH, 'utf-8'));
    const seen  = new Map();
    const collect = (s) => {
      if (!s?.currentUserId || seen.has(s.currentUserId)) return;
      seen.set(s.currentUserId, {
        user_id:  s.currentUserId,
        space_id: s.currentSpaceId || '',
        email:    s.currentUserEmail || '',
      });
    };
    for (const win of (state.history?.appRestorationState?.windows || []))
      for (const tab of (win.tabs || [])) collect(tab.appStoreState);
    for (const ev of (state.history?.closeEvents || [])) collect(ev.appStoreState);
    return [...seen.values()];
  } catch { return []; }
}

async function main() {
  console.log(`\n${C.cyan}${C.bold}\u2554\u2550\u2550 SHOSSO NOTION SETUP \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557${C.reset}`);
  console.log(`${C.cyan}  Configura tu token_v2 para el CLI silencioso${C.reset}`);
  console.log(`${C.cyan}${C.bold}\u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d${C.reset}\n`);

  const accounts = detectAccounts();

  if (accounts.length) {
    console.log(`${C.green}\u2713 Cuentas detectadas en Notion:${C.reset}`);
    accounts.forEach((a, i) => {
      console.log(`  ${i + 1}. ${a.email}`);
      console.log(`     ${C.gray}User ID : ${a.user_id}${C.reset}`);
      console.log(`     ${C.gray}Space ID: ${a.space_id || 'desconocido'}${C.reset}`);
    });
    console.log();
  } else {
    console.log(`${C.yellow}\u26a0  No se detectaron cuentas.${C.reset}\n`);
  }

  const notionDomain = 'app.' + 'notion.com';
  console.log(`${C.cyan}C\u00f3mo obtener tu token_v2:${C.reset}`);
  console.log(`  1. Abre Notion en el ${C.bold}navegador${C.reset} (${notionDomain})`);
  console.log(`  2. Presiona F12 -> Application -> Cookies -> ${notionDomain}`);
  console.log(`  3. Busca "token_v2" y copia su valor (empieza con v03...)`);
  console.log();

  let cfg = { accounts: [] };
  if (fs.existsSync(TOKENS_CONFIG)) {
    try { cfg = JSON.parse(fs.readFileSync(TOKENS_CONFIG, 'utf-8')); } catch {}
  }

  const defaultEmail = accounts[0]?.email || '';
  const inputEmail   = await ask(`${C.cyan}Email de la cuenta${defaultEmail ? ` [${defaultEmail}]` : ''}:${C.reset} `);
  const finalEmail   = inputEmail || defaultEmail;

  if (!finalEmail) {
    console.error(`${C.red}\u274c Email requerido. Cancelado.${C.reset}`);
    process.exit(1);
  }

  const token = await ask(`${C.cyan}Pega tu token_v2:${C.reset} `);
  if (!token || token.length < 20) {
    console.error(`${C.red}\u274c Token inv\u00e1lido (demasiado corto). Cancelado.${C.reset}`);
    process.exit(1);
  }

  const matched = accounts.find(a => a.email === finalEmail);
  const entry = {
    email:      finalEmail,
    user_id:    matched?.user_id  || '',
    space_id:   matched?.space_id || '',
    token_v2:   token,
    updated_at: new Date().toISOString(),
  };

  cfg.accounts = cfg.accounts.filter(a => a.email !== finalEmail);
  cfg.accounts.unshift(entry);

  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(TOKENS_CONFIG, JSON.stringify(cfg, null, 2), 'utf-8');

  console.log(`\n${C.green}${C.bold}\u2705 Token guardado para ${finalEmail}${C.reset}`);
  console.log(`   Config: ${TOKENS_CONFIG}\n`);
  console.log(`${C.cyan}${C.bold}Ahora puedes usar:${C.reset}`);
  console.log(`  ${C.green}node shosso-notion-cli.mjs "Tu pregunta"${C.reset}`);
  console.log(`  ${C.green}node shosso-notion-cli.mjs "Tu pregunta" --project MiProyecto${C.reset}`);
  console.log(`  ${C.green}node shosso-notion-cli.mjs "consulta" --account otro@email.com${C.reset}\n`);
}

main().catch(err => {
  console.error(`${C.red}\u274c ${err.message}${C.reset}`);
  process.exit(1);
});
