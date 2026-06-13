// AudioEngine: owns the live audio graph and nothing else. It is a pure
// *reaction* to the store -- it subscribes to bus events and mirrors state
// into Web Audio nodes. It never mutates the project. That one-way flow
// (store -> bus -> engine) is the seam that lets the UI, persistence, and
// engine evolve independently (the DAW-bones promise).
//
// Per-track graph:
//   instrument.output -> chanGain (fader/mute) -> panner -> analyser -> masterIn
//                                                  panner -> sendDelay  -> delay bus
//                                                  panner -> sendReverb -> reverb bus
// Master: masterIn -> compressor (glue) -> masterGain -> analyser -> destination

import { getCtx, ensureRunning } from './context.js';
import { createInstrument, getInstrumentDef } from './instruments/index.js';
import { DelayFX } from './effects/delay.js';
import { ReverbFX } from './effects/reverb.js';
import { throttle } from '../core/util.js';

export class AudioEngine {
  constructor(store, bus) {
    this.store = store;
    this.bus = bus;
    const ctx = this.ctx = getCtx();

    // -- master chain --
    this.masterIn = ctx.createGain();
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -12;
    this.comp.knee.value = 18;
    this.comp.ratio.value = 3;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.22;
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = store.project.masterVolume;
    this.masterAnalyser = ctx.createAnalyser();
    this.masterAnalyser.fftSize = 512;
    this.masterIn.connect(this.comp);
    this.comp.connect(this.masterGain);
    this.masterGain.connect(this.masterAnalyser);
    this.masterAnalyser.connect(ctx.destination);

    // -- shared FX buses --
    this.delayFx = new DelayFX(ctx, store, bus);
    this.reverbFx = new ReverbFX(ctx, store, bus);
    this.delayFx.output.connect(this.masterIn);
    this.reverbFx.output.connect(this.masterIn);

    this.channels = new Map(); // trackId -> channel
    this.meterBuf = new Float32Array(512);
    this.emitTrigger = throttle((trackId) => bus.emit('track:trigger', { trackId }), 90);

    this.buildAll();
    this.subscribe();
  }

  // -- graph lifecycle ---------------------------------------------------

  subscribe() {
    const { bus, store } = this;
    bus.on('track:added', ({ track }) => { this.buildChannel(track); this.applyMixState(); });
    bus.on('track:removed', ({ trackId }) => this.teardownChannel(trackId));
    bus.on('channel:changed', () => this.applyMixState());
    bus.on('param:changed', ({ trackId, key, value }) => {
      this.channels.get(trackId)?.instrument.setParam(key, value);
    });
    bus.on('preset:applied', ({ trackId, params }) => {
      this.channels.get(trackId)?.instrument.setParams(params);
    });
    bus.on('settings:changed', ({ key }) => {
      if (key === 'masterVolume') {
        this.masterGain.gain.setTargetAtTime(store.project.masterVolume, this.ctx.currentTime, 0.02);
      }
    });
    bus.on('project:replaced', () => this.rebuildAll());
    bus.on('schedule:window', (w) => this.scheduleWindow(w));
    bus.on('transport:state', ({ playing }) => { if (!playing) this.allOff(); });
  }

  buildAll() {
    for (const track of this.store.project.tracks) this.buildChannel(track);
    this.applyMixState();
  }

  rebuildAll() {
    for (const id of [...this.channels.keys()]) this.teardownChannel(id);
    this.masterGain.gain.setTargetAtTime(this.store.project.masterVolume, this.ctx.currentTime, 0.02);
    this.buildAll();
  }

  buildChannel(track) {
    const ctx = this.ctx;
    const instrument = createInstrument(track.instrument.type, ctx, track.instrument.params);

    const chanGain = ctx.createGain();
    const panner = ctx.createStereoPanner();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    const sendDelay = ctx.createGain();
    const sendReverb = ctx.createGain();
    sendDelay.gain.value = 0;
    sendReverb.gain.value = 0;

    instrument.output.connect(chanGain);
    chanGain.connect(panner);
    panner.connect(analyser);
    analyser.connect(this.masterIn);
    panner.connect(sendDelay);
    sendDelay.connect(this.delayFx.input);
    panner.connect(sendReverb);
    sendReverb.connect(this.reverbFx.input);

    this.channels.set(track.id, { trackId: track.id, instrument, chanGain, panner, analyser, sendDelay, sendReverb });
  }

