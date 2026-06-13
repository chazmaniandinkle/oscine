// Subtractive polyphonic synth: 2 oscillators -> lowpass filter (with its
// own attack/decay envelope) -> VCA (ADSR). One shared LFO routable to
// pitch or filter. Set voices=1 + glide for mono bass/lead behavior.

import { BaseInstrument } from './base.js';
import { defineInstrument } from './registry.js';
import { midiToFreq, clamp } from '../../core/util.js';

const WAVES = [
  { value: 'sawtooth', label: 'Saw' },
  { value: 'square', label: 'Square' },
  { value: 'triangle', label: 'Tri' },
  { value: 'sine', label: 'Sine' },
];

class PolySynth extends BaseInstrument {
  constructor(ctx, params, def) {
    super(ctx, params, def);
    this.voices = [];        // every sounding voice
    this.held = new Map();   // midi -> voice (live-played, no scheduled end)
    this.lastFreq = null;    // for glide

    // Shared LFO. Voices connect their modulation targets on allocation.
    this.lfo = ctx.createOscillator();
    this.lfo.type = 'triangle';
    this.lfo.frequency.value = this.params.lfoRate;
    this.lfoPitch = ctx.createGain();   // -> osc.detune (cents)
    this.lfoFilter = ctx.createGain();  // -> filter.frequency (Hz)
    this.lfo.connect(this.lfoPitch);
    this.lfo.connect(this.lfoFilter);
    this.lfo.start();
    this.applyLfoDepth();
  }

  applyLfoDepth() {
    const t = this.ctx.currentTime;
    const amt = this.params.lfoAmt;
    const dest = this.params.lfoDest;
    this.lfoPitch.gain.setTargetAtTime(dest === 'pitch' ? amt * 60 : 0, t, 0.02);
    this.lfoFilter.gain.setTargetAtTime(dest === 'filter' ? amt * 4500 : 0, t, 0.02);
  }

  onParam(key) {
    if (key === 'lfoRate') {
      this.lfo.frequency.setTargetAtTime(this.params.lfoRate, this.ctx.currentTime, 0.02);
    } else if (key === 'lfoAmt' || key === 'lfoDest') {
      this.applyLfoDepth();
    } else if (key === 'cutoff' || key === 'resonance') {
      // Live-update filters of sounding voices (post-envelope base value).
      const t = this.ctx.currentTime;
      for (const v of this.voices) {
        if (key === 'resonance') v.filter.Q.setTargetAtTime(this.params.resonance, t, 0.02);
        else v.filter.frequency.setTargetAtTime(this.params.cutoff, t, 0.05);
      }
    }
  }

  pruneVoices() {
    const now = this.ctx.currentTime;
    this.voices = this.voices.filter(v => {
      if (v.endsAt !== null && v.endsAt < now) { v.cleanup(); return false; }
      return true;
    });
  }

  stealIfNeeded(time) {
    const max = Math.round(this.params.voices);
    if (this.voices.length < max) return;
    // Steal the voice that started earliest.
    let oldest = this.voices[0];
    for (const v of this.voices) if (v.startedAt < oldest.startedAt) oldest = v;
    this.releaseVoice(oldest, Math.max(time - 0.005, this.ctx.currentTime), 0.02);
  }

