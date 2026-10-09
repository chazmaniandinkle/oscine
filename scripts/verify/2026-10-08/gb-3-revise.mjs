// Cartridge rev 2, from listen: intro sat at -34 dB (arp filter too closed), breakdown/outro 80% bass
// (sustained wave notes too loud), key read Bb minor (the bass owns the low chroma; give the lead the tonic more).
import { session, OUT } from './drive.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
const s = await session(7541);
const c = s.call;
await c('project', { action: 'load', project: JSON.parse(readFileSync(`${OUT}/cartridge.oscine.json`, 'utf8')) });
await c('pattern_automation', { action: 'set_points', slot: 'A', target: 'track:Arp:insert:0:cutoff', points: [{ beat: 0, v: 2000, shape: 'exp' }, { beat: 32, v: 12000 }] });
await c('set_notes', { track: 'Arp', slot: 'A', mode: 'transform', velScale: 1.4 });
for (const sl of ['E', 'H']) await c('set_notes', { track: 'Bass', slot: sl, mode: 'transform', velScale: 0.5 });
await c('set_mix', { track: 'Bass', gain: 0.75 });
await c('set_params', { track: 'Bass', params: { shift: 0 } });
// breakdown: arp in (sparse) so the harmony is heard, not only bass
await c('set_notes', { track: 'Arp', slot: 'E', mode: 'replace', notes: [0, 8, 16, 24].flatMap((t, i) => [[65, 68, 72], [61, 65, 68], [58, 61, 65], [60, 64, 67]][i].map((p, k) => ({ start: t + k * 0.5, pitch: p, dur: 6, vel: 0.5 }))) });
writeFileSync(`${OUT}/cartridge.oscine.json`, JSON.stringify(await c('project', { action: 'get' }), null, 1));
const r = await c('listen', { song: true, save: 'projects/songs/2026-10-08-cog-first-oscine/cartridge.wav' });
console.log(`whole ${r.seconds}s peak ${r.peakDb} rms ${r.rmsDb} clipped ${r.clipped} grid ${r.grid?.onOffRatio} key ${JSON.stringify(r.key)}`, JSON.stringify(r.bands));
for (const x of r.sections || []) console.log(`   ${x.slot} rms ${x.rmsDb}`, JSON.stringify(x.bands));
await s.close();
