// Suno sources: pure readers and normalizers. No DOM, no network, no fs.
// Node imports this (the sidecar and the tests), and so does the browser.
//
// What a Suno download carries, and where (spikes/suno/003-local-evidence):
//   m4a  moov/udta/meta/ilst  ©cmt = "made with suno; created=<ISO>; id=<uuid>"
//                             ©lyr = the lyrics box as sent, metatags included
//        a tx3g (mov_text) subtitle track = line-level lyric timings
//   mp3  ID3v2 COMM / USLT / TIT2 / TXXX / WXXX (best effort; Suno mp3 exports
//        were not seen on this machine, and c2pa mp3s in Downloads are Google)
// Everything else (title, style, model, cover) comes from the song page or a
// library export, through normalizeClip().

export const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export const SOURCE_FIELDS = ['id', 'url', 'created', 'title', 'style', 'model', 'task', 'duration', 'cover', 'lyrics', 'sent', 'parent'];

export function sunoUrl(id) { return id ? `https://suno.com/song/${id}` : null; }

export function isSunoId(s) { return typeof s === 'string' && new RegExp(`^${UUID_RE.source}$`, 'i').test(s) && s !== ZERO_UUID; }

// Pull a Suno id out of whatever the user pasted: a bare uuid, a song URL,
// an embed URL, a cdn URL.
export function sunoIdFrom(text) {
  const m = String(text ?? '').match(UUID_RE);
  const id = m ? m[0].toLowerCase() : null;
  return id && id !== ZERO_UUID ? id : null;
}

// "made with suno; created=2026-09-22T21:54:12Z; id=efcdfc1f-..." -> {id, created}
export function parseSunoComment(s) {
  if (typeof s !== 'string' || !/suno/i.test(s)) return null;
  const id = (s.match(/\bid=([0-9a-f-]{36})/i) || [])[1]?.toLowerCase() ?? null;
  const created = (s.match(/\bcreated=([^;\s]+)/i) || [])[1] ?? null;
  if (!id && !created) return null;
  return { id: id && id !== ZERO_UUID ? id : null, created };
}

// ---------------------------------------------------------------------------
// MP4 / M4A atoms

const u8 = (buf) => (buf instanceof Uint8Array ? buf : new Uint8Array(buf.buffer ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) : buf));
const utf8 = (b) => new TextDecoder('utf-8').decode(b);
const fourcc = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

function dv(b) { return new DataView(b.buffer, b.byteOffset, b.byteLength); }

// Children of a box body [start, end). Handles 64-bit sizes and size 0 (to end).
function* boxes(b, start, end) {
  const view = dv(b);
  let o = start;
  while (o + 8 <= end) {
    let size = view.getUint32(o);
    const type = fourcc(b, o + 4);
    let hdr = 8;
    if (size === 1) { size = Number(view.getBigUint64(o + 8)); hdr = 16; }
    else if (size === 0) size = end - o;
    if (size < hdr || o + size > end) return;
    yield { type, start: o, body: o + hdr, end: o + size };
    o += size;
  }
}

const child = (b, box, type) => { for (const c of boxes(b, box.body, box.end)) if (c.type === type) return c; return null; };
const children = (b, box, type) => [...boxes(b, box.body, box.end)].filter(c => c.type === type);

function ilstText(b, item) {
  // item -> 'data' box: 4 bytes type/flags + 4 bytes locale, then payload
  const d = child(b, item, 'data');
  if (!d) return null;
  return utf8(b.subarray(d.body + 8, d.end));
}

