const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'server.mjs');
let src = fs.readFileSync(file, 'utf8');
const changes = [];

// 1) run_command: tope de 25s en la espera en linea.
// Notion corta la conexion MCP cuando una respuesta tarda demasiado; con este tope nunca ocurre.
const before1 = src;
src = src.replace(
  /const timeoutMs = Number\(args\.timeoutMs \|\| config\.commandTimeoutMs\);/,
  'const timeoutMs = Math.min(Number(args.timeoutMs || config.commandTimeoutMs), 25000);'
);
if (src !== before1) changes.push('run_command: tope de 25s aplicado');
else changes.push('ERROR: linea timeoutMs no encontrada');

// 2) Preservar el log de diagnostico entre reinicios (no truncar).
const before2 = src;
src = src.replace(
  "await fs.writeFile(logPath, '', 'utf8').catch(() => {});",
  "await fs.appendFile(logPath, String.fromCharCode(10) + '=== reinicio ===' + String.fromCharCode(10), 'utf8').catch(() => {});"
);
if (src !== before2) changes.push('log de diagnostico: ya no se trunca al reiniciar');
else changes.push('ERROR: linea de truncado no encontrada');

console.log('CAMBIOS:');
for (const c of changes) console.log(' - ' + c);
if (changes.some(c => c.startsWith('ERROR'))) process.exit(1);

const backup = file + '.backup-v091-' + Date.now();
fs.writeFileSync(backup, fs.readFileSync(file));
fs.writeFileSync(file, src);
console.log('BACKUP: ' + backup);
console.log('PATCH_OK');
