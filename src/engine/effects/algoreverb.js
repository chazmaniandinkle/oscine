// Algorithmic convolution reverb: a synthesized stereo impulse response
// (exponentially decaying filtered noise) fed into a native
// ConvolverNode. Modelled on the "algo reverb from a generated IR" shape
// used by lightweight reverbs like Ableton's Reverb (Algorithmic mode) or
// TAL-Reverb-4 — no sampled IR file, everything is generated in JS at
// construction time and regenerated only when size/decay/predelay/damping
// change (rebuilding a multi-second buffer is expensive, so it's
// debounced: rapid knob drags coalesce into a single rebuild ~150ms after
// the user stops moving the knob).
//
// Signal flow:
//
//   wetIn -> preDelay (DelayNode, 0-250ms)
//         -> convolver (ConvolverNode, buffer = generated IR)
//         -> tailDamp (BiquadFilter lowpass, tones down the tail)
//         -> wetGain (mix) -> wetOut
//   wetIn -> dryGainInternal (1 - mix) ---------------------------> wetOut
//
// IMPULSE GENERATION (regenerated on size/decay/damping change, NOT on
// mix/predelay which just touch AudioParams):
//   For each of 2 channels, length = size (seconds) * sampleRate samples
//   of white noise, each sample scaled by an exponential decay envelope
//   pow(1 - i/len, decayShape) where decayShape is derived from `decay`
//   (0..1 knob -> exponent 1..6; higher = faster-feeling early decay,
//   approximates a shorter-sounding RT60 without recomputing sample
//   count). A cheap one-pole IIR lowpass is run over the noise buffer
//   itself (in JS, at generation time — NOT an extra realtime node) using
//   `damping` as the filter coefficient, so the tail's high end decays
//   faster than the low end the way real room tails do; this is baked
//   into the IR once, on top of the realtime `tailDamp` BiquadFilter
//   which lets the user brighten/darken the *already-baked* tail live
//   without regenerating the buffer.
//   Left/right channels use independent noise seeds (decorrelated) for
//   stereo width, a standard trick for synthesized reverb IRs.
//
// DEBOUNCE: `rebuildSoon` (250ms) mirrors the legacy send-bus reverb's
// debounce pattern (see the old effects/reverb.js) — the ctor calls the
// rebuild immediately (no debounce) so construction always yields a
// ready, non-silent convolver even on an OfflineAudioContext render.

import { BaseEffect } from './registry.js';
import { defineEffect } from './registry.js';

const RAMP = 0.02;
const MAX_PREDELAY_SEC = 0.25;
const DEBOUNCE_MS = 150;

function debounce(fn, ms) {
  let t = null;
  const wrapped = (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => { if (t) clearTimeout(t); };
  return wrapped;
}

function buildImpulse(ctx, { size, decay, damping }) {
  const sr = ctx.sampleRate;
  const len = Math.max(1, Math.floor(sr * Math.max(0.05, size)));
  const buf = ctx.createBuffer(2, len, sr);
  // decay (0..1) -> envelope exponent 1..6 (higher = tighter early decay)
  const shape = 1 + Math.max(0, Math.min(1, decay)) * 5;
  // damping (Hz-ish knob, 200..18000) -> one-pole lowpass coefficient
  // applied to the noise itself; higher damping value = brighter tail
  // (less filtering), so invert to a coefficient in (0, 1).
  const dampNorm = Math.max(0, Math.min(1, (damping - 200) / (18000 - 200)));
  const alpha = 0.05 + (1 - dampNorm) * 0.9; // smoothing factor; larger = darker tail

  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    let prev = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const white = Math.random() * 2 - 1;
      // one-pole lowpass baked into the IR (decorrelated per channel
      // since `prev` and the random stream are independent per loop)
      prev = prev + alpha * (white - prev);
      const env = Math.pow(1 - t, shape);
      data[i] = prev * env;
    }
  }
  return buf;
}