// Parse the tx3g subtitle track into [{s, e, t}] (seconds), zero-length cues
// dropped. Walks trak/mdia/(mdhd, hdlr, minf/stbl/(stsd, stts, stsz, stsc, stco|co64)).
function readTx3g(b, trak) {
  const mdia = child(b, trak, 'mdia'); if (!mdia) return null;
  const hdlr = child(b, mdia, 'hdlr'); if (!hdlr) return null;
  const handler = fourcc(b, hdlr.body + 8);
  if (handler !== 'text' && handler !== 'sbtl') return null;
  const mdhd = child(b, mdia, 'mdhd'); if (!mdhd) return null;
  const view = dv(b);
  const ver = b[mdhd.body];
  const timescale = view.getUint32(mdhd.body + (ver === 1 ? 20 : 12));
  const stbl = child(b, child(b, mdia, 'minf') ?? { body: 0, end: 0 }, 'stbl'); if (!stbl) return null;
  const stsd = child(b, stbl, 'stsd');
  if (!stsd || fourcc(b, stsd.body + 12) !== 'tx3g') return null;
  const stts = child(b, stbl, 'stts'), stsz = child(b, stbl, 'stsz'), stsc = child(b, stbl, 'stsc');
  const stco = child(b, stbl, 'stco') || child(b, stbl, 'co64');
  if (!stts || !stsz || !stsc || !stco) return null;
  // durations
  const durs = [];
  for (let i = 0, n = view.getUint32(stts.body + 4); i < n; i++) {
    const cnt = view.getUint32(stts.body + 8 + i * 8), d = view.getUint32(stts.body + 12 + i * 8);
    for (let k = 0; k < cnt; k++) durs.push(d);
  }
  // sizes
  const fixed = view.getUint32(stsz.body + 4), count = view.getUint32(stsz.body + 8);
  const sizes = [];
  for (let i = 0; i < count; i++) sizes.push(fixed || view.getUint32(stsz.body + 12 + i * 4));
  // chunk offsets
  const co64 = stco.type === 'co64';
  const nChunks = view.getUint32(stco.body + 4);
  const chunkOff = [];
  for (let i = 0; i < nChunks; i++) chunkOff.push(co64 ? Number(view.getBigUint64(stco.body + 8 + i * 8)) : view.getUint32(stco.body + 8 + i * 4));
  // sample -> chunk
  const runs = [];
  for (let i = 0, n = view.getUint32(stsc.body + 4); i < n; i++) {
    runs.push({ first: view.getUint32(stsc.body + 8 + i * 12), per: view.getUint32(stsc.body + 12 + i * 12) });
  }
  const offsets = [];
  let s = 0;
  for (let c = 0; c < nChunks && s < count; c++) {
    let per = 0;
    for (const r of runs) if (r.first <= c + 1) per = r.per;
    let o = chunkOff[c];
    for (let k = 0; k < per && s < count; k++, s++) { offsets.push(o); o += sizes[s]; }
  }
  const lines = [];
  let t = 0;
  for (let i = 0; i < count; i++) {
    const d = durs[i] ?? 0, o = offsets[i];
    if (o != null && sizes[i] >= 2 && o + sizes[i] <= b.length) {
      const len = view.getUint16(o);
      const text = len ? utf8(b.subarray(o + 2, Math.min(o + 2 + len, o + sizes[i]))).trim() : '';
      // metatag lines ([Verse], [Intro ...]) ride on ~zero-length cues: drop them
      if (text && d / timescale >= 0.05) lines.push({ s: +(t / timescale).toFixed(3), e: +((t + d) / timescale).toFixed(3), t: text });
    }
    t += d;
  }
  return lines;
}

// Read the tags a Suno m4a carries. Returns
// {title, comment, lyrics, suno:{id, created}|null, lines:[{s,e,t}]|null, duration}
// or null when the bytes aren't an MP4 at all. Only the moov box is walked,
// plus the tx3g sample bytes it points at, so a 5 MB file costs a few KB of reads.
export function readMp4Tags(buf) {
  const b = u8(buf);
  if (b.length < 12 || fourcc(b, 4) !== 'ftyp') return null;
  let moov = null;
  for (const box of boxes(b, 0, b.length)) if (box.type === 'moov') { moov = box; break; }
  if (!moov) return { title: null, comment: null, lyrics: null, suno: null, lines: null, duration: null };
  const out = { title: null, comment: null, lyrics: null, suno: null, lines: null, duration: null };
  const mvhd = child(b, moov, 'mvhd');
  if (mvhd) {
    const view = dv(b), v1 = b[mvhd.body] === 1;
    const ts = view.getUint32(mvhd.body + (v1 ? 20 : 12));
    const dur = v1 ? Number(view.getBigUint64(mvhd.body + 24)) : view.getUint32(mvhd.body + 16);
    if (ts) out.duration = +(dur / ts).toFixed(3);
  }
  const udta = child(b, moov, 'udta');
  const meta = udta && child(b, udta, 'meta');
  if (meta) {
    // meta is a full box (4 bytes version/flags) in QuickTime-from-ffmpeg files;
    // detect by whether the next 4 bytes look like a box header.
    const shifted = { ...meta, body: meta.body + (fourcc(b, meta.body + 8) === 'hdlr' ? 4 : 0) };
    const ilst = child(b, shifted, 'ilst') || child(b, meta, 'ilst');
    if (ilst) {
      for (const item of boxes(b, ilst.body, ilst.end)) {
        const name = item.type.replace('\u00a9', '©');
        if (name === '©nam') out.title = ilstText(b, item);
        else if (name === '©cmt') out.comment = ilstText(b, item);
        else if (name === '©lyr') out.lyrics = ilstText(b, item);
      }
    }
  }
  for (const trak of children(b, moov, 'trak')) {
    try { const lines = readTx3g(b, trak); if (lines) { out.lines = lines; break; } } catch { /* malformed: leave null */ }
  }
  out.suno = parseSunoComment(out.comment);
  return out;
}

