import readline from 'readline';
import { authenticateNotionWithOTP } from './notion-authenticator.mjs';

const email = process.argv[2] || 'pedro@agenciakiwi.com';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function promptForCode() {
  return new Promise((resolve) => {
    rl.question(`\n📩 Ingresa el código de 6 dígitos que Notion envió a ${email}: `, (code) => {
      resolve(code.trim());
    });
  });
}

async function main() {
  try {
    console.log(`===================================================`);
    console.log(`🤖 NOTION AUTO-AUTHENTICATOR & TOKEN HARVESTER`);
    console.log(`Objetivo: ${email}`);
    console.log(`===================================================`);

    const result = await authenticateNotionWithOTP(email, promptForCode);
    console.log('\n✅ Credenciales obtenidas exitosamente:');
    console.log(`- Token V2: ${result.token_v2.substring(0, 30)}...`);
    console.log(`- User ID:  ${result.user_id}`);
    console.log(`- Space ID: ${result.space_id}`);
    console.log(`\n🚀 ¡El proxy notion_openai_server.py ya puede utilizar esta cuenta!`);
  } catch (err) {
    console.error('\n❌ Proceso fallido:', err.message);
  } finally {
    rl.close();
  }
}

main();
