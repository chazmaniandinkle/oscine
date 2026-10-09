// Game Boy APU instruments (2026-10-08): gbpulse, gbwave, gbnoise.
//
// Each note is rendered sample-by-sample from the hardware model into an
// AudioBuffer, then played. Nothing here is a filter imitation of a chip:
//   pitch   MIDI -> 11-bit frequency register (x = 2048 - 131072/f, rounded),
//           so the GB's own out-of-tune top end comes through.
//           pulse f = 131072/(2048-x); wave f = 65536/(2048-x)
//   pulse   duty 12.5/25/50/75%, 4-bit volume, NRx2 envelope (one step every
//           period/64 s), optional NR10 sweep, software vibrato like the drivers
//   wave    32 x 4-bit sample table, output shift 100/50/25%
//   noise   15- or 7-bit LFSR clocked at 524288 / r / 2^(s+1) Hz (NR43),
//           drum = a sequence of register writes per 60 Hz frame (how Crystal's
//           drumkits and the Oracles noise table work)
// Rendered at 4x and box-decimated to soften aliasing; DC is removed per
// voice (the hardware's output capacitor does the same).

import { BaseInstrument } from './base.js';
import { defineInstrument } from './registry.js';
import { WAVES, DRUMS, BUILTIN_WAVES } from './gbdata.js';

const OS = 4;
const FRAME = 1 / 59.7275;

export function regFor(f, wave = false) {
  const x = Math.round(2048 - (wave ? 65536 : 131072) / f);
  return Math.max(0, Math.min(2047, x));
}
export const freqOfReg = (x, wave = false) => (wave ? 65536 : 131072) / (2048 - x);
const midiHz = m => 440 * Math.pow(2, (m - 69) / 12);

// 4-bit volume envelope value at time t (seconds since trigger).
function envAt(vol0, period, up, t) {
  if (!period) return vol0;
  const steps = Math.floor(t * 64 / period);
  return up ? Math.min(15, vol0 + steps) : Math.max(0, vol0 - steps);
}

function finish(ctx, data) {
  // decimate OSx -> 1 (box), remove DC, short fade at the end (note cut click)
  const n = Math.floor(data.length / OS), out = new Float32Array(n);
  let mean = 0;
  for (let i = 0; i < n; i++) { let s = 0; for (let k = 0; k < OS; k++) s += data[i * OS + k]; out[i] = s / OS; mean += out[i]; }
  mean /= Math.max(1, n);
  const fade = Math.min(n, Math.round(ctx.sampleRate * 0.003));
  for (let i = 0; i < n; i++) { out[i] -= mean; if (i >= n - fade) out[i] *= (n - i) / fade; }
  const buf = ctx.createBuffer(1, Math.max(1, n), ctx.sampleRate);
  buf.getChannelData(0).set(out);
  return buf;
}

export function renderPulse(ctx, midi, dur, p, vel = 1) {
  const sr = ctx.sampleRate * OS, n = Math.ceil(dur * sr), d = new Float32Array(n);
  const duty = [0.125, 0.25, 0.5, 0.75][p.duty | 0];
  let reg = regFor(midiHz(midi + (p.transpose || 0)));
  const vol0 = Math.max(1, Math.round(p.volume * vel));
  let ph = 0, nextSweep = p.sweepPeriod ? p.sweepPeriod / 128 : Infinity;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if (t >= nextSweep) { // NR10: x +/- x >> shift, every period/128 s
      const dx = reg >> p.sweepShift; reg = p.sweepDown ? reg - dx : reg + dx;
      if (reg > 2047 || reg < 0) break;
      nextSweep += p.sweepPeriod / 128;
    }
    let f = freqOfReg(reg);
    if (p.vibDepth && t > p.vibDelay) f *= Math.pow(2, p.vibDepth / 1200 * Math.sin(2 * Math.PI * p.vibRate * (t - p.vibDelay)));
    ph += f / sr; ph -= Math.floor(ph);
    const v = envAt(vol0, p.envPeriod | 0, !!p.envUp, t);
    // centred per sample: (bit - duty) keeps the waveform zero-mean at every volume, so an envelope
    // can't turn the duty-cycle DC into a slow sub-bass drift (found in 'Porch Light': decaying 25% keys read 44% sub)
    d[i] = ((ph < duty ? 1 : 0) - duty) * 2 * v / 15;
  }
  return finish(ctx, d);
}

