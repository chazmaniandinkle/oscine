// "Second Pass" rev 2: run again on the fixed Oscine. 8 sections via slots A-H, pattern inserts
// (EQ for air, HP on pads, a master limiter), slot automation (filter sweeps into drops, risers,
// a reese filter that opens in the variation), listen + key estimate as the ear.
// Form: A intro 16 | B build 8 | C drop 16 | D drop-var 16 | E breakdown 16 | F build 8 | G drop2 16 | H outro 8
import { session, OUT, friction } from './drive.mjs';
import { writeFileSync } from 'node:fs';
const s = await session(7501);
const c = s.call;
const must = async (p, what) => { const r = await p; if (r?.error) { console.log('!!', what, r.error); friction(`${what}: ${String(r.error).slice(0, 160)}`); } return r; };

await must(c('project', { action: 'new', kind: 'blank', name: 'Second Pass (rev 2)' }), 'new');
await must(c('transport', { bpm: 174, swing: 0 }), 'bpm');
const BARS = { A: 16, B: 8, C: 16, D: 16, E: 16, F: 8, G: 16, H: 8 };
for (const [sl, b] of Object.entries(BARS)) await must(c('slots', { action: 'set_bars', slot: sl, bars: b }), 'bars ' + sl);

const T = [['breaks', 'Kit', 'Rollers'], ['reese', 'Reese', 'Rolling Reese'], ['atmos', 'Pad', 'Liquid Pad'], ['atmos', 'Stabs', 'Stab'], ['atmos', 'Lead', null], ['atmos', 'Choir', 'Choir Air'], ['atmos', 'Riser', null]];
for (const [type, name, preset] of T) { await must(c('add_track', { type, name }), 'add ' + name); if (preset) await must(c('set_params', { track: name, preset }), 'preset ' + name); }
await must(c('set_params', { track: 'Lead', params: { saws: 3, detune: 9, width: 0.35, shimmer: 0.3, cutoff: 4200, filterAttack: 0.01, attack: 0.008, decay: 0.6, sustain: 0.55, release: 0.35, velFilter: 0.5 } }), 'lead');
await must(c('set_params', { track: 'Riser', params: { wave: 'sawtooth', saws: 9, detune: 40, width: 1, shimmer: 0.6, cutoff: 6000, attack: 0.05, sustain: 1, release: 0.4 } }), 'riser');
await must(c('set_params', { track: 'Kit', params: { hatLevel: 1.3, hatTone: 0.7, snareTone: 0.7, kickClick: 0.6 } }), 'kit');
await must(c('set_params', { track: 'Reese', params: { sub: 0.65, top: 0.85, cutoff: 1500 } }), 'reese');

// ---------- material ----------
const PROG = [['Fm9', 29], ['Dbmaj9', 25], ['Bbm9', 34], ['C7b9', 36]];
const cyc = (bars) => bars / 8; // progression = 8 bars
const pad = (bars, vel = 0.62, oct = 3) => { const o = []; for (let k = 0; k < cyc(bars); k++) PROG.forEach(([ch], i) => o.push({ start: k * 32 + i * 8, chord: ch, octave: oct, dur: 7.8, vel })); return o; };
const stabs = (bars) => { const o = []; for (let k = 0; k < cyc(bars); k++) PROG.forEach(([ch], i) => { const t = k * 32 + i * 8; for (const x of [1.5, 3.5, 5.5, 6.75]) o.push({ start: t + x, chord: ch, octave: 4, dur: 0.35, vel: x === 6.75 ? 0.5 : 0.72 }); }); return o; };
const bass = (bars, variant = false) => { const o = []; for (let k = 0; k < cyc(bars); k++) PROG.forEach(([, r], i) => { const t = k * 32 + i * 8;
  o.push({ start: t, pitch: r, dur: 2.25, vel: 0.95 }, { start: t + 2.5, pitch: r, dur: 0.75, vel: 0.8 }, { start: t + 3.5, pitch: r + 12, dur: 0.4, vel: 0.7 }, { start: t + 4, pitch: r, dur: 2.5, vel: 0.95 }, { start: t + 6.75, pitch: i === 3 ? 31 : r + 7, dur: 1.1, vel: 0.75 });
  if (variant) o.push({ start: t + 7.5, pitch: r + 12, dur: 0.4, vel: 0.65 }, { start: t + 1.5, pitch: r + 15, dur: 0.4, vel: 0.55 });
}); return o; };
const H = [[72, 0, 1.5], [68, 1.5, 0.5], [70, 2, 1], [72, 3, 1], [75, 4, 2.5], [72, 6.5, 0.5], [70, 7, 1], [68, 8, 1.5], [65, 9.5, 0.5], [68, 10, 1], [70, 11, 1], [72, 12, 3], [68, 15, 1],
  [70, 16, 1.5], [73, 17.5, 0.5], [77, 18, 2], [75, 20, 1], [73, 21, 1], [72, 22, 2], [70, 24, 1], [72, 25, 1], [73, 26, 1], [76, 27, 1], [72, 28, 3.5]];
