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
import { readFile, stat, readdir, writeFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMANDS } from '../app/src/api/commands.js';
import { OscGateway } from './osc-gateway.js';
import { SessionRegistry } from './sessions.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const APP_DIR = resolve(ROOT, '..', 'app');
const BASE_PORT = Number(process.env.OSCINE_PORT || 7321);
const OSC_PORT = Number(process.env.OSCINE_OSC_PORT || 7340);
const SERVER_VERSION = '2.2.0';

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

const registry = new SessionRegistry(); // every connected app instance
let nextCmdId = 1;
const pending = new Map(); // id -> {resolve, reject, timer, conn}
let actualPort = null;
let gateway = null;       // OSC gateway (assigned at startup)

// Stream the 10Hz state snapshot from the active instance (the OSC surface
// follows whichever instance is active).
function setAppStreaming(on) {
  const s = registry.active;
  if (s && !s.conn.closed) s.conn.send(JSON.stringify({ type: 'stream', on }));
}

// Tell each connected instance whether it is the active target and how many
// peers exist, so the app can show a multi-session indicator.
function broadcastSessions() {
  const peers = registry.size;
  for (const s of registry.list()) {
    const conn = registry.get(s.id)?.conn;
    if (conn && !conn.closed) {
      conn.send(JSON.stringify({ type: 'session', id: s.id, active: s.active, peers }));
    }
  }
}

const appUrl = () => `http://127.0.0.1:${actualPort}/`;

function notConnectedError() {
  return new Error(
    `Oscine isn't open. Call the oscine_open_app tool (or open ${appUrl()} in a browser); ` +
    'the app connects to this server automatically within a couple of seconds.'
  );
}

// Translate a failed registry.resolve() into an actionable error.
function targetError(r) {
  if (r.error === 'not-connected') return notConnectedError();
  const ids = r.sessions.map(s => `${s.id}${s.project ? ` ("${s.project}")` : ''}`).join(', ');
  if (r.error === 'ambiguous') {
    return new Error(
      `${r.sessions.length} Oscine instances are open and none is active. ` +
      `Pass session:<id> or run oscine_sessions select. Instances: ${ids}.`
    );
  }
  return new Error(`No open Oscine instance matches that target. Instances: ${ids || '(none)'}.`);
}

// Route a command to a session. `selector` is an instance id / clientId /
// project name, or null to use the active instance.
function callApp(name, args, timeoutMs = 15000, selector = null) {
  return new Promise((resolveP, rejectP) => {
    const r = registry.resolve(selector);
    if (r.error) return rejectP(targetError(r));
    const conn = r.session.conn;
    const id = nextCmdId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      rejectP(new Error(`Oscine instance did not respond within ${timeoutMs / 1000}s (is the tab still open?).`));
    }, timeoutMs);
    pending.set(id, { resolve: resolveP, reject: rejectP, timer, conn });
    conn.send(JSON.stringify({ type: 'cmd', id, name, args }));
  });
}

function handleAppMessage(conn, raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }
  if (msg.type === 'hello') {
    const { id, staleConn } = registry.hello(conn.sessionId, msg);
    conn.sessionId = id;
    if (staleConn && !staleConn.closed && staleConn !== conn) staleConn.close();
    log(`app connected: project "${msg.project}" [${id}] (api v${msg.apiVersion}); ${registry.size} instance(s)`);
    if (gateway && gateway.subscribers.size > 0) setAppStreaming(true);
    broadcastSessions();
    return;
  }
  if (msg.type === 'event') {
    // Only the active instance feeds the OSC state stream.
    if (msg.name === 'state' && registry.activeId === conn.sessionId) gateway?.relayState(msg.data);
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

function handleAppClose(conn) {
  const removed = registry.removeByConn(conn);
  if (removed === null) return; // conn already replaced by a reconnect
  log(`app disconnected [${removed}]; ${registry.size} instance(s) left`);
  for (const [id, p] of pending) {
    if (p.conn === conn) {
      clearTimeout(p.timer);
      p.reject(new Error('Oscine instance disconnected mid-command.'));
      pending.delete(id);
    }
  }
  broadcastSessions();
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
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
};

// -- transcription (whisper via the sidecar) ---------------------------------
// Local whisper CLI + ffmpeg. Paths are overridable by env so another node
// can point at its own install. Cache key = sha256(file) + span + model.
const WHISPER = process.env.OSCINE_WHISPER || `${process.env.HOME}/.local/bin/whisper`;
const whisperModels = () => process.env.OSCINE_WHISPER_MODELS || `${PROJECT_ROOT}/tmp/whisper-models`; // PROJECT_ROOT is declared later in the file
const FFMPEG = process.env.OSCINE_FFMPEG || 'ffmpeg';
const JUNK_WORDS = new Set(['thank you for watching!', 'thanks for watching!', 'you', 'thank you.']);

function run(cmd, args, opts = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let out = '', err = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolvePromise(out) : reject(new Error(`${cmd} exited ${code}: ${err.slice(-800)}`)));
  });
}

