// Asset sources + variants + the Suno library, headless: pure edits, store
// actions (one undo each), the asset/suno catalog commands with a stubbed
// sidecar, and the node-side library (scan/import/fetch/ingest) in a temp dir.
//
//   node test/sources.mjs

import { mkdtemp, writeFile, readFile, readdir, mkdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventBus } from '../src/core/bus.js';
import { Store } from '../src/core/store.js';
import { createProject, createArrangement } from '../src/core/schema.js';
import { CommandAPI } from '../src/api/api.js';
import { resolveAssetUrl, pickVariant } from '../src/core/assets.js';
import { variantKey } from '../src/core/sources.js';
import * as Lib from '../plugin/server/suno-library.mjs';

let failed = 0, passed = 0;
const check = (name, cond, detail = '') => { if (cond) { passed++; console.log(`  ok  ${name}`); } else { failed++; console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ''}`); } };
async function throws(fn, re) { try { await fn(); return false; } catch (e) { return re.test(e.message) || e.message; } }

const SHA_A = 'a'.repeat(64), SHA_B = 'b'.repeat(64), SHA_C = 'c'.repeat(64);
const SUNO = '39802a94-8c2f-49b7-bb77-79bfe022b18d';

function fixture() {
  const p = createProject('Src Test');
  p.assets = {
    r2: { id: 'r2', kind: 'audio', duration: 231.6, name: 'Render 2', variants: { default: { sha256: SHA_A, ext: 'm4a' } }, words: null },
    bed: { id: 'bed', kind: 'audio', duration: 231.6, variants: { default: { sha256: SHA_B, ext: 'wav' } }, words: null },
  };
  p.clips = {
    c1: { id: 'c1', sourceOf: 'r2', in: 0, out: 10, representation: null, fadeIn: 0, fadeOut: 0 },
    c2: { id: 'c2', sourceOf: 'r2', in: 10, out: 20, representation: 'default', fadeIn: 0, fadeOut: 0 },
  };
  p.arrangement = createArrangement ? { ...createArrangement(), placements: [{ track: 'l1', clip: 'c1', at: 0 }, { track: 'l1', clip: 'c2', at: 10 }], lanes: [{ id: 'l1', name: 'Mix' }] } : null;
  return p;
}

const bus = new EventBus();
const events = [];
for (const ev of ['assets:changed', 'arrangement:changed']) bus.on(ev, () => events.push(ev));
const store = new Store(bus, fixture());
store.load(fixture());
const api = new CommandAPI({ store, engine: {}, transport: {}, bus });
const sidecarCalls = [];
api.sidecar = async (route, body) => {
  sidecarCalls.push([route, body]);
  if (route === '/asset/ingest') return { ok: true, sha256: SHA_C, ext: 'wav', filename: 'my-master.wav', codec: 'pcm_s24le', sampleRate: 48000, channels: 2, duration: 231.6, source: null, lines: null };
  if (route.startsWith('/suno/library')) return { id: SUNO, url: `https://suno.com/song/${SUNO}`, title: 'Borrowed Light', style: 'dream pop', provenance: { title: 'page', style: 'page' }, lyrics: null, seenIn: ['x'], localFiles: [] };
  return { ok: true, route };
};
const undoN = () => store.undoStack.length;

console.log('\n[1] variant resolution');
{
  const a = { id: 'x', variants: { stream: { sha256: SHA_A }, default: { sha256: SHA_B }, user: { sha256: SHA_C, ext: 'flac' } } };
  check("no preferred -> 'default'", variantKey(a) === 'default');
  a.preferred = 'user';
  check('preferred wins over default', pickVariant(a).sha256 === SHA_C);
  check('explicit name wins over preferred', pickVariant(a, 'stream').sha256 === SHA_A);
  check('url follows preferred + its ext', resolveAssetUrl({ assets: { x: a } }, 'x') === `assets/${SHA_C}.flac`);
  a.preferred = 'gone';
  check('dangling preferred falls back to default', variantKey(a) === 'default');
  check('no default -> first recorded', variantKey({ variants: { s: {}, t: {} } }) === 's');
}

