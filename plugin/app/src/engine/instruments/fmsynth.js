// 2-operator FM synth: sine modulator -> carrier frequency. Snappy
// modulation-depth envelope gives e-piano, bell, and pluck tones that a
// subtractive synth can't reach. Small on purpose: this file is the
// template for "how little it takes" to add an instrument (see README).

import { BaseInstrument } from './base.js';
import { defineInstrument } from './registry.js';
import { midiToFreq, clamp } from '../../core/util.js';

class FMSynth extends BaseInstrument {
  constructor(ctx, params, def) {
    super(ctx, params, def);
    this.voices = [];
    this.held = new Map();
  }

  pruneVoices() {
    const now = this.ctx.currentTime;
    this.voices = this.voices.filter(v => !(v.endsAt !== null && v.endsAt < now));
  }

  noteOn(time, midi, vel = 0.9, durSec = null) {
    this.pruneVoices();
    if (this.voices.length >= 12) {
      let oldest = this.voices[0];
      for (const v of this.voices) if (v.startedAt < oldest.startedAt) oldest = v;
      this.releaseVoice(oldest, this.ctx.currentTime, 0.02);
    }
    if (durSec === null && this.held.has(midi)) this.noteOff(midi);

    const ctx = this.ctx;
    const p = this.params;
    const freq = midiToFreq(midi);

    const carrier = ctx.createOscillator();
    carrier.type = 'sine';
    carrier.frequency.setValueAtTime(freq, time);

    const mod = ctx.createOscillator();
    mod.type = 'sine';
    mod.frequency.setValueAtTime(freq * p.ratio, time);

    // Modulation depth in Hz, enveloped. Velocity drives brightness.
    const modGain = ctx.createGain();
    const depth = p.fmIndex * freq * (0.4 + 0.6 * vel);
    modGain.gain.setValueAtTime(0, time);
    modGain.gain.setTargetAtTime(depth, time, 0.002);
    modGain.gain.setTargetAtTime(depth * p.modSustain, time + 0.006, Math.max(p.modDecay, 0.02) / 3);
    mod.connect(modGain).connect(carrier.frequency);

    const vca = ctx.createGain();
    const peak = clamp(vel, 0.02, 1) * 0.9;
    const a = Math.max(p.attack, 0.002);
    vca.gain.setValueAtTime(0, time);
    vca.gain.setTargetAtTime(peak, time, a / 3);
    vca.gain.setTargetAtTime(p.sustain * peak, time + a, Math.max(p.decay, 0.01) / 3);
    carrier.connect(vca).connect(this.output);

    carrier.start(time);
    mod.start(time);

    const voice = {
      midi, vca, carrier, mod,
      startedAt: time, endsAt: null, released: false,
    };
    carrier.onended = () => { try { vca.disconnect(); } catch { /* ok */ } };
    this.voices.push(voice);

    if (durSec !== null) this.releaseVoice(voice, time + Math.max(durSec, 0.02));
    else this.held.set(midi, voice);
  }

  releaseVoice(voice, time, releaseOverride = null) {
    if (voice.released) return;
    voice.released = true;
    const r = releaseOverride ?? Math.max(this.params.release, 0.015);
    voice.vca.gain.setTargetAtTime(0, time, r / 3);
    const stopAt = time + r * 3 + 0.08;
    try { voice.carrier.stop(stopAt); voice.mod.stop(stopAt); } catch { /* ok */ }
    voice.endsAt = stopAt;
  }

  noteOff(midi) {
    const voice = this.held.get(midi);
    if (!voice) return;
    this.held.delete(midi);
    this.releaseVoice(voice, this.ctx.currentTime);
  }

  allOff() {
    const now = this.ctx.currentTime;
    for (const v of this.voices) this.releaseVoice(v, now, 0.03);
    this.held.clear();
  }
}

defineInstrument({
  type: 'fm',
  label: 'FM Synth',
  kind: 'synth',
  klass: FMSynth,
  params: [
    { key: 'ratio', label: 'Ratio', type: 'select', options: [
      { value: 0.5, label: '0.5' }, { value: 1, label: '1' }, { value: 1.5, label: '1.5' },
      { value: 2, label: '2' }, { value: 3, label: '3' }, { value: 4, label: '4' },
      { value: 5, label: '5' }, { value: 7, label: '7' },
    ], default: 2, group: 'Operator' },
    { key: 'fmIndex', label: 'Index', type: 'knob', min: 0, max: 12, default: 4, group: 'Operator' },
    { key: 'modDecay', label: 'Mod Dec', type: 'knob', min: 0.02, max: 3, default: 0.4, curve: 'log', unit: 's', group: 'Operator' },
    { key: 'modSustain', label: 'Mod Sus', type: 'knob', min: 0, max: 1, default: 0.05, group: 'Operator' },
    { key: 'attack', label: 'Attack', type: 'knob', min: 0.001, max: 1, default: 0.002, curve: 'log', unit: 's', group: 'Amp' },
    { key: 'decay', label: 'Decay', type: 'knob', min: 0.05, max: 4, default: 0.8, curve: 'log', unit: 's', group: 'Amp' },
    { key: 'sustain', label: 'Sustain', type: 'knob', min: 0, max: 1, default: 0.0, group: 'Amp' },
    { key: 'release', label: 'Release', type: 'knob', min: 0.02, max: 4, default: 0.4, curve: 'log', unit: 's', group: 'Amp' },
    { key: 'level', label: 'Level', type: 'knob', min: 0, max: 1, default: 0.8, group: 'Amp' },
  ],
  presets: {
    'E-Piano': { ratio: 1, fmIndex: 2.6, modDecay: 0.35, modSustain: 0.12, decay: 1.4, sustain: 0.12, release: 0.5 },
    'Bell': { ratio: 3, fmIndex: 6, modDecay: 1.4, modSustain: 0, decay: 2.8, sustain: 0, release: 1.6, level: 0.6 },
    'FM Pluck': { ratio: 2, fmIndex: 5, modDecay: 0.12, modSustain: 0, decay: 0.5, sustain: 0, release: 0.25 },
    'FM Bass': { ratio: 1, fmIndex: 3.2, modDecay: 0.1, modSustain: 0.15, decay: 0.4, sustain: 0.3, release: 0.12, level: 0.9 },
  },
});
