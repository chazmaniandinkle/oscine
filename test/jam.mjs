// Jam mode: recorder, tap, session, storage + cursor, audio-window math. No browser: fake clock, fake bus/store,
// fake MediaRecorder, temp dir. Run: node test/jam.mjs
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventBus } from '../src/core/bus.js';
import { JamRecorder, installJamTap, audioWindow, kindOfBus, kindOfMidi, sanitize, newJamId } from '../src/core/jam.js';
import { JamSession } from '../src/ui/jam.js';
import { JamAudio } from '../src/ui/jamaudio.js';
import { writeMeta, appendEvents, appendAudio, readJam, listJams, readEvents, jamDir, JAM_ID_RE } from '../plugin/server/jam-store.mjs';
import { COMMANDS } from '../src/api/commands.js';
import { CommandAPI } from '../src/api/api.js';

let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? '  ok  ' : 'FAIL  ') + n + (d ? `  (${d})` : '')); if (!ok) fails++; };

// -- fakes ---------------------------------------------------------------------------------------------------------------
let wall = 1_000_000, ct = 10;
const clock = () => ({ t: wall, ct });
const tick = (ms) => { wall += ms; ct += ms / 1000; };
let playing = false, beat = 0;
const fakeStore = () => {
  const s = { logged: [], project: { name: 'Storm', bpm: 174 }, ui: { activeSlot: 0 }, logInput(ev) { this.logged.push(ev); } };
  return s;
};

console.log('[1] recorder: off is a no-op; seq, stamps, drain, cursor');
{
  const r = new JamRecorder({ clock, beat: () => (playing ? beat : null) });
  check('record() while off returns null and keeps nothing', r.record('note', { pitch: 60 }) === null && r.events.length === 0);
  const meta = r.start({ project: 'Storm' }, { id: 'jam-test-0001' });
  check('start returns meta with id + started stamps', meta.id === 'jam-test-0001' && meta.started_t === wall && meta.started_ct === ct);
  let threw = false; try { r.start(); } catch { threw = true; }
  check('second start while recording throws', threw);
  tick(100); r.record('note', { pitch: 60, on: true });
  playing = true; beat = 2.5; tick(250); r.record('hit', { lane: 'kick' });
  check('seq is monotonic from 0', r.events[0].seq === 0 && r.events[1].seq === 1);
  check('free play: beat is null', r.events[0].beat === null);
  check('playing: beat is read from the transport', r.events[1].beat === 2.5);
  check('ct and t stamped from the clock', r.events[1].ct === ct && r.events[1].t === wall);
  const ev = r.record('action', { seq: 99, t: 5, kind: 'evil', name: 'x' });
  check('payload cannot overwrite seq/t/kind', ev.seq === 2 && ev.t === wall && ev.kind === 'action');
  const d1 = r.drain(); const d2 = r.drain();
  check('drain hands out everything once', d1.length === 3 && d2.length === 0);
  r.record('cc', { d1: 7, d2: 99 });
  check('drain after more events returns only the new one', r.drain().length === 1);
  check('read(sinceSeq) filters by seq', r.read(2).length === 2 && r.read(0).length === 4 && r.read(99).length === 0);
  const m2 = r.stop();
  check('stop stamps and counts events', m2.stopped_t === wall && m2.events === 4);
  check('after stop, record is a no-op again', r.record('note', {}) === null);
  playing = false;
}

console.log('[2] kinds and sanitising');
{
  check('bus kinds', kindOfBus('transport:state') === 'transport' && kindOfBus('slot:changed') === 'slot' && kindOfBus('param:changed') === 'action' && kindOfBus('settings:changed', { key: 'bpm' }) === 'transport' && kindOfBus('settings:changed', { key: 'name' }) === 'action');
  check('midi status -> kind', kindOfMidi(0xb0) === 'cc' && kindOfMidi(0xe3) === 'bend' && kindOfMidi(0xd0) === 'pressure' && kindOfMidi(0xc5) === 'program' && kindOfMidi(0x93) === 'note');
  const big = { project: { huge: 1 }, beatToTime: () => 1, a: 'x'.repeat(500), nested: { l1: { l2: { l3: { l4: 1 } } } }, arr: Array.from({ length: 40 }, (_, i) => i), n: NaN };
  const s = sanitize(big);
  check('sanitize drops project/functions, clips strings + arrays, NaN -> null', !('project' in s) && !('beatToTime' in s) && s.a.length <= 201 && s.arr.length === 16 && s.n === null);
  check('sanitize caps depth', JSON.stringify(s.nested).length < 60);
  check('jam ids look right', JAM_ID_RE.test(newJamId(new Date(2026, 9, 11, 15, 30, 5), () => 0.5)) && newJamId(new Date(2026, 9, 11, 15, 30, 5), () => 0.5).startsWith('jam-20261011-153005-'));
}

