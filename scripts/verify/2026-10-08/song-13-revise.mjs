// Revision driven by listen: drops 85% sub+bass / 1% high -> pull reese, lift kit metal, stabs, pad;
// intro/breakdown 14 dB under the drops -> bring them up ~4 dB.
import { session, OUT } from './drive.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
const s = await session(7427);
const c = s.call;
await c('project', { action: 'load', project: JSON.parse(readFileSync(`${OUT}/second-pass.oscine.json`, 'utf8')) });
await c('set_mix', { track: 'Reese', gain: 0.55 });
await c('set_params', { track: 'Reese', params: { sub: 0.65, top: 0.85, cutoff: 1500 } });
await c('set_params', { track: 'Kit', params: { hatLevel: 1.3, hatTone: 0.7, snareTone: 0.7, kickClick: 0.6 } });
await c('set_mix', { track: 'Stabs', gain: 0.62 });
await c('set_mix', { track: 'Pad', gain: 0.5 });
await c('set_params', { track: 'Pad', params: { shimmer: 0.45 } });
// breakdown + intro: the hook, choir and pad a touch louder (per-slot velocity via transform)
for (const [t, sl] of [['Lead', 'C'], ['Choir', 'C'], ['Pad', 'C'], ['Pad', 'A'], ['Choir', 'A']]) await c('set_notes', { track: t, slot: sl, mode: 'transform', velScale: 1.35 });
let r;
for (let pass = 1; pass <= 3; pass++) {
  r = await c('listen', { song: true });
  console.log(`pass ${pass}: peak ${r.peakDb} rms ${r.rmsDb} clipped ${r.clipped}`, JSON.stringify(r.bands), r.notes || '');
  for (const x of r.sections) console.log(`   ${x.slot} @${x.startSec}s rms ${x.rmsDb}`, JSON.stringify(x.bands));
  if (r.clipped || r.peakDb > -1) { const st = await c('status'); await c('set_master', { volume: +(st.project.masterVolume * Math.pow(10, (-1.2 - r.peakDb) / 20)).toFixed(3) }); continue; }
  break;
}
const fin = await c('listen', { song: true, save: 'projects/songs/2026-10-08-cog-first-oscine/second-pass.wav' });
console.log('saved', fin.saved, 'peak', fin.peakDb, 'grid', fin.grid?.onOffRatio);
writeFileSync(`${OUT}/second-pass.oscine.json`, JSON.stringify(await c('project', { action: 'get' }), null, 1));
console.log('errors', s.errs);
await s.close();
