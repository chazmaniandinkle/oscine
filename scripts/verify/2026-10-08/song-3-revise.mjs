// Revision 2, driven by the ear pass on rev 1:
//  - B/C clipped (peak 0 dBFS, 5-6 samples) -> pull Keys/Sub, master 0.78
//  - bass 60-250 = 56% in B, high 4k+ = 0.3% everywhere: dull and boomy -> brighter hats, ride up,
//    keys cutoff via E-Piano is FM (no filter) so lower Keys level instead; pad an octave up stays
//  - key heard as Ab major / C minor, not F minor: the root F is in nothing but the sub. Put F under
//    the pad (pad voicing now starts on the root) and land the lead on F at the end.
import { session, OUT, friction } from './drive.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
const s = await session(7407);
const c = s.call;
const proj = JSON.parse(readFileSync(`${OUT}/ledger.oscine.json`, 'utf8'));
await c('project', { action: 'load', project: proj });

// pad: add the chord root an octave above the sub, under the existing voicing
const roots = [41, 37, 44, 39]; // F2 Db2 Ab2 Eb2
for (const slot of ['A', 'C', 'D']) {
  const cur = await c('get_notes', { track: 'Pad', slot });
  const add = roots.map((p, i) => ({ start: i * 8, pitch: p + 12, dur: 7.9, vel: 0.45 }));
  await c('set_notes', { track: 'Pad', slot, mode: 'add', notes: add });
  console.log('pad', slot, (cur.notes || []).length, '+', add.length);
}
// lead resolves to F at the end (was C)
const lead = await c('get_notes', { track: 'Lead', slot: 'C' });
const last = lead.notes.find(n => n.start === 28);
if (last) { await c('set_notes', { track: 'Lead', slot: 'C', mode: 'remove', ids: [last.id] }); await c('set_notes', { track: 'Lead', slot: 'C', mode: 'add', notes: [{ start: 28, pitch: 77, dur: 4, vel: 0.75 }] }); }
friction('Changing one note = get_notes, find its id, remove, add. No "set note at start X" or transpose/edit-in-place.');

// drums brighter: open hats every bar end, chat louder, ride in B too; kit tone up
const steps = await c('get_steps', { track: 'Drums', slot: 'B' });
const chat = steps.lanes.chat.map(v => v ? Math.min(1, v * 1.4) : 0);
const ride = Array.from({ length: 128 }, (_, i) => i % 4 === 2 ? 0.55 : 0);
await c('set_steps', { track: 'Drums', slot: 'B', mode: 'merge', lanes: { chat } });
await c('set_steps', { track: 'Drums', slot: 'C', mode: 'merge', lanes: { chat, ride } });
await c('set_params', { track: 'Drums', params: { tone: 0.75 } });
friction('No per-lane drum level/tone: kit tone is global, so brightening hats also brightens the kick.');

// gain staging
for (const [t, g] of Object.entries({ Keys: 0.5, Sub: 0.62, Drums: 0.8, Lead: 0.55, Pad: 0.4 })) await c('set_mix', { track: t, gain: g });
await c('set_master', { volume: 0.78 });
friction('No meter tool: gain staging is guess, render, measure peak outside, repeat.');

writeFileSync(`${OUT}/ledger.oscine.json`, JSON.stringify(await c('project', { action: 'get' }), null, 1));
for (const [i, n] of ['A', 'B', 'C', 'D'].entries()) await s.render(i, 1, `slot-${n}.wav`, 3.0);
console.log('errors', s.errs);
await s.close();
