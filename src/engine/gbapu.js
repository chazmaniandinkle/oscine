// Game Boy APU: register-stream -> audio. Pure (no DOM, no Web Audio), so the
// same code runs in the browser (an Oscine provider) and in node (tests, bounces).
//
// Input: writes [[frame, reg, value]] where reg is 0x10..0x3f (FF10..FF3F) and
// frame counts 60 Hz driver ticks (writes inside a frame land at its start).
// This is the seam for "provider" engines: anything that can produce a register
// stream -- a game's own sound driver run on a CPU interpreter, a .gbs/.vgm
// file, a tracker -- plays through this one chip model.
//
// Modelled: both pulse channels (duty, length, NRx2 envelope, ch1 sweep), wave
// (32x4-bit RAM, output shift, length), noise (15/7-bit LFSR, NR43 clock,
// envelope, length), NR50 master volume, NR51 panning, NR52 power, DAC-off
// silencing. Not modelled: hardware quirks (zombie mode, wave-RAM corruption,
// obscure length-clock edge cases), the high-pass capacitor beyond a DC block.

export const FRAME_HZ = 59.7275;
const DUTY = [[0, 0, 0, 0, 0, 0, 0, 1], [1, 0, 0, 0, 0, 0, 0, 1], [1, 0, 0, 0, 0, 1, 1, 1], [0, 1, 1, 1, 1, 1, 1, 0]];

