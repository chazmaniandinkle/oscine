// 3-band parametric EQ + switchable-slope HP/LP, modelled on the classic
// "channel strip EQ" shape found in Ableton EQ Eight / FabFilter Pro-Q
// (low shelf, sweepable mid peak with Q, high shelf, plus independent
// high-pass and low-pass cutoffs).
//
// Signal flow (all native BiquadFilterNodes, in series):
//
//   wetIn -> HP1 -> HP2(allpass|highpass) -> LowShelf -> Mid(peaking)
//         -> HighShelf -> LP1 -> LP2(allpass|lowpass) -> wetOut
//
// HP/LP slope trick: rather than dynamically rewiring the graph (which the
// effect contract avoids — build once in the constructor, only touch
// AudioParams/type afterwards), each filter stage is a *fixed* 2-pole
// Butterworth (Q = 1/sqrt(2)) section. For "12 dB/oct" the second stage's
// `.type` is set to 'allpass' at the same frequency (flat magnitude, so it
// contributes no additional roll-off but keeps its own phase response in
// the chain). For "24 dB/oct" it's flipped to 'highpass'/'lowpass' so the
// two Butterworth sections cascade into a 4-pole ~24 dB/oct slope. This is
// the standard cheap way DAWs offer a slope switch without rebuilding the
// graph.
//
// Shelf/peaking gain is applied directly via the native BiquadFilterNode
// `.gain` AudioParam, which the Web Audio spec already defines in dB for
// 'lowshelf' | 'highshelf' | 'peaking' — no manual dB<->linear conversion
// needed.

import { BaseEffect } from './registry.js';
import { defineEffect } from './registry.js';

const RAMP = 0.02; // seconds; keeps knob drags click-free (rule: <= 20ms)
const BUTTERWORTH_Q = Math.SQRT1_2; // 0.7071, standard 2-pole Butterworth section

const SLOPE_OPTIONS = [
  { value: 12, label: '12 dB/oct' },
  { value: 24, label: '24 dB/oct' },
];

class ParametricEQ3 extends BaseEffect {
  constructor(ctx, params, def) {
    super(ctx, params, def);

    this.hp1 = ctx.createBiquadFilter();
    this.hp2 = ctx.createBiquadFilter();
    this.low = ctx.createBiquadFilter();
    this.mid = ctx.createBiquadFilter();
    this.high = ctx.createBiquadFilter();
    this.lp1 = ctx.createBiquadFilter();
    this.lp2 = ctx.createBiquadFilter();

    this.hp1.type = 'highpass';
    this.hp2.type = 'highpass'; // flipped to 'allpass' in applyParam for 12dB mode
    this.hp1.Q.value = BUTTERWORTH_Q;
    this.hp2.Q.value = BUTTERWORTH_Q;

    this.low.type = 'lowshelf';
    this.mid.type = 'peaking';
    this.high.type = 'highshelf';

    this.lp1.type = 'lowpass';
    this.lp2.type = 'lowpass'; // flipped to 'allpass' in applyParam for 12dB mode
    this.lp1.Q.value = BUTTERWORTH_Q;
    this.lp2.Q.value = BUTTERWORTH_Q;

    this.wetIn.connect(this.hp1);
    this.hp1.connect(this.hp2);
    this.hp2.connect(this.low);
    this.low.connect(this.mid);
    this.mid.connect(this.high);
    this.high.connect(this.lp1);
    this.lp1.connect(this.lp2);
    this.lp2.connect(this.wetOut);
  }

  applyParam(key, value) {
    const t = this.ctx.currentTime;
    switch (key) {
      case 'hpFreq':
        this.hp1.frequency.setTargetAtTime(value, t, RAMP / 3);
        this.hp2.frequency.setTargetAtTime(value, t, RAMP / 3);
        break;
      case 'hpSlope':
        this.hp2.type = Number(value) >= 24 ? 'highpass' : 'allpass';
        break;
      case 'lowFreq':
        this.low.frequency.setTargetAtTime(value, t, RAMP / 3);
        break;
      case 'lowGain':
        this.low.gain.setTargetAtTime(value, t, RAMP / 3);
        break;
      case 'midFreq':
        this.mid.frequency.setTargetAtTime(value, t, RAMP / 3);
        break;
      case 'midGain':
        this.mid.gain.setTargetAtTime(value, t, RAMP / 3);
        break;
      case 'midQ':
        this.mid.Q.setTargetAtTime(value, t, RAMP / 3);
        break;
      case 'highFreq':
        this.high.frequency.setTargetAtTime(value, t, RAMP / 3);
        break;
      case 'highGain':
        this.high.gain.setTargetAtTime(value, t, RAMP / 3);
        break;
      case 'lpFreq':
        this.lp1.frequency.setTargetAtTime(value, t, RAMP / 3);
        this.lp2.frequency.setTargetAtTime(value, t, RAMP / 3);
        break;
      case 'lpSlope':
        this.lp2.type = Number(value) >= 24 ? 'lowpass' : 'allpass';
        break;
      default:
        break;
    }
  }

