import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { exec, execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  isInitializeRequest,
} from '@modelcontextprotocol/sdk/types.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const HOME = os.homedir();
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(MODULE_DIR, 'config.json');
const DEFAULT_CONFIG = {
  port: 3337,
  host: '127.0.0.1',
  bearerToken: 'change-me',
  logFile: './mcp-diagnostic.log',
  commandTimeoutMs: 20000,
  allowedRoots: ['C:\\Users\\nesti\\Desktop'],
};

function expandHome(inputPath) {
  if (!inputPath) return inputPath;
  if (inputPath === '~') return HOME;
  if (String(inputPath).startsWith('~/')) return path.join(HOME, String(inputPath).slice(2));
  return String(inputPath);
}

async function loadConfig() {
  try {
    // Notepad puede guardar JSON como UTF-8 con BOM. Quitarlo antes de parsear.
    const raw = (await fs.readFile(CONFIG_PATH, 'utf8')).replace(/^\uFEFF/, '');
    const parsed = JSON.parse(raw);
    const bearerToken = String(parsed.bearerToken ?? '').trim();

    // Nunca iniciar un servidor de control remoto con el token predeterminado.
    if (!bearerToken || bearerToken === DEFAULT_CONFIG.bearerToken) {
      throw new Error('Configura un bearerToken seguro en config.json');
    }

    return {
      port: parsed.port ?? DEFAULT_CONFIG.port,
      host: parsed.host ?? DEFAULT_CONFIG.host,
      bearerToken,
      logFile: String(parsed.logFile ?? DEFAULT_CONFIG.logFile),
      commandTimeoutMs: Number(parsed.commandTimeoutMs ?? DEFAULT_CONFIG.commandTimeoutMs),
      allowedRoots: (parsed.allowedRoots ?? DEFAULT_CONFIG.allowedRoots)
        .map(expandHome)
        .map((p) => path.resolve(p)),
    };
  } catch (error) {
    console.error(`No se pudo cargar ${CONFIG_PATH}: ${error.message}`);
    throw error;
  }
}