console.log('[3] tap: store.logInput, bus *, midi:raw; uninstall restores');
{
  const bus = new EventBus(), store = fakeStore();
  const r = new JamRecorder({ clock });
  const origLog = store.logInput;
  const off = installJamTap({ store, bus, recorder: r });
  r.start({}, { id: 'jam-test-0002' });
  tick(10); store.logInput({ kind: 'note', on: true, trackId: 't1', pitch: 64, vel: 0.8, beat: null });
  store.logInput({ kind: 'hit', trackId: 't2', lane: 'snare', vel: 1 });
  bus.emit('param:changed', { trackId: 't1', key: 'duty', value: 0.5 });
  bus.emit('channel:changed', { trackId: 't1', key: 'gain' });
  bus.emit('slot:changed', { active: 1, queued: null });
  bus.emit('transport:state', { playing: true });
  bus.emit('settings:changed', { key: 'bpm' });
  bus.emit('schedule:window', { fromLocal: 0, beatToTime() {} });       // skipped: 16 Hz noise
  bus.emit('ear:frame', { big: true });                                // skipped
  bus.emit('jam:state', { active: true });                             // skipped: our own
  bus.emit('midi:raw', { data: [0xb0, 74, 99], device: 'MPK mini 3' });
  bus.emit('midi:raw', { data: [0xe0, 0, 96] });
  bus.emit('midi:raw', { data: [0x90, 60, 100] });                     // a note: logInput already has it
  const kinds = r.events.map(e => e.kind);
  check('logInput still logs to the ledger (original runs)', store.logged.length === 2);
  check('note + hit recorded with their payload', r.events[0].kind === 'note' && r.events[0].pitch === 64 && r.events[0].trackId === 't1' && r.events[1].kind === 'hit' && r.events[1].lane === 'snare');
  check('param/channel are actions with name + fields', r.events.some(e => e.kind === 'action' && e.name === 'param:changed' && e.key === 'duty' && e.value === 0.5) && r.events.some(e => e.name === 'channel:changed'));
  check('slot, transport, tempo recorded', kinds.includes('slot') && r.events.filter(e => e.kind === 'transport').length === 2);
  check('noisy and self events skipped', !r.events.some(e => ['schedule:window', 'ear:frame', 'jam:state'].includes(e.name)));
  const cc = r.events.find(e => e.kind === 'cc'), bend = r.events.find(e => e.kind === 'bend');
  check('cc carries channel, controller, value, device', cc && cc.ch === 1 && cc.d1 === 74 && cc.d2 === 99 && cc.device === 'MPK mini 3');
  check('pitch bend recorded', bend && bend.d2 === 96);
  check('raw note-on is not double-counted', r.events.filter(e => e.kind === 'note').length === 1);
  r.stop(); off();
  check('uninstall restores store.logInput', store.logInput === origLog);
  bus.emit('param:changed', { trackId: 't1', key: 'duty', value: 1 });
  check('nothing records after uninstall', r.events.length === kinds.length);
}

console.log('[4] audio window math');
{
  const evs = [{ ct: 12.0 }, { ct: 15.25 }, { ct: 13 }];
  const w = audioWindow(evs, 10);
  check('window = event ct span minus audio t0', w && w.from_sec === 2 && w.to_sec === 5.25, JSON.stringify(w));
  check('padding widens both sides, from clamps at 0', JSON.stringify(audioWindow([{ ct: 10.5 }], 10, { padSec: 1 })) === '{"from_sec":0,"to_sec":1.5}');
  check('no ct / no t0 -> null', audioWindow([{ ct: null }], 10) === null && audioWindow(evs, undefined) === null && audioWindow([], 10) === null);
}

