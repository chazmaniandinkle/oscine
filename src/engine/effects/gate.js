// Noise Gate: an all-native-nodes envelope follower whose detector level
// is mapped through a WaveShaper "transfer curve" into an open/closed
// 0..1 control signal, which drives a GainNode's `.gain` AudioParam
// directly from audio-rate data. Modelled on a simple expander/gate
// (think the gate section of a channel strip, e.g. dbx 363 / SSL
// channel gate) — not a fully faithful clone, but the same threshold/
// attack/hold/release/range control surface.
//
// APPROACH (why it's built this way): the effect contract only allows
// building the graph once and then automating AudioParams — no per-
// sample JS in the render thread (no ScriptProcessor/AudioWorklet
// dependency here). Luckily Web Audio explicitly allows connecting an
// audio-rate *signal* into another node's AudioParam (`node.connect
// (gainNode.gain)`), and WaveShaperNode curves are themselves usable as
// a way to remap a level into a 0..1 "open amount" — so the whole gate
// is built from native nodes with no scripting:
//
//   wetIn -> rectifier (WaveShaper: y = |x|) -> detectorLPF (lowpass,
//         ~attack-controlled cutoff) -> releaseLPF (lowpass, ~release-
//         controlled cutoff, smooths the detector further so the gate
//         doesn't chatter) -> transferCurve (WaveShaper: level -> 0..1
//         open/closed, threshold + range baked into the curve shape)
//         -> connect(gateGain.gain)   [AudioParam driven by audio-rate
//            signal, per spec Web Audio§AudioParam automation]
//
//   wetIn -> gateGain -> wetOut   (the actual audio path being gated)
//
// TRANSFER CURVE: WaveShaperNode curves map input range [-1,1] to output
// range [-1,1] linearly interpolated over N samples — there's no way to
// give it an arbitrary domain, so the detector's DC-ish level (0..~1
// after rectification) is what actually reaches it (only the positive
// half of the curve domain is meaningful for a rectified signal, but the
// full [-1,1] curve is still built so `y(-1)` also lands closed, in case
// upstream floating-point noise dips slightly negative).
// Below (threshold - range-taper) -> closed (~10^(range/20), i.e. the
// floor set by `range`, never truly 0 to avoid abrupt digital silence
// clicks). At/above threshold -> fully open (1.0). Between the two, a
// smooth (smoothstep) ramp — this softens the knee and doubles as a
// crude "hysteresis-free" hold approximation (see below).
//
// ATTACK / RELEASE / HOLD (all approximate — documented, not exact):
//   - ATTACK is approximated by the cutoff frequency of `detectorLPF`:
//     a higher cutoff (faster) lets the rectified signal reach the
//     transfer curve with less smoothing lag, i.e. shorter attack.
//     freq = 1 / (2*pi*attackSeconds), clamped to a sane audio range.
//   - RELEASE is approximated the same way via `releaseLPF`, but tuned
//     the opposite direction (its cutoff is set LOW enough that the
//     signal decays over roughly `releaseSeconds`), so the detector
//     hangs onto a falling envelope for the release time rather than
//     asymptotically-instant lowpass decay.
//   - HOLD has no native equivalent (there's no way to freeze a signal's
//     value in native nodes without JS) so it is *approximated by
//     stretching the release time*: `holdMs` is simply added on top of
//     `releaseMs` when computing the release detector's cutoff. This is
//     documented here (not implemented) as a known simplification — a
//     true hold (flat plateau, then a distinct release slope) would
//     need an AudioWorklet.
//
// This is a best-effort native-nodes gate: good enough for creative use
// and for exercising the registry contract, not a bit-exact clone of a
// hardware gate.

import { BaseEffect } from './registry.js';
import { defineEffect } from './registry.js';

const RAMP = 0.02; // seconds; keeps knob drags click-free (rule: <= 20ms)
const CURVE_LEN = 1024;
const MIN_LPF_HZ = 1;
const MAX_LPF_HZ = 8000;

const dbToLinear = (db) => Math.pow(10, db / 20);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// smoothstep-based open/closed transfer curve. `thresholdLin` and
// `floorLin` are both in [0,1] linear-magnitude space (post-rectifier).
function makeTransferCurve(thresholdLin, floorLin) {
  const curve = new Float32Array(CURVE_LEN);
  // Soft knee width: 30% of threshold, floored at ~2 curve steps so the
  // ramp is never narrower than the table's own resolution (avoids a
  // knee so thin it degenerates into a single-sample hard edge at low
  // thresholds, without swallowing the whole threshold the way a large
  // fixed absolute floor would for quiet thresholds).
  const kneeWidth = Math.max(thresholdLin * 0.3, 2 / CURVE_LEN);
  const loEdge = Math.max(0, thresholdLin - kneeWidth);
  const hiEdge = thresholdLin;
  for (let i = 0; i < CURVE_LEN; i++) {
    const x = (i / (CURVE_LEN - 1)) * 2 - 1; // domain is [-1,1] per WaveShaper spec
    const level = Math.abs(x); // rectified detector level should already be >=0, but guard anyway
    let openAmount;
    if (level <= loEdge) {
      openAmount = 0;
    } else if (level >= hiEdge) {
      openAmount = 1;
    } else {
      const t = (level - loEdge) / (hiEdge - loEdge || 1);
      openAmount = t * t * (3 - 2 * t); // smoothstep
    }
    curve[i] = floorLin + openAmount * (1 - floorLin);
  }
  return curve;
}