export function renderWave(ctx, midi, dur, p, vel = 1) {
  const sr = ctx.sampleRate * OS, n = Math.ceil(dur * sr), d = new Float32Array(n);
  const table = WAVES[p.wave] || BUILTIN_WAVES.triangle;
  const shift = [0, 1, 2][p.shift | 0];
  const reg = regFor(midiHz(midi + (p.transpose || 0)), true);
  let f = freqOfReg(reg, true), ph = 0;
  const g = vel;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let ff = f;
    if (p.vibDepth && t > p.vibDelay) ff *= Math.pow(2, p.vibDepth / 1200 * Math.sin(2 * Math.PI * p.vibRate * (t - p.vibDelay)));
    if (p.pitchDrop) ff *= Math.pow(2, -p.pitchDrop * Math.min(1, t / Math.max(0.005, p.dropTime)) / 12);
    ph += ff * 32 / sr; ph -= Math.floor(ph / 32) * 32;
    const nyb = table[Math.floor(ph) & 31] >> shift;
    d[i] = (nyb / 7.5 - (15 >> shift) / 15) * g;
  }
  return finish(ctx, d);
}

// One drum: steps [{frames, vol, envPeriod, envUp, nr43}], last step rings for `tail` s.
export function renderNoise(ctx, steps, tail, vel = 1, tune = 0) {
  const sr = ctx.sampleRate * OS;
  const total = steps.slice(0, -1).reduce((a, s) => a + s.frames * FRAME, 0) + tail;
  const n = Math.ceil(total * sr), d = new Float32Array(n);
  let lfsr = 0x7fff, acc = 0, si = 0, stepStart = 0;
  const stepLen = s => (si === steps.length - 1 ? Infinity : s.frames * FRAME);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    while (t - stepStart >= stepLen(steps[si])) { stepStart += steps[si].frames * FRAME; si++; }
    const s = steps[si];
    const shiftClk = (s.nr43 >> 4) & 15, width7 = !!(s.nr43 & 8), r = s.nr43 & 7;
    const v = envAt(Math.round(s.vol * vel), s.envPeriod | 0, !!s.envUp, t - stepStart);
    if (shiftClk < 14) {
      const clk = 524288 / (r === 0 ? 0.5 : r) / Math.pow(2, shiftClk + 1) * Math.pow(2, tune / 12);
      acc += clk / sr;
      while (acc >= 1) {
        acc -= 1;
        const bit = (lfsr ^ (lfsr >> 1)) & 1;
        lfsr = (lfsr >> 1) | (bit << 14);
        if (width7) lfsr = (lfsr & ~0x40) | (bit << 6);
      }
    }
    d[i] = ((lfsr & 1) ? -1 : 1) * v / 15;
  }
  return finish(ctx, d);
}

// LSDj-style kick: the wave channel with a fast pitch drop (the GB has no
// kick drum; trackers fake one this way).
function renderWaveKick(ctx, p, vel) {
  return renderWave(ctx, 33 + p.kickTune, p.kickDecay, { wave: 'triangle', shift: 0, pitchDrop: 30, dropTime: p.kickDecay * 0.6 }, vel);
}

const cache = new WeakMap();
function cached(ctx, key, make) {
  let m = cache.get(ctx); if (!m) { m = new Map(); cache.set(ctx, m); }
  let b = m.get(key); if (!b) { b = make(); m.set(key, b); if (m.size > 600) m.delete(m.keys().next().value); }
  return b;
}

class GBVoiced extends BaseInstrument {
  constructor(ctx, params, def) { super(ctx, params, def); this.live = new Set(); }
  play(time, buf, gain = 1) {
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const g = this.ctx.createGain(); g.gain.value = gain;
    src.connect(g).connect(this.output); src.start(time);
    this.live.add(src); src.onended = () => { this.live.delete(src); try { g.disconnect(); } catch { /* ok */ } };
    return src;
  }
  allOff() { for (const s of this.live) { try { s.stop(); } catch { /* ok */ } } this.live.clear(); }
}

