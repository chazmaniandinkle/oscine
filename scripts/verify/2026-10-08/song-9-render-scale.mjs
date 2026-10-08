import { session, OUT } from './drive.mjs';
import { readFileSync } from 'node:fs';
const s = await session(7419);
await s.call('project', { action: 'load', project: JSON.parse(readFileSync(`${OUT}/second-pass.oscine.json`, 'utf8')) });
const r = await s.page.evaluate(async () => {
  const { renderProjectToBuffer } = await import('/src/engine/render.js');
  const p = structuredClone(window.oscine.store.project);
  const out = {};
  for (const seq of [[0], [0, 1], [0, 1, 2, 3, 1]]) {
    const t0 = performance.now();
    const r = await renderProjectToBuffer(p, { sequence: seq, tailSeconds: 0.25 });
    out[seq.join('')] = { ms: Math.round(performance.now() - t0), sec: Math.round(r.buffer.duration) };
  }
  return out;
});
console.log(JSON.stringify(r));
await s.close();