  buildVoice(time, midi, vel) {
    const ctx = this.ctx;
    const p = this.params;
    const freq = midiToFreq(midi);

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc1.type = p.osc1Wave;
    osc2.type = p.osc2Wave;
    const f2 = midiToFreq(midi + Math.round(p.osc2Semi));
    osc2.detune.setValueAtTime(p.detune, time);

    // Glide (meaningful in mono mode, harmless otherwise).
    if (p.glide > 0.001 && this.lastFreq && Math.round(p.voices) === 1) {
      osc1.frequency.setValueAtTime(this.lastFreq, time);
      osc1.frequency.setTargetAtTime(freq, time, p.glide / 3);
      const ratio = f2 / freq;
      osc2.frequency.setValueAtTime(this.lastFreq * ratio, time);
      osc2.frequency.setTargetAtTime(f2, time, p.glide / 3);
    } else {
      osc1.frequency.setValueAtTime(freq, time);
      osc2.frequency.setValueAtTime(f2, time);
    }
    this.lastFreq = freq;

    const g1 = ctx.createGain();
    const g2 = ctx.createGain();
    g1.gain.value = Math.cos(p.oscMix * Math.PI / 2) * 0.5;
    g2.gain.value = Math.sin(p.oscMix * Math.PI / 2) * 0.5;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = p.resonance;
    // Filter envelope: snap up to peak, decay back to base cutoff.
    const base = p.cutoff;
    const peak = clamp(base + p.fEnvAmt * vel * 9000, base, 16000);
    filter.frequency.setValueAtTime(Math.max(base, 30), time);
    filter.frequency.setTargetAtTime(peak, time, 0.004);
    filter.frequency.setTargetAtTime(base, time + 0.012, Math.max(p.fDecay, 0.01) / 3);

    const vca = ctx.createGain();
    vca.gain.value = 0;
    const peakGain = clamp(vel, 0.02, 1);
    const a = Math.max(p.attack, 0.002);
    vca.gain.setTargetAtTime(peakGain, time, a / 3);
    vca.gain.setTargetAtTime(p.sustain * peakGain, time + a, Math.max(p.decay, 0.01) / 3);

    osc1.connect(g1).connect(filter);
    osc2.connect(g2).connect(filter);
    filter.connect(vca).connect(this.output);

    // LFO routing.
    this.lfoPitch.connect(osc1.detune);
    this.lfoPitch.connect(osc2.detune);
    this.lfoFilter.connect(filter.frequency);

    osc1.start(time);
    osc2.start(time);

    const voice = {
      midi, filter, vca, osc1, osc2,
      startedAt: time,
      endsAt: null,
      released: false,
      cleanup: () => {
        try { this.lfoPitch.disconnect(osc1.detune); } catch { /* ok */ }
        try { this.lfoPitch.disconnect(osc2.detune); } catch { /* ok */ }
        try { this.lfoFilter.disconnect(filter.frequency); } catch { /* ok */ }
        try { vca.disconnect(); } catch { /* ok */ }
      },
    };
    osc1.onended = () => voice.cleanup();
    return voice;
  }

  releaseVoice(voice, time, releaseOverride = null) {
    if (voice.released) return;
    voice.released = true;
    const r = releaseOverride ?? Math.max(this.params.release, 0.015);
    voice.vca.gain.setTargetAtTime(0, time, r / 3);
    const stopAt = time + r * 3 + 0.08;
    try { voice.osc1.stop(stopAt); voice.osc2.stop(stopAt); } catch { /* already stopped */ }
    voice.endsAt = stopAt;
  }