function isSubpath(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function ensureAllowed(userPath, allowedRoots) {
  const absolute = path.resolve(expandHome(String(userPath)));
  const ok = allowedRoots.some((root) => isSubpath(absolute, root));
  if (!ok) throw new Error(`Ruta no permitida: ${userPath}`);
  return absolute;
}

function maskToken(token) {
  if (!token) return 'none';
  if (token.length <= 8) return 'short';
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

function textContent(value) {
  return {
    content: [
      {
        type: 'text',
        text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

async function walk(dir, visitor) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    await visitor(entry, fullPath);
    if (entry.isDirectory()) {
      await walk(fullPath, visitor);
    }
  }
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function openWithDefault(targetPathOrUrl) {
  if (process.platform === 'win32') {
    await execFileAsync('cmd', ['/c', 'start', '', targetPathOrUrl]);
    return;
  }
  if (process.platform === 'darwin') {
    await execFileAsync('open', [targetPathOrUrl]);
    return;
  }
  await execFileAsync('xdg-open', [targetPathOrUrl]);
}

const config = await loadConfig();
const logPath = path.resolve(MODULE_DIR, config.logFile);

async function checkUrl(url) {
  try {
    const response = await fetch(String(url));
    const body = await response.text();
    return {
      url: String(url),
      ok: response.ok,
      status: response.status,
      snippet: body.slice(0, 200),
    };
  } catch (error) {
    return {
      url: String(url),
      ok: false,
      error: error.message,
    };
  }
}

async function checkPort(port) {
  const normalized = Number(port);
  if (!Number.isFinite(normalized)) {
    return { port, listening: false, pids: [], error: 'invalid_port' };
  }

  try {
    if (process.platform === 'win32') {
      const { stdout } = await execAsync(`netstat -ano | findstr :${normalized}`, {
        windowsHide: true,
        maxBuffer: 1024 * 1024,
        shell: 'cmd.exe',
      });
      const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const pids = [...new Set(lines.map((line) => line.split(/\s+/).pop()).filter(Boolean))];
      return {
        port: normalized,
        listening: lines.some((line) => line.includes('LISTENING') || line.includes('ESTABLISHED')),
        pids,
        matches: lines.slice(0, 20),
      };
    }

    const { stdout } = await execAsync(`lsof -nP -iTCP:${normalized}`, {
      maxBuffer: 1024 * 1024,
      shell: '/bin/bash',
    });
    const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return {
      port: normalized,
      listening: lines.length > 1,
      matches: lines.slice(0, 20),
    };
  } catch (error) {
    return {
      port: normalized,
      listening: false,
      pids: [],
      error: error.message,
    };
  }
}

async function checkProcess(processName) {
  const normalized = String(processName);
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execAsync(`tasklist | findstr /I "${normalized}"`, {
        windowsHide: true,
        maxBuffer: 1024 * 1024,
        shell: 'cmd.exe',
      });
      const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      return {
        processName: normalized,
        running: lines.length > 0,
        matches: lines.slice(0, 20),
      };
    }

    const { stdout } = await execAsync(`ps -ax | grep -i "${normalized}" | grep -v grep`, {
      maxBuffer: 1024 * 1024,
      shell: '/bin/bash',
    });
    const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return {
      processName: normalized,
      running: lines.length > 0,
      matches: lines.slice(0, 20),
    };
  } catch {
    return {
      processName: normalized,
      running: false,
      matches: [],
    };
  }
}

function startHiddenCommand(command, cwd) {
  const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';
  const shellArgs = process.platform === 'win32'
    ? ['/d', '/s', '/c', String(command)]
    : ['-lc', String(command)];

  const child = spawn(shell, shellArgs, {
    cwd,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  return child.pid;
}

async function log(event, details = {}) {
  const line = `${new Date().toISOString()} ${event} ${JSON.stringify(details)}\n`;
  try {
    await fs.appendFile(logPath, line, 'utf8');
  } catch {}
  process.stdout.write(line);
}

function createProtocolServer() {
  const server = new Server(
    { name: 'mcp-pc-control', version: '0.9.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'get_workspace_info',
        title: 'get_workspace_info',
        description: 'Muestra informaciÃ³n bÃ¡sica del workspace permitido.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: true, idempotent: true },
      },
      {
        name: 'list_files',
        title: 'list_files',
        description: 'Lista archivos y carpetas dentro de una ruta permitida.',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, idempotent: true },
      },
      {
        name: 'search_files',
        title: 'search_files',
        description: 'Busca archivos o carpetas por nombre dentro de una ruta permitida.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            pattern: { type: 'string' },
            maxResults: { type: 'number' },
          },
          required: ['path', 'pattern'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, idempotent: true },
      },
      {
        name: 'read_text_file',
        title: 'read_text_file',
        description: 'Lee un archivo de texto dentro de una ruta permitida.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            startLine: { type: 'number' },
            endLine: { type: 'number' },
          },
          required: ['path'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, idempotent: true },
      },
      {
        name: 'write_text_file',
        title: 'write_text_file',
        description: 'Escribe o anexa texto en un archivo dentro de una ruta permitida.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            content: { type: 'string' },
            append: { type: 'boolean' },
          },
          required: ['path', 'content'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotent: false },
      },
      {
        name: 'make_directory',
        title: 'make_directory',
        description: 'Crea una carpeta dentro de una ruta permitida.',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotent: true },
      },
      {
        name: 'move_path',
        title: 'move_path',
        description: 'Mueve o renombra un archivo o carpeta dentro de rutas permitidas.',
        inputSchema: {
          type: 'object',
          properties: {
            source: { type: 'string' },
            destination: { type: 'string' },
          },
          required: ['source', 'destination'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotent: false },
      },
      {
        name: 'delete_path',
        title: 'delete_path',
        description: 'Borra un archivo o carpeta dentro de una ruta permitida.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            recursive: { type: 'boolean' },
          },
          required: ['path'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotent: false },
      },
      {
        name: 'run_command',
        title: 'run_command',
        description: 'Ejecuta un comando dentro de una ruta permitida.',
        inputSchema: {
          type: 'object',
          properties: {
            command: { type: 'string' },
            cwd: { type: 'string' },
            timeoutMs: { type: 'number' },
          },
          required: ['command', 'cwd'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotent: true, openWorld: true },
      },
      {
        name: 'check_health',
        title: 'check_health',
        description: 'Verifica URLs, puertos y procesos para confirmar que algo este funcionando.',
        inputSchema: {
          type: 'object',
          properties: {
            urls: { type: 'array', items: { type: 'string' } },
            ports: { type: 'array', items: { type: 'number' } },
            processNames: { type: 'array', items: { type: 'string' } },
          },
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true, idempotent: true },
      },
      {
        name: 'start_background_command',
        title: 'start_background_command',
        description: 'Inicia un comando oculto y en segundo plano sin abrir una terminal visible.',
        inputSchema: {
          type: 'object',
          properties: {
            command: { type: 'string' },
            cwd: { type: 'string' },
          },
          required: ['command', 'cwd'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotent: true, openWorld: true },
      },
      {
        name: 'finish_task',
        title: 'finish_task',
        description: 'Opcional: guarda un resumen, estado y proximos pasos en TASK_MEMORY.md dentro de la carpeta de trabajo cuando el usuario lo pida.',
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
        annotations: { readOnlyHint: false, destructiveHint: false, idempotent: false },
      },
      {
        name: 'open_item',
        title: 'open_item',
        description: 'Abre un archivo o carpeta permitida con la aplicaciÃ³n por defecto.',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotent: false },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = request.params.arguments || {};
    await log('mcp.call_tool', { name });

    try {
      if (name === 'get_workspace_info') {
        return textContent({
          platform: process.platform,
          allowedRoots: config.allowedRoots,
          commandTimeoutMs: config.commandTimeoutMs,
          taskMemory: {
            fileName: 'TASK_MEMORY.md',
            onStart: 'Si existe TASK_MEMORY.md en la carpeta de trabajo, leelo antes de continuar una tarea pendiente.',
            onFinish: 'No llamar finish_task automaticamente; usarlo solo si el usuario lo pide.',
          },
        });
      }

      if (name === 'list_files') {
        const target = ensureAllowed(args.path, config.allowedRoots);
        const entries = await fs.readdir(target, { withFileTypes: true });
        return textContent(entries.map((entry) => ({
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : 'file',
        })));
      }

      if (name === 'search_files') {
        const base = ensureAllowed(args.path, config.allowedRoots);
        const pattern = String(args.pattern).toLowerCase();
        const maxResults = Number(args.maxResults || 50);
        const results = [];

        await walk(base, async (entry, fullPath) => {
          if (results.length >= maxResults) return;
          if (entry.name.toLowerCase().includes(pattern)) {
            results.push({
              name: entry.name,
              path: fullPath,
              type: entry.isDirectory() ? 'directory' : 'file',
            });
          }
        });

        return textContent(results);
      }

      if (name === 'read_text_file') {
        const target = ensureAllowed(args.path, config.allowedRoots);
        const raw = await fs.readFile(target, 'utf8');
        const lines = raw.split(/\r?\n/);
        const startLine = Math.max(1, Number(args.startLine || 1));
        const endLine = Math.min(lines.length, Number(args.endLine || lines.length));
        return textContent({
          path: target,
          startLine,
          endLine,
          totalLines: lines.length,
          content: lines.slice(startLine - 1, endLine).join('\n'),
        });
      }

      if (name === 'write_text_file') {
        const target = ensureAllowed(args.path, config.allowedRoots);
        await fs.mkdir(path.dirname(target), { recursive: true });
        if (args.append) {
          await fs.appendFile(target, String(args.content), 'utf8');
        } else {
          await fs.writeFile(target, String(args.content), 'utf8');
        }
        return textContent({ ok: true, path: target, append: Boolean(args.append) });
      }

      if (name === 'make_directory') {
        const target = ensureAllowed(args.path, config.allowedRoots);
        await fs.mkdir(target, { recursive: true });
        return textContent({ ok: true, path: target });
      }

      if (name === 'move_path') {
        const source = ensureAllowed(args.source, config.allowedRoots);
        const destination = ensureAllowed(args.destination, config.allowedRoots);
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.rename(source, destination);
        return textContent({ ok: true, source, destination });
      }

      if (name === 'delete_path') {
        const target = ensureAllowed(args.path, config.allowedRoots);
        const exists = await pathExists(target);
        if (!exists) {
          return textContent({ ok: true, deleted: false, reason: 'not_found', path: target });
        }
        const stat = await fs.stat(target);
        if (stat.isDirectory()) {
          await fs.rm(target, { recursive: Boolean(args.recursive), force: true });
        } else {
          await fs.rm(target, { force: true });
        }
        return textContent({ ok: true, deleted: true, path: target });
      }

      if (name === 'run_command') {
        const cwd = ensureAllowed(args.cwd, config.allowedRoots);
        const command = String(args.command);
        const timeoutMs = Math.min(Number(args.timeoutMs || config.commandTimeoutMs), 25000);
        const { stdout, stderr } = await execAsync(command, {
          cwd,
          timeout: timeoutMs,
          windowsHide: true,
          maxBuffer: 4 * 1024 * 1024,
          shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/bash',
        });
        return textContent({ ok: true, cwd, command, statusCode: 0, stdout, stderr });
      }

      if (name === 'check_health') {
        const urls = Array.isArray(args.urls) ? args.urls.map(String) : [];
        const ports = Array.isArray(args.ports) ? args.ports.map((value) => Number(value)).filter(Number.isFinite) : [];
        const processNames = Array.isArray(args.processNames) ? args.processNames.map(String) : [];

        return textContent({
          platform: process.platform,
          urls: await Promise.all(urls.map((url) => checkUrl(url))),
          ports: await Promise.all(ports.map((port) => checkPort(port))),
          processes: await Promise.all(processNames.map((processName) => checkProcess(processName))),
        });
      }

      if (name === 'start_background_command') {
        const cwd = ensureAllowed(args.cwd, config.allowedRoots);
        const command = String(args.command);
        const pid = startHiddenCommand(command, cwd);
        return textContent({ ok: true, cwd, command, pid, hidden: true, detached: true });
      }

      if (name === 'finish_task') {
        const cwd = ensureAllowed(args.cwd, config.allowedRoots);
        const memoryPath = path.join(cwd, 'TASK_MEMORY.md');
        const task = String(args.task).trim();
        const summary = String(args.summary).trim();
        const status = String(args.status).trim();
        const nextSteps = Array.isArray(args.nextSteps) ? args.nextSteps.map(String).filter(Boolean) : [];
        const filesChanged = Array.isArray(args.filesChanged) ? args.filesChanged.map(String).filter(Boolean) : [];
        const notes = args.notes ? String(args.notes).trim() : '';
        const timestamp = new Date().toISOString();
        const list = (items) => items.length ? items.map((item) => `- ${item}`).join('\n') : '- Ninguno';
        const entry = [
          '',
          `## ${timestamp} â€” ${task}`,
          '',
          `- **Estado:** ${status}`,
          `- **Carpeta:** \`${cwd}\``,
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
        ].join('\n');

        if (!(await pathExists(memoryPath))) {
          const header = '# Memoria de tareas del MCP\n\n> Este archivo se actualiza automaticamente al finalizar una tarea. La entrada mas reciente queda al final.\n';
          await fs.writeFile(memoryPath, header, 'utf8');
        }
        await fs.appendFile(memoryPath, entry, 'utf8');
        await log('mcp.task_finished', { cwd, memoryPath, task, status });
        return textContent({ ok: true, memoryPath, task, status, savedAt: timestamp });
      }

      if (name === 'open_item') {
        const target = ensureAllowed(args.path, config.allowedRoots);
        await openWithDefault(target);
        return textContent({ ok: true, opened: target });
      }

      throw new Error(`Herramienta no soportada: ${name}`);
    } catch (error) {
      await log('mcp.tool_error', { name, message: error.message });
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
        isError: true,
      };
    }
  });

  return server;
}

