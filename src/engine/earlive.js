// The LIVE ear: what the engine is playing right now, as small JSON frames (~15 Hz) that a viewer can draw.
// `listen` (src/engine/listen.js) is the OFFLINE ear: it renders and reads off meters. This one samples the live
// graph and uses the SAME five bands so numbers compare with what `listen` reports:
//   sub <60 Hz, bass 60-250, lowmid 250-800, mid 800-4k, high 4k+   (energy SHARES of the spectrum, sum = 1)
//
// Opt-in and free when off: LiveEar creates its analysers on start() and disconnects them on stop(); nothing runs
// otherwise. Frames leave through the bus ('ear:frame'), the bridge forwards them to whoever is listening (the Stage's
// hub), and the `ear` command (src/api/commands.js) starts/stops/reads it.
//
// Everything that turns numbers into a frame is a pure function here (no DOM, no Web Audio), so node tests drive it
// with synthetic spectra: test/earlive.mjs.

export const BANDS = [['sub', 0, 60], ['bass', 60, 250], ['lowmid', 250, 800], ['mid', 800, 4000], ['high', 4000, 1e9]];
export const SPEC_BINS = 64;
export const SPEC_FMIN = 30;
export const SPEC_FMAX = 16000;
export const SPEC_DB_LO = -100;   // spectrum values are 0..99 over this dB span
export const SPEC_DB_HI = -25;
export const HZ_DEFAULT = 15, HZ_MIN = 5, HZ_MAX = 30;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const r1 = v => Math.round(v * 10) / 10;
const r3 = v => Math.round(v * 1000) / 1000;
const finiteDb = v => (Number.isFinite(v) ? v : -120);
export const toDb = v => 20 * Math.log10(Math.max(v, 1e-9));

// Analyser frequency data (dB per bin, as getFloatFrequencyData) -> energy share per band. Bin 0 (DC) is skipped,
// as listen does (k starts at 1).
export function bandShares(freqDb, sampleRate) {
  const n = freqDb.length, df = sampleRate / (2 * n);
  const e = BANDS.map(() => 0);
  let tot = 0;
  for (let k = 1; k < n; k++) {
    const p = Math.pow(10, finiteDb(freqDb[k]) / 10), f = k * df;
    tot += p;
    for (let j = 0; j < BANDS.length; j++) if (f >= BANDS[j][1] && f < BANDS[j][2]) { e[j] += p; break; }
  }
  const out = {};
  BANDS.forEach(([name], j) => { out[name] = tot > 0 ? r3(e[j] / tot) : 0; });
  return out;
}

// Total level of a band in dB (power sum): for the rules ("bass 6 dB over ..."), not for the bars.
export function bandLevelsDb(freqDb, sampleRate) {
  const n = freqDb.length, df = sampleRate / (2 * n);
  const e = BANDS.map(() => 0);
  for (let k = 1; k < n; k++) {
    const p = Math.pow(10, finiteDb(freqDb[k]) / 10), f = k * df;
    for (let j = 0; j < BANDS.length; j++) if (f >= BANDS[j][1] && f < BANDS[j][2]) { e[j] += p; break; }
  }
  const out = {};
  BANDS.forEach(([name], j) => { out[name] = r1(10 * Math.log10(Math.max(e[j], 1e-12))); });
  return out;
}

// 64 log-spaced bins 30 Hz..16 kHz, each the loudest FFT bin in its range, as ints 0..99.
export function logSpectrum(freqDb, sampleRate, nBins = SPEC_BINS) {
  const n = freqDb.length, df = sampleRate / (2 * n), fmax = Math.min(SPEC_FMAX, sampleRate / 2 - df);
  const out = new Array(nBins);
  for (let i = 0; i < nBins; i++) {
    const f0 = SPEC_FMIN * Math.pow(fmax / SPEC_FMIN, i / nBins), f1 = SPEC_FMIN * Math.pow(fmax / SPEC_FMIN, (i + 1) / nBins);
    let k0 = Math.floor(f0 / df), k1 = Math.ceil(f1 / df);
    if (k1 <= k0) k1 = k0 + 1;
    let m = -Infinity;
    for (let k = Math.max(1, k0); k <= Math.min(n - 1, k1); k++) m = Math.max(m, finiteDb(freqDb[k]));
    if (!Number.isFinite(m)) m = SPEC_DB_LO;
    out[i] = clamp(Math.round((m - SPEC_DB_LO) / (SPEC_DB_HI - SPEC_DB_LO) * 99), 0, 99);
  }
  return out;
}

