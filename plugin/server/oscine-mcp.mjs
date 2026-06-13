#!/usr/bin/env node
// Oscine MCP sidecar. One process, three jobs, zero dependencies:
//
//   1. MCP server over stdio (JSON-RPC 2.0, newline-delimited) -- spawned
//      and lifecycle-managed by Claude Desktop via the plugin's .mcp.json
//   2. HTTP server on 127.0.0.1 serving the bundled Oscine app (../app)
//   3. WebSocket endpoint at /bridge that the running app connects to;
//      MCP tool calls are forwarded over it as commands
//
// Tool catalog comes from the app's own command catalog (single source
// of truth): ../app/src/api/commands.js. One extra server-side tool,
// oscine_open_app, opens the app in the user's browser.

import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { readFile, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMANDS } from '../app/src/api/commands.js';
import { OscGateway } from './osc-gateway.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const APP_DIR = resolve(ROOT, '..', 'app');
const BASE_PORT = Number(process.env.OSCINE_PORT || 7321);
const OSC_PORT = Number(process.env.OSCINE_OSC_PORT || 7340);
const SERVER_VERSION = '1.3.0';

// Bridge origin policy: localhost is always allowed; hosted copies of the
// app (e.g. GitHub Pages) must be allowlisted via OSCINE_ALLOWED_ORIGINS
// (comma-separated origins). Without this, any website you visit could
// connect to the local bridge and drive your session.
const ALLOWED_ORIGINS = (process.env.OSCINE_ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

function originAllowed(origin) {
  if (!origin) return true; // non-browser clients send no Origin header
  try {
    const u = new URL(origin);
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return true;
    return ALLOWED_ORIGINS.includes(u.origin);
  } catch {
    return false;
  }
}

const log = (...args) => console.error('[oscine-mcp]', ...args);

// ---------------------------------------------------------------------------
// WebSocket: minimal RFC 6455 server side (text frames, fragmentation,
// ping/pong, close). Browser clients always mask; server frames don't.

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const wsAccept = (key) => createHash('sha1').update(key + WS_GUID).digest('base64');

function wsEncode(str, opcode = 0x1) {
  const payload = Buffer.from(str);
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

class WSConn {
  constructor(socket, { onMessage, onClose }) {
    this.socket = socket;
    this.onMessage = onMessage;
    this.onClose = onClose;
    this.buf = Buffer.alloc(0);
    this.fragments = null;
    this.closed = false;
    socket.on('data', (chunk) => this.feed(chunk));
    socket.on('close', () => this.close());
    socket.on('error', () => this.close());
  }

  send(str) {
    if (this.closed) return;
    try { this.socket.write(wsEncode(str)); } catch { this.close(); }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    try { this.socket.destroy(); } catch { /* ok */ }
    this.onClose?.();
  }

  feed(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    while (true) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0];
      const b1 = this.buf[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        const big = this.buf.readBigUInt64BE(2);
        if (big > 16n * 1024n * 1024n) { this.close(); return; }
        len = Number(big);
        offset = 10;
      }
      let maskKey = null;
      if (masked) {
        if (this.buf.length < offset + 4) return;
        maskKey = this.buf.subarray(offset, offset + 4);
        offset += 4;
      }
      if (this.buf.length < offset + len) return;
      const payload = Buffer.from(this.buf.subarray(offset, offset + len));
      this.buf = this.buf.subarray(offset + len);
      if (maskKey) {
        for (let i = 0; i < payload.length; i++) payload[i] ^= maskKey[i % 4];
      }

      if (opcode === 0x8) { // close
        try { this.socket.write(wsEncode('', 0x8)); } catch { /* ok */ }
        this.close();
        return;
      }
      if (opcode === 0x9) { // ping -> pong
        try { this.socket.write(wsEncode(payload.toString(), 0xA)); } catch { /* ok */ }
        continue;
      }
      if (opcode === 0xA) continue; // pong

      if (opcode === 0x1 || opcode === 0x0) { // text / continuation
        if (!fin || opcode === 0x0) {
          this.fragments = this.fragments ? Buffer.concat([this.fragments, payload]) : payload;
          if (!fin) continue;
          const whole = this.fragments;
          this.fragments = null;
          this.onMessage(whole.toString('utf8'));
        } else {
          this.onMessage(payload.toString('utf8'));
        }
      }
      // binary frames ignored
    }
  }
}

