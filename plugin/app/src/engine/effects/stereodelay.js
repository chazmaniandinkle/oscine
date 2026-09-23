// Stereo (ping-pong capable) delay. Modelled on the classic "dual-tap
// stereo delay" plugin shape (e.g. Ableton's Delay / Soundtoys EchoBoy's
// simple mode): independent L/R delay times (free seconds or tempo-synced
// divisions), one feedback amount, a cross-feed knob that blends each
// channel's repeats into the opposite channel (0 = parallel L/R delay,
// 1 = full ping-pong bounce), a damping low-pass in the feedback path so
// repeats darken over time, and a wet/dry mix.
//
// Signal flow (per channel c in {L, R}, mirrored):
//
//   wetIn -> splitter -> delay[c] -> damp[c] (LP) -> feedback[c] (Gain)
//                                                   -> panPost? no
//   feedback[c] fans out to:
//     -> delay[c]           (straight repeats, weight = 1 - crossfeed)
//     -> delay[other]       (cross-feed repeats, weight = crossfeed)
//   delay[c] -> merger -> wetGain (mix) -> wetOut
//
// Implemented with two ChannelSplitter/Merger-free DelayNodes fed from a
// ChannelSplitterNode(2) so mono or stereo input both work (mono input
// gets duplicated to both delay taps by the splitter's channel behavior
// only when the input actually carries 2 channels; ChannelSplitterNode
// always exposes channel 0/1, silent if absent, which is the standard
// Web Audio way to get independent L/R processing).
//
// TEMPO SYNC: this effect declares `tempoSynced: true`. `timeMode` selects
// whether `timeL`/`timeR` are read as milliseconds (free) or as beat
// divisions (synced, values are fractions of a quarter note — 0.25 =
// 1/16, 1 = 1/4, 2 = 1/2, matching DELAY_DIVISIONS in the legacy
// effects/delay.js). When synced, applyParam('bpm', bpm) is called by the
// host on every tempo change; the effect recomputes seconds from the last
// known timeL/timeR beat values. In free mode `timeL`/`timeR` are taken
// directly as milliseconds and `bpm` is ignored.

import { BaseEffect } from './registry.js';
import { defineEffect } from './registry.js';

const RAMP = 0.02; // seconds, <= 20ms rule
const MAX_DELAY_SEC = 4;

const TIME_MODE_OPTIONS = [
  { value: 'free', label: 'Free (ms)' },
  { value: 'synced', label: 'Synced (beats)' },
];

function beatsToSeconds(beats, bpm) {
  return (beats * 60) / Math.max(1, bpm);
}

class StereoDelay extends BaseEffect {
  constructor(ctx, params, def) {
    super(ctx, params, def);

    this._bpm = 120; // updated by the 'bpm' pseudo-param when tempoSynced

    this.splitter = ctx.createChannelSplitter(2);
    this.merger = ctx.createChannelMerger(2);

    this.delayL = ctx.createDelay(MAX_DELAY_SEC);
    this.delayR = ctx.createDelay(MAX_DELAY_SEC);
    this.dampL = ctx.createBiquadFilter();
    this.dampR = ctx.createBiquadFilter();
    this.dampL.type = 'lowpass';
    this.dampR.type = 'lowpass';
    this.fbL = ctx.createGain();
    this.fbR = ctx.createGain();
    // Cross-feed sub-gains: each feedback tap splits into "back into same
    // channel" and "into the other channel" branches, weighted by the
    // crossfeed knob (set in applyParam so both weights always sum to
    // this channel's feedback amount).
    this.fbL_toL = ctx.createGain();
    this.fbL_toR = ctx.createGain();
    this.fbR_toR = ctx.createGain();
    this.fbR_toL = ctx.createGain();

    this.wetGain = ctx.createGain();
    this.dryGainInternal = ctx.createGain(); // internal mix (separate from BaseEffect bypass dry)

    // wetIn -> split -> per-channel delay chain -> merge -> mix -> wetOut
    this.wetIn.connect(this.splitter);
    this.splitter.connect(this.delayL, 0);
    this.splitter.connect(this.delayR, 1);

    this.delayL.connect(this.dampL);
    this.delayR.connect(this.dampR);
    this.dampL.connect(this.fbL);
    this.dampR.connect(this.fbR);

    this.fbL.connect(this.fbL_toL);
    this.fbL.connect(this.fbL_toR);
    this.fbR.connect(this.fbR_toR);
    this.fbR.connect(this.fbR_toL);
    this.fbL_toL.connect(this.delayL);
    this.fbR_toL.connect(this.delayL);
    this.fbR_toR.connect(this.delayR);
    this.fbL_toR.connect(this.delayR);

    this.dampL.connect(this.merger, 0, 0);
    this.dampR.connect(this.merger, 0, 1);
    this.merger.connect(this.wetGain);
    this.wetGain.connect(this.wetOut);

    // Dry pass-through for the internal mix knob (independent of
    // BaseEffect's bypass crossfade, which handles the plugin-level
    // on/off; this is the plugin's own wet/dry blend, like a real delay
    // plugin's mix knob).
    this.wetIn.connect(this.dryGainInternal);
    this.dryGainInternal.connect(this.wetOut);
  }