console.log('\n[2] asset command: get / list / source');
{
  const g = await api.execute('asset', { action: 'get', asset: 'r2' });
  check('get: plays default, lists clips with pins', g.plays === 'default' && g.clips.length === 2 && g.clips.find(c => c.id === 'c2').pinned === 'default');
  const l = await api.execute('asset', { action: 'list' });
  check('list: two assets', l.length === 2 && l[0].variants[0] === 'default');
  const n0 = undoN(); events.length = 0;
  const s = await api.execute('asset', { action: 'source', asset: 'r2', source: { kind: 'suno', url: `https://suno.com/song/${SUNO}`, lyrics: { text: 'We are home.', from: 'file' }, provenance: { id: 'file', lyrics: 'file' } } });
  const src = store.project.assets.r2.source;
  check('source set: suno id from url, url normalized', s.ok && src.id === SUNO && src.url === `https://suno.com/song/${SUNO}` && src.lyrics.text === 'We are home.');
  check('source set: one undo step + assets:changed', undoN() === n0 + 1 && events.includes('assets:changed'));
  await api.execute('asset', { action: 'source', asset: 'r2', merge: true, source: { kind: 'suno', id: SUNO, style: 'v13b dynamics', provenance: { style: 'sent-guess' } } });
  const m = store.project.assets.r2.source;
  check('source merge keeps lyrics, adds style with provenance', m.lyrics.text === 'We are home.' && m.style === 'v13b dynamics' && m.provenance.style === 'sent-guess' && m.provenance.lyrics === 'file');
  await api.execute('asset', { action: 'source', asset: 'bed', source: { kind: 'derived', from: 'r2', by: 'demucs' } });
  check('derived source', JSON.stringify(store.project.assets.bed.source) === JSON.stringify({ kind: 'derived', from: 'r2', by: 'demucs' }));
  check('derived from a missing asset throws', await throws(() => api.execute('asset', { action: 'source', asset: 'bed', source: { kind: 'derived', from: 'nope' } }), /No asset 'nope'/));
  check('derived from itself throws', await throws(() => api.execute('asset', { action: 'source', asset: 'bed', source: { kind: 'derived', from: 'bed' } }), /itself/));
  store.undo();
  check('undo restores the previous source', store.project.assets.bed.source === undefined && store.project.assets.r2.source.style === 'v13b dynamics');
  store.redo();
  check('redo re-applies', store.project.assets.bed.source?.by === 'demucs');
  await api.execute('asset', { action: 'source', asset: 'bed', source: null });
  check('source null clears', !('source' in store.project.assets.bed));
}

console.log('\n[3] variants: add from sha, add from path, prefer, remove');
{
  const n0 = undoN();
  const r = await api.execute('asset', { action: 'variant-add', asset: 'r2', variant: 'suno-wav', sha256: SHA_B.toUpperCase(), ext: '.WAV', origin: 'suno-download' });
  const v = store.project.assets.r2.variants['suno-wav'];
  check('variant-add by sha: normalized sha/ext, origin, addedAt', r.ok && v.sha256 === SHA_B && v.ext === 'wav' && v.origin === 'suno-download' && !!v.addedAt);
  check('variant-add does not change what plays', r.plays === 'default' && undoN() === n0 + 1);
  const r2 = await api.execute('asset', { action: 'variant-add', asset: 'r2', variant: 'user', path: 'songs/x/my-master.wav', prefer: true, note: 'my own bounce' });
  const u = store.project.assets.r2.variants.user;
  check('variant-add by path: sidecar ingest, probe fields recorded', sidecarCalls.some(([rt, b]) => rt === '/asset/ingest' && b.path === 'songs/x/my-master.wav') && u.sha256 === SHA_C && u.codec === 'pcm_s24le' && u.sampleRate === 48000 && u.filename === 'my-master.wav' && u.origin === 'user' && u.note === 'my own bounce');
  check('prefer:true in the same undo step', r2.plays === 'user' && store.project.assets.r2.preferred === 'user' && undoN() === n0 + 2);
  const p = store.project;
  check('unpinned clip now resolves to the new file', resolveAssetUrl(p, p.clips.c1.sourceOf, p.clips.c1.representation) === `assets/${SHA_C}.wav`);
  check('pinned clip keeps its variant', resolveAssetUrl(p, p.clips.c2.sourceOf, p.clips.c2.representation) === `assets/${SHA_A}.m4a`);
  check('duplicate name refused without replace', await throws(() => api.execute('asset', { action: 'variant-add', asset: 'r2', variant: 'user', sha256: SHA_A }), /already has a variant 'user'/));
  check('bad sha refused', await throws(() => api.execute('asset', { action: 'variant-add', asset: 'r2', variant: 'x', sha256: 'abc' }), /64-hex/));
  check('bad name refused', await throws(() => api.execute('asset', { action: 'variant-add', asset: 'r2', variant: 'no spaces', sha256: SHA_A }), /Bad variant name/));
  check('neither path nor sha refused', await throws(() => api.execute('asset', { action: 'variant-add', asset: 'r2', variant: 'q' }), /needs 'path'/));
  store.undo();
  check('undo of add+prefer: back to default, variant gone', !store.project.assets.r2.variants.user && variantKey(store.project.assets.r2) === 'default');
  store.redo();
  const pr = await api.execute('asset', { action: 'prefer', asset: 'r2', variant: 'suno-wav' });
  check('prefer switches + reports sha', pr.plays === 'suno-wav' && pr.sha256 === SHA_B && pr.before === 'user');
  check('prefer unknown throws', await throws(() => api.execute('asset', { action: 'prefer', asset: 'r2', variant: 'nah' }), /no variant 'nah'/));
  await api.execute('asset', { action: 'prefer', asset: 'r2', variant: null });
  check('prefer null -> default', variantKey(store.project.assets.r2) === 'default' && !('preferred' in store.project.assets.r2));
  check('remove pinned variant refused', await throws(() => api.execute('asset', { action: 'variant-remove', asset: 'r2', variant: 'default' }), /pinned/));
  await api.execute('asset', { action: 'prefer', asset: 'r2', variant: 'user' });
  await api.execute('asset', { action: 'variant-remove', asset: 'r2', variant: 'user' });
  check('remove preferred variant clears preferred', !store.project.assets.r2.variants.user && !('preferred' in store.project.assets.r2));
  check('remove last variant refused', await throws(() => api.execute('asset', { action: 'variant-remove', asset: 'bed', variant: 'default' }), /only variant/));
}

