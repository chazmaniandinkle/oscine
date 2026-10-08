// Tool-surface shakedown, 2026-10-08: compose a DnB loop ONLY through MCP tools,
// play MIDI in through the tool, then bounce it and hand the WAV to the ear.
// Question: can an agent make something and then hear what it made?
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const ROOT = '/Users/slowbro/workspaces/oscine';
const OUT = '/Users/slowbro/workspaces/cog/projects/dj/oscine-shakedown';
const PORT = 7397;
const sc = spawn('node', [`${ROOT}/plugin/server/oscine-mcp.mjs`], {
  env: { ...process.env, OSCINE_PORT: String(PORT), OSCINE_OSC_PORT: '7398', OSCINE_PROJECT_ROOT: '/Users/slowbro/workspaces/cog' },
  stdio: ['pipe', 'pipe', 'inherit'],
});
let buf = '', id = 0; const waiters = new Map();
sc.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); waiters.get(m.id)?.(m); } catch {} } });
const rpc = (method, params = {}) => new Promise(ok => { const n = ++id; waiters.set(n, ok); sc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n'); });
const log = []; const note = (k, v) => { const s = typeof v === 'string' ? v : JSON.stringify(v); log.push(`${k}: ${s.slice(0, 400)}`); console.log(k, '->', s.slice(0, 300)); };
const call = async (name, args = {}) => { const r = await rpc('tools/call', { name: 'oscine_' + name, arguments: args }); const t = r.result?.content?.[0]?.text ?? JSON.stringify(r.error); let v; try { v = JSON.parse(t); } catch { v = t; } return { v, isError: !!r.result?.isError || !!r.error }; };
const { chromium } = await import('playwright-core');
await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'cog-shakedown', version: '1' } });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto(`http://127.0.0.1:${PORT}/`);
await page.waitForFunction(() => window.oscine?.store?.project, null, { timeout: 20000 });
await page.waitForTimeout(1500);
const tools = (await rpc('tools/list')).result.tools;
note('tools', `${tools.length}: ${tools.map(t => t.name.replace('oscine_', '')).join(' ')}`);
note('tool schema bytes', tools.reduce((a, t) => a + JSON.stringify(t).length, 0));

let r;
r = await call('project', { action: 'new', kind: 'blank', name: 'shakedown-dnb' }); note('project new', r);
r = await call('transport', { bpm: 174 }); note('bpm 174', r);
r = await call('transport', { bpm: 174.5 }); note('bpm 174.5 (fractional)', r);
r = await call('slots', { action: 'set_bars', bars: 8 }); note('bars 8', r);
r = await call('slots', { action: 'set_bars', bars: 16 }); note('bars 16 (a DnB phrase is 16-32)', r);
r = await call('list_instruments'); note('instruments', Object.keys(r.v?.instruments ?? r.v ?? {}).join(',') || r);
r = await call('status'); note('status', r);
const tracks = r.v?.tracks ?? [];
note('starting tracks', tracks.map(t => `${t.name}(${t.type})`).join(','));
r = await call('add_track', { type: 'drums', name: 'Breaks' }); note('add drums', r);
r = await call('add_track', { type: 'poly', name: 'Reese' }); note('add poly', r);
// two-step: kick 1 and the "and" of 3, snare 2 and 4; 16 steps per bar x 8 bars
const steps = 128, bar = i => i % 16;
const kick = Array.from({ length: steps }, (_, i) => [0, 10].includes(bar(i)) ? 1 : 0);
const snare = Array.from({ length: steps }, (_, i) => [4, 12].includes(bar(i)) ? 0.95 : 0);
const chat = Array.from({ length: steps }, (_, i) => i % 2 === 0 ? 0.5 : 0);
r = await call('set_steps', { track: 'Breaks', mode: 'replace', lanes: { kick, snare, chat } }); note('set_steps', r);
// reese: 2-bar riff in D minor, 4 beats/bar
const notes = [];
for (let b = 0; b < 8; b += 2) { notes.push({ start: b * 4, pitch: 38, dur: 3, vel: 0.9 }, { start: b * 4 + 3.5, pitch: 41, dur: 0.5 }, { start: b * 4 + 4, pitch: 36, dur: 3.5, vel: 0.9 }); }
r = await call('set_notes', { track: 'Reese', mode: 'replace', notes }); note('set_notes', r);
r = await call('set_params', { track: 'Reese', params: { cutoff: 600 } }); note('set_params cutoff', r);

// MIDI surface: arm, inject a played phrase, read it back from the ledger
r = await call('midi', { action: 'status' }); note('midi status', r);
r = await call('select_track', { track: 'Reese' }); note('select Reese', r);
for (const [p, v] of [[50, 100], [53, 90], [57, 110]]) { await call('midi', { action: 'input', bytes: [0x90, p, v] }); await page.waitForTimeout(120); await call('midi', { action: 'input', bytes: [0x80, p, 0] }); }
r = await call('ledger', { action: 'read', sinceSec: 10 }); note('ledger after 3 injected notes', r);

// Bounce: what does the agent actually get back?
r = await call('export_wav', { loops: 2 }); note('export_wav', r);
// The agent has no way to get the audio through tools; reach in like a harness would.
const b64 = await page.evaluate(async () => {
  const { renderProjectToBuffer } = await import('/src/engine/render.js');
  const { encodeWav } = await import('/src/core/wav.js');
  const p = structuredClone(window.oscine.store.project);
  const res = await renderProjectToBuffer(p, { loops: 2, slotIndex: 0 });
  const ch = [res.buffer.getChannelData(0), res.buffer.getChannelData(1)];
  const blob = encodeWav(ch, res.sampleRate);
  const bytes = new Uint8Array(blob instanceof Blob ? await blob.arrayBuffer() : blob.buffer ?? blob);
  let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
});
writeFileSync(`${OUT}/loop.wav`, Buffer.from(b64, 'base64'));
note('rendered bytes', Buffer.from(b64, 'base64').length);
note('page errors', errs);
writeFileSync(`${OUT}/drive-log.txt`, log.join('\n') + '\n');
await browser.close(); sc.kill();
