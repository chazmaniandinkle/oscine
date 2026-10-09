// "Cartridge": chiptune DnB on Oscine's Game Boy APU instruments, using timbres
// pulled from the Pokemon Crystal and Zelda Oracles disassemblies (wave tables,
// drum register sequences). The composition is new; no game song data is used.
// Hardware-ish budget: pulse 1 (lead), pulse 2 (arps), wave (bass), noise (drums).
// One cheat, declared: the kick is the LSDj trick (a pitch-dropped wave-channel
// note) on the drum track, so it doesn't steal the bass channel.
// 174 BPM, F minor. A intro 8 | B build 8 | C drop 16 | D drop-var 16 | E break 8 | F build 8 | G drop2 16 | H outro 8
import { session, OUT, friction } from './drive.mjs';
import { writeFileSync } from 'node:fs';
const s = await session(7531);
const c = s.call;
const must = async (p, what) => { const r = await p; if (r?.error) { console.log('!!', what, r.error); friction(`${what}: ${String(r.error).slice(0, 160)}`); } return r; };

await must(c('project', { action: 'new', kind: 'blank', name: 'Cartridge' }), 'new');
await must(c('transport', { bpm: 174, swing: 0 }), 'bpm');
const BARS = { A: 8, B: 8, C: 16, D: 16, E: 8, F: 8, G: 16, H: 8 };
for (const [sl, b] of Object.entries(BARS)) await must(c('slots', { action: 'set_bars', slot: sl, bars: b }), 'bars');
await must(c('add_track', { type: 'gbpulse', name: 'Lead' }), 'lead');
await must(c('add_track', { type: 'gbpulse', name: 'Arp' }), 'arp');
await must(c('add_track', { type: 'gbwave', name: 'Bass' }), 'bass');
await must(c('add_track', { type: 'gbnoise', name: 'Drums' }), 'drums');
await must(c('set_params', { track: 'Lead', preset: 'Lead 25%' }), 'p');
await must(c('set_params', { track: 'Arp', preset: 'Arp Stab' }), 'p');
await must(c('set_params', { track: 'Arp', params: { volume: 10, gate: 0.85 } }), 'p');
await must(c('set_params', { track: 'Bass', params: { wave: 'crystal:0' } }), 'bass wave');
await must(c('set_params', { track: 'Drums', preset: 'Crystal Kit' }), 'kit');
await must(c('set_params', { track: 'Drums', params: { kickDecay: 0.2, kickLevel: 1.3, snareLevel: 0.9 } }), 'kit2');

// harmony: Fm | Db | Bb m | C (2 bars each); arps cycle chord tones in 32nds, chiptune style
const PROG = [[65, 68, 72], [61, 65, 68], [58, 61, 65], [60, 64, 67]];
const ROOT = [29, 25, 34, 36]; // F1 Db1 Bb1 C2 (wave plays an octave down)
const arps = (bars, vel = 0.8, oct = 0) => { const o = []; for (let b = 0; b < bars; b++) { const ch = PROG[Math.floor(b / 2) % 4]; for (let k = 0; k < 32; k++) o.push({ start: b * 4 + k * 0.125, pitch: ch[k % 3] + 12 * oct + (k % 6 >= 3 ? 12 : 0), dur: 0.12, vel }); } return o; };
const bass = (bars, busy = false) => { const o = []; for (let b = 0; b < bars; b += 2) { const r = ROOT[Math.floor(b / 2) % 4] + 12, t = b * 4;
  o.push({ start: t, pitch: r, dur: 1.4 }, { start: t + 1.5, pitch: r, dur: 0.4 }, { start: t + 2.5, pitch: r + 12, dur: 0.4 }, { start: t + 3, pitch: r, dur: 0.9 },
    { start: t + 4, pitch: r, dur: 1.4 }, { start: t + 5.75, pitch: r + 7, dur: 0.4 }, { start: t + 6.5, pitch: r + 10, dur: 0.4 }, { start: t + 7, pitch: r + 12, dur: 0.9 });
  if (busy) o.push({ start: t + 0.75, pitch: r + 12, dur: 0.2 }, { start: t + 4.75, pitch: r + 15, dur: 0.2 });
} return o.map(n => ({ ...n, vel: 0.95 })); };
// the hook: a heroic-ish 8-bar line over the progression (original)
const HOOK = [[77, 0, 1], [80, 1, 0.5], [79, 1.5, 0.5], [77, 2, 1.5], [72, 3.5, 0.5], [75, 4, 1], [77, 5, 1], [80, 6, 2],
  [77, 8, 1], [73, 9, 0.5], [75, 9.5, 0.5], [77, 10, 1.5], [80, 11.5, 0.5], [82, 12, 3], [80, 15, 1],
  [82, 16, 1], [84, 17, 0.5], [82, 17.5, 0.5], [80, 18, 1.5], [77, 19.5, 0.5], [80, 20, 1], [82, 21, 1], [84, 22, 2],
  [84, 24, 0.5], [82, 24.5, 0.5], [80, 25, 0.5], [79, 25.5, 0.5], [76, 26, 1], [79, 27, 1], [77, 28, 4]];
