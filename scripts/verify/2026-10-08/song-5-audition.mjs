// Audition the new instruments through the NEW tools only: listen (solo), transform, chord notes.
import { session, OUT } from './drive.mjs';
const s = await session(7411);
const c = s.call;
await c('project', { action: 'new', kind: 'blank', name: 'audition' });
await c('transport', { bpm: 174 });
for (const sl of ['A', 'B']) await c('slots', { action: 'set_bars', slot: sl, bars: 4 });
await c('add_track', { type: 'breaks', name: 'Kit' });
await c('add_track', { type: 'reese', name: 'Bass' });
await c('add_track', { type: 'atmos', name: 'Pad' });
await c('add_track', { type: 'drums', name: 'OldKit' });
await c('add_track', { type: 'poly', name: 'OldBass' });
const L = (n, f) => Array.from({ length: n }, (_, i) => f(i));
const two = { kick: L(64, i => [0, 10].includes(i % 16) ? 1 : 0), snare: L(64, i => [4, 12].includes(i % 16) ? 0.95 : 0), chat: L(64, i => i % 2 ? 0.6 : 0.35) };
await c('set_steps', { track: 'Kit', mode: 'replace', lanes: two });
await c('set_steps', { track: 'OldKit', mode: 'replace', lanes: two });
const riff = [{ start: 0, pitch: 29, dur: 3.5 }, { start: 4, pitch: 29, dur: 1.5 }, { start: 6, pitch: 32, dur: 1.5 }, { start: 8, pitch: 25, dur: 3.5 }, { start: 12, pitch: 27, dur: 3.5 }];
await c('set_notes', { track: 'Bass', mode: 'replace', notes: riff });
await c('set_notes', { track: 'OldBass', mode: 'replace', notes: riff });
await c('set_params', { track: 'OldBass', preset: 'Acid Bass' });
const t = await c('set_notes', { track: 'Bass', mode: 'transform', transpose: 12, from: 0, to: 4 });
console.log('transform +12 on beats 0-4 ->', t.transformed, 'notes; first:', t.notes[0].noteName);
await c('set_notes', { track: 'Bass', mode: 'transform', transpose: -12, from: 0, to: 4 });
const ch = await c('set_notes', { track: 'Pad', mode: 'replace', notes: [{ start: 0, chord: 'Fm9', octave: 3, dur: 8, vel: 0.7 }, { start: 8, chord: 'Dbmaj7', octave: 3, dur: 8, vel: 0.7 }] });
console.log('chord notes ->', ch.notes.map(n => n.noteName).join(' '));
const pick = r => ({ peak: r.peakDb, rms: r.rmsDb, dc: r.dc, clipped: r.clipped, bands: r.bands, grid: r.grid?.onOffRatio, notes: r.notes });
for (const [label, solo] of [['NEW Kit', ['Kit']], ['OLD Kit', ['OldKit']], ['NEW Reese', ['Bass']], ['OLD Acid', ['OldBass']], ['NEW Pad', ['Pad']]]) {
  const r = await c('listen', { solo, save: `projects/songs/2026-10-08-cog-first-oscine/audition/${label.replace(' ', '-')}.wav` });
  console.log(label.padEnd(10), JSON.stringify(pick(r)), r.saved || r.error);
}
// stereo width of the pad: is it actually wide?
const w = await s.page.evaluate(async () => {
  const { renderProjectToBuffer } = await import('/src/engine/render.js');
  const p = structuredClone(window.oscine.store.project); for (const t of p.tracks) t.channel.mute = t.name !== 'Pad';
  const r = await renderProjectToBuffer(p, { loops: 1, tailSeconds: 0.2 });
  const L = r.buffer.getChannelData(0), R = r.buffer.getChannelData(1); let m = 0, sd = 0;
  for (let i = 0; i < L.length; i++) { m += ((L[i] + R[i]) / 2) ** 2; sd += ((L[i] - R[i]) / 2) ** 2; }
  return Math.sqrt(sd / m);
});
console.log('Pad side/mid ratio', w.toFixed(2));
// determinism: two renders of the kit identical?
const same = await s.page.evaluate(async () => {
  const { renderProjectToBuffer } = await import('/src/engine/render.js');
  const p = structuredClone(window.oscine.store.project); for (const t of p.tracks) t.channel.mute = t.name !== 'Kit';
  const a = (await renderProjectToBuffer(p, { loops: 1 })).buffer.getChannelData(0);
  const b = (await renderProjectToBuffer(p, { loops: 1 })).buffer.getChannelData(0);
  let d = 0; for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i] - b[i])); return d;
});
console.log('Kit render-to-render max diff', same);
console.log('errors', s.errs);
await s.close();