console.log('[5] audio recorder with a fake MediaRecorder');
{
  const listeners = [];
  class FakeMR {
    static isTypeSupported(m) { return m === 'audio/webm;codecs=opus'; }
    constructor(stream, opts) { this.stream = stream; this.opts = opts; this.state = 'inactive'; FakeMR.last = this; }
    start(ms) { this.state = 'recording'; this.ms = ms; setTimeout(() => this.onstart && this.onstart(), 0); }
    stop() { this.state = 'inactive'; this.ondataavailable && this.ondataavailable({ data: new Blob([new Uint8Array([9, 9, 9])]) }); setTimeout(() => this.onstop && this.onstop(), 0); }
    emit(bytes) { this.ondataavailable({ data: { size: bytes.length, bytes } }); }
  }
  const connected = [];
  const ctx = { currentTime: 20, createMediaStreamDestination() { return { stream: { id: 's' } }; } };
  const masterGain = { connect: (d) => connected.push(d), disconnect: (d) => connected.splice(connected.indexOf(d), 1) };
  const bus = new EventBus();
  const a = new JamAudio({ engine: { ctx, masterGain }, transport: { bus, clipPlayer: null }, MediaRecorderImpl: FakeMR });
  const info = await a.start();
  check('picks webm/opus, 1 s timeslice, stamps t0 on the audio clock', info.ok && info.mime === 'audio/webm;codecs=opus' && FakeMR.last.ms === 1000 && info.t0_ct === 20);
  check('master is connected to the recorder destination', connected.length === 1);
  FakeMR.last.emit([1, 2]); FakeMR.last.emit([3]);
  check('drain returns queued chunks once', a.drain().length === 2 && a.drain().length === 0);
  ctx.currentTime = 27.5;
  const stopped = await a.stop();
  check('stop flushes the last chunk, reports duration, disconnects', stopped.chunks.length === 1 && stopped.duration_sec === 7.5 && connected.length === 0);
  const none = await new JamAudio({ engine: { ctx: null }, MediaRecorderImpl: FakeMR }).start();
  check('no engine -> ok:false with a reason (events still record)', none.ok === false && /engine/.test(none.reason));
  const nomr = await new JamAudio({ engine: { ctx, masterGain }, MediaRecorderImpl: null }).start();
  check('no MediaRecorder -> ok:false with a reason', nomr.ok === false && /MediaRecorder/.test(nomr.reason));
}