console.log('\n[4] asset import + suno link');
{
  api.sidecar = async (route, body) => {
    sidecarCalls.push([route, body]);
    if (route === '/asset/ingest') return { ok: true, sha256: SHA_C, ext: 'm4a', filename: 'render1-v13.m4a', codec: 'opus', sampleRate: 48000, channels: 2, duration: 228.36, source: { kind: 'suno', id: 'efcdfc1f-9c2d-4422-b1b5-f926811563fa', url: 'https://suno.com/song/efcdfc1f-9c2d-4422-b1b5-f926811563fa', created: '2026-09-22T21:54:12Z', lyrics: { text: 'We are home.', from: 'file' }, provenance: { id: 'file', created: 'file', lyrics: 'file' } }, lines: [{ s: 1, e: 2, t: 'We are home.' }] };
    return { id: SUNO, url: `https://suno.com/song/${SUNO}`, title: 'Borrowed Light', style: 'dream pop', provenance: { title: 'page', style: 'page' }, lyrics: null, seenIn: ['x'], localFiles: [] };
  };
  store.project.baseUrl = '/project/projects/songs/demo/';
  const n0 = undoN();
  const im = await api.execute('asset', { action: 'import', path: 'projects/songs/demo/renders/render1-v13.m4a', id: 'ast_src_r1' });
  const a = store.project.assets.ast_src_r1;
  check('import: new asset with suno source from tags', im.ok && a && a.source.id === 'efcdfc1f-9c2d-4422-b1b5-f926811563fa' && a.source.provenance.lyrics === 'file');
  check('import: variant origin suno-download, projectDir from baseUrl', a.variants.default.origin === 'suno-download' && sidecarCalls.at(-1)[1].projectDir === 'projects/songs/demo');
  check('import: one undo step', undoN() === n0 + 1);
  const lk = await api.execute('suno', { action: 'link', asset: 'r2', id: SUNO, sent: { lyrics: 'v14-SEND.txt', style: 'v13b.txt', confidence: 'guess' } });
  const s = store.project.assets.r2.source;
  check('link: merges library fields onto the existing source', lk.ok && s.title === 'Borrowed Light' && s.lyrics.text === 'We are home.' && s.provenance.title === 'page' && s.sent.confidence === 'guess');
  check('link: seenIn/localFiles stay in the library', !('seenIn' in s) && !('localFiles' in s));
  check('suno bad action', await throws(() => api.execute('suno', { action: 'scrape' }), /Bad action/));
  check('suno link needs asset+id', await throws(() => api.execute('suno', { action: 'link', id: SUNO }), /needs 'asset'/));
}

