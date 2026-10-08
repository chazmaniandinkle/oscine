// Render-equivalence + speed check for the just-in-time scheduler.
// Writes a raw Float32 render of Ledger slot B (FM + poly + drums, the June instruments)
// to OUT/eq-<tag>.f32, and times the Second Pass song.
import { session, OUT } from './drive.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
const tag = process.argv[2] || 'new';
const s = await session(7423);
await s.call('project', { action: 'load', project: JSON.parse(readFileSync(`${OUT}/ledger.oscine.json`, 'utf8')) });
const b64 = await s.page.evaluate(async () => {
  const { renderProjectToBuffer } = await import('/src/engine/render.js');
  const r = await renderProjectToBuffer(structuredClone(window.oscine.store.project), { slotIndex: 1, loops: 2, tailSeconds: 1 });
  const d = r.buffer.getChannelData(0); const u = new Uint8Array(d.buffer.slice(0));
  let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s);
});
writeFileSync(`${OUT}/eq-${tag}.f32`, Buffer.from(b64, 'base64'));
if (tag === 'new') {
  await s.call('project', { action: 'load', project: JSON.parse(readFileSync(`${OUT}/second-pass.oscine.json`, 'utf8')) });
  const t = await s.page.evaluate(async () => {
    const { renderProjectToBuffer } = await import('/src/engine/render.js');
    const t0 = performance.now();
    const r = await renderProjectToBuffer(structuredClone(window.oscine.store.project), { sequence: window.oscine.store.project.song, tailSeconds: 0.25 });
    return { ms: Math.round(performance.now() - t0), sec: +r.buffer.duration.toFixed(1) };
  });
  console.log('Second Pass full song render', JSON.stringify(t));
}
console.log('errors', s.errs);
await s.close();
