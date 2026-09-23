// The ear must agree with ground truth before it's allowed to talk.
import { analyzeSpan, pitchTrack, hzToName, compareSpans, describe } from '../src/engine/ear.js';
import { readFileSync } from 'node:fs';

let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? '  ok  ' : 'FAIL  ') + n + (d ? `  (${d})` : '')); if (!ok) fails++; };
const SR = 44100;
const tone = (hz, sec, amp = 0.3, vib = 0) => { const n = Math.round(sec * SR), x = new Float32Array(n); for (let i = 0; i < n; i++) { const f = hz * (1 + vib * Math.sin(2 * Math.PI * 5 * i / SR)); x[i] = amp * Math.sin(2 * Math.PI * f * i / SR) + 0.1 * amp * Math.sin(2 * Math.PI * 2 * f * i / SR); } return x; };

// synthetic truths
const a3 = analyzeSpan(tone(220, 1.5), SR);
check('A3 sine -> A3', a3.pitch.median === 'A3', a3.pitch.median);
check('A3 range ~0 st', a3.pitch.rangeSemitones <= 1, a3.pitch.rangeSemitones);
check('voiced ~100%', a3.pitch.voicedPct > 90, a3.pitch.voicedPct + '%');
const fs3 = analyzeSpan(tone(185, 1.5, 0.3, 0.01), SR); // F#3 with 1% vibrato
check('F#3 + vibrato -> F#3', fs3.pitch.median === 'F#3', fs3.pitch.median);
const g2 = analyzeSpan(tone(98, 1.5), SR);
check('G2 (baritone floor) -> G2', g2.pitch.median === 'G2', g2.pitch.median);
const loud = analyzeSpan(tone(220, 1, 0.5), SR), quiet = analyzeSpan(tone(220, 1, 0.05), SR);
const d = compareSpans(loud, quiet);
check('0.5 -> 0.05 amp = -20 dB', Math.abs(d.levelDb + 20) < 0.5, d.levelDb + ' dB');
const sil = analyzeSpan(new Float32Array(SR), SR);
check('silence -> unvoiced', sil.pitch.medianMidi == null && sil.pitch.voicedPct === 0);

// real audio: the bridge vocal from render 1 (measured F#2-A#2 by librosa earlier tonight
// for render1's verses; the bridge sits low too). Decode the wav ourselves (PCM16).
function wavMono(path, from, to) {
  const b = readFileSync(path);
  const ch = b.readUInt16LE(22), sr = b.readUInt32LE(24), bits = b.readUInt16LE(34);
  let off = 12; while (b.toString('ascii', off, off + 4) !== 'data') off += 8 + b.readUInt32LE(off + 4);
  const data = off + 8, bps = bits / 8, frame = ch * bps;
  const i0 = Math.floor(from * sr), i1 = Math.floor(to * sr), x = new Float32Array(i1 - i0);
  for (let i = i0; i < i1; i++) { let s = 0; for (let c = 0; c < ch; c++) { const p = data + i * frame + c * bps; s += bits === 16 ? b.readInt16LE(p) / 32768 : b.readInt32LE(p) / 2147483648; } x[i - i0] = s / ch; }
  return { x, sr };
}
const P = '/Users/slowbro/workspaces/cog/projects/songs/2026-09-19-housekeeping-heat/stems/render1/vocals.wav';
try {
  const { x, sr } = wavMono(P, 151.9, 158.0); // "the ones to shoulder us, the lost and yet to come" (render 1)
  const r = analyzeSpan(x, sr);
  console.log('  render1 bridge:', describe(r, 'bridge').join(' | '));
  check('render1 bridge is voiced', r.pitch.voicedPct > 30, r.pitch.voicedPct + '%');
  check('render1 bridge median in a singable range (C3..C5)', r.pitch.medianMidi >= 48 && r.pitch.medianMidi <= 72, r.pitch.median);
  const { x: x2 } = wavMono(P, 60, 66); // a chorus, for contrast
  const r2 = analyzeSpan(x2, sr);
  const dd = compareSpans(r2, r);
  console.log('  bridge vs chorus:', JSON.stringify(dd));
  check('bridge quieter or darker than chorus (the hush we heard)', dd.levelDb < 0 || dd.centroidHz < 0, JSON.stringify(dd));
} catch (e) { console.log('  (skip real-audio checks: ' + e.message + ')'); }

console.log(fails ? `\n${fails} FAILED` : '\near: all checks passed');
process.exit(fails ? 1 : 0);
