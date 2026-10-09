import { session, OUT } from './drive.mjs';
import { readFileSync } from 'node:fs';
const s = await session(7491);
await s.call('project', { action: 'load', project: JSON.parse(readFileSync(`${OUT}/second-pass.oscine.json`, 'utf8')) });
const r = await s.page.evaluate(async () => {
  const pm = await import('/src/engine/patternmix.js');
  const base = structuredClone(window.oscine.store.project);
  const pad = base.tracks.find(t => t.name === 'Pad');
  const slot = { bars: 16, automation: [{ target: `track:${pad.id}:insert:0:cutoff`, points: [{ beat: 0, v: 150, shape: 'exp' }, { beat: 64, v: 14000 }] }] };
  const ctx = new OfflineAudioContext(2, 44100 * 23, 44100);
  const strip = pm.buildPatternStrip(ctx, { channel: { inserts: [{ type: 'resofilter', params: { filterType: 'lowpass', cutoff: 300, resonance: 1 }, bypass: false }] } });
  const panner = ctx.createStereoPanner();
  const strips = new Map([[pad.id, { strip, panner, instrument: null }]]);
  const fx = strip.chain.effects[0];
  const node = fx.paramNode('cutoff');
  const jobs = pm.scheduleSlotAutomation(slot, { strips, master: null, passStart: 0, secPerBeat: 60 / 174, beats: 64 });
  // probe the param value over time via suspend
  const vals = [];
  for (let t = 1; t < 22; t += 3) ctx.suspend(Math.floor(t * 44100 / 128) * 128 / 44100).then(() => { vals.push([t, Math.round(node.value)]); ctx.resume(); });
  const o = ctx.createConstantSource(); o.connect(strip.input); strip.output.connect(ctx.destination); o.start();
  await ctx.startRendering();
  return { jobs: jobs.length, fxType: fx.def.type, sameNode: node === fx.filter.frequency, vals };
});
console.log(JSON.stringify(r));
await s.close();
