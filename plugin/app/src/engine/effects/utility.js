// Utility: gain trim, polarity invert, stereo width (mid/side), L/R swap,
// mono sum. Modelled on Ableton's "Utility" device — the boring-but-
// essential channel-strip Swiss army knife that goes before/after other
// inserts to fix gain staging, phase, and stereo image.
//
// Signal flow (all fixed at construction time — only AudioParam values
// change afterwards, per the effect contract):
//
//   wetIn -> trimGain (dB->linear) -> polarityGain (+-1)
//         -> ChannelSplitter(2) -+-> mFromL(0.5) -+-> M (mid = (L+R)/2)
//                                 +-> sFromL(0.5) -+-> S (side = (L-R)/2)
//                                 +-> mFromR(0.5) -^  ^
//                                 +-> sFromR(-0.5) ---+
//         M ---------------------------------------------+
//         S -> widthGain (0..2, from 0-200%) -+-----------|--> L' = M + S'
//                                              +-> sNeg(-1)-> R' = M - S'
//         L', R' -> swap crossfade (swapLL/swapRL feed finalL,
//                    swapRR/swapLR feed finalR; each pair ramps between
//                    {1,0} and {0,1} so toggling L/R swap is click-free)
//         finalL, finalR -> mono crossfade against a (L+R)/2 sum node
//                    (monoFromL/monoFromR -> monoSum; outL/R blend direct
//                    vs monoSum by monoAmt in {0,1}) -> ChannelMerger(2)
//                    -> wetOut
//
// Mid/Side width: M = (L+R)/2, S = (L-R)/2 is the standard M/S decomposition.
// Scaling S by `width` (0..2 linear, i.e. 0-200%) and recombining
// L'=M+S', R'=M-S' is the textbook width control: 0% collapses to mono
// (S contributes nothing, L'=R'=M), 100% is unity (unchanged image),
// 200% doubles the side signal for an exaggerated stereo image.
//
// Swap and mono-sum are implemented as gain crossfades (targets 0 or 1)
// rather than rewiring the graph, so every parameter change is just an
// AudioParam ramp — no reconnect glitches, and it works identically on
// an OfflineAudioContext render.

import { BaseEffect } from './registry.js';
import { defineEffect } from './registry.js';

const RAMP = 0.02; // seconds; keeps changes click-free (rule: <= 20ms)

const POLARITY_OPTIONS = [
  { value: 'normal', label: 'Normal' },
  { value: 'inverted', label: 'Inverted' },
];
const SWAP_OPTIONS = [
  { value: 'normal', label: 'L/R' },
  { value: 'swapped', label: 'R/L' },
];
const MONO_OPTIONS = [
  { value: 'stereo', label: 'Stereo' },
  { value: 'mono', label: 'Mono' },
];

const dbToLinear = (db) => Math.pow(10, db / 20);

