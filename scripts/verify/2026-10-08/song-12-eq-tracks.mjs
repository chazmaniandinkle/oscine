// Per-track equivalence: render each Ledger track alone (patterns of others removed), tag old/new.
import { session, OUT } from './drive.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
const tag = process.argv[2] || 'new';
const s = await session(7425);
await s.call('project', { action: 'load', project: JSON.parse(readFileSync(`${OUT}/ledger.oscine.json`, 'utf8')) });
const res = await s.page.evaluate(async () => {
  const { renderProjectToBuffer } = await import('/src/engine/render.js');
  const base = structuredClone(window.oscine.store.project); const out = {};
  for (const t of base.tracks) {
    const p = structuredClone(base);
    for (const sl of p.slots) for (const id of Object.keys(sl.patterns)) if (id !== t.id) delete sl.patterns[id];
    p.fx.delayReturn = 0; p.fx.verbReturn = 0;
    const r = await renderProjectToBuffer(p, { slotIndex: 1, loops: 2, tailSeconds: 0.5 });
    const d = r.buffer.getChannelData(0); const u = new Uint8Array(d.buffer.slice(0));
    let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
    out[t.name] = btoa(s);
  }
  return out;
});
for (const [k, v] of Object.entries(res)) writeFileSync(`${OUT}/eqt-${tag}-${k}.f32`, Buffer.from(v, 'base64'));
console.log(tag, Object.keys(res).join(','), 'errors', s.errs.length);
await s.close();