// ---------------------------------------------------------------------------
// ID3v2 (mp3). Best effort: v2.3/v2.4 text frames, COMM, USLT, TXXX, WXXX.

function id3Text(enc, bytes) {
  if (enc === 1 || enc === 2) {
    let le = enc === 1 ? true : false, i = 0;
    if (bytes[0] === 0xff && bytes[1] === 0xfe) { le = true; i = 2; } else if (bytes[0] === 0xfe && bytes[1] === 0xff) { le = false; i = 2; }
    let s = '';
    for (; i + 1 < bytes.length; i += 2) {
      const c = le ? bytes[i] | (bytes[i + 1] << 8) : (bytes[i] << 8) | bytes[i + 1];
      if (!c) break;
      s += String.fromCharCode(c);
    }
    return s;
  }
  const end = bytes.indexOf(0);
  const slice = end >= 0 ? bytes.subarray(0, end) : bytes;
  return enc === 3 ? utf8(slice) : String.fromCharCode(...slice);
}

// split "desc\0value" respecting the encoding's terminator width
function id3Split(enc, bytes) {
  const wide = enc === 1 || enc === 2;
  let i = 0;
  if (wide) { while (i + 1 < bytes.length && (bytes[i] || bytes[i + 1])) i += 2; return [bytes.subarray(0, i), bytes.subarray(i + 2)]; }
  while (i < bytes.length && bytes[i]) i++;
  return [bytes.subarray(0, i), bytes.subarray(i + 1)];
}

export function readId3Tags(buf) {
  const b = u8(buf);
  if (b.length < 10 || b[0] !== 0x49 || b[1] !== 0x44 || b[2] !== 0x33) return null;
  const ver = b[3];
  const size = (b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9];
  const out = { title: null, comment: null, lyrics: null, txxx: {}, urls: [], suno: null };
  let o = 10;
  if (b[5] & 0x40) { const ext = ver === 4 ? ((b[10] << 21) | (b[11] << 14) | (b[12] << 7) | b[13]) : ((b[10] << 24) | (b[11] << 16) | (b[12] << 8) | b[13]) + 4; o += ext; }
  const end = Math.min(b.length, 10 + size);
  while (o + 10 <= end) {
    const id = fourcc(b, o);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const fs = ver === 4 ? ((b[o + 4] << 21) | (b[o + 5] << 14) | (b[o + 6] << 7) | b[o + 7]) : ((b[o + 4] << 24) | (b[o + 5] << 16) | (b[o + 6] << 8) | b[o + 7]) >>> 0;
    const body = b.subarray(o + 10, Math.min(end, o + 10 + fs));
    o += 10 + fs;
    if (!body.length) continue;
    const enc = body[0];
    if (id === 'TIT2') out.title = id3Text(enc, body.subarray(1));
    else if (id === 'COMM' || id === 'USLT') {
      const [, val] = id3Split(enc, body.subarray(4)); // skip enc + 3-byte language
      const text = id3Text(enc, val);
      if (id === 'COMM') out.comment = out.comment ?? text; else out.lyrics = text;
    } else if (id === 'TXXX') {
      const [d, v] = id3Split(enc, body.subarray(1));
      out.txxx[id3Text(enc, d)] = id3Text(enc, v);
    } else if (id === 'WXXX') {
      const [, v] = id3Split(enc, body.subarray(1));
      out.urls.push(id3Text(0, v));
    }
  }
  out.suno = parseSunoComment(out.comment)
    || Object.values(out.txxx).map(parseSunoComment).find(Boolean)
    || (out.urls.map(sunoIdFrom).find(Boolean) ? { id: out.urls.map(sunoIdFrom).find(Boolean), created: null } : null);
  return out;
}

// Either container. Returns {format:'mp4'|'mp3', ...tags} or null.
export function readAudioTags(buf) {
  const b = u8(buf);
  const mp4 = readMp4Tags(b);
  if (mp4) return { format: 'mp4', ...mp4 };
  const id3 = readId3Tags(b);
  if (id3) return { format: 'mp3', ...id3 };
  return null;
}