class Gate extends BaseEffect {
  constructor(ctx, params, def) {
    super(ctx, params, def);

    this.rectifier = ctx.createWaveShaper();
    this.rectifier.curve = (() => {
      const c = new Float32Array(CURVE_LEN);
      for (let i = 0; i < CURVE_LEN; i++) {
        const x = (i / (CURVE_LEN - 1)) * 2 - 1;
        c[i] = Math.abs(x);
      }
      return c;
    })();

    this.detectorLPF = ctx.createBiquadFilter();
    this.detectorLPF.type = 'lowpass';
    this.detectorLPF.Q.value = Math.SQRT1_2;

    this.releaseLPF = ctx.createBiquadFilter();
    this.releaseLPF.type = 'lowpass';
    this.releaseLPF.Q.value = Math.SQRT1_2;

    this.transferCurve = ctx.createWaveShaper();
    this.transferCurve.curve = makeTransferCurve(
      dbToLinear(params.threshold ?? -40),
      dbToLinear(params.range ?? -60),
    );

    this.gateGain = ctx.createGain();
    this.gateGain.gain.value = 1;

    // Detector (sidechain) path: does NOT feed wetOut, only controls gateGain.gain.
    this.wetIn.connect(this.rectifier);
    this.rectifier.connect(this.detectorLPF);
    this.detectorLPF.connect(this.releaseLPF);
    this.releaseLPF.connect(this.transferCurve);
    this.transferCurve.connect(this.gateGain.gain);

    // Audio path: the signal actually being gated.
    this.wetIn.connect(this.gateGain);
    this.gateGain.connect(this.wetOut);

    this.applyAll();
  }

  applyParam(key, value) {
    const t = this.ctx.currentTime;
    switch (key) {
      case 'threshold':
        this._rebuildCurve();
        break;
      case 'range':
        this._rebuildCurve();
        break;
      case 'attack': {
        // shorter attack (ms) -> higher detector cutoff (faster response)
        const attackSec = Math.max(value, 0.1) / 1000;
        const hz = clamp(1 / (2 * Math.PI * attackSec), MIN_LPF_HZ, MAX_LPF_HZ);
        this.detectorLPF.frequency.setTargetAtTime(hz, t, RAMP / 3);
        break;
      }
      case 'release':
      case 'hold': {
        // hold has no native equivalent; approximate by folding it into release (see header).
        const releaseMs = (this.params.release ?? 100) + (this.params.hold ?? 0);
        const releaseSec = Math.max(releaseMs, 1) / 1000;
        const hz = clamp(1 / (2 * Math.PI * releaseSec), MIN_LPF_HZ, MAX_LPF_HZ);
        this.releaseLPF.frequency.setTargetAtTime(hz, t, RAMP / 3);
        break;
      }
      default:
        break;
    }
  }

  _rebuildCurve() {
    const thresholdLin = dbToLinear(this.params.threshold ?? -40);
    const floorLin = dbToLinear(this.params.range ?? -60);
    this.transferCurve.curve = makeTransferCurve(thresholdLin, floorLin);
  }
}

defineEffect({
  type: 'gate',
  label: 'Gate',
  group: 'dynamics',
  klass: Gate,
  params: [
    { key: 'threshold', label: 'Threshold', type: 'knob', min: -80, max: 0, default: -40, unit: 'dB', group: 'Dynamics' },
    { key: 'range', label: 'Range', type: 'knob', min: -80, max: 0, default: -60, unit: 'dB', group: 'Dynamics' },
    { key: 'attack', label: 'Attack', type: 'knob', min: 0.1, max: 100, default: 2, unit: 'ms', group: 'Envelope' },
    { key: 'hold', label: 'Hold', type: 'knob', min: 0, max: 500, default: 20, unit: 'ms', group: 'Envelope' },
    { key: 'release', label: 'Release', type: 'knob', min: 5, max: 2000, default: 150, unit: 'ms', group: 'Envelope' },
  ],
  presets: {
    'Drum Tightener': { threshold: -30, range: -50, attack: 0.5, hold: 10, release: 80 },
    'Vocal De-noise': { threshold: -45, range: -30, attack: 5, hold: 30, release: 200 },
    'Aggressive Chop': { threshold: -20, range: -80, attack: 0.1, hold: 0, release: 40 },
    'Room Tail Cleanup': { threshold: -55, range: -40, attack: 10, hold: 100, release: 400 },
    'Subtle Noise Floor': { threshold: -60, range: -18, attack: 3, hold: 20, release: 250 },
    'Gentle Sustain Gate': { threshold: -35, range: -24, attack: 8, hold: 50, release: 600 },
  },
});
