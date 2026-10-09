import { session, OUT } from './drive.mjs';
import { readFileSync } from 'node:fs';
const s = await session(7473);
await s.call('project', { action: 'load', project: JSON.parse(readFileSync(`${OUT}/second-pass.oscine.json`, 'utf8')) });
const r = await s.page.evaluate(async () => {
  const { renderProjectToBuffer } = await import('/src/engine/render.js');
  const { measure } = await import('/src/engine/listen.js');
  const base = structuredClone(window.oscine.store.project);
  const pad = base.tracks.find(t => t.name === 'Pad');
  const run = async (inserts, automation, loops = 1) => {
    const p = structuredClone(base);
    for (const t of p.tracks) t.channel.mute = t.name !== 'Pad';
    p.tracks.find(t => t.name === 'Pad').channel.inserts = inserts;
    p.slots[2].automation = automation;
    p.fx.verbReturn = 0; p.fx.delayReturn = 0;
    const out = await renderProjectToBuffer(p, { slotIndex: 2, loops, tailSeconds: 0.2 });
    const ch = [out.buffer.getChannelData(0), out.buffer.getChannelData(1)], sr = out.buffer.sampleRate;
    const slotSec = p.slots[2].bars * 4 * 60 / p.bpm;
    const qs = [];
    for (let pass = 0; pass < loops; pass++) for (let q = 0; q < 8; q++) {
      const a = pass * slotSec + q * slotSec / 8, b = a + slotSec / 8;
      const m = measure(ch, sr, { from: a, to: b }); qs.push(m.bands.mid + m.bands.high);
    }
    return qs;
  };
  const ins = [{ type: 'resofilter', params: { filterType: 'lowpass', cutoff: 300, resonance: 1 }, bypass: false }];
  const auto = [{ target: `track:${pad.id}:insert:0:cutoff`, points: [{ beat: 0, v: 150, shape: 'exp' }, { beat: 64, v: 14000 }] }];
  const dry = await run([], undefined, 2), wet = await run(ins, auto, 2);
  return wet.map((w, i) => +(w / dry[i]).toFixed(2));
});
console.log('mid+high vs unfiltered, per 1/8 of the slot, two passes:', JSON.stringify(r));
const p1 = r.slice(0, 8), p2 = r.slice(8);
const rising = a => a[7] > a[0] * 3 && a[6] > a[1];
console.log(rising(p1) && rising(p2) ? 'PASS' : 'FAIL', 'sweep opens across each pass, and restarts on the repeat:', p2[0] < p1[7]);
console.log('errors', s.errs);
await s.close();
