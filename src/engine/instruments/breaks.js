// Breaks: a drum instrument for 170+ BPM music, designed by ear (2026-10-08)
// after the June kit's single tone knob made the hats and kick move together.
// Every lane has its OWN tune / decay / level / tone params (kickTune,
// snareDecay, hatTone...), so set_params shapes one voice without touching
// the others. Noise comes from a seeded buffer: two renders of the same
// pattern are sample-identical, so the ear compares edits, not randomness.
//
// Voices:
//   kick    sine body with a fast pitch drop + short transient click + optional
//           drive; a separate sub tail (pure sine, no drop) for the low end.
//   snare   two-mode body (pitched) + bandpassed noise with its own decay.
//   rim     short high body for ghost notes.
//   chat/ohat  6 square partials at inharmonic ratios (the 808 recipe) through
//           a high-pass: metallic, not white-noise hiss. ohat chokes on chat.
//   ride    same metal, longer, bandpassed brighter.
//   shaker  high-passed seeded noise, very short.
//   crash   metal + noise, long.

import { BaseInstrument } from './base.js';
import { defineInstrument } from './registry.js';

const noiseCache = new WeakMap();
function seededNoise(ctx) {
  let b = noiseCache.get(ctx);
  if (!b) {
    const len = ctx.sampleRate * 2; b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0); let s = 0x9e3779b9;
    for (let i = 0; i < len; i++) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; d[i] = ((s >>> 0) / 4294967296) * 2 - 1; }
    noiseCache.set(ctx, b);
  }
  return b;
}
function driveCurve(k) {
  const n = 1024, c = new Float32Array(n), kk = 1 + k * 20;
  for (let i = 0; i < n; i++) { const x = i * 2 / n - 1; c[i] = Math.tanh(kk * x) / Math.tanh(kk); }
  return c;
}
const METAL = [1, 1.4471, 1.6170, 1.9265, 2.5028, 2.6637];

class Breaks extends BaseInstrument {
  constructor(ctx, params, def) {
    super(ctx, params, def);
    this.ohat = null;
    // Everything goes through a 15 Hz high-pass: the driven kick is asymmetric and
    // would otherwise leave DC (measured -0.0028 before this block).
    this.out = ctx.createBiquadFilter(); this.out.type = 'highpass'; this.out.frequency.value = 15; this.out.Q.value = 0.707;
    this.out.connect(this.output);
    this.kickShaper = ctx.createWaveShaper(); this.kickShaper.curve = driveCurve(this.params.kickDrive);
    this.kickShaper.connect(this.out);
  }
  onParam(key) { if (key === 'kickDrive') this.kickShaper.curve = driveCurve(this.params.kickDrive); }
  P(k) { return this.params[k]; }
  semis(k) { return Math.pow(2, this.params[k] / 12); }

