import { session, OUT } from './drive.mjs';
import { readFileSync } from 'node:fs';
const s = await session(7451);
await s.call('project', { action: 'load', project: JSON.parse(readFileSync(`${OUT}/second-pass.oscine.json`, 'utf8')) });
const r = await s.page.evaluate(async () => {
  const { renderProjectToBuffer } = await import('/src/engine/render.js');
  const { measure } = await import('/src/engine/listen.js');
  const base = structuredClone(window.oscine.store.project);
  const pad = base.tracks.find(t => t.name === 'Pad');
  const run = async (inserts, automation) => {
    const p = structuredClone(base);
    for (const t of p.tracks) t.channel.mute = t.name !== 'Pad';
    p.tracks.find(t => t.name === 'Pad').channel.inserts = inserts;
    p.slots[2].automation = automation;
    p.fx.verbReturn = 0; p.fx.delayReturn = 0;
    const out = await renderProjectToBuffer(p, { slotIndex: 2, loops: 1, tailSeconds: 0.2 });
    const ch = [out.buffer.getChannelData(0), out.buffer.getChannelData(1)], sr = out.buffer.sampleRate, d = out.buffer.duration;
    const q = (a, b) => { const m = measure(ch, sr, { from: a, to: b }); return `${m.rmsDb}dB lm+m+h ${(m.bands.lowmid + m.bands.mid + m.bands.high).toFixed(2)}`; };
    return [q(0, d / 4), q(3 * d / 4, d)];
  };
  return {
    none: await run([], undefined),
    lp300: await run([{ type: 'resofilter', params: { filterType: 'lowpass', cutoff: 300, resonance: 1 }, bypass: false }], undefined),
    eqlp: await run([{ type: 'eq3', params: { lpFreq: 1000 }, bypass: false }], undefined),
    sweep: await run([{ type: 'resofilter', params: { filterType: 'lowpass', cutoff: 300, resonance: 1 }, bypass: false }],
      [{ target: `track:${pad.id}:insert:0:cutoff`, points: [{ beat: 0, v: 200 }, { beat: 64, v: 12000, shape: 'exp' }] }]),
  };
});
console.log(JSON.stringify(r, null, 1));
await s.close();
