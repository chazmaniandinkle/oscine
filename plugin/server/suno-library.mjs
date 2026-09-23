// Suno library index + file ingest for the sidecar (node only: fs, crypto,
// ffprobe). Metadata only: no audio is ever fetched from Suno, and scanned
// files are only read, never moved or modified.
//
//   <projectRoot>/.oscine/suno-library.json =
//     {version:1, updated, songs:{<id>: {...source, seenIn:[paths], localFiles:[{path, sha256, variantKind}]}}}
//
// Merges are idempotent: a field only changes when the incoming value is
// non-null, and each field remembers where it came from (provenance).

import { readFile, writeFile, mkdir, readdir, stat, copyFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { join, resolve, dirname, extname, basename, relative } from 'node:path';
import { readAudioTags, sourceFromTags, normalizeClip, mergeSource, extractClipFromPage, ogFromPage, sunoIdFrom, emptySunoSource } from '../app/src/core/suno.js';

export const LIB_VERSION = 1;
const AUDIO_EXT = new Set(['.m4a', '.mp3', '.wav', '.mp4', '.aac', '.flac', '.ogg', '.opus']);
const SCAN_EXT = new Set(['.m4a', '.mp3', '.wav']);
const SKIP_DIRS = new Set(['node_modules', '.git', '.cog', '.venv', 'venv', 'tmp', '__pycache__', '.oscine', 'plugin', 'Library', '.Trash']);

export function libraryPath(root) { return join(root, '.oscine', 'suno-library.json'); }

export async function loadLibrary(root) {
  try {
    const lib = JSON.parse(await readFile(libraryPath(root), 'utf8'));
    if (lib?.version === LIB_VERSION && lib.songs) return lib;
  } catch { /* first run */ }
  return { version: LIB_VERSION, updated: null, songs: {} };
}

export async function saveLibrary(root, lib) {
  lib.updated = new Date().toISOString();
  const p = libraryPath(root);
  await mkdir(dirname(p), { recursive: true });
  const tmp = p + '.tmp';
  await writeFile(tmp, JSON.stringify(lib, null, 1) + '\n', 'utf8');
  await rename(tmp, p);
  return p;
}

// Fold one source block (+ where it was seen, + a local file) into the library.
export function mergeSong(lib, source, { seenIn = null, localFile = null } = {}) {
  if (!source?.id) return null;
  const prev = lib.songs[source.id];
  const { seenIn: s0 = [], localFiles: l0 = [], ...prevSrc } = prev ?? {};
  const merged = mergeSource(prev ? prevSrc : null, source);
  const seen = [...s0];
  if (seenIn && !seen.includes(seenIn)) seen.push(seenIn);
  const files = [...l0];
  if (localFile && !files.some(f => f.path === localFile.path && f.sha256 === localFile.sha256)) {
    const i = files.findIndex(f => f.path === localFile.path);
    if (i >= 0) files[i] = localFile; else files.push(localFile);
  }
  lib.songs[source.id] = { ...merged, seenIn: seen, localFiles: files };
  return lib.songs[source.id];
}

export function summarizeLibrary(lib, { id = null, full = false } = {}) {
  const row = (s) => full ? s : {
    id: s.id, title: s.title, style: s.style ? (s.style.length > 160 ? s.style.slice(0, 160) + ' ...' : s.style) : null,
    model: s.model, task: s.task, created: s.created, duration: s.duration, cover: s.cover, url: s.url,
    lyrics: s.lyrics ? { from: s.lyrics.from, chars: s.lyrics.text?.length ?? 0 } : null,
    fetched: s.fetched, localFiles: s.localFiles, seenIn: s.seenIn,
  };
  if (id) {
    const s = lib.songs[id];
    if (!s) throw new Error(`No Suno song ${id} in the library. Run suno scan, import, or fetch first.`);
    return row(s);
  }
  const songs = Object.values(lib.songs).sort((a, b) => String(b.created ?? '').localeCompare(String(a.created ?? '')));
  return { updated: lib.updated, count: songs.length, songs: songs.map(row) };
}

async function sha256File(path) {
  const h = createHash('sha256');
  h.update(await readFile(path));
  return h.digest('hex');
}

// ffprobe for codec / sample rate / channels / duration. Optional: if
// ffprobe is missing the variant just carries fewer fields.
export function probe(path) {
  return new Promise((res) => {
    let out = '';
    let p;
    try { p = spawn('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name,sample_rate,channels:format=duration', '-of', 'json', path]); }
    catch { res({}); return; }
    p.stdout.on('data', d => { out += d; });
    p.on('error', () => res({}));
    p.on('close', () => {
      try {
        const j = JSON.parse(out), s = j.streams?.[0] ?? {};
        res({ codec: s.codec_name ?? null, sampleRate: s.sample_rate ? Number(s.sample_rate) : null, channels: s.channels ?? null, duration: j.format?.duration ? Number(Number(j.format.duration).toFixed(3)) : null });
      } catch { res({}); }
    });
  });
}

