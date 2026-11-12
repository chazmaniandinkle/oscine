// The SIGNAL: what the engine is playing, shaped for something that has to MOVE with it (a visual instrument, a light
// rig), not for something that reads it (that is the live ear, src/engine/earlive.js: 15 Hz, rich, for viewers and agents).
//
// Two streams, both opt-in and free when off:
//   'signal:frame'  ~60 Hz, tiny: level, the ear's five bands as LEVELS 0..1 (not shares), onset/kick, and the
//                   playhead as phases (beat 0..1, bar 0..1) so a consumer can lock to tempo without counting.
//   'signal:notes'  the pattern engine's own schedule: every note and drum hit, sent when it is SCHEDULED (the
//                   transport's lookahead, ~100 ms before it sounds) with the wall-clock time it will be heard.
//                   A consumer that waits for `at` lands on the sound; one that wants to anticipate it can.
//
// Clocks. The engine schedules on the audio clock; a consumer in another page (or process) has no access to it, so
// every time leaves here as epoch milliseconds: audio time -> performance time (AudioContext.getOutputTimestamp) ->
// epoch (performance.timeOrigin), plus the output latency, i.e. when the sound reaches the speaker. Same machine,
// same wall clock: no sync protocol needed.
//
// Audio clips (the arrangement) have no notes: frames still carry their sound, bands and marker; only 'signal:notes'
// is pattern-side.
//
// Everything that turns numbers into a frame is a pure function (no DOM, no Web Audio): test/signal.mjs.

import { BANDS, bandLevelsDb, levels, OnsetTracker, playhead } from './earlive.js';

export const SIGNAL_V = 1;
export const HZ_DEFAULT = 60, HZ_MIN = 20, HZ_MAX = 120;
export const LEVEL_DB_LO = -60, LEVEL_DB_HI = -6;   // band / rms dB span mapped to 0..1

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const r3 = v => Math.round(v * 1000) / 1000;

// dBFS -> 0..1 over a fixed span, so "0.5" means the same thing in every project.
export const dbToUnit = (db, lo = LEVEL_DB_LO, hi = LEVEL_DB_HI) => r3(clamp((db - lo) / (hi - lo), 0, 1));

// Audio-clock seconds -> epoch ms at the speaker. stamp: { contextTime, performanceTime, timeOrigin, latency }.
export function audioToEpoch(time, stamp) {
  return Math.round(stamp.timeOrigin + stamp.performanceTime + (time - stamp.contextTime) * 1000 + (stamp.latency || 0) * 1000);
}

// The context's clock relation right now. getOutputTimestamp is missing or zeroed in some contexts (suspended,
// older Safari): fall back to "currentTime is now".
export function clockStamp(ctx, perf = globalThis.performance) {
  const now = perf?.now?.() ?? Date.now();
  const origin = perf?.timeOrigin ?? (Date.now() - now);
  let contextTime = ctx.currentTime ?? 0, performanceTime = now;
  try {
    const t = ctx.getOutputTimestamp?.();
    if (t && t.performanceTime > 0 && Number.isFinite(t.contextTime)) { contextTime = t.contextTime; performanceTime = t.performanceTime; }
  } catch { /* fall back */ }
  const latency = (Number.isFinite(ctx.outputLatency) ? ctx.outputLatency : 0) || (Number.isFinite(ctx.baseLatency) ? ctx.baseLatency : 0);
  return { contextTime, performanceTime, timeOrigin: origin, latency };
}

// One frame from already-measured inputs. master: { freqDb, td } or null when stopped.
export function buildSignalFrame({ seq, at, sampleRate, master, head, pos, bpm, playing, tracker, trackLevels }) {
  const beat = Math.max(0, pos?.localBeat || 0);
  const base = {
    v: SIGNAL_V, seq, at, playing: !!playing, bpm: bpm ?? null,
    slot: head?.slot ?? null, bar: head?.bar ?? 1, beat: head?.beat ?? 1, bars: head?.bars ?? 0,
    beatPhase: playing ? r3(beat % 1) : 0,
    barPhase: playing ? r3((beat % 4) / 4) : 0,
    sec: head?.sec ?? 0,
  };
  if (head?.marker) base.marker = head.marker;
  if (!playing || !master) return { ...base, rms: 0, peak: 0, bands: BANDS.map(() => 0), onset: false, kick: false };
  const lv = levels(master.td);
  const bd = bandLevelsDb(master.freqDb, sampleRate);
  const on = tracker.push(master.freqDb, sampleRate, at / 1000);
  const f = { ...base, rms: dbToUnit(lv.rmsDb), peak: dbToUnit(lv.peakDb, LEVEL_DB_LO, 0), bands: BANDS.map(([name]) => dbToUnit(bd[name])), onset: on.onset, kick: on.kick };
  if (trackLevels) f.tracks = trackLevels;
  return f;
}