  noteOn(time, midi, vel = 0.9, durSec = null) {
    this.pruneVoices();
    this.stealIfNeeded(time);
    // Retrigger over an already-held key: release the old voice.
    if (durSec === null && this.held.has(midi)) this.noteOff(midi);

    const voice = this.buildVoice(time, midi, vel);
    this.voices.push(voice);

    if (durSec !== null) {
      this.releaseVoice(voice, time + Math.max(durSec, 0.02));
    } else {
      this.held.set(midi, voice);
    }
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

  dispose() {
    super.dispose();
    try { this.lfo.stop(); } catch { /* ok */ }
  }
}

defineInstrument({
  type: 'poly',
  label: 'Poly Synth',
  kind: 'synth',
  klass: PolySynth,
  params: [
    { key: 'osc1Wave', label: 'Osc 1', type: 'select', options: WAVES, default: 'sawtooth', group: 'Oscillators' },
    { key: 'osc2Wave', label: 'Osc 2', type: 'select', options: WAVES, default: 'square', group: 'Oscillators' },
    { key: 'osc2Semi', label: 'Semi', type: 'knob', min: -24, max: 24, step: 1, default: -12, group: 'Oscillators' },
    { key: 'detune', label: 'Detune', type: 'knob', min: 0, max: 50, default: 10, unit: 'ct', group: 'Oscillators' },
    { key: 'oscMix', label: 'Mix', type: 'knob', min: 0, max: 1, default: 0.5, group: 'Oscillators' },
    { key: 'cutoff', label: 'Cutoff', type: 'knob', min: 60, max: 14000, default: 2400, curve: 'log', unit: 'Hz', group: 'Filter' },
    { key: 'resonance', label: 'Res', type: 'knob', min: 0, max: 24, default: 1.5, group: 'Filter' },
    { key: 'fEnvAmt', label: 'Env Amt', type: 'knob', min: 0, max: 1, default: 0.5, group: 'Filter' },
    { key: 'fDecay', label: 'Env Dec', type: 'knob', min: 0.02, max: 2, default: 0.35, curve: 'log', unit: 's', group: 'Filter' },
    { key: 'attack', label: 'Attack', type: 'knob', min: 0.001, max: 2, default: 0.005, curve: 'log', unit: 's', group: 'Amp' },
    { key: 'decay', label: 'Decay', type: 'knob', min: 0.01, max: 3, default: 0.25, curve: 'log', unit: 's', group: 'Amp' },
    { key: 'sustain', label: 'Sustain', type: 'knob', min: 0, max: 1, default: 0.6, group: 'Amp' },
    { key: 'release', label: 'Release', type: 'knob', min: 0.01, max: 4, default: 0.3, curve: 'log', unit: 's', group: 'Amp' },
    { key: 'lfoRate', label: 'Rate', type: 'knob', min: 0.05, max: 20, default: 5, curve: 'log', unit: 'Hz', group: 'LFO' },
    { key: 'lfoAmt', label: 'Amount', type: 'knob', min: 0, max: 1, default: 0, group: 'LFO' },
    { key: 'lfoDest', label: 'Dest', type: 'select', options: [
      { value: 'off', label: 'Off' }, { value: 'pitch', label: 'Pitch' }, { value: 'filter', label: 'Filter' },
    ], default: 'off', group: 'LFO' },
    { key: 'glide', label: 'Glide', type: 'knob', min: 0, max: 0.4, default: 0, unit: 's', group: 'Voice' },
    { key: 'voices', label: 'Voices', type: 'knob', min: 1, max: 16, step: 1, default: 8, group: 'Voice' },
    { key: 'level', label: 'Level', type: 'knob', min: 0, max: 1, default: 0.8, group: 'Voice' },
  ],
  presets: {
    'Velvet Pad': {
      osc1Wave: 'sawtooth', osc2Wave: 'sawtooth', osc2Semi: 0, detune: 14, oscMix: 0.5,
      cutoff: 1100, resonance: 0.8, fEnvAmt: 0.18, fDecay: 1.2,
      attack: 0.6, decay: 1.2, sustain: 0.8, release: 1.6,
      lfoRate: 0.4, lfoAmt: 0.25, lfoDest: 'filter', level: 0.7,
    },
    'Pluck': {
      osc2Semi: 0, detune: 6, oscMix: 0.3,
      cutoff: 700, resonance: 3, fEnvAmt: 0.85, fDecay: 0.18,
      attack: 0.001, decay: 0.3, sustain: 0, release: 0.25, level: 0.85,
    },
    'Acid Bass': {
      osc1Wave: 'sawtooth', osc2Wave: 'square', osc2Semi: 0, detune: 0, oscMix: 0.15,
      cutoff: 420, resonance: 11, fEnvAmt: 0.6, fDecay: 0.16,
      attack: 0.002, decay: 0.18, sustain: 0.25, release: 0.12,
      glide: 0.055, voices: 1, level: 0.85,
    },
    'Soft Keys': {
      osc1Wave: 'triangle', osc2Wave: 'sine', osc2Semi: 12, detune: 4, oscMix: 0.35,
      cutoff: 3200, resonance: 0.5, fEnvAmt: 0.3, fDecay: 0.5,
      attack: 0.004, decay: 0.9, sustain: 0.4, release: 0.5, level: 0.8,
    },
    'Saw Lead': {
      osc1Wave: 'sawtooth', osc2Wave: 'sawtooth', osc2Semi: 0, detune: 18, oscMix: 0.5,
      cutoff: 5200, resonance: 2, fEnvAmt: 0.4, fDecay: 0.4,
      attack: 0.01, decay: 0.3, sustain: 0.7, release: 0.2,
      glide: 0.04, voices: 1, level: 0.75,
    },
  },
});
