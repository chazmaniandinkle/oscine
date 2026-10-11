// Live smoke for jam phrases/clip: writes a synthetic jam into the REAL jam dir, calls the running sidecar's MCP, then removes it.
// Run: node scripts/verify/2026-10-11/jam-phrases-smoke.mjs   (sidecar on 127.0.0.1:7450)
import { mkdir, writeFile, rm, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = '/Users/slowbro/workspaces/cog';
const id = 'jam-smoke-phrases';
const dir = join(ROOT, '.cog/run/jam', id);
const T0 = Date.now() - 20000, CT0 = 100;
let seq = 0;
const ev = (kind, ms, x = {}) => ({ seq: seq++, seg: 0, t: T0 + ms, ct: CT0 + ms / 1000, beat: null, kind, ...x });
const on = (ms, pitch) => ev('note', ms, { on: true, pitch, vel: 0.8, trackId: 'lead', trackName: 'Lead' });
const off = (ms, pitch) => ev('note', ms, { on: false, pitch, trackId: 'lead', trackName: 'Lead' });
const events = [on(0, 60), off(240, 60), on(260, 64), off(500, 64), on(515, 67), off(740, 67), on(745, 72), off(1000, 72), on(6000, 69), off(6400, 69)];
await mkdir(dir, { recursive: true });
await writeFile(join(dir, 'events.jsonl'), events.map(e => JSON.stringify(e)).join('\n') + '\n');
await writeFile(join(dir, 'meta.json'), JSON.stringify({ id, bpm: 120, started_t: T0, stopped_t: T0 + 7000, segments: { 0: { started_t: T0, audio: { file: 'audio.webm', audio_t0_ct: CT0 - 0.2 } } } }));
execFileSync('/opt/homebrew/bin/ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=8', '-c:a', 'libopus', join(dir, 'audio.webm')]);

let n = 1;
const call = async (args) => {
  const r = await fetch('http://127.0.0.1:7450/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: n++, method: 'tools/call', params: { name: 'oscine_jam', arguments: args } }) });
  const j = await r.json();
  if (j.error) throw new Error(JSON.stringify(j.error));
  return JSON.parse(j.result.content[0].text);
};
let bad = 0;
const check = (name, ok, d = '') => { console.log((ok ? '  ok  ' : 'FAIL  ') + name + (d ? '  ' + d : '')); if (!ok) bad++; };
try {
  const ps = await call({ action: 'phrases', id, notes: false });
  check('phrases over live MCP', ps.ok && ps.total === 2, `total ${ps.total}: ${ps.phrases?.map(p => `${p.id} "${p.contour}"`).join(' | ')}`);
  const c = await call({ action: 'clip', id, phraseId: ps.phrases[0].id, quantize: '1/8' });
  check('clip: quantized notes', c.ok && c.clip.notes.map(x => `${x.start}:${x.pitch}`).join(' ') === '0:60 0.5:64 1:67 1.5:72', c.clip?.notes.map(x => `${x.start}:${x.pitch}`).join(' '));
  check('clip: wav on disk at an absolute path', c.audio?.ok && (await stat(c.audio.path)).size > 1000, c.audio?.path);
  const r = await call({ action: 'clip', id, fromSec: 6.0, toSec: 6.6 });
  check('clip by audio range', r.ok && r.clip.notes.length === 1 && r.clip.notes[0].pitch === 69, r.error || '');
  const e = await call({ action: 'clip', id, phraseId: 'ph-9999' });
  check('bad phraseId is a clean error', e.ok === false && /Recent/.test(e.error));
  // toSlot writes into whatever project is open in the app (one undo step); run it by hand on a scratch project, not here.
  } finally { await rm(dir, { recursive: true, force: true }); }
console.log(bad ? `${bad} FAILED` : 'live smoke ok');
process.exit(bad ? 1 : 0);
