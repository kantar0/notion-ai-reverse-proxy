const fs = require('fs');

// Construimos las URLs desde partes para evitar que el editor las procese
const ORIGIN  = 'https:' + '//' + 'app.notion.com';
const API_BASE = 'https:' + '//' + 'www.notion.so' + '/api/v3';

const SETUP_COOKIE_LINE = 'app.notion.com';

const CLI_FILE   = 'shosso-notion-cli.mjs';
const SETUP_FILE = 'shosso-setup.mjs';

// --- Parchear CLI ---
let cli = fs.readFileSync(CLI_FILE, 'utf-8');
cli = cli.replace(/const NOTION_ORIGIN[^\n]+/, `const NOTION_ORIGIN   = '${ORIGIN}';`);
cli = cli.replace(/const NOTION_API_BASE[^\n]+/, `const NOTION_API_BASE = '${API_BASE}';`);
fs.writeFileSync(CLI_FILE, cli, 'utf-8');
console.log('[CLI] NOTION_ORIGIN   ->', ORIGIN);
console.log('[CLI] NOTION_API_BASE ->', API_BASE);

// --- Parchear Setup ---
let setup = fs.readFileSync(SETUP_FILE, 'utf-8');
// Arreglamos la línea de instrucciones que puede tener un placeholder
setup = setup.replace(/app\.notion\.com/g, SETUP_COOKIE_LINE);
setup = setup.replace(/\{\{[^}]+\}\}/g, SETUP_COOKIE_LINE);
fs.writeFileSync(SETUP_FILE, setup, 'utf-8');
console.log('[Setup] cookies instruction fixed');

console.log('\nPatch completo. Archivos listos.');
