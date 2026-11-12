// The signal: pure frame/clock math, the driver on a fake audio graph, the engine's schedule report, the command,
// and the sidecar's /signal fan-out against a real spawned sidecar. No browser. Run: node test/signal.mjs
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { dbToUnit, audioToEpoch, clockStamp, buildSignalFrame, stampNotes, SignalTap, HZ_MAX, HZ_MIN } from '../src/engine/signal.js';
import { OnsetTracker, playhead } from '../src/engine/earlive.js';
import { CommandAPI } from '../src/api/api.js';
import { COMMANDS } from '../src/api/commands.js';
import { EventBus } from '../src/core/bus.js';
import { SKIP_BUS } from '../src/core/jam.js';

let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? '  ok  ' : 'FAIL  ') + n + (d ? `  (${d})` : '')); if (!ok) fails++; };
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SR = 48000, N = 1024, df = SR / (2 * N);
const quiet = () => new Float32Array(N).fill(-110);
const tone = (hz, db = -20) => { const f = quiet(); f[Math.round(hz / df)] = db; return f; };
const sine = (amp) => Float32Array.from({ length: 2048 }, (_, i) => amp * Math.sin(i / 5));

console.log('[1] levels are 0..1 over a fixed dB span');
check('-60 dB -> 0, -6 dB -> 1, clamped outside', dbToUnit(-60) === 0 && dbToUnit(-6) === 1 && dbToUnit(-200) === 0 && dbToUnit(12) === 1);
check('midpoint is linear in dB', Math.abs(dbToUnit(-33) - 0.5) < 0.001);

console.log('[2] clocks: audio time -> epoch ms at the speaker');
{
  const stamp = { contextTime: 10, performanceTime: 5000, timeOrigin: 1_700_000_000_000, latency: 0.02 };
  check('context time maps through the stamp', audioToEpoch(10, stamp) === 1_700_000_005_020);
  check('100 ms ahead on the audio clock is 100 ms ahead on the wall clock', audioToEpoch(10.1, stamp) - audioToEpoch(10, stamp) === 100);
  const perf = { now: () => 777, timeOrigin: 1000 };
  const a = clockStamp({ currentTime: 3, getOutputTimestamp: () => ({ contextTime: 2.9, performanceTime: 700 }), outputLatency: 0.01 }, perf);
  check('clockStamp reads getOutputTimestamp + outputLatency', a.contextTime === 2.9 && a.performanceTime === 700 && a.latency === 0.01 && a.timeOrigin === 1000);
  const b = clockStamp({ currentTime: 3, getOutputTimestamp: () => ({ contextTime: 0, performanceTime: 0 }), baseLatency: 0.005 }, perf);
  check('a zeroed timestamp falls back to currentTime = now, baseLatency', b.contextTime === 3 && b.performanceTime === 777 && b.latency === 0.005);
  const c = clockStamp({ currentTime: 1 }, perf);
  check('no getOutputTimestamp at all still gives a stamp', c.contextTime === 1 && c.latency === 0);
}