class GBPulse extends GBVoiced {
  noteOn(time, midi, vel = 0.9, durSec = null) {
    const p = this.params, dur = Math.max(0.02, (durSec ?? 0.5)) * p.gate;
    const q = Math.round(dur * 120) / 120; // quantise length: GB drivers count frames
    const key = `p|${midi}|${q}|${Math.round(vel * 15)}|${JSON.stringify(p)}`;
    this.play(time, cached(this.ctx, key, () => renderPulse(this.ctx, midi, q, p, vel)));
  }
}
class GBWave extends GBVoiced {
  noteOn(time, midi, vel = 0.9, durSec = null) {
    const p = this.params, dur = Math.max(0.02, (durSec ?? 0.5)) * p.gate;
    const q = Math.round(dur * 120) / 120;
    const key = `w|${midi}|${q}|${Math.round(vel * 15)}|${JSON.stringify(p)}`;
    this.play(time, cached(this.ctx, key, () => renderWave(this.ctx, midi, q, p, vel)));
  }
}
const LANE_SRC = { kick: 'kickSrc', snare: 'snareSrc', hat: 'hatSrc', ohat: 'ohatSrc', perc: 'percSrc', crash: 'crashSrc' };
class GBNoise extends GBVoiced {
  constructor(ctx, params, def) { super(ctx, params, def); this.choke = null; }
  trigger(lane, time, vel = 1) {
    const p = this.params, src = p[LANE_SRC[lane]];
    if (!src) return;
    const v = Math.max(1 / 15, Math.min(1, vel));
    let buf;
    if (src === 'wavekick') buf = cached(this.ctx, `k|${p.kickTune}|${p.kickDecay}|${Math.round(v * 15)}`, () => renderWaveKick(this.ctx, p, v));
    else {
      const steps = DRUMS[src]; if (!steps) return;
      const tail = lane === 'crash' ? 1.2 * p.crashDecay : lane === 'ohat' ? 0.35 : lane === 'kick' ? 0.18 : 0.22;
      buf = cached(this.ctx, `n|${src}|${tail}|${Math.round(v * 15)}|${p.noiseTune}`, () => renderNoise(this.ctx, steps, tail, v, p.noiseTune));
    }
    if (lane === 'hat' && this.choke) { try { this.choke.stop(time); } catch { /* ok */ } this.choke = null; }
    const s = this.play(time, buf, p[`${lane}Level`] ?? 1);
    if (lane === 'ohat') this.choke = s;
  }
}

const K = (key, label, min, max, def, extra = {}) => ({ key, label, type: 'knob', min, max, default: def, ...extra });
const DUTY = { key: 'duty', label: 'Duty', type: 'select', options: [{ value: 0, label: '12.5%' }, { value: 1, label: '25%' }, { value: 2, label: '50%' }, { value: 3, label: '75%' }], default: 2, group: 'Pulse' };
const VIB = [K('vibDepth', 'Vib Depth', 0, 100, 0, { unit: 'ct', group: 'Vibrato' }), K('vibRate', 'Vib Rate', 1, 12, 5.5, { unit: 'Hz', group: 'Vibrato' }), K('vibDelay', 'Vib Delay', 0, 1, 0.15, { unit: 's', group: 'Vibrato' })];

defineInstrument({
  type: 'gbpulse', label: 'GB Pulse', kind: 'synth', klass: GBPulse,
  params: [
    DUTY,
    K('volume', 'Volume', 1, 15, 12, { step: 1, group: 'Envelope' }),
    K('envPeriod', 'Env Period', 0, 7, 0, { step: 1, group: 'Envelope' }),
    { key: 'envUp', label: 'Env Dir', type: 'select', options: [{ value: 0, label: 'Down' }, { value: 1, label: 'Up' }], default: 0, group: 'Envelope' },
    K('sweepPeriod', 'Sweep Per', 0, 7, 0, { step: 1, group: 'Sweep' }),
    K('sweepShift', 'Sweep Shift', 1, 7, 2, { step: 1, group: 'Sweep' }),
    { key: 'sweepDown', label: 'Sweep Dir', type: 'select', options: [{ value: 0, label: 'Up' }, { value: 1, label: 'Down' }], default: 1, group: 'Sweep' },
    ...VIB,
    K('transpose', 'Transpose', -24, 24, 0, { step: 1, unit: 'st', group: 'Voice' }),
    K('gate', 'Gate', 0.1, 1, 0.92, { group: 'Voice' }),
    K('level', 'Level', 0, 1, 0.5, { group: 'Voice' }),
  ],
  presets: {
    'Lead 25%': { duty: 1, volume: 12, envPeriod: 0, vibDepth: 18, vibRate: 6, vibDelay: 0.12 },
    'Square 50%': { duty: 2, volume: 11, envPeriod: 0 },
    'Thin 12.5%': { duty: 0, volume: 12, envPeriod: 0 },
    'Pluck': { duty: 1, volume: 14, envPeriod: 1, gate: 1 },
    'Arp Stab': { duty: 0, volume: 13, envPeriod: 1, gate: 0.6 },
    'Swell': { duty: 2, volume: 2, envPeriod: 2, envUp: 1 },
    'Zap': { duty: 2, volume: 15, envPeriod: 1, sweepPeriod: 1, sweepShift: 2, sweepDown: 1 },
  },
});