  // Automation fast path (see BaseEffect.paramNode): each shelf/peaking
  // filter's frequency/gain and the mid band's Q are backed by real
  // BiquadFilterNode AudioParams, so an envelope can be scheduled directly
  // onto them instead of polling through applyParam(). hp/lp frequency
  // automates hp1/lp1 only -- hp2/lp2 (the slope-toggle stage) are kept in
  // sync via a chained AudioParam link would be ideal, but Web Audio has no
  // "follow this param" primitive; for automation purposes hp1/lp1 alone
  // gives the audible sweep (hp2/lp2 stay at their last applyParam() value,
  // acceptable since both stages share the same Butterworth corner). Select
  // params (hpSlope, lpSlope) have no AudioParam and are not covered.
  paramNode(key) {
    switch (key) {
      case 'hpFreq': return this.hp1.frequency;
      case 'lowFreq': return this.low.frequency;
      case 'lowGain': return this.low.gain;
      case 'midFreq': return this.mid.frequency;
      case 'midGain': return this.mid.gain;
      case 'midQ': return this.mid.Q;
      case 'highFreq': return this.high.frequency;
      case 'highGain': return this.high.gain;
      case 'lpFreq': return this.lp1.frequency;
      default: return null;
    }
  }
}

defineEffect({
  type: 'eq3',
  label: 'EQ (3-band)',
  group: 'eq',
  klass: ParametricEQ3,
  params: [
    { key: 'hpFreq', label: 'HP Freq', type: 'knob', min: 20, max: 2000, default: 20, curve: 'log', unit: 'Hz', group: 'High-pass' },
    { key: 'hpSlope', label: 'HP Slope', type: 'select', options: SLOPE_OPTIONS, default: 12, group: 'High-pass' },
    { key: 'lowFreq', label: 'Freq', type: 'knob', min: 20, max: 1000, default: 120, curve: 'log', unit: 'Hz', group: 'Low Shelf' },
    { key: 'lowGain', label: 'Gain', type: 'knob', min: -18, max: 18, default: 0, unit: 'dB', group: 'Low Shelf' },
    { key: 'midFreq', label: 'Freq', type: 'knob', min: 100, max: 8000, default: 1000, curve: 'log', unit: 'Hz', group: 'Mid' },
    { key: 'midGain', label: 'Gain', type: 'knob', min: -18, max: 18, default: 0, unit: 'dB', group: 'Mid' },
    { key: 'midQ', label: 'Q', type: 'knob', min: 0.1, max: 10, default: 1, group: 'Mid' },
    { key: 'highFreq', label: 'Freq', type: 'knob', min: 1000, max: 20000, default: 8000, curve: 'log', unit: 'Hz', group: 'High Shelf' },
    { key: 'highGain', label: 'Gain', type: 'knob', min: -18, max: 18, default: 0, unit: 'dB', group: 'High Shelf' },
    { key: 'lpFreq', label: 'LP Freq', type: 'knob', min: 1000, max: 20000, default: 20000, curve: 'log', unit: 'Hz', group: 'Low-pass' },
    { key: 'lpSlope', label: 'LP Slope', type: 'select', options: SLOPE_OPTIONS, default: 12, group: 'Low-pass' },
  ],
  presets: {
    'Flat': {},
    'Telephone': {
      hpFreq: 350, hpSlope: 24, lowFreq: 200, lowGain: -6,
      midFreq: 1800, midGain: 5, midQ: 1.4,
      highFreq: 3400, highGain: -8, lpFreq: 3400, lpSlope: 24,
    },
    'Air & Warmth': {
      lowFreq: 150, lowGain: 3, midFreq: 900, midGain: -1.5, midQ: 0.8,
      highFreq: 9500, highGain: 4,
    },
    'De-mud': {
      hpFreq: 60, midFreq: 320, midGain: -4.5, midQ: 1.8,
    },
    'Vocal Presence': {
      hpFreq: 100, lowGain: -1, midFreq: 3200, midGain: 4, midQ: 1.1,
      highFreq: 10000, highGain: 2,
    },
  },
});
