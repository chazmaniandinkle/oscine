// End-to-end MCP test: spawns the plugin sidecar, speaks real MCP
// JSON-RPC over its stdio, loads the app (served by the sidecar itself)
// in headless Chromium, and drives the whole chain:
//
//   MCP client (this file) -> sidecar stdio -> WebSocket -> app -> store/engine
//
// Requires playwright-core + a chromium binary (CHROME_BIN env or
// playwright's default install). Skips gracefully if unavailable.
// Run: node test/e2e-mcp.mjs

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 7461;
let failures = 0;
const check = (name, cond, detail = '') => {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

// -- Try to get a browser; skip cleanly if we can't. --------------------------
let chromium = null;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  console.log('SKIP: playwright-core not installed (npm i -D playwright-core). Smoke tests still cover the API.');
  process.exit(0);
}
const executablePath = process.env.CHROME_BIN;
if (!executablePath) {
  console.log('SKIP: set CHROME_BIN to a chromium binary to run the e2e test.');
  process.exit(0);
}

// -- Minimal MCP client over the sidecar's stdio. ------------------------------
const OSC_PORT = 7441;
const sidecar = spawn('node', [join(ROOT, 'plugin/server/oscine-mcp.mjs')], {
  env: { ...process.env, OSCINE_PORT: String(PORT), OSCINE_OSC_PORT: String(OSC_PORT) },
  stdio: ['pipe', 'pipe', 'pipe'],
});
sidecar.stderr.on('data', d => process.env.E2E_VERBOSE && console.error('[sidecar]', d.toString().trim()));

const pendingRpc = new Map();
let rpcId = 0;
createInterface({ input: sidecar.stdout }).on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const p = pendingRpc.get(msg.id);
  if (p) { pendingRpc.delete(msg.id); p(msg); }
});

function rpc(method, params = {}, timeoutMs = 20000) {
  const id = ++rpcId;
  sidecar.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  return new Promise((res, rej) => {
    const t = setTimeout(() => { pendingRpc.delete(id); rej(new Error(`rpc timeout: ${method}`)); }, timeoutMs);
    pendingRpc.set(id, (msg) => { clearTimeout(t); res(msg); });
  });
}

const callTool = async (name, args = {}) => {
  const msg = await rpc('tools/call', { name, arguments: args });
  const text = msg.result?.content?.[0]?.text ?? '';
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* error strings stay strings */ }
  return { isError: !!msg.result?.isError, text, json: parsed };
};

