// Atmos: wide pads and stabs for liquid DnB, designed by ear (2026-10-08).
// Per voice: N detuned saws spread across the stereo field (each saw panned),
// a gentle lowpass with its own slow envelope, and an ADSR. A "shimmer" layer
// adds the same chord an octave up at low level through a high-pass: air on
// top without making the body bright. Velocity also opens the filter.
// The June poly synth was mono-summed two-oscillator; this one is wide by
// construction (side energy is the point of a pad).

import { BaseInstrument } from './base.js';
import { defineInstrument } from './registry.js';
import { midiToFreq } from '../../core/util.js';

class Atmos extends BaseInstrument {
  constructor(ctx, params, def) {
    super(ctx, params, def);
    this.voices = [];
    this.air = ctx.createBiquadFilter(); this.air.type = 'highpass'; this.air.frequency.value = 2500;
    this.airGain = ctx.createGain(); this.airGain.gain.value = this.params.shimmer;
    this.air.connect(this.airGain).connect(this.output);
  }
  onParam(k) { if (k === 'shimmer') this.airGain.gain.setTargetAtTime(this.params.shimmer, this.ctx.currentTime, 0.05); }

  noteOn(time, midi, vel = 0.8, durSec = null) {
    const ctx = this.ctx, p = this.params, f = midiToFreq(midi);
    this.voices = this.voices.filter(v => !(v.endsAt && v.endsAt < ctx.currentTime));
    if (this.voices.length >= 24) this.release(this.voices.shift(), time, 0.05);
    const n = Math.round(p.saws), sum = ctx.createGain(); sum.gain.value = 0.55 / Math.sqrt(n);
    const oscs = [];
    for (let i = 0; i < n; i++) {
      const s = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
      const o = ctx.createOscillator(); o.type = p.wave;
      o.frequency.setValueAtTime(f, time); o.detune.setValueAtTime(s * p.detune, time);
      const pan = ctx.createStereoPanner(); pan.pan.value = s * p.width;
      o.connect(pan).connect(sum); o.start(time); oscs.push(o);
    }
    if (p.shimmer > 0) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f * 2, time); o.detune.value = 7;
      const sg = ctx.createGain(); sg.gain.value = 0.25; o.connect(sg).connect(this.air); o.start(time); oscs.push(o);
      o._air = sg;
    }
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = p.resonance;
    const open = p.cutoff * (1 + p.velFilter * vel * 2);
    lp.frequency.setValueAtTime(p.cutoff * 0.5, time);
    lp.frequency.setTargetAtTime(open, time, Math.max(0.005, p.filterAttack) / 3);
    const vca = ctx.createGain(); vca.gain.setValueAtTime(0, time);
    vca.gain.setTargetAtTime(vel, time, Math.max(0.002, p.attack) / 3);
    vca.gain.setTargetAtTime(vel * p.sustain, time + p.attack, Math.max(0.01, p.decay) / 3);
    sum.connect(lp).connect(vca).connect(this.output);
    const v = { oscs, vca, endsAt: null, released: false, midi };
    this.voices.push(v);
    if (durSec !== null) this.release(v, time + Math.max(0.02, durSec));
  }
  release(v, time, r = null) {
    if (v.released) return; v.released = true;
    const rel = r ?? Math.max(0.02, this.params.release);
    v.vca.gain.cancelScheduledValues(time); v.vca.gain.setTargetAtTime(0, time, rel / 3);
    for (const o of v.oscs) if (o._air) { o._air.gain.setTargetAtTime(0, time, rel / 3); }
    const stop = time + rel * 4 + 0.05;
    for (const o of v.oscs) { try { o.stop(stop); } catch { /* ok */ } }
    v.endsAt = stop;
  }
  noteOff(midi) { for (const v of this.voices) if (v.midi === midi && !v.released) this.release(v, this.ctx.currentTime); }
  allOff() { for (const v of this.voices) this.release(v, this.ctx.currentTime, 0.05); }
}

const K = (key, label, min, max, def, extra = {}) => ({ key, label, type: 'knob', min, max, default: def, ...extra });
defineInstrument({
  type: 'atmos',
  label: 'Atmos Pad',
  kind: 'synth',
  klass: Atmos,
  params: [
    { key: 'wave', label: 'Wave', type: 'select', options: [{ value: 'sawtooth', label: 'Saw' }, { value: 'triangle', label: 'Tri' }, { value: 'square', label: 'Square' }], default: 'sawtooth', group: 'Osc' },
    K('saws', 'Voices', 1, 9, 7, { step: 1, group: 'Osc' }),
    K('detune', 'Detune', 0, 60, 18, { unit: 'ct', group: 'Osc' }),
    K('width', 'Width', 0, 1, 0.8, { group: 'Osc' }),
    K('shimmer', 'Shimmer', 0, 1, 0.25, { group: 'Osc' }),
    K('cutoff', 'Cutoff', 100, 12000, 1800, { curve: 'log', unit: 'Hz', group: 'Filter' }),
    K('resonance', 'Res', 0, 10, 0.7, { group: 'Filter' }),
    K('velFilter', 'Vel>Filt', 0, 1, 0.4, { group: 'Filter' }),
    K('filterAttack', 'Filt Att', 0.005, 4, 0.6, { curve: 'log', unit: 's', group: 'Filter' }),
    K('attack', 'Attack', 0.002, 4, 0.4, { curve: 'log', unit: 's', group: 'Amp' }),
    K('decay', 'Decay', 0.01, 4, 1.2, { curve: 'log', unit: 's', group: 'Amp' }),
    K('sustain', 'Sustain', 0, 1, 0.75, { group: 'Amp' }),
    K('release', 'Release', 0.02, 6, 1.6, { curve: 'log', unit: 's', group: 'Amp' }),
    K('level', 'Level', 0, 1, 0.7, { group: 'Amp' }),
  ],
  presets: {
    'Liquid Pad': {},
    'Stab': { saws: 5, detune: 14, width: 0.6, shimmer: 0.15, cutoff: 2600, filterAttack: 0.005, attack: 0.002, decay: 0.35, sustain: 0.15, release: 0.25, velFilter: 0.7 },
    'Choir Air': { wave: 'triangle', saws: 9, detune: 26, width: 1, shimmer: 0.45, cutoff: 3200, attack: 1.2, release: 2.5 },
    'Dark Wash': { saws: 7, detune: 30, cutoff: 700, shimmer: 0.05, attack: 1.5, filterAttack: 3, release: 3 },
  },
});
