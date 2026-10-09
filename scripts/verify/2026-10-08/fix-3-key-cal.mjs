// Key-estimate calibration on renders with known keys, run in node (listen.js is pure).
import { readFileSync } from 'node:fs';
import { keyEstimate } from '../../../src/engine/listen.js';
function readWav(p) {
  const b = readFileSync(p); let o = 12, fmt, data;
  while (o < b.length) { const id = b.toString('ascii', o, o + 4), sz = b.readUInt32LE(o + 4); if (id === 'fmt ') fmt = o + 8; if (id === 'data') { data = [o + 8, sz]; break; } o += 8 + sz + (sz & 1); }
  const ch = b.readUInt16LE(fmt + 2), sr = b.readUInt32LE(fmt + 4), bits = b.readUInt16LE(fmt + 14), fl = b.readUInt16LE(fmt) === 3;
  const n = data[1] / (bits / 8) / ch, mono = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let c = 0; c < ch; c++) { const at = data[0] + (i * ch + c) * bits / 8; s += fl ? b.readFloatLE(at) : bits === 16 ? b.readInt16LE(at) / 32768 : b.readInt32LE(at) / 2147483648; } mono[i] = s / ch; }
  return { mono, sr };
}
const D = '/Users/slowbro/workspaces/cog/projects/songs/';
const cases = [
  ['second-pass (F minor, written)', D + '2026-10-08-cog-first-oscine/second-pass.wav'],
  ['ledger slot B (F minor, written)', D + '2026-10-08-cog-first-oscine/slot-B.wav'],
  ['ledger slot A (F minor, written)', D + '2026-10-08-cog-first-oscine/slot-A.wav'],
  ['housekeeping heat B (C# minor per librosa r=.90)', D + '2026-09-19-housekeeping-heat/renders-run2/B.wav'],
];
for (const lo of [200, 100, 60, 30]) {
  console.log(`-- low cutoff ${lo} Hz`);
  for (const [name, p] of cases) {
    try { const { mono, sr } = readWav(p); console.log(' ', name.padEnd(48), JSON.stringify(keyEstimate(mono, sr, { lo }))); } catch (e) { console.log(' ', name, 'ERR', e.message); }
  }
}
