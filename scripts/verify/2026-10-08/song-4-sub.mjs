// Revision 3: ear says B is 82% 60-250 Hz and only 3% below 60. My "sub" at F2 (87 Hz) is a bass,
// not a sub. Drop it an octave (F1 = 43.7 Hz, the DnB sub zone), keep the octave blip, and lower it.
// Then stitch A B C B' D into a song (outside Oscine: no song-of-slots in the pattern model).
import { session, OUT, friction } from './drive.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
const s = await session(7409);
const c = s.call;
await c('project', { action: 'load', project: JSON.parse(readFileSync(`${OUT}/ledger.oscine.json`, 'utf8')) });
for (const slot of ['B', 'C']) {
  const cur = await c('get_notes', { track: 'Sub', slot });
  const down = cur.notes.map(({ start, pitch, dur, vel }) => ({ start, pitch: pitch - 12, dur, vel }));
  await c('set_notes', { track: 'Sub', slot, mode: 'replace', notes: down });
}
friction('Transpose = read every note and write them back shifted. A transpose/shift op on set_notes would be one call.');
await c('set_mix', { track: 'Sub', gain: 0.7 });
writeFileSync(`${OUT}/ledger.oscine.json`, JSON.stringify(await c('project', { action: 'get' }), null, 1));
for (const [i, n] of ['A', 'B', 'C', 'D'].entries()) await s.render(i, 1, `slot-${n}.wav`, i === 3 ? 4.0 : 0.0);
console.log('errors', s.errs);
await s.close();