console.log('[3] frames');
{
  const head = playhead({ pos: { localBeat: 5.25, loopBeats: 32, sec: 0 }, project: {}, activeSlot: 1, queuedSlot: null });
  const f = buildSignalFrame({ seq: 1, at: 1000, sampleRate: SR, master: { freqDb: tone(120, -20), td: sine(0.5) }, head, pos: { localBeat: 5.25 }, bpm: 128, playing: true, tracker: new OnsetTracker() });
  check('phases: beat 5.25 -> beatPhase .25, barPhase (1.25/4)', f.beatPhase === 0.25 && Math.abs(f.barPhase - 0.3125) < 0.002, `${f.beatPhase} ${f.barPhase}`);
  check('bar 2 beat 2 of slot B', f.bar === 2 && f.beat === 2 && f.slot === 'B' && f.bpm === 128);
  check('five band levels, bass is the loud one', f.bands.length === 5 && f.bands[1] > 0.6 && f.bands[3] < 0.1, JSON.stringify(f.bands));
  check('rms/peak in 0..1 and non-zero for a half-scale sine', f.rms > 0.5 && f.rms <= 1 && f.peak > f.rms - 0.2 && f.peak <= 1, `${f.rms} ${f.peak}`);
  check('a frame is small (< 400 bytes)', JSON.stringify(f).length < 400, String(JSON.stringify(f).length));
  const s = buildSignalFrame({ seq: 2, at: 1000, sampleRate: SR, master: null, head, pos: { localBeat: 0 }, bpm: 128, playing: false, tracker: new OnsetTracker() });
  check('stopped: zeros, no phases, still five bands', !s.playing && s.rms === 0 && s.beatPhase === 0 && s.bands.join() === '0,0,0,0,0');
  // a kick: low band jumps after a few quiet frames
  const tr = new OnsetTracker();
  for (let i = 0; i < 6; i++) buildSignalFrame({ seq: i, at: i * 16, sampleRate: SR, master: { freqDb: quiet(), td: sine(0.001) }, head, pos: { localBeat: 0 }, playing: true, tracker: tr });
  const kick = buildSignalFrame({ seq: 9, at: 400, sampleRate: SR, master: { freqDb: tone(60, -12), td: sine(0.5) }, head, pos: { localBeat: 0 }, playing: true, tracker: tr }).kick;
  check('a low-band jump reads as a kick', kick === true);
  const m = buildSignalFrame({ seq: 3, at: 0, sampleRate: SR, master: null, head: { ...head, marker: 'Chorus' }, pos: {}, playing: false, tracker: tr });
  check('an arrangement marker rides along', m.marker === 'Chorus');
}

console.log('[4] notes are stamped for the outside');
{
  const stamp = { contextTime: 10, performanceTime: 5000, timeOrigin: 0, latency: 0 };
  const out = stampNotes([
    { track: 't1', name: 'Kit', kind: 'drum', lane: 'kick', vel: 1, time: 10.1 },
    { track: 't2', name: 'Lead', kind: 'note', pitch: 64, vel: 0.8, time: 10.25, dur: 0.5 },
  ], stamp);
  check('drum hit: track name, lane, at', out[0].track === 'Kit' && out[0].lane === 'kick' && out[0].at === 5100 && !('pitch' in out[0]));
  check('note: pitch, durMs, at', out[1].pitch === 64 && out[1].durMs === 500 && out[1].at === 5250 && out[1].vel === 0.8);
}

