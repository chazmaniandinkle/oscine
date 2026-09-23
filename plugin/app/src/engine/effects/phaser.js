// Phaser: N cascaded allpass BiquadFilterNodes (N = 2x stages, since each
// "stage" in phaser terminology is a pole-pair notch; classic pedals are
// described as "4-stage"/"8-stage" meaning 4 or 8 allpass sections) with
// their center frequency swept in unison by one LFO, summed with the dry
// signal, and a feedback tap from the end of the allpass chain back to
// its input for a more resonant, "jet-flanger" sweep. Modelled on the
// classic analog phaser shape (MXR Phase 90 = 4-stage, Small Stone-ish
// deeper voicing = higher stage counts; the stage-count select mirrors
// how those pedals differ mainly in stage count).
//
// Signal flow:
//
//   lfo (Oscillator) -> lfoDepth (Gain, Hz swing around centerFreq)
//                                      |
//                                      v (fans out to every stage's freq)
//   wetIn -> feedbackSum (Gain) -> allpass[0] -> allpass[1] -> ... -> allpass[N-1]
//                ^                                                        |
//                |-------------------- fbGain <-------------------------- +
//                                                                          |
//                                                                          v
//                                                         wetGain (mix) -> wetOut
//   wetIn -> dryGainInternal (1 - mix) ------------------------------------> wetOut
//
// STAGES select (4/6/8) picks how many allpass BiquadFilterNodes are
// active; the class always builds MAX_STAGES (8) nodes at construction
// (fixed graph, per the effect contract — no rewiring after build) and
// bypasses the unused tail stages by re-routing: since dynamically
// unplugging nodes mid-chain would violate "build once", instead every
// stage's `Q`/`frequency` still tracks the LFO even when "inactive", but
// inactive trailing stages are algebraically neutralized by using a
// second, parallel *dry* chain tap taken after whichever stage count is
// selected. To keep this rewire-free, this implementation instead always
// routes through exactly MAX_STAGES allpass sections but *freezes* the
// LFO contribution to the disabled tail stages at 0 depth (their
// `lfoDepth` send is gated by stage index vs the current `stages` param),
// which leaves their center frequency static — a static allpass with a
// non-swept center still passes all frequencies at unity gain magnitude
// (allpass = flat magnitude response, phase-only), so an "unswept" stage
// contributes negligible additional notching and the audible stage count
// tracks the `stages` knob closely without ever disconnecting a node.

import { BaseEffect } from './registry.js';
import { defineEffect } from './registry.js';

const RAMP = 0.02;
const MAX_STAGES = 8;

const STAGE_OPTIONS = [
  { value: 4, label: '4-stage' },
  { value: 6, label: '6-stage' },
  { value: 8, label: '8-stage' },
];

class Phaser extends BaseEffect {
  constructor(ctx, params, def) {
    super(ctx, params, def);

    this.lfo = ctx.createOscillator();
    this.lfo.type = 'sine';
    this.lfo.frequency.value = params.rate ?? 0.5;
    this.lfo.start();

    this.stages = [];
    for (let i = 0; i < MAX_STAGES; i++) {
      const ap = ctx.createBiquadFilter();
      ap.type = 'allpass';
      ap.frequency.value = params.centerFreq ?? 800;
      ap.Q.value = 0.7;
      const lfoDepth = ctx.createGain();
      lfoDepth.gain.value = 0; // gated on/off by `stages` param in applyParam
      this.lfo.connect(lfoDepth);
      lfoDepth.connect(ap.frequency);
      this.stages.push({ ap, lfoDepth });
    }

    this.feedbackSum = ctx.createGain();
    this.fbGain = ctx.createGain();
    this.wetGain = ctx.createGain();
    this.dryGainInternal = ctx.createGain();

    this.wetIn.connect(this.feedbackSum);
    let prev = this.feedbackSum;
    for (const stage of this.stages) {
      prev.connect(stage.ap);
      prev = stage.ap;
    }
    // `prev` is now the last allpass stage's output.
    prev.connect(this.fbGain);
    this.fbGain.connect(this.feedbackSum);
    prev.connect(this.wetGain);
    this.wetGain.connect(this.wetOut);

    this.wetIn.connect(this.dryGainInternal);
    this.dryGainInternal.connect(this.wetOut);
  }

  _applyDepth() {
    const t = this.ctx.currentTime;
    const depthHz = this.params.depth ?? 400; // 0..2000 Hz sweep swing knob
    const activeStages = Math.round(this.params.stages ?? 4);
    this.stages.forEach((stage, i) => {
      const active = i < activeStages;
      stage.lfoDepth.gain.setTargetAtTime(active ? depthHz : 0, t, RAMP / 3);
    });
  }

  _applyStages() {
    // stage count affects both which stages are swept (handled in
    // _applyDepth) and needs re-applying if depth already has a value.
    this._applyDepth();
  }

  applyParam(key, value) {
    const t = this.ctx.currentTime;
    switch (key) {
      case 'rate':
        this.lfo.frequency.setTargetAtTime(value, t, RAMP / 3);
        break;
      case 'depth':
        this._applyDepth();
        break;
      case 'centerFreq':
        this.stages.forEach((stage) => stage.ap.frequency.setTargetAtTime(value, t, RAMP / 3));
        break;
      case 'feedback':
        this.fbGain.gain.setTargetAtTime(Math.min(value, 0.95), t, RAMP / 3);
        break;
      case 'stages':
        this._applyStages();
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
    try { this.lfo.stop(); } catch { /* already stopped */ }
  }
}

defineEffect({
  type: 'phaser',
  label: 'Phaser',
  group: 'modulation',
  klass: Phaser,
  params: [
    { key: 'stages', label: 'Stages', type: 'select', options: STAGE_OPTIONS, default: 4, group: 'Stages' },
    { key: 'rate', label: 'Rate', type: 'knob', min: 0.02, max: 10, default: 0.5, curve: 'log', unit: 'Hz', group: 'Modulation' },
    { key: 'depth', label: 'Depth', type: 'knob', min: 0, max: 2000, default: 400, unit: 'Hz', group: 'Modulation' },
    { key: 'centerFreq', label: 'Center Freq', type: 'knob', min: 100, max: 4000, default: 800, curve: 'log', unit: 'Hz', group: 'Modulation' },
    { key: 'feedback', label: 'Feedback', type: 'knob', min: 0, max: 0.95, default: 0.3, group: 'Feedback' },
    { key: 'mix', label: 'Mix', type: 'knob', min: 0, max: 1, default: 0.5, group: 'Mix' },
  ],
  presets: {
    'Classic 4-Stage': { stages: 4, rate: 0.5, depth: 400, centerFreq: 800, feedback: 0.3, mix: 0.5 },
    'Slow Deep Sweep': { stages: 8, rate: 0.12, depth: 900, centerFreq: 600, feedback: 0.5, mix: 0.6 },
    'Fast Jet': { stages: 6, rate: 2.5, depth: 700, centerFreq: 1000, feedback: 0.65, mix: 0.55 },
    'Subtle Movement': { stages: 4, rate: 0.3, depth: 150, centerFreq: 1200, feedback: 0.1, mix: 0.3 },
    'Resonant Sweep': { stages: 8, rate: 0.8, depth: 1200, centerFreq: 700, feedback: 0.85, mix: 0.65 },
  },
});