const WAVE_OPTS = Object.keys(WAVES).map(k => ({ value: k, label: k }));
const has = k => WAVES[k] ? k : 'triangle';
defineInstrument({
  type: 'gbwave', label: 'GB Wave', kind: 'synth', klass: GBWave,
  params: [
    { key: 'wave', label: 'Wave', type: 'select', options: WAVE_OPTS, default: 'triangle', group: 'Wave' },
    { key: 'shift', label: 'Output', type: 'select', options: [{ value: 0, label: '100%' }, { value: 1, label: '50%' }, { value: 2, label: '25%' }], default: 0, group: 'Wave' },
    ...VIB,
    K('transpose', 'Transpose', -24, 24, 0, { step: 1, unit: 'st', group: 'Voice' }),
    K('gate', 'Gate', 0.1, 1, 0.95, { group: 'Voice' }),
    K('level', 'Level', 0, 1, 0.6, { group: 'Voice' }),
  ],
  presets: {
    'Triangle Bass': { wave: 'triangle' },
    'Saw Bass': { wave: 'saw' },
    'Bump Bass': { wave: 'bass-bump' },
    'Crystal 0': { wave: has('crystal:0') },
    'Crystal 2': { wave: has('crystal:2') },
    'Crystal 5': { wave: has('crystal:5') },
    'Oracles Square': { wave: has('oracles:0e:WF_SQUARE_50_VOL_8') },
  },
});

const DRUM_OPTS = [{ value: '', label: '(off)' }, { value: 'wavekick', label: 'wave kick (LSDj)' }, ...Object.keys(DRUMS).map(k => ({ value: k, label: k }))];
const pick = (...ks) => ks.find(k => k === 'wavekick' || DRUMS[k]) ?? '';
const SRC = (key, label, def) => ({ key, label, type: 'select', options: DRUM_OPTS, default: def, group: 'Sources' });
defineInstrument({
  type: 'gbnoise', label: 'GB Noise Kit', kind: 'drums', klass: GBNoise,
  lanes: [{ id: 'kick', label: 'Kick' }, { id: 'snare', label: 'Snare' }, { id: 'hat', label: 'Hat' }, { id: 'ohat', label: 'Open Hat' }, { id: 'perc', label: 'Perc' }, { id: 'crash', label: 'Crash' }],
  params: [
    SRC('kickSrc', 'Kick', 'wavekick'),
    SRC('snareSrc', 'Snare', pick('crystal:Snare1', 'snare')),
    SRC('hatSrc', 'Hat', pick('crystal:HiHat1', 'hat')),
    SRC('ohatSrc', 'Open Hat', pick('crystal:HiHat3', 'ohat')),
    SRC('percSrc', 'Perc', pick('crystal:Triangle3', 'metal')),
    SRC('crashSrc', 'Crash', pick('crystal:Crash1', 'crash')),
    K('kickTune', 'Kick Tune', -12, 12, 0, { step: 1, unit: 'st', group: 'Kick' }),
    K('kickDecay', 'Kick Dec', 0.05, 0.5, 0.16, { unit: 's', group: 'Kick' }),
    K('noiseTune', 'Noise Tune', -12, 12, 0, { step: 1, unit: 'st', group: 'Noise' }),
    K('crashDecay', 'Crash Dec', 0.2, 3, 1, { group: 'Noise' }),
    K('kickLevel', 'Kick Lvl', 0, 1.5, 1, { group: 'Levels' }),
    K('snareLevel', 'Snare Lvl', 0, 1.5, 0.8, { group: 'Levels' }),
    K('hatLevel', 'Hat Lvl', 0, 1.5, 0.5, { group: 'Levels' }),
    K('ohatLevel', 'OHat Lvl', 0, 1.5, 0.45, { group: 'Levels' }),
    K('percLevel', 'Perc Lvl', 0, 1.5, 0.6, { group: 'Levels' }),
    K('crashLevel', 'Crash Lvl', 0, 1.5, 0.5, { group: 'Levels' }),
    K('level', 'Level', 0, 1, 0.8, { group: 'Levels' }),
  ],
  presets: {
    'Crystal Kit': { snareSrc: pick('crystal:Snare1', 'snare'), hatSrc: pick('crystal:HiHat1', 'hat'), ohatSrc: pick('crystal:HiHat3', 'ohat'), percSrc: pick('crystal:Triangle3', 'metal'), crashSrc: pick('crystal:Crash1', 'crash') },
    'Generic GB': { kickSrc: 'wavekick', snareSrc: 'snare', hatSrc: 'hat', ohatSrc: 'ohat', percSrc: 'metal', crashSrc: 'crash' },
  },
});
