// Saturator / distortion. Modelled on a classic "drive -> shape -> tilt EQ
// -> mix" channel saturator (the shape of Soundtoys Decapitator / Ableton
// Saturator: pick a clipping curve, dial in drive, tilt the tone, blend
// wet/dry).
//
// Signal flow:
//
//        +-- dryGain (1 - mix) ------------------------------+
//        |                                                    v
//   wetIn +-- driveGain -> WaveShaper(curve, 4x oversample)   sum -> wetOut
//                        -> makeupGain (auto loudness comp)    ^
//                        -> tiltLow (lowshelf) -> tiltHigh     |
//                           (highshelf) -> wetGain (mix) ------+
//
// `wetIn`/`wetOut` are plain GainNodes (per BaseEffect), so two branches
// feeding the same wetOut sum automatically — no extra mixer node needed.
//
// DRIVE is a real-time-safe pre-gain (dB -> linear) feeding the shaper, so
// it can be ramped smoothly on every knob tick without touching the
// WaveShaper curve itself (curve arrays can't be interpolated/automated).
// MAKEUP is `1/sqrt(driveLinear)` so cranking drive doesn't also blow up
// perceived loudness — an auto-compensation trick, not something the user
// controls directly.
//
// CURVE TYPES — transfer function y = f(x), x in [-1, 1], 1024-sample
// lookup table, `WaveShaperNode.oversample = '4x'` on all of them to push
// aliasing from the nonlinearity above the audible band before it folds
// back down:
//
//   soft / tape      y = tanh(1.6 * x)
//                     Smooth, symmetric saturation — the exact shape a
//                     glueing/tape-style saturator uses. No hard knee;
//                     odd harmonics only, gently rolling off toward +-1.
//
//   tube / asymmetric y = x >= 0 ? 1 - e^(-3x)
//                                : -0.82 * (1 - e^(3x))
//                     Two different exponential saturation curves for the
//                     positive and negative halves (0.82 asymmetry
//                     factor) — mimics single-ended tube stages, which
//                     clip the two half-cycles differently and so add
//                     even-order harmonics on top of the odd ones.
//
//   hard clip        y = clamp(x, -T, T) / T,  T = 0.5
//                     Flat-top clipping once |x| exceeds T=0.5 — a brick
//                     wall, maximum harmonic content, classic "fuzz".
//
//   foldback         Recursive triangle-wave folding around +-T (T=0.6):
//                       while |x| > T: x = |((x - T) mod 4T) - 2T| - T
//                     Instead of clamping, the signal reflects back down
//                     every time it crosses the threshold, producing the
//                     inharmonic, ring-mod-like timbre of analog
//                     wavefolders. (Loop is unrolled into the LUT at
//                     build time via one modulo pass, not a real loop.)
//
// TONE (tilt): a single -1..1 knob driving two shelving filters pinned to
// the same +-9 dB range at opposite ends of the spectrum — lowshelf@300Hz
// gain = -tone*9dB, highshelf@3000Hz gain = +tone*9dB. Negative tone tilts
// dark (cuts highs, boosts lows), positive tilts bright, 0 is flat. This
// is the standard "tilt EQ" (single control, complementary shelves).

import { BaseEffect } from './registry.js';
import { defineEffect } from './registry.js';

const RAMP = 0.02;
const CURVE_LEN = 1024;
const TILT_DB = 9;
const TILT_LOW_HZ = 300;
const TILT_HIGH_HZ = 3000;

const CURVE_TYPES = [
  { value: 'soft', label: 'Soft / Tape' },
  { value: 'tube', label: 'Tube (Asym.)' },
  { value: 'hard', label: 'Hard Clip' },
  { value: 'fold', label: 'Foldback' },
];

function foldback(x, threshold) {
  let v = x;
  if (v > threshold || v < -threshold) {
    v = Math.abs(Math.abs((v - threshold) % (threshold * 4)) - threshold * 2) - threshold;
  }
  return v;
}

