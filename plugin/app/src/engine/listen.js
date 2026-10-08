// listen: the ear an operator needs while composing. Pure functions over a
// rendered AudioBuffer's channel data -- no DOM. Every number here answered a
// real question while composing "Ledger" through the API (2026-10-08):
//   level   peak / RMS / crest / clipped samples   -> gain staging
//   dc      mean sample value                      -> found the FM DC bug
//   bands   energy share sub/bass/lowmid/mid/high  -> "my sub was a bass", "dull top"
//   grid    onset energy at the intended beat vs off it -> does it groove at the tempo
//   sections per-section level when a sequence was rendered
// Key/chroma is deliberately not here yet: chroma key-finding failed on
// bass-heavy material (r < 0.6 on most neurofunk windows); a wrong key
// reported with confidence is worse than none.

function fftMag(x, start, n) {
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let k = 0; k < n; k++) re[k] = (x[start + k] || 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * k / n));
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang), half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = a + half;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
  const out = new Float64Array(n / 2);
  for (let k = 0; k < n / 2; k++) out[k] = re[k] * re[k] + im[k] * im[k];
  return out;
}

const BANDS = [['sub', 0, 60], ['bass', 60, 250], ['lowmid', 250, 800], ['mid', 800, 4000], ['high', 4000, 1e9]];
const db = v => Math.round(20 * Math.log10(Math.max(v, 1e-9)) * 10) / 10;

export function measure(channels, sr, { bpm = null, from = 0, to = null } = {}) {
  const a = Math.max(0, Math.floor(from * sr));
  const b = Math.min(channels[0].length, to == null ? channels[0].length : Math.floor(to * sr));
  const n = Math.max(0, b - a);
  const mono = new Float32Array(n);
  for (const ch of channels) for (let i = 0; i < n; i++) mono[i] += ch[a + i] / channels.length;
  let peak = 0, sq = 0, sum = 0, clipped = 0;
  for (const ch of channels) for (let i = a; i < b; i++) { const v = ch[i]; const av = Math.abs(v); if (av > peak) peak = av; if (av >= 0.999) clipped++; }
  for (let i = 0; i < n; i++) { sq += mono[i] * mono[i]; sum += mono[i]; }
  const rms = Math.sqrt(sq / Math.max(1, n));
  // band energy over 4096-sample frames
  const N = 4096, e = BANDS.map(() => 0);
  let tot = 0;
  for (let s = 0; s + N <= n; s += N) {
    const mag = fftMag(mono, s, N);
    for (let k = 1; k < N / 2; k++) {
      const f = k * sr / N, p = mag[k]; tot += p;
      for (let j = 0; j < BANDS.length; j++) if (f >= BANDS[j][1] && f < BANDS[j][2]) { e[j] += p; break; }
    }
  }
  const bands = Object.fromEntries(BANDS.map(([k], j) => [k, tot > 0 ? Math.round(e[j] / tot * 1000) / 1000 : 0]));
  const out = {
    seconds: Math.round(n / sr * 100) / 100,
    peakDb: db(peak), rmsDb: db(rms), crestDb: Math.round((db(peak) - db(rms)) * 10) / 10,
    clipped, dc: Math.round(sum / Math.max(1, n) * 10000) / 10000, bands,
  };
  if (bpm) out.grid = gridFit(mono, sr, bpm);
  const notes = [];
  if (clipped) notes.push(`${clipped} clipped samples: lower track gains or master volume.`);
  if (Math.abs(out.dc) > 0.005) notes.push(`DC offset ${out.dc}: an instrument is emitting 0 Hz.`);
  if (out.peakDb > -0.5 && !clipped) notes.push('Peak within 0.5 dB of full scale.');
  if (bands.high < 0.01 && rms > 0.01) notes.push('Under 1% of energy above 4 kHz: dull top end.');
  if (bands.sub + bands.bass > 0.85) notes.push('Over 85% of energy below 250 Hz: bass-heavy or boomy.');
  if (notes.length) out.notes = notes;
  return out;
}

// How strongly onsets line up with the intended 16th grid: energy of the
// positive spectral-flux envelope sampled ON grid positions vs halfway between.
// ratio >> 1 = tight to the tempo; ~1 = no relation (or the tempo is wrong).
export function gridFit(mono, sr, bpm) {
  const hop = 256, N = 1024, flux = [];
  let prev = null;
  for (let s = 0; s + N <= mono.length; s += hop) {
    const m = fftMag(mono, s, N);
    let f = 0;
    if (prev) for (let k = 1; k < 200; k++) { const d = Math.sqrt(m[k]) - Math.sqrt(prev[k]); if (d > 0) f += d; }
    flux.push(f); prev = m;
  }
  const fps = sr / hop, step = 60 / bpm / 4 * fps;
  let on = 0, off = 0, c = 0;
  for (let p = 0; p + step / 2 < flux.length; p += step) {
    const i = Math.round(p), j = Math.round(p + step / 2);
    on += Math.max(flux[i] || 0, flux[i + 1] || 0); off += Math.max(flux[j] || 0, flux[j + 1] || 0); c++;
  }
  return { sixteenths: c, onOffRatio: off > 0 ? Math.round(on / off * 100) / 100 : null };
}
