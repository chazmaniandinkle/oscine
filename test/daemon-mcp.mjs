// Daemon mode + the HTTP MCP endpoint: OSCINE_DAEMON=1 survives a closed stdin,
// serves the same tool list over POST /mcp, answers tools/call without an app
// (oscine_sessions), and refuses browser origins, proxy headers, bad Host, GET.
// No browser needed. Run: node test/daemon-mcp.mjs
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mcpGuard } from '../plugin/server/oscine-mcp.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 7463, OSC = 7443;
let failures = 0;
const check = (name, cond, detail = '') => {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

// -- the guard, pure ---------------------------------------------------------
const good = { host: '127.0.0.1:7450' };
check('guard: plain loopback client passes', mcpGuard(good, '127.0.0.1') === null);
check('guard: ipv4-mapped loopback passes', mcpGuard(good, '::ffff:127.0.0.1') === null);
check('guard: non-loopback peer refused', mcpGuard(good, '192.168.1.5') !== null);
check('guard: any Origin refused (even localhost)', mcpGuard({ ...good, origin: 'http://127.0.0.1:7450' }, '127.0.0.1') !== null);
check('guard: foreign Host refused (DNS rebinding)', mcpGuard({ host: 'evil.example:7450' }, '127.0.0.1') !== null);
for (const h of ['x-forwarded-for', 'x-forwarded-host', 'forwarded', 'cf-connecting-ip', 'x-real-ip']) {
  check(`guard: ${h} refused`, mcpGuard({ ...good, [h]: '1.2.3.4' }, '127.0.0.1') !== null);
}

// -- the daemon, for real ----------------------------------------------------
const child = spawn('node', [join(ROOT, 'plugin/server/oscine-mcp.mjs')], {
  stdio: ['ignore', 'pipe', 'pipe'],           // stdin closes at once: a stdio sidecar would exit here
  env: { ...process.env, OSCINE_DAEMON: '1', OSCINE_PORT: String(PORT), OSCINE_OSC_PORT: String(OSC), OSCINE_PROJECT_ROOT: ROOT },
});
let exited = null;
child.on('exit', (c) => { exited = c; });
let stderr = '';
child.stderr.on('data', (d) => { stderr += d; });

const http = (method, path, { body, headers = {} } = {}) => new Promise((res, rej) => {
  const data = body === undefined ? null : JSON.stringify(body);
  const r = request({ host: '127.0.0.1', port: PORT, method, path, headers: { ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}), ...headers } }, (resp) => {
    let t = ''; resp.on('data', (c) => { t += c; }); resp.on('end', () => res({ status: resp.statusCode, text: t, json: () => JSON.parse(t) }));
  });
  r.on('error', rej); if (data) r.write(data); r.end();
});
const rpc = (id, method, params) => http('POST', '/mcp', { body: { jsonrpc: '2.0', id, method, params } });