export function levels(td) {
  let sq = 0, pk = 0;
  for (let i = 0; i < td.length; i++) { const v = td[i]; sq += v * v; const a = v < 0 ? -v : v; if (a > pk) pk = a; }
  return { rmsDb: r1(toDb(Math.sqrt(sq / Math.max(1, td.length)))), peakDb: r1(toDb(pk)) };
}

// Onsets from the master spectrum: positive spectral flux (40 Hz-8 kHz) against its own running mean, and kicks from
// a jump of the 30-150 Hz level. Stateful (needs the previous frame) but pure: no clocks, `t` is passed in.
export class OnsetTracker {
  constructor() { this.prev = null; this.fluxAvg = 0; this.lowAvg = -80; this.lastOnset = -1; this.lastKick = -1; this.n = 0; }
  reset() { this.prev = null; this.fluxAvg = 0; this.lowAvg = -80; this.lastOnset = this.lastKick = -1; this.n = 0; }
  push(freqDb, sampleRate, t) {
    const n = freqDb.length, df = sampleRate / (2 * n);
    const a = Math.max(1, Math.floor(40 / df)), b = Math.min(n - 1, Math.floor(8000 / df));
    let flux = 0, low = 0;
    for (let k = a; k <= b; k++) {
      const d = Math.max(finiteDb(freqDb[k]), -90);
      if (this.prev) { const x = d - Math.max(finiteDb(this.prev[k]), -90); if (x > 0) flux += x; }
    }
    for (let k = 1; k < n && k * df < 150; k++) if (k * df >= 30) low += Math.pow(10, finiteDb(freqDb[k]) / 10);
    const lowDb = 10 * Math.log10(Math.max(low, 1e-12));
    flux /= Math.max(1, b - a + 1);
    const warm = this.n >= 3 && !!this.prev;
    const onset = warm && flux > 2.2 * this.fluxAvg + 0.15 && t - this.lastOnset > 0.09;
    const kick = warm && lowDb - this.lowAvg > 4 && lowDb > -45 && t - this.lastKick > 0.15;
    if (onset) this.lastOnset = t;
    if (kick) this.lastKick = t;
    this.fluxAvg += 0.12 * (flux - this.fluxAvg);
    this.lowAvg += (lowDb > this.lowAvg ? 0.35 : 0.1) * (lowDb - this.lowAvg);
    this.prev = Float32Array.from(freqDb);
    this.n++;
    return { onset, kick, lowDb: r1(lowDb) };
  }
}

// Which tracks are carrying the sound and which are silent, from the per-track levels (dBFS RMS).
export function trackReads(tracks) {
  const live = tracks.filter(t => !t.mute);
  const top = live.reduce((m, t) => Math.max(m, t.rmsDb), -120);
  const loud = top > -50 ? live.filter(t => t.rmsDb >= top - 6 && t.rmsDb > -50).map(t => t.name) : [];
  const silent = live.filter(t => t.rmsDb < -60).map(t => t.name);
  return { loud, silent };
}

// The playhead as a listener says it: bar and beat inside the active slot ("section" = pattern slot; the live
// transport loops one slot), plus seconds along an arrangement and the marker we are in, when there is one.
export function playhead({ pos, project, activeSlot, queuedSlot, slotNames = 'ABCDEFGH' }) {
  const beat = Math.max(0, pos.localBeat || 0);
  const p = {
    slot: slotNames[activeSlot] ?? String(activeSlot),
    queued: queuedSlot == null ? null : (slotNames[queuedSlot] ?? String(queuedSlot)),
    bar: Math.floor(beat / 4) + 1,
    beat: Math.floor(beat % 4) + 1,
    bars: Math.round((pos.loopBeats || 0) / 4),
    sec: r1(pos.sec ?? 0),
  };
  const ms = project?.arrangement?.markers;
  if (Array.isArray(ms) && ms.length && Number.isFinite(pos.sec)) {
    const m = [...ms].filter(x => x.t <= pos.sec + 1e-6).sort((a, b) => b.t - a.t)[0];
    if (m) p.marker = m.name;
  }
  return p;
}

