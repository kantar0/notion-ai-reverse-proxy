import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const PROXY_LIST_FILE = path.join(process.cwd(), 'proxies.txt');

/**
 * Creador de Cuentas Outlook con soporte de Proxies Residenciales / Rotativos
 */
export async function createOutlookAccountWithProxy(proxyServer = null) {
  const emailUsername = `kiwi_dev_${Math.random().toString(36).substring(2, 9)}${Math.floor(Math.random() * 899 + 100)}`;
  const email = `${emailUsername}@outlook.com`;
  const password = `Kiw!Pass#${Math.random().toString(36).substring(2, 8)}2026!`;

  console.log(`\n===================================================`);
  console.log(`🚀 [Outlook Creator] Creando: ${email}`);
  if (proxyServer) console.log(`🛡️ Proxy activo: ${proxyServer}`);
  console.log(`===================================================`);

  const launchOptions = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1280,800',
    ],
  };

  if (proxyServer) {
    launchOptions.proxy = { server: proxyServer };
  }

  const browser = await chromium.launch(launchOptions);

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
  });

  await context.addInitScript(() => {
    delete Object.getPrototypeOf(navigator).webdriver;
    window.chrome = { runtime: {} };
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  });

  const page = await context.newPage();

  try {
    console.log('🌐 1. Navegando a https://signup.live.com/signup...');
    await page.goto('https://signup.live.com/signup', { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(3000);

    // 1. Email
    console.log(`✍️ 2. Ingresando email: ${email}`);
    const emailInp = page.locator('input[type="email"], input[name="email"]').first();
    await emailInp.click();
    await page.keyboard.type(email, { delay: 40 });
    await page.waitForTimeout(800);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(3000);

    // 2. Password
    console.log('🔑 3. Ingresando contraseña...');
    const passInp = page.locator('input[type="password"]').first();
    await passInp.click();
    await page.keyboard.type(password, { delay: 30 });
    await page.waitForTimeout(800);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(3000);

    // 3. Fecha (US)
    console.log('📅 4. Configurando fecha de nacimiento...');
    await page.locator('#BirthMonthDropdown').click();
    await page.waitForTimeout(400);
    await page.locator('role=option').first().click();

    await page.locator('#BirthDayDropdown').click();
    await page.waitForTimeout(400);
    await page.locator('role=option').first().click();

    await page.locator('input[name="BirthYear"]').fill('1996');
    await page.waitForTimeout(800);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(3000);

    // 4. Nombre y Apellido
    console.log('👤 5. Ingresando Nombre y Apellido...');
    await page.locator('#firstNameInput').fill('Pedro');
    await page.waitForTimeout(300);
    await page.locator('#lastNameInput').fill('Rojas');
    await page.waitForTimeout(800);
    await page.locator('button[type="submit"]').first().click();

    console.log('⏳ 6. Verificando resultado de creación...');
    await page.waitForTimeout(10000);

    const bodyText = await page.evaluate(() => document.body.innerText);
    const finalUrl = page.url();

    let status = 'in_progress';
    if (bodyText.includes('Account creation has been blocked')) {
      status = 'ip_blocked';
      console.log('⚠️ IP bloqueada por Microsoft.');
    } else if (bodyText.includes('Solve the puzzle') || bodyText.includes('visual challenge')) {
      status = 'captcha_prompt';
      console.log('🧩 Captcha solicitado (Arkose).');
    } else if (finalUrl.includes('account.microsoft.com') || finalUrl.includes('outlook.live.com') || bodyText.includes('Stay signed in')) {
      status = 'success';
      console.log('🎉 ¡Cuenta de Outlook creada exitosamente!');
    }

    const accountResult = {
      email,
      password,
      status,
      proxy: proxyServer || 'direct',
      created_at: new Date().toISOString(),
    };

    const outPath = path.join(process.cwd(), 'outlook_accounts.json');
    let data = [];
    if (fs.existsSync(outPath)) {
      try {
        data = JSON.parse(fs.readFileSync(outPath, 'utf-8'));
      } catch (_) {}
    }
    data.unshift(accountResult);
    fs.writeFileSync(outPath, JSON.stringify(data, null, 2), 'utf-8');

    return accountResult;
  } catch (err) {
    console.error('❌ Error en el proceso:', err.message);
    throw err;
  } finally {
    await browser.close();
  }
}