console.log('[6] session -> sidecar storage -> read-since-last-look');
{
  const root = await mkdtemp(join(tmpdir(), 'oscine-jam-'));
  try {
    wall = 2_000_000; ct = 50; playing = false;
    const bus = new EventBus(), store = fakeStore();
    const posts = [];
    const post = async (route, body, kind) => {
      posts.push(route);
      const m = /^jam\/([^/]+)\/(meta|events|audio)/.exec(route); const id = m[1];
      if (m[2] === 'meta') await writeMeta(root, id, body);
      else if (m[2] === 'events') await appendEvents(root, id, body);
      else await appendAudio(root, id, Number(new URL('http://x/' + route).searchParams.get('seg') || 0), body);
    };
    let timerFn = null;
    const audio = { start: async () => ({ ok: true, mime: 'audio/webm;codecs=opus', t0_ct: 50.4, t0_wall: wall }), drain: () => [new Uint8Array([1, 2, 3])], stop: async () => ({ chunks: [new Uint8Array([4])], duration_sec: 12.5 }) };
    const mem = {}; const persist = { get: () => mem.v ?? null, set: (v) => { mem.v = v; }, clear: () => { delete mem.v; } };
    const s = new JamSession({ store, bus, engine: { ctx: { get currentTime() { return ct; } } }, transport: { getPosition: () => ({ playing, localBeat: beat }) }, audio, post, persist, now: () => wall, setTimer: (f) => { timerFn = f; return 1; }, clearTimer: () => {} });
    const st = await s.start({ note: 'test' });
    const id = st.id;
    check('start returns an id, is active, persists the open jam', s.active && JAM_ID_RE.test(id) && mem.v.id === id);
    check('first event is the starting state', s.rec.events[0].name === 'jam:start' && s.rec.events[0].bpm === 174);
    tick(500); store.logInput({ kind: 'note', on: true, trackId: 'a', pitch: 60, vel: 0.7 });
    tick(500); bus.emit('param:changed', { trackId: 'a', key: 'duty', value: 0.25 });
    await timerFn();
    let evs = await readEvents(root, id);
    check('flush streams events + audio to the store', evs.length === 3 && posts.some(p => p.startsWith(`jam/${id}/audio?seg=0`)));
    // Cog looks: gets everything, cursor advances
    const r1 = await readJam(root, { readerId: 'cog' });
    check('first read returns all events from the start', r1.ok && r1.count === 3 && r1.cursor.from === 0 && r1.cursor.next === 3 && r1.open === true);
    check('read names the audio file and the window into it', r1.audio.windows.length === 1 && r1.audio.windows[0].file === 'audio.webm' && r1.audio.windows[0].aligned === true);
    const ws = r1.audio.windows[0];
    check('window math: events at ct 50..51 vs audio t0 50.4 -> from 0 (clamped), to 0.6', ws.from_sec === 0 && ws.to_sec === 0.6, JSON.stringify(ws));
    const r2 = await readJam(root, { readerId: 'cog' });
    check('second read: nothing new', r2.count === 0 && r2.cursor.from === 3);
    tick(1000); playing = true; beat = 1; bus.emit('slot:changed', { active: 2, queued: null });
    tick(500); bus.emit('midi:raw', { data: [0xb0, 1, 64] });
    // (the jam tap is installed by start() on the real store/bus)
    await timerFn();
    const r3 = await readJam(root, { readerId: 'cog' });
    check('third read: only what happened since the last look', r3.count === 2 && r3.events[0].seq === 3 && r3.kinds.slot === 1 && r3.kinds.cc === 1, JSON.stringify(r3.kinds));
    check('events carry the beat while playing', r3.events[0].beat === 1);
    const other = await readJam(root, { readerId: 'someone-else' });
    check('a different reader has its own cursor', other.count === 5 && other.cursor.from === 0);
    const peek = await readJam(root, { readerId: 'p', peek: true }); const peek2 = await readJam(root, { readerId: 'p', peek: true });
    check('peek does not advance', peek.count === peek2.count && peek.count === 5);
    const all = await readJam(root, { readerId: 'cog', all: true });
    check('all:true reads from the start and leaves the cursor alone', all.count === 5 && (await readJam(root, { readerId: 'cog' })).count === 0);
    const lim = await readJam(root, { readerId: 'lim', limit: 2 }); const lim2 = await readJam(root, { readerId: 'lim', limit: 2 });
    check('limit pages through without gaps or repeats', lim.events.map(e => e.seq).join() === '0,1' && lim2.events.map(e => e.seq).join() === '2,3');
    const fin = await s.stop();
    check('stop finalises: inactive, persist cleared, final meta has duration', !s.active && !mem.v && fin.meta.events > 5);
    const meta = JSON.parse(await readFile(join(jamDir(root, id), 'meta.json'), 'utf8'));
    check('meta.json: stopped_t, per-segment audio t0 + duration', meta.stopped_t != null && meta.segments[0].audio.audio_t0_ct === 50.4 && meta.segments[0].audio.duration_sec === 12.5, JSON.stringify(meta.segments));
    const bytes = await readFile(join(jamDir(root, id), 'audio.webm'));
    check('audio.webm holds every chunk, in order', [...bytes].join() === '1,2,3,1,2,3,4' || [...bytes].join() === '1,2,3,1,2,3,1,2,3,4', [...bytes].join());
    const l = await listJams(root);
    check('list shows the jam, closed, with counts', l.length === 1 && l[0].id === id && l[0].open === false && l[0].audio_bytes === bytes.length);
    check('stop took the taps off: no more events', (() => { const n = s.rec.events.length; bus.emit('param:changed', { trackId: 'a', key: 'x', value: 1 }); return s.rec.events.length === n; })());

    // reload mid-jam -> same id, new segment, audio.1.webm with its own t0
    wall += 60_000; ct += 60;
    mem.v = { id, seg: 0, seq: s.rec.seq };   // (flush keeps this current in real use)
    const audio2 = { start: async () => ({ ok: true, mime: 'audio/webm;codecs=opus', t0_ct: ct + 0.1, t0_wall: wall }), drain: () => [new Uint8Array([7])], stop: async () => ({ chunks: [], duration_sec: 1 }) };
    const s2 = new JamSession({ store, bus, engine: { ctx: { get currentTime() { return ct; } } }, transport: { getPosition: () => ({ playing: false }) }, audio: audio2, post, persist, now: () => wall, setTimer: () => 2, clearTimer: () => {} });
    const res = await s2.resume();
    check('resume after reload: same jam id, segment 1, seq continues', res.id === id && res.seg === 1 && s2.rec.seq >= s.rec.seq);
    check('resume with nothing open does nothing', await new JamSession({ store, bus, engine: {}, transport: {}, audio: null, post, persist: { get: () => null, set() {}, clear() {} }, now: () => wall }).resume() === null);
    await s2.flush(); await s2.stop();
    const meta2 = JSON.parse(await readFile(join(jamDir(root, id), 'meta.json'), 'utf8'));
    check('meta has two segments, each with its own audio t0', Object.keys(meta2.segments).length === 2 && meta2.segments[1].audio.file === 'audio.1.webm', Object.keys(meta2.segments).join());
    const after = await readJam(root, { readerId: 'cog' });
    const seg1 = after.events.filter(e => e.seg === 1), w1 = after.audio.windows.find(w => w.seg === 1);
    check('the new segment reads back with its own audio file and an aligned window', seg1.length > 0 && seg1[0].seq >= s.rec.seq && w1 && w1.file === 'audio.1.webm' && w1.aligned === true, JSON.stringify(after.audio.windows));
    check('the old segment keeps its own window too (its jam:stop event came after the last look)', after.audio.windows.some(w => w.seg === 0 && w.file === 'audio.webm'));
    check('seq never repeats across the two segments', new Set((await readEvents(root, id)).map(e => e.seq)).size === (await readEvents(root, id)).length);
    let bad = false; try { jamDir(root, '../../etc'); } catch { bad = true; }
    check('jam ids cannot escape the jam dir', bad);
    check('read with no jams explains itself', (await readJam(await mkdtemp(join(tmpdir(), 'oscine-jam-empty-')), {})).ok === false);
  } finally { await rm(root, { recursive: true, force: true }); }
}