  env(g, t, peak, dec, att = 0.0008) {
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + att);
    g.gain.setTargetAtTime(0, t + att, dec / 4);
  }
  noise(t, dur, dest, { hp, bp, bpQ = 1, lp } = {}) {
    const ctx = this.ctx, src = ctx.createBufferSource(); src.buffer = seededNoise(ctx); src.loop = true;
    let n = src;
    for (const [type, f, q] of [['highpass', hp], ['bandpass', bp, bpQ], ['lowpass', lp]]) {
      if (!f) continue; const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q) b.Q.value = q; n.connect(b); n = b;
    }
    n.connect(dest); src.start(t, (t * 7919) % 1.5); src.stop(t + dur);
  }
  metal(t, base, dur, dest, hp, bp) {
    // 6 square partials summed once into a cached 1 s buffer per (base) pitch, then
    // played as a buffer: identical sound to 6 live oscillators per hit, but one node
    // instead of six. Profiling (2026-10-08): 431 kit hits over 16 bars took 4.8 s
    // to render offline with live oscillators; the hats were most of it.
    const ctx = this.ctx;
    this._metal ??= new Map();
    let buf = this._metal.get(base);
    if (!buf) {
      const sr = ctx.sampleRate, len = Math.ceil(sr * 2.2); buf = ctx.createBuffer(1, len, sr);
      const d = buf.getChannelData(0);
      for (const r of METAL) { const f = base * r, per = sr / f; for (let i = 0; i < len; i++) d[i] += ((i % per) < per / 2 ? 1 : -1) * 0.42; }
      this._metal.set(base, buf);
    }
    const src = ctx.createBufferSource(); src.buffer = buf;
    const h = ctx.createBiquadFilter(); h.type = 'highpass'; h.frequency.value = hp;
    let n = src.connect(h);
    if (bp) { const b = ctx.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = bp; b.Q.value = 0.7; n = n.connect(b); }
    n.connect(dest); src.start(t); src.stop(t + Math.min(dur, 2.2));
  }

  trigger(lane, t, vel = 1) {
    const ctx = this.ctx, v = vel;
    switch (lane) {
      case 'kick': {
        const tune = this.semis('kickTune'), dk = this.P('kickDecay'), lvl = this.P('kickLevel') * v;
        // body: 55 Hz-ish with a fast drop from ~4x
        const o = ctx.createOscillator(); o.type = 'sine';
        const f0 = 52 * tune;
        o.frequency.setValueAtTime(f0 * 4.2, t); o.frequency.exponentialRampToValueAtTime(f0 * 1.6, t + 0.012);
        o.frequency.exponentialRampToValueAtTime(f0, t + 0.06);
        const g = ctx.createGain(); this.env(g, t, lvl, 0.22 * dk, 0.0005);
        o.connect(g).connect(this.kickShaper); o.start(t); o.stop(t + 0.22 * dk * 1.6 + 0.05);
        // click: the transient that cuts through a bass
        const cg = ctx.createGain(); this.env(cg, t, lvl * this.P('kickClick'), 0.012, 0.0003);
        this.noise(t, 0.02, cg, { hp: 2500, lp: 9000 }); cg.connect(this.out);
        break;
      }
      case 'snare': {
        const tune = this.semis('snareTune'), dk = this.P('snareDecay'), lvl = this.P('snareLevel') * v, tone = this.P('snareTone');
        for (const [f, a] of [[185, 0.55], [330, 0.3]]) {
          const o = ctx.createOscillator(); o.type = 'triangle';
          o.frequency.setValueAtTime(f * tune * 1.5, t); o.frequency.exponentialRampToValueAtTime(f * tune, t + 0.02);
          const g = ctx.createGain(); this.env(g, t, lvl * a * (1 - tone * 0.5), 0.09 * dk); o.connect(g).connect(this.out);
          o.start(t); o.stop(t + 0.3 * dk + 0.05);
        }
        const ng = ctx.createGain(); this.env(ng, t, lvl * (0.45 + tone * 0.5), 0.17 * dk);
        this.noise(t, 0.5 * dk + 0.05, ng, { hp: 900, bp: 3800 + tone * 2500, bpQ: 0.5 }); ng.connect(this.out);
        break;
      }
      case 'rim': {
        const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 1700 * this.semis('snareTune');
        const g = ctx.createGain(); this.env(g, t, this.P('snareLevel') * v * 0.35, 0.025); o.connect(g).connect(this.out);
        o.start(t); o.stop(t + 0.08);
        const ng = ctx.createGain(); this.env(ng, t, this.P('snareLevel') * v * 0.25, 0.03);
        this.noise(t, 0.06, ng, { hp: 2000, bp: 5000 }); ng.connect(this.out);
        break;
      }
      case 'chat': case 'ohat': {
        const open = lane === 'ohat', lvl = this.P('hatLevel') * v * (open ? 0.8 : 1);
        if (this.ohat) { try { this.ohat.gain.cancelScheduledValues(t); this.ohat.gain.setTargetAtTime(0, t, 0.006); } catch { /* ok */ } this.ohat = null; }
        const dec = (open ? 0.42 : 0.045) * this.P('hatDecay');
        const g = ctx.createGain(); this.env(g, t, lvl, dec, 0.0004);
        this.metal(t, 330 * this.semis('hatTune'), dec * 1.4 + 0.03, g, 6500 + this.P('hatTone') * 3500, null);
        const ng = ctx.createGain(); this.env(ng, t, lvl * 0.35, dec * 0.8, 0.0004);
        this.noise(t, dec * 1.4 + 0.03, ng, { hp: 8000 }); ng.connect(this.out);
        g.connect(this.out); if (open) this.ohat = g;
        break;
      }
      case 'ride': {
        const lvl = this.P('hatLevel') * v * 0.6, dec = 0.9 * this.P('hatDecay');
        const g = ctx.createGain(); this.env(g, t, lvl, dec, 0.0004);
        this.metal(t, 520 * this.semis('hatTune'), dec * 1.2, g, 3000, 6500 + this.P('hatTone') * 2500); g.connect(this.out);
        break;
      }
      case 'shaker': {
        const g = ctx.createGain(); this.env(g, t, this.P('hatLevel') * v * 0.5, 0.035, 0.004);
        this.noise(t, 0.08, g, { hp: 6000 + this.P('hatTone') * 3000 }); g.connect(this.out);
        break;
      }
      case 'crash': {
        const lvl = this.P('hatLevel') * v * 0.7, dec = 1.8 * this.P('hatDecay');
        const g = ctx.createGain(); this.env(g, t, lvl, dec, 0.001);
        this.metal(t, 410, dec, g, 4000, null);
        this.noise(t, dec, g, { hp: 5000 }); g.connect(this.out);
        break;
      }
      default: break;
    }
  }
}

