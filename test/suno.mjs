// Suno source readers: ©cmt/©lyr/tx3g from m4a, ID3 from mp3, clip
// normalization, page extraction, merge. Real files are read-only and
// optional (CI won't have them); a synthetic m4a built here covers the
// parser everywhere.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parseSunoComment, readMp4Tags, readId3Tags, readAudioTags, normalizeClip, mergeSource,
  extractClipFromPage, ogFromPage, sourceFromTags, sunoIdFrom, cleanSource, ZERO_UUID,
} from '../src/core/suno.js';

let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? '  ok  ' : 'FAIL  ') + n + (d ? `  (${d})` : '')); if (!ok) fails++; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const skip = (n) => console.log('  --  ' + n + '  (skipped: file absent)');

// -- comment ---------------------------------------------------------------
const c = parseSunoComment('made with suno; created=2026-09-22T21:54:12Z; id=efcdfc1f-9c2d-4422-b1b5-f926811563fa');
check('parseSunoComment id + created', c?.id === 'efcdfc1f-9c2d-4422-b1b5-f926811563fa' && c.created === '2026-09-22T21:54:12Z');
check('parseSunoComment ignores non-suno text', parseSunoComment('Oscine render. A minor') === null);
check('parseSunoComment zero uuid -> null id', parseSunoComment(`made with suno; id=${ZERO_UUID}`).id === null);
check('sunoIdFrom a song URL', sunoIdFrom('https://suno.com/song/39802A94-8c2f-49b7-bb77-79bfe022b18d?sh=x') === '39802a94-8c2f-49b7-bb77-79bfe022b18d');

// -- synthetic m4a ------------------------------------------------------------
const enc = new TextEncoder();
const cat = (...parts) => { const n = parts.reduce((s, p) => s + p.length, 0), o = new Uint8Array(n); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o; };
const u32 = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v); return b; };
const u16 = (v) => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v); return b; };
const latin1 = (t) => Uint8Array.from(t, ch => ch.charCodeAt(0));
const box = (type, ...body) => { const b = cat(...body); return cat(u32(b.length + 8), latin1(type), b); };
const full = (type, vf, ...body) => box(type, u32(vf), ...body);
const ilstItem = (name, text) => box(name, box('data', u32(1), u32(0), enc.encode(text)));
const zeros = (n) => new Uint8Array(n);

function buildM4a({ comment, lyrics, title, cues }) {
  // mdat carries the tx3g samples; build moov after we know their offsets.
  const samples = cues.map(q => { const t = enc.encode(q.t); return cat(u16(t.length), t); });
  const ftyp = box('ftyp', enc.encode('M4A '), u32(512), enc.encode('isomM4A '));
  const mdatBody = cat(...samples);
  const mdat = box('mdat', mdatBody);
  const mdatDataStart = ftyp.length + 8;
  const ts = 1000;
  const mvhd = full('mvhd', 0, u32(0), u32(0), u32(ts), u32(5000), zeros(80));
  const mdhd = full('mdhd', 0, u32(0), u32(0), u32(ts), u32(5000), zeros(4));
  const hdlr = full('hdlr', 0, u32(0), enc.encode('text'), zeros(12), zeros(1));
  const stsd = full('stsd', 0, u32(1), box('tx3g', zeros(8)));
  const stts = full('stts', 0, u32(cues.length), ...cues.flatMap(q => [u32(1), u32(Math.round((q.e - q.s) * ts))]));
  const stsz = full('stsz', 0, u32(0), u32(samples.length), ...samples.map(s => u32(s.length)));
  const stsc = full('stsc', 0, u32(1), u32(1), u32(samples.length), u32(1));
  const stco = full('stco', 0, u32(1), u32(mdatDataStart));
  const trak = box('trak', box('mdia', mdhd, hdlr, box('minf', box('stbl', stsd, stts, stsz, stsc, stco))));
  const items = [comment && ilstItem('\u00a9cmt', comment), lyrics && ilstItem('\u00a9lyr', lyrics), title && ilstItem('\u00a9nam', title)].filter(Boolean);
  const meta = full('meta', 0, full('hdlr', 0, u32(0), enc.encode('mdir'), zeros(12), zeros(1)), box('ilst', ...items));
  const moov = box('moov', mvhd, trak, box('udta', meta));
  return cat(ftyp, mdat, moov);
}

