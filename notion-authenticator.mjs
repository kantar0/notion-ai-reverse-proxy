import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const TOKENS_FILE = path.join(process.cwd(), 'tokens.json');

/**
 * Automatizador de Login / Creación de Cuenta en Notion
 * - Soporta flujo OTP con email personalizado
 * - Extrae automáticamente: token_v2, notion_user_id, space_id
 * - Inyecta la cuenta activa directamente en tokens.json
 */
export async function authenticateNotionWithOTP(email, getOTPCallback) {
  console.log(`🚀 [Notion Authenticator] Iniciando proceso para: ${email}...`);

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

    console.log('⏳ Esperando formulario de Notion...');
    await page.waitForTimeout(4000);

    // 1. Ingresar email
    const emailInput = page.locator('input[type="email"]').first();
    await emailInput.click();
    await page.keyboard.type(email, { delay: 30 });
    console.log(`✍️ Email ingresado: ${email}`);

    await page.waitForTimeout(1000);

    // 2. Hacer clic en Continue
    const continueCoords = await page.evaluate(() => {
      const allDivs = Array.from(document.querySelectorAll('div'));
      const btn = allDivs.find((d) => d.innerText && d.innerText.trim() === 'Continue');
      if (btn) {
        const rect = btn.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }
      return null;
    });

    if (continueCoords) {
      await page.mouse.click(continueCoords.x, continueCoords.y);
    } else {
      await page.keyboard.press('Enter');
    }
    console.log('📬 Solicitud de código OTP enviada a Notion.');

    // 3. Esperar a que aparezca el campo de OTP ("Enter code" o autocomplete="one-time-code")
    console.log('⏳ Esperando campo de código OTP...');
    const otpInput = page.locator('input[autocomplete="one-time-code"], input[placeholder*="code" i]').first();
    await otpInput.waitFor({ state: 'visible', timeout: 20000 });
    console.log('✅ Campo de código OTP activo en pantalla.');

    // 4. Obtener código OTP vía callback (de inbox o consola)
    const code = await getOTPCallback();
    console.log(`🔑 Ingresando código OTP: ${code}...`);

    await otpInput.click();
    await page.keyboard.type(code.trim(), { delay: 60 });
    await page.waitForTimeout(1000);

    // Clic en Continuar con el código
    const verifyCoords = await page.evaluate(() => {
      const allDivs = Array.from(document.querySelectorAll('div'));
      const btn = allDivs.find((d) => d.innerText && d.innerText.trim() === 'Continue');
      if (btn) {
        const rect = btn.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }
      return null;
    });

    if (verifyCoords) {
      await page.mouse.click(verifyCoords.x, verifyCoords.y);
    } else {
      await page.keyboard.press('Enter');
    }

    console.log('⏳ Procesando autenticación en Notion...');
    await page.waitForTimeout(10000);

    // 5. Manejar Onboarding si es cuenta nueva
    try {
      const textInputs = page.locator('input[type="text"]');
      if ((await textInputs.count()) > 0 && (await textInputs.first().isVisible({ timeout: 3000 }))) {
        await textInputs.first().fill('Pedro Rojas');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(3000);
      }
    } catch (_) {}

    try {
      const personalOption = page
        .locator('text="For personal use", text="Para uso personal", text="For myself", text="Personal"')
        .first();
      if (await personalOption.isVisible({ timeout: 3000 })) {
        await personalOption.click();
        await page.waitForTimeout(1000);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(3000);
      }
    } catch (_) {}

    // 6. Extraer Cookies y Tokens
    const cookies = await context.cookies();
    const tokenV2 = cookies.find((c) => c.name === 'token_v2')?.value;
    const userId = cookies.find((c) => c.name === 'notion_user_id')?.value;

    console.log(`🔍 Resultado de extracción: token_v2=${tokenV2 ? 'OK' : 'MISSING'}, userId=${userId ? 'OK' : 'MISSING'}`);

    if (!tokenV2 || !userId) {
      await page.screenshot({ path: 'notion_auth_failed.png' });
      throw new Error('No se pudo extraer token_v2 o notion_user_id.');
    }

    // 7. Extraer Space ID
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
      name: `Account (${email})`,
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

    // Reemplazar o insertar al inicio
    tokensFileContent.accounts = tokensFileContent.accounts.filter((a) => a.email !== email);
    tokensFileContent.accounts.unshift(accountData);
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokensFileContent, null, 2), 'utf-8');

    console.log('🎉 ¡SESIÓN GENERADA Y TOKENS EXTRAÍDOS CON ÉXITO!');
    return accountData;
  } catch (error) {
    console.error('❌ Error en el proceso:', error);
    try {
      await page.screenshot({ path: 'auth_error.png' });
    } catch (_) {}
    throw error;
  } finally {
    await browser.close();
  }
}
