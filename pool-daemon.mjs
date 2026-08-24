import { createOutlookAccountWithProxy } from './outlook-creator.mjs';
import { authenticateNotionWithOTP } from './notion-authenticator.mjs';
import fs from 'fs';
import path from 'path';

const INTERVAL_MINUTES = parseInt(process.env.INTERVAL_MINS || '10', 10);
const PROXIES_FILE = path.join(process.cwd(), 'proxies.txt');

function loadProxies() {
  if (fs.existsSync(PROXIES_FILE)) {
    return fs
      .readFileSync(PROXIES_FILE, 'utf-8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#'));
  }
  return [];
}

async function runCycle(proxy = null) {
  console.log(`\n===================================================`);
  console.log(`🔄 [Auto-Pool Manager] Iniciando ciclo de cuenta...`);
  console.log(`⏱️ Hora: ${new Date().toLocaleString()}`);
  console.log(`===================================================`);

  try {
    // 1. Crear cuenta de Outlook
    const account = await createOutlookAccountWithProxy(proxy);

    if (account.status === 'success') {
      console.log(`✅ Cuenta Outlook ${account.email} creada con éxito.`);
      // 2. Aquí se dispara el flujo con Notion
    } else {
      console.log(`⚠️ Estado creación Outlook: ${account.status}. Esperando siguiente intervalo...`);
    }
  } catch (error) {
    console.error(`❌ Error en ciclo: ${error.message}`);
  }
}

async function startLoop() {
  console.log(`🚀 Daemon de Aprovisionamiento Automático iniciado.`);
  console.log(`⏳ Frecuencia de generación: Cada ${INTERVAL_MINUTES} minutos.`);

  const proxies = loadProxies();
  let proxyIdx = 0;

  while (true) {
    const currentProxy = proxies.length > 0 ? proxies[proxyIdx % proxies.length] : null;
    await runCycle(currentProxy);
    proxyIdx++;

    console.log(`😴 Esperando ${INTERVAL_MINUTES} minutos para el siguiente intento...\n`);
    await new Promise((r) => setTimeout(r, INTERVAL_MINUTES * 60 * 1000));
  }
}

if (process.argv[1] && process.argv[1].endsWith('pool-daemon.mjs')) {
  startLoop();
}
