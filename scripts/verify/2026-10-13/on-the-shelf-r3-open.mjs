// Open On the Shelf r3 (arrangement project: 5 stem lanes) in Oscine through the real sidecar, bounce it with
// Oscine's own offline renderer, screenshot the timeline. Proves the song lives in Oscine, not only in Python.
import { session } from '../2026-10-08/drive.mjs';
import { writeFileSync } from 'node:fs';
const SONG = '/Users/slowbro/workspaces/cog/projects/songs/2026-10-13-on-the-shelf';
const s = await session(7445);
const r = await s.call('project_open_file', { path: 'projects/songs/2026-10-13-on-the-shelf/on-the-shelf.oscine.json' });
console.log('open', JSON.stringify(r).slice(0, 200));
await s.page.waitForTimeout(6000);
const info = await s.page.evaluate(() => { const p = window.oscine.store.project;
  return { name: p.name, lanes: p.arrangement?.lanes?.map(l => l.name), placements: p.arrangement?.placements?.length,
           markers: p.arrangement?.markers?.map(m => m.name), length: p.arrangement?.length }; });
console.log(JSON.stringify(info));
const b64 = await s.page.evaluate(async () => {
  const { renderProjectToBuffer } = await import('/src/engine/render.js');
  const { encodeWav } = await import('/src/core/wav.js');
  const res = await renderProjectToBuffer(structuredClone(window.oscine.store.project), {});
  const buf = res.buffer; const blob = encodeWav([buf.getChannelData(0), buf.getChannelData(1)], res.sampleRate ?? buf.sampleRate);
  const bytes = new Uint8Array(blob instanceof Blob ? await blob.arrayBuffer() : blob.buffer ?? blob);
  let str = ''; for (let i = 0; i < bytes.length; i += 0x8000) str += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(str);
});
writeFileSync(`${SONG}/on-the-shelf.r3.oscine-bounce.wav`, Buffer.from(b64, 'base64'));
await s.page.setViewportSize({ width: 1600, height: 900 }); await s.page.waitForTimeout(1500);
await s.page.screenshot({ path: `${SONG}/on-the-shelf.r3.timeline.png` });
console.log('errors', s.errs); await s.close();