function makeCurve(type) {
  const curve = new Float32Array(CURVE_LEN);
  for (let i = 0; i < CURVE_LEN; i++) {
    const x = (i / (CURVE_LEN - 1)) * 2 - 1;
    let y;
    switch (type) {
      case 'tube':
        y = x >= 0 ? 1 - Math.exp(-3 * x) : -0.82 * (1 - Math.exp(3 * x));
        break;
      case 'hard': {
        const T = 0.5;
        y = Math.max(-T, Math.min(T, x)) / T;
        break;
      }
      case 'fold':
        y = foldback(x, 0.6);
        break;
      case 'soft':
      default:
        y = Math.tanh(1.6 * x);
        break;
    }
    curve[i] = y;
  }
  return curve;
}

const dbToLinear = (db) => Math.pow(10, db / 20);

class Saturator extends BaseEffect {
  constructor(ctx, params, def) {
    super(ctx, params, def);

    this.mixDry = ctx.createGain(); // internal wet/dry mix (distinct from BaseEffect's bypass dryGain)
    this.driveGain = ctx.createGain();
    this.shaper = ctx.createWaveShaper();
    this.shaper.oversample = '4x';
    this.shaper.curve = makeCurve(params.curveType || 'soft');
    this.makeupGain = ctx.createGain();
    this.tiltLow = ctx.createBiquadFilter();
    this.tiltLow.type = 'lowshelf';
    this.tiltLow.frequency.value = TILT_LOW_HZ;
    this.tiltHigh = ctx.createBiquadFilter();
    this.tiltHigh.type = 'highshelf';
    this.tiltHigh.frequency.value = TILT_HIGH_HZ;
    this.wetGain = ctx.createGain();

    // Dry branch (unprocessed, for the internal mix knob).
    this.wetIn.connect(this.mixDry);
    this.mixDry.connect(this.wetOut);

    // Wet/processed branch.
    this.wetIn.connect(this.driveGain);
    this.driveGain.connect(this.shaper);
    this.shaper.connect(this.makeupGain);
    this.makeupGain.connect(this.tiltLow);
    this.tiltLow.connect(this.tiltHigh);
    this.tiltHigh.connect(this.wetGain);
    this.wetGain.connect(this.wetOut);
  }

  applyParam(key, value) {
    const t = this.ctx.currentTime;
    switch (key) {
      case 'drive': {
        const lin = dbToLinear(value);
        this.driveGain.gain.setTargetAtTime(lin, t, RAMP / 3);
        this.makeupGain.gain.setTargetAtTime(1 / Math.sqrt(lin), t, RAMP / 3);
        break;
      }
      case 'curveType':
        this.shaper.curve = makeCurve(value);
        break;
      case 'tone':
        this.tiltLow.gain.setTargetAtTime(-value * TILT_DB, t, RAMP / 3);
        this.tiltHigh.gain.setTargetAtTime(value * TILT_DB, t, RAMP / 3);
        break;
      case 'mix':
        this.wetGain.gain.setTargetAtTime(value, t, RAMP / 3);
        this.mixDry.gain.setTargetAtTime(1 - value, t, RAMP / 3);
        break;
      default:
        break;
    }
  }
}

defineEffect({
  type: 'saturator',
  label: 'Saturator',
  group: 'distortion',
  klass: Saturator,
  params: [
    { key: 'drive', label: 'Drive', type: 'knob', min: 0, max: 36, default: 6, unit: 'dB', group: 'Drive' },
    { key: 'curveType', label: 'Curve', type: 'select', options: CURVE_TYPES, default: 'soft', group: 'Drive' },
    { key: 'tone', label: 'Tone', type: 'knob', min: -1, max: 1, default: 0, group: 'Tone' },
    { key: 'mix', label: 'Mix', type: 'knob', min: 0, max: 1, default: 1, group: 'Mix' },
  ],
  presets: {
    'Subtle Glue': { drive: 3, curveType: 'soft', tone: 0, mix: 0.35 },
    'Warm Tape': { drive: 10, curveType: 'soft', tone: -0.15, mix: 0.7 },
    'Tube Grit': { drive: 16, curveType: 'tube', tone: 0.1, mix: 0.85 },
    'Hard Fuzz': { drive: 26, curveType: 'hard', tone: 0.2, mix: 1 },
    'Wavefolder Lead': { drive: 14, curveType: 'fold', tone: 0.3, mix: 1 },
  },
});