  teardownChannel(trackId) {
    const ch = this.channels.get(trackId);
    if (!ch) return;
    this.channels.delete(trackId);
    ch.instrument.dispose();
    for (const node of [ch.chanGain, ch.panner, ch.analyser, ch.sendDelay, ch.sendReverb]) {
      try { node.disconnect(); } catch { /* ok */ }
    }
  }

  applyMixState() {
    const t = this.ctx.currentTime;
    const tracks = this.store.project.tracks;
    const anySolo = tracks.some(tr => tr.channel.solo);
    for (const tr of tracks) {
      const ch = this.channels.get(tr.id);
      if (!ch) continue;
      const audible = !tr.channel.mute && (!anySolo || tr.channel.solo);
      // Audio-taper the linear fader value.
      const gain = audible ? Math.pow(tr.channel.gain, 2) * 1.4 : 0;
      ch.chanGain.gain.setTargetAtTime(gain, t, 0.015);
      ch.panner.pan.setTargetAtTime(tr.channel.pan, t, 0.015);
      ch.sendDelay.gain.setTargetAtTime(tr.channel.sendDelay, t, 0.02);
      ch.sendReverb.gain.setTargetAtTime(tr.channel.sendReverb, t, 0.02);
    }
  }

  // -- sequencing ----------------------------------------------------------

  scheduleWindow(w) {
    const { store } = this;
    const spb = 60 / store.project.bpm;

    for (const track of store.project.tracks) {
      const ch = this.channels.get(track.id);
      if (!ch) continue;
      const def = getInstrumentDef(track.instrument.type);
      const pattern = store.getPattern(track.id, w.slotIndex);
      let triggered = false;

      if (def.kind === 'drums') {
        const from = Math.ceil(w.fromLocal * 4 - 1e-6);
        const to = w.toLocal * 4 - 1e-6;
        for (let idx = from; idx < to; idx++) {
          const localBeat = idx / 4;
          let any = false;
          for (const lane of def.lanes) {
            const vel = pattern.steps[lane.id]?.[idx] || 0;
            if (vel > 0) {
              const time = w.beatToTime(w.loopStartAbs + localBeat) + w.swingOffset(localBeat);
              ch.instrument.trigger(lane.id, time, vel);
              any = true;
            }
          }
          if (any) triggered = true;
        }
      } else {
        for (const note of pattern.notes) {
          if (note.start >= w.fromLocal - 1e-9 && note.start < w.toLocal - 1e-9) {
            const time = w.beatToTime(w.loopStartAbs + note.start) + w.swingOffset(note.start);
            ch.instrument.noteOn(time, note.pitch, note.vel, note.dur * spb);
            triggered = true;
          }
        }
      }
      if (triggered) this.emitTrigger(track.id);
    }
  }

  allOff() {
    for (const ch of this.channels.values()) ch.instrument.allOff();
  }

  // -- live input (keyboard / audition) -------------------------------------

  previewOn(trackId, midi, vel = 0.9) {
    ensureRunning();
    const ch = this.channels.get(trackId);
    ch?.instrument.noteOn(this.ctx.currentTime + 0.003, midi, vel, null);
    if (ch) this.emitTrigger(trackId);
  }

  previewOff(trackId, midi) {
    this.channels.get(trackId)?.instrument.noteOff(midi);
  }

  previewNote(trackId, midi, vel = 0.9, durSec = 0.3) {
    ensureRunning();
    const ch = this.channels.get(trackId);
    ch?.instrument.noteOn(this.ctx.currentTime + 0.003, midi, vel, durSec);
  }

  previewHit(trackId, laneId, vel = 1) {
    ensureRunning();
    const ch = this.channels.get(trackId);
    ch?.instrument.trigger(laneId, this.ctx.currentTime + 0.003, vel);
    if (ch) this.emitTrigger(trackId);
  }

  // -- metering --------------------------------------------------------------

  peakOf(analyser) {
    analyser.getFloatTimeDomainData(this.meterBuf);
    let peak = 0;
    for (let i = 0; i < this.meterBuf.length; i++) {
      const a = Math.abs(this.meterBuf[i]);
      if (a > peak) peak = a;
    }
    return peak;
  }

  getLevel(trackId) {
    if (trackId === 'master') return this.peakOf(this.masterAnalyser);
    const ch = this.channels.get(trackId);
    return ch ? this.peakOf(ch.analyser) : 0;
  }
}