const K = (key, label, min, max, def, extra = {}) => ({ key, label, type: 'knob', min, max, default: def, ...extra });
defineInstrument({
  type: 'breaks',
  label: 'Breaks Kit',
  kind: 'drums',
  klass: Breaks,
  lanes: [
    { id: 'kick', label: 'Kick' }, { id: 'snare', label: 'Snare' }, { id: 'rim', label: 'Rim' },
    { id: 'chat', label: 'CH Hat' }, { id: 'ohat', label: 'OH Hat' }, { id: 'ride', label: 'Ride' },
    { id: 'shaker', label: 'Shaker' }, { id: 'crash', label: 'Crash' },
  ],
  params: [
    K('kickTune', 'Kick Tune', -12, 12, 0, { unit: 'st', group: 'Kick' }),
    K('kickDecay', 'Kick Dec', 0.3, 3, 1, { group: 'Kick' }),
    K('kickClick', 'Click', 0, 1, 0.45, { group: 'Kick' }),
    K('kickDrive', 'Drive', 0, 1, 0.25, { group: 'Kick' }),
    K('kickLevel', 'Kick Lvl', 0, 1.5, 1, { group: 'Kick' }),
    K('snareTune', 'Snare Tune', -12, 12, 0, { unit: 'st', group: 'Snare' }),
    K('snareDecay', 'Snare Dec', 0.3, 3, 1, { group: 'Snare' }),
    K('snareTone', 'Snare Tone', 0, 1, 0.55, { group: 'Snare' }),
    K('snareLevel', 'Snare Lvl', 0, 1.5, 0.9, { group: 'Snare' }),
    K('hatTune', 'Hat Tune', -12, 12, 0, { unit: 'st', group: 'Metal' }),
    K('hatDecay', 'Hat Dec', 0.3, 3, 1, { group: 'Metal' }),
    K('hatTone', 'Hat Tone', 0, 1, 0.5, { group: 'Metal' }),
    K('hatLevel', 'Hat Lvl', 0, 2, 0.9, { group: 'Metal' }),
    K('level', 'Level', 0, 1, 0.9, { group: 'Kit' }),
  ],
  presets: {
    'Rollers': { kickTune: 0, kickClick: 0.5, kickDrive: 0.25, snareTone: 0.55, hatTone: 0.5 },
    'Neuro Tight': { kickTune: 2, kickDecay: 0.7, kickClick: 0.7, kickDrive: 0.5, snareDecay: 0.8, snareTone: 0.75, hatDecay: 0.7, hatTone: 0.8 },
    'Liquid Soft': { kickTune: -1, kickClick: 0.25, kickDrive: 0.1, snareDecay: 1.3, snareTone: 0.4, hatLevel: 0.4, hatTone: 0.35 },
  },
});
