// Probe every fix through the MCP tools, measuring with listen.
import { session, OUT } from './drive.mjs';
import { readFileSync } from 'node:fs';
const s = await session(7461);
const c = s.call;
const ok = (cond, msg, extra = '') => console.log(cond ? 'PASS' : 'FAIL', msg, extra);
await c('project', { action: 'load', project: JSON.parse(readFileSync(`${OUT}/second-pass.oscine.json`, 'utf8')) });

// 1. old 4-slot project loads padded to 8
const sl = await c('slots', { action: 'list' });
ok(sl.slots?.length === 8, 'old project padded to 8 slots', sl.slots?.map(x => x.slot).join(''));

// 2. determinism: whole project (reverbs + June-noise) renders identically twice
const det = await s.page.evaluate(async () => {
  const { renderProjectToBuffer } = await import('/src/engine/render.js');
  const p = structuredClone(window.oscine.store.project);
  const a = (await renderProjectToBuffer(p, { slotIndex: 1, loops: 1, tailSeconds: 2 })).buffer.getChannelData(0);
  const b = (await renderProjectToBuffer(p, { slotIndex: 1, loops: 1, tailSeconds: 2 })).buffer.getChannelData(0);
  let d = 0; for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i] - b[i])); return d;
});
ok(det < 1e-5, 'full-mix render deterministic (reverb IRs seeded)', `max diff ${det}`);

// 3. pattern insert: EQ high shelf on the Kit raises the high band
const before = await c('listen', { slot: 'B', solo: ['Kit'] });
const ins = await c('insert', { action: 'add', lane: 'track:Kit', type: 'eq3', params: { highFreq: 6000, highGain: 9 } });
ok(ins.ok && ins.owner === 'track:Kit', 'insert add on a pattern track', JSON.stringify(ins.chain?.[0]?.params));
const after = await c('listen', { slot: 'B', solo: ['Kit'] });
ok(after.bands.high > before.bands.high * 1.5, 'EQ high shelf raises the Kit high band', `${before.bands.high} -> ${after.bands.high}`);
await c('insert', { action: 'remove', lane: 'track:Kit', index: 0 });

// 4. pattern-master chain: a limiter holds the peak
await c('insert', { action: 'add', lane: 'pattern-master', type: 'limiter' });
const lim = await c('insert', { action: 'list', lane: 'pattern-master' });
console.log('  limiter params', JSON.stringify(lim.inserts?.[0]?.params));
const lm = await c('listen', { slot: 'B' });
ok(lm.clipped === 0, 'pattern-master limiter in path, no clipping', `peak ${lm.peakDb}`);
await c('insert', { action: 'remove', lane: 'pattern-master', index: 0 });

// 5. slot automation: a lowpass sweep on the Pad (C slot) opens over 16 bars -> high band rises across the slot
await c('insert', { action: 'add', lane: 'track:Pad', type: 'resofilter', params: { filterType: 'lowpass', cutoff: 300, resonance: 2 } });
const au = await c('pattern_automation', { action: 'set_points', slot: 'C', target: 'track:Pad:insert:0:cutoff', points: [{ beat: 0, v: 200 }, { beat: 64, v: 12000, shape: 'exp' }] });
ok(au.envelopes?.length === 1, 'pattern_automation set_points', JSON.stringify(au.envelopes?.[0]?.points));
const sweep = await s.page.evaluate(async () => {
  const { renderProjectToBuffer } = await import('/src/engine/render.js');
  const { measure } = await import('/src/engine/listen.js');
  const p = structuredClone(window.oscine.store.project); for (const t of p.tracks) t.channel.mute = t.name !== 'Pad';
  const r = await renderProjectToBuffer(p, { slotIndex: 2, loops: 1, tailSeconds: 0.2 });
  const ch = [r.buffer.getChannelData(0), r.buffer.getChannelData(1)], sr = r.buffer.sampleRate, d = r.buffer.duration;
  const q = (a, b) => { const m = measure(ch, sr, { from: a, to: b }); return +(m.bands.mid + m.bands.high).toFixed(3); };
  return [q(0, d / 4), q(d / 4, d / 2), q(d / 2, 3 * d / 4), q(3 * d / 4, d - 0.2)];
});
ok(sweep[3] > sweep[0] * 2 && sweep[1] > sweep[0] && sweep[2] > sweep[1], 'filter sweep opens across the slot (mid+high share by quarter)', JSON.stringify(sweep));
// instrument-param automation (k-rate): reese cutoff
const ip = await c('pattern_automation', { action: 'set_points', slot: 'B', target: 'track:Reese:param:cutoff', points: [{ beat: 0, v: 200 }, { beat: 32, v: 4000 }] });
ok(ip.envelopes?.some(e => e.target === 'track:Reese:param:cutoff'), 'instrument-param automation accepted');
const bad = await c('pattern_automation', { action: 'set_points', slot: 'B', target: 'track:Reese:param:saws_typo', points: [{ beat: 0, v: 1 }] });
ok(!!bad.error, 'bad instrument param rejected', String(bad.error).slice(0, 90));
await c('pattern_automation', { action: 'clear', slot: 'B' });
await c('pattern_automation', { action: 'clear', slot: 'C' });
await c('insert', { action: 'remove', lane: 'track:Pad', index: 0 });

// 6. slot H: write, song-sequence, render
await c('slots', { action: 'set_bars', slot: 'H', bars: 4 });
await c('slots', { action: 'copy', from: 'B', to: 'H', track: 'Reese' });
const sh = await c('song', { action: 'set', sequence: ['A', 'H'] });
ok(sh.sections?.[1]?.slot === 'H', 'slot H usable in a song', JSON.stringify(sh.sequence));
await c('song', { action: 'set', sequence: ['A', 'B', 'C', 'D', 'B'] });

// 7. key estimate on the full song
const k = await c('listen', { song: true });
ok(k.key?.key === 'F minor' || k.key?.relative === 'F minor', 'listen key estimate on Second Pass (written F minor)', JSON.stringify(k.key));
const kp = await c('listen', { slot: 'C', solo: ['Pad'] });
console.log('  pad alone (Fm9 Dbmaj9 Bbm9 C7b9):', JSON.stringify(kp.key));
// 8. tools profile
console.log('errors', s.errs);
await s.close();
