// "Second Pass": Cog's second Oscine song, built with the instruments designed today
// (breaks, reese, atmos) and the fitting-pass tools (16-bar slots, chord notes, transform,
// track copy, song mode, listen). 174 BPM liquid/rolling DnB in F minor.
// Form (song mode): A intro 16 | B drop 16 | C breakdown 16 | D drop 2 16 | B 16  (~110 s)
import { session, OUT, friction } from './drive.mjs';
import { writeFileSync } from 'node:fs';
const s = await session(7413);
const c = s.call;
const must = (r, what) => { if (r?.error) { console.log('!!', what, r.error); friction(`${what}: ${String(r.error).slice(0, 140)}`); } return r; };

must(await c('project', { action: 'new', kind: 'blank', name: 'Second Pass' }), 'new');
must(await c('transport', { bpm: 174, swing: 0 }), 'bpm');
for (const sl of ['A', 'B', 'C', 'D']) must(await c('slots', { action: 'set_bars', slot: sl, bars: 16 }), 'bars');

const T = [['breaks', 'Kit', 'Rollers'], ['reese', 'Reese', 'Rolling Reese'], ['atmos', 'Pad', 'Liquid Pad'], ['atmos', 'Stabs', 'Stab'], ['atmos', 'Lead', null], ['atmos', 'Choir', 'Choir Air']];
for (const [type, name, preset] of T) { must(await c('add_track', { type, name }), 'add ' + name); if (preset) must(await c('set_params', { track: name, preset }), 'preset ' + name); }
must(await c('set_params', { track: 'Lead', params: { saws: 3, detune: 9, width: 0.35, shimmer: 0.2, cutoff: 3800, filterAttack: 0.01, attack: 0.008, decay: 0.6, sustain: 0.55, release: 0.35, velFilter: 0.5 } }), 'lead params');

// ---------------- harmony: Fm9 | Dbmaj9 | Bbm9 | C7b9, 2 bars each, twice per 16 bars -------------
const PROG = [['Fm9', 29], ['Dbmaj9', 25], ['Bbm9', 34], ['C7b9', 36]];
const pad = [], stabs = [], bass = [];
for (let cyc = 0; cyc < 2; cyc++) PROG.forEach(([ch, root], i) => {
  const t = cyc * 32 + i * 8;
  pad.push({ start: t, chord: ch, octave: 3, dur: 7.8, vel: 0.62 });
  // stabs: syncopated offbeat chords, the liquid "skank"
  for (const o of [1.5, 3.5, 5.5, 6.75]) stabs.push({ start: t + o, chord: ch, octave: 4, dur: 0.35, vel: o === 6.75 ? 0.5 : 0.72 });
  // rolling reese: root on the 1, a pickup, the octave, back down
  bass.push({ start: t, pitch: root, dur: 2.25, vel: 0.95 }, { start: t + 2.5, pitch: root, dur: 0.75, vel: 0.8 },
    { start: t + 3.5, pitch: root + 12, dur: 0.4, vel: 0.7 }, { start: t + 4, pitch: root, dur: 2.5, vel: 0.95 },
    { start: t + 6.75, pitch: i === 3 ? 31 : root + 7, dur: 1.1, vel: 0.75 });
});

// ---------------- the hook: 8 bars over the progression, F minor with the E natural over C7 --------
const H = [[72, 0, 1.5], [68, 1.5, 0.5], [70, 2, 1], [72, 3, 1], [75, 4, 2.5], [72, 6.5, 0.5], [70, 7, 1],
  [68, 8, 1.5], [65, 9.5, 0.5], [68, 10, 1], [70, 11, 1], [72, 12, 3], [68, 15, 1],
  [70, 16, 1.5], [73, 17.5, 0.5], [77, 18, 2], [75, 20, 1], [73, 21, 1], [72, 22, 2],
  [70, 24, 1], [72, 25, 1], [73, 26, 1], [76, 27, 1], [72, 28, 3.5]];
const hook = [];
for (const off of [0, 32]) for (const [p, st, d] of H) hook.push({ start: off + st, pitch: p, dur: d * 0.95, vel: 0.78 });

// ---------------- drums (16 steps/bar x 16 bars = 256) ----------------
const N = 256, L = f => Array.from({ length: N }, (_, i) => f(i % 16, Math.floor(i / 16), i));
const fillBar = b => b % 8 === 7;
const drop = {
  kick: L((s, b) => (s === 0 || s === 10 || (b % 4 === 3 && s === 13)) ? 1 : 0),
  snare: L((s, b) => (s === 4 || s === 12) ? 0.95 : (fillBar(b) && s >= 13 ? 0.45 + 0.15 * (s - 13) : 0)),
  rim: L((s, b) => (s === 7 || (s === 15 && b % 2) || s === 9 && b % 4 === 1) ? 0.35 : 0),
  chat: L(s => s % 2 === 0 ? (s % 4 === 2 ? 0.75 : 0.45) : 0.28),
  ohat: L((s, b) => (s === 14 && b % 2 === 1) ? 0.5 : 0),
  shaker: L(s => s % 4 === 3 ? 0.4 : 0),
  crash: L((s, b) => (s === 0 && b === 0) ? 0.8 : 0),
};
const intro = {
  chat: L((s, b) => b >= 4 && s % 2 === 0 ? 0.35 + 0.02 * b : 0),
  shaker: L((s, b) => b >= 8 && s % 4 === 3 ? 0.35 : 0),
  // last 2 bars: the kick-less snare roll into the drop
  snare: L((s, b) => b === 14 ? (s % 4 === 0 ? 0.4 : 0) : b === 15 ? (s % 2 === 0 ? 0.35 + s * 0.035 : 0) : 0),
  rim: L((s, b) => b >= 8 && b < 14 && (s === 4 || s === 12) ? 0.3 : 0),
};
const breakdown = {
  rim: L((s, b) => b < 12 && (s === 4 || s === 12) ? 0.28 : 0),
  ride: L((s, b) => b >= 4 && b < 12 && s % 4 === 2 ? 0.35 : 0),
  snare: L((s, b) => b >= 12 ? (b < 14 ? (s % 4 === 0 ? 0.35 : 0) : b === 14 ? (s % 2 === 0 ? 0.45 : 0) : (0.4 + s * 0.035)) : 0),
  crash: L((s, b) => s === 0 && b === 0 ? 0.5 : 0),
};
const drop2 = { ...drop, ride: L(s => s % 4 === 2 ? 0.45 : 0), crash: L((s, b) => s === 0 && b % 8 === 0 ? 0.8 : 0) };