// One frame from already-measured inputs. master: {freqDb, td}; tracks: [{id,name,td,mute}].
export function buildFrame({ seq, t, sampleRate, master, tracks, head, project, playing, tracker }) {
  const bpm = project?.bpm ?? null;
  if (!playing) return { v: 1, seq, t: r3(t), playing: false, project: project?.name ?? '', bpm, ...head };
  const lv = levels(master.td);
  const tr = tracks.map(x => ({ id: x.id, name: x.name, mute: !!x.mute, ...levels(x.td) }));
  const on = tracker.push(master.freqDb, sampleRate, t);
  return {
    v: 1, seq, t: r3(t), playing: true, project: project?.name ?? '', bpm,
    ...head,
    rmsDb: lv.rmsDb, peakDb: lv.peakDb,
    bands: bandShares(master.freqDb, sampleRate),
    bandsDb: bandLevelsDb(master.freqDb, sampleRate),
    spec: logSpectrum(master.freqDb, sampleRate),
    tracks: tr,
    reads: { onset: on.onset, kick: on.kick, lowDb: on.lowDb, ...trackReads(tr) },
  };
}

// The live driver: owns the analysers while on. `src` is { engine, transport, store, bus } (the same objects the
// command API holds). Analysers are separate from the engine's own metering ones (those are 512-point).
export class LiveEar {
  constructor({ engine, transport, store, bus }) {
    Object.assign(this, { engine, transport, store, bus });
    this.running = false; this.hz = HZ_DEFAULT; this.timer = null; this.seq = 0;
    this.master = null; this.chans = new Map(); this.tracker = new OnsetTracker();
    this.lastSent = 0; this.t0 = 0; this.frames = 0; this.last = null;
  }

  status() {
    return { running: this.running, hz: this.hz, frames: this.frames, seq: this.seq, tracks: this.chans.size, playing: !!this.transport?.getPosition?.().playing };
  }

  start({ hz } = {}) {
    this.hz = clamp(Math.round(Number(hz) || this.hz || HZ_DEFAULT), HZ_MIN, HZ_MAX);
    if (this.running) { this.restartTimer(); return this.status(); }
    this.running = true; this.t0 = Date.now(); this.tracker.reset();
    this.attach();
    this.restartTimer();
    return this.status();
  }

  stop() {
    if (!this.running) return this.status();
    this.running = false;
    clearInterval(this.timer); this.timer = null;
    this.detach();
    return this.status();
  }

  restartTimer() { clearInterval(this.timer); this.timer = setInterval(() => this.tick(), Math.round(1000 / this.hz)); }

  makeAnalyser(size, smoothing) {
    const a = this.engine.ctx.createAnalyser();
    a.fftSize = size; a.smoothingTimeConstant = smoothing;
    a.freq = new Float32Array(a.frequencyBinCount); a.td = new Float32Array(a.fftSize);
    return a;
  }

  attach() {
    const e = this.engine;
    this.master = this.makeAnalyser(4096, 0.3);
    e.masterGain.connect(this.master);
    this.sync();
  }

  // The arrangement (audio clips) does not pass through the pattern engine: the transport makes a fresh ClipPlayer
  // per play/loop pass, whose master chain goes straight to the destination. Tap its master into the same master
  // analyser (an analyser sums its inputs) and each lane strip into its own analyser, re-wiring when the player
  // changes. Without this the ear is deaf to every audio-clip song.
  syncClips() {
    const cp = this.transport?.clipPlayer ?? null;
    if (cp === this.clipTap?.cp) return;
    this.dropClips();
    if (!cp || !this.master) return;
    const lanes = new Map();
    try { cp.masterChain.output.connect(this.master); } catch { return; }
    for (const [id, s] of Object.entries(cp.strips ?? {})) {
      const an = this.makeAnalyser(2048, 0);
      try { s.pan.connect(an); lanes.set(id, { node: s.pan, an }); } catch { /* strip gone */ }
    }
    this.clipTap = { cp, lanes };
  }