console.log('[5] the driver on a fake audio graph: free when off, clean when stopped');
{
  let live = 0, created = 0;
  const ctx = { sampleRate: SR, currentTime: 1, outputLatency: 0.012, createAnalyser() { created++; return { set fftSize(v) { this._n = v; this.frequencyBinCount = v / 2; }, get fftSize() { return this._n; }, getFloatFrequencyData(a) { a.set(tone(120, -20).subarray(0, a.length)); }, getFloatTimeDomainData(a) { for (let i = 0; i < a.length; i++) a[i] = 0.3 * Math.sin(i / 5); } }; } };
  const node = () => ({ connect() { live++; }, disconnect() { live--; } });
  const engine = { ctx, masterGain: node(), getLevel: (id) => (id === 't1' ? 0.4 : 0) };
  const store = { project: { name: 'Demo', bpm: 120, tracks: [{ id: 't1', name: 'Bass' }, { id: 't2', name: 'Kit' }] }, ui: { activeSlot: 0, queuedSlot: null } };
  let playing = true;
  const transport = { getPosition: () => ({ playing, localBeat: 2.5, loopBeats: 16, sec: 0 }), clipPlayer: null };
  const bus = new EventBus(); const got = [];
  bus.on('signal:frame', f => got.push(['f', f])); bus.on('signal:notes', n => got.push(['n', n]));
  const tap = new SignalTap({ engine, transport, store, bus });
  check('off: nothing created or connected, engine not reporting', created === 0 && live === 0 && !engine.reportNotes);
  check('hz clamps to 20..120', tap.start({ hz: 999 }).hz === HZ_MAX && tap.start({ hz: 1 }).hz === HZ_MIN);
  check('on: one analyser, engine asked to report', created === 1 && live === 1 && engine.reportNotes === true);
  tap.tick();
  const f = got.at(-1)[1];
  check('a tick emits a playing frame with track levels', f.playing && f.tracks.Bass === 0.4 && f.beatPhase === 0.5);
  check('status reports the latency folded into times', tap.status().latencyMs === 12);
  bus.emit('notes:scheduled', { events: [{ track: 't2', name: 'Kit', kind: 'drum', lane: 'snare', vel: 0.9, time: 1.1 }] });
  const n = got.at(-1);
  check('the engine\'s schedule leaves as signal:notes', n[0] === 'n' && n[1].notes[0].lane === 'snare' && Number.isFinite(n[1].notes[0].at));
  check('a note 100 ms ahead on the audio clock is ~100 ms after the frame time', Math.abs((n[1].notes[0].at - f.at) - 100) <= 3, String(n[1].notes[0].at - f.at));
  const cp = { masterChain: { output: node() } }; transport.clipPlayer = cp; tap.tick();
  check('an arrangement clip player is summed into the same analyser', live === 2);
  transport.clipPlayer = null; tap.tick();
  check('...and dropped when it goes', live === 1);
  playing = false; const before = got.length; tap.lastIdle = Date.now(); tap.tick(); tap.tick();
  check('stopped: frames throttle to a heartbeat', got.length === before);
  tap.stop();
  check('stop: disconnected, engine no longer reporting, no listener left', live === 0 && engine.reportNotes === false);
  const c2 = got.length; bus.emit('notes:scheduled', { events: [{ track: 't2', name: 'Kit', kind: 'drum', lane: 'kick', vel: 1, time: 2 }] });
  check('notes after stop go nowhere', got.length === c2);
}

console.log('[6] the real engine reports exactly what it schedules, and only when asked');
{
  // AudioEngine needs Web Audio; scheduleWindow itself only needs these fields, so borrow the method.
  const { AudioEngine } = await import('../src/engine/engine.js').catch(() => ({}));
  if (!AudioEngine) check('engine module imports headless', false);
  else {
    const played = [];
    const drumDef = { kind: 'drums', lanes: [{ id: 'kick' }, { id: 'snare' }] };
    const bus = new EventBus(); const reports = [];
    bus.on('notes:scheduled', e => reports.push(e.events));
    const tracks = [{ id: 'd', name: 'Kit', instrument: { type: 'drums' } }, { id: 's', name: 'Lead', instrument: { type: 'poly' } }];
    const patterns = { d: { steps: { kick: [1, 0, 0, 0, 0.8, 0, 0, 0], snare: [0, 0, 0, 0, 1, 0, 0, 0] } }, s: { notes: [{ start: 0.5, pitch: 60, vel: 0.7, dur: 0.5 }, { start: 3, pitch: 64, vel: 0.7, dur: 1 }] } };
    const fake = {
      store: { project: { bpm: 120, tracks, slots: [{ bars: 1 }] }, getPattern: (id) => patterns[id] },
      channels: new Map([['d', { instrument: { trigger: (lane, time, vel) => played.push(['drum', lane, time, vel]) } }], ['s', { instrument: { noteOn: (time, pitch, vel, dur) => played.push(['note', pitch, time, vel, dur]) } }]]),
      bus, emitTrigger() {}, ctx: { currentTime: 0 }, reportNotes: false,
    };
    const w = { fromLocal: 0, toLocal: 2, loopStartAbs: 0, slotIndex: 0, beatToTime: (b) => 10 + b * 0.5, swingOffset: () => 0 };
    let ok = true;
    try { AudioEngine.prototype.scheduleWindow.call(fake, w); } catch (e) { ok = false; check('scheduleWindow runs on a fake engine', false, e.message); }
    if (ok) {
      check('not asked: plays, reports nothing', played.length === 4 && reports.length === 0, `played ${played.length}`);
      played.length = 0; fake.reportNotes = true;
      AudioEngine.prototype.scheduleWindow.call(fake, w);
      const ev = reports[0] ?? [];
      check('asked: one report per window, one event per sound', reports.length === 1 && ev.length === played.length && ev.length === 4, `${ev.length} vs ${played.length}`);
      const k2 = ev.find(e => e.lane === 'kick' && e.vel === 0.8), nt = ev.find(e => e.kind === 'note');
      check('drum event carries the track name, lane, velocity and the audio time it was scheduled for', k2 && k2.name === 'Kit' && k2.time === 10.5);
      check('note event carries pitch, audio time and duration in seconds', nt && nt.pitch === 60 && nt.time === 10.25 && nt.dur === 0.25 && nt.name === 'Lead');
      check('notes outside the window are not reported', !ev.some(e => e.pitch === 64));
    }
  }
}

