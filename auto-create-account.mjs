import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const MAILTM_API = 'https://api.mail.tm';
const TOKENS_FILE = path.join(process.cwd(), 'tokens.json');

// Helper para llamadas fetch a Mail.tm
async function mailtmRequest(endpoint, method = 'GET', data = null, token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const options = { method, headers };
  if (data) options.body = JSON.stringify(data);

  const res = await fetch(`${MAILTM_API}${endpoint}`, options);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Mail.tm error [${res.status}]: ${err}`);
  }
  return res.json();
}

async function createTempEmail() {
  // 1. Obtener dominios disponibles
  const domainsRes = await mailtmRequest('/domains');
  if (!domainsRes['hydra:member'] || domainsRes['hydra:member'].length === 0) {
    throw new Error('No hay dominios disponibles en Mail.tm');
  }
  const domain = domainsRes['hydra:member'][0].domain;
  const username = `notion_${Math.random().toString(36).substring(2, 10)}`;
  const email = `${username}@${domain}`;
  const password = `Kiw!Pass${Math.random().toString(36).substring(2, 8)}#2026`;

  // 2. Crear cuenta de correo
  await mailtmRequest('/accounts', 'POST', { address: email, password });

  // 3. Obtener token de acceso
  const tokenRes = await mailtmRequest('/token', 'POST', { address: email, password });
  const authToken = tokenRes.token;

  return { email, password, authToken };
}

async function waitForVerificationCode(authToken, maxWaitSecs = 60) {
  console.log('⏳ Esperando código de verificación en el buzón...');
  const start = Date.now();
  while ((Date.now() - start) / 1000 < maxWaitSecs) {
    const messagesRes = await mailtmRequest('/messages', 'GET', null, authToken);
    const messages = messagesRes['hydra:member'] || [];

    if (messages.length > 0) {
      const msgId = messages[0].id;
      const msgDetails = await mailtmRequest(`/messages/${msgId}`, 'GET', null, authToken);
      const subject = msgDetails.subject || '';
      const text = msgDetails.text || msgDetails.intro || '';

      console.log(`📩 Mensaje recibido: "${subject}"`);

      // Extraer código de 6 dígitos o magic link
      // Notion suele enviar: "Tu código de acceso es: 123456" o en el subject "123-456 es tu código"
      const match = text.match(/\b\d{6}\b/) || subject.match(/\b\d{6}\b/);
      if (match) {
        return match[0];
      }

      // Si viene con guión tipo 123-456
      const hyphenMatch = text.match(/\b(\d{3})-(\d{3})\b/) || subject.match(/\b(\d{3})-(\d{3})\b/);
      if (hyphenMatch) {
        return `${hyphenMatch[1]}${hyphenMatch[2]}`;
      }
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('Tiempo de espera agotado para el código de confirmación.');
}

async function registerNotionAccount(headless = true) {
  console.log('🚀 Iniciando creación de cuenta automatizada para Notion AI...');

  // 1. Crear email temporal
  const { email, password, authToken } = await createTempEmail();
  console.log(`✉️ Email temporal creado: ${email}`);

  // 2. Lanzar navegador
  const browser = await chromium.launch({
    headless: headless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--window-size=1280,800',
    ],
  });

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    locale: 'es-ES',
    timezoneId: 'America/Caracas',
  });

  const page = await context.newPage();

  try {
    console.log('🌐 Navegando a https://www.notion.so/signup...');
    await page.goto('https://www.notion.so/signup', { waitUntil: 'networkidle', timeout: 30000 });

    // Ingresar email
    const emailInputSelector = 'input[type="email"], input[name="email"], #notion-email-input-1';
    await page.waitForSelector(emailInputSelector, { timeout: 15000 });
    await page.fill(emailInputSelector, email);
    await page.keyboard.press('Enter');

    console.log('📬 Formulario enviado, esperando correo de verificación...');

    // Esperar código desde mail.tm
    const code = await waitForVerificationCode(authToken, 60);
    console.log(`🔑 Código de verificación obtenido: ${code}`);

    // Ingresar código en Notion
    const codeInputSelector = 'input[type="text"], input[name="code"], input[placeholder*="código" i]';
    await page.waitForSelector(codeInputSelector, { timeout: 15000 });
    await page.fill(codeInputSelector, code);
    await page.keyboard.press('Enter');

    console.log('✅ Código ingresado con éxito. Procesando onboarding inicial...');

    // Esperar transición de onboarding (Nombre, Uso personal, etc.)
    await page.waitForTimeout(5000);

    // Si pide nombre
    const nameInput = await page.$('input[placeholder*="nombre" i], input[name="name"]');
    if (nameInput) {
      await nameInput.fill('Dev Kiwi');
      const continueBtn = await page.$('div[role="button"]:has-text("Continuar"), button:has-text("Continuar")');
      if (continueBtn) await continueBtn.click();
      await page.waitForTimeout(3000);
    }

    // Si pide seleccionar uso ("Para uso personal")
    const personalOption = await page.$('text="Para uso personal", text="For personal use"');
    if (personalOption) {
      await personalOption.click();
      const continueBtn2 = await page.$('div[role="button"]:has-text("Continuar"), button:has-text("Continuar")');
      if (continueBtn2) await continueBtn2.click();
      await page.waitForTimeout(3000);
    }

    // Extraer cookies de sesión
    const cookies = await context.cookies();
    const tokenV2 = cookies.find((c) => c.name === 'token_v2')?.value;
    const userId = cookies.find((c) => c.name === 'notion_user_id')?.value;

    if (!tokenV2 || !userId) {
      throw new Error('No se encontraron token_v2 o notion_user_id en las cookies.');
    }

    console.log(`🍪 Cookies extraídas: userId=${userId}`);

    // Extraer space_id desde localStorage o página
    let spaceId = await page.evaluate(() => {
      try {
        const traits = JSON.parse(localStorage.getItem('ajs_user_traits') || '{}');
        if (traits.current_space_id) return traits.current_space_id;
        const spaceData = JSON.parse(localStorage.getItem('space') || '{}');
        return Object.keys(spaceData)[0] || null;
      } catch (e) {
        return null;
      }
    });

    console.log(`🏢 Space ID detectado: ${spaceId || 'Auto-generado'}`);

    const newAccount = {
      name: `Auto Account ${email.split('@')[0]}`,
      email: email,
      token_v2: tokenV2,
      user_id: userId,
      space_id: spaceId || userId,
      thread_id: '',
      created_at: new Date().toISOString(),
      status: 'active',
    };

    // Guardar en tokens.json
    let tokensData = { accounts: [] };
    if (fs.existsSync(TOKENS_FILE)) {
      try {
        tokensData = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf-8'));
      } catch (e) {
        tokensData = { accounts: [] };
      }
    }

    tokensData.accounts.push(newAccount);
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokensData, null, 2), 'utf-8');
    console.log(`🎉 ¡Cuenta creada y registrada exitosamente en tokens.json!`);

    return newAccount;
  } catch (error) {
    console.error('❌ Error en el proceso de registro:', error);
    // Guardar captura para depuración si falla
    try {
      await page.screenshot({ path: 'signup-debug.png' });
      console.log('📸 Screenshot guardado en signup-debug.png');
    } catch (_) {}
    throw error;
  } finally {
    await browser.close();
  }
}

// Ejecutar si se llama directamente
if (process.argv[1] && process.argv[1].endsWith('auto-create-account.mjs')) {
  registerNotionAccount(true).catch((e) => {
    console.error('Error detallado:', e);
    process.exit(1);
  });
}

export { registerNotionAccount };
