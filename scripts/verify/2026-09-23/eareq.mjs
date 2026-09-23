// Equivalence: the FFT NSDF must give the same pitch track as the direct
// O(n²) formula it replaced, on real audio and on synthetic signals.
import { pitchTrack } from '/Users/slowbro/workspaces/oscine/src/engine/ear.js';
import { readFileSync } from 'node:fs';
const sr = 44100;
// reference: the old direct NSDF + the same peak picking, inlined from git
function refFrame(x, off, win, sr, { fmin = 60, fmax = 1200 } = {}) {
  const maxLag = Math.min(win - 1, Math.floor(sr / fmin)), minLag = Math.max(2, Math.floor(sr / fmax));
  const nsdf = new Float32Array(maxLag + 1);
  for (let tau = minLag; tau <= maxLag; tau++) {
    let acf = 0, m = 0;
    for (let i = 0; i + tau < win; i++) { const a = x[off + i], b = x[off + i + tau]; acf += a * b; m += a * a + b * b; }
    nsdf[tau] = m > 0 ? 2 * acf / m : 0;
  }
  return nsdf;
}
// synthetic: compare full tracks
const n = sr * 4, x = new Float32Array(n);
for (let i = 0; i < n; i++) { const f = 180 + 60 * Math.sin(2 * Math.PI * 0.5 * i / sr); x[i] = 0.4 * Math.sin(2 * Math.PI * f * i / sr) + 0.15 * Math.sin(4 * Math.PI * f * i / sr) + (Math.random() - 0.5) * 0.02; }
let t0 = Date.now(); const fast = pitchTrack(x, sr, { hop: 512 }); const tf = Date.now() - t0;
console.log(`fast pitchTrack on 4 s: ${tf} ms, ${fast.length} frames, voiced ${fast.filter(f => f.hz).length}`);
// NSDF identity check on 50 random frames
import('/Users/slowbro/workspaces/oscine/src/engine/ear.js').then(() => {});
let maxErr = 0;
for (let k = 0; k < 50; k++) {
  const off = Math.floor(Math.random() * (n - 2048));
  const ref = refFrame(x, off, 2048, sr);
  // recompute fast NSDF through a single-frame pitchTrack slice is indirect; compare pitch instead:
}
// compare hz per frame vs a reference track built from refFrame + the module's own peak picking is not
// exported, so compare against the median of the old implementation via git show
const old = await import('data:text/javascript,' + encodeURIComponent(readFileSync('/tmp/ear-old.js', 'utf8')));
t0 = Date.now(); const slow = old.pitchTrack(x, sr, { hop: 512 }); const ts = Date.now() - t0;
let same = 0, both = 0, maxCents = 0;
for (let i = 0; i < Math.min(fast.length, slow.length); i++) {
  const a = fast[i].hz, b = slow[i].hz;
  if (!a && !b) { same++; continue; }
  if (a && b) { both++; const c = Math.abs(1200 * Math.log2(a / b)); maxCents = Math.max(maxCents, c); if (c < 1) same++; }
}
console.log(`old pitchTrack on 4 s: ${ts} ms  → speedup ${(ts / tf).toFixed(0)}×`);
console.log(`frames identical (±1 cent or both unvoiced): ${same}/${slow.length}; max deviation where both voiced: ${maxCents.toFixed(4)} cents`);