console.log('\n[5] library (node, temp dir)');
{
  const root = await mkdtemp(join(tmpdir(), 'oscine-suno-'));
  try {
    // A tiny m4a with only ftyp + moov/udta/meta/ilst/©cmt.
    const enc = new TextEncoder();
    const cat = (...ps) => Buffer.concat(ps.map(p => Buffer.from(p)));
    const u32 = v => { const b = Buffer.alloc(4); b.writeUInt32BE(v); return b; };
    const box = (t, ...b) => { const body = cat(...b); return cat(u32(body.length + 8), Buffer.from(t, 'latin1'), body); };
    const m4a = (id) => cat(box('ftyp', enc.encode('M4A '), u32(0)), box('moov', box('udta', box('meta', u32(0), box('hdlr', u32(0), u32(0), enc.encode('mdir'), Buffer.alloc(13)), box('ilst', box('\u00a9cmt', box('data', u32(1), u32(0), enc.encode(`made with suno; created=2026-09-20T01:00:00Z; id=${id}`))))))));
    await mkdir(join(root, 'song', 'renders'), { recursive: true });
    await mkdir(join(root, 'dl'), { recursive: true });
    const idA = '11111111-1111-4111-8111-111111111111', idB = '22222222-2222-4222-8222-222222222222';
    await writeFile(join(root, 'song', 'renders', 'a.m4a'), m4a(idA));
    await writeFile(join(root, 'dl', 'b.m4a'), m4a(idB));
    await writeFile(join(root, 'dl', 'a copy.m4a'), m4a(idA));
    await writeFile(join(root, 'song', 'not-suno.mp3'), Buffer.from('ID3\x03\x00\x00\x00\x00\x00\x00'));
    const before = (await stat(join(root, 'dl', 'b.m4a'))).mtimeMs;
    const sc = await Lib.scanLocal(join(root, 'song'), [join(root, 'dl')]);
    check('scan: finds both ids across root + extra dir', sc.count === 2 && sc.ids.includes(idA) && sc.ids.includes(idB), JSON.stringify(sc.ids));
    const lib = await Lib.loadLibrary(join(root, 'song'));
    check('scan: localFiles recorded per path, provenance file', lib.songs[idA].localFiles.length === 2 && lib.songs[idA].provenance.id === 'file' && lib.songs[idA].created === '2026-09-20T01:00:00Z');
    check('scan: scanned files untouched', (await stat(join(root, 'dl', 'b.m4a'))).mtimeMs === before);
    const sc2 = await Lib.scanLocal(join(root, 'song'), [join(root, 'dl')]);
    const lib2 = await Lib.loadLibrary(join(root, 'song'));
    check('scan twice: idempotent', sc2.count === 2 && JSON.stringify(lib2.songs) === JSON.stringify(lib.songs));
    const imp = await Lib.importClips(join(root, 'song'), { clips: [{ id: idA, title: 'Song A', created_at: '2026-09-20T01:00:00.5Z', model_name: 'chirp-hawk', major_model_version: 'v6', metadata: { tags: 'dream pop', prompt: '[Verse]', task: 'extend', cover_clip_id: '00000000-0000-0000-0000-000000000000', duration: 200 } }, { nope: 1 }] });
    const s = (await Lib.loadLibrary(join(root, 'song'))).songs[idA];
    check('import: merges, reports errors, keeps local files', imp.imported === 1 && imp.errors.length === 1 && s.title === 'Song A' && s.task === 'extend' && s.parent === null && s.localFiles.length === 2 && s.provenance.title === 'library');
    const sum = Lib.summarizeLibrary(await Lib.loadLibrary(join(root, 'song')));
    check('summary: count + no raw', sum.count === 2 && !('raw' in sum.songs[0]));
    // fetch: stubbed fetcher, rate-limited, cached, bulk capped
    let calls = 0, stamps = [];
    const html = `<meta property="og:title" content="Song B"><meta property="og:image" content="https://cdn2.suno.ai/b.jpeg"><script>self.__next_f.push([1,"x"])</script>`;
    const fetcher = async () => { calls++; stamps.push(Date.now()); return { ok: true, status: 200, text: async () => html }; };
    const f1 = await Lib.fetchPublic(join(root, 'song'), { id: `https://suno.com/song/${idB}` }, fetcher);
    check('fetch: OG fallback fills title + cover', f1.results[0].via === 'og' && (await Lib.loadLibrary(join(root, 'song'))).songs[idB].title === 'Song B');
    const f2 = await Lib.fetchPublic(join(root, 'song'), { id: idB }, fetcher);
    check('fetch: second call served from cache', f2.results[0].cached === true && calls === 1);
    const f3 = await Lib.fetchPublic(join(root, 'song'), { all: true, max: 99 }, fetcher);
    check('fetch all: only unfetched songs, cap applied, 2 s gap', f3.requested === 1 && calls === 2 && stamps[1] - stamps[0] >= 1990, `${f3.requested} ${stamps[1] - stamps[0]}ms`);
    check('fetch without id or all throws', await throws(() => Lib.fetchPublic(join(root, 'song'), {}, fetcher), /needs 'id'/));
    // ingest: copies (never moves), probes, fills source
    const ing = await Lib.ingestFile(root, 'song', { path: 'dl/b.m4a' });
    const files = await readdir(join(root, 'song', 'assets'));
    check('ingest: copied to assets/<sha>.m4a, original kept', files.length === 1 && files[0] === `${ing.sha256}.m4a` && (await stat(join(root, 'dl', 'b.m4a'))).isFile());
    check('ingest: source from tags', ing.source?.id === idB && ing.copied === true);
    check('ingest: path outside root refused', await throws(() => Lib.ingestFile(root, 'song', { path: '/etc/hosts' }), /escapes/));
  } finally { await rm(root, { recursive: true, force: true }); }
}

console.log(`\nsources: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