class AlgoReverb extends BaseEffect {
  constructor(ctx, params, def) {
    super(ctx, params, def);

    this.preDelay = ctx.createDelay(MAX_PREDELAY_SEC + 0.01);
    this.convolver = ctx.createConvolver();
    this.tailDamp = ctx.createBiquadFilter();
    this.tailDamp.type = 'lowpass';
    this.wetGain = ctx.createGain();
    this.dryGainInternal = ctx.createGain();

    this.wetIn.connect(this.preDelay);
    this.preDelay.connect(this.convolver);
    this.convolver.connect(this.tailDamp);
    this.tailDamp.connect(this.wetGain);
    this.wetGain.connect(this.wetOut);

    this.wetIn.connect(this.dryGainInternal);
    this.dryGainInternal.connect(this.wetOut);

    this._lastIrKey = null;
    this._rebuildSoon = debounce(() => this._rebuildImpulse(), DEBOUNCE_MS);
    // Build immediately so the convolver is never silent, including on a
    // freshly-constructed OfflineAudioContext render (no setTimeout wait).
    this._rebuildImpulse();
  }

  _irKey() {
    const p = this.params;
    return `${p.size}|${p.decay}|${p.damping}`;
  }

  _rebuildImpulse() {
    const key = this._irKey();
    if (key === this._lastIrKey) return;
    this._lastIrKey = key;
    this.convolver.buffer = buildImpulse(this.ctx, {
      size: this.params.size ?? 2,
      decay: this.params.decay ?? 0.5,
      damping: this.params.damping ?? 8000,
    });
  }

  applyParam(key, value) {
    const t = this.ctx.currentTime;
    switch (key) {
      case 'size':
      case 'decay':
        this._rebuildSoon();
        break;
      case 'damping':
        // Live-touches the realtime tail filter immediately (cheap) AND
        // schedules an IR rebuild (the baked-in high-frequency rolloff),
        // so damping feels instant while the "true" IR catches up.
        this.tailDamp.frequency.setTargetAtTime(value, t, RAMP / 3);
        this._rebuildSoon();
        break;
      case 'preDelay':
        this.preDelay.delayTime.setTargetAtTime(Math.min(value / 1000, MAX_PREDELAY_SEC), t, RAMP / 3);
        break;
      case 'mix':
        this.wetGain.gain.setTargetAtTime(value, t, RAMP / 3);
        this.dryGainInternal.gain.setTargetAtTime(1 - value, t, RAMP / 3);
        break;
      default:
        break;
    }
  }

  dispose() {
    super.dispose();
    if (this._rebuildSoon && this._rebuildSoon.cancel) this._rebuildSoon.cancel();
  }
}

defineEffect({
  type: 'algoreverb',
  label: 'Algorithmic Reverb',
  group: 'time',
  klass: AlgoReverb,
  params: [
    { key: 'size', label: 'Size', type: 'knob', min: 0.2, max: 8, default: 2.2, curve: 'log', unit: 's', group: 'Reverb' },
    { key: 'decay', label: 'Decay', type: 'knob', min: 0, max: 1, default: 0.5, group: 'Reverb' },
    { key: 'preDelay', label: 'Pre-delay', type: 'knob', min: 0, max: 250, default: 15, unit: 'ms', group: 'Reverb' },
    { key: 'damping', label: 'Damping', type: 'knob', min: 200, max: 18000, default: 8000, curve: 'log', unit: 'Hz', group: 'Reverb' },
    { key: 'mix', label: 'Mix', type: 'knob', min: 0, max: 1, default: 0.3, group: 'Mix' },
  ],
  presets: {
    'Small Room': { size: 0.8, decay: 0.75, preDelay: 5, damping: 9000, mix: 0.2 },
    'Plate': { size: 1.6, decay: 0.55, preDelay: 8, damping: 11000, mix: 0.28 },
    'Hall': { size: 3.5, decay: 0.35, preDelay: 25, damping: 6500, mix: 0.32 },
    'Cathedral': { size: 6.5, decay: 0.15, preDelay: 40, damping: 4000, mix: 0.38 },
    'Dark Ambient Wash': { size: 5, decay: 0.2, preDelay: 60, damping: 2000, mix: 0.5 },
  },
});
