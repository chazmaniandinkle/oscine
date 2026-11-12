// Jam storage (sidecar side): <PROJECT_ROOT>/.cog/run/jam/<jam-id>/{meta.json,events.jsonl,audio.webm,audio.<seg>.webm,cursors.json}
// Pure node (fs + path), no server state, so test/jam.mjs drives it against a temp dir.
//
// The browser (src/ui/jam.js) streams: meta (JSON, merged per segment), events (jsonl append), audio (bytes append,
// per segment). Cog reads over the 'jam' command: list, and read-since-last-look with a per-reader cursor persisted
// in cursors.json, plus the matching audio window(s) so a hearing tool can be pointed at exactly that stretch.

import { mkdir, readFile, writeFile, appendFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { audioWindow } from '../app/src/core/jam.js';
import { segmentPhrases, clipFromPhrase } from '../app/src/core/jamphrases.js';

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

// -- phrases, clips, audio cuts ------------------------------------------------------------------------------------------
// phrases: the jam's played notes grouped into musical phrases (src/core/jamphrases.js), newest last.
// clip:    one phrase (or any audio-time range) as a quantized clip in the shape set_notes / set_steps take, plus the
//          matching audio cut to <jam dir>/clips/<name>.wav. Placing a clip into a slot needs the app (one undo step):
//          the MCP dispatcher forwards the clip to the app's 'jam' action 'place'.

const r3 = (v) => Math.round(v * 1000) / 1000;
const slim = ({ notes, hits, firstSeq, ...rest }) => rest;       // a phrase without its note list
const FFMPEG = process.env.OSCINE_FFMPEG || 'ffmpeg';

async function loadJam(projectRoot, id) {
  const jams = await listJams(projectRoot);
  const jid = id || jams[0]?.id;
  if (!jid) return { error: 'no jams recorded yet (start one: oscine_jam {action:"start"})' };
  if (!jams.find(j => j.id === jid)) return { error: `no jam '${jid}' (jam ids: ${jams.slice(0, 5).map(j => j.id).join(', ') || 'none'})` };
  const dir = jamDir(projectRoot, jid);
  return { jid, dir, meta: await readJson(join(dir, 'meta.json'), {}), events: await readEvents(projectRoot, jid) };
}

export async function phrasesOf(projectRoot, { id, jamId, sinceSec, track, gapSec, gapBeats, limit = 12, notes = true } = {}) {
  const j = await loadJam(projectRoot, id || jamId);
  if (j.error) return { ok: false, error: j.error };
  let all = segmentPhrases(j.events, { meta: j.meta, track, gapSec, gapBeats });
  if (Number.isFinite(sinceSec) && sinceSec > 0) {
    const lastT = Math.max(0, ...j.events.map(e => e.t).filter(Number.isFinite));
    all = all.filter(p => p.end.t >= lastT - sinceSec * 1000);
  }
  const total = all.length;
  const shown = all.slice(-Math.max(1, limit));
  return { ok: true, id: j.jid, open: j.meta.stopped_t == null, bpm: j.meta.bpm ?? null, total, count: shown.length, phrases: notes ? shown : shown.map(slim) };
}

function cut(src, out, fromSec, toSec, ffmpeg = FFMPEG) {
  return new Promise((resolveP) => {
    const args = ['-y', '-v', 'error', '-i', src, '-ss', String(fromSec), '-t', String(Math.max(0.05, toSec - fromSec)), '-ar', '44100', out];
    execFile(ffmpeg, args, { timeout: 60000 }, (err, _so, se) => resolveP(err ? { ok: false, error: String(se || err.message).trim().slice(0, 300) } : { ok: true }));
  });
}

// Cut audio [fromSec, toSec] of a jam segment's audio file to clips/<name>.wav. Returns the absolute path.
export async function cutAudio(projectRoot, id, { seg = 0, from_sec, to_sec, name }, { ffmpeg } = {}) {
  const j = await loadJam(projectRoot, id);
  if (j.error) return { ok: false, error: j.error };
  if (!Number.isFinite(from_sec) || !Number.isFinite(to_sec) || to_sec <= from_sec) return { ok: false, error: 'cut needs from_sec < to_sec (seconds into the jam audio)' };
  const file = j.meta.segments?.[seg]?.audio?.file || audioName(seg);
  const src = join(j.dir, file);
  try { await stat(src); } catch { return { ok: false, error: `no audio file ${file} in ${j.jid} (was the jam recorded with audio?)` }; }
  const safe = String(name || `cut-${seg}-${from_sec}-${to_sec}`).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);
  const outDir = join(j.dir, 'clips');
  await mkdir(outDir, { recursive: true });
  const out = join(outDir, safe + '.wav');
  const r = await cut(src, out, from_sec, to_sec, ffmpeg);
  return r.ok ? { ok: true, path: out, seg, file, from_sec: r3(from_sec), to_sec: r3(to_sec) } : { ok: false, error: `ffmpeg: ${r.error}` };
}

export async function clipOf(projectRoot, args = {}, { ffmpeg } = {}) {
  const { id, jamId, phraseId, fromSec, toSec, seg = 0, track, quantize, rebase } = args;
  const j = await loadJam(projectRoot, id || jamId);
  if (j.error) return { ok: false, error: j.error };
  let phrase = null, audioReq = null;
  if (phraseId) {
    const all = segmentPhrases(j.events, { meta: j.meta, track });
    phrase = all.find(p => p.id === phraseId);
    if (!phrase) return { ok: false, error: `no phrase '${phraseId}' in ${j.jid}. Recent: ${all.slice(-6).map(p => p.id).join(', ') || 'none'} (oscine_jam {action:"phrases"})` };
    if (phrase.audio?.aligned) audioReq = { seg: phrase.audio.seg, from_sec: phrase.audio.from_sec, to_sec: phrase.audio.to_sec, name: phrase.id };
  } else if (Number.isFinite(fromSec) && Number.isFinite(toSec) && toSec > fromSec) {
    const a = j.meta.segments?.[seg]?.audio;
    if (!a || !Number.isFinite(a.audio_t0_ct)) return { ok: false, error: `segment ${seg} has no audio clock (audio_t0_ct); can't map seconds to events. Use phraseId, or a segment recorded with audio.` };
    const window = { seg, fromCt: a.audio_t0_ct + fromSec, toCt: a.audio_t0_ct + toSec };
    const found = segmentPhrases(j.events, { meta: j.meta, track, window, gapSec: Infinity, gapBeats: Infinity });
    if (!found.length) return { ok: false, error: `no played notes between ${fromSec}s and ${toSec}s of segment ${seg}` };
    phrase = found.slice().sort((x, y) => y.count - x.count)[0];
    audioReq = { seg, from_sec: fromSec, to_sec: toSec, name: `range-${seg}-${r3(fromSec)}-${r3(toSec)}` };
  } else return { ok: false, error: "clip needs phraseId, or fromSec and toSec (seconds into the jam audio; optional seg)" };
  const clip = clipFromPhrase(phrase, { quantize, rebase });
  const audio = audioReq ? await cutAudio(projectRoot, j.jid, audioReq, { ffmpeg }) : { ok: false, error: 'this phrase has no aligned audio window (no audio clock in the jam)' };
  return { ok: true, id: j.jid, phrase: slim(phrase), clip, audio };
}