const hook = (bars, tr = 0, vel = 0.78) => { const o = []; for (let k = 0; k < cyc(bars); k++) for (const [p, st, d] of H) o.push({ start: k * 32 + st, pitch: p + tr, dur: d * 0.95, vel }); return o; };
const L = (bars, f) => Array.from({ length: bars * 16 }, (_, i) => f(i % 16, Math.floor(i / 16), i));
const dropKit = (bars, { ride = false, crashEvery = 0 } = {}) => ({
  kick: L(bars, (s, b) => (s === 0 || s === 10 || (b % 4 === 3 && s === 13)) ? 1 : 0),
  snare: L(bars, (s, b) => (s === 4 || s === 12) ? 0.95 : (b % 8 === 7 && s >= 13 ? 0.45 + 0.15 * (s - 13) : 0)),
  rim: L(bars, (s, b) => (s === 7 || (s === 15 && b % 2) || (s === 9 && b % 4 === 1)) ? 0.35 : 0),
  chat: L(bars, s => s % 2 === 0 ? (s % 4 === 2 ? 0.75 : 0.45) : 0.28),
  ohat: L(bars, (s, b) => (s === 14 && b % 2 === 1) ? 0.5 : 0),
  shaker: L(bars, s => s % 4 === 3 ? 0.4 : 0),
  ride: L(bars, s => ride && s % 4 === 2 ? 0.45 : 0),
  crash: L(bars, (s, b) => s === 0 && (b === 0 || (crashEvery && b % crashEvery === 0)) ? 0.8 : 0),
});
const build = (bars) => ({ // snare roll accelerating over the build, no kick
  snare: L(bars, (s, b) => { const q = b / bars; const div = q < 0.5 ? 4 : q < 0.75 ? 2 : 1; return s % div === 0 ? 0.3 + 0.6 * ((b * 16 + s) / (bars * 16)) : 0; }),
  chat: L(bars, s => s % 2 === 0 ? 0.4 : 0),
  shaker: L(bars, s => s % 4 === 3 ? 0.35 : 0),
});
const riser = (bars) => [{ start: 0, chord: 'C7b9', octave: 4, dur: bars * 4 - 0.25, vel: 0.5 }];

// ---------- write sections ----------
const N = (track, slot, notes) => must(c('set_notes', { track, slot, mode: 'replace', notes }), `${track}/${slot}`);
const K = (slot, lanes) => must(c('set_steps', { track: 'Kit', slot, mode: 'replace', lanes }), `kit/${slot}`);
// A intro
await K('A', { chat: L(16, (s, b) => b >= 4 && s % 2 === 0 ? 0.35 + 0.02 * b : 0), shaker: L(16, (s, b) => b >= 8 && s % 4 === 3 ? 0.35 : 0), rim: L(16, (s, b) => b >= 8 && (s === 4 || s === 12) ? 0.3 : 0) });
await N('Pad', 'A', pad(16)); await N('Choir', 'A', pad(16, 0.45, 4).filter(n => n.start >= 32));
// B build
await K('B', build(8)); await N('Pad', 'B', pad(8, 0.6)); await N('Riser', 'B', riser(8)); await N('Choir', 'B', pad(8, 0.5, 4));
// C drop
await K('C', dropKit(16)); await N('Reese', 'C', bass(16)); await N('Stabs', 'C', stabs(16)); await N('Pad', 'C', pad(16, 0.45));
// D drop variation: busier bass, hook enters low in the mix, ride
await K('D', dropKit(16, { ride: true })); await N('Reese', 'D', bass(16, true)); await N('Stabs', 'D', stabs(16)); await N('Pad', 'D', pad(16, 0.45)); await N('Lead', 'D', hook(16, 0, 0.55));
// E breakdown
await K('E', { rim: L(16, (s, b) => b < 12 && (s === 4 || s === 12) ? 0.28 : 0), ride: L(16, (s, b) => b >= 4 && b < 12 && s % 4 === 2 ? 0.35 : 0), crash: L(16, (s, b) => s === 0 && b === 0 ? 0.5 : 0) });
await N('Pad', 'E', pad(16, 0.8)); await N('Lead', 'E', hook(16, 0, 0.95)); await N('Choir', 'E', pad(16, 0.6, 4));
// F build 2 (shorter riser, hook teaser)
await K('F', build(8)); await N('Pad', 'F', pad(8, 0.7)); await N('Riser', 'F', riser(8)); await N('Lead', 'F', hook(8, 0, 0.7));
// G drop 2: everything, hook an octave up, crashes every 8
await K('G', dropKit(16, { ride: true, crashEvery: 8 })); await N('Reese', 'G', bass(16, true)); await N('Stabs', 'G', stabs(16)); await N('Pad', 'G', pad(16, 0.5)); await N('Lead', 'G', hook(16, 12, 0.7)); await N('Choir', 'G', pad(16, 0.4, 4));
// H outro: pad + choir resolve to Fm9, hats thinning
await K('H', { chat: L(8, (s, b) => b < 6 && s % 2 === 0 ? 0.4 - 0.05 * b : 0), crash: L(8, (s, b) => s === 0 && b === 0 ? 0.6 : 0) });
await N('Pad', 'H', [{ start: 0, chord: 'Fm9', octave: 3, dur: 31.5, vel: 0.7 }]); await N('Choir', 'H', [{ start: 0, chord: 'Fm9', octave: 4, dur: 31.5, vel: 0.5 }]);