async function transcribeFile(full, { from = null, to = null, model = 'small', force = false } = {}) {
  const buf = await readFile(full);
  const sha = createHash('sha256').update(buf).digest('hex');
  const span = (from != null || to != null) ? `_${(from ?? 0).toFixed(2)}-${to != null ? to.toFixed(2) : 'end'}` : '';
  const cacheDir = join(dirname(full), 'stems', 'words');
  const cacheFile = join(cacheDir, `${sha}${span}.${model}.json`);
  let raw = null;
  if (!force) { try { raw = JSON.parse(await readFile(cacheFile, 'utf8')); } catch {} }
  if (!raw) {
    const tmpDir = join(cacheDir, `.tmp-${process.pid}-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    const wav16 = join(tmpDir, 'a.wav');
    const ff = ['-y', '-v', 'error', '-i', full];
    if (from != null) ff.push('-ss', String(from));
    if (to != null) ff.push('-to', String(to));
    ff.push('-ac', '1', '-ar', '16000', wav16);
    await run(FFMPEG, ff);
    await run(WHISPER, [wav16, '--model', model, '--language', 'en', '--model_dir', whisperModels(),
      '--output_format', 'json', '--output_dir', tmpDir, '--word_timestamps', 'True', '--fp16', 'False']);
    raw = JSON.parse(await readFile(join(tmpDir, 'a.json'), 'utf8'));
    await writeFile(cacheFile, JSON.stringify(raw), 'utf8');
    try { const { rm } = await import('node:fs/promises'); await rm(tmpDir, { recursive: true, force: true }); } catch {}
  }
  const off = from ?? 0;
  const words = [];
  for (const seg of raw.segments ?? []) for (const w of seg.words ?? []) {
    const t = String(w.word ?? '').trim();
    if (!t || JUNK_WORDS.has(t.toLowerCase())) continue;
    words.push({ s: Math.round((w.start + off) * 1000) / 1000, e: Math.round((w.end + off) * 1000) / 1000, t });
  }
  return words;
}

async function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (urlPath === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ server: 'oscine-mcp', version: SERVER_VERSION, appConnected: registry.size > 0, instances: registry.size }));
    return;
  }
  // Tier-3 bytes: `/project/<rel>` serves files under PROJECT_ROOT so a loaded
  // *.oscine.json can fetch its `assets/<sha256>.wav` siblings. Same traversal
  // guard as resolveProjectPath, read-only, no directory listings.
  // `/projects.json` is the one listing: every *.oscine.json under the root,
  // so the app's File menu can open them by relative path without the MCP
  // side. `/project-doc/<rel>.oscine.json` returns that doc with baseUrl set,
  // exactly as oscine_project_open_file would hand it to the app.
  if (urlPath === '/projects.json') {
    const found = [];
    async function walk(dir, depth) {
      if (depth > 6) return;
      let ents;
      try { ents = await readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'assets') continue;
        const full = resolve(dir, e.name);
        if (e.isDirectory()) await walk(full, depth + 1);
        else if (e.name.endsWith('.oscine.json')) {
          let name = e.name.replace(/\.oscine\.json$/, '');
          try { name = JSON.parse(await readFile(full, 'utf8')).name || name; } catch {}
          found.push({ path: full.slice(PROJECT_ROOT.length + 1), name, mtime: (await stat(full)).mtimeMs });
        }
      }
    }
    await walk(PROJECT_ROOT, 0);
    found.sort((a, b) => b.mtime - a.mtime);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ root: PROJECT_ROOT, projects: found }));
    return;
  }
  // POST /transcribe  { file: '<rel path under PROJECT_ROOT>', from?, to?, model? }
  // Runs ffmpeg (mono 16 kHz, optional span) -> whisper (word timestamps) and
  // returns [{s,e,t}] in SOURCE seconds (span offset added back). Cached per
  // (sha256 of file, from, to, model) under <project dir>/stems/words/ so a
  // repeat is free. Errors are text with a 4xx/5xx; the app shows them.
  if (urlPath === '/transcribe' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    let args;
    try { args = JSON.parse(body); } catch { res.writeHead(400); res.end('bad json'); return; }
    let full;
    try { full = resolveAssetPath(args.file); } catch (err) { res.writeHead(400); res.end(err.message); return; }
    try {
      const words = await transcribeFile(full, args);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, words, count: words.length }));
    } catch (err) {
      res.writeHead(500); res.end(String(err?.message || err));
    }
    return;
  }
  // POST /reveal {path}  Open the folder holding a project (or any file under
  // the project root) in the OS file manager: Finder on macOS (`open -R`
  // selects the file), the default handler elsewhere. Local-only: the page
  // must be same-origin with the sidecar, and the path can't escape the root.
  if (urlPath === '/reveal' && req.method === 'POST') {
    const o = req.headers.origin;
    let local = !o;
    try { const h = new URL(o).hostname; local = local || h === '127.0.0.1' || h === 'localhost'; } catch {}
    if (!local) { res.writeHead(403); res.end('reveal is only available from a page served by this sidecar'); return; }
    let body = ''; for await (const chunk of req) body += chunk;
    let args; try { args = JSON.parse(body || '{}'); } catch { res.writeHead(400); res.end('bad json'); return; }
    const projectRoot = resolve(PROJECT_ROOT);
    const target = resolve(projectRoot, String(args.path || '.'));
    if (target !== projectRoot && !target.startsWith(projectRoot + '/')) { res.writeHead(400); res.end('path escapes the project root'); return; }
    try { await stat(target); } catch { res.writeHead(404); res.end('not found: ' + args.path); return; }
    const [cmd, argv] = process.platform === 'darwin' ? ['open', ['-R', target]]
      : process.platform === 'win32' ? ['explorer', ['/select,', target]]
      : ['xdg-open', [dirname(target)]];
    try {
      const { spawn } = await import('node:child_process');
      spawn(cmd, argv, { detached: true, stdio: 'ignore' }).unref();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, revealed: target.slice(projectRoot.length + 1) || '.' }));
    } catch (err) { res.writeHead(500); res.end(String(err?.message || err)); }
    return;
  }
  if (urlPath.startsWith('/project-doc/')) {
    let full;
    try { full = resolveProjectPath(urlPath.slice('/project-doc/'.length)); }
    catch (err) { res.writeHead(400); res.end(err.message); return; }
    if (req.method === 'PUT') {
      // Save from the app's File menu: same on-disk shape as
      // oscine_project_save_file (baseUrl stripped, 2-space JSON).
      let body = '';
      for await (const chunk of req) body += chunk;
      try {
        const { baseUrl, ...doc } = JSON.parse(body);
        await mkdir(dirname(full), { recursive: true });
        await writeFile(full, JSON.stringify(doc, null, 2) + '\n', 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, path: full, bytes: body.length }));
      } catch (err) { res.writeHead(400); res.end(err.message); }
      return;
    }
    try {
      const doc = JSON.parse(await readFile(full, 'utf8'));
      const relDir = dirname(full).slice(PROJECT_ROOT.length).replace(/^\/+/, '');
      doc.baseUrl = `/project/${relDir}${relDir ? '/' : ''}`;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(doc));
    } catch { res.writeHead(404); res.end('not found'); }
    return;
  }
  if (urlPath.startsWith('/project/')) {
    const full = resolve(PROJECT_ROOT, urlPath.slice('/project/'.length));
    if (full !== PROJECT_ROOT && !full.startsWith(PROJECT_ROOT + '/')) {
      res.writeHead(403); res.end('forbidden'); return;
    }
    try {
      const st = await stat(full);
      if (!st.isFile()) throw new Error('not a file');
      // Range support so long wavs can start decoding/seeking without a full read.
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
      const type = MIME[extname(full)] ?? 'application/octet-stream';
      if (range) {
        const start = range[1] ? Number(range[1]) : 0;
        const end = range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
        const body = (await readFile(full)).subarray(start, end + 1);
        res.writeHead(206, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': body.length });
        res.end(body);
      } else {
        res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': st.size });
        res.end(await readFile(full));
      }
    } catch {
      res.writeHead(404); res.end('not found');
    }
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
      onMessage: (raw) => handleAppMessage(conn, raw),
      onClose: () => handleAppClose(conn),
    });
    // Register the instance; do NOT close other tabs. Each tab is its own
    // addressable session, so two open tabs no longer fight over one slot.
    conn.sessionId = registry.add(conn);
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
//
// Skills as MCP resources: every plugin/skills/*/SKILL.md is exposed via
// resources/list (a short, known-but-unloaded listing: name + description)
// and resources/read (the full markdown body). Progressive disclosure:
// agents discover cheaply, load deeply only when needed.

const SKILLS_DIR = resolve(ROOT, '..', 'skills');
const SKILL_URI_PREFIX = 'oscine://skills/';

function parseSkillFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const km = /^(\w[\w-]*):\s*(.*)$/.exec(line);
    if (km) out[km[1]] = km[2].trim();
  }
  return out;
}

async function listSkills() {
  const out = [];
  let entries = [];
  try {
    entries = await readdir(SKILLS_DIR, { withFileTypes: true });
  } catch {
    return out; // no skills dir: empty list, never an error
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const path = join(SKILLS_DIR, e.name, 'SKILL.md');
    let text;
    try {
      text = await readFile(path, 'utf8');
    } catch {
      continue; // directory without SKILL.md is not a skill
    }
    const fm = parseSkillFrontmatter(text);
    out.push({
      uri: SKILL_URI_PREFIX + e.name,
      name: e.name,
      title: fm.name ?? e.name,
      description: fm.description ?? '',
      mimeType: 'text/markdown',
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

async function readSkill(name) {
  // name may come in as the full uri or the bare skill name
  const bare = name.startsWith(SKILL_URI_PREFIX) ? name.slice(SKILL_URI_PREFIX.length) : name;
  if (bare.includes('/') || bare.includes('..')) throw new Error(`Unknown resource: ${name}`);
  const path = join(SKILLS_DIR, bare, 'SKILL.md');
  const text = await readFile(path, 'utf8');
  const fm = parseSkillFrontmatter(text);
  return {
    contents: [{
      uri: SKILL_URI_PREFIX + bare,
      mimeType: 'text/markdown',
      text,
      ...(fm.name ? { name: fm.name } : {}),
      ...(fm.description ? { description: fm.description } : {}),
    }],
  };
}

const OPEN_APP_TOOL = {
  name: 'oscine_open_app',
  description: "Open the Oscine synth composer in the user's default browser, served by this plugin. Do this first if oscine_status reports the app isn't connected. After it loads, the app links to this server automatically. Audio needs one click in the tab (browser autoplay policy).",
  inputSchema: { type: 'object', properties: {} },
};

// Tier 2 of the project storage model (see cog's oscine-clip-architecture
// writeup): the *document* — an `<name>.oscine.json` file that lives next
// to a song's lyrics/notes/renders and is git-tracked. Bytes (tier 3, the
// content-addressed asset store) are never written here; only the project
// JSON that references them by hash.
//
// Path guard: writes/reads are confined to a `.oscine.json`-suffixed file
// inside an allowed root, resolved to prevent traversal. Default root is
// OSCINE_PROJECT_ROOT if set, else the cwd the sidecar was launched from.
const PROJECT_ROOT = resolve(process.env.OSCINE_PROJECT_ROOT || process.cwd());

export function resolveProjectPath(relPath, projectRoot = PROJECT_ROOT) {
  if (typeof relPath !== 'string' || !relPath.trim()) {
    throw new Error("'path' is required (relative to the project root, e.g. 'projects/songs/my-song/my-song.oscine.json').");
  }
  if (!relPath.endsWith('.oscine.json')) {
    throw new Error("'path' must end in .oscine.json — this tool writes project documents only, never asset bytes.");
  }
  const full = resolve(projectRoot, relPath);
  if (full !== projectRoot && !full.startsWith(projectRoot + '/')) {
    throw new Error(`'path' escapes the project root (${projectRoot}).`);
  }
  return full;
}

// Same traversal guard for READ-ONLY access to audio assets (transcription).
// Only audio extensions; never used for writes.
const ASSET_EXTS = new Set(['.wav', '.mp3', '.m4a', '.aac', '.ogg', '.flac', '.aiff', '.aif']);
export function resolveAssetPath(relPath, projectRoot = PROJECT_ROOT) {
  if (typeof relPath !== 'string' || !relPath.trim()) throw new Error("'file' is required (relative to the project root).");
  if (!ASSET_EXTS.has(extname(relPath).toLowerCase())) throw new Error(`'file' must be an audio file (${[...ASSET_EXTS].join(' ')}).`);
  const full = resolve(projectRoot, relPath);
  if (!full.startsWith(projectRoot + '/')) throw new Error(`'file' escapes the project root (${projectRoot}).`);
  return full;
}

const SESSIONS_TOOL = {
  name: 'oscine_sessions',
  description: "List the open Oscine instances (browser tabs) connected to this sidecar, or choose which one commands target. With several tabs open, commands go to the active instance unless you pass a `session` argument; call this to see what's open and to switch the active instance.",
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['list', 'select'], description: "'list' (default) shows the open instances; 'select' makes one active." },
      session: { type: 'string', description: "For 'select': the instance id (from list), its clientId, or its exact project name." },
    },
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
};

// Optional targeting arg injected into every project command so a specific
// instance can be addressed without first calling oscine_sessions select.
const SESSION_ARG = {
  type: 'string',
  description: 'Optional. Target a specific open Oscine instance by id (from oscine_sessions), clientId, or project name. Omit to use the active instance.',
};

const PROJECT_SAVE_FILE_TOOL = {
  name: 'oscine_project_save_file',
  description: "Save the running project to a git-trackable *.oscine.json file (tier 2 of the storage model: the document, not the bytes). Fetches the live project from the app and writes it to disk under the project root — the same place the song's lyrics/notes/renders live. Never writes audio; assets are referenced by hash, not embedded.",
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: "Relative path ending in .oscine.json, e.g. 'projects/songs/2026-09-19-housekeeping-heat/the-field-remains.oscine.json'." },
      session: SESSION_ARG,
    },
    required: ['path'],
  },
};

const PROJECT_OPEN_FILE_TOOL = {
  name: 'oscine_project_open_file',
  description: "Load a *.oscine.json project document from disk (tier 2) into the running app, replacing the current project (one undo away). Validates and upgrades the schema on load, so files saved under an older format version still open.",
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: "Relative path to an existing .oscine.json file under the project root." },
      session: SESSION_ARG,
    },
    required: ['path'],
  },
};

function toolList() {
  return [
    OPEN_APP_TOOL,
    SESSIONS_TOOL,
    PROJECT_SAVE_FILE_TOOL,
    PROJECT_OPEN_FILE_TOOL,
    ...COMMANDS.map(c => ({
      name: `oscine_${c.name}`,
      description: c.description,
      // Clone the catalog schema and add `session`; never mutate COMMANDS.
      inputSchema: {
        ...c.input,
        properties: { ...(c.input.properties || {}), session: SESSION_ARG },
      },
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
    if (registry.size > 0) return true;
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
}

async function dispatchTool(name, args) {
  if (name === 'oscine_open_app') {
    if (registry.size > 0) {
      return {
        ok: true,
        alreadyOpen: true,
        url: appUrl(),
        instances: registry.size,
        active: registry.active?.id ?? null,
        note: registry.size > 1
          ? `${registry.size} instances are open; the newest is active. Use oscine_sessions to see or change the target.`
          : 'App is already connected.',
      };
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

  if (name === 'oscine_sessions') {
    const action = args.action || 'list';
    if (action === 'select') {
      const s = registry.setActive(args.session);
      if (!s) {
        return { ok: false, error: `No open Oscine instance matches "${args.session ?? ''}".`, sessions: registry.list() };
      }
      broadcastSessions();
      return { ok: true, active: s.id, sessions: registry.list() };
    }
    return { active: registry.active?.id ?? null, count: registry.size, sessions: registry.list() };
  }

  if (name === 'oscine_project_save_file') {
    const full = resolveProjectPath(args?.path);
    const project = await callApp('project', { action: 'get' }, 15000, args?.session ?? null);
    if (!project || typeof project !== 'object') {
      return { ok: false, error: 'Could not fetch the live project from the app.' };
    }
    await mkdir(dirname(full), { recursive: true });
    const { baseUrl, ...doc } = project; // baseUrl is load-time only, never persisted
    await writeFile(full, JSON.stringify(doc, null, 2) + '\n', 'utf8');
    return { ok: true, path: full, bytes: JSON.stringify(doc).length, name: project.name, version: project.version };
  }

  if (name === 'oscine_project_open_file') {
    const full = resolveProjectPath(args?.path);
    let text;
    try {
      text = await readFile(full, 'utf8');
    } catch (err) {
      return { ok: false, error: `Could not read ${full}: ${err.message}` };
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      return { ok: false, error: `${full} is not valid JSON: ${err.message}` };
    }
    // Tell the app where this document lives so relative asset refs resolve
    // through the /project/ route. Not persisted by save (it's a load-time fact).
    const relDir = dirname(full).slice(PROJECT_ROOT.length).replace(/^\/+/, '');
    parsed.baseUrl = `/project/${relDir}${relDir ? '/' : ''}`;
    const result = await callApp('project', { action: 'load', project: parsed }, 15000, args?.session ?? null);
    return { ...result, path: full, baseUrl: parsed.baseUrl };
  }

  const cmdName = name.replace(/^oscine_/, '');
  const selector = args?.session ?? null;
  const forwardArgs = { ...(args || {}) };
  delete forwardArgs.session;

  if (cmdName === 'status' && registry.size === 0) {
    return {
      server: 'oscine-mcp',
      version: SERVER_VERSION,
      url: appUrl(),
      appConnected: false,
      sessions: [],
      osc: gateway?.info(),
      hint: 'The Oscine app is not open. Call oscine_open_app to launch it, then retry.',
    };
  }
  const result = await callApp(cmdName, forwardArgs, 15000, selector);
  if (cmdName === 'status' && result && typeof result === 'object') {
    result.osc = gateway?.info(); // udp control surface: port + subscriber count
    result.sessions = registry.list();
    result.activeSession = registry.active?.id ?? null;
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
          capabilities: { tools: {}, resources: {} },
          serverInfo: { name: 'oscine', title: 'Oscine Synth Composer', version: SERVER_VERSION },
        });
        return;
      case 'ping':
        if (isRequest) rpcResult(id, {});
        return;
      case 'tools/list':
        rpcResult(id, { tools: toolList() });
        return;
      case 'resources/list': {
        const skills = await listSkills();
        rpcResult(id, { resources: skills });
        return;
      }
      case 'resources/read': {
        const uri = params?.uri ?? '';
        try {
          rpcResult(id, await readSkill(uri));
        } catch {
          rpcError(id, -32602, `Unknown resource: ${uri}`);
        }
        return;
      }
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

// Only run the sidecar (stdio RPC loop + HTTP + OSC) when this file is
// executed directly (`node oscine-mcp.mjs`), not when it's imported as a
// module (e.g. the test suite importing resolveProjectPath). Without this
// guard, importing the file for a single helper function would also open
// network ports and attach a stdin listener that calls process.exit(0) as
// soon as stdin closes -- silently killing whatever imported it.
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
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
}