// ---------------------------------------------------------------------------
// App connection state + command forwarding.

let appConn = null;       // WSConn of the most recent app
let appInfo = null;       // hello payload
let nextCmdId = 1;
const pending = new Map(); // id -> {resolve, reject, timer}
let actualPort = null;
let gateway = null;       // OSC gateway (assigned at startup)

function setAppStreaming(on) {
  if (appConn && !appConn.closed) {
    appConn.send(JSON.stringify({ type: 'stream', on }));
  }
}

const appUrl = () => `http://127.0.0.1:${actualPort}/`;

function notConnectedError() {
  return new Error(
    `Oscine isn't open. Call the oscine_open_app tool (or open ${appUrl()} in a browser); ` +
    'the app connects to this server automatically within a couple of seconds.'
  );
}

function callApp(name, args, timeoutMs = 15000) {
  return new Promise((resolveP, rejectP) => {
    if (!appConn || appConn.closed) return rejectP(notConnectedError());
    const id = nextCmdId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      rejectP(new Error(`Oscine app did not respond within ${timeoutMs / 1000}s (is the tab still open?).`));
    }, timeoutMs);
    pending.set(id, { resolve: resolveP, reject: rejectP, timer });
    appConn.send(JSON.stringify({ type: 'cmd', id, name, args }));
  });
}

function handleAppMessage(raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }
  if (msg.type === 'hello') {
    appInfo = msg;
    log(`app connected: project "${msg.project}" (api v${msg.apiVersion})`);
    if (gateway && gateway.subscribers.size > 0) setAppStreaming(true);
    return;
  }
  if (msg.type === 'event') {
    if (msg.name === 'state') gateway?.relayState(msg.data);
    return;
  }
  if (msg.type === 'result') {
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.ok) p.resolve(msg.result);
    else p.reject(new Error(msg.error?.message ?? 'Command failed in the app.'));
  }
}

// ---------------------------------------------------------------------------
// HTTP: static app + /health + WS upgrade at /bridge.

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.md': 'text/markdown; charset=utf-8',
};

async function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (urlPath === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ server: 'oscine-mcp', version: SERVER_VERSION, appConnected: !!(appConn && !appConn.closed) }));
    return;
  }
  const rel = urlPath === '/' ? 'index.html' : urlPath.slice(1);
  const filePath = resolve(APP_DIR, rel);
  if (!filePath.startsWith(APP_DIR)) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  try {
    const st = await stat(filePath);
    if (!st.isFile()) throw new Error('not a file');
    const body = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('not found');
  }
}

