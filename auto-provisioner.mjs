import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const MAILTM_API = 'https://api.mail.tm';
const TOKENS_FILE = path.join(process.cwd(), 'tokens.json');

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
  const domainsRes = await mailtmRequest('/domains');
  const domains = domainsRes['hydra:member'] || [];
  if (domains.length === 0) {
    throw new Error('No hay dominios disponibles en Mail.tm');
  }
  const domain = domains[0].domain;
  const username = `kiwi_ai_${Math.random().toString(36).substring(2, 9)}`;
  const email = `${username}@${domain}`;
  const password = `Kiw!Pass${Math.random().toString(36).substring(2, 8)}#2026`;

  await mailtmRequest('/accounts', 'POST', { address: email, password });
  const tokenRes = await mailtmRequest('/token', 'POST', { address: email, password });
  return { email, password, authToken: tokenRes.token };
}

async function waitForVerificationCode(authToken, maxWaitSecs = 60) {
  console.log('⏳ Esperando correo con código de Notion en el buzón...');
  const start = Date.now();
  while ((Date.now() - start) / 1000 < maxWaitSecs) {
    const messagesRes = await mailtmRequest('/messages', 'GET', null, authToken);
    const messages = messagesRes['hydra:member'] || [];

    if (messages.length > 0) {
      const msgId = messages[0].id;
      const msgDetails = await mailtmRequest(`/messages/${msgId}`, 'GET', null, authToken);
      const subject = msgDetails.subject || '';
      const text = msgDetails.text || msgDetails.intro || '';

      console.log(`📩 Correo recibido: "${subject}"`);

      // 1. Extraer código de 6 dígitos numéricos
      const directMatch = text.match(/\b\d{6}\b/) || subject.match(/\b\d{6}\b/);
      if (directMatch) return directMatch[0];

      const hyphenMatch = text.match(/\b(\d{3})-(\d{3})\b/) || subject.match(/\b(\d{3})-(\d{3})\b/);
      if (hyphenMatch) return `${hyphenMatch[1]}${hyphenMatch[2]}`;

      // 2. Extraer magic link si viene en el cuerpo
      const linkMatch = text.match(/https:\/\/(?:app\.)?notion\.(?:so|com)\/[^\s\)\>]+/);
      if (linkMatch) return linkMatch[0];
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('Tiempo de espera agotado para el código de verificación.');
}

async function autoProvisionNotion() {
  console.log('🚀 [Notion AI Auto-Provisioner] Creando identidad temporal...');

  const { email, authToken } = await createTempEmail();
  console.log(`✉️ Correo temporal generado: ${email}`);

  const browser = await chromium.launch({
    headless: true,
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
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    locale: 'es-ES',
    timezoneId: 'America/Caracas',
  });

  await context.addInitScript(() => {
    delete Object.getPrototypeOf(navigator).webdriver;
    window.chrome = { runtime: {} };
  });

  const page = await context.newPage();

  try {
    console.log('🌐 Navegando a https://app.notion.com/signup...');
    await page.goto('https://app.notion.com/signup', { waitUntil: 'domcontentloaded', timeout: 30000 });

    console.log('⏳ Esperando formulario de registro...');
    await page.waitForTimeout(4000);

    const input = page.locator('input').first();
    await input.click();
    await page.keyboard.type(email, { delay: 30 });
    console.log('✍️ Email ingresado.');

    await page.waitForTimeout(1000);
    console.log('📬 Haciendo clic en Continue...');

    // Hacer clic directamente en el elemento role="button" con texto Continue
    const continueBtn = page.locator('div[role="button"]:has-text("Continue")').first();
    await continueBtn.click();

    // Esperar código OTP desde el buzón
    const codeOrLink = await waitForVerificationCode(authToken, 60);
    console.log(`🔑 Código / Enlace obtenido: ${codeOrLink}`);

    if (codeOrLink.startsWith('http')) {
      console.log('🔗 Accediendo vía Magic Link...');
      await page.goto(codeOrLink, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } else {
      console.log(`⌨️ Ingresando código de 6 dígitos: ${codeOrLink}...`);
      await page.waitForTimeout(4000);

      // Ingresar código OTP
      await page.keyboard.type(codeOrLink, { delay: 60 });
      await page.keyboard.press('Enter');
    }

    console.log('⏳ Esperando validación y creación de sesión en Notion...');
    await page.waitForTimeout(12000);

    // Onboarding: Si pide nombre
    try {
      const textInputs = page.locator('input[type="text"]');
      if (await textInputs.count() > 0 && await textInputs.first().isVisible({ timeout: 3000 })) {
        await textInputs.first().fill('Kiwi Dev');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(3000);
      }
    } catch (_) {}

    // Onboarding: Si pide seleccionar tipo de uso
    try {
      const personalOption = page.locator('text="For personal use", text="Para uso personal", text="For myself", text="Personal"').first();
      if (await personalOption.isVisible({ timeout: 3000 })) {
        await personalOption.click();
        await page.waitForTimeout(1000);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(3000);
      }
    } catch (_) {}

    // Extraer cookies de sesión
    const cookies = await context.cookies();
    const tokenV2 = cookies.find((c) => c.name === 'token_v2')?.value;
    const userId = cookies.find((c) => c.name === 'notion_user_id')?.value;

    console.log(`🔍 Resultado de extracción: token_v2=${tokenV2 ? 'OK' : 'MISSING'}, userId=${userId ? 'OK' : 'MISSING'}`);

    if (!tokenV2 || !userId) {
      await page.screenshot({ path: 'notion_signup_state.png' });
      console.log('📸 Screenshot guardado en notion_signup_state.png');
      throw new Error('No se pudo obtener la cookie token_v2 tras ingresar el código.');
    }

    // Extraer Space ID
    let spaceId = await page.evaluate(() => {
      try {
        const traits = JSON.parse(localStorage.getItem('ajs_user_traits') || '{}');
        if (traits.current_space_id) return traits.current_space_id;
        const spaces = JSON.parse(localStorage.getItem('space') || '{}');
        return Object.keys(spaces)[0] || null;
      } catch (e) {
        return null;
      }
    });

    const accountData = {
      name: `Auto Account (${email.split('@')[0]})`,
      email: email,
      token_v2: tokenV2,
      user_id: userId,
      space_id: spaceId || userId,
      spaces: spaceId ? [spaceId] : [userId],
      created_at: new Date().toISOString(),
      status: 'active',
    };

    // Actualizar tokens.json
    let tokensFileContent = { accounts: [] };
    if (fs.existsSync(TOKENS_FILE)) {
      try {
        tokensFileContent = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf-8'));
      } catch (e) {
        tokensFileContent = { accounts: [] };
      }
    }

    tokensFileContent.accounts.unshift(accountData);
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokensFileContent, null, 2), 'utf-8');

    console.log('🎉 ¡CUENTA CREADA, AUTENTICADA Y GUARDADA EN TOKENS.JSON EXITOSAMENTE!');
    return accountData;
  } catch (err) {
    console.error('❌ Error en el flujo:', err);
    try {
      await page.screenshot({ path: 'notion_flow_error.png' });
    } catch (_) {}
    throw err;
  } finally {
    await browser.close();
  }
}

autoProvisionNotion().catch(() => process.exit(1));
