const fs = require('fs');
const path = require('path');

const root = __dirname;
const serverFile = path.join(root, 'server.mjs');
const packageFile = path.join(root, 'package.json');
const backupFile = path.join(root, `server.mjs.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`);

let source = fs.readFileSync(serverFile, 'utf8');

if (!source.includes("name: 'finish_task'")) {
  fs.copyFileSync(serverFile, backupFile);

  source = source.replace(
    "{ name: 'mcp-pc-control', version: '0.8.0' },",
    "{ name: 'mcp-pc-control', version: '0.9.0' },",
  );

  source = source.split("annotations: { destructiveHint: true, idempotent: false },").join(
    "annotations: { readOnlyHint: false, destructiveHint: false, requiresConfirmation: false, idempotent: false },",
  );
  source = source.split("annotations: { destructiveHint: true, idempotent: true },").join(
    "annotations: { readOnlyHint: false, destructiveHint: false, requiresConfirmation: false, idempotent: true },",
  );
  source = source.split("annotations: { destructiveHint: true, idempotent: false, openWorld: true },").join(
    "annotations: { readOnlyHint: false, destructiveHint: false, requiresConfirmation: false, idempotent: false, openWorld: true },",
  );
  source = source.split("annotations: { idempotent: false },").join(
    "annotations: { readOnlyHint: false, destructiveHint: false, requiresConfirmation: false, idempotent: false },",
  );

  const openToolAnchor = `      {
        name: 'open_item',
        title: 'open_item',`;
  const finishTool = `      {
        name: 'finish_task',
        title: 'finish_task',
        description: 'OBLIGATORIO: llama esta herramienta una sola vez al terminar cualquier tarea. Guarda un resumen, el estado y los proximos pasos en TASK_MEMORY.md dentro de la carpeta de trabajo, para continuar luego exactamente donde se quedo.',
        inputSchema: {
          type: 'object',
          properties: {
            cwd: { type: 'string' },
            task: { type: 'string' },
            summary: { type: 'string' },
            status: { type: 'string' },
            nextSteps: { type: 'array', items: { type: 'string' } },
            filesChanged: { type: 'array', items: { type: 'string' } },
            notes: { type: 'string' },
          },
          required: ['cwd', 'task', 'summary', 'status'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, destructiveHint: false, requiresConfirmation: false, idempotent: false },
      },
`;
  if (!source.includes(openToolAnchor)) throw new Error('No se encontro el ancla de open_item');
  source = source.replace(openToolAnchor, finishTool + openToolAnchor);

  const openHandlerAnchor = `      if (name === 'open_item') {`;
  const finishHandler = `      if (name === 'finish_task') {
        const cwd = ensureAllowed(args.cwd, config.allowedRoots);
        const memoryPath = path.join(cwd, 'TASK_MEMORY.md');
        const task = String(args.task).trim();
        const summary = String(args.summary).trim();
        const status = String(args.status).trim();
        const nextSteps = Array.isArray(args.nextSteps) ? args.nextSteps.map(String).filter(Boolean) : [];
        const filesChanged = Array.isArray(args.filesChanged) ? args.filesChanged.map(String).filter(Boolean) : [];
        const notes = args.notes ? String(args.notes).trim() : '';
        const timestamp = new Date().toISOString();
        const list = (items) => items.length ? items.map((item) => \`- \${item}\`).join('\\n') : '- Ninguno';
        const entry = [
          '',
          \`## \${timestamp} — \${task}\`,
          '',
          \`- **Estado:** \${status}\`,
          \`- **Carpeta:** \\\`\${cwd}\\\`\`,
          '',
          '### Resumen',
          summary,
          '',
          '### Archivos modificados',
          list(filesChanged),
          '',
          '### Proximos pasos',
          list(nextSteps),
          ...(notes ? ['', '### Notas', notes] : []),
          '',
        ].join('\\n');

        if (!(await pathExists(memoryPath))) {
          const header = '# Memoria de tareas del MCP\\n\\n> Este archivo se actualiza automaticamente al finalizar una tarea. La entrada mas reciente queda al final.\\n';
          await fs.writeFile(memoryPath, header, 'utf8');
        }
        await fs.appendFile(memoryPath, entry, 'utf8');
        await log('mcp.task_finished', { cwd, memoryPath, task, status });
        return textContent({ ok: true, memoryPath, task, status, savedAt: timestamp });
      }

`;
  if (!source.includes(openHandlerAnchor)) throw new Error('No se encontro el ancla del handler open_item');
  source = source.replace(openHandlerAnchor, finishHandler + openHandlerAnchor);

  const workspaceAnchor = `          commandTimeoutMs: config.commandTimeoutMs,
        });`;
  const workspaceReplacement = `          commandTimeoutMs: config.commandTimeoutMs,
          taskMemory: {
            fileName: 'TASK_MEMORY.md',
            onStart: 'Si existe TASK_MEMORY.md en la carpeta de trabajo, leelo antes de continuar una tarea pendiente.',
            onFinish: 'Antes de responder que una tarea termino, llama finish_task una sola vez.',
          },
        });`;
  if (!source.includes(workspaceAnchor)) throw new Error('No se encontro el ancla de get_workspace_info');
  source = source.replace(workspaceAnchor, workspaceReplacement);

  fs.writeFileSync(serverFile, source, 'utf8');
} else {
  console.log('server.mjs ya contiene finish_task; no se volvio a parchear');
}

const pkg = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
pkg.version = '0.9.0';
fs.writeFileSync(packageFile, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

console.log(JSON.stringify({ ok: true, serverFile, packageFile, backupFile }, null, 2));
