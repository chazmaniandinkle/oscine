// Asset inspector section for sources and variants: the Suno link (cover,
// title, style, model, lyrics), a "Fetch from Suno" button, and the list of
// audio variants with where each came from and a Prefer button. "Add file..."
// takes a path under the project root, or a dropped file. Every change goes
// through a store action (via the catalog command, which wraps it), so it
// is one undo step and an agent can do the same thing.

import { el, Btn, toast } from './widgets.js';
import { variantKey } from '../core/assets.js';

const fmtTime = v => { if (v == null) return '?'; const m = Math.floor(v / 60), s = Math.floor(v % 60); return `${m}:${String(s).padStart(2, '0')}`; };
const shortDate = s => (s ? String(s).slice(0, 16).replace('T', ' ') : '');

function b64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function sourcePanel(app, asset, rerender) {
  const { store, api } = app;
  const wrap = el('div', 'insp-group source-panel');
  const src = asset.source ?? null;
  const status = el('span', 'clip-hint source-status', '');
  const run = async (label, fn) => {
    status.textContent = label + '...';
    try { const out = await fn(); status.textContent = ''; rerender(); return out; }
    catch (err) { status.textContent = String(err.message || err); toast(String(err.message || err)); return null; }
  };

  // -- source ---------------------------------------------------------------
  if (src?.kind === 'suno') {
    wrap.appendChild(el('div', 'insp-group-title', 'Suno'));
    const card = el('div', 'suno-card');
    if (src.cover) { const img = el('img', 'suno-cover'); img.src = src.cover; img.alt = ''; img.loading = 'lazy'; card.appendChild(img); }
    const info = el('div', 'suno-info');
    const link = el('a', 'suno-link', src.title || src.id);
    link.href = src.url || `https://suno.com/song/${src.id}`; link.target = '_blank'; link.rel = 'noopener';
    link.title = 'Open on suno.com';
    info.appendChild(link);
    const prov = f => (src.provenance?.[f] ? ` (${src.provenance[f]})` : '');
    const rows = [
      src.style && ['style', src.style + prov('style')],
      src.model && ['model', src.model + prov('model')],
      src.task && ['task', src.task],
      src.created && ['created', shortDate(src.created)],
      src.duration && ['length', fmtTime(src.duration)],
      src.sent && ['sent', [src.sent.lyrics, src.sent.style].filter(Boolean).join(' + ') + (src.sent.confidence ? ` [${src.sent.confidence}]` : '')],
      src.parent && ['parent', src.parent.id ?? src.parent.asset ?? JSON.stringify(src.parent)],
    ].filter(Boolean);
    for (const [k, v] of rows) { const r = el('div', 'clip-meta-row suno-row'); r.appendChild(el('span', 'suno-k', k)); r.appendChild(el('span', 'suno-v', v)); r.title = v; info.appendChild(r); }
    card.appendChild(info);
    wrap.appendChild(card);
    if (src.lyrics?.text) {
      const det = el('details', 'suno-lyrics');
      det.appendChild(el('summary', null, `Lyrics (${src.lyrics.from ?? '?'}, ${src.lyrics.text.split('\n').length} lines)`));
      det.appendChild(el('pre', 'suno-lyrics-text', src.lyrics.text));
      wrap.appendChild(det);
    }
    const acts = el('div', 'clip-actions');
    const fetchBtn = Btn(src.fetched ? 'Fetch again' : 'Fetch from Suno', () => run('fetching', async () => {
      await api.execute('suno', { action: 'fetch', id: src.id, force: !!src.fetched });
      return api.execute('suno', { action: 'link', asset: asset.id, id: src.id });
    }));
    fetchBtn.title = 'Read this song\u2019s public page once (title, style, model, cover). No audio is downloaded.';
    fetchBtn.classList.add('suno-fetch');
    acts.appendChild(fetchBtn);
    wrap.appendChild(acts);
  } else if (src?.kind === 'derived') {
    wrap.appendChild(el('div', 'insp-group-title', 'Source'));
    const from = store.project.assets[src.from];
    const r = el('div', 'clip-meta-row', `from ${from?.name || src.from}${src.by ? ` by ${src.by}` : ''}`);
    r.classList.add('source-derived');
    if (from) { r.style.cursor = 'pointer'; r.addEventListener('click', () => { app.assetBin.selectedAsset = from.id; app.bus.emit('asset:selected', { id: from.id }); }); }
    wrap.appendChild(r);
  } else {
    wrap.appendChild(el('div', 'insp-group-title', 'Source'));
    const acts = el('div', 'clip-actions');
    acts.appendChild(Btn('Link Suno song...', () => {
      const v = prompt('Suno song URL or id');
      if (!v) return;
      run('linking', () => api.execute('asset', { action: 'source', asset: asset.id, source: { kind: 'suno', id: v, provenance: { id: 'user' } } }));
    }));
    wrap.appendChild(acts);
  }

  // -- variants ---------------------------------------------------------------
  const playing = variantKey(asset);
  const vt = el('div', 'insp-group-title', `Variants \u00b7 ${Object.keys(asset.variants ?? {}).length}`);
  vt.style.marginTop = '8px';
  wrap.appendChild(vt);
  const list = el('div', 'variant-list');
  for (const [name, v] of Object.entries(asset.variants ?? {})) {
    const row = el('div', 'variant-row' + (name === playing ? ' playing' : ''));
    row.dataset.variant = name;
    const lab = el('div', 'variant-name', name + (name === playing ? '  \u25b6' : ''));
    const bits = [v.origin, v.ext, v.codec, v.sampleRate && `${v.sampleRate / 1000} kHz`, v.channels && `${v.channels}ch`, v.duration && fmtTime(v.duration)].filter(Boolean);
    const sub = el('div', 'variant-sub', bits.join(' \u00b7 ') || 'no details');
    sub.title = [`sha256 ${v.sha256}`, v.filename && `file ${v.filename}`, v.addedAt && `added ${v.addedAt}`, v.note].filter(Boolean).join('\n');
    const left = el('div', 'variant-text'); left.appendChild(lab); left.appendChild(sub);
    row.appendChild(left);
    if (name !== playing) {
      const pb = Btn('Prefer', () => run('switching', () => api.execute('asset', { action: 'prefer', asset: asset.id, variant: name })));
      pb.classList.add('variant-prefer');
      pb.title = 'Play this file for every clip that doesn\u2019t pin a variant';
      row.appendChild(pb);
    }
    list.appendChild(row);
  }
  wrap.appendChild(list);

  // Add a file: a path under the project root, or drop one here.
  const addRow = el('div', 'clip-actions variant-add');
  const nameFor = () => {
    const taken = asset.variants ?? {};
    let n = 'user', k = 2;
    while (taken[n]) n = `user-${k++}`;
    return n;
  };
  const addBtn = Btn('Add file...', () => {
    const path = prompt('Audio file path, relative to the workspace root (the file is copied into assets/, never moved)');
    if (!path) return;
    const variant = nameFor();
    run('adding', () => api.execute('asset', { action: 'variant-add', asset: asset.id, variant, path: path.trim(), origin: 'user' }));
  });
  addBtn.classList.add('variant-add-btn');
  addRow.appendChild(addBtn);
  const drop = el('span', 'clip-hint variant-drop', 'or drop an audio file here');
  addRow.appendChild(drop);
  wrap.appendChild(addRow);
  wrap.addEventListener('dragover', e => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); wrap.classList.add('drop-over'); } });
  wrap.addEventListener('dragleave', () => wrap.classList.remove('drop-over'));
  wrap.addEventListener('drop', e => {
    const f = e.dataTransfer?.files?.[0];
    wrap.classList.remove('drop-over');
    if (!f) return;
    e.preventDefault();
    run('adding', async () => {
      const got = await api.sidecar('/asset/ingest', { base64: b64(await f.arrayBuffer()), filename: f.name, projectDir: api.projectDir() });
      const file = { sha256: got.sha256, ext: got.ext, filename: f.name, codec: got.codec, sampleRate: got.sampleRate, channels: got.channels, duration: got.duration, origin: got.source ? 'suno-download' : 'user' };
      return store.assetVariantAdd(asset.id, nameFor(), file, {});
    });
  });
  wrap.appendChild(status);
  return wrap;
}
