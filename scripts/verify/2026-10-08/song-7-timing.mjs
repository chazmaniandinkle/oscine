// Where does `listen` spend its time? Load the saved Second Pass project (if any) or build a small one,
// then time render vs measure separately, per section length.
import { session, OUT } from './drive.mjs';
import { existsSync, readFileSync } from 'node:fs';
const s = await session(7415);
const f = `${OUT}/second-pass.oscine.json`;
if (existsSync(f)) await s.call('project', { action: 'load', project: JSON.parse(readFileSync(f, 'utf8')) });
const r = await s.page.evaluate(async () => {
  const { renderProjectToBuffer } = await import('/src/engine/render.js');
  const { measure } = await import('/src/engine/listen.js');
  const p = structuredClone(window.oscine.store.project);
  const out = { tracks: p.tracks.map(t => t.instrument.type), song: p.song };
  let t0 = performance.now();
  const one = await renderProjectToBuffer(p, { slotIndex: 1, loops: 1, tailSeconds: 0.25 });
  out.renderSlotMs = Math.round(performance.now() - t0); out.slotSec = one.buffer.duration;
  const ch = [one.buffer.getChannelData(0), one.buffer.getChannelData(1)];
  t0 = performance.now(); measure(ch, one.sampleRate, {}); out.measureNoGridMs = Math.round(performance.now() - t0);
  t0 = performance.now(); measure(ch, one.sampleRate, { bpm: p.bpm }); out.measureWithGridMs = Math.round(performance.now() - t0);
  return out;
});
console.log(JSON.stringify(r));
console.log('errors', s.errs);
await s.close();