console.log('[6b] the default timer works in a browser-like realm, and a failed start rolls back');
{
  // The defaults must be wrapped: a bare setInterval stored on the instance and called as this.setTimer() throws
  // "Illegal invocation" in a browser (found against the live app). Simulate that brand check.
  const realSet = globalThis.setInterval, realClear = globalThis.clearInterval;
  globalThis.setInterval = function (f, ms) { if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation'); return realSet(f, ms); };
  const root = await mkdtemp(join(tmpdir(), 'oscine-jam2-'));
  try {
    const bus = new EventBus(), store = fakeStore(), mem = {};
    const persist = { get: () => mem.v ?? null, set: (v) => { mem.v = v; }, clear: () => { delete mem.v; } };
    const s = new JamSession({ store, bus, engine: { ctx: { currentTime: 1 } }, transport: {}, audio: null, post: async () => {}, persist, now: () => 5 });
    let started = null, err = null;
    try { started = await s.start({}); } catch (e) { err = e; }
    check('default timer start does not throw in a browser-like realm', !err && s.active && s.timer != null, err && err.message);
    const stopped = await s.stop();
    check('and stops cleanly (default clearTimer)', !s.active && stopped.id === started.id);
    // failed start: the audio recorder throws after the taps are in -> everything is rolled back
    const orig = store.logInput;
    const s2 = new JamSession({ store, bus, engine: { ctx: { currentTime: 1 } }, transport: {}, audio: { start: async () => ({ ok: true, t0_ct: 1 }), drain: () => [], stop: async () => ({ chunks: [] }) }, post: async () => { throw new Error('boom'); }, persist, now: () => 5, setTimer: () => { throw new Error('timer broke'); } });
    let e2 = null; try { await s2.start({}); } catch (e) { e2 = e; }
    check('a failed start throws', e2 && /timer broke/.test(e2.message));
    check('and leaves nothing half-open: recorder off, taps removed, nothing persisted', !s2.active && store.logInput === orig && !mem.v);
    const s3 = new JamSession({ store, bus, engine: { ctx: { currentTime: 1 } }, transport: {}, audio: null, post: async () => { throw new Error('offline'); }, persist, now: () => 5 });
    await s3.start({}); await s3.flush(); await s3.stop();
    check('an unreachable sidecar never breaks recording: uploads fail soft and are counted', s3.errors > 0 && !s3.active);
  } finally { globalThis.setInterval = realSet; globalThis.clearInterval = realClear; await rm(root, { recursive: true, force: true }); }
}

console.log('[7] command surface');
{
  const c = COMMANDS.find(x => x.name === 'jam');
  check('jam is in the catalog with the five actions', c && JSON.stringify(c.input.properties.action.enum) === JSON.stringify(['status', 'start', 'stop', 'list', 'read']));
  check('catalog/handler agree', typeof CommandAPI.prototype.cmd_jam === 'function');
  const api = Object.create(CommandAPI.prototype);
  let msg = ''; try { await api.cmd_jam({ action: 'read' }); } catch (e) { msg = e.message; }
  check("in-app 'read' points at the sidecar instead of faking it", /sidecar/.test(msg));
}

console.log(fails ? `\n${fails} FAILED` : '\nall ok');
process.exit(fails ? 1 : 0);