try {
  for (let i = 0; i < 50; i++) {
    try { if ((await http('GET', '/health')).status === 200) break; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  check('daemon is up and survived a closed stdin', exited === null && (await http('GET', '/health')).status === 200, stderr.slice(-300));

  const init = (await rpc(1, 'initialize', { protocolVersion: '2025-06-18' })).json();
  check('initialize over HTTP', init.result?.serverInfo?.name === 'oscine' && init.id === 1);
  const list = (await rpc(2, 'tools/list')).json();
  const names = list.result.tools.map((t) => t.name);
  check('tools/list: the full catalog', names.length >= 40 && names.includes('oscine_open_app') && names.includes('oscine_project_open_file') && names.includes('oscine_transport'), `n=${names.length}`);
  const sess = (await rpc(3, 'tools/call', { name: 'oscine_sessions', arguments: {} })).json();
  const sessBody = JSON.parse(sess.result.content[0].text);
  check('tools/call oscine_sessions works with no app open', sess.result.isError === false && sessBody.count === 0);
  const noapp = (await rpc(4, 'tools/call', { name: 'oscine_status', arguments: {} })).json();
  check('tools/call oscine_status says the app is closed (not an HTTP error)', JSON.parse(noapp.result.content[0].text).appConnected === false);
  const bad = (await rpc(5, 'tools/call', { name: 'oscine_project_open_file', arguments: { path: '../etc/passwd' } })).json();
  check('tools/call surfaces handler errors as isError', bad.result.isError === true);
  const nf = (await rpc(6, 'no/such')).json();
  check('unknown method: JSON-RPC -32601', nf.error?.code === -32601);

  const note = await http('POST', '/mcp', { body: { jsonrpc: '2.0', method: 'notifications/initialized' } });
  check('notification: 202, empty body', note.status === 202 && note.text === '');
  const batch = (await http('POST', '/mcp', { body: [{ jsonrpc: '2.0', id: 7, method: 'ping' }, { jsonrpc: '2.0', id: 8, method: 'tools/list' }] })).json();
  check('batch: one response per request', Array.isArray(batch) && batch.length === 2);
  check('bad JSON: -32700', (await http('POST', '/mcp', { headers: { 'content-type': 'application/json' }, body: undefined })).status === 400);

  check('GET /mcp: 405', (await http('GET', '/mcp')).status === 405);
  check('browser Origin refused: 403', (await http('POST', '/mcp', { body: { jsonrpc: '2.0', id: 1, method: 'ping' }, headers: { origin: 'https://evil.example' } })).status === 403);
  check('Origin of the app itself refused too', (await http('POST', '/mcp', { body: { jsonrpc: '2.0', id: 1, method: 'ping' }, headers: { origin: `http://127.0.0.1:${PORT}` } })).status === 403);
  check('proxied request refused: 403', (await http('POST', '/mcp', { body: { jsonrpc: '2.0', id: 1, method: 'ping' }, headers: { 'x-forwarded-for': '9.9.9.9' } })).status === 403);
  check('wrong Host refused: 403', (await http('POST', '/mcp', { body: { jsonrpc: '2.0', id: 1, method: 'ping' }, headers: { host: 'evil.example' } })).status === 403);
  // A client that vanishes with only a FIN (no close frame) must not linger as a ghost session.
  const { connect } = await import('node:net');
  const raw = await new Promise((res) => {
    const s = connect(PORT, '127.0.0.1', () => {
      s.write('GET /bridge HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n');
      s.once('data', () => res(s));
    });
  });
  const sessions = async () => JSON.parse((await rpc(90, 'tools/call', { name: 'oscine_sessions', arguments: {} })).json().result.content[0].text).count;
  check('a raw websocket client registers a session', await sessions() === 1);
  raw.end();                                  // FIN, no WebSocket close frame
  let left = 1;
  for (let i = 0; i < 30 && left; i++) { await new Promise((r) => setTimeout(r, 100)); left = await sessions(); }
  check('a client that only sends FIN is reaped, not left as a ghost session', left === 0);
  check('the app shell still serves', (await http('GET', '/')).status === 200);
  check('/projects.json lists under OSCINE_PROJECT_ROOT', Array.isArray((await http('GET', '/projects.json')).json().projects));

  // -- a hosted page (myrgic.com/oscine -> GitHub Pages) reaching this sidecar --
  const PAGES = 'https://chazmaniandinkle.github.io';
  const pre = await new Promise((res, rej) => {
    const r = request({ host: '127.0.0.1', port: PORT, method: 'OPTIONS', path: '/projects.json', headers: { origin: PAGES, 'access-control-request-method': 'GET', 'access-control-request-private-network': 'true' } },
      (resp) => { resp.resume(); resp.on('end', () => res(resp)); });
    r.on('error', rej); r.end();
  });
  check('hosted origin: preflight 204 with CORS + private-network allow',
    pre.statusCode === 204 && pre.headers['access-control-allow-origin'] === PAGES && pre.headers['access-control-allow-private-network'] === 'true');
  const hostedGet = await new Promise((res, rej) => {
    const r = request({ host: '127.0.0.1', port: PORT, method: 'GET', path: '/projects.json', headers: { origin: PAGES } },
      (resp) => { let t = ''; resp.on('data', (c) => { t += c; }); resp.on('end', () => res({ resp, t })); });
    r.on('error', rej); r.end();
  });
  check('hosted origin: GET /projects.json carries Allow-Origin', hostedGet.resp.headers['access-control-allow-origin'] === PAGES && Array.isArray(JSON.parse(hostedGet.t).projects));
  const evilGet = await new Promise((res, rej) => {
    const r = request({ host: '127.0.0.1', port: PORT, method: 'GET', path: '/projects.json', headers: { origin: 'https://evil.example' } },
      (resp) => { resp.resume(); resp.on('end', () => res(resp)); });
    r.on('error', rej); r.end();
  });
  check('other origins: no Allow-Origin (browser blocks the read)', evilGet.headers['access-control-allow-origin'] === undefined);
  const evilPre = await new Promise((res, rej) => {
    const r = request({ host: '127.0.0.1', port: PORT, method: 'OPTIONS', path: '/projects.json', headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' } },
      (resp) => { resp.resume(); resp.on('end', () => res(resp)); });
    r.on('error', rej); r.end();
  });
  check('other origins: preflight refused 403', evilPre.statusCode === 403);
  check('/mcp still refuses the hosted origin', (await http('POST', '/mcp', { body: { jsonrpc: '2.0', id: 1, method: 'ping' }, headers: { origin: PAGES } })).status === 403);
} finally {
  child.kill('SIGTERM');
}
await new Promise((r) => setTimeout(r, 300));
check('SIGTERM stops it', exited !== null);
console.log(`\ndaemon-mcp: ${failures ? failures + ' FAILED' : 'all passed'}`);
process.exit(failures ? 1 : 0);