const app = express();
app.use(express.json({ limit: '4mb' }));

app.use(async (req, _res, next) => {
  await log('http.request', {
    method: req.method,
    path: req.path,
    userAgent: req.headers['user-agent'] || 'unknown',
    hasAuth: Boolean(req.headers.authorization),
    hasSessionId: Boolean(req.headers['mcp-session-id']),
  });
  next();
});

app.get('/health', async (_req, res) => {
  await log('health.ok');
  res.json({ ok: true, service: 'mcp-pc-control', ts: new Date().toISOString() });
});

function requireBearer(req, res, next) {
  const header = req.headers.authorization || '';
  const expected = `Bearer ${config.bearerToken}`;
  if (header !== expected) {
    log('auth.fail', {
      path: req.path,
      received: maskToken(header.replace(/^Bearer\s+/i, '')),
      expected: maskToken(config.bearerToken),
    });
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  log('auth.ok', { path: req.path });
  next();
}

app.get('/auth-check', requireBearer, async (_req, res) => {
  await log('auth_check.ok');
  res.json({ ok: true, auth: 'bearer-ok' });
});

app.get('/.well-known/mcp.json', async (req, res) => {
  const origin = `${req.protocol}://${req.get('host')}`;
  await log('wellknown.mcp');
  res.json({
    name: 'MCP PC Control',
    description: 'Servidor MCP local limitado para revisar y editar el escritorio.',
    endpoint: `${origin}/mcp`,
  });
});

app.get('/.well-known/oauth-protected-resource', async (req, res) => {
  const origin = `${req.protocol}://${req.get('host')}`;
  await log('wellknown.oauth_protected_resource');
  res.json({
    resource: `${origin}/mcp`,
    authorization_servers: [],
    bearer_methods_supported: ['header'],
    scopes_supported: [],
  });
});

app.get('/.well-known/authorization-server', async (_req, res) => {
  await log('wellknown.authorization_server');
  res.status(404).json({ error: 'oauth_not_supported_use_bearer_token' });
});
app.get('/.well-known/openid-configuration', async (_req, res) => {
  await log('wellknown.openid_configuration');
  res.status(404).json({ error: 'oauth_not_supported_use_bearer_token' });
});
app.get('/.well-known/oauth-authorization-server', async (_req, res) => {
  await log('wellknown.oauth_authorization_server');
  res.status(404).json({ error: 'oauth_not_supported_use_bearer_token' });
});
app.options('*', async (_req, res) => {
  await log('http.options');
  res.set('Allow', 'GET,POST,DELETE,OPTIONS');
  res.sendStatus(204);
});

const transports = {};
const servers = {};
const sessionMeta = {};
const SESSION_IDLE_TTL_MS = 24 * 60 * 60 * 1000; // 24h: Notion no re-inicializa tras un 404; la sesion debe sobrevivir gaps largos
const MAX_SESSIONS = 512;

async function createTransportAndServer() {
  let transport;
  transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (sessionId) => {
      transports[sessionId] = transport;
      sessionMeta[sessionId] = { createdAt: Date.now(), lastSeen: Date.now() };
      log('mcp.session.initialized', { sessionId });
    },
  });

  transport.onclose = async () => {
    const sessionId = transport.sessionId;
    await log('mcp.session.closed', { sessionId: sessionId || null });
    if (sessionId) {
      delete transports[sessionId];
      delete servers[sessionId];
      delete sessionMeta[sessionId];
    }
  };

  const server = createProtocolServer();
  await server.connect(transport);
  return { transport, server };
}

