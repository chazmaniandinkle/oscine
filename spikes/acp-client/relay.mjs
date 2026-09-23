// Spike: browser relay for the ACP client.
// GET /           -> chat page
// GET /events     -> SSE stream of client events (updates, permission requests, ...)
// POST /prompt    {text}                 -> session/prompt (lazy-starts the session)
// POST /permission {id, optionId|null}   -> answers a pending session/request_permission
// Env: AGENT=hermes|claude (default claude), PORT (default 7399), SPIKE_MODE (default 'default')
import http from 'node:http';
import fs from 'node:fs';
import { startSession } from './client.mjs';

const PORT = Number(process.env.PORT || 7399);
const AGENT = process.env.AGENT || 'claude';
process.env.SPIKE_MODE ??= 'default';
const html = fs.readFileSync(new URL('./ui.html', import.meta.url));
const clients = new Set();
const pending = new Map(); // permission id -> resolve
let seq = 0, session = null;
const broadcast = (ev) => {
  const line = `data: ${JSON.stringify(ev)}\n\n`;
  for (const res of clients) res.write(line);
};

async function ensureSession() {
  if (session) return session;
  session = startSession({
    agent: AGENT,
    logPath: process.env.LOG || `evidence/relay-${AGENT}.ndjson`,
    onEvent: (ev) => { if (ev.type !== 'stderr' && ev.type !== 'permission') broadcast(ev); },
    decide: (req) => new Promise((resolve) => {
      const id = ++seq; pending.set(id, resolve);
      broadcast({ type: 'permission', id, request: req });
    }),
  });
  return session;
}

const body = (req) => new Promise((r) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => r(b ? JSON.parse(b) : {})); });

http.createServer(async (req, res) => {
  if (req.url === '/') return res.writeHead(200, { 'content-type': 'text/html' }).end(html);
  if (req.url === '/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify({ type: 'hello', agent: AGENT })}\n\n`);
    clients.add(res); req.on('close', () => clients.delete(res)); return;
  }
  if (req.method === 'POST' && req.url === '/prompt') {
    const { text } = await body(req);
    res.writeHead(202).end();
    try {
      const s = await ensureSession();
      broadcast({ type: 'turn_start', text });
      const r = await s.prompt(text);
      broadcast({ type: 'turn_end', stopReason: r.stopReason });
    } catch (e) { broadcast({ type: 'error', message: e?.message || String(e) }); }
    return;
  }
  if (req.method === 'POST' && req.url === '/permission') {
    const { id, optionId } = await body(req);
    const resolve = pending.get(id); pending.delete(id);
    resolve?.(optionId ?? null);
    return res.writeHead(resolve ? 200 : 404).end();
  }
  res.writeHead(404).end();
}).listen(PORT, '127.0.0.1', () => console.log(`relay on http://127.0.0.1:${PORT} agent=${AGENT}`));