// Tags -> a partial source block (fields we could read, provenance 'file').
export function sourceFromTags(tags) {
  if (!tags?.suno?.id) return null;
  const src = emptySunoSource(tags.suno.id);
  src.created = tags.suno.created ?? null;
  if (tags.title) src.title = tags.title;
  if (tags.lyrics) src.lyrics = { text: tags.lyrics, from: 'file' };
  if (tags.duration) src.duration = tags.duration;
  for (const f of ['id', 'url', 'created', 'title', 'lyrics', 'duration']) if (src[f] != null) src.provenance[f] = 'file';
  return src;
}

// ---------------------------------------------------------------------------
// Source blocks

export function emptySunoSource(id) {
  return {
    kind: 'suno', id: id ?? null, url: sunoUrl(id), created: null, title: null, style: null, model: null,
    task: null, duration: null, cover: null, lyrics: null, sent: null, parent: null,
    provenance: {}, fetched: null, raw: null,
  };
}

const nz = (v) => (v == null || v === '' || v === ZERO_UUID ? null : v);

// A raw Suno clip object (page payload, library export, a paste) -> source
// fields. Shape: spikes/suno/001-unofficial-clients/clip.schema.json. Keeps
// the verbatim object in `raw` because the shape drifts monthly.
export function normalizeClip(raw, from = 'library') {
  if (!raw || typeof raw !== 'object') throw new Error('normalizeClip needs a Suno clip object.');
  const md = raw.metadata ?? {};
  const id = sunoIdFrom(raw.id);
  if (!id) throw new Error(`Suno clip has no usable id (${raw.id}).`);
  const src = emptySunoSource(id);
  src.title = nz(raw.title);
  src.created = nz(raw.created_at);
  src.style = nz(md.tags);
  src.model = nz([raw.major_model_version, raw.model_name].filter(Boolean).join(' ') || null);
  src.task = nz(md.task) ?? (md.type && md.type !== 'gen' ? md.type : null);
  src.duration = typeof md.duration === 'number' ? md.duration : null;
  src.cover = nz(raw.image_large_url) ?? nz(raw.image_url);
  src.lyrics = nz(md.prompt) ? { text: md.prompt, from } : null;
  const parent = nz(md.cover_clip_id) ?? nz(md.edited_clip_id) ?? nz(md.extend_clip_id ?? null) ?? nz(md.history?.[0]?.id ?? null);
  src.parent = parent ? { id: parent, from: 'suno' } : null;
  for (const f of SOURCE_FIELDS) if (src[f] != null) src.provenance[f] = from;
  src.raw = raw;
  return src;
}

// Merge `incoming` into `base` (both source blocks). A field from incoming wins
// only if it's non-null; provenance is recorded per field that changed.
// Idempotent: merging the same thing twice leaves the result equal.
export function mergeSource(base, incoming) {
  if (!base) return incoming ? structuredCloneish(incoming) : null;
  if (!incoming) return base;
  if (base.kind !== incoming.kind || (base.id && incoming.id && base.id !== incoming.id)) {
    throw new Error(`Can't merge source ${incoming.kind}:${incoming.id} into ${base.kind}:${base.id}.`);
  }
  const out = { ...base, provenance: { ...(base.provenance ?? {}) } };
  for (const f of SOURCE_FIELDS) {
    const v = incoming[f];
    if (v == null) continue;
    // What the user typed and what the file itself says outrank a page or
    // library read: those only fill gaps or replace their own kind.
    if (base[f] != null && trust(base.provenance?.[f]) > trust(incoming.provenance?.[f])) continue;
    out[f] = v;
    if (incoming.provenance?.[f]) out.provenance[f] = incoming.provenance[f];
  }
  if (!out.url && out.id) out.url = sunoUrl(out.id);
  if (incoming.raw != null) out.raw = incoming.raw;
  if (incoming.fetched != null) out.fetched = incoming.fetched;
  return out;
}

// Provenance rank for mergeSource. Equal rank: the newer value wins.
const TRUST = { user: 4, file: 3, page: 2, library: 2, 'sent-guess': 1 };
export function trust(p) { return TRUST[p] ?? 2; }

function structuredCloneish(o) { return JSON.parse(JSON.stringify(o)); }