const synthId = '11111111-2222-4333-8444-555555555555';
const synth = buildM4a({
  comment: `made with suno; created=2026-09-23T10:00:00Z; id=${synthId}`,
  lyrics: '[Verse]\nWe are home.\nNot a thing',
  title: 'Synthetic',
  cues: [{ s: 0, e: 0, t: '[Verse]' }, { s: 0, e: 1.5, t: 'We are home.' }, { s: 1.5, e: 3, t: 'Not a thing' }],
});
const st = readMp4Tags(synth);
check('synthetic m4a: suno id from ©cmt', st?.suno?.id === synthId && st.suno.created === '2026-09-23T10:00:00Z');
check('synthetic m4a: ©lyr + ©nam', st.lyrics.startsWith('[Verse]') && st.title === 'Synthetic');
check('synthetic m4a: mvhd duration', st.duration === 5);
check('synthetic m4a: tx3g lines, metatag cue dropped', same(st.lines, [{ s: 0, e: 1.5, t: 'We are home.' }, { s: 1.5, e: 3, t: 'Not a thing' }]), JSON.stringify(st.lines));
check('readAudioTags routes mp4', readAudioTags(synth)?.format === 'mp4');
const fromTags = sourceFromTags(st);
check('sourceFromTags: id/url/lyrics with provenance file', fromTags.url === `https://suno.com/song/${synthId}` && fromTags.lyrics.from === 'file' && fromTags.provenance.id === 'file' && fromTags.provenance.lyrics === 'file');
check('non-mp4 bytes -> null', readMp4Tags(enc.encode('RIFF....WAVEfmt ')) === null);

// -- synthetic ID3 -------------------------------------------------------------
function id3frame(id, body) { return cat(enc.encode(id), u32(body.length), u16(0), body); }
const comm = cat(new Uint8Array([3]), enc.encode('eng'), new Uint8Array([0]), enc.encode(`made with suno; created=2026-01-01T00:00:00Z; id=${synthId}`));
const tit2 = cat(new Uint8Array([3]), enc.encode('Id3 Song'));
const uslt = cat(new Uint8Array([3]), enc.encode('eng'), new Uint8Array([0]), enc.encode('la la'));
const frames = cat(id3frame('TIT2', tit2), id3frame('COMM', comm), id3frame('USLT', uslt));
const sz = frames.length;
const id3 = cat(enc.encode('ID3'), new Uint8Array([3, 0, 0, (sz >> 21) & 127, (sz >> 14) & 127, (sz >> 7) & 127, sz & 127]), frames, zeros(16));
const it = readId3Tags(id3);
check('ID3: TIT2/COMM/USLT + suno id', it?.title === 'Id3 Song' && it.lyrics === 'la la' && it.suno?.id === synthId);
check('readAudioTags routes mp3', readAudioTags(id3)?.format === 'mp3');

// -- real renders (read-only, optional) ---------------------------------------
const R = '/Users/slowbro/workspaces/cog/projects/songs/2026-09-19-housekeeping-heat/renders/borrowed-light/';
for (const [f, id, created] of [['render1-v13.m4a', 'efcdfc1f-9c2d-4422-b1b5-f926811563fa', '2026-09-22T21:54:12Z'], ['render2-v14.m4a', '39802a94-8c2f-49b7-bb77-79bfe022b18d', '2026-09-22T23:31:44Z']]) {
  if (!existsSync(R + f)) { skip(f); continue; }
  const t = readMp4Tags(readFileSync(R + f));
  check(`${f}: id ${id.slice(0, 8)}`, t.suno?.id === id && t.suno.created === created, JSON.stringify(t.suno));
  check(`${f}: ©lyr present, duration ~228-232s`, t.lyrics?.length > 2000 && t.duration > 220 && t.duration < 240, `${t.lyrics?.length} ch, ${t.duration}s`);
  check(`${f}: tx3g line timings, 'We are home.' first`, t.lines?.length > 20 && t.lines[0].t === 'We are home.', `${t.lines?.length} lines`);
}

