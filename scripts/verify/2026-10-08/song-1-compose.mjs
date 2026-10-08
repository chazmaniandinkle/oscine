// Cog's first Oscine song, composed ONLY through MCP tools (render = stand-in for a missing `listen` tool).
// "Ledger" — 172 two-step, F minor. Slots: A intro, B groove, C lift (lead), D outro.
import { session, OUT, friction } from './drive.mjs';
import { writeFileSync } from 'node:fs';
const s = await session(7403);
const c = s.call;
const ok = (r, what) => { if (r?.error) friction(`${what}: ${String(r.error).slice(0, 160)}`); return r; };

ok(await c('project', { action: 'new', kind: 'blank', name: 'Ledger' }), 'new');
ok(await c('transport', { bpm: 172, swing: 0 }), 'bpm');
for (const slot of ['A', 'B', 'C', 'D']) ok(await c('slots', { action: 'set_bars', slot, bars: 8 }), 'bars');
friction('8 bars max per slot = 11.2 s at 172; a DnB section is 16-32 bars. Song = slots stitched outside Oscine.');

for (const [type, name, preset] of [['drums', 'Drums', 'Crisp'], ['poly', 'Sub', null], ['fm', 'Keys', 'E-Piano'], ['poly', 'Pad', 'Velvet Pad'], ['fm', 'Lead', 'Bell']]) {
  ok(await c('add_track', { type, name }), 'add ' + name);
  if (preset) ok(await c('set_params', { track: name, preset }), 'preset ' + name);
}
ok(await c('set_params', { track: 'Sub', params: { osc1Wave: 'sine', osc2Wave: 'triangle', osc2Semi: 0, oscMix: 0.15, cutoff: 320, resonance: 0, fEnvAmt: 0, attack: 0.004, decay: 0.2, sustain: 0.95, release: 0.08, voices: 1, glide: 0.03, level: 0.9 } }), 'sub params');

// --- harmony: i9 - VImaj9 - IIImaj7 - VII6/9, two bars each (8 beats) ---
const CH = [
  { root: 29, v: [53, 56, 60, 63, 67] }, // Fm9      F1 | F Ab C Eb G
  { root: 25, v: [49, 56, 60, 63, 65] }, // Dbmaj9   Db1| Db Ab C Eb F
  { root: 32, v: [51, 56, 60, 63, 67] }, // Abmaj7   Ab1| Eb Ab C Eb G
  { root: 27, v: [51, 55, 58, 60, 65] }, // Eb6/9    Eb1| Eb G Bb C F
];
friction('No chord/scale helper: every voicing is hand-computed MIDI numbers (Fm9 = 53 56 60 63 67).');
const keys = [], pad = [], sub = [];
CH.forEach((ch, i) => {
  const t = i * 8;
  for (const p of ch.v) { keys.push({ start: t, pitch: p, dur: 2.75, vel: 0.62 }, { start: t + 3.5, pitch: p, dur: 0.4, vel: 0.45 }, { start: t + 5.5, pitch: p, dur: 2.25, vel: 0.55 }); }
  for (const p of ch.v.slice(0, 4)) pad.push({ start: t, pitch: p + 12, dur: 7.9, vel: 0.5 });
  // sub follows the two-step kick (step 0 and 10 => beats 0, 2.5) per bar, root, short octave lift at the end of each chord
  for (const b of [0, 4]) { sub.push({ start: t + b, pitch: ch.root + 12, dur: 2.4, vel: 0.9 }, { start: t + b + 2.5, pitch: ch.root + 12, dur: 1.4, vel: 0.85 }); }
  sub.push({ start: t + 7.5, pitch: ch.root + 24, dur: 0.45, vel: 0.7 });
});
// sub at root+12 = F2..Eb2 is ~40-80 Hz fundamentals; root alone (F1 = 43.6 Hz) would be under most of the kit.
const lead = [
  [72, 0, 1.5], [75, 1.5, 0.5], [77, 2, 2], [75, 4.5, 0.5], [72, 5, 1], [68, 6, 2],
  [65, 8, 1], [68, 9, 1], [72, 10, 2], [70, 12.5, 0.5], [68, 13, 3],
  [75, 16, 1.5], [72, 17.5, 0.5], [75, 18, 1], [79, 19, 3], [77, 22.5, 0.5], [75, 23, 1],
  [79, 24, 1], [77, 25, 1], [75, 26, 2], [72, 28, 4],
].map(([pitch, start, dur]) => ({ start, pitch, dur, vel: 0.75 }));

// --- drums: two-step at 16 steps/bar over 8 bars ---
const N = 128, st = i => i % 16, bar = i => Math.floor(i / 16);
const L = (f) => Array.from({ length: N }, (_, i) => f(i));
const kick = L(i => [0, 10].includes(st(i)) ? 1 : 0);
const snare = L(i => [4, 12].includes(st(i)) ? 0.95 : (st(i) === 15 && bar(i) % 2 === 1 ? 0.3 : (st(i) === 7 ? 0.22 : 0)));
const chat = L(i => (i % 2 === 0 ? 0.32 : 0.55) * (st(i) === 4 || st(i) === 12 ? 0.5 : 1));
const ohat = L(i => st(i) === 14 && bar(i) % 4 === 3 ? 0.5 : 0);
const ride = L(i => i % 4 === 2 ? 0.45 : 0);
const hatsOnly = L(i => i % 4 === 2 ? 0.45 : 0);

// A intro: pad + keys + offbeat hats. B groove: drums, sub, keys. C lift: B + lead + ride. D outro: pad + lead tail, no drums.
const W = async (track, slot, notes) => ok(await c('set_notes', { track, slot, mode: 'replace', notes }), `notes ${track}/${slot}`);
const D = async (slot, lanes) => ok(await c('set_steps', { track: 'Drums', slot, mode: 'replace', lanes }), `steps ${slot}`);
await W('Pad', 'A', pad); await W('Keys', 'A', keys); await D('A', { chat: hatsOnly });
await W('Keys', 'B', keys); await W('Sub', 'B', sub); await D('B', { kick, snare, chat, ohat });
await W('Keys', 'C', keys); await W('Sub', 'C', sub); await W('Lead', 'C', lead); await W('Pad', 'C', pad); await D('C', { kick, snare, chat, ohat, ride });
await W('Pad', 'D', pad); await W('Lead', 'D', lead.filter(n => n.start >= 24)); await W('Keys', 'D', keys.filter(n => n.start < 8));
friction('Same chord part written into 3 slots by hand: no "copy one track between slots" (slots copy is all-or-nothing).');

// --- mix ---
for (const [track, m] of Object.entries({ Drums: { gain: 0.78 }, Sub: { gain: 0.72 }, Keys: { gain: 0.62, sendReverb: 0.22, pan: -0.12 }, Pad: { gain: 0.42, sendReverb: 0.4 }, Lead: { gain: 0.58, sendDelay: 0.22, sendReverb: 0.25, pan: 0.15 } }))
  ok(await c('set_mix', { track, ...m }), 'mix ' + track);
ok(await c('set_master', { volume: 0.85, delayDiv: 0.75, delayFeedback: 0.3, verbSize: 2.4 }), 'master');

const proj = await c('project', { action: 'get' });
writeFileSync(`${OUT}/ledger.oscine.json`, JSON.stringify(proj, null, 1));
for (const [i, n] of ['A', 'B', 'C', 'D'].entries()) console.log('render', await s.render(i, 1, `slot-${n}.wav`, 3.0));
friction('Rendering a slot for listening is not a tool: had to evaluate renderProjectToBuffer in the page.');
console.log('page errors', s.errs);
await s.close();