// Validate a source block handed in from outside (catalog 'asset source set').
export function cleanSource(src) {
  if (src == null) return null;
  if (typeof src !== 'object') throw new Error("source must be an object {kind:'suno'|'derived', ...} or null.");
  if (src.kind === 'derived') {
    if (!src.from) throw new Error("derived source needs 'from' (the asset id it came from).");
    return { kind: 'derived', from: String(src.from), by: src.by ? String(src.by) : null, ...(src.note ? { note: String(src.note) } : {}) };
  }
  if (src.kind === 'suno') {
    const id = sunoIdFrom(src.id ?? src.url);
    if (!id) throw new Error('suno source needs a Suno song id or url.');
    const out = mergeSource(emptySunoSource(id), { ...src, id, url: sunoUrl(id), provenance: src.provenance ?? {} });
    out.provenance = { ...(src.provenance ?? {}) };
    return out;
  }
  throw new Error(`Unknown source kind '${src.kind}'. Use 'suno' or 'derived'.`);
}

// ---------------------------------------------------------------------------
// Public song page -> clip object. The page is a Next.js RSC flight payload:
// self.__next_f.push([1,"<js string>"]) chunks. Decode each chunk, then find
// the object carrying "entity_type":"song_schema" for our id.

export function extractClipFromPage(html, id = null) {
  const chunks = [];
  const re = /self\.__next_f\.push\(\[\d+,\s*("(?:[^"\\]|\\.)*")\]\)/g;
  let m;
  while ((m = re.exec(html))) { try { chunks.push(JSON.parse(m[1])); } catch { /* skip */ } }
  const flight = chunks.join('');
  const texts = flightTextRows(flight);
  const needle = '"entity_type":"song_schema"';
  let at = flight.indexOf(needle);
  while (at >= 0) {
    const obj = enclosingObject(flight, at);
    if (obj && (!id || obj.id === id) && obj.metadata) return resolveRefs(obj, texts);
    at = flight.indexOf(needle, at + needle.length);
  }
  return null;
}

// Long strings (lyrics, often) are hoisted out of the object into their own
// flight row, "<hex id>:T<hex byte length>,<text>", and the object holds
// "$<hex id>" in their place. Collect those rows so we can put them back.
export function flightTextRows(flight) {
  const out = new Map();
  const re = /(?:^|\n|[\]}"])([0-9a-f]{1,6}):T([0-9a-f]{1,8}),/g;
  const enc = new TextEncoder(), dec = new TextDecoder();
  let m;
  while ((m = re.exec(flight))) {
    const start = m.index + m[0].length, bytes = parseInt(m[2], 16);
    // length is in UTF-8 bytes; walk the string until we've covered them
    const bytesOf = enc.encode(flight.slice(start, start + bytes));
    const text = bytesOf.length <= bytes ? flight.slice(start, start + bytes) : dec.decode(bytesOf.subarray(0, bytes)).replace(/\uFFFD$/, '');
    out.set(m[1], text);
  }
  return out;
}

function resolveRefs(v, texts) {
  if (typeof v === 'string') {
    const m = v.match(/^\$([0-9a-f]{1,6})$/);
    if (!m) return v;
    return texts.has(m[1]) ? texts.get(m[1]) : null; // unresolved ref: unknown, not "$50"
  }
  if (Array.isArray(v)) return v.map(x => resolveRefs(x, texts));
  if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = resolveRefs(x, texts); return o; }
  return v;
}

// Balanced-brace scan outward from index `at` to the smallest object that
// parses and contains it.
function enclosingObject(s, at) {
  let depth = 0;
  for (let i = at; i >= 0; i--) {
    const c = s[i];
    if (c === '}') depth++;
    else if (c === '{') {
      if (depth === 0) {
        const end = matchBrace(s, i);
        if (end < 0) return null;
        try { const o = JSON.parse(s.slice(i, end + 1)); if (o && o.entity_type === 'song_schema') return o; } catch { /* keep walking */ }
      } else depth--;
    }
  }
  return null;
}

function matchBrace(s, i) {
  let depth = 0, inStr = false;
  for (let k = i; k < s.length; k++) {
    const c = s[k];
    if (inStr) { if (c === '\\') k++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (!depth) return k; }
  }
  return -1;
}

// OG fallback: title + cover only.
export function ogFromPage(html) {
  const get = (p) => (html.match(new RegExp(`<meta[^>]+property="${p}"[^>]+content="([^"]*)"`, 'i')) || [])[1] ?? null;
  const dec = (s) => s && s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  const title = dec(get('og:title')), image = dec(get('og:image'));
  return title || image ? { title, image } : null;
}
