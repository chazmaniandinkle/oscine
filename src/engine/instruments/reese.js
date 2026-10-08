// Reese: the DnB bass. Designed by ear (2026-10-08) after the poly synth
// couldn't make one: a clean sine SUB oscillator that never goes through the
// filter or the drive (so the low end stays mono, steady and phase-locked to
// the note), plus a TOP layer of detuned saws -> 24 dB lowpass (two biquads)
// -> waveshaper drive -> high-pass that removes the top's own lows so it never
// fights the sub. Slow detune drift between the saws is what makes a reese
// "move"; a filter LFO adds the wobble. Mono by design (voices = 1, glide).

import { BaseInstrument } from './base.js';
import { defineInstrument } from './registry.js';
import { midiToFreq } from '../../core/util.js';

function driveCurve(amount) {
  const n = 2048, c = new Float32Array(n), k = 1 + amount * 30;
  for (let i = 0; i < n; i++) { const x = i * 2 / n - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); }
  return c;
}

class Reese extends BaseInstrument {
  constructor(ctx, params, def) {
    super(ctx, params, def);
    this.voice = null;
    this.lastFreq = null;
    this.lfo = ctx.createOscillator(); this.lfo.type = 'sine';
    this.lfo.frequency.value = this.params.wobbleRate;
    this.lfoDepth = ctx.createGain(); this.lfoDepth.gain.value = this.params.wobble * 2500;
    this.lfo.connect(this.lfoDepth); this.lfo.start();
    this.shaper = ctx.createWaveShaper(); this.shaper.curve = driveCurve(this.params.drive); this.shaper.oversample = '4x';
    this.topHp = ctx.createBiquadFilter(); this.topHp.type = 'highpass'; this.topHp.frequency.value = this.params.splitHz; this.topHp.Q.value = 0.6;
    this.topGain = ctx.createGain(); this.topGain.gain.value = this.params.top;
    this.subGain = ctx.createGain(); this.subGain.gain.value = this.params.sub;
    this.shaper.connect(this.topHp).connect(this.topGain).connect(this.output);
    this.subGain.connect(this.output);
  }

  onParam(key) {
    const t = this.ctx.currentTime, p = this.params;
    if (key === 'drive') this.shaper.curve = driveCurve(p.drive);
    if (key === 'wobble') this.lfoDepth.gain.setTargetAtTime(p.wobble * 2500, t, 0.02);
    if (key === 'wobbleRate') this.lfo.frequency.setTargetAtTime(p.wobbleRate, t, 0.02);
    if (key === 'top') this.topGain.gain.setTargetAtTime(p.top, t, 0.02);
    if (key === 'sub') this.subGain.gain.setTargetAtTime(p.sub, t, 0.02);
    if (key === 'splitHz') this.topHp.frequency.setTargetAtTime(p.splitHz, t, 0.02);
  }

  noteOn(time, midi, vel = 0.9, durSec = null) {
    const ctx = this.ctx, p = this.params;
    const f = midiToFreq(midi);
    const legato = this.voice && !this.voice.released && p.glide > 0.001;
    if (this.voice && !legato) this.release(this.voice, time, 0.006);
    if (legato) {
      const v = this.voice;
      for (const o of v.oscs) { o.frequency.cancelScheduledValues(time); o.frequency.setTargetAtTime(f * o._mul, time, p.glide / 3); }
      v.sub.frequency.cancelScheduledValues(time); v.sub.frequency.setTargetAtTime(f / (p.subOct ? 2 : 1), time, p.glide / 3);
      v.endsAt = null; if (v.stopTimer) v.stopTimer = null;
      if (durSec !== null) this.release(v, time + durSec);
      return;
    }
    const n = Math.round(p.saws);
    const oscs = [];
    const mix = ctx.createGain(); mix.gain.value = 0.9 / Math.sqrt(n);
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      const spread = n === 1 ? 0 : (i / (n - 1) - 0.5) * 2;           // -1..1
      o._mul = Math.pow(2, (spread * p.detune) / 1200);
      o.frequency.setValueAtTime(f * o._mul, time);
      // independent slow drift per saw: the "movement"
      const dr = ctx.createOscillator(); dr.frequency.value = 0.07 + i * 0.053;
      const dg = ctx.createGain(); dg.gain.value = p.detune * 0.35;
      dr.connect(dg).connect(o.detune); dr.start(time); o._drift = dr;
      o.connect(mix); oscs.push(o);
    }
    const lp1 = ctx.createBiquadFilter(), lp2 = ctx.createBiquadFilter();
    for (const lp of [lp1, lp2]) { lp.type = 'lowpass'; lp.Q.value = p.resonance / 2 + 0.5; }
    const base = p.cutoff, peak = Math.min(16000, base + p.envAmt * 6000 * vel);
    for (const lp of [lp1, lp2]) {
      lp.frequency.setValueAtTime(base, time);
      lp.frequency.setTargetAtTime(peak, time, 0.003);
      lp.frequency.setTargetAtTime(base, time + 0.01, p.envDecay / 3);
      this.lfoDepth.connect(lp.frequency);
    }
    const vca = ctx.createGain(); vca.gain.setValueAtTime(0, time);
    vca.gain.setTargetAtTime(vel, time, 0.002);
    mix.connect(lp1).connect(lp2).connect(vca).connect(this.shaper);

