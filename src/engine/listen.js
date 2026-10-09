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
  const k = keyEstimate(mono, sr);
  if (k) out.key = k;
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

// Key estimate, confidence-gated. Chroma from 200 Hz-5 kHz only (bass and sub
// excluded: on bass-heavy music the sub's harmonics are what fooled chroma
// key-finding before), correlated against Krumhansl-Kessler profiles for all
// 24 keys. Reported only when the best correlation clears 0.6 AND beats the
// runner-up that isn't its relative key; otherwise null with the reason.
// The relative major/minor is always named, because profiles can't fully
// separate them; the operator decides by the tonic.
const KK_MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MIN = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const PC = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const CAMELOT_MAJ = ['8B', '3B', '10B', '5B', '12B', '7B', '2B', '9B', '4B', '11B', '6B', '1B'];
const CAMELOT_MIN = ['5A', '12A', '7A', '2A', '9A', '4A', '11A', '6A', '1A', '8A', '3A', '10A'];
function corr(a, b) {
  const ma = a.reduce((x, y) => x + y) / 12, mb = b.reduce((x, y) => x + y) / 12;
  let n = 0, da = 0, db2 = 0;
  for (let i = 0; i < 12; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db2 += (b[i] - mb) ** 2; }
  return n / Math.sqrt(da * db2 || 1);
}
export function keyEstimate(mono, sr, { lo = 100, hi = 5000 } = {}) {
  // Per-SEMITONE mean magnitude, then fold to pitch classes. Summing raw FFT
  // bins weights high notes by their bin count (a semitone is ~2 bins at
  // 200 Hz, ~55 at 5 kHz), so upper harmonics dominate and the 3rd harmonic
  // (the fifth) wins: F minor read as C minor on every song tested before
  // this normalisation (2026-10-08).
  const N = 8192, perNote = new Map();
  const hop = Math.max(N, Math.floor(mono.length / 120)); // cap the work at ~120 frames
  for (let s = 0; s + N <= mono.length; s += hop) {
    const m = fftMag(mono, s, N);
    for (let k = 1; k < N / 2; k++) {
      const f = k * sr / N; if (f < lo || f > hi) continue;
      const midi = Math.round(69 + 12 * Math.log2(f / 440));
      const e = perNote.get(midi) ?? [0, 0]; e[0] += Math.sqrt(m[k]); e[1]++; perNote.set(midi, e);
    }
  }
  const chroma = new Array(12).fill(0);
  for (const [midi, [sum, cnt]] of perNote) chroma[((midi % 12) + 12) % 12] += sum / cnt;
  if (chroma.every(v => v === 0)) return null;
  const rot = (p, r) => p.map((_, i) => p[(i - r + 12) % 12]);
  const scores = [];
  for (let r = 0; r < 12; r++) {
    scores.push({ name: `${PC[r]} major`, camelot: CAMELOT_MAJ[r], r: corr(chroma, rot(KK_MAJ, r)), tonic: r, mode: 'maj' });
    scores.push({ name: `${PC[r]} minor`, camelot: CAMELOT_MIN[r], r: corr(chroma, rot(KK_MIN, r)), tonic: r, mode: 'min' });
  }
  scores.sort((a, b) => b.r - a.r);
  const best = scores[0];
  const relTonic = best.mode === 'maj' ? (best.tonic + 9) % 12 : (best.tonic + 3) % 12;
  const relative = scores.find(s => s.tonic === relTonic && s.mode !== best.mode);
  const rival = scores.find(s => s !== best && s !== relative);
  const r = Math.round(best.r * 100) / 100, margin = Math.round((best.r - rival.r) * 100) / 100;
  if (best.r < 0.6 || margin < 0.05) return { key: null, why: `low confidence (best ${best.name} r=${r}, margin ${margin})` };
  return { key: best.name, camelot: best.camelot, r, margin, relative: relative.name };
}