// Walk dirs for audio files, read Suno tags, record them. Read-only.
export async function scanLocal(root, dirs = [], { maxDepth = 8, maxFiles = 20000 } = {}) {
  const lib = await loadLibrary(root);
  const roots = [root, ...dirs].map(d => resolve(d));
  const found = [];
  let visited = 0, audio = 0;
  const seenPaths = new Set();
  async function walk(dir, depth) {
    if (depth > maxDepth || visited > maxFiles) return;
    let names;
    try { names = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const d of names) {
      if (visited > maxFiles) return;
      const full = join(dir, d.name);
      if (d.isDirectory()) {
        if (SKIP_DIRS.has(d.name) || d.name.startsWith('.')) continue;
        await walk(full, depth + 1);
      } else if (d.isFile()) {
        visited++;
        const ext = extname(d.name).toLowerCase();
        if (!SCAN_EXT.has(ext) || seenPaths.has(full)) continue;
        seenPaths.add(full);
        audio++;
        if (ext === '.wav') continue; // no Suno tags in wav; kept for the count
        let buf;
        try { buf = await readFile(full); } catch { continue; }
        const tags = readAudioTags(buf);
        const src = sourceFromTags(tags);
        if (!src) continue;
        const sha256 = createHash('sha256').update(buf).digest('hex');
        mergeSong(lib, src, { localFile: { path: full, sha256, variantKind: 'suno-download', ext: ext.slice(1) } });
        found.push({ id: src.id, path: full });
      }
    }
  }
  for (const r of roots) await walk(r, 0);
  await saveLibrary(root, lib);
  const ids = [...new Set(found.map(f => f.id))];
  return { ok: true, dirs: roots, filesVisited: visited, audioFiles: audio, sunoFiles: found.length, ids, count: ids.length, library: libraryPath(root) };
}

// Merge raw clip objects from any collector: an array, {clips:[...]}, or one clip.
export async function importClips(root, json, { from = 'library', seenIn = null } = {}) {
  let data = json;
  if (typeof data === 'string') data = JSON.parse(data);
  const clips = Array.isArray(data) ? data : Array.isArray(data?.clips) ? data.clips : data?.id ? [data] : null;
  if (!clips) throw new Error('import needs an array of Suno clip objects, or {clips:[...]}.');
  const lib = await loadLibrary(root);
  const ids = [], errors = [];
  for (const raw of clips) {
    try { const s = normalizeClip(raw, from); mergeSong(lib, s, { seenIn }); ids.push(s.id); }
    catch (e) { errors.push(String(e.message)); }
  }
  await saveLibrary(root, lib);
  return { ok: true, imported: ids.length, ids, errors, count: Object.keys(lib.songs).length };
}

// ---------------------------------------------------------------------------
// One public page fetch. Explicit only, cached in the library (`fetched`),
// 1 request per 2 s, bulk only with {all:true, max<=25}.

let lastFetchAt = 0;
export const FETCH_GAP_MS = 2000;
export const FETCH_MAX = 25;

async function politeFetch(url, fetcher) {
  const wait = lastFetchAt + FETCH_GAP_MS - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastFetchAt = Date.now();
  return fetcher(url, { headers: { 'User-Agent': 'Oscine/2.2 (one song page, user-requested)', Accept: 'text/html' } });
}