  _applyCrossfeed() {
    const t = this.ctx.currentTime;
    const fb = Math.min(this.params.feedback ?? 0.35, 0.97);
    const cf = this.params.crossfeed ?? 0;
    this.fbL_toL.gain.setTargetAtTime(fb * (1 - cf), t, RAMP / 3);
    this.fbL_toR.gain.setTargetAtTime(fb * cf, t, RAMP / 3);
    this.fbR_toR.gain.setTargetAtTime(fb * (1 - cf), t, RAMP / 3);
    this.fbR_toL.gain.setTargetAtTime(fb * cf, t, RAMP / 3);
  }

  _applyTimeL() {
    const t = this.ctx.currentTime;
    const mode = this.params.timeMode ?? 'free';
    const raw = this.params.timeL ?? 250;
    const sec = mode === 'synced'
      ? Math.min(beatsToSeconds(raw, this._bpm), MAX_DELAY_SEC - 0.05)
      : Math.min(raw / 1000, MAX_DELAY_SEC - 0.05);
    this.delayL.delayTime.setTargetAtTime(Math.max(0.001, sec), t, RAMP / 3);
  }

  _applyTimeR() {
    const t = this.ctx.currentTime;
    const mode = this.params.timeMode ?? 'free';
    const raw = this.params.timeR ?? 375;
    const sec = mode === 'synced'
      ? Math.min(beatsToSeconds(raw, this._bpm), MAX_DELAY_SEC - 0.05)
      : Math.min(raw / 1000, MAX_DELAY_SEC - 0.05);
    this.delayR.delayTime.setTargetAtTime(Math.max(0.001, sec), t, RAMP / 3);
  }

  applyParam(key, value) {
    const t = this.ctx.currentTime;
    switch (key) {
      case 'bpm': // host-pushed pseudo-param, only meaningful when tempoSynced
        this._bpm = value;
        if (this.params.timeMode === 'synced') { this._applyTimeL(); this._applyTimeR(); }
        break;
      case 'timeMode':
        this._applyTimeL();
        this._applyTimeR();
        break;
      case 'timeL':
        this._applyTimeL();
        break;
      case 'timeR':
        this._applyTimeR();
        break;
      case 'feedback':
      case 'crossfeed':
        this._applyCrossfeed();
        break;
      case 'damping':
        this.dampL.frequency.setTargetAtTime(value, t, RAMP / 3);
        this.dampR.frequency.setTargetAtTime(value, t, RAMP / 3);
        break;
      case 'mix':
        this.wetGain.gain.setTargetAtTime(value, t, RAMP / 3);
        this.dryGainInternal.gain.setTargetAtTime(1 - value, t, RAMP / 3);
        break;
      default:
        break;
    }
  }
}

defineEffect({
  type: 'stereodelay',
  label: 'Stereo Delay',
  group: 'time',
  klass: StereoDelay,
  tempoSynced: true,
  params: [
    { key: 'timeMode', label: 'Time Mode', type: 'select', options: TIME_MODE_OPTIONS, default: 'free', group: 'Time' },
    { key: 'timeL', label: 'Time L', type: 'knob', min: 1, max: 2000, default: 250, curve: 'log', unit: 'ms', group: 'Time' },
    { key: 'timeR', label: 'Time R', type: 'knob', min: 1, max: 2000, default: 375, curve: 'log', unit: 'ms', group: 'Time' },
    { key: 'feedback', label: 'Feedback', type: 'knob', min: 0, max: 0.97, default: 0.35, group: 'Feedback' },
    { key: 'crossfeed', label: 'Cross-feed', type: 'knob', min: 0, max: 1, default: 0, unit: '%', group: 'Feedback' },
    { key: 'damping', label: 'Damping', type: 'knob', min: 500, max: 18000, default: 6000, curve: 'log', unit: 'Hz', group: 'Feedback' },
    { key: 'mix', label: 'Mix', type: 'knob', min: 0, max: 1, default: 0.35, group: 'Mix' },
  ],
  presets: {
    'Slap Parallel': { timeMode: 'free', timeL: 90, timeR: 90, feedback: 0.12, crossfeed: 0, damping: 9000, mix: 0.25 },
    'Ping-Pong 1/8': { timeMode: 'synced', timeL: 0.5, timeR: 0.5, feedback: 0.42, crossfeed: 1, damping: 6500, mix: 0.35 },
    'Dotted 1/8 Groove': { timeMode: 'synced', timeL: 0.75, timeR: 0.5, feedback: 0.38, crossfeed: 0.6, damping: 5500, mix: 0.3 },
    'Wide Free Delay': { timeMode: 'free', timeL: 310, timeR: 480, feedback: 0.5, crossfeed: 0.3, damping: 4000, mix: 0.4 },
    'Dub Echo': { timeMode: 'synced', timeL: 1, timeR: 1, feedback: 0.68, crossfeed: 0.8, damping: 2200, mix: 0.5 },
  },
});
