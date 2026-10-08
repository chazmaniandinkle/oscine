import { session, OUT } from './drive.mjs';
import { readFileSync } from 'node:fs';
const s = await session(7421);
await s.call('project', { action: 'load', project: JSON.parse(readFileSync(`${OUT}/second-pass.oscine.json`, 'utf8')) });
const r = await s.page.evaluate(async () => {
  const { renderProjectToBuffer } = await import('/src/engine/render.js');
  const base = structuredClone(window.oscine.store.project);
  const out = {};
  for (const t of base.tracks) {
    const p = structuredClone(base); for (const u of p.tracks) u.channel.mute = u.id !== t.id;
    // muted tracks still schedule notes; drop their patterns to time one instrument alone
    for (const sl of p.slots) for (const id of Object.keys(sl.patterns)) if (id !== t.id) delete sl.patterns[id];
    const t0 = performance.now();
    await renderProjectToBuffer(p, { slotIndex: 1, loops: 1, tailSeconds: 0.25 });
    const n = (base.slots[1].patterns[t.id]?.notes?.length) ?? Object.values(base.slots[1].patterns[t.id]?.steps || {}).flat().filter(Boolean).length;
    out[`${t.name}(${t.instrument.type})`] = { ms: Math.round(performance.now() - t0), events: n };
  }
  return out;
});
console.log(JSON.stringify(r, null, 1));
await s.close();