    const sub = ctx.createOscillator(); sub.type = 'sine';
    sub.frequency.setValueAtTime(f / (p.subOct ? 2 : 1), time);
    const sv = ctx.createGain(); sv.gain.setValueAtTime(0, time); sv.gain.setTargetAtTime(vel, time, 0.003);
    sub.connect(sv).connect(this.subGain);

    for (const o of oscs) o.start(time);
    sub.start(time);
    const v = { oscs, sub, vca, sv, lps: [lp1, lp2], released: false, endsAt: null };
    this.voice = v; this.lastFreq = f;
    if (durSec !== null) this.release(v, time + Math.max(0.02, durSec));
  }

  release(v, time, r = null) {
    if (v.released && v.endsAt !== null && v.endsAt <= time) return;
    v.released = true;
    const rel = r ?? Math.max(0.01, this.params.release);
    v.vca.gain.setTargetAtTime(0, time, rel / 3);
    v.sv.gain.setTargetAtTime(0, time, rel / 3);
    const stop = time + rel * 4 + 0.05;
    for (const o of v.oscs) { try { o.stop(stop); o._drift.stop(stop); } catch { /* ok */ } }
    try { v.sub.stop(stop); } catch { /* ok */ }
    v.endsAt = stop;
    v.oscs[0].onended = () => { for (const lp of v.lps) { try { this.lfoDepth.disconnect(lp.frequency); } catch { /* ok */ } } try { v.vca.disconnect(); v.sv.disconnect(); } catch { /* ok */ } };
  }

  noteOff() { if (this.voice) this.release(this.voice, this.ctx.currentTime); }
  allOff() { if (this.voice) this.release(this.voice, this.ctx.currentTime, 0.02); }
  dispose() { super.dispose(); try { this.lfo.stop(); } catch { /* ok */ } }
}

defineInstrument({
  type: 'reese',
  label: 'Reese Bass',
  kind: 'synth',
  klass: Reese,
  params: [
    { key: 'saws', label: 'Saws', type: 'knob', min: 1, max: 7, step: 1, default: 4, group: 'Top' },
    { key: 'detune', label: 'Detune', type: 'knob', min: 0, max: 60, default: 22, unit: 'ct', group: 'Top' },
    { key: 'cutoff', label: 'Cutoff', type: 'knob', min: 60, max: 8000, default: 1100, curve: 'log', unit: 'Hz', group: 'Top' },
    { key: 'resonance', label: 'Res', type: 'knob', min: 0, max: 12, default: 2, group: 'Top' },
    { key: 'envAmt', label: 'Env Amt', type: 'knob', min: 0, max: 1, default: 0.25, group: 'Top' },
    { key: 'envDecay', label: 'Env Dec', type: 'knob', min: 0.02, max: 2, default: 0.25, curve: 'log', unit: 's', group: 'Top' },
    { key: 'drive', label: 'Drive', type: 'knob', min: 0, max: 1, default: 0.5, group: 'Top' },
    { key: 'wobble', label: 'Wobble', type: 'knob', min: 0, max: 1, default: 0.15, group: 'Top' },
    { key: 'wobbleRate', label: 'Wob Rate', type: 'knob', min: 0.05, max: 16, default: 0.5, curve: 'log', unit: 'Hz', group: 'Top' },
    { key: 'splitHz', label: 'Split', type: 'knob', min: 60, max: 400, default: 140, curve: 'log', unit: 'Hz', group: 'Mix' },
    { key: 'top', label: 'Top', type: 'knob', min: 0, max: 1.5, default: 0.7, group: 'Mix' },
    { key: 'sub', label: 'Sub', type: 'knob', min: 0, max: 1.5, default: 0.8, group: 'Mix' },
    { key: 'subOct', label: 'Sub -1 oct', type: 'select', options: [{ value: 0, label: 'Off' }, { value: 1, label: 'On' }], default: 0, group: 'Mix' },
    { key: 'glide', label: 'Glide', type: 'knob', min: 0, max: 0.4, default: 0.04, unit: 's', group: 'Voice' },
    { key: 'release', label: 'Release', type: 'knob', min: 0.01, max: 2, default: 0.08, curve: 'log', unit: 's', group: 'Voice' },
    { key: 'level', label: 'Level', type: 'knob', min: 0, max: 1, default: 0.8, group: 'Voice' },
  ],
  presets: {
    'Rolling Reese': { saws: 4, detune: 22, cutoff: 1100, resonance: 2, drive: 0.5, wobble: 0.12, wobbleRate: 0.5, top: 0.7, sub: 0.8 },
    'Neuro Growl': { saws: 6, detune: 35, cutoff: 1600, resonance: 6, envAmt: 0.5, envDecay: 0.18, drive: 0.75, wobble: 0.45, wobbleRate: 2.9, top: 0.9, sub: 0.7 },
    'Clean Sub': { saws: 1, detune: 0, cutoff: 200, top: 0, sub: 1, drive: 0, wobble: 0 },
    'Liquid Round': { saws: 3, detune: 12, cutoff: 420, resonance: 1, drive: 0.15, wobble: 0.05, top: 0.45, sub: 0.9 },
  },
});
