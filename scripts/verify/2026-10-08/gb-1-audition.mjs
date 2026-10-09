// Audition the GB instruments solo through listen, plus hardware-model checks.
import { session } from './drive.mjs';
const s = await session(7521);
const c = s.call;
await c('project', { action: 'new', kind: 'blank', name: 'gb audition' });
await c('transport', { bpm: 174 });
await c('slots', { action: 'set_bars', slot: 'A', bars: 2 });
for (const [type, name] of [['gbpulse', 'P1'], ['gbwave', 'W'], ['gbnoise', 'N']]) await c('add_track', { type, name });
const L = f => Array.from({ length: 32 }, (_, i) => f(i % 16));
await c('set_steps', { track: 'N', mode: 'replace', lanes: { kick: L(s => [0, 10].includes(s) ? 1 : 0), snare: L(s => [4, 12].includes(s) ? 1 : 0), hat: L(s => s % 2 ? 0.7 : 0.4) } });
await c('set_notes', { track: 'P1', mode: 'replace', notes: [{ start: 0, pitch: 69, dur: 4, vel: 1 }] });
await c('set_notes', { track: 'W', mode: 'replace', notes: [{ start: 0, pitch: 41, dur: 4, vel: 1 }] });
const pick = r => ({ peak: r.peakDb, rms: r.rmsDb, dc: r.dc, bands: r.bands, grid: r.grid?.onOffRatio, notes: r.notes, err: r.error });
for (const duty of [0, 1, 2, 3]) {
  await c('set_params', { track: 'P1', params: { duty } });
  const r = await c('listen', { slot: 'A', solo: ['P1'], to: 1.3, save: `projects/songs/2026-10-08-cog-first-oscine/gb/pulse-duty${duty}.wav` });
  console.log(`pulse A4 duty ${duty}`, JSON.stringify(pick(r)));
}
// spectral check of duty: 50% square has no even harmonics; 25% has 2nd harmonic, no 4th
const harm = await s.page.evaluate(async () => {
  const gb = await import('/src/engine/instruments/gb.js');
  const ctx = new OfflineAudioContext(1, 44100, 44100), out = {};
  for (const duty of [1, 2]) {
    const b = gb.renderPulse(ctx, 69, 0.5, { duty, volume: 15, envPeriod: 0 }, 1).getChannelData(0);
    const N = 16384, h = k => { let re = 0, im = 0; const f = 131072 / (2048 - gb.regFor(440)) * k; for (let i = 0; i < N; i++) { const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N); re += b[i] * w * Math.cos(2 * Math.PI * f * i / 44100); im += b[i] * w * Math.sin(2 * Math.PI * f * i / 44100); } return Math.hypot(re, im); };
    const h1 = h(1); out[duty] = [1, 2, 3, 4].map(k => Math.round(20 * Math.log10(h(k) / h1 + 1e-9)));
  }
  // LFSR: 15-bit is broadband; 7-bit repeats every 127 clocks -> periodic (tonal)
  const n15 = gb.renderNoise(ctx, [{ frames: 1, vol: 15, envPeriod: 0, nr43: 0x10 }], 0.3, 1).getChannelData(0);
  const n7 = gb.renderNoise(ctx, [{ frames: 1, vol: 15, envPeriod: 0, nr43: 0x18 }], 0.3, 1).getChannelData(0);
  const ac = (x, lag) => { let a = 0, b = 0; for (let i = 0; i + lag < 8000; i++) { a += x[i] * x[i + lag]; b += x[i] * x[i]; } return a / b; };
  // 7-bit at shift 1, r 0: clock = 524288/0.5/4 = 262144 Hz, period 127 clocks = 2056 Hz -> lag 21.45 samples
  out.lfsr = { ac15_lag21: +ac(n15, 21).toFixed(2), ac7_lag21: +ac(n7, 21).toFixed(2), ac7_lag43: +ac(n7, 43).toFixed(2) };
  return out;
});
console.log('pulse harmonics dB rel fundamental (k=1..4): 25% duty', harm[1], '| 50% duty', harm[2], '| theory 25%: 0,-3,-9.5,-inf ; 50%: 0,-inf,-9.5,-inf');
console.log('LFSR autocorr', JSON.stringify(harm.lfsr), '(7-bit should be periodic ~0.9+ at its period, 15-bit ~0)');
for (const w of ['triangle', 'crystal:0', 'crystal:5', 'oracles:0e:WF_SQUARE_50_VOL_8']) {
  const r = await c('set_params', { track: 'W', params: { wave: w } });
  if (r.error) { console.log('wave', w, r.error); continue; }
  const l = await c('listen', { slot: 'A', solo: ['W'], to: 1.3, save: `projects/songs/2026-10-08-cog-first-oscine/gb/wave-${w.replace(/[:]/g, '_')}.wav` });
  console.log(`wave F2 ${w}`, JSON.stringify(pick(l)));
}
const nk = await c('listen', { slot: 'A', solo: ['N'], save: 'projects/songs/2026-10-08-cog-first-oscine/gb/noise-kit.wav' });
console.log('noise kit (wave kick + Crystal Snare1/HiHat1)', JSON.stringify(pick(nk)));
const det = await s.page.evaluate(async () => {
  const { renderProjectToBuffer } = await import('/src/engine/render.js');
  const p = structuredClone(window.oscine.store.project);
  const a = (await renderProjectToBuffer(p, { loops: 1 })).buffer.getChannelData(0), b = (await renderProjectToBuffer(p, { loops: 1 })).buffer.getChannelData(0);
  let d = 0; for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i] - b[i])); return d;
});
console.log('render-to-render max diff', det);
console.log('errors', s.errs);
await s.close();
