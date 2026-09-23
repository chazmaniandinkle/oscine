// Clip playback: schedule arrangement placements as AudioBufferSourceNodes
// against any AudioContext (live or offline). Unlike transport.js/render.js,
// which walk a beat clock, the arrangement is stored in seconds already
// (see core/schema.js), so this module works in ctx time directly -- no
// secPerBeat conversion anywhere here.
//
// One source node per placement per start() call, matching Web Audio's
// play-once model. A source can't be paused/resumed, so seeking (start from
// a non-zero position) means computing a per-placement buffer offset instead
// of moving a shared playhead.

import { AssetCache } from '../core/assets.js';
import { InsertChain } from './effects/index.js';
import { scheduleAll, findEnvelope, targetOf } from './automation.js';

// Decibels -> linear gain. Small enough that duplicating it beats a shared
// util for one line; -Infinity dB (silence) must map to exactly 0, not a
// tiny nonzero float from Math.pow underflow.
export function dbToGain(db) {
  return db <= -100 ? 0 : Math.pow(10, db / 20);
}

export class ClipPlayer {
  constructor(ctx, project, { assetCache, destination, laneGains = {} } = {}) {
    this.ctx = ctx;
    this.project = project;
    this.assetCache = assetCache ?? new AssetCache(ctx);
    this.destination = destination ?? ctx.destination;

    // Per-lane strip: gain (fader/mute/solo) -> inserts -> pan -> analyser
    // -> master bus. Master bus: inserts -> destination. Inserts come from
    // arrangement.lanes[].inserts / arrangement.master.inserts
    // ([{type, params, bypass}]) and are rebuilt via syncInserts() on change.
    // Works on live and offline contexts alike (effects are node-only).
    this.laneGains = { ...laneGains };
    this.strips = {};  // laneId -> { gain, chain, pan, analyser }
    this.masterChain = new InsertChain(ctx);
    this.masterChain.sync(project.arrangement?.master?.inserts ?? []);
    this.masterChain.output.connect(this.destination);
    const lanes = project.arrangement?.lanes ?? [];
    const anySolo = lanes.some(l => l.solo);
    for (const p of project.arrangement?.placements ?? []) {
      if (!this.laneGains[p.track]) {
        const lane = lanes.find(l => l.id === p.track);
        const g = ctx.createGain();
        const audible = lane ? (anySolo ? !!lane.solo : !lane.mute) : true;
        g.gain.value = audible ? dbToGain(lane?.gainDb ?? 0) : 0;
        const chain = new InsertChain(ctx);
        chain.sync(lane?.inserts ?? []);
        const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
        if (pan.pan) pan.pan.value = lane?.pan ?? 0;
        const analyser = ctx.createAnalyser(); analyser.fftSize = 512;
        g.connect(chain.input); chain.output.connect(pan); pan.connect(analyser); analyser.connect(this.masterChain.input);
        this.laneGains[p.track] = g;
        this.strips[p.track] = { gain: g, chain, pan, analyser };
      }
    }

    this.buffers = new Map(); // clip.id -> AudioBuffer
    this.liveNodes = [];      // { source, gain } currently scheduled/playing
  }