const sessionCleanupTimer = setInterval(async () => {
  const now = Date.now();
  const entries = Object.entries(sessionMeta).sort((a, b) => a[1].lastSeen - b[1].lastSeen);
  const overflow = Math.max(0, entries.length - MAX_SESSIONS);
  for (let index = 0; index < entries.length; index += 1) {
    const [sessionId, meta] = entries[index];
    if (index >= overflow && now - meta.lastSeen <= SESSION_IDLE_TTL_MS) continue;
    const transport = transports[sessionId];
    await log('mcp.session.expired', {
      sessionId,
      idleMs: now - meta.lastSeen,
      reason: index < overflow ? 'capacity' : 'idle',
    });
    delete transports[sessionId];
    delete servers[sessionId];
    delete sessionMeta[sessionId];
    try { await transport?.close(); } catch (error) {
      await log('mcp.session.close_error', { sessionId, message: error.message });
    }
  }
}, 60 * 1000);
sessionCleanupTimer.unref?.();
async function handleMcp(req, res, bodyProvided = false) {
  const incomingSessionId = req.headers['mcp-session-id'];
  const initializeRequest = req.method === 'POST' && isInitializeRequest(req.body);
  let transport;

  if (incomingSessionId && transports[incomingSessionId]) {
    transport = transports[incomingSessionId];
    if (sessionMeta[incomingSessionId]) sessionMeta[incomingSessionId].lastSeen = Date.now();
    await log('mcp.session.reused', {
      sessionId: incomingSessionId,
      method: req.method,
      path: req.path,
    });
  } else if (initializeRequest) {
    if (incomingSessionId) {
      await log('mcp.session.stale_reinitialize', {
        staleSessionId: incomingSessionId,
        path: req.path,
      });
      delete req.headers['mcp-session-id'];
    }

    await log('mcp.post.init', { path: req.path });
    const created = await createTransportAndServer();
    transport = created.transport;
    if (transport.sessionId) {
      servers[transport.sessionId] = created.server;
    }
  } else if (incomingSessionId) {
    await log('mcp.session.not_found', {
      sessionId: incomingSessionId,
      method: req.method,
      path: req.path,
    });
    res.status(404).json({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Session not found; reinitialize' },
      id: null,
    });
    return;
  } else {
    await log('mcp.bad_request', {
      sessionId: null,
      method: req.method,
      path: req.path,
    });
    res.status(400).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Bad Request: initialize request required' },
      id: null,
    });
    return;
  }

  try {
    await transport.handleRequest(req, res, bodyProvided ? req.body : undefined);
  } catch (error) {
    await log('mcp.transport.error', {
      sessionId: transport?.sessionId || incomingSessionId || null,
      message: error.message,
    });
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'MCP transport error' },
        id: null,
      });
    }
  }
}
app.post(['/mcp', '/'], requireBearer, async (req, res) => {
  await handleMcp(req, res, true);
});
app.get(['/mcp', '/'], requireBearer, async (req, res) => {
  await handleMcp(req, res, false);
});
app.delete(['/mcp', '/'], requireBearer, async (req, res) => {
  await handleMcp(req, res, false);
});

process.on('uncaughtException', async (error) => {
  await log('process.uncaughtException', { message: error.message, stack: error.stack });
});
process.on('unhandledRejection', async (reason) => {
  await log('process.unhandledRejection', { reason: String(reason) });
});

await fs.appendFile(logPath, String.fromCharCode(10) + '=== reinicio ===' + String.fromCharCode(10), 'utf8').catch(() => {});
await log('server.starting', {
  host: config.host,
  port: config.port,
  allowedRoots: config.allowedRoots,
  logPath,
  token: maskToken(config.bearerToken),
  commandTimeoutMs: config.commandTimeoutMs,
});

app.listen(config.port, config.host, async () => {
  await log('server.listening', { mcpUrl: `{{http://${config.host}}}:${config.port}/mcp` });
  console.log(`MCP escuchando localmente en {{http://${config.host}}}:${config.port}/mcp`);
  console.log('Autenticacion: Bearer token');
  console.log(`Log diagnostico: ${logPath}`);
});



