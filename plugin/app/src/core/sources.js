// Asset sources and variants as pure edits (no DOM, no audio, no fs).
// The store wraps each in arrangementEdit (one undo step); the `asset` and
// `suno` catalog commands and the asset inspector call those store actions.
//
//   asset.source    = {kind:'suno', id, url, created, title, style, model, task,
//                      duration, cover, lyrics:{text, from}, sent, parent,
//                      provenance:{field: 'file'|'page'|'library'|'user'|'sent-guess'},
//                      fetched, raw}
//                   | {kind:'derived', from:<assetId>, by}
//   asset.variants  = {name: {sha256, ext, origin?, addedAt?, filename?, codec?,
//                      sampleRate?, channels?, duration?, note?, ...}}
//   asset.preferred = variant name that plays when a clip names none
//
// Clips point at the ASSET (clip.sourceOf), and name a variant only if they
// want one pinned (clip.representation). So adding a better file later and
// preferring it re-points every unpinned clip at once and breaks none.

import { resolveAsset } from './arrangement.js';
import { cleanSource, mergeSource } from './suno.js';
import { uid } from './util.js';
import { variantKey } from './assets.js';

export const VARIANT_ORIGINS = ['suno-download', 'suno-stream', 'user', 'render', 'derived', 'import'];
const VARIANT_META = ['ext', 'origin', 'addedAt', 'filename', 'codec', 'sampleRate', 'channels', 'duration', 'note', 'derivedFrom', 'derivedBy'];
const SHA_RE = /^[0-9a-f]{64}$/;
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;

export { variantKey };

// Summary of an asset for agents: no word arrays, no raw page blob.
export function describeAsset(p, ref, { raw = false } = {}) {
  const a = resolveAsset(p, ref);
  const playing = variantKey(a);
  const src = a.source ? { ...a.source } : null;
  if (src && !raw && src.raw) src.raw = '(kept; pass raw:true)';
  if (src?.lyrics?.text && !raw) src.lyrics = { ...src.lyrics, text: src.lyrics.text.length > 400 ? src.lyrics.text.slice(0, 400) + ' ...' : src.lyrics.text, chars: src.lyrics.text.length };
  const clips = Object.values(p.clips ?? {}).filter(c => c.sourceOf === a.id);
  return {
    id: a.id, name: a.name ?? null, kind: a.kind, duration: a.duration ?? null,
    preferred: a.preferred ?? null, plays: playing,
    variants: Object.entries(a.variants ?? {}).map(([name, v]) => ({ name, ...v })),
    source: src,
    words: a.words?.length ?? 0,
    clips: clips.map(c => ({ id: c.id, name: c.name ?? null, pinned: c.representation ?? null })),
  };
}

export function listAssets(p) {
  return Object.values(p.assets ?? {}).map(a => ({
    id: a.id, name: a.name ?? null, duration: a.duration ?? null, variants: Object.keys(a.variants ?? {}),
    plays: variantKey(a), source: a.source ? (a.source.kind === 'suno' ? { kind: 'suno', id: a.source.id, title: a.source.title ?? null } : { ...a.source }) : null,
  }));
}

// Set, merge or clear asset.source. `merge` folds non-null fields into the
// existing suno block and keeps per-field provenance.
export function setSource(p, ref, source, { merge = false } = {}) {
  const a = resolveAsset(p, ref);
  const before = a.source ?? null;
  if (source == null) { delete a.source; return { asset: a.id, source: null, before: before?.kind ?? null }; }
  const clean = cleanSource(source);
  if (clean.kind === 'derived') {
    if (clean.from === a.id) throw new Error('An asset cannot be derived from itself.');
    resolveAsset(p, clean.from); // must exist
  }
  a.source = merge && before && before.kind === clean.kind && clean.kind === 'suno'
    ? mergeSource(before, { ...clean, provenance: source.provenance ?? {} })
    : clean;
  if (merge && a.source.kind === 'suno' && source.provenance) a.source.provenance = { ...(before?.provenance ?? {}), ...source.provenance };
  return { asset: a.id, source: a.source.kind === 'suno' ? a.source.id : a.source.from, kind: a.source.kind, before: before?.kind ?? null };
}