  dropClips() {
    const t = this.clipTap; if (!t) return;
    try { t.cp.masterChain.output.disconnect(this.master); } catch { /* ok */ }
    for (const { node, an } of t.lanes.values()) { try { node.disconnect(an); } catch { /* ok */ } }
    this.clipTap = null;
  }

  // Channels come and go (track added/removed, project replaced): reconcile each tick, it is a Map walk.
  sync() {
    this.syncClips();
    const live = this.engine.channels;
    for (const [id, ch] of live) {
      const have = this.chans.get(id);
      if (have && have.ch === ch) continue;
      if (have) this.drop(id);
      const an = this.makeAnalyser(2048, 0);
      ch.panner.connect(an);
      this.chans.set(id, { ch, an });
    }
    for (const id of [...this.chans.keys()]) if (live.get(id) !== this.chans.get(id).ch) this.drop(id);
  }

  drop(id) {
    const c = this.chans.get(id); if (!c) return;
    try { c.ch.panner.disconnect(c.an); } catch { /* the channel is already torn down */ }
    this.chans.delete(id);
  }

  detach() {
    this.dropClips();
    for (const id of [...this.chans.keys()]) this.drop(id);
    if (this.master) { try { this.engine.masterGain.disconnect(this.master); } catch { /* ok */ } this.master = null; }
  }

  // One measurement. Returns the frame (and emits it on the bus while streaming).
  measure() {
    const pos = this.transport.getPosition();
    const { store } = this;
    const head = playhead({ pos, project: store.project, activeSlot: store.ui.activeSlot, queuedSlot: store.ui.queuedSlot });
    const base = { seq: ++this.seq, t: (Date.now() - this.t0) / 1000, sampleRate: this.engine.ctx.sampleRate, project: store.project, head, playing: !!pos.playing, tracker: this.tracker };
    if (!pos.playing) { this.tracker.reset(); return buildFrame({ ...base, master: null, tracks: [] }); }
    this.sync();
    this.master.getFloatFrequencyData(this.master.freq);
    this.master.getFloatTimeDomainData(this.master.td);
    const names = new Map(store.project.tracks.map(t => [t.id, t]));
    const tracks = [];
    for (const [id, { ch, an }] of this.chans) {
      an.getFloatTimeDomainData(an.td);
      const tr = names.get(id);
      tracks.push({ id, name: tr?.name ?? id, mute: !!tr?.channel?.mute, td: an.td });
    }
    // arrangement lanes (audio clips), named as the timeline names them
    if (this.clipTap) {
      const lanes = new Map((store.project.arrangement?.lanes ?? []).map(l => [l.id, l]));
      for (const [id, { an }] of this.clipTap.lanes) {
        an.getFloatTimeDomainData(an.td);
        const l = lanes.get(id);
        tracks.push({ id, name: l?.name ?? id, mute: !!l?.mute, td: an.td });
      }
    }
    return buildFrame({ ...base, master: { freqDb: this.master.freq, td: this.master.td }, tracks });
  }

  tick() {
    if (!this.running) return;
    let f;
    try { f = this.measure(); } catch (err) { return; }
    const now = Date.now();
    // Stopped transport: a light heartbeat once a second, not 15 frames of nothing.
    if (!f.playing && this.last && !this.last.playing && now - this.lastSent < 1000) { this.last = f; return; }
    this.last = f; this.lastSent = now; this.frames++;
    this.bus.emit('ear:frame', f);
  }

  // One-off read without streaming (the MCP/agent path): attach, let the analysers fill, sample, detach.
  async snapshot() {
    const was = this.running;
    if (!was) { this.running = true; this.t0 = Date.now(); this.tracker.reset(); this.attach(); }
    try {
      if (!was) await new Promise(r => setTimeout(r, 180));
      // The onset tracker needs a few frames to warm up; sample three and keep the last.
      let f = this.measure();
      for (let i = 0; i < 3 && !was; i++) { await new Promise(r => setTimeout(r, 60)); f = this.measure(); }
      return f;
    } finally {
      if (!was) { this.running = false; this.detach(); }
    }
  }
}
