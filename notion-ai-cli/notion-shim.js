// Shim Notion AI — 127.0.0.1:8321  ->  daemon de ~/notion-ai-cli  ->  Notion.com
//
// POR QUÉ EXISTE
// El CLIProxyAPI enruta modelos LLM OpenAI-compatibles. Notion AI (el chat de
// Notion.com) NO habla ese formato: usa runInferenceTranscript por dentro y sus
// cuentas son sesiones token_v2 con créditos por usuario. Este shim se pone en
// medio: recibe /v1/chat/completions (lo que manda el proxy) y lo traduce a una
// petición 'raw-chat' del daemon de Notion, que ya hace la inferencia real con
// rotación de cuentas por crédito y selección de modelo. La respuesta se
// devuelve en formato OpenAI (streaming SSE o JSON), como cualquier otro modelo.
//
//   Codex --> :8317 (CLIProxyAPI) --> :8321 (este shim) --> daemon Notion --> Notion.com
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = 8321;
const CLI_DIR = __dirname;
const REQ_DIR = path.join(CLI_DIR, 'bridge-requests');
const RES_DIR = path.join(CLI_DIR, 'bridge-responses');
const RESP_TIMEOUT_MS = 6 * 60 * 1000; // la inferencia con rotación puede tardar

// Modelos que exponemos (nombre visible -> lo entiende el daemon por su alias).
const MODELS = ['opus-5', 'gpt-5.6', 'opus-4.8', 'kimi-k3', 'sonnet-5', 'glm-5.2'];

function log(...a) {
  try {
    fs.appendFileSync(
      path.join(CLI_DIR, 'notion-shim.log'),
      `[${new Date().toISOString()}] ${a.join(' ')}\n`
    );
  } catch {}
}

/** Manda una acción al daemon por su cola de archivos y espera la respuesta. */
function daemonRequest(action, extra = {}, timeoutMs = RESP_TIMEOUT_MS) {
  return new Promise((resolve) => {
    try {
      fs.mkdirSync(REQ_DIR, { recursive: true });
      fs.mkdirSync(RES_DIR, { recursive: true });
    } catch {}
    const id = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const reqPath = path.join(REQ_DIR, `${id}.json`);
    const resPath = path.join(RES_DIR, `${id}.json`);
    const tmp = `${reqPath}.tmp`;
    try {
      fs.writeFileSync(
        tmp,
        JSON.stringify({
          id,
          createdAt: new Date().toISOString(),
          clientPid: process.pid,
          action,
          ...extra,
        })
      );
      fs.renameSync(tmp, reqPath);
    } catch (e) {
      return resolve({ ok: false, error: 'no pude encolar: ' + e.message });
    }
    const started = Date.now();
    const timer = setInterval(() => {
      if (fs.existsSync(resPath)) {
        clearInterval(timer);
        try {
          const r = JSON.parse(fs.readFileSync(resPath, 'utf8'));
          fs.unlinkSync(resPath);
          resolve(r);
        } catch (e) {
          resolve({ ok: false, error: 'respuesta ilegible: ' + e.message });
        }
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        resolve({ ok: false, error: 'el daemon de Notion no respondió a tiempo' });
      }
    }, 400);
  });
}

/** OpenAI messages -> un prompt de texto para el chat. Conserva roles para que
 *  el historial tenga sentido; el system va primero como instrucción. */
function messagesToPrompt(messages) {
  if (!Array.isArray(messages)) return '';
  const flat = (c) =>
    Array.isArray(c)
      ? c.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('\n')
      : String(c ?? '');
  const parts = [];
  for (const m of messages) {
    const role = m.role || 'user';
    const text = flat(m.content).trim();
    if (!text) continue;
    if (role === 'system') parts.push(text);
    else if (role === 'assistant') parts.push('Asistente: ' + text);
    else parts.push('Usuario: ' + text);
  }
  // El último turno del usuario es lo que hay que responder.
  return parts.join('\n\n');
}

function mapModel(requested) {
  const m = String(requested || '').toLowerCase();
  if (/opus.?5|agave/.test(m)) return 'opus-5';
  if (/opus.?4\.8|ambrosia/.test(m)) return 'opus-4.8';
  if (/gpt.?5\.6|orange/.test(m)) return 'gpt-5.6';
  if (/kimi/.test(m)) return 'kimi-k3';
  if (/sonnet/.test(m)) return 'sonnet-5';
  if (/glm/.test(m)) return 'glm-5.2';
  return undefined; // que el daemon use el activo
}

function sseChunk(id, model, delta, finish = null) {
  return (
    'data: ' +
    JSON.stringify({
      id,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, delta, finish_reason: finish }],
    }) +
    '\n\n'
  );
}

const server = http.createServer(async (req, res) => {
  const url = req.url || '';

  if (req.method === 'GET' && /\/v1\/models/.test(url)) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        object: 'list',
        data: MODELS.map((m) => ({ id: m, object: 'model', owned_by: 'notion' })),
      })
    );
    return;
  }

  if (req.method === 'POST' && /\/v1\/chat\/completions/.test(url)) {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', async () => {
      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'JSON inválido' } }));
        return;
      }
      const model = payload.model || 'notion-ai';
      const wantStream = payload.stream === true;
      const prompt = messagesToPrompt(payload.messages);
      const id = 'chatcmpl-' + crypto.randomBytes(8).toString('hex');
      log('chat', model, wantStream ? 'stream' : 'json', prompt.length + 'c');

      const r = await daemonRequest('raw-chat', {
        prompt,
        model: mapModel(model),
      });
      const text = r.ok ? String(r.text || '') : '';
      if (!r.ok) log('error', r.error);

      if (wantStream) {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        if (!r.ok) {
          res.write(sseChunk(id, model, { role: 'assistant', content: '⚠ ' + r.error }));
          res.write(sseChunk(id, model, {}, 'stop'));
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }
        res.write(sseChunk(id, model, { role: 'assistant', content: '' }));
        // Un solo bloque (el daemon devuelve la respuesta completa): se manda de golpe.
        res.write(sseChunk(id, model, { content: text }));
        res.write(sseChunk(id, model, {}, 'stop'));
        res.write('data: [DONE]\n\n');
        res.end();
      } else {
        res.writeHead(r.ok ? 200 : 502, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            id,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: r.ok ? text : '⚠ ' + r.error },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          })
        );
      }
    });
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: { message: 'not found' } }));
});

server.listen(PORT, '127.0.0.1', () => {
  log('shim escuchando en 127.0.0.1:' + PORT);
  console.log('Notion shim en http://127.0.0.1:' + PORT + '/v1');
});
