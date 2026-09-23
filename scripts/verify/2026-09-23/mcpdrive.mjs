// Drive the merged build the way Claude would: a real MCP stdio sidecar,
// the app connected over the bridge in headless Chrome, arrangement edits
// through tools/call, then check the UI's own state reflects them, then undo.
import { spawn } from 'node:child_process';
const ROOT = '/Users/slowbro/workspaces/oscine';
const PORT = 7395;
const sc = spawn('node', [`${ROOT}/plugin/server/oscine-mcp.mjs`], {
  env: { ...process.env, OSCINE_PORT: String(PORT), OSCINE_OSC_PORT: '7396', OSCINE_PROJECT_ROOT: '/Users/slowbro/workspaces/cog' },
  stdio: ['pipe', 'pipe', 'inherit'],
});
let buf = '', id = 0; const waiters = new Map();
sc.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(line); waiters.get(m.id)?.(m); } catch {} } });
const rpc = (method, params = {}) => new Promise(ok => { const n = ++id; waiters.set(n, ok); sc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n'); });
const call = async (name, args = {}) => { const r = await rpc('tools/call', { name, arguments: args }); const t = r.result?.content?.[0]?.text ?? JSON.stringify(r.error); try { return JSON.parse(t); } catch { return t; } };
const { chromium } = await import('playwright-core');
await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'cog-check', version: '1' } });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto(`http://127.0.0.1:${PORT}/?p=projects/songs/2026-09-19-housekeeping-heat/borrowed-light.oscine.json`);
await page.waitForFunction(() => window.oscine?.store?.project?.arrangement?.placements?.length > 0, null, { timeout: 20000 });
await page.waitForTimeout(1500);
const ui = (f) => page.evaluate(f);
const tools = (await rpc('tools/list')).result.tools.map(t => t.name);
console.log('tools:', tools.length, '| arrangement tools present:', ['oscine_arrangement', 'oscine_clip', 'oscine_lane', 'oscine_marker', 'oscine_cycle', 'oscine_range', 'oscine_insert', 'oscine_automation', 'oscine_words'].every(t => tools.includes(t)));

const g = await call('oscine_arrangement', { action: 'get' });
console.log('arrangement get:', JSON.stringify(g).length, 'bytes |', g.lanes?.length, 'lanes,', g.placements?.length, 'placements, length', g.length);
const depth0 = await ui(() => window.oscine.store.history?.past?.length ?? window.oscine.store.undoStack?.length);

// 1. markers: Claude lays out the song's sections
for (const [t, name] of [[0, 'Intro'], [27.5, 'Verse 1'], [62, 'Chorus'], [143.2, 'Bridge'], [175, 'Final chorus']])
  await call('oscine_marker', { action: 'add', t, name });
console.log('UI markers after 5 marker adds:', await ui(() => window.oscine.store.project.arrangement.markers.map(m => `${m.name}@${m.t}`).join(', ')));

// 2. a lane edit shows in the gutter/mixer model
await call('oscine_lane', { action: 'set', lane: 'Carl Sagan', gainDb: -2 });
console.log('UI Carl gain:', await ui(() => window.oscine.store.project.arrangement.lanes.find(l => l.name === 'Carl Sagan').gainDb));

// 3. an insert on the vocal + an automation envelope on one of its params
const ins = await call('oscine_insert', { action: 'add', lane: 'Vocal · render 2', type: 'eq3' });
console.log('insert add ->', JSON.stringify(ins).slice(0, 120));
const au = await call('oscine_automation', { action: 'set_points', target: 'lane:vocal-r2:insert:0:highGain', points: [{ t: 140, v: 0 }, { t: 143.2, v: -9, shape: 'hold' }, { t: 175, v: 0 }] });
console.log('automation set ->', JSON.stringify(au).slice(0, 160));
console.log('UI vocal inserts:', await ui(() => window.oscine.store.project.arrangement.lanes.find(l => l.id === 'vocal-r2').inserts.map(i => i.type).join(',')), '| live chain has eq3:', await ui(() => !!window.oscine.transport?.clipPlayer || 'not playing (chain builds on play)'));

// 4. cycle over the bridge, then a words query Claude would use to find lyrics
await call('oscine_cycle', { action: 'set', a: 143.2, b: 175, on: true });
console.log('UI cycle:', await ui(() => JSON.stringify(window.oscine.store.project.arrangement.loop)));
const w = await call('oscine_words', { action: 'get', asset: Object.keys((await ui(() => window.oscine.store.project.assets)))[1], from: 143, to: 150, limit: 12 });
console.log('words 143-150 s:', typeof w === 'string' ? w.slice(0, 120) : (w.text || JSON.stringify(w)).slice(0, 120));

// 5. clip split through the tool, then UI redraws (placements count)
const before = await ui(() => window.oscine.store.project.arrangement.placements.length);
const sp = await call('oscine_clip', { action: 'split', index: 0, t: 100 });
console.log('split ->', JSON.stringify(sp).slice(0, 110), '| placements', before, '->', await ui(() => window.oscine.store.project.arrangement.placements.length));

// 6. play a second inside the cycle with the envelope on, no errors
await ui(() => { window.oscine.transport.songPos = 150; window.oscine.transport.play(); });
await page.waitForTimeout(1500);
console.log('playing at', await ui(() => window.oscine.transport.getPosition().sec.toFixed(2)), '| eq3 in live vocal chain:', await ui(() => { const s = window.oscine.transport.clipPlayer?.strips?.['vocal-r2']; return s ? s.chain.effects.map(e => e.def.type).join(',') : 'n/a'; }));
await ui(() => window.oscine.transport.stop());

// 7. undo everything through the tool
const depth1 = await ui(() => window.oscine.store.history?.past?.length ?? window.oscine.store.undoStack?.length);
let n = 0; while (n < 30) { const d = await ui(() => window.oscine.store.history?.past?.length ?? window.oscine.store.undoStack?.length); if (d <= depth0) break; await call('oscine_project', { action: 'undo' }); n++; }
console.log(`undo depth ${depth0} -> ${depth1} -> back to ${await ui(() => window.oscine.store.history?.past?.length ?? window.oscine.store.undoStack?.length)} in ${n} undos`);
const after = await ui(() => { const a = window.oscine.store.project.arrangement; return { markers: (a.markers || []).length, loop: a.loop, carl: a.lanes.find(l => l.name === 'Carl Sagan').gainDb, vins: (a.lanes.find(l => l.id === 'vocal-r2').inserts || []).length, auto: (a.automation || []).length, placements: a.placements.length }; });
console.log('after undo:', JSON.stringify(after));
console.log('page errors:', errs.length, errs.slice(0, 3));
await browser.close(); sc.kill();
