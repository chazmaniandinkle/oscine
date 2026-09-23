// Resonant multimode filter with an optional LFO for auto-wah / filter
// sweeps. Modelled on the classic synth "VCF" module (e.g. the filter
// section of Moog/TAL-style plugins, or Ableton Auto Filter's mode+LFO
// combo).
//
// Signal flow:
//
//                         +-- lfo (Oscillator, one of 4 shapes)
//                         |     -> lfoDepth (Gain, Hz swing)
//                         |     -> filter.frequency (AudioParam)
//                         v
//   wetIn -> BiquadFilter (type: lowpass|highpass|bandpass|notch) -> wetOut
//
// The LFO is a single always-running OscillatorNode -> Gain (depth, scaled
// to Hz) -> filter.frequency. Depth 0 = no audible modulation (matches the
// "optional" requirement) without ever stopping/restarting the oscillator
// (avoids click/pop from re-starts and keeps construction side-effect-free
// on an OfflineAudioContext, which still requires .start()).
//
// Cutoff uses a log curve (param `curve: 'log'`) since filter cutoff is
// perceived logarithmically (matches the poly synth's cutoff knob). The
// resonance knob maps directly to BiquadFilterNode.Q (higher Q = sharper
// resonant peak at cutoff; self-oscillation territory above ~15-20 for LP).

import { BaseEffect } from './registry.js';
import { defineEffect } from './registry.js';

const RAMP = 0.02;

const FILTER_TYPES = [
  { value: 'lowpass', label: 'Low-pass' },
  { value: 'highpass', label: 'High-pass' },
  { value: 'bandpass', label: 'Band-pass' },
  { value: 'notch', label: 'Notch' },
];

const LFO_SHAPES = [
  { value: 'sine', label: 'Sine' },
  { value: 'triangle', label: 'Triangle' },
  { value: 'sawtooth', label: 'Saw' },
  { value: 'square', label: 'Square' },
];

class ResonantFilter extends BaseEffect {
  constructor(ctx, params, def) {
    super(ctx, params, def);

    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';

    this.lfo = ctx.createOscillator();
    this.lfo.type = 'sine';
    this.lfo.frequency.value = params.lfoRate ?? 2;
    this.lfoDepth = ctx.createGain();
    this.lfoDepth.gain.value = 0; // depth applied in applyParam
    this.lfo.connect(this.lfoDepth);
    this.lfoDepth.connect(this.filter.frequency);
    this.lfo.start();

    this.wetIn.connect(this.filter);
    this.filter.connect(this.wetOut);
  }

  applyParam(key, value) {
    const t = this.ctx.currentTime;
    switch (key) {
      case 'filterType':
        this.filter.type = value;
        break;
      case 'cutoff':
        this.filter.frequency.setTargetAtTime(value, t, RAMP / 3);
        break;
      case 'resonance':
        this.filter.Q.setTargetAtTime(value, t, RAMP / 3);
        break;
      case 'lfoRate':
        this.lfo.frequency.setTargetAtTime(value, t, RAMP / 3);
        break;
      case 'lfoShape':
        this.lfo.type = value;
        break;
      case 'lfoDepth': {
        // depth is 0..1 knob -> scaled to Hz of frequency swing, capped
        // so it can't push cutoff far negative (BiquadFilter clamps
        // internally, but keep the modulation musically sane).
        const hz = value * 6000;
        this.lfoDepth.gain.setTargetAtTime(hz, t, RAMP / 3);
        break;
      }
      default:
        break;
    }
  }

  dispose() {
    super.dispose();
    try { this.lfo.stop(); } catch { /* already stopped */ }
  }
}

defineEffect({
  type: 'resofilter',
  label: 'Resonant Filter',
  group: 'eq',
  klass: ResonantFilter,
  params: [
    { key: 'filterType', label: 'Type', type: 'select', options: FILTER_TYPES, default: 'lowpass', group: 'Filter' },
    { key: 'cutoff', label: 'Cutoff', type: 'knob', min: 40, max: 18000, default: 2000, curve: 'log', unit: 'Hz', group: 'Filter' },
    { key: 'resonance', label: 'Resonance', type: 'knob', min: 0.1, max: 24, default: 1, group: 'Filter' },
    { key: 'lfoShape', label: 'Shape', type: 'select', options: LFO_SHAPES, default: 'sine', group: 'LFO' },
    { key: 'lfoRate', label: 'Rate', type: 'knob', min: 0.02, max: 20, default: 2, curve: 'log', unit: 'Hz', group: 'LFO' },
    { key: 'lfoDepth', label: 'Depth', type: 'knob', min: 0, max: 1, default: 0, group: 'LFO' },
  ],
  presets: {
    'Static Lowpass': {},
    'Auto-Wah': {
      filterType: 'bandpass', cutoff: 900, resonance: 6,
      lfoShape: 'sine', lfoRate: 3.5, lfoDepth: 0.55,
    },
    'Slow Sweep': {
      filterType: 'lowpass', cutoff: 1200, resonance: 8,
      lfoShape: 'triangle', lfoRate: 0.15, lfoDepth: 0.8,
    },
    'Talking Notch': {
      filterType: 'notch', cutoff: 1500, resonance: 4,
      lfoShape: 'sine', lfoRate: 5, lfoDepth: 0.4,
    },
    'Acid Squelch': {
      filterType: 'lowpass', cutoff: 500, resonance: 16,
      lfoShape: 'square', lfoRate: 0.5, lfoDepth: 0.35,
    },
  },
});