console.log('[7] the command, and the two taps that must ignore the stream');
{
  const c = COMMANDS.find(x => x.name === 'signal');
  check('catalog has signal with an action enum', c && c.input.properties.action.enum.join() === 'start,stop,status' && c.readOnly === true);
  let err = ''; try { await new CommandAPI({ store: {}, engine: {}, transport: {}, bus: {} }).execute('signal', {}); } catch (e) { err = e.message; }
  check('no audio engine -> a clear error', /audio engine/.test(err), err);
  let bad = ''; try { await new CommandAPI({ store: {}, engine: { ctx: {} }, transport: {}, bus: {} }).execute('signal', { action: 'nope' }); } catch (e) { bad = e.message; }
  check('bad action -> clear error', /Bad action/.test(bad), bad);
  check('jam mode does not record the stream', ['signal:frame', 'signal:notes', 'notes:scheduled'].every(n => SKIP_BUS.has(n)));
  const src = readFileSync(join(ROOT, 'src/core/persist.js'), 'utf8');
  check('autosave treats the stream as ephemeral', /EPHEMERAL_PREFIXES = \[[^\]]*'signal:'[^\]]*'notes:scheduled'/.test(src));
}

console.log('[8] the sidecar fans the active instance\'s signal out to /signal');
{
  const port = 7600 + Math.floor(Math.random() * 300);
  const proc = spawn(process.execPath, [join(ROOT, 'plugin/server/oscine-mcp.mjs')], { env: { ...process.env, OSCINE_DAEMON: '1', OSCINE_PORT: String(port), OSCINE_OSC_PORT: String(port + 400), OSCINE_PROJECT_ROOT: ROOT }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; proc.stderr.on('data', d => { logs += d; });
  const until = async (fn, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 40)); } return null; };
  const actual = await until(() => { const m = /serving app \+ bridge on http:\/\/127\.0\.0\.1:(\d+)/.exec(logs); return m && Number(m[1]); });
  check('sidecar is up', !!actual, actual ? '' : logs.slice(-200));
  // minimal masked-text-frame websocket client
  const ws = (path, origin) => new Promise((res) => {
    const s = connect(actual, '127.0.0.1'); const msgs = []; let buf = Buffer.alloc(0), up = false;
    const api = { msgs, closed: false, send(str) { const p = Buffer.from(str), mask = randomBytes(4); const h = p.length < 126 ? Buffer.from([0x81, 0x80 | p.length]) : Buffer.from([0x81, 0x80 | 126, p.length >> 8, p.length & 255]); const m = Buffer.from(p.map((b, i) => b ^ mask[i % 4])); s.write(Buffer.concat([h, mask, m])); }, end() { s.destroy(); } };
    s.on('connect', () => s.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\n${origin ? `Origin: ${origin}\r\n` : ''}Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`));
    s.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (!up) { const i = buf.indexOf('\r\n\r\n'); if (i < 0) return; up = true; buf = buf.subarray(i + 4); res(api); }
      while (buf.length >= 2) {
        let len = buf[1] & 0x7f, off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        if (buf.length < off + len) return;
        if ((buf[0] & 0x0f) === 1) { try { msgs.push(JSON.parse(buf.subarray(off, off + len).toString())); } catch { /* skip */ } }
        buf = buf.subarray(off + len);
      }
    });
    s.on('close', () => { api.closed = true; if (!up) res(api); }); s.on('error', () => { api.closed = true; if (!up) res(api); });
  });
  if (actual) {
    const app = await ws('/bridge');
    app.send(JSON.stringify({ type: 'hello', app: 'oscine', apiVersion: 1, project: 'Night Drive', clientId: 'c1' }));
    await until(() => app.msgs.some(m => m.type === 'session'));
    check('no consumer yet: the app was not asked to stream', !app.msgs.some(m => m.type === 'signal'));
    const viz = await ws('/signal?hz=90', 'http://localhost:8080');
    const hello = await until(() => viz.msgs.find(m => m.type === 'hello'));
    check('consumer gets a hello naming the project', hello && hello.signal === 1 && hello.app === true && hello.project === 'Night Drive' && hello.hz === 90, JSON.stringify(hello));
    const on = await until(() => app.msgs.find(m => m.type === 'signal'));
    check('first consumer turns the stream on at the asked rate', on && on.on === true && on.hz === 90, JSON.stringify(on));
    app.send(JSON.stringify({ type: 'event', name: 'signal:frame', data: { v: 1, seq: 7, playing: true, bands: [0, 1, 0, 0, 0] } }));
    app.send(JSON.stringify({ type: 'event', name: 'signal:notes', data: { v: 1, notes: [{ track: 'Kit', kind: 'drum', lane: 'kick', vel: 1, at: 123 }] } }));
    const fr = await until(() => viz.msgs.find(m => m.type === 'frame'));
    const nt = await until(() => viz.msgs.find(m => m.type === 'notes'));
    check('frames arrive flat as {type:"frame", ...}', fr && fr.seq === 7 && fr.bands[1] === 1);
    check('notes arrive as {type:"notes", notes}', nt && nt.notes[0].lane === 'kick' && nt.notes[0].at === 123);
    // a background (non-active) instance must not leak into the stream
    const app2 = await ws('/bridge');
    app2.send(JSON.stringify({ type: 'hello', app: 'oscine', apiVersion: 1, project: 'Other', clientId: 'c2' }));
    await until(() => viz.msgs.filter(m => m.type === 'hello').at(-1)?.project === 'Other');
    check('a newly opened instance becomes active and the consumer is told', viz.msgs.filter(m => m.type === 'hello').at(-1).project === 'Other');
    const before = viz.msgs.filter(m => m.type === 'frame').length;
    app.send(JSON.stringify({ type: 'event', name: 'signal:frame', data: { v: 1, seq: 8 } }));
    app2.send(JSON.stringify({ type: 'event', name: 'signal:frame', data: { v: 1, seq: 99 } }));
    await until(() => viz.msgs.some(m => m.seq === 99));
    const after = viz.msgs.filter(m => m.type === 'frame');
    check('only the active instance feeds the stream', after.length === before + 1 && after.at(-1).seq === 99);
    check('the background instance was told to stop', app.msgs.filter(m => m.type === 'signal').at(-1).on === false);
    viz.send(JSON.stringify({ type: 'cmd', id: 1, name: 'transport', args: { action: 'play' } }));
    await new Promise(r => setTimeout(r, 150));
    check('a consumer cannot send commands through /signal', !app2.msgs.some(m => m.type === 'cmd') && !app.msgs.some(m => m.type === 'cmd'));
    viz.end();
    const off = await until(() => app2.msgs.filter(m => m.type === 'signal').at(-1)?.on === false);
    check('last consumer leaving turns the stream off', !!off);
    const evil = await ws('/signal', 'https://evil.example');
    await new Promise(r => setTimeout(r, 150));
    check('a foreign origin is refused', evil.closed === true && evil.msgs.length === 0);
    app.end(); app2.end();
  }
  proc.kill('SIGTERM');
}

console.log(fails ? `\nsignal: ${fails} FAILED` : '\nsignal: all passed');
process.exit(fails ? 1 : 0);