let browser = null;
try {
  // -- MCP handshake -----------------------------------------------------------
  const init = await rpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'e2e-test', version: '0' },
  });
  check('initialize returns serverInfo + tools capability',
    init.result?.serverInfo?.name === 'oscine' && !!init.result?.capabilities?.tools);
  sidecar.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  const list = await rpc('tools/list');
  const tools = list.result?.tools ?? [];
  // Derive the expected tool count from the catalog so it never goes stale:
  // every command surfaces as a tool, plus the two sidecar-only meta tools
  // (open_app, sessions) that are not in the catalog.
  const { COMMANDS } = await import(`${ROOT}/src/api/commands.js`);
  const expectedTools = COMMANDS.length + 2;
  check(`tools/list exposes open_app + sessions + all ${COMMANDS.length} catalog commands`,
    tools.length === expectedTools, `got ${tools.length}, expected ${expectedTools}`);
  check('oscine_sessions meta-tool is present', tools.some(t => t.name === 'oscine_sessions'));
  check('catalog tools carry the optional session targeting arg',
    tools.find(t => t.name === 'oscine_set_notes')?.inputSchema?.properties?.session?.type === 'string');
  check('tool names are oscine_-prefixed with schemas',
    tools.every(t => t.name.startsWith('oscine_') && t.inputSchema?.type === 'object'));
  check('read-only tools annotated',
    tools.find(t => t.name === 'oscine_get_notes')?.annotations?.readOnlyHint === true);

  // -- Before the app connects: graceful guidance --------------------------------
  const early = await callTool('oscine_status');
  check('status before app connect: friendly, not an error',
    !early.isError && early.json?.appConnected === false && /open_app/.test(early.json?.hint ?? ''));

  const earlyPlay = await callTool('oscine_transport', { action: 'play' });
  check('mutating tool before app connect: actionable error',
    earlyPlay.isError && /open_app|browser/i.test(earlyPlay.text));

  // -- App boots from the sidecar's own HTTP server -------------------------------
  browser = await chromium.launch({
    executablePath,
    args: ['--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required'],
    env: { ...process.env, LD_LIBRARY_PATH: process.env.WS_LIB_PATH ?? process.env.LD_LIBRARY_PATH ?? '' },
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => consoleErrors.push('PAGEERROR: ' + e.message));
  await page.goto(`http://127.0.0.1:${PORT}/`);

  // Wait for the bridge to attach.
  let connected = false;
  for (let i = 0; i < 30 && !connected; i++) {
    await new Promise(r => setTimeout(r, 250));
    const s = await callTool('oscine_status');
    connected = !s.isError && s.json?.app === 'oscine';
  }
  check('app served by sidecar connects to bridge', connected);

  // -- Drive the app end to end ----------------------------------------------------
  const status = await callTool('oscine_status');
  check('status shows demo project through full chain',
    status.json?.project?.name === 'First Light' && status.json?.tracks?.length === 4);

  const play = await callTool('oscine_transport', { action: 'play', bpm: 120 });
  check('transport play via MCP', play.json?.playing === true && play.json?.bpm === 120);
  await new Promise(r => setTimeout(r, 900));
  const pos = await callTool('oscine_status');
  check('position advances while playing', pos.json?.transport?.positionBeat > 0.5);

  const slotQ = await callTool('oscine_slots', { action: 'select', slot: 'B' });
  check('slot queues while playing via MCP', slotQ.json?.queuedSlot === 'B');

  const notes = await callTool('oscine_set_notes', {
    track: 'Bass', mode: 'replace', slot: 'A',
    notes: [
      { start: 0, pitch: 33, dur: 0.45, vel: 0.95 },
      { start: 1, pitch: 33, dur: 0.45, vel: 0.8 },
      { start: 2, pitch: 36, dur: 0.45, vel: 0.9 },
      { start: 3, pitch: 31, dur: 0.45, vel: 0.85 },
    ],
  });
  check('set_notes writes through full chain', notes.json?.noteCount === 4);

  const roundTrip = await callTool('oscine_get_notes', { track: 'Bass', slot: 'A' });
  check('get_notes round-trips the written pattern',
    roundTrip.json?.notes?.[2]?.pitch === 36 && roundTrip.json?.notes?.[2]?.noteName === 'C2');

  const steps = await callTool('oscine_set_steps', {
    track: 'Drums', mode: 'merge', lanes: { ohat: [0, 0, 1, 0, 0, 0, 1, 0] },
  });
  check('set_steps writes through full chain', steps.json?.lanes?.ohat?.[2] === 1);

  const params = await callTool('oscine_set_params', { track: 'Lead', preset: 'Bell', params: { release: 2 } });
  check('set_params through full chain', params.json?.params?.ratio === 3 && params.json?.params?.release === 2);

  const mix = await callTool('oscine_set_mix', { track: 'Keys', sendReverb: 0.8, pan: 0.4 });
  check('set_mix through full chain', mix.json?.channel?.sendReverb === 0.8);

  const undo = await callTool('oscine_project', { action: 'undo' });
  check('undo through full chain', undo.json?.ok === true);

  // -- Share loop: real OfflineAudioContext render + song-in-URL ------------------
  // export_wav runs an actual offline bounce in headless Chromium, the one
  // path node smoke tests can only stub.
  const wav = await callTool('oscine_export_wav', { slot: 'A', loops: 1 });
  check('export_wav renders a real WAV through the full chain',
    !wav.isError && wav.json?.ok === true && wav.json?.channels === 2 &&
    wav.json?.bytes > 44 && wav.json?.durationSec > 0,
    `got ${wav.text}`);

  const link = await callTool('oscine_share', { action: 'link' });
  check('share link encodes the song into a URL', !link.isError && /#s=/.test(link.json?.url ?? ''));
  const reopened = await callTool('oscine_share', { action: 'open', url: link.json?.url });
  check('share open reloads the song from its link', !reopened.isError && reopened.json?.ok === true);

  // -- OSC gateway: real UDP in and out ------------------------------------------
  {
    const { createSocket } = await import('node:dgram');
    const { encodeMessage, decodePacket } = await import(join(ROOT, 'plugin/server/osc-codec.js'));
    const osc = createSocket('udp4');
    const received = [];
    osc.on('message', (data) => {
      try { received.push(...decodePacket(data)); } catch { /* ignore */ }
    });
    await new Promise(r => osc.bind(0, '127.0.0.1', r));
    const send = (addr, args = []) =>
      new Promise(r => osc.send(encodeMessage(addr, args), OSC_PORT, '127.0.0.1', r));

    await send('/oscine/bpm', [150]);
    await send('/oscine/track/Bass/gain', [0.5]);
    let oscApplied = false;
    for (let i = 0; i < 20 && !oscApplied; i++) {
      await new Promise(r => setTimeout(r, 150));
      const s = await callTool('oscine_status');
      const bass = s.json?.tracks?.find(t => t.name === 'Bass');
      oscApplied = s.json?.transport?.bpm === 150 && Math.abs((bass?.channel?.gain ?? 0) - 0.5) < 1e-6;
    }
    check('OSC UDP control reaches the app (bpm + track gain)', oscApplied);

    const statusOsc = await callTool('oscine_status');
    check('status reports the OSC gateway', statusOsc.json?.osc?.port === OSC_PORT);

    await send('/oscine/subscribe', []);
    let gotPosition = false, gotMeter = false;
    for (let i = 0; i < 25 && !(gotPosition && gotMeter); i++) {
      await new Promise(r => setTimeout(r, 120));
      gotPosition = received.some(m => m.address === '/oscine/position' && typeof m.args[0] === 'number');
      gotMeter = received.some(m => m.address.startsWith('/oscine/meter/'));
    }
    check('OSC subscribers receive position stream while playing', gotPosition);
    check('OSC subscribers receive meters', gotMeter);

    await send('/oscine/unsubscribe', []);
    osc.close();
  }

  // UI reflected the API writes?
  const uiState = await page.evaluate(() => {
    const o = window.oscine;
    const byName = (n) => o.store.project.tracks.find(t => t.name === n);
    return {
      bridgeDotOn: document.querySelector('.bridge-dot')?.classList.contains('on'),
      bassNotes: o.store.getPattern(byName('Bass').id, 0).notes.length,
      leadPreset: byName('Lead').instrument.preset,
      leadRatio: byName('Lead').instrument.params.ratio,
      playing: o.transport.playing,
    };
  });
  check('UI bridge dot lit', uiState.bridgeDotOn === true);
  // The undo reverts the most recent checkpoint: the set_params preset
  // application. So Lead is back to its demo E-Piano patch while the
  // earlier 4-note bass write survives -- exactly LIFO history semantics.
  check('undo reverted the preset (LIFO), earlier note write survives',
    uiState.bassNotes === 4 && uiState.leadPreset === 'E-Piano' && uiState.leadRatio === 1 && uiState.playing === true,
    JSON.stringify(uiState));

  await callTool('oscine_transport', { action: 'stop' });
  const stopped = await callTool('oscine_status');
  check('stop via MCP', stopped.json?.transport?.playing === false);

  check('no console errors in the app throughout', consoleErrors.length === 0,
    consoleErrors.slice(0, 3).join(' | '));
} catch (err) {
  failures++;
  console.error('FAIL  e2e crashed —', err.message);
} finally {
  try { await browser?.close(); } catch { /* ok */ }
  sidecar.kill();
}

console.log('');
if (failures) {
  console.error(`${failures} e2e check(s) FAILED`);
  process.exit(1);
}
console.log('Full MCP chain verified end to end.');
