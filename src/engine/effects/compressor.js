// Compressor: a native DynamicsCompressorNode wrapped with makeup gain,
// optional lookahead, and parallel-compression mix. Modelled on Logic
// Pro's "Compressor" in Platinum Digital circuit mode — a clean,
// transparent VCA-style compressor with standard threshold/knee/ratio/
// attack/release controls plus a mix knob for New-York-style parallel
// compression.
//
// Signal flow:
//
//   wetIn -> lookaheadDelay (0-10ms) -> DynamicsCompressorNode -> makeupGain -+
//        \                                                                    +-> wetOut
//         +-> dryTap (uncompressed, for parallel mix) ------------------------+
//
// (wetOut sums both branches automatically since GainNodes mix on connect,
// per the same pattern used in saturator.js's internal mix.)
//
// LOOKAHEAD: a DelayNode placed *before* the compressor in the wet path
// delays the signal the compressor analyzes/reduces, which is the classic
// "lookahead" trick — except here it delays what's fed to the detector
// AND what gets compressed (a real lookahead limiter delays only the
// audio while a separate undelayed tap drives the detector; the native
// DynamicsCompressorNode doesn't expose an external sidechain input, so
// there's no way to feed it an early detector signal without also
// delaying the audio). The practical effect is still musically useful
// (it gives the params.release curve of a look-ahead-style compressor
// something closer to time to react) but it is NOT a true zero-added-
// latency-until-engaged lookahead — it always costs latency equal to the
// delay time. `def.latencySamples` is recomputed on every lookahead
// change (assuming a 44.1kHz project — see applyParam) so a future PDC
// pass can compensate for it.
//
// MAKEUP GAIN is a plain dB->linear GainNode after the compressor — no
// auto-makeup heuristic, the user dials it in directly (matches Logic's
// manual "Output Gain" knob, not FabFilter-style auto-gain).
//
// MIX: parallel compression. `dryTap` carries the *uncompressed* wetIn
// signal (not run through the lookahead delay, so parallel blends stay
// phase-aligned-ish with the source rather than the delayed compressed
// path — acceptable given lookahead defaults to 0ms and users who dial
// in both lookahead and heavy parallel mix accept the tradeoff, same as
// most real plugins).
//
// getReductionDb(): DynamicsCompressorNode.reduction is a live read-only
// AudioParam-like float (dB, <=0) reflecting current gain reduction —
// exposed here for a future gain-reduction meter in the UI.

import { BaseEffect } from './registry.js';
import { defineEffect } from './registry.js';

const RAMP = 0.02; // seconds; keeps knob drags click-free (rule: <= 20ms)
const SAMPLE_RATE_ASSUMED = 44100; // for latencySamples bookkeeping; see applyParam('lookaheadMs')

const dbToLinear = (db) => Math.pow(10, db / 20);

class Compressor extends BaseEffect {
  constructor(ctx, params, def) {
    super(ctx, params, def);

    this.lookaheadDelay = ctx.createDelay(1); // max 1s, plenty for 0-10ms
    this.comp = ctx.createDynamicsCompressor();
    this.makeupGain = ctx.createGain();
    this.dryTap = ctx.createGain(); // parallel/dry path for `mix`
    this.wetTap = ctx.createGain(); // compressed path gain (for `mix`)

    this.wetIn.connect(this.lookaheadDelay);
    this.lookaheadDelay.connect(this.comp);
    this.comp.connect(this.makeupGain);
    this.makeupGain.connect(this.wetTap);
    this.wetTap.connect(this.wetOut);

    this.wetIn.connect(this.dryTap);
    this.dryTap.connect(this.wetOut);

    this.applyAll();
  }

  applyParam(key, value) {
    const t = this.ctx.currentTime;
    switch (key) {
      case 'threshold':
        this.comp.threshold.setTargetAtTime(value, t, RAMP / 3);
        break;
      case 'knee':
        this.comp.knee.setTargetAtTime(value, t, RAMP / 3);
        break;
      case 'ratio':
        this.comp.ratio.setTargetAtTime(value, t, RAMP / 3);
        break;
      case 'attack':
        this.comp.attack.setTargetAtTime(value / 1000, t, RAMP / 3); // ms -> s
        break;
      case 'release':
        this.comp.release.setTargetAtTime(value / 1000, t, RAMP / 3); // ms -> s
        break;
      case 'makeupDb':
        this.makeupGain.gain.setTargetAtTime(dbToLinear(value), t, RAMP / 3);
        break;
      case 'lookaheadMs':
        this.lookaheadDelay.delayTime.setTargetAtTime(value / 1000, t, RAMP / 3); // ms -> s
        this.def.latencySamples = Math.round((value / 1000) * SAMPLE_RATE_ASSUMED);
        break;
      case 'mix':
        this.wetTap.gain.setTargetAtTime(value, t, RAMP / 3);
        this.dryTap.gain.setTargetAtTime(1 - value, t, RAMP / 3);
        break;
      default:
        break;
    }
  }

  // Live gain-reduction readout in dB (<=0), for a future meter widget.
  getReductionDb() { return this.comp.reduction; }
}

defineEffect({
  type: 'compressor',
  label: 'Compressor',
  group: 'dynamics',
  klass: Compressor,
  latencySamples: 0,
  params: [
    { key: 'threshold', label: 'Threshold', type: 'knob', min: -60, max: 0, default: -24, unit: 'dB', group: 'Dynamics' },
    { key: 'knee', label: 'Knee', type: 'knob', min: 0, max: 40, default: 30, unit: 'dB', group: 'Dynamics' },
    { key: 'ratio', label: 'Ratio', type: 'knob', min: 1, max: 20, default: 4, unit: ':1', group: 'Dynamics' },
    { key: 'attack', label: 'Attack', type: 'knob', min: 0, max: 200, default: 10, unit: 'ms', group: 'Envelope' },
    { key: 'release', label: 'Release', type: 'knob', min: 10, max: 1000, default: 250, unit: 'ms', group: 'Envelope' },
    { key: 'makeupDb', label: 'Makeup', type: 'knob', min: 0, max: 24, default: 0, unit: 'dB', group: 'Output' },
    { key: 'lookaheadMs', label: 'Lookahead', type: 'knob', min: 0, max: 10, default: 0, unit: 'ms', group: 'Output' },
    { key: 'mix', label: 'Mix', type: 'knob', min: 0, max: 1, default: 1, group: 'Output' },
  ],
  presets: {
    'Transparent Bus Glue': { threshold: -18, knee: 30, ratio: 2, attack: 20, release: 250, makeupDb: 1.5, mix: 1 },
    'Vocal Rider': { threshold: -22, knee: 24, ratio: 4, attack: 8, release: 180, makeupDb: 4, mix: 1 },
    'Drum Crusher': { threshold: -28, knee: 6, ratio: 8, attack: 2, release: 90, makeupDb: 5, mix: 1 },
    'NY Parallel Punch': { threshold: -40, knee: 12, ratio: 10, attack: 3, release: 120, makeupDb: 6, mix: 0.4 },
    'Gentle Limiting Safety': { threshold: -6, knee: 6, ratio: 3, attack: 15, release: 200, makeupDb: 0, mix: 1 },
    'Lookahead Peak Catch': { threshold: -12, knee: 4, ratio: 12, attack: 1, release: 150, makeupDb: 2, lookaheadMs: 5, mix: 1 },
  },
});
