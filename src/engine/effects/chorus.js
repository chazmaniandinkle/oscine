// Chorus: 2-3 modulated-delay voices, each an independent DelayNode swept
// by its own LFO (phase-offset per voice for width), summed with the dry
// signal. Modelled on the classic "multi-voice BBD chorus" shape found in
// TC Electronic / Boss CE-2-style choruses and most DAW-native choruses
// (Ableton Chorus-Ensemble's simpler cousin): rate + depth control the
// shared modulation character, spread widens the stereo image by panning
// voices apart and staggering their LFO phase, mix blends wet/dry.
//
// Signal flow (per voice v, v = 0..voices-1):
//
//   lfo[v] (Oscillator, sine, phase-staggered via a short initial delay
//           trick*) -> lfoDepth[v] (Gain, ms swing) -> delay[v].delayTime
//   wetIn -> delay[v] (base delayTime ~ 15-25ms "BBD" center)
//         -> panner[v] (StereoPannerNode, spread * position)
//         -> wetGain -> wetOut
//
// *Web Audio OscillatorNodes don't expose a `.phase` AudioParam, so each
// voice's LFO is phase-staggered by giving voice `v` a distinct
// `lfo.frequency` micro-offset is NOT used (would detune the rate);
// instead each voice's LFO starts from a different point in its cycle by
// calling `.start(ctx.currentTime + offset)` with a small negative-modulo
// offset derived from the voice index — practically, since fresh
// OscillatorNodes always start at phase 0, staggering is achieved by
// running each voice's depth-gain through its own delay chain with a
// *different base delay time* (voice 0/1/2 centered at 15/20/25ms) which
// is the standard, simpler way chorus pedals achieve a "3 voices, not in
// unison" effect even when every LFO starts in phase — the differing
// center delay times alone are enough to decorrelate the voices audibly,
// combined with alternating +/- depth sign per voice below.
//
// wetIn is also connected straight to wetOut via dryGainInternal so the
// unmodulated fundamental stays present (a chorus without any dry
// component sounds like a flanger/vibrato, not a chorus).

import { BaseEffect } from './registry.js';
import { defineEffect } from './registry.js';

const RAMP = 0.02;
const MAX_VOICES = 3;
const MAX_DELAY_SEC = 0.06; // 60ms ceiling, plenty above the ~15-30ms chorus center + depth swing
const VOICE_BASE_MS = [15, 21, 27]; // per-voice base delay time, decorrelates voices without needing LFO phase
const VOICE_PAN = [-1, 1, 0]; // pan position multiplier per voice (scaled by `spread`)
const VOICE_DEPTH_SIGN = [1, -1, 1]; // alternate modulation direction per voice for width

class Chorus extends BaseEffect {
  constructor(ctx, params, def) {
    super(ctx, params, def);

    this.voices = [];
    for (let v = 0; v < MAX_VOICES; v++) {
      const delay = ctx.createDelay(MAX_DELAY_SEC);
      delay.delayTime.value = VOICE_BASE_MS[v] / 1000;
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = params.rate ?? 0.8;
      const lfoDepth = ctx.createGain();
      lfoDepth.gain.value = 0; // set in applyParam
      const panner = ctx.createStereoPanner();
      panner.pan.value = 0;
      const voiceGain = ctx.createGain();
      voiceGain.gain.value = v < (params.voices ?? 3) ? 1 : 0;

      lfo.connect(lfoDepth);
      lfoDepth.connect(delay.delayTime);
      lfo.start();

      this.wetIn.connect(delay);
      delay.connect(panner);
      panner.connect(voiceGain);
      voiceGain.connect(this.wetMixGain || (this.wetMixGain = ctx.createGain()));

      this.voices.push({ delay, lfo, lfoDepth, panner, voiceGain });
    }
    this.wetMixGain.connect(this.wetOut);

    this.dryGainInternal = ctx.createGain();
    this.wetIn.connect(this.dryGainInternal);
    this.dryGainInternal.connect(this.wetOut);
  }

  _applyVoiceCount() {
    const n = Math.round(this.params.voices ?? 3);
    const t = this.ctx.currentTime;
    this.voices.forEach((voice, i) => {
      voice.voiceGain.gain.setTargetAtTime(i < n ? 1 : 0, t, RAMP / 3);
    });
  }

  _applyDepth() {
    const t = this.ctx.currentTime;
    const depthMs = this.params.depth ?? 3; // 0..10ms swing knob
    this.voices.forEach((voice, i) => {
      const hz = (depthMs / 1000) * VOICE_DEPTH_SIGN[i];
      voice.lfoDepth.gain.setTargetAtTime(hz, t, RAMP / 3);
    });
  }

  _applySpread() {
    const t = this.ctx.currentTime;
    const spread = this.params.spread ?? 0.7; // 0..1
    this.voices.forEach((voice, i) => {
      voice.panner.pan.setTargetAtTime(VOICE_PAN[i] * spread, t, RAMP / 3);
    });
  }

  applyParam(key, value) {
    const t = this.ctx.currentTime;
    switch (key) {
      case 'rate':
        this.voices.forEach((voice) => voice.lfo.frequency.setTargetAtTime(value, t, RAMP / 3));
        break;
      case 'depth':
        this._applyDepth();
        break;
      case 'spread':
        this._applySpread();
        break;
      case 'voices':
        this._applyVoiceCount();
        break;
      case 'mix':
        this.wetMixGain.gain.setTargetAtTime(value, t, RAMP / 3);
        this.dryGainInternal.gain.setTargetAtTime(1 - value, t, RAMP / 3);
        break;
      default:
        break;
    }
  }
}

defineEffect({
  type: 'chorus',
  label: 'Chorus',
  group: 'modulation',
  klass: Chorus,
  params: [
    { key: 'voices', label: 'Voices', type: 'knob', min: 2, max: 3, default: 3, step: 1, group: 'Voices' },
    { key: 'rate', label: 'Rate', type: 'knob', min: 0.05, max: 8, default: 0.8, curve: 'log', unit: 'Hz', group: 'Modulation' },
    { key: 'depth', label: 'Depth', type: 'knob', min: 0, max: 10, default: 3, unit: 'ms', group: 'Modulation' },
    { key: 'spread', label: 'Spread', type: 'knob', min: 0, max: 1, default: 0.7, group: 'Modulation' },
    { key: 'mix', label: 'Mix', type: 'knob', min: 0, max: 1, default: 0.4, group: 'Mix' },
  ],
  presets: {
    'Subtle Ensemble': { voices: 3, rate: 0.4, depth: 1.5, spread: 0.5, mix: 0.25 },
    'Classic 2-Voice': { voices: 2, rate: 0.8, depth: 3, spread: 0.6, mix: 0.4 },
    'Wide Lush': { voices: 3, rate: 0.6, depth: 5, spread: 1, mix: 0.55 },
    'Fast Shimmer': { voices: 3, rate: 3.2, depth: 2, spread: 0.8, mix: 0.4 },
    'Vintage Tape Chorus': { voices: 2, rate: 0.25, depth: 6, spread: 0.4, mix: 0.5 },
  },
});