// The engine hands over what it scheduled in audio time ('notes:scheduled'); this stamps it for the outside.
// ev: { track, name, kind: 'drum'|'note', lane?, pitch?, vel, time, dur? }
export function stampNotes(events, stamp) {
  return events.map(e => {
    const o = { track: e.name ?? e.track, kind: e.kind, vel: r3(e.vel), at: audioToEpoch(e.time, stamp) };
    if (e.kind === 'drum') o.lane = e.lane; else { o.pitch = e.pitch; o.durMs = Math.round((e.dur || 0) * 1000); }
    return o;
  });
}

// The live driver. `src` is { engine, transport, store, bus } (the objects the command API holds).
export class SignalTap {
  constructor({ engine, transport, store, bus }) {
    Object.assign(this, { engine, transport, store, bus });
    this.running = false; this.hz = HZ_DEFAULT; this.timer = null; this.seq = 0; this.frames = 0; this.notes = 0;
    this.master = null; this.clipTap = null; this.tracker = new OnsetTracker(); this.offNotes = null; this.lastIdle = 0;
  }

  status() {
    return { running: this.running, hz: this.hz, frames: this.frames, notes: this.notes, latencyMs: Math.round(clockStamp(this.engine.ctx).latency * 1000), playing: !!this.transport?.getPosition?.().playing };
  }

  start({ hz } = {}) {
    this.hz = clamp(Math.round(Number(hz) || this.hz || HZ_DEFAULT), HZ_MIN, HZ_MAX);
    if (!this.running) {
      this.running = true; this.tracker.reset();
      const ctx = this.engine.ctx;
      this.master = ctx.createAnalyser();
      this.master.fftSize = 2048; this.master.smoothingTimeConstant = 0;
      this.master.freq = new Float32Array(this.master.frequencyBinCount); this.master.td = new Float32Array(this.master.fftSize);
      this.engine.masterGain.connect(this.master);
      // Ask the engine to report its schedule, and stamp each batch on the way out.
      this.engine.reportNotes = true;
      const onNotes = ({ events }) => this.sendNotes(events);
      this.bus.on?.('notes:scheduled', onNotes);
      this.offNotes = () => this.bus.off?.('notes:scheduled', onNotes);
    }
    clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), Math.round(1000 / this.hz));
    return this.status();
  }

  stop() {
    if (!this.running) return this.status();
    this.running = false;
    clearInterval(this.timer); this.timer = null;
    this.engine.reportNotes = false;
    this.offNotes?.(); this.offNotes = null;
    this.dropClips();
    try { this.engine.masterGain.disconnect(this.master); } catch { /* ok */ }
    this.master = null;
    return this.status();
  }

  // The arrangement's ClipPlayer has its own master, remade per play/loop pass (see earlive.js syncClips): sum it in.
  syncClips() {
    const cp = this.transport?.clipPlayer ?? null;
    if (cp === this.clipTap) return;
    this.dropClips();
    if (!cp || !this.master) return;
    try { cp.masterChain.output.connect(this.master); this.clipTap = cp; } catch { /* player gone */ }
  }

  dropClips() {
    if (!this.clipTap) return;
    try { this.clipTap.masterChain.output.disconnect(this.master); } catch { /* ok */ }
    this.clipTap = null;
  }

  sendNotes(events) {
    if (!this.running || !events?.length) return;
    const notes = stampNotes(events, clockStamp(this.engine.ctx));
    this.notes += notes.length;
    this.bus.emit('signal:notes', { v: SIGNAL_V, notes });
  }

  measure() {
    const { store, engine } = this;
    const pos = this.transport.getPosition();
    const stamp = clockStamp(engine.ctx);
    const at = audioToEpoch(engine.ctx.currentTime ?? stamp.contextTime, stamp);   // when what the analyser holds now is heard
    const head = playhead({ pos, project: store.project, activeSlot: store.ui.activeSlot, queuedSlot: store.ui.queuedSlot });
    const base = { seq: ++this.seq, at, sampleRate: engine.ctx.sampleRate, head, pos, bpm: store.project.bpm, playing: !!pos.playing, tracker: this.tracker };
    if (!pos.playing) { this.tracker.reset(); return buildSignalFrame({ ...base, master: null }); }
    this.syncClips();
    this.master.getFloatFrequencyData(this.master.freq);
    this.master.getFloatTimeDomainData(this.master.td);
    let trackLevels = null;
    if (engine.getLevel) { trackLevels = {}; for (const t of store.project.tracks ?? []) trackLevels[t.name] = r3(clamp(engine.getLevel(t.id), 0, 1)); }
    return buildSignalFrame({ ...base, master: { freqDb: this.master.freq, td: this.master.td }, trackLevels });
  }

  tick() {
    if (!this.running) return;
    let f;
    try { f = this.measure(); } catch { return; }
    // Stopped: one frame a second is enough to say "still here, still stopped".
    if (!f.playing) { const now = Date.now(); if (now - this.lastIdle < 1000) return; this.lastIdle = now; } else this.lastIdle = 0;
    this.frames++;
    this.bus.emit('signal:frame', f);
  }
}