// -- clip objects (evidence) -----------------------------------------------------
const here = dirname(fileURLToPath(import.meta.url));
const EV = join(here, '../spikes/suno/002-public-surface/evidence/');
const alt = '/Users/slowbro/workspaces/oscine/spikes/suno/002-public-surface/evidence/';
const ev = existsSync(EV) ? EV : alt;
const porchId = '538ab4ae-3ace-4abf-95f9-be0bed53b65d', onesId = '9f5adfa3-865d-482f-9ce6-38f5cc05a8ae';
if (existsSync(ev + `song_${porchId}.clip.json`)) {
  const raw = JSON.parse(readFileSync(ev + `song_${porchId}.clip.json`, 'utf8'));
  const n = normalizeClip(raw, 'page');
  check('normalizeClip: title/model/task/duration', n.title === 'Porch Light On' && n.model === 'v6 chirp-hawk' && n.task === 'cover' && n.duration === 213.96);
  check('normalizeClip: style + lyrics + cover', n.style.startsWith('slow atmospheric') && n.lyrics.text.startsWith('[Verse 1]') && n.lyrics.from === 'page' && n.cover.includes('cdn2.suno.ai'));
  check('normalizeClip: zero-uuid parent -> null', n.parent === null);
  check('normalizeClip: keeps raw + provenance', n.raw === raw && n.provenance.style === 'page' && n.provenance.id === 'page');
  const html = readFileSync(ev + `song_${porchId}.html`, 'utf8');
  const fromPage = extractClipFromPage(html, porchId);
  check('extractClipFromPage finds the clip in the flight payload', fromPage?.id === porchId && fromPage.metadata?.tags === raw.metadata.tags);
  check('ogFromPage title + image', ogFromPage(html)?.title === 'Porch Light On');
  const raw2 = JSON.parse(readFileSync(ev + `song_${onesId}.clip.json`, 'utf8'));
  const n2 = normalizeClip(raw2);
  check('normalizeClip: second clip (agentic task)', n2.id === onesId && n2.task === 'agentic_thinking' && n2.provenance.title === 'library');
  check('extractClipFromPage: second page', extractClipFromPage(readFileSync(ev + `song_${onesId}.html`, 'utf8'), onesId)?.title === raw2.title);
} else skip('evidence clip.json');

// -- merge ---------------------------------------------------------------------
const base = sourceFromTags(st);
const lib = normalizeClip({ id: synthId, title: 'From Library', created_at: null, model_name: 'chirp-x', major_model_version: 'v5', metadata: { tags: 'dream pop', prompt: null } });
const m1 = mergeSource(base, lib);
check('merge: non-null library fields win, per-field provenance', m1.title === 'From Library' && m1.provenance.title === 'library' && m1.style === 'dream pop');
check('merge: null in incoming never clobbers', m1.lyrics.from === 'file' && m1.created === '2026-09-23T10:00:00Z' && m1.provenance.lyrics === 'file');
const m2 = mergeSource(m1, lib);
check('merge: idempotent', same(m2, m1));
let threw = false; try { mergeSource(base, normalizeClip({ id: porchId, metadata: {} })); } catch { threw = true; }
check('merge: different ids refuse', threw);
check('cleanSource derived', same(cleanSource({ kind: 'derived', from: 'ast_x', by: 'demucs' }), { kind: 'derived', from: 'ast_x', by: 'demucs' }));
check('cleanSource suno from url', cleanSource({ kind: 'suno', url: `https://suno.com/song/${synthId}` }).id === synthId);
threw = false; try { cleanSource({ kind: 'spotify' }); } catch { threw = true; }
check('cleanSource rejects unknown kind', threw);

console.log(fails ? `\n${fails} FAILED` : '\nsuno: all checks passed');
process.exit(fails ? 1 : 0);