// ---------- mix: inserts (the fixes) ----------
const I = (lane, type, params) => must(c('insert', { action: 'add', lane, type, params }), `insert ${lane} ${type}`);
await I('track:Kit', 'eq3', { lowFreq: 60, lowGain: 1.5, highFreq: 7000, highGain: 6 });               // air on the metal
await I('track:Pad', 'eq3', { hpFreq: 180, highFreq: 8000, highGain: 3 });                             // keep pad out of the bass
await I('track:Pad', 'resofilter', { filterType: 'lowpass', cutoff: 14000, resonance: 1.5 });           // insert 1: automated in builds
await I('track:Stabs', 'eq3', { hpFreq: 250, highFreq: 6000, highGain: 4 });
await I('track:Choir', 'eq3', { hpFreq: 300, highFreq: 9000, highGain: 4 });
await I('track:Lead', 'eq3', { hpFreq: 200, midFreq: 2500, midGain: 2 });
await I('track:Reese', 'eq3', { midFreq: 350, midGain: -3, midQ: 1.2 });                               // scoop mud
await I('track:Riser', 'resofilter', { filterType: 'highpass', cutoff: 200, resonance: 4 });           // insert 0: swept up
await I('pattern-master', 'eq3', { lowFreq: 35, lowGain: -2, highFreq: 10000, highGain: 2 });
await I('pattern-master', 'limiter', {});

// ---------- automation (the fixes) ----------
const A = (slot, target, points) => must(c('pattern_automation', { action: 'set_points', slot, target, points }), `auto ${slot} ${target}`);
// builds: pad closes then opens, riser HP sweeps up and swells
for (const sl of ['B', 'F']) {
  await A(sl, 'track:Pad:insert:1:cutoff', [{ beat: 0, v: 600, shape: 'exp' }, { beat: 30, v: 14000 }, { beat: 32, v: 14000 }]);
  await A(sl, 'track:Riser:insert:0:cutoff', [{ beat: 0, v: 200, shape: 'exp' }, { beat: 31.5, v: 6000 }]);
  await A(sl, 'track:Riser:gain', [{ beat: 0, v: 0.05, shape: 'exp' }, { beat: 31, v: 1.2 }, { beat: 31.9, v: 0 }]);
}
// intro: pad filter slowly opens over 16 bars
await A('A', 'track:Pad:insert:1:cutoff', [{ beat: 0, v: 400, shape: 'exp' }, { beat: 64, v: 9000 }]);
// drop variation: reese filter opens across the section (movement)
await A('D', 'track:Reese:param:cutoff', [{ beat: 0, v: 900 }, { beat: 48, v: 2600 }, { beat: 64, v: 1500 }]);
// outro: everything fades in the last 4 bars
for (const t of ['Pad', 'Choir', 'Kit']) await A('H', `track:${t}:gain`, [{ beat: 0, v: 1 }, { beat: 16, v: 1 }, { beat: 32, v: 0 }]);

const mix = { Kit: { gain: 0.8 }, Reese: { gain: 0.55 }, Pad: { gain: 0.5, sendReverb: 0.35 }, Stabs: { gain: 0.62, sendDelay: 0.18, sendReverb: 0.2, pan: 0.1 },
  Lead: { gain: 0.55, sendDelay: 0.25, sendReverb: 0.3, pan: -0.08 }, Choir: { gain: 0.4, sendReverb: 0.5 }, Riser: { gain: 0.35, sendReverb: 0.4 } };
for (const [t, m] of Object.entries(mix)) await must(c('set_mix', { track: t, ...m }), 'mix ' + t);
await must(c('set_master', { volume: 0.75, delayDiv: 0.75, delayFeedback: 0.32, delayReturn: 0.5, verbSize: 2.8, verbReturn: 0.6 }), 'master');
await must(c('song', { action: 'set', sequence: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] }), 'song');
writeFileSync(`${OUT}/second-pass-r2.oscine.json`, JSON.stringify(await c('project', { action: 'get' }), null, 1));

// ---------- listen ----------
const r = await must(c('listen', { song: true }), 'listen');
console.log(`whole: ${r.seconds}s peak ${r.peakDb} rms ${r.rmsDb} crest ${r.crestDb} clipped ${r.clipped} dc ${r.dc} grid ${r.grid?.onOffRatio} key ${JSON.stringify(r.key)}`, JSON.stringify(r.bands), r.notes || '');
for (const x of r.sections || []) console.log(`   ${x.slot} @${x.startSec}s peak ${x.peakDb} rms ${x.rmsDb}`, JSON.stringify(x.bands));
console.log('errors', s.errs);
await s.close();