export async function fetchPublic(root, { id = null, all = false, max = 5, force = false } = {}, fetcher = globalThis.fetch) {
  const lib = await loadLibrary(root);
  let ids;
  if (all) {
    const n = Math.min(FETCH_MAX, Math.max(1, Number(max) || 1));
    ids = Object.values(lib.songs).filter(s => force || !s.fetched).map(s => s.id).slice(0, n);
  } else {
    const one = sunoIdFrom(id);
    if (!one) throw new Error("suno fetch needs 'id' (a song id or url), or {all:true, max:N} (N <= 25).");
    ids = [one];
  }
  const results = [];
  for (const sid of ids) {
    const cached = lib.songs[sid];
    if (cached?.fetched && !force) { results.push({ id: sid, cached: true, title: cached.title }); continue; }
    try {
      const res = await politeFetch(`https://suno.com/song/${sid}`, fetcher);
      if (!res.ok) { results.push({ id: sid, error: `HTTP ${res.status}` }); continue; }
      const html = await res.text();
      const clip = extractClipFromPage(html, sid);
      let src;
      if (clip) src = normalizeClip(clip, 'page');
      else {
        const og = ogFromPage(html);
        if (!og) { results.push({ id: sid, error: 'no clip data and no OG tags (private or removed?)' }); continue; }
        src = emptySunoSource(sid);
        src.title = og.title; src.cover = og.image;
        for (const f of ['title', 'cover']) if (src[f]) src.provenance[f] = 'page';
      }
      src.fetched = new Date().toISOString();
      mergeSong(lib, src, { seenIn: `https://suno.com/song/${sid}` });
      results.push({ id: sid, title: src.title, via: clip ? 'flight' : 'og' });
    } catch (e) { results.push({ id: sid, error: String(e.message || e) }); }
  }
  await saveLibrary(root, lib);
  return { ok: true, requested: ids.length, results };
}

// ---------------------------------------------------------------------------
// Ingest a file into <projectDir>/assets/<sha256>.<ext>. The source file is
// copied, never moved. Returns variant fields + any Suno source from its tags,
// and records the file in the library.

export async function ingestFile(root, projectDir, { path = null, bytes = null, filename = null } = {}) {
  const dir = resolve(root, projectDir || '.');
  if (dir !== root && !dir.startsWith(root + '/')) throw new Error('project dir escapes the project root');
  let buf, srcPath = null;
  if (path) {
    srcPath = resolve(root, path);
    if (srcPath !== root && !srcPath.startsWith(root + '/')) throw new Error(`path escapes the project root (${root}). Drop the file on the inspector instead, or copy it under the root.`);
    buf = await readFile(srcPath);
    filename ??= basename(srcPath);
  } else if (bytes) buf = Buffer.from(bytes);
  else throw new Error("ingest needs 'path' (under the project root) or file bytes.");
  const ext = (extname(filename || '').slice(1) || 'wav').toLowerCase();
  if (!AUDIO_EXT.has('.' + ext)) throw new Error(`Not an audio file: .${ext}`);
  const sha256 = createHash('sha256').update(buf).digest('hex');
  const assetsDir = join(dir, 'assets');
  await mkdir(assetsDir, { recursive: true });
  const dest = join(assetsDir, `${sha256}.${ext}`);
  let copied = false;
  try { await stat(dest); } catch {
    if (srcPath) await copyFile(srcPath, dest); else await writeFile(dest, buf);
    copied = true;
  }
  const meta = await probe(dest);
  const tags = readAudioTags(buf);
  const source = sourceFromTags(tags);
  if (source) {
    const lib = await loadLibrary(root);
    mergeSong(lib, source, { localFile: { path: srcPath ?? dest, sha256, variantKind: 'suno-download', ext } });
    await saveLibrary(root, lib);
  }
  return {
    ok: true, sha256, ext, filename, copied, stored: relative(root, dest),
    ...meta, source, lines: tags?.lines ?? null,
  };
}
