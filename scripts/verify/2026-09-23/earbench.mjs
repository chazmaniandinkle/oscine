import { pitchTrack, levelTrack, centroidTrack } from '/Users/slowbro/workspaces/oscine/src/engine/ear.js';
const sr = 44100;
for (const secs of [10, 30]) {
  const n = sr * secs, x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = Math.sin(2 * Math.PI * 220 * i / sr) * 0.3 + (Math.random() - 0.5) * 0.05;
  let t0 = Date.now(); pitchTrack(x, sr, { hop: 512 }); const tp = Date.now() - t0;
  t0 = Date.now(); levelTrack(x, sr, { hop: 1024 }); const tl = Date.now() - t0;
  t0 = Date.now(); centroidTrack(x, sr, { hop: 1024 }); const tc = Date.now() - t0;
  console.log(`${secs}s audio: pitch ${tp} ms, level ${tl} ms, centroid ${tc} ms  → per 230 s song ≈ pitch ${Math.round(tp * 230 / secs / 1000)} s, centroid ${Math.round(tc * 230 / secs / 1000)} s`);
}
