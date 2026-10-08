// Isolate the DC offset: render slot A/B with one track soloed at a time (through set_mix solo),
// and an empty project, and report mean sample value per render.
import { session, OUT } from './drive.mjs';
import { readFileSync } from 'node:fs';
const s = await session(7405);
const proj = JSON.parse(readFileSync(`${OUT}/ledger.oscine.json`, 'utf8'));
console.log('load', JSON.stringify(await s.call('project', { action: 'load', project: proj })).slice(0, 100));
const st = await s.call('status');
const names = st.tracks.map(t => t.name);
const meanOf = async (slotIndex) => s.page.evaluate(async (slotIndex) => {
  const { renderProjectToBuffer } = await import('/src/engine/render.js');
  const r = await renderProjectToBuffer(structuredClone(window.oscine.store.project), { loops: 1, slotIndex, tailSeconds: 1 });
  const d = r.buffer.getChannelData(0); let m = 0, pk = 0; for (const v of d) { m += v; pk = Math.max(pk, Math.abs(v)); }
  // also mean of the last 0.5 s (tail, after notes)
  let t = 0; const n = Math.floor(r.sampleRate * 0.5); for (let i = d.length - n; i < d.length; i++) t += d[i];
  return { mean: +(m / d.length).toFixed(4), tailMean: +(t / n).toFixed(4), peak: +pk.toFixed(3) };
}, slotIndex);
for (const slot of [0, 1]) {
  console.log(`slot ${'AB'[slot]} all:`, JSON.stringify(await meanOf(slot)));
  for (const n of names) {
    for (const m of names) await s.call('set_mix', { track: m, solo: m === n });
    console.log(`  solo ${n}:`, JSON.stringify(await meanOf(slot)));
  }
  for (const m of names) await s.call('set_mix', { track: m, solo: false });
}
// empty project
await s.call('project', { action: 'new', kind: 'blank', name: 'empty' });
console.log('empty blank project:', JSON.stringify(await meanOf(0)));
await s.close();