const hook = (bars, tr = 0, vel = 0.9) => { const o = []; for (let k = 0; k < bars / 8; k++) for (const [p, st, d] of HOOK) o.push({ start: k * 32 + st, pitch: p + tr, dur: d * 0.9, vel }); return o; };
const L = (bars, f) => Array.from({ length: bars * 16 }, (_, i) => f(i % 16, Math.floor(i / 16)));
const drop = (bars, { ohat = true, crash = 0 } = {}) => ({
  kick: L(bars, (s, b) => (s === 0 || s === 10 || (b % 4 === 3 && s === 13)) ? 1 : 0),
  snare: L(bars, (s, b) => (s === 4 || s === 12) ? 1 : (b % 4 === 3 && s >= 14 ? 0.6 : (s === 7 && b % 2) ? 0.35 : 0)),
  hat: L(bars, s => s % 2 === 0 ? (s % 4 === 2 ? 0.9 : 0.55) : 0.3),
  ohat: L(bars, (s, b) => ohat && s === 14 && b % 2 === 0 ? 0.8 : 0),
  perc: L(bars, s => s === 11 ? 0.6 : 0),
  crash: L(bars, (s, b) => s === 0 && (b === 0 || (crash && b % crash === 0)) ? 1 : 0),
});
const build = bars => ({ snare: L(bars, (s, b) => { const q = b / bars, div = q < 0.5 ? 4 : q < 0.75 ? 2 : 1; return s % div === 0 ? 0.35 + 0.65 * ((b * 16 + s) / (bars * 16)) : 0; }), hat: L(bars, s => s % 2 === 0 ? 0.5 : 0) });
const N = (track, slot, notes) => must(c('set_notes', { track, slot, mode: 'replace', notes }), `${track}/${slot}`);
const K = (slot, lanes) => must(c('set_steps', { track: 'Drums', slot, mode: 'replace', lanes }), `drums/${slot}`);