export function renderRegisterStream(writes, { sampleRate = 44100, seconds = null, oversample = 2 } = {}) {
  const lastFrame = writes.length ? writes[writes.length - 1][0] : 0;
  const total = seconds ?? (lastFrame + 30) / FRAME_HZ;
  const sr = sampleRate * oversample, n = Math.ceil(total * sr);
  const L = new Float32Array(Math.ceil(total * sampleRate)), R = new Float32Array(L.length);
  const reg = new Uint8Array(0x40);
  const wave = new Uint8Array(32);
  const pulse = () => ({ on: false, freq: 0, ph: 0, duty: 0, vol: 0, envDir: 0, envPer: 0, envT: 0, len: 0, lenOn: false, sweepPer: 0, sweepDir: 0, sweepShift: 0, sweepT: 0, dac: false });
  const ch1 = pulse(), ch2 = pulse();
  const ch3 = { on: false, freq: 0, ph: 0, shift: 0, len: 0, lenOn: false, dac: false };
  const ch4 = { on: false, lfsr: 0x7fff, acc: 0, vol: 0, envDir: 0, envPer: 0, envT: 0, len: 0, lenOn: false, dac: false, clk: 0, w7: false };
  let wi = 0, seq256 = 0, seq64 = 0, seq128 = 0;

  const apply = (r, v) => {
    reg[r] = v;
    if (r >= 0x30) { wave[(r - 0x30) * 2] = v >> 4; wave[(r - 0x30) * 2 + 1] = v & 15; return; }
    const P = r < 0x15 ? ch1 : ch2, base = r < 0x15 ? 0x10 : 0x15;
    if (r >= 0x10 && r <= 0x19) {
      const k = r - base;
      if (k === 0 && r === 0x10) { ch1.sweepPer = (v >> 4) & 7; ch1.sweepDir = (v >> 3) & 1; ch1.sweepShift = v & 7; }
      if (k === 1) { P.duty = v >> 6; P.len = 64 - (v & 63); }
      if (k === 2) { P.dac = (v & 0xf8) !== 0; if (!P.dac) P.on = false; }
      if (k === 3) P.freq = (P.freq & 0x700) | v;
      if (k === 4) {
        P.freq = (P.freq & 0xff) | ((v & 7) << 8); P.lenOn = !!(v & 0x40);
        if (v & 0x80) { // trigger
          P.on = P.dac; if (P.len === 0) P.len = 64;
          const e = reg[base + 2]; P.vol = e >> 4; P.envDir = (e >> 3) & 1; P.envPer = e & 7; P.envT = 0; P.sweepT = 0;
        }
      }
      return;
    }
    switch (r) {
      case 0x1a: ch3.dac = !!(v & 0x80); if (!ch3.dac) ch3.on = false; break;
      case 0x1b: ch3.len = 256 - v; break;
      case 0x1c: ch3.shift = [4, 0, 1, 2][(v >> 5) & 3]; break;
      case 0x1d: ch3.freq = (ch3.freq & 0x700) | v; break;
      case 0x1e: ch3.freq = (ch3.freq & 0xff) | ((v & 7) << 8); ch3.lenOn = !!(v & 0x40); if (v & 0x80) { ch3.on = ch3.dac; if (!ch3.len) ch3.len = 256; ch3.ph = 0; } break;
      case 0x20: ch4.len = 64 - (v & 63); break;
      case 0x21: ch4.dac = (v & 0xf8) !== 0; if (!ch4.dac) ch4.on = false; break;
      case 0x22: { const s = v >> 4, d = v & 7; ch4.w7 = !!(v & 8); ch4.clk = s >= 14 ? 0 : 524288 / (d === 0 ? 0.5 : d) / Math.pow(2, s + 1); break; }
      case 0x23: ch4.lenOn = !!(v & 0x40); if (v & 0x80) { ch4.on = ch4.dac; if (!ch4.len) ch4.len = 64; ch4.lfsr = 0x7fff; const e = reg[0x21]; ch4.vol = e >> 4; ch4.envDir = (e >> 3) & 1; ch4.envPer = e & 7; ch4.envT = 0; } break;
      default: break;
    }
  };
  const envTick = c => { if (!c.envPer) return; if (++c.envT >= c.envPer) { c.envT = 0; if (c.envDir && c.vol < 15) c.vol++; else if (!c.envDir && c.vol > 0) c.vol--; } };
  const lenTick = (c) => { if (c.lenOn && c.len > 0 && --c.len === 0) c.on = false; };

  const out = new Float32Array(2);
  let dcL = 0, dcR = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr, fr = t * FRAME_HZ;
    while (wi < writes.length && writes[wi][0] <= fr) { apply(writes[wi][1], writes[wi][2]); wi++; }
    // frame sequencer: 256 Hz length, 128 Hz sweep, 64 Hz envelope
    const s256 = Math.floor(t * 256);
    while (seq256 < s256) {
      seq256++; lenTick(ch1); lenTick(ch2); lenTick(ch3); lenTick(ch4);
      if (seq256 % 2 === 0 && ++seq128 && ch1.sweepPer) {
        if (++ch1.sweepT >= ch1.sweepPer) { ch1.sweepT = 0; const d = ch1.freq >> ch1.sweepShift; const nf = ch1.sweepDir ? ch1.freq - d : ch1.freq + d; if (nf > 2047) ch1.on = false; else if (ch1.sweepShift) ch1.freq = nf; }
      }
      if (seq256 % 4 === 0) { seq64++; envTick(ch1); envTick(ch2); envTick(ch4); }
    }
    if (!(reg[0x26] & 0x80)) continue;
    let s1 = 0, s2 = 0, s3 = 0, s4 = 0;
    for (const [c, idx] of [[ch1, 0], [ch2, 1]]) {
      if (!c.on || c.freq >= 2048) continue;
      c.ph += (131072 / (2048 - c.freq)) * 8 / sr; c.ph %= 8;
      const v = DUTY[c.duty][Math.floor(c.ph)] ? c.vol : 0;
      if (idx === 0) s1 = v; else s2 = v;
    }
    if (ch3.on) { ch3.ph += (65536 / (2048 - ch3.freq)) * 32 / sr; ch3.ph %= 32; s3 = wave[Math.floor(ch3.ph)] >> ch3.shift; }
    if (ch4.on && ch4.clk) {
      ch4.acc += ch4.clk / sr;
      while (ch4.acc >= 1) { ch4.acc -= 1; const b = (ch4.lfsr ^ (ch4.lfsr >> 1)) & 1; ch4.lfsr = (ch4.lfsr >> 1) | (b << 14); if (ch4.w7) ch4.lfsr = (ch4.lfsr & ~0x40) | (b << 6); }
      s4 = (ch4.lfsr & 1) ? 0 : ch4.vol;
    }
    // DAC: digital 0..15 -> analog -1..1 (centred), only when the DAC is on
    const a = [ch1.dac ? s1 / 7.5 - 1 : 0, ch2.dac ? s2 / 7.5 - 1 : 0, ch3.dac ? s3 / 7.5 - 1 : 0, ch4.dac ? s4 / 7.5 - 1 : 0];
    const pan = reg[0x25], mv = reg[0x24];
    let l = 0, r = 0;
    for (let k = 0; k < 4; k++) { if (pan & (1 << (k + 4))) l += a[k]; if (pan & (1 << k)) r += a[k]; }
    l *= (((mv >> 4) & 7) + 1) / 8 / 4; r *= ((mv & 7) + 1) / 8 / 4;
    // box-decimate into the output buffer
    const o = Math.floor(i / oversample);
    L[o] += l / oversample; R[o] += r / oversample;
  }
  // DC block (the GB's output capacitor), ~20 Hz one-pole high-pass
  const k = Math.exp(-2 * Math.PI * 20 / sampleRate); let pl = 0, pr = 0;
  for (let i = 0; i < L.length; i++) { const yl = L[i] - pl + k * dcL; pl = L[i]; dcL = yl; L[i] = yl; const yr = R[i] - pr + k * dcR; pr = R[i]; dcR = yr; R[i] = yr; }
  return { channels: [L, R], sampleRate, seconds: total };
}
