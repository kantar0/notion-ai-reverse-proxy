const fs = require('fs');
const path = require('path');
const file = path.resolve(__dirname, 'server.mjs');
let s = fs.readFileSync(file, 'utf8');

function replaceOnce(from, to, label) {
  if (s.includes(to)) return;
  if (!s.includes(from)) throw new Error(`No encontré patrón para ${label}`);
  s = s.replace(from, to);
}

replaceOnce(
  "import { exec, execFile } from 'node:child_process';",
  "import { exec, execFile, spawn } from 'node:child_process';",
  'import spawn',
);

replaceOnce(
  "{ name: 'mcp-pc-control', version: '0.7.0' },",
  "{ name: 'mcp-pc-control', version: '0.8.0' },",
  'version bump',
);

const helperAnchor = "const logPath = path.resolve(process.cwd(), config.logFile);\n\nasync function log(event, details = {}) {";
const helperBlock = `const logPath = path.resolve(process.cwd(), config.logFile);\n\nasync function checkUrl(url) {\n  try {\n    const response = await fetch(String(url));\n    const body = await response.text();\n    return {\n      url: String(url),\n      ok: response.ok,\n      status: response.status,\n      snippet: body.slice(0, 200),\n    };\n  } catch (error) {\n    return {\n      url: String(url),\n      ok: false,\n      error: error.message,\n    };\n  }\n}\n\nasync function checkPort(port) {\n  const normalized = Number(port);\n  if (!Number.isFinite(normalized)) {\n    return { port, listening: false, pids: [], error: 'invalid_port' };\n  }\n\n  try {\n    if (process.platform === 'win32') {\n      const { stdout } = await execAsync(\`netstat -ano | findstr :\${normalized}\`, {\n        windowsHide: true,\n        maxBuffer: 1024 * 1024,\n        shell: 'cmd.exe',\n      });\n      const lines = stdout.split(/\\r?\\n/).map((line) => line.trim()).filter(Boolean);\n      const pids = [...new Set(lines.map((line) => line.split(/\\s+/).pop()).filter(Boolean))];\n      return {\n        port: normalized,\n        listening: lines.some((line) => line.includes('LISTENING') || line.includes('ESTABLISHED')),\n        pids,\n        matches: lines.slice(0, 20),\n      };\n    }\n\n    const { stdout } = await execAsync(\`lsof -nP -iTCP:\${normalized}\`, {\n      maxBuffer: 1024 * 1024,\n      shell: '/bin/bash',\n    });\n    const lines = stdout.split(/\\r?\\n/).map((line) => line.trim()).filter(Boolean);\n    return {\n      port: normalized,\n      listening: lines.length > 1,\n      matches: lines.slice(0, 20),\n    };\n  } catch (error) {\n    return {\n      port: normalized,\n      listening: false,\n      pids: [],\n      error: error.message,\n    };\n  }\n}\n\nasync function checkProcess(processName) {\n  const normalized = String(processName);\n  try {\n    if (process.platform === 'win32') {\n      const { stdout } = await execAsync(\`tasklist | findstr /I "\${normalized}"\`, {\n        windowsHide: true,\n        maxBuffer: 1024 * 1024,\n        shell: 'cmd.exe',\n      });\n      const lines = stdout.split(/\\r?\\n/).map((line) => line.trim()).filter(Boolean);\n      return {\n        processName: normalized,\n        running: lines.length > 0,\n        matches: lines.slice(0, 20),\n      };\n    }\n\n    const { stdout } = await execAsync(\`ps -ax | grep -i "\${normalized}" | grep -v grep\`, {\n      maxBuffer: 1024 * 1024,\n      shell: '/bin/bash',\n    });\n    const lines = stdout.split(/\\r?\\n/).map((line) => line.trim()).filter(Boolean);\n    return {\n      processName: normalized,\n      running: lines.length > 0,\n      matches: lines.slice(0, 20),\n    };\n  } catch {\n    return {\n      processName: normalized,\n      running: false,\n      matches: [],\n    };\n  }\n}\n\nfunction startHiddenCommand(command, cwd) {\n  const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/bash';\n  const shellArgs = process.platform === 'win32'\n    ? ['/d', '/s', '/c', String(command)]\n    : ['-lc', String(command)];\n\n  const child = spawn(shell, shellArgs, {\n    cwd,\n    detached: true,\n    stdio: 'ignore',\n    windowsHide: true,\n  });\n  child.unref();\n  return child.pid;\n}\n\nasync function log(event, details = {}) {`;
replaceOnce(helperAnchor, helperBlock, 'helper functions');

const toolAnchor = `      {\n        name: 'open_item',\n        title: 'open_item',`;
const newTools = `      {\n        name: 'check_health',\n        title: 'check_health',\n        description: 'Verifica URLs, puertos y procesos para confirmar que algo este funcionando.',\n        inputSchema: {\n          type: 'object',\n          properties: {\n            urls: { type: 'array', items: { type: 'string' } },\n            ports: { type: 'array', items: { type: 'number' } },\n            processNames: { type: 'array', items: { type: 'string' } },\n          },\n          additionalProperties: false,\n        },\n        annotations: { readOnlyHint: true, idempotent: true },\n      },\n      {\n        name: 'start_background_command',\n        title: 'start_background_command',\n        description: 'Inicia un comando oculto y en segundo plano sin abrir una terminal visible.',\n        inputSchema: {\n          type: 'object',\n          properties: {\n            command: { type: 'string' },\n            cwd: { type: 'string' },\n          },\n          required: ['command', 'cwd'],\n          additionalProperties: false,\n        },\n        annotations: { destructiveHint: true, requiresConfirmation: true, idempotent: false, openWorld: true },\n      },\n` + toolAnchor;
replaceOnce(toolAnchor, newTools, 'new tools');

const handlerAnchor = `      if (name === 'open_item') {`;
const newHandlers = `      if (name === 'check_health') {\n        const urls = Array.isArray(args.urls) ? args.urls.map(String) : [];\n        const ports = Array.isArray(args.ports) ? args.ports.map((value) => Number(value)).filter(Number.isFinite) : [];\n        const processNames = Array.isArray(args.processNames) ? args.processNames.map(String) : [];\n\n        return textContent({\n          platform: process.platform,\n          urls: await Promise.all(urls.map((url) => checkUrl(url))),\n          ports: await Promise.all(ports.map((port) => checkPort(port))),\n          processes: await Promise.all(processNames.map((processName) => checkProcess(processName))),\n        });\n      }\n\n      if (name === 'start_background_command') {\n        const cwd = ensureAllowed(args.cwd, config.allowedRoots);\n        const command = String(args.command);\n        const pid = startHiddenCommand(command, cwd);\n        return textContent({ ok: true, cwd, command, pid, hidden: true, detached: true });\n      }\n\n` + handlerAnchor;
replaceOnce(handlerAnchor, newHandlers, 'new handlers');

fs.writeFileSync(file, s, 'utf8');
console.log('patched server.mjs');
