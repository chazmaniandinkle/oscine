// Fully synthesized 8-lane drum kit. No samples: every hit is built from
// oscillators and filtered noise at trigger time, so the kit responds to
// tune/decay/tone params live and the project stays a few KB of JSON.

import { BaseInstrument, noiseBuffer } from './base.js';
import { defineInstrument } from './registry.js';

class DrumKit extends BaseInstrument {
  constructor(ctx, params, def) {
    super(ctx, params, def);
    this.openHatGain = null; // for choke
  }

  get tuneMul() { return Math.pow(2, this.params.tune / 12); }
  get dk() { return this.params.decay; }

  // -- node helpers ---------------------------------------------------

  env(g, time, peak, decay) {
    g.gain.setValueAtTime(0, time);
    g.gain.setTargetAtTime(peak, time, 0.0015);
    g.gain.setTargetAtTime(0, time + 0.004, decay / 3);
  }

  burst(time, { hp = 0, bp = 0, bpQ = 1, peak = 0.5, decay = 0.1, stopAfter = null }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx);
    src.loop = true;
    let node = src;
    if (hp) {
      const f = ctx.createBiquadFilter();
      f.type = 'highpass'; f.frequency.value = hp;
      node.connect(f); node = f;
    }
    if (bp) {
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.value = bp; f.Q.value = bpQ;
      node.connect(f); node = f;
    }
    const g = ctx.createGain();
    this.env(g, time, peak, decay);
    node.connect(g).connect(this.output);
    src.start(time);
    const stop = time + (stopAfter ?? decay * 4 + 0.1);
    src.stop(stop);
    src.onended = () => { try { g.disconnect(); } catch { /* ok */ } };
    return g;
  }

  tone(time, { type = 'sine', f0, f1 = null, sweep = 0.08, peak = 0.5, decay = 0.2 }) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, time);
    if (f1 !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), time + sweep);
    const g = ctx.createGain();
    this.env(g, time, peak, decay);
    osc.connect(g).connect(this.output);
    osc.start(time);
    osc.stop(time + decay * 4 + 0.15);
    osc.onended = () => { try { g.disconnect(); } catch { /* ok */ } };
    return g;
  }

  // -- the kit ---------------------------------------------------------

  trigger(laneId, time, vel = 1) {
    const v = vel * this.params.level;
    const tm = this.tuneMul;
    const dk = this.dk;
    const tone01 = this.params.tone;

    switch (laneId) {
      case 'kick': {
        this.tone(time, { f0: 165 * tm, f1: 47 * tm, sweep: 0.085, peak: v * 1.15, decay: 0.16 * dk });
        // Beater click.
        this.burst(time, { hp: 1200, peak: v * 0.25 * (0.5 + tone01), decay: 0.012 });
        break;
      }
      case 'snare': {
        this.tone(time, { type: 'triangle', f0: 215 * tm, f1: 160 * tm, sweep: 0.04, peak: v * 0.5 * (1.1 - tone01 * 0.6), decay: 0.09 * dk });
        this.burst(time, { hp: 700, bp: 1700 + tone01 * 1800, bpQ: 0.9, peak: v * (0.45 + tone01 * 0.4), decay: 0.13 * dk });
        break;
      }
      case 'clap': {
        for (let i = 0; i < 3; i++) {
          this.burst(time + i * 0.011, { bp: 1100 + tone01 * 600, bpQ: 1.6, peak: v * 0.5, decay: 0.012 });
        }
        this.burst(time + 0.028, { bp: 1150 + tone01 * 600, bpQ: 1.4, peak: v * 0.55, decay: 0.1 * dk });
        break;
      }
      case 'chat': {
        if (this.openHatGain) {
          this.openHatGain.gain.setTargetAtTime(0, time, 0.008);
          this.openHatGain = null;
        }
        this.burst(time, { hp: 6500 + tone01 * 3000, peak: v * 0.4, decay: 0.035 * dk });
        break;
      }
      case 'ohat': {
        if (this.openHatGain) this.openHatGain.gain.setTargetAtTime(0, time, 0.008);
        this.openHatGain = this.burst(time, { hp: 6000 + tone01 * 3000, peak: v * 0.38, decay: 0.32 * dk, stopAfter: 1.6 });
        break;
      }
      case 'ltom': {
        this.tone(time, { f0: 140 * tm, f1: 88 * tm, sweep: 0.16, peak: v * 0.8, decay: 0.3 * dk });
        break;
      }
      case 'htom': {
        this.tone(time, { f0: 210 * tm, f1: 140 * tm, sweep: 0.13, peak: v * 0.75, decay: 0.24 * dk });
        break;
      }
      case 'ride': {
        this.burst(time, { hp: 5000 + tone01 * 2000, peak: v * 0.22, decay: 0.5 * dk, stopAfter: 2.2 });
        this.tone(time, { type: 'square', f0: 4800 * tm, peak: v * 0.05, decay: 0.4 * dk });
        break;
      }
    }
  }

  allOff() {
    if (this.openHatGain) {
      this.openHatGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.01);
      this.openHatGain = null;
    }
  }
}

defineInstrument({
  type: 'drums',
  label: 'Drum Kit',
  kind: 'drums',
  klass: DrumKit,
  lanes: [
    { id: 'kick', label: 'Kick' },
    { id: 'snare', label: 'Snare' },
    { id: 'clap', label: 'Clap' },
    { id: 'chat', label: 'CH Hat' },
    { id: 'ohat', label: 'OH Hat' },
    { id: 'ltom', label: 'Lo Tom' },
    { id: 'htom', label: 'Hi Tom' },
    { id: 'ride', label: 'Ride' },
  ],
  params: [
    { key: 'tune', label: 'Tune', type: 'knob', min: -12, max: 12, step: 1, default: 0, unit: 'st', group: 'Kit' },
    { key: 'decay', label: 'Decay', type: 'knob', min: 0.4, max: 2.5, default: 1, group: 'Kit' },
    { key: 'tone', label: 'Tone', type: 'knob', min: 0, max: 1, default: 0.5, group: 'Kit' },
    { key: 'level', label: 'Level', type: 'knob', min: 0, max: 1, default: 0.9, group: 'Kit' },
  ],
  presets: {
    'Tight': { decay: 0.65, tone: 0.6 },
    'Boomy': { tune: -3, decay: 1.8, tone: 0.3 },
    'Crisp': { tune: 2, decay: 0.8, tone: 0.85 },
  },
});