await N('Arp', 'A', arps(8, 0.6)); await K('A', { hat: L(8, (s, b) => b >= 4 && s % 2 === 0 ? 0.45 : 0) });
await N('Arp', 'B', arps(8, 0.75)); await N('Bass', 'B', bass(8).filter(n => n.start >= 16)); await K('B', build(8));
await N('Arp', 'C', arps(16, 0.6)); await N('Bass', 'C', bass(16)); await K('C', drop(16));
await N('Arp', 'D', arps(16, 0.55)); await N('Bass', 'D', bass(16, true)); await N('Lead', 'D', hook(16)); await K('D', drop(16));
await N('Lead', 'E', hook(8, 0, 0.8)); await N('Bass', 'E', [0, 8, 16, 24].map((t, i) => ({ start: t, pitch: ROOT[i] + 12, dur: 7.5, vel: 0.8 }))); await K('E', { perc: L(8, s => s % 8 === 4 ? 0.5 : 0), crash: L(8, (s, b) => s === 0 && b === 0 ? 0.8 : 0) });
await N('Arp', 'F', arps(8, 0.8, 1)); await N('Lead', 'F', hook(8, 0, 0.7).filter(n => n.start < 16)); await N('Bass', 'F', bass(8).filter(n => n.start >= 16)); await K('F', build(8));
await N('Arp', 'G', arps(16, 0.6)); await N('Bass', 'G', bass(16, true)); await N('Lead', 'G', hook(16, 12, 0.85)); await K('G', drop(16, { crash: 8 }));
await N('Arp', 'H', arps(8, 0.5).filter(n => n.start < 16)); await N('Lead', 'H', [{ start: 0, pitch: 77, dur: 14, vel: 0.8 }]); await N('Bass', 'H', [{ start: 0, pitch: 41, dur: 14, vel: 0.8 }]); await K('H', { crash: L(8, (s, b) => s === 0 && b === 0 ? 1 : 0) });

// builds: the arp's own pulse sweep rises via an instrument-param automation would bust the render cache per step; use gain + a filter insert instead
await must(c('insert', { action: 'add', lane: 'track:Arp', type: 'resofilter', params: { filterType: 'lowpass', cutoff: 16000, resonance: 3 } }), 'arp filter');
for (const sl of ['B', 'F']) await must(c('pattern_automation', { action: 'set_points', slot: sl, target: 'track:Arp:insert:0:cutoff', points: [{ beat: 0, v: 500, shape: 'exp' }, { beat: 31, v: 16000 }] }), 'sweep');
await must(c('pattern_automation', { action: 'set_points', slot: 'A', target: 'track:Arp:insert:0:cutoff', points: [{ beat: 0, v: 800, shape: 'exp' }, { beat: 32, v: 6000 }] }), 'intro sweep');
for (const t of ['Lead', 'Arp', 'Bass']) await must(c('pattern_automation', { action: 'set_points', slot: 'H', target: `track:${t}:gain`, points: [{ beat: 0, v: 1 }, { beat: 12, v: 1 }, { beat: 28, v: 0 }] }), 'fade');
await must(c('insert', { action: 'add', lane: 'pattern-master', type: 'limiter', params: {} }), 'limiter');

for (const [t, m] of Object.entries({ Lead: { gain: 0.6, sendDelay: 0.22, pan: -0.1 }, Arp: { gain: 0.42, pan: 0.15, sendReverb: 0.12 }, Bass: { gain: 0.85 }, Drums: { gain: 0.85 } })) await must(c('set_mix', { track: t, ...m }), 'mix');
await must(c('set_master', { volume: 0.8, delayDiv: 0.75, delayFeedback: 0.3, delayReturn: 0.4, verbSize: 1.6, verbReturn: 0.35 }), 'master');
await must(c('song', { action: 'set', sequence: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] }), 'song');
writeFileSync(`${OUT}/cartridge.oscine.json`, JSON.stringify(await c('project', { action: 'get' }), null, 1));
const r = await must(c('listen', { song: true, save: 'projects/songs/2026-10-08-cog-first-oscine/cartridge.wav' }), 'listen');
console.log(`whole ${r.seconds}s peak ${r.peakDb} rms ${r.rmsDb} clipped ${r.clipped} dc ${r.dc} grid ${r.grid?.onOffRatio} key ${JSON.stringify(r.key)}`, JSON.stringify(r.bands), r.notes || '');
for (const x of r.sections || []) console.log(`   ${x.slot} rms ${x.rmsDb}`, JSON.stringify(x.bands));
console.log('saved', r.saved, 'errors', s.errs);
await s.close();