function startHttp(port, attemptsLeft = 9) {
  const server = createServer((req, res) => { serveStatic(req, res); });

  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    const urlPath = new URL(req.url, 'http://x').pathname;
    if (urlPath !== '/bridge' || !key) {
      socket.destroy();
      return;
    }
    if (!originAllowed(req.headers.origin)) {
      log(`bridge rejected origin ${req.headers.origin} (set OSCINE_ALLOWED_ORIGINS to allow)`);
      socket.destroy();
      return;
    }
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${wsAccept(key)}\r\n\r\n`
    );
    const conn = new WSConn(socket, {
      onMessage: handleAppMessage,
      onClose: () => {
        if (appConn === conn) {
          appConn = null;
          appInfo = null;
          log('app disconnected');
          for (const [id, p] of pending) {
            clearTimeout(p.timer);
            p.reject(new Error('Oscine app disconnected mid-command.'));
            pending.delete(id);
          }
        }
      },
    });
    if (appConn && !appConn.closed) appConn.close(); // newest tab wins
    appConn = conn;
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
      log(`port ${port} busy, trying ${port + 1}`);
      startHttp(port + 1, attemptsLeft - 1);
    } else {
      log('http server error:', err.message);
    }
  });

  server.listen(port, '127.0.0.1', () => {
    actualPort = port;
    log(`serving app + bridge on ${appUrl()}`);
  });
}

// ---------------------------------------------------------------------------
// Server-side tools (work without the app) + catalog-derived tools.

const OPEN_APP_TOOL = {
  name: 'oscine_open_app',
  description: "Open the Oscine synth composer in the user's default browser, served by this plugin. Do this first if oscine_status reports the app isn't connected. After it loads, the app links to this server automatically. Audio needs one click in the tab (browser autoplay policy).",
  inputSchema: { type: 'object', properties: {} },
};

function toolList() {
  return [
    OPEN_APP_TOOL,
    ...COMMANDS.map(c => ({
      name: `oscine_${c.name}`,
      description: c.description,
      inputSchema: c.input,
      annotations: { readOnlyHint: !!c.readOnly, openWorldHint: false },
    })),
  ];
}

function openBrowser(url) {
  const platform = process.platform;
  const [cmd, args] = platform === 'darwin' ? ['open', [url]]
    : platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : ['xdg-open', [url]];
  return new Promise((resolveP) => {
    try {
      const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
      child.on('error', () => resolveP(false));
      child.unref();
      setTimeout(() => resolveP(true), 150);
    } catch {
      resolveP(false);
    }
  });
}

async function waitForApp(ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (appConn && !appConn.closed) return true;
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
}

async function dispatchTool(name, args) {
  if (name === 'oscine_open_app') {
    if (appConn && !appConn.closed) {
      return { ok: true, alreadyOpen: true, url: appUrl(), note: 'App is already connected.' };
    }
    const launched = await openBrowser(appUrl());
    const connected = await waitForApp(6000);
    return {
      ok: launched || connected,
      url: appUrl(),
      appConnected: connected,
      note: connected
        ? 'App is open and connected. Remind the user to click once in the tab so the browser allows audio.'
        : `Browser launch ${launched ? 'requested' : 'failed'}; if nothing opened, ask the user to open ${appUrl()} manually.`,
    };
  }

  const cmdName = name.replace(/^oscine_/, '');
  if (cmdName === 'status' && (!appConn || appConn.closed)) {
    return {
      server: 'oscine-mcp',
      version: SERVER_VERSION,
      url: appUrl(),
      appConnected: false,
      osc: gateway?.info(),
      hint: 'The Oscine app is not open. Call oscine_open_app to launch it, then retry.',
    };
  }
  const result = await callApp(cmdName, args);
  if (cmdName === 'status' && result && typeof result === 'object') {
    result.osc = gateway?.info(); // udp control surface: port + subscriber count
  }
  return result;
}

// ---------------------------------------------------------------------------
// MCP over stdio: JSON-RPC 2.0, one message per line. stdout is reserved
// for protocol messages; all logging goes to stderr.

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function rpcResult(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function rpcError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

async function handleRpc(msg) {
  const { id, method, params } = msg;
  const isRequest = id !== undefined && id !== null;

  try {
    switch (method) {
      case 'initialize':
        rpcResult(id, {
          protocolVersion: params?.protocolVersion ?? '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'oscine', title: 'Oscine Synth Composer', version: SERVER_VERSION },
        });
        return;
      case 'ping':
        if (isRequest) rpcResult(id, {});
        return;
      case 'tools/list':
        rpcResult(id, { tools: toolList() });
        return;
      case 'tools/call': {
        const { name, arguments: args } = params ?? {};
        try {
          const result = await dispatchTool(name, args ?? {});
          rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 1) }], isError: false });
        } catch (err) {
          rpcResult(id, { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true });
        }
        return;
      }
      default:
        if (method?.startsWith('notifications/')) return; // fire-and-forget
        if (isRequest) rpcError(id, -32601, `Method not found: ${method}`);
    }
  } catch (err) {
    if (isRequest) rpcError(id, -32603, `Internal error: ${err.message}`);
    log('rpc error:', err);
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try { msg = JSON.parse(trimmed); } catch {
    log('unparseable line on stdin');
    return;
  }
  handleRpc(msg);
});

// Claude Desktop closes stdin to stop the sidecar.
rl.on('close', () => { log('stdin closed; exiting'); process.exit(0); });
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));

startHttp(BASE_PORT);
gateway = new OscGateway({
  port: OSC_PORT,
  callApp,
  onSubscribersChange: (n) => setAppStreaming(n > 0),
  log,
});
log(`MCP server ready (tools: ${toolList().length})`);
