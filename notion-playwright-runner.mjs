import { chromium } from "playwright";

const NOTION_TOKEN = "v03%3AeyJhbGciOiJkaXIiLCJraWQiOiJwcm9kdWN0aW9uOnRva2VuLXYzOjIwMjQtMTEtMDciLCJlbmMiOiJBMjU2Q0JDLUhTNTEyIn0..X_9P9HPA5B2Y7YmMNeATYg.EeuOzMDW95Ghkj52lsSfI2HkKXgtz1s8XLMENetGYzpi6zdqSFJIC0fcX-rYD9nDH2cz_jDdQzBTGKOkv5eRMQP2xph9KZdxuGeAGCKymay8oG_hDdO1_Sakj9wEXzdA7_D7Zoz9ZZHHT2uc-pHZFRMKCuECbtlvxKyffaCaHZxXszbZsUVv30Jl94BiytmH9Ik-kJqTV0_SR0NmMZVOnO_QjRVLuaiZn0AVpIVBnzKsoumMwVT8b3Tf7r8tuuAyGx-rxsHjn61K2ybKcY0qyZmiP2O4kI0_AaTDhFaIPL7PT-ohr48sMgmSwStS5QaXVMnHrjrOIKd8FMw0UXL39CVbTqn_N0Gu05-0gdiaxlM.8xXaK1QOxQWgjtpLh0oRBykty9xIch2z2EDwOiN4hus";
const USER_ID = "646357f5-4b41-4f62-8767-b25670188037";
const THREAD_ID = "3c41ea7f-3832-80a0-884f-00a91c630a56";

const promptText = process.argv[2] || "Hola Kimi, salúdame y dime qué modelo de IA eres.";

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

console.log(`\n${ANSI.cyan}${ANSI.bold}🚀 Iniciando sesión de navegador real (Playwright)...${ANSI.reset}`);

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"]
});

const context = await browser.newContext({
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  viewport: { width: 1280, height: 800 }
});

// Inyectar cookie de sesión
await context.addCookies([
  {
    name: "token_v2",
    value: NOTION_TOKEN,
    domain: ".notion.so",
    path: "/"
  },
  {
    name: "token_v2",
    value: NOTION_TOKEN,
    domain: ".notion.com",
    path: "/"
  },
  {
    name: "notion_user_id",
    value: USER_ID,
    domain: ".notion.so",
    path: "/"
  },
  {
    name: "notion_user_id",
    value: USER_ID,
    domain: ".notion.com",
    path: "/"
  }
]);

const page = await context.newPage();

console.log(`${ANSI.gray}🌐 Abriendo Notion Chat en segundo plano...${ANSI.reset}`);
await page.goto(`https://app.notion.com/chat?t=${THREAD_ID}`, {
  waitUntil: "domcontentloaded",
  timeout: 30000
});

// Esperar que la interfaz y los WebSockets se estabilicen
console.log(`${ANSI.gray}⏳ Esperando conexión de WebSockets de Notion...${ANSI.reset}`);
await page.waitForTimeout(4000);

// Exponer función para recibir streaming en Node.js
await page.exposeFunction("onChunk", (chunk) => {
  process.stdout.write(chunk);
});

await page.exposeFunction("onThinking", (thought) => {
  process.stdout.write(`${ANSI.gray}${thought}${ANSI.reset}`);
});

await page.exposeFunction("onStatus", (msg) => {
  console.log(msg);
});

console.log(`\n${ANSI.cyan}${ANSI.bold}💬 Enviando prompt:${ANSI.reset} "${promptText}"\n---`);

const result = await page.evaluate(async (prompt) => {
  // Buscar el input del chat de Notion y escribir
  const textarea = document.querySelector('div[contenteditable="true"]') || document.querySelector("textarea");
  
  if (textarea) {
    textarea.focus();
    // Simular escritura de usuario
    document.execCommand("insertText", false, prompt);
    await new Promise((r) => setTimeout(r, 500));
    
    // Presionar Enter
    const enterEvent = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13
    });
    textarea.dispatchEvent(enterEvent);
    return { method: "ui_interaction", success: true };
  } else {
    return { method: "ui_not_found", success: false };
  }
}, promptText);

console.log(`${ANSI.gray}Interacción enviada (${result.method}). Esperando respuesta del modelo...${ANSI.reset}\n`);

// Observar la respuesta generada en el DOM
let lastText = "";
let stableCount = 0;
const maxWaitSeconds = 45;

for (let i = 0; i < maxWaitSeconds * 2; i++) {
  await page.waitForTimeout(500);

  const responseState = await page.evaluate(() => {
    // Buscar el último bloque de respuesta generado por la IA
    const messages = Array.from(document.querySelectorAll('[data-content-editable-root="true"], .notion-text-block, [role="region"]'));
    const allText = document.body.innerText;
    return { allText: allText.slice(-1500) };
  });

  if (responseState.allText !== lastText) {
    const diff = responseState.allText.slice(lastText.length);
    if (diff) {
      process.stdout.write(diff);
    }
    lastText = responseState.allText;
    stableCount = 0;
  } else if (lastText.length > 0) {
    stableCount++;
    if (stableCount > 8) {
      // 4 segundos sin cambios = terminó de responder
      break;
    }
  }
}

console.log(`\n---\n${ANSI.green}✅ Turno finalizado con éxito.${ANSI.reset}`);

await browser.close();