function cleanVariant(v) {
  const sha = String(v?.sha256 ?? '').toLowerCase();
  if (!SHA_RE.test(sha)) throw new Error(`variant needs a 64-hex sha256 of a file in assets/ (got '${v?.sha256}'). Pass 'path' instead to copy a file in.`);
  const out = { sha256: sha };
  for (const k of VARIANT_META) if (v[k] != null && v[k] !== '') out[k] = v[k];
  out.ext = String(out.ext ?? 'wav').replace(/^\./, '').toLowerCase();
  if (!/^[a-z0-9]{1,5}$/.test(out.ext)) throw new Error(`Bad ext '${v.ext}'.`);
  if (out.origin && !VARIANT_ORIGINS.includes(out.origin)) throw new Error(`Unknown origin '${out.origin}'. Use one of ${VARIANT_ORIGINS.join(', ')}.`);
  return out;
}

// Add (or replace, with replace:true) a named variant. Never touches clips.
export function addVariant(p, ref, name, variant, { replace = false, prefer = false } = {}) {
  const a = resolveAsset(p, ref);
  const n = String(name ?? '').trim();
  if (!NAME_RE.test(n)) throw new Error(`Bad variant name '${name}'. Use letters, digits, . _ - (e.g. 'user', 'suno-wav').`);
  a.variants ??= {};
  if (a.variants[n] && !replace) throw new Error(`Asset '${a.id}' already has a variant '${n}'. Pick another name or pass replace:true.`);
  const v = cleanVariant(variant);
  v.addedAt ??= new Date().toISOString();
  a.variants[n] = v;
  if (prefer) a.preferred = n;
  return { asset: a.id, variant: n, sha256: v.sha256, preferred: a.preferred ?? null, plays: variantKey(a) };
}

export function removeVariant(p, ref, name) {
  const a = resolveAsset(p, ref);
  if (!a.variants?.[name]) throw new Error(`Asset '${a.id}' has no variant '${name}'. Variants: ${Object.keys(a.variants ?? {}).join(', ')}.`);
  if (Object.keys(a.variants).length === 1) throw new Error(`'${name}' is the only variant of '${a.id}'; an asset needs at least one.`);
  const pinned = Object.values(p.clips ?? {}).filter(c => c.sourceOf === a.id && c.representation === name);
  if (pinned.length) throw new Error(`Clips ${pinned.map(c => c.id).join(', ')} are pinned to '${name}'. Unpin them (clip set representation:null) first.`);
  delete a.variants[name];
  if (a.preferred === name) delete a.preferred;
  return { asset: a.id, removed: name, plays: variantKey(a) };
}

// Choose which variant plays for unpinned clips. null clears (back to 'default'/first).
export function preferVariant(p, ref, name) {
  const a = resolveAsset(p, ref);
  const before = variantKey(a);
  if (name == null || name === '') delete a.preferred;
  else {
    if (!a.variants?.[name]) throw new Error(`Asset '${a.id}' has no variant '${name}'. Variants: ${Object.keys(a.variants ?? {}).join(', ')}.`);
    a.preferred = name;
  }
  return { asset: a.id, preferred: a.preferred ?? null, before, plays: variantKey(a), sha256: a.variants[variantKey(a)]?.sha256 };
}

// A new asset from an ingested file (the import path). `source` from the
// file's tags rides along.
export function addAsset(p, { id, name, duration, variant = 'default', file, source = null, kind = 'audio' } = {}) {
  p.assets ??= {};
  const aid = id ? String(id) : uid('ast');
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(aid)) throw new Error(`Bad asset id '${id}'.`);
  if (p.assets[aid]) throw new Error(`Asset '${aid}' already exists. Use variant-add to attach another file to it.`);
  const v = cleanVariant(file ?? {});
  v.addedAt ??= new Date().toISOString();
  const a = { id: aid, kind, duration: Number(duration ?? v.duration ?? 0) || 0, variants: { [variant]: v }, words: null };
  if (name) a.name = String(name).slice(0, 120);
  if (source) a.source = cleanSource(source);
  p.assets[aid] = a;
  return { asset: aid, variant, sha256: v.sha256, source: a.source ? (a.source.id ?? a.source.from) : null };
}
