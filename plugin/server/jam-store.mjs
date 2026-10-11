// Jam storage (sidecar side): <PROJECT_ROOT>/.cog/run/jam/<jam-id>/{meta.json,events.jsonl,audio.webm,audio.<seg>.webm,cursors.json}
// Pure node (fs + path), no server state, so test/jam.mjs drives it against a temp dir.
//
// The browser (src/ui/jam.js) streams: meta (JSON, merged per segment), events (jsonl append), audio (bytes append,
// per segment). Cog reads over the 'jam' command: list, and read-since-last-look with a per-reader cursor persisted
// in cursors.json, plus the matching audio window(s) so a hearing tool can be pointed at exactly that stretch.

import { mkdir, readFile, writeFile, appendFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { audioWindow } from '../app/src/core/jam.js';

export const JAM_ID_RE = /^jam-[0-9a-z]+(?:-[0-9a-z]+)*$/;
export const JAM_DIR = '.cog/run/jam';

export function jamRoot(projectRoot) { return join(resolve(projectRoot), JAM_DIR); }
export function jamDir(projectRoot, id) {
  if (!JAM_ID_RE.test(String(id || ''))) throw new Error(`bad jam id '${id}'`);
  return join(jamRoot(projectRoot), id);
}
const audioName = (seg) => (Number(seg) > 0 ? `audio.${Number(seg)}.webm` : 'audio.webm');

async function readJson(p, fallback) { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return fallback; } }

export async function writeMeta(projectRoot, id, patch) {
  const dir = jamDir(projectRoot, id);
  await mkdir(dir, { recursive: true });
  const cur = await readJson(join(dir, 'meta.json'), { id, segments: {} });
  const seg = Number.isInteger(patch?.seg) ? patch.seg : 0;
  const prevSeg = cur.segments?.[seg] || {};
  const next = { ...cur, ...patch, id, segments: { ...(cur.segments || {}), [seg]: { ...prevSeg, ...(patch.audio ? { audio: { ...(prevSeg.audio || {}), ...patch.audio } } : {}), started_t: prevSeg.started_t ?? patch.started_t ?? null } } };
  delete next.seg; delete next.audio;                   // per-segment facts live under segments[seg]
  await writeFile(join(dir, 'meta.json'), JSON.stringify(next, null, 1) + '\n');
  return next;
}

export async function appendEvents(projectRoot, id, text) {
  const dir = jamDir(projectRoot, id);
  await mkdir(dir, { recursive: true });
  const body = String(text);
  await appendFile(join(dir, 'events.jsonl'), body.endsWith('\n') ? body : body + '\n');
  return { ok: true, bytes: body.length };
}

export async function appendAudio(projectRoot, id, seg, bytes) {
  const dir = jamDir(projectRoot, id);
  await mkdir(dir, { recursive: true });
  await appendFile(join(dir, audioName(seg)), bytes);
  return { ok: true, bytes: bytes.length, file: audioName(seg) };
}

export async function readEvents(projectRoot, id) {
  let text = '';
  try { text = await readFile(join(jamDir(projectRoot, id), 'events.jsonl'), 'utf8'); } catch { return []; }
  const out = [];
  for (const line of text.split('\n')) { if (!line.trim()) continue; try { out.push(JSON.parse(line)); } catch { /* a torn last line while streaming */ } }
  return out;
}

export async function listJams(projectRoot) {
  let names = [];
  try { names = await readdir(jamRoot(projectRoot)); } catch { return []; }
  const out = [];
  for (const id of names.filter(n => JAM_ID_RE.test(n))) {
    const dir = jamDir(projectRoot, id);
    const meta = await readJson(join(dir, 'meta.json'), {});
    const evs = await readEvents(projectRoot, id);
    let audioBytes = 0;
    for (const seg of Object.keys(meta.segments || { 0: 1 })) { try { audioBytes += (await stat(join(dir, audioName(seg)))).size; } catch { /* none */ } }
    out.push({ id, project: meta.project ?? null, bpm: meta.bpm ?? null, started_t: meta.started_t ?? null, stopped_t: meta.stopped_t ?? null, events: evs.length, segments: Object.keys(meta.segments || {}).length, audio_bytes: audioBytes, open: meta.stopped_t == null });
  }
  return out.sort((a, b) => (b.started_t || 0) - (a.started_t || 0));
}

export function summarize(events) {
  const kinds = {};
  for (const e of events) kinds[e.kind] = (kinds[e.kind] || 0) + 1;
  return kinds;
}

// Everything since this reader last looked, plus the audio window(s) that cover it.
//   id       the jam (default: the newest)
//   readerId whose cursor to use/advance (default 'cog');  all: ignore the cursor and return everything (cursor untouched)
//   peek     return without advancing the cursor
//   limit    cap events returned (the cursor then advances only past what was returned)
export async function readJam(projectRoot, { id, readerId = 'cog', all = false, peek = false, limit } = {}) {
  const jams = await listJams(projectRoot);
  const jid = id || jams[0]?.id;
  if (!jid) return { ok: false, error: 'no jams recorded yet (start one: oscine_jam {action:"start"})' };
  const dir = jamDir(projectRoot, jid);
  const meta = await readJson(join(dir, 'meta.json'), {});
  const cursors = await readJson(join(dir, 'cursors.json'), {});
  const since = all ? 0 : (cursors[readerId] ?? 0);
  const evs = await readEvents(projectRoot, jid);
  let fresh = evs.filter(e => e.seq >= since);
  if (limit && fresh.length > limit) fresh = fresh.slice(0, limit);
  const next = fresh.length ? fresh[fresh.length - 1].seq + 1 : since;
  if (!all && !peek && fresh.length) { cursors[readerId] = next; await writeFile(join(dir, 'cursors.json'), JSON.stringify(cursors, null, 1) + '\n'); }
  // Audio windows: one per segment present in this batch, using that segment's own t0.
  const windows = [];
  const bySeg = new Map();
  for (const e of fresh) { if (!bySeg.has(e.seg ?? 0)) bySeg.set(e.seg ?? 0, []); bySeg.get(e.seg ?? 0).push(e); }
  for (const [seg, list] of bySeg) {
    const a = meta.segments?.[seg]?.audio;
    const w = a && Number.isFinite(a.audio_t0_ct) ? audioWindow(list, a.audio_t0_ct) : null;
    windows.push({ seg, file: a?.file || audioName(seg), ...(w || {}), aligned: !!w });
  }
  const t = fresh.map(e => e.t).filter(Number.isFinite);
  return {
    ok: true, id: jid, readerId, cursor: { from: since, next }, open: meta.stopped_t == null,
    count: fresh.length, kinds: summarize(fresh), wall_ms: t.length ? { first: Math.min(...t), last: Math.max(...t) } : null,
    audio: { dir: join(JAM_DIR, jid), windows }, events: fresh,
  };
}
