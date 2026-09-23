// Limiter: a hard-set DynamicsCompressorNode (ratio 20:1, 0 knee, ~1ms
// attack) feeding a WaveShaper hard-ceiling curve. Modelled on a simple
// mastering "brickwall" limiter (think the bones of Logic's Adaptive
// Limiter / Ableton Limiter in its simplest mode) — catch the bulk of
// the transient with a fast compressor, then clamp anything that still
// slips through with a hard-clip safety net.
//
// Signal flow:
//
//   wetIn -> inputGain (dB->linear) -> DynamicsCompressorNode
//         (ratio=20, knee=0, attack~1ms, release=param)
//         -> WaveShaper (hard-ceiling curve at +-10^(ceiling/20))
//         -> wetOut
//
// WHY A COMPRESSOR *AND* A WAVESHAPER: DynamicsCompressorNode alone is a
// smooth (soft-kneed even at knee=0, because its internal detector has
// its own attack/release smoothing) gain-reduction stage — it will
// still let occasional peaks poke a little over the target ceiling
// between detector updates. Cascading a WaveShaper with a flat-topped
// clamp curve after it guarantees the sample-accurate output never
// exceeds `ceiling` dB, at the cost of harder distortion on whatever
// peaks do arrive that hot. This is a real, common cheap-limiter recipe
// (fast compressor for the "musical" gain reduction + brickwall clip as
// the last-resort safety net) but it is NOT true-peak limiting: the
// WaveShaper operates on discrete samples, so inter-sample peaks
// (e.g. from reconstruction filters on D/A or lossy encoders) can still
// exceed `ceiling` after the fact. Document this clearly in the UI copy
// if surfaced: "brickwall-ish, not true-peak".
//
// CEILING CURVE: a 4096-point WaveShaper lookup table y = clamp(x, -c, c)
// where c = 10^(ceiling/20) (dB -> linear). 4096 points gives a smooth
// enough clamp that the flat region doesn't introduce extra quantization
// artifacts versus a coarser table. Rebuilt whenever `ceiling` changes
// (WaveShaper curve arrays can't be automated/interpolated, same
// constraint as saturator.js's curve types).
//
// INPUT GAIN: pre-limiter trim (dB) so the user can drive the limiter
// harder without touching the ceiling — the classic "gain into the
// brickwall" limiter workflow.

import { BaseEffect } from './registry.js';
import { defineEffect } from './registry.js';

const RAMP = 0.02; // seconds; keeps knob drags click-free (rule: <= 20ms)
const CURVE_LEN = 4096;
const LIMITER_KNEE = 0;
const LIMITER_RATIO = 20;
const LIMITER_ATTACK_S = 0.001; // ~1ms

const dbToLinear = (db) => Math.pow(10, db / 20);

function makeCeilingCurve(ceilingDb) {
  const c = dbToLinear(ceilingDb);
  const curve = new Float32Array(CURVE_LEN);
  for (let i = 0; i < CURVE_LEN; i++) {
    const x = (i / (CURVE_LEN - 1)) * 2 - 1;
    curve[i] = Math.max(-c, Math.min(c, x));
  }
  return curve;
}

class Limiter extends BaseEffect {
  constructor(ctx, params, def) {
    super(ctx, params, def);

    this.inputGain = ctx.createGain();
    this.comp = ctx.createDynamicsCompressor();
    this.comp.knee.value = LIMITER_KNEE;
    this.comp.ratio.value = LIMITER_RATIO;
    this.comp.attack.value = LIMITER_ATTACK_S;
    this.shaper = ctx.createWaveShaper();
    this.shaper.oversample = '4x';
    this.shaper.curve = makeCeilingCurve(params.ceiling ?? 0);

    this.wetIn.connect(this.inputGain);
    this.inputGain.connect(this.comp);
    this.comp.connect(this.shaper);
    this.shaper.connect(this.wetOut);

    this.applyAll();
  }

  applyParam(key, value) {
    const t = this.ctx.currentTime;
    switch (key) {
      case 'inputDb':
        this.inputGain.gain.setTargetAtTime(dbToLinear(value), t, RAMP / 3);
        break;
      case 'ceiling':
        this.comp.threshold.setTargetAtTime(value, t, RAMP / 3);
        this.shaper.curve = makeCeilingCurve(value);
        break;
      case 'release':
        this.comp.release.setTargetAtTime(value / 1000, t, RAMP / 3); // ms -> s
        break;
      default:
        break;
    }
  }

  // Live gain-reduction readout in dB (<=0), for a future meter widget.
  getReductionDb() { return this.comp.reduction; }
}

defineEffect({
  type: 'limiter',
  label: 'Limiter',
  group: 'dynamics',
  klass: Limiter,
  params: [
    { key: 'inputDb', label: 'Input', type: 'knob', min: 0, max: 24, default: 0, unit: 'dB', group: 'Drive' },
    { key: 'ceiling', label: 'Ceiling', type: 'knob', min: -12, max: 0, default: -0.3, unit: 'dB', group: 'Output' },
    { key: 'release', label: 'Release', type: 'knob', min: 10, max: 500, default: 100, unit: 'ms', group: 'Output' },
  ],
  presets: {
    'Transparent Ceiling': { inputDb: 0, ceiling: -0.3, release: 150 },
    'Loud Master': { inputDb: 6, ceiling: -0.1, release: 80 },
    'Safety Clipper': { inputDb: 0, ceiling: -1, release: 250 },
    'Aggressive Push': { inputDb: 12, ceiling: -0.5, release: 40 },
    'Podcast Ceiling': { inputDb: 3, ceiling: -3, release: 200 },
    'Fast Peak Catch': { inputDb: 4, ceiling: -0.2, release: 20 },
  },
});