// ---------------- write the sections ----------------
const notes = (track, slot, n) => must(c('set_notes', { track, slot, mode: 'replace', notes: n }), `${track}/${slot}`);
const steps = (slot, lanes) => must(c('set_steps', { track: 'Kit', slot, mode: 'replace', lanes }), `kit/${slot}`);
// A intro: pad, choir from bar 9, filtered hats, snare roll in
await steps('A', intro); await notes('Pad', 'A', pad);
await notes('Choir', 'A', pad.filter(n => n.start >= 32).map(n => ({ ...n, octave: 4, vel: 0.4 })));
await notes('Reese', 'A', bass.filter(n => n.start >= 56 && n.start < 60).map(n => ({ ...n, vel: 0.6 })));  // a tease before the drop
// B drop
await steps('B', drop); await notes('Reese', 'B', bass); await notes('Stabs', 'B', stabs); await notes('Pad', 'B', pad.map(n => ({ ...n, vel: 0.45 })));
// C breakdown: the hook appears, no kick, no reese
await steps('C', breakdown); await notes('Pad', 'C', pad); await notes('Lead', 'C', hook); await notes('Choir', 'C', pad.map(n => ({ ...n, octave: 4, vel: 0.45 })));
// D drop 2: B + the hook up an octave's worth of energy (transform), ride + crashes
for (const t of ['Reese', 'Stabs', 'Pad']) must(await c('slots', { action: 'copy', from: 'B', to: 'D', track: t }), 'copy ' + t);
await steps('D', drop2);
must(await c('slots', { action: 'copy', from: 'C', to: 'D', track: 'Lead' }), 'copy lead');
must(await c('set_notes', { track: 'Lead', slot: 'D', mode: 'transform', transpose: 12, velScale: 0.85 }), 'lead +12 in D');

// ---------------- mix + song ----------------
const mix = { Kit: { gain: 0.82 }, Reese: { gain: 0.66 }, Pad: { gain: 0.42, sendReverb: 0.35 }, Stabs: { gain: 0.5, sendDelay: 0.18, sendReverb: 0.2, pan: 0.1 },
  Lead: { gain: 0.55, sendDelay: 0.25, sendReverb: 0.3, pan: -0.08 }, Choir: { gain: 0.36, sendReverb: 0.5 } };
for (const [t, m] of Object.entries(mix)) must(await c('set_mix', { track: t, ...m }), 'mix ' + t);
must(await c('set_master', { volume: 0.8, delayDiv: 0.75, delayFeedback: 0.32, delayReturn: 0.5, verbSize: 2.8, verbReturn: 0.6 }), 'master');
console.log('song', JSON.stringify(must(await c('song', { action: 'set', sequence: ['A', 'B', 'C', 'D', 'B'] }), 'song')));
writeFileSync(`${OUT}/second-pass.oscine.json`, JSON.stringify(await c('project', { action: 'get' }), null, 1));
if (process.env.STOP_BEFORE_LISTEN) { await s.close(); process.exit(0); }

// ---------------- listen, and fix what it says (up to 3 passes) ----------------
for (let pass = 1; pass <= 3; pass++) {
  const r = must(await c('listen', { song: true }), 'listen');
  console.log(`pass ${pass}: peak ${r.peakDb} rms ${r.rmsDb} crest ${r.crestDb} clipped ${r.clipped} dc ${r.dc} grid ${r.grid?.onOffRatio}`, JSON.stringify(r.bands), r.notes || '');
  for (const sct of r.sections) console.log(`   ${sct.slot} @${sct.startSec}s peak ${sct.peakDb} rms ${sct.rmsDb}`, JSON.stringify(sct.bands));
  if (r.clipped || r.peakDb > -1) { const st = await c('status'); await c('set_master', { volume: +(st.project.masterVolume * Math.pow(10, (-1.2 - r.peakDb) / 20)).toFixed(3) }); continue; }
  break;
}
const fin = await c('listen', { song: true, save: 'projects/songs/2026-10-08-cog-first-oscine/second-pass.wav' });
console.log('saved', fin.saved, 'peak', fin.peakDb);
writeFileSync(`${OUT}/second-pass.oscine.json`, JSON.stringify(await c('project', { action: 'get' }), null, 1));
console.log('errors', s.errs);
await s.close();