class Utility extends BaseEffect {
  constructor(ctx, params, def) {
    super(ctx, params, def);

    this.trimGain = ctx.createGain();
    this.polarityGain = ctx.createGain();

    this.splitter = ctx.createChannelSplitter(2);
    this.mFromL = ctx.createGain(); this.mFromL.gain.value = 0.5;
    this.mFromR = ctx.createGain(); this.mFromR.gain.value = 0.5;
    this.sFromL = ctx.createGain(); this.sFromL.gain.value = 0.5;
    this.sFromR = ctx.createGain(); this.sFromR.gain.value = -0.5;
    this.mSum = ctx.createGain(); // M = (L+R)/2
    this.sSum = ctx.createGain(); // S = (L-R)/2
    this.widthGain = ctx.createGain(); // S' = S * width (0..2)
    this.sNeg = ctx.createGain(); this.sNeg.gain.value = -1;

    this.lPrime = ctx.createGain(); // L' = M + S'
    this.rPrime = ctx.createGain(); // R' = M - S'

    // Swap crossfade: finalL = L'*swapLL + R'*swapRL, finalR = R'*swapRR + L'*swapLR
    this.swapLL = ctx.createGain();
    this.swapRL = ctx.createGain();
    this.swapRR = ctx.createGain();
    this.swapLR = ctx.createGain();
    this.finalL = ctx.createGain();
    this.finalR = ctx.createGain();

    // Mono crossfade: monoSum = (finalL+finalR)/2; outL/R blend direct vs monoSum
    this.monoFromL = ctx.createGain(); this.monoFromL.gain.value = 0.5;
    this.monoFromR = ctx.createGain(); this.monoFromR.gain.value = 0.5;
    this.monoSum = ctx.createGain();
    this.outLDirect = ctx.createGain();
    this.outLMono = ctx.createGain();
    this.outRDirect = ctx.createGain();
    this.outRMono = ctx.createGain();

    this.merger = ctx.createChannelMerger(2);

    // Wire it up.
    this.wetIn.connect(this.trimGain);
    this.trimGain.connect(this.polarityGain);
    this.polarityGain.connect(this.splitter);

    this.splitter.connect(this.mFromL, 0);
    this.splitter.connect(this.sFromL, 0);
    this.splitter.connect(this.mFromR, 1);
    this.splitter.connect(this.sFromR, 1);

    this.mFromL.connect(this.mSum);
    this.mFromR.connect(this.mSum);
    this.sFromL.connect(this.sSum);
    this.sFromR.connect(this.sSum);

    this.sSum.connect(this.widthGain);

    this.mSum.connect(this.lPrime);
    this.widthGain.connect(this.lPrime);
    this.mSum.connect(this.rPrime);
    this.widthGain.connect(this.sNeg);
    this.sNeg.connect(this.rPrime);

    this.lPrime.connect(this.swapLL);
    this.rPrime.connect(this.swapRL);
    this.rPrime.connect(this.swapRR);
    this.lPrime.connect(this.swapLR);
    this.swapLL.connect(this.finalL);
    this.swapRL.connect(this.finalL);
    this.swapRR.connect(this.finalR);
    this.swapLR.connect(this.finalR);

    this.finalL.connect(this.monoFromL);
    this.finalR.connect(this.monoFromR);
    this.monoFromL.connect(this.monoSum);
    this.monoFromR.connect(this.monoSum);

    this.finalL.connect(this.outLDirect);
    this.monoSum.connect(this.outLMono);
    this.finalR.connect(this.outRDirect);
    this.monoSum.connect(this.outRMono);

    this.outLDirect.connect(this.merger, 0, 0);
    this.outLMono.connect(this.merger, 0, 0);
    this.outRDirect.connect(this.merger, 0, 1);
    this.outRMono.connect(this.merger, 0, 1);

    this.merger.connect(this.wetOut);

    // Defaults: normal swap routing, stereo (no mono sum).
    this.swapLL.gain.value = 1;
    this.swapRL.gain.value = 0;
    this.swapRR.gain.value = 1;
    this.swapLR.gain.value = 0;
    this.outLDirect.gain.value = 1;
    this.outLMono.gain.value = 0;
    this.outRDirect.gain.value = 1;
    this.outRMono.gain.value = 0;

    this.applyAll();
  }

  applyParam(key, value) {
    const t = this.ctx.currentTime;
    switch (key) {
      case 'gainDb':
        this.trimGain.gain.setTargetAtTime(dbToLinear(value), t, RAMP / 3);
        break;
      case 'polarity':
        this.polarityGain.gain.setTargetAtTime(value === 'inverted' ? -1 : 1, t, RAMP / 3);
        break;
      case 'width':
        this.widthGain.gain.setTargetAtTime(value / 100, t, RAMP / 3);
        break;
      case 'swap': {
        const swapped = value === 'swapped';
        this.swapLL.gain.setTargetAtTime(swapped ? 0 : 1, t, RAMP / 3);
        this.swapRL.gain.setTargetAtTime(swapped ? 1 : 0, t, RAMP / 3);
        this.swapRR.gain.setTargetAtTime(swapped ? 0 : 1, t, RAMP / 3);
        this.swapLR.gain.setTargetAtTime(swapped ? 1 : 0, t, RAMP / 3);
        break;
      }
      case 'mono': {
        const mono = value === 'mono';
        this.outLDirect.gain.setTargetAtTime(mono ? 0 : 1, t, RAMP / 3);
        this.outLMono.gain.setTargetAtTime(mono ? 1 : 0, t, RAMP / 3);
        this.outRDirect.gain.setTargetAtTime(mono ? 0 : 1, t, RAMP / 3);
        this.outRMono.gain.setTargetAtTime(mono ? 1 : 0, t, RAMP / 3);
        break;
      }
      default:
        break;
    }
  }
}

defineEffect({
  type: 'utility',
  label: 'Utility',
  group: 'utility',
  klass: Utility,
  params: [
    { key: 'gainDb', label: 'Gain', type: 'knob', min: -24, max: 24, default: 0, unit: 'dB', group: 'Gain' },
    { key: 'polarity', label: 'Polarity', type: 'select', options: POLARITY_OPTIONS, default: 'normal', group: 'Gain' },
    { key: 'width', label: 'Width', type: 'knob', min: 0, max: 200, default: 100, unit: '%', group: 'Stereo' },
    { key: 'swap', label: 'L/R Swap', type: 'select', options: SWAP_OPTIONS, default: 'normal', group: 'Stereo' },
    { key: 'mono', label: 'Mono', type: 'select', options: MONO_OPTIONS, default: 'stereo', group: 'Stereo' },
  ],
  presets: {
    'Unity': {},
    'Mono Check': { mono: 'mono' },
    'Widen': { width: 150 },
    'Narrow': { width: 50 },
    'Invert Polarity': { polarity: 'inverted' },
    'Swap Channels': { swap: 'swapped' },
    'Gain Trim +6dB': { gainDb: 6 },
  },
});