  // Rebuild insert chains from the project (after an inserts edit). Cheap:
  // InsertChain.sync reuses instances whose type matches at the same index.
  syncInserts() {
    const arr = this.project.arrangement;
    this.masterChain.sync(arr?.master?.inserts ?? []);
    for (const [id, s] of Object.entries(this.strips)) {
      const lane = arr?.lanes?.find(l => l.id === id);
      s.chain.sync(lane?.inserts ?? []);
      if (s.pan.pan) s.pan.pan.setTargetAtTime(lane?.pan ?? 0, this.ctx.currentTime, 0.01);
    }
  }
  // Peak level (0..1) of a lane's post-insert signal, for meters.
  laneLevel(id, buf) {
    const s = this.strips[id]; if (!s) return 0;
    s.analyser.getFloatTimeDomainData(buf);
    let p = 0; for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i]); if (v > p) p = v; }
    return p;
  }

  // Decode every buffer a placement's clip needs before start() can run
  // without an audible gap. representation === null means "default variant"
  // (see schema.js createClip). Clips with a decoupled stretch/semitones
  // get a *derived* buffer (phase vocoder), cached on the AssetCache by
  // content hash + params so repeated plays don't re-render.
  async prepare() {
    const placements = this.project.arrangement?.placements ?? [];
    const jobs = placements.map(async (p) => {
      const clip = this.project.clips[p.clip];
      if (!clip || this.buffers.has(clip.id)) return;
      let buffer = await this.assetCache.getBuffer(this.project, clip.sourceOf, clip.representation);
      const st = clip.stretch ?? 1, semi = clip.semitones ?? 0;
      if (Math.abs(st - 1) > 1e-4 || Math.abs(semi) > 1e-4) {
        buffer = await this.assetCache.getDerived(this.project, clip.sourceOf, clip.representation, { stretch: st, semitones: semi });
      }
      this.buffers.set(clip.id, buffer);
    });
    await Promise.all(jobs);
  }

  // Seconds a placement occupies on the timeline, after stretch/rate.
  static placedDuration(clip) {
    return (clip.out - clip.in) * (clip.stretch ?? 1) / (clip.rate ?? 1);
  }

  // Schedule every placement overlapping [fromSeconds, +inf) to start at
  // ctx time atCtxTime + (placement offset from fromSeconds). Placements
  // that start before fromSeconds are trimmed in from the middle (seek).
  start(atCtxTime = this.ctx.currentTime, fromSeconds = 0) {
    const placements = this.project.arrangement?.placements ?? [];
    // Automation envelopes for this play span (gain/pan on lanes, master).
    const span = Math.max(0, ClipPlayer.duration(this.project) - fromSeconds) + 1;
    scheduleAll(this, { at: atCtxTime, from: fromSeconds, span });
    for (const p of placements) {
      const clip = this.project.clips[p.clip];
      if (!clip) continue;
      const buffer = this.buffers.get(clip.id);
      if (!buffer) continue; // not decoded (prepare() wasn't awaited for it)

      // Derived (vocoder) buffers are already stretched: in/out map through
      // `stretch`. `rate` is the cheap tape-style path on the node itself
      // (speed and pitch move together); `detune` (cents) rides with it.
      const st = clip.stretch ?? 1, rate = clip.rate ?? 1;
      const srcIn = clip.in * st, srcOut = clip.out * st;
      const clipDur = (srcOut - srcIn) / rate;
      const placementEnd = p.at + clipDur;
      if (placementEnd <= fromSeconds) continue; // fully in the past

      const skip = Math.max(0, fromSeconds - p.at); // seconds trimmed off the front
      const offset = srcIn + skip * rate;
      const duration = clipDur - skip;
      if (duration <= 0) continue;

      const startAt = atCtxTime + Math.max(0, p.at - fromSeconds);

      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      if (rate !== 1) source.playbackRate.value = rate;
      if (clip.detune) source.detune.value = clip.detune;

      const gain = this.ctx.createGain();
      const base = dbToGain(clip.gainDb || 0);
      // Fades are relative to the clip's own timeline, clamped to what's
      // actually left to play after a seek trims the front.
      const fadeIn = Math.max(0, clip.fadeIn - skip);
      const fadeOut = Math.min(clip.fadeOut, duration);

      gain.gain.setValueAtTime(fadeIn > 0 ? 0 : base, startAt);
      if (fadeIn > 0) gain.gain.linearRampToValueAtTime(base, startAt + fadeIn);
      if (fadeOut > 0) {
        gain.gain.setValueAtTime(base, startAt + duration - fadeOut);
        gain.gain.linearRampToValueAtTime(0, startAt + duration);
      }

      const lane = this.laneGains[p.track] ?? this.destination;
      source.connect(gain).connect(lane);
      source.start(startAt, offset, duration * rate);

      this.liveNodes.push({ source, gain });
    }
  }

  // Stop and disconnect every node this player has scheduled or started.
  // Safe to call on already-finished sources (stop() on a stopped node
  // throws in some engines, so it's wrapped).
  stop() {
    for (const { source, gain } of this.liveNodes) {
      try { source.stop(); } catch { /* already stopped/ended */ }
      source.disconnect();
      gain.disconnect();
    }
    this.liveNodes = [];
    // Tear down strips + chains too, else each play() leaks a chain of
    // effect nodes (reverb convolvers are not free).
    for (const s of Object.values(this.strips)) { s.chain.dispose(); for (const n of [s.gain, s.pan, s.analyser]) { try { n.disconnect(); } catch {} } }
    this.masterChain.dispose();
  }

  // Live mix update: re-read lanes[].gainDb/mute/solo and ramp each lane's
  // GainNode over ~30 ms so a fader move during playback doesn't click.
  applyLanes() {
    const lanes = this.project.arrangement?.lanes ?? [];
    const anySolo = lanes.some(l => l.solo);
    const t = this.ctx.currentTime;
    for (const [id, g] of Object.entries(this.laneGains)) {
      const lane = lanes.find(l => l.id === id);
      const audible = lane ? (anySolo ? !!lane.solo : !lane.mute) : true;
      // A gain envelope owns this node while playing; don't stomp its curve.
      if (audible && findEnvelope(this.project.arrangement, targetOf('lane', id, 'gainDb'))?.points?.length) continue;
      const target = audible ? dbToGain(lane?.gainDb ?? 0) : 0;
      g.gain.cancelScheduledValues(t);
      g.gain.setValueAtTime(g.gain.value, t);
      g.gain.linearRampToValueAtTime(target, t + 0.03);
    }
  }

  // Arrangement length in seconds: explicit length wins, else the end of
  // the last placement.
  static duration(project) {
    const arr = project.arrangement;
    if (!arr) return 0;
    if (arr.length) return arr.length;
    let end = 0;
    for (const p of arr.placements) {
      const clip = project.clips[p.clip];
      if (!clip) continue;
      end = Math.max(end, p.at + ClipPlayer.placedDuration(clip));
    }
    return end;
  }
}
