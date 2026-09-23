// Arrangement edits as pure functions over a project object: no DOM, no
// audio, importable from node. Each function does ONE mutation (the caller
// owns checkpoint() and bus events; see Store.arrangementEdit) and returns a
// small JSON-serializable result describing what changed.
//
// Much of this is ported from ui/timeline.js (split, range cut, ripple
// delete, markers, lane records) so the catalog and the UI share the same
// edit semantics. Times: placements, markers, the cycle and lane/master
// automation are song seconds; clip in/out and clip envelopes are clip-local
// (source) seconds; asset words are source seconds.
//
// Errors are thrown as Error with actionable messages; the API passes them
// straight through to the agent.

import { createClip, createInsert } from './schema.js';
import { parseTarget, rangeOf, findEnvelope, ensureEnvelope, addPoint } from '../engine/automation.js';
import { getEffectDef, listEffectDefs } from '../engine/effects/index.js';

const r3 = x => Math.round(x * 1000) / 1000;
const shortId = () => Math.random().toString(36).slice(2, 7);

// Seconds a clip occupies on the timeline (mirrors ClipPlayer.placedDuration).
export function placedDur(clip) { return (clip.out - clip.in) * (clip.stretch ?? 1) / (clip.rate ?? 1); }

export function requireArrangement(p) {
  if (!p.arrangement) throw new Error('This project has no arrangement; open an arrangement project (project_open_file) first. Pattern projects use set_notes/set_steps.');
  const arr = p.arrangement;
  arr.placements ??= [];
  return arr;
}

// -- lanes -------------------------------------------------------------------

// Lanes as displayed: arrangement.lanes, or (legacy docs) derived from the
// placements' track ids.
export function lanesOf(arr) {
  if (arr.lanes?.length) return arr.lanes;
  const seen = [];
  for (const pl of arr.placements ?? []) if (!seen.find(l => l.id === pl.track)) seen.push({ id: pl.track, name: pl.track });
  return seen;
}

// Materialise arrangement.lanes (legacy docs) and return the record for id.
export function laneRecord(arr, id) {
  if (!arr.lanes?.length) arr.lanes = lanesOf(arr).map(l => ({ ...l }));
  let l = arr.lanes.find(x => x.id === id);
  if (!l) { l = { id, name: id }; arr.lanes.push(l); }
  return l;
}

export function resolveLane(p, ref) {
  const arr = requireArrangement(p);
  const lanes = lanesOf(arr);
  const s = String(ref ?? '');
  const hit = lanes.find(l => l.id === s) || lanes.find(l => String(l.name ?? '').toLowerCase() === s.toLowerCase());
  if (!hit) throw new Error(`No lane '${ref}'. Lanes: ${lanes.map(l => `"${l.name ?? l.id}" (${l.id})`).join(', ') || '(none)'}. Use lane action 'add' to create one.`);
  return laneRecord(arr, hit.id);
}

export function resolveClip(p, ref) {
  const clips = p.clips ?? {};
  const s = String(ref ?? '');
  const c = clips[s] || Object.values(clips).find(c => String(c.name ?? '').toLowerCase() === s.toLowerCase());
  if (!c) throw new Error(`No clip '${ref}'. Use arrangement action 'get' to see placements and their clip ids.`);
  return c;
}

export function resolveAsset(p, ref) {
  const assets = p.assets ?? {};
  const s = String(ref ?? '');
  const a = assets[s] || Object.values(assets).find(a => String(a.name ?? '').toLowerCase() === s.toLowerCase());
  if (!a) throw new Error(`No asset '${ref}'. Assets: ${Object.keys(assets).join(', ') || '(none)'}.`);
  return a;
}

function placementAt(p, index) {
  const arr = requireArrangement(p);
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i >= arr.placements.length) {
    throw new Error(`Bad placement index ${index}; there are ${arr.placements.length} placements (0-${arr.placements.length - 1}). Use arrangement action 'get'.`);
  }
  const pl = arr.placements[i];
  const clip = p.clips?.[pl.clip];
  if (!clip) throw new Error(`Placement ${i} references missing clip '${pl.clip}'.`);
  return { arr, i, pl, clip };
}

export function placementSummary(p, pl, i) {
  const c = p.clips?.[pl.clip];
  return { index: i, lane: pl.track, clip: pl.clip, name: c?.name, at: r3(pl.at), end: c ? r3(pl.at + placedDur(c)) : null };
}

export function clipSummary(c) {
  const out = { id: c.id, name: c.name, asset: c.sourceOf, in: r3(c.in), out: r3(c.out), duration: r3(placedDur(c)), fadeIn: c.fadeIn ?? 0, fadeOut: c.fadeOut ?? 0 };
  for (const k of ['gainDb', 'stretch', 'rate', 'semitones', 'representation']) if (c[k] != null) out[k] = c[k];
  return out;
}

export function songEnd(p) {
  const arr = p.arrangement; if (!arr) return 0;
  let end = arr.length || 0;
  for (const pl of arr.placements ?? []) { const c = p.clips?.[pl.clip]; if (c) end = Math.max(end, pl.at + placedDur(c)); }
  return r3(end);
}

export function summary(p) {
  const arr = requireArrangement(p);
  return {
    length: songEnd(p),
    lanes: lanesOf(arr).map(l => ({
      id: l.id, name: l.name ?? l.id, gainDb: l.gainDb ?? 0, pan: l.pan ?? 0, mute: !!l.mute, solo: !!l.solo,
      inserts: (l.inserts ?? []).map(x => x.type + (x.bypass ? ' (bypassed)' : '')),
    })),
    master: { inserts: (arr.master?.inserts ?? []).map(x => x.type + (x.bypass ? ' (bypassed)' : '')) },
    placements: arr.placements.map((pl, i) => placementSummary(p, pl, i)),
    markers: (arr.markers ?? []).map(m => ({ id: m.id, t: r3(m.t), name: m.name })),
    cycle: arr.loop ? { a: r3(arr.loop.a), b: r3(arr.loop.b), on: !!arr.loop.on } : null,
    automation: (arr.automation ?? []).map(e => ({ target: e.target, points: e.points?.length ?? 0 })),
    assets: Object.values(p.assets ?? {}).map(a => ({ id: a.id, duration: a.duration, words: a.words?.length ?? 0 })),
  };
}

// -- clips / placements ------------------------------------------------------

const CLIP_FIELDS = ['in', 'out', 'gainDb', 'fadeIn', 'fadeOut', 'stretch', 'semitones', 'name'];

export function clipSet(p, ref, fields) {
  const c = resolveClip(p, ref);
  const f = { ...fields };
  if (f.pitch !== undefined) { f.semitones = f.pitch; delete f.pitch; }
  const asset = p.assets?.[c.sourceOf];
  const changed = {};
  const nIn = f.in ?? c.in, nOut = f.out ?? c.out;
  if (nIn < 0) throw new Error(`'in' must be >= 0 (got ${nIn}).`);
  if (nOut - nIn < 0.01) throw new Error(`'out' must be after 'in' (in ${nIn}, out ${nOut}).`);
  if (asset?.duration && nOut > asset.duration + 1e-6) throw new Error(`'out' ${nOut} is past the end of asset ${asset.id} (${asset.duration}s).`);
  for (const k of CLIP_FIELDS) {
    if (f[k] === undefined) continue;
    let v = f[k];
    if (k === 'name') v = String(v);
    else if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`'${k}' must be a number.`);
    if (k === 'fadeIn' || k === 'fadeOut') v = Math.max(0, Math.min(v, nOut - nIn));
    if (k === 'stretch') { if (v <= 0) throw new Error("'stretch' must be > 0 (1 = original length)."); }
    if (k === 'gainDb') v = Math.max(-60, Math.min(24, v));
    if (k === 'semitones') v = Math.max(-24, Math.min(24, v));
    c[k] = v; changed[k] = v;
  }
  if (!Object.keys(changed).length) throw new Error(`Nothing to set. Give any of: ${CLIP_FIELDS.join(', ')} (pitch = semitones).`);
  return { clip: clipSummary(c), changed };
}

function cloneClip(p, c, extra = {}) {
  const copy = { ...c, id: `${c.id}~${shortId()}`, ...extra };
  p.clips[copy.id] = copy;
  return copy;
}

// Split placement i at song time t (strictly inside it). Port of
// timeline._splitIndexAt: the left keeps the clip id; the right is a new clip.
export function splitPlacement(p, index, t) {
  const { arr, i, pl, clip } = placementAt(p, index);
  const dur = placedDur(clip);
  if (!(t > pl.at + 0.02 && t < pl.at + dur - 0.02)) {
    throw new Error(`Split time ${t} is not inside placement ${i} (${r3(pl.at)}-${r3(pl.at + dur)}).`);
  }
  const frac = (t - pl.at) / dur;
  const cut = clip.in + (clip.out - clip.in) * frac;
  const right = cloneClip(p, clip, { in: cut, fadeIn: 0, name: (clip.name || clip.id) + ' ·b' });
  clip.out = cut; clip.fadeOut = 0;
  arr.placements.splice(i + 1, 0, { track: pl.track, clip: right.id, at: t });
  return { left: placementSummary(p, pl, i), right: placementSummary(p, arr.placements[i + 1], i + 1) };
}

// Copy placement i (with an independent clip copy) to `at` (default: right
// after it) on `lane` (default: same lane).
export function duplicatePlacement(p, index, { at, lane } = {}) {
  const { arr, i, pl, clip } = placementAt(p, index);
  const laneId = lane != null ? resolveLane(p, lane).id : pl.track;
  const copy = cloneClip(p, clip, { name: (clip.name || clip.id) + ' copy' });
  const np = { ...pl, track: laneId, clip: copy.id, at: Math.max(0, at ?? pl.at + placedDur(clip)) };
  arr.placements.splice(i + 1, 0, np);
  return { placement: placementSummary(p, np, i + 1) };
}

export function movePlacement(p, index, { at, lane } = {}) {
  const { i, pl } = placementAt(p, index);
  if (at === undefined && lane === undefined) throw new Error("move needs 'at' (song seconds) and/or 'lane'.");
  const from = placementSummary(p, pl, i);
  if (at !== undefined) pl.at = Math.max(0, at);
  if (lane !== undefined) pl.track = resolveLane(p, lane).id;
  return { from, to: placementSummary(p, pl, i) };
}

export function removePlacement(p, index) {
  const { arr, i, pl } = placementAt(p, index);
  const removed = placementSummary(p, pl, i);
  arr.placements.splice(i, 1); // the clip record stays; it's a reference
  return { removed };
}

// Place a clip (by id/name) or a whole asset (new clip over its full
// duration) on a lane at song time `at`.
export function placeClip(p, { clip, asset, lane, at = 0 }) {
  const arr = requireArrangement(p);
  const l = resolveLane(p, lane);
  let c;
  if (clip != null) c = resolveClip(p, clip);
  else if (asset != null) {
    const a = resolveAsset(p, asset);
    if (!(a.duration > 0)) throw new Error(`Asset ${a.id} has no duration; can't make a clip of it.`);
    c = createClip(a.id, 0, a.duration, { name: a.name ?? a.id });
    p.clips[c.id] = c;
  } else throw new Error("place needs 'clip' (clip id/name) or 'asset' (asset id).");
  const pl = { track: l.id, clip: c.id, at: Math.max(0, at) };
  arr.placements.push(pl);
  return { placement: placementSummary(p, pl, arr.placements.length - 1), clip: clipSummary(c) };
}

// -- ranges ------------------------------------------------------------------

// Remove [a,b] from the given placements, leaving a gap. Port of
// timeline.deleteRangeFromSelection.
function cutIndices(p, arr, indices, a, b) {
  let touched = 0;
  for (const i of [...indices].sort((x, y) => y - x)) {
    const pl = arr.placements[i], c = p.clips[pl.clip];
    if (!c) continue;
    const st = (c.stretch ?? 1) / (c.rate ?? 1);
    const end = pl.at + placedDur(c);
    if (b <= pl.at || a >= end) continue;
    touched++;
    if (a <= pl.at && b >= end) { arr.placements.splice(i, 1); continue; }
    if (a > pl.at && b < end) {
      const cutIn = c.in + (a - pl.at) / st, cutOut = c.in + (b - pl.at) / st;
      const tail = cloneClip(p, c, { in: cutOut, fadeIn: 0, name: (c.name || c.id) + ' ·b' });
      c.out = cutIn; c.fadeOut = 0;
      arr.placements.splice(i + 1, 0, { track: pl.track, clip: tail.id, at: b });
      continue;
    }
    if (a <= pl.at) { c.in = c.in + (b - pl.at) / st; pl.at = b; }
    else c.out = c.in + (a - pl.at) / st;
  }
  return touched;
}

function checkRange(a, b) {
  if (typeof a !== 'number' || typeof b !== 'number' || !(b - a >= 0.01) || a < 0) {
    throw new Error(`Bad range a=${a}, b=${b}: need 0 <= a < b (song seconds).`);
  }
}

export function cutRange(p, a, b, lanes) {
  const arr = requireArrangement(p);
  checkRange(a, b);
  const laneIds = lanes?.length ? lanes.map(l => resolveLane(p, l).id) : null;
  const idx = arr.placements.map((_, i) => i).filter(i => !laneIds || laneIds.includes(arr.placements[i].track));
  const touched = cutIndices(p, arr, idx, a, b);
  return { a, b, lanes: laneIds ?? 'all', placementsTouched: touched, placements: arr.placements.length };
}

// Ripple delete: cut [a,b] from every lane and close the gap. Port of
// timeline.rippleDeleteRange: placements, markers, the cycle and lane/master
// automation after b move left by (b-a); clip envelopes travel with clips.
export function rippleDelete(p, a, b) {
  const arr = requireArrangement(p);
  checkRange(a, b);
  const gap = b - a;
  const all = arr.placements.map((_, i) => i);
  const touched = cutIndices(p, arr, all, a, b);
  for (const pl of arr.placements) if (pl.at >= b - 1e-6) pl.at = Math.max(a, pl.at - gap);
  for (const m of arr.markers ?? []) { if (m.t >= b) m.t -= gap; else if (m.t > a) m.t = a; }
  if (arr.markers) arr.markers = arr.markers.filter((m, i, ms) => ms.findIndex(k => Math.abs(k.t - m.t) < 1e-6) === i);
  if (arr.loop) {
    const sh = t => t >= b ? t - gap : t > a ? a : t;
    arr.loop.a = sh(arr.loop.a); arr.loop.b = sh(arr.loop.b);
    if (arr.loop.b - arr.loop.a < 0.05) arr.loop = null;
  }
  for (const env of arr.automation ?? []) {
    if (env.target?.startsWith('clip:')) continue;
    env.points = env.points.filter(pt => pt.t <= a || pt.t >= b).map(pt => pt.t >= b ? { ...pt, t: pt.t - gap } : pt);
  }
  if (arr.length) arr.length = Math.max(0, arr.length - gap);
  return { a, b, removedSeconds: r3(gap), placementsTouched: touched, length: songEnd(p) };
}

// -- lanes -------------------------------------------------------------------

export function addLane(p, { name, id, color } = {}) {
  const arr = requireArrangement(p);
  if (!arr.lanes?.length) arr.lanes = lanesOf(arr).map(l => ({ ...l }));
  const base = String(id ?? name ?? 'lane').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'lane';
  let lid = base, n = 2;
  while (arr.lanes.find(l => l.id === lid)) lid = `${base}-${n++}`;
  const lane = { id: lid, name: name ?? lid, gainDb: 0, mute: false, solo: false };
  if (color) lane.color = color;
  arr.lanes.push(lane);
  return { lane: { ...lane }, index: arr.lanes.length - 1 };
}

export function removeLane(p, ref) {
  const arr = requireArrangement(p);
  const l = resolveLane(p, ref);
  const before = arr.placements.length;
  arr.placements = arr.placements.filter(pl => pl.track !== l.id);
  arr.lanes = arr.lanes.filter(x => x.id !== l.id);
  const autoBefore = (arr.automation ?? []).length;
  if (arr.automation) arr.automation = arr.automation.filter(e => parseTarget(e.target)?.lane !== l.id);
  return { removed: l.id, placementsRemoved: before - arr.placements.length, envelopesRemoved: autoBefore - (arr.automation ?? []).length };
}

export function renameLane(p, ref, name) {
  if (!name) throw new Error("rename needs 'name'.");
  const l = resolveLane(p, ref);
  const from = l.name; l.name = String(name).slice(0, 60);
  return { lane: l.id, from, name: l.name };
}

export function setLane(p, ref, fields) {
  const l = resolveLane(p, ref);
  const changed = {};
  if (fields.gainDb !== undefined) changed.gainDb = l.gainDb = Math.max(-60, Math.min(12, +fields.gainDb));
  if (fields.pan !== undefined) changed.pan = l.pan = Math.max(-1, Math.min(1, +fields.pan));
  if (fields.mute !== undefined) changed.mute = l.mute = !!fields.mute;
  if (fields.solo !== undefined) changed.solo = l.solo = !!fields.solo;
  if (fields.color !== undefined) changed.color = l.color = String(fields.color);
  if (!Object.keys(changed).length) throw new Error("set needs any of: gainDb, pan, mute, solo, color.");
  return { lane: l.id, changed };
}

export function reorderLane(p, ref, index) {
  const arr = requireArrangement(p);
  const l = resolveLane(p, ref);
  const from = arr.lanes.indexOf(l);
  const to = Math.max(0, Math.min(arr.lanes.length - 1, Math.floor(index)));
  arr.lanes.splice(from, 1); arr.lanes.splice(to, 0, l);
  return { lane: l.id, from, to, order: arr.lanes.map(x => x.id) };
}

// -- markers -----------------------------------------------------------------

function markersOf(arr) { return (arr.markers ??= []); }
function sortMarkers(arr) { markersOf(arr).sort((a, b) => a.t - b.t); }
function resolveMarker(arr, ref) {
  const ms = markersOf(arr), s = String(ref ?? '');
  const m = ms.find(m => m.id === s) || ms.find(m => String(m.name).toLowerCase() === s.toLowerCase());
  if (!m) throw new Error(`No marker '${ref}'. Markers: ${ms.map(m => `"${m.name}" (${m.id})`).join(', ') || '(none)'}.`);
  return m;
}

export function listMarkers(p) {
  return { markers: markersOf(requireArrangement(p)).map(m => ({ id: m.id, t: r3(m.t), name: m.name })) };
}

export function addMarker(p, t, name) {
  const arr = requireArrangement(p);
  if (typeof t !== 'number') throw new Error("add needs 't' (song seconds).");
  const ms = markersOf(arr);
  let n = ms.length + 1, id = `m${n}`; while (ms.find(m => m.id === id)) id = `m${++n}`;
  const m = { id, t: Math.max(0, t), name: name ?? `Marker ${ms.length + 1}` };
  ms.push(m); sortMarkers(arr);
  return { marker: { ...m } };
}

export function moveMarker(p, ref, t) {
  const arr = requireArrangement(p);
  if (typeof t !== 'number') throw new Error("move needs 't' (song seconds).");
  const m = resolveMarker(arr, ref), from = m.t;
  m.t = Math.max(0, t); sortMarkers(arr);
  return { marker: m.id, from: r3(from), t: r3(m.t) };
}

export function renameMarker(p, ref, name) {
  if (!name) throw new Error("rename needs 'name'.");
  const m = resolveMarker(requireArrangement(p), ref), from = m.name;
  m.name = String(name);
  return { marker: m.id, from, name: m.name };
}

export function removeMarker(p, ref) {
  const arr = requireArrangement(p);
  const m = resolveMarker(arr, ref);
  arr.markers = arr.markers.filter(x => x !== m);
  return { removed: { ...m } };
}

// -- cycle -------------------------------------------------------------------

export function getCycle(p) {
  const L = requireArrangement(p).loop;
  return { cycle: L ? { a: r3(L.a), b: r3(L.b), on: !!L.on } : null };
}

export function setCycle(p, { a, b, on }) {
  const arr = requireArrangement(p);
  const L = arr.loop ?? {};
  const na = a ?? L.a, nb = b ?? L.b;
  if (na == null || nb == null) throw new Error("No cycle yet: set needs both 'a' and 'b' (song seconds).");
  if (!(nb - na >= 0.05) || na < 0) throw new Error(`Bad cycle a=${na}, b=${nb}: need 0 <= a and b - a >= 0.05.`);
  arr.loop = { ...L, a: na, b: nb, on: on ?? L.on ?? true };
  return getCycle(p);
}

export function clearCycle(p) {
  const arr = requireArrangement(p);
  const had = !!arr.loop; arr.loop = null;
  return { cleared: had, cycle: null };
}

// -- inserts -----------------------------------------------------------------

function insertOwner(p, lane) {
  const arr = requireArrangement(p);
  if (lane == null || String(lane).toLowerCase() === 'master') {
    arr.master ??= { inserts: [] }; arr.master.inserts ??= [];
    return { owner: arr.master, label: 'master' };
  }
  const l = resolveLane(p, lane);
  l.inserts ??= [];
  return { owner: l, label: l.id };
}

function effectDef(type) {
  try { return getEffectDef(type); } catch {
    throw new Error(`Unknown effect type '${type}'. Available: ${listEffectDefs().map(d => d.type).join(', ')}.`);
  }
}

// Validate a partial param map against the effect's schema: unknown keys
// throw, knobs clamp, selects must match an option value.
export function validateEffectParams(type, params = {}) {
  const def = effectDef(type), out = {};
  for (const [k, v] of Object.entries(params)) {
    const ps = def.params.find(x => x.key === k);
    if (!ps) throw new Error(`Effect '${type}' has no param '${k}'. Params: ${def.params.map(x => x.key).join(', ')}.`);
    if (ps.options) {
      const ok = ps.options.map(o => o.value ?? o);
      const hit = ok.find(o => o === v || String(o) === String(v));
      if (hit === undefined) throw new Error(`'${k}' must be one of: ${ok.join(', ')}.`);
      out[k] = hit;
    } else if (typeof v === 'number') out[k] = Math.max(ps.min ?? -Infinity, Math.min(ps.max ?? Infinity, v));
    else if (typeof v === 'boolean') out[k] = v;
    else throw new Error(`'${k}' must be a number.`);
  }
  return out;
}

function insertAt(owner, label, index) {
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i >= owner.inserts.length) {
    throw new Error(`Bad insert index ${index} on ${label}; it has ${owner.inserts.length} inserts.`);
  }
  return i;
}

const insertView = (x, i) => ({ index: i, type: x.type, bypass: !!x.bypass, params: { ...x.params } });

export function listInserts(p, lane) {
  const { owner, label } = insertOwner(p, lane);
  return { owner: label, inserts: owner.inserts.map(insertView), available: listEffectDefs().map(d => d.type) };
}

export function addInsert(p, lane, type, params) {
  if (!type) throw new Error(`add needs 'type'. Available: ${listEffectDefs().map(d => d.type).join(', ')}.`);
  const { owner, label } = insertOwner(p, lane);
  const ins = createInsert(type, validateEffectParams(type, params));
  owner.inserts.push(ins);
  return { owner: label, insert: insertView(ins, owner.inserts.length - 1) };
}

export function setInsert(p, lane, index, { params, bypass }) {
  const { owner, label } = insertOwner(p, lane);
  const i = insertAt(owner, label, index), ins = owner.inserts[i];
  if (params === undefined && bypass === undefined) throw new Error("set needs 'params' and/or 'bypass'.");
  if (params) ins.params = { ...ins.params, ...validateEffectParams(ins.type, params) };
  if (bypass !== undefined) ins.bypass = !!bypass;
  return { owner: label, insert: insertView(ins, i) };
}

export function removeInsert(p, lane, index) {
  const { owner, label } = insertOwner(p, lane);
  const i = insertAt(owner, label, index);
  const [gone] = owner.inserts.splice(i, 1);
  return { owner: label, removed: insertView(gone, i) };
}

export function moveInsert(p, lane, index, to) {
  const { owner, label } = insertOwner(p, lane);
  const i = insertAt(owner, label, index);
  const j = Math.max(0, Math.min(owner.inserts.length - 1, Math.floor(to)));
  const [x] = owner.inserts.splice(i, 1); owner.inserts.splice(j, 0, x);
  return { owner: label, from: i, to: j, order: owner.inserts.map(x => x.type) };
}

// -- automation --------------------------------------------------------------

// Normalise a target: lane refs may be names; resolve to ids.
export function normalizeTarget(p, target) {
  const tg = parseTarget(String(target ?? ''));
  if (!tg) throw new Error(`Bad target '${target}'. Grammar: lane:<lane>:gainDb | lane:<lane>:pan | master:gainDb | lane:<lane>:insert:<n>:<param> | clip:<clipId>:gainDb.`);
  let str;
  if (tg.kind === 'lane') {
    const l = resolveLane(p, tg.lane);
    str = tg.insert != null ? `lane:${l.id}:insert:${tg.insert}:${tg.param}` : `lane:${l.id}:${tg.param}`;
  } else if (tg.kind === 'clip') str = `clip:${resolveClip(p, tg.clip).id}:${tg.param}`;
  else str = `master:${tg.param}`;
  const range = rangeOf(str, p);
  if (!range) throw new Error(`Target '${str}' has no known range (use gainDb/pan, or an existing insert index and a param of that effect).`);
  return { target: str, range };
}

const envView = e => ({ target: e.target, points: e.points.map(pt => ({ t: r3(pt.t), v: r3(pt.v), ...(pt.shape && pt.shape !== 'linear' ? { shape: pt.shape } : {}) })) });

export function listAutomation(p, target) {
  const arr = requireArrangement(p);
  if (target) {
    const { target: t, range } = normalizeTarget(p, target);
    const e = findEnvelope(arr, t);
    return { ...(e ? envView(e) : { target: t, points: [] }), range };
  }
  return { envelopes: (arr.automation ?? []).map(envView) };
}

export function setAutomationPoints(p, target, points) {
  const arr = requireArrangement(p);
  if (!Array.isArray(points)) throw new Error("set_points needs 'points': [{t, v, shape?}].");
  const { target: t } = normalizeTarget(p, target);
  const e = ensureEnvelope(arr, t);
  e.points = [];
  for (const pt of [...points].sort((a, b) => a.t - b.t)) addPoint(e, pt.t, pt.v, p, pt.shape ?? 'linear');
  return envView(e);
}

export function addAutomationPoint(p, target, { t, v, shape }) {
  if (typeof t !== 'number' || typeof v !== 'number') throw new Error("add_point needs numeric 't' and 'v'.");
  const arr = requireArrangement(p);
  const { target: tg } = normalizeTarget(p, target);
  const e = ensureEnvelope(arr, tg);
  const pt = addPoint(e, t, v, p, shape ?? 'linear');
  return { target: tg, point: { t: r3(pt.t), v: r3(pt.v), shape: pt.shape }, points: e.points.length };
}

export function removeAutomationPoint(p, target, { index, t }) {
  const arr = requireArrangement(p);
  const { target: tg } = normalizeTarget(p, target);
  const e = findEnvelope(arr, tg);
  if (!e?.points.length) throw new Error(`Target '${tg}' has no points.`);
  let i = index;
  if (i == null && typeof t === 'number') {
    i = e.points.reduce((best, pt, k) => Math.abs(pt.t - t) < Math.abs(e.points[best].t - t) ? k : best, 0);
    if (Math.abs(e.points[i].t - t) > 0.05) throw new Error(`No point within 0.05s of t=${t} on '${tg}'.`);
  }
  if (!Number.isInteger(i) || i < 0 || i >= e.points.length) throw new Error(`remove_point needs 'index' (0-${e.points.length - 1}) or 't'.`);
  const [gone] = e.points.splice(i, 1);
  return { target: tg, removed: { t: r3(gone.t), v: r3(gone.v) }, points: e.points.length };
}

export function clearAutomation(p, target) {
  const arr = requireArrangement(p);
  const { target: tg } = normalizeTarget(p, target);
  const before = (arr.automation ?? []).length;
  arr.automation = (arr.automation ?? []).filter(e => e.target !== tg);
  return { target: tg, cleared: before !== arr.automation.length };
}

// -- words (asset transcripts, source seconds) -------------------------------

export function getWords(p, { asset, clip, from, to, limit = 200 } = {}) {
  let a, lo = -Infinity, hi = Infinity, c = null;
  if (clip != null) { c = resolveClip(p, clip); a = resolveAsset(p, c.sourceOf); lo = c.in; hi = c.out; }
  else if (asset != null) a = resolveAsset(p, asset);
  else throw new Error("words get needs 'asset' or 'clip'.");
  if (typeof from === 'number') lo = Math.max(lo, from);
  if (typeof to === 'number') hi = Math.min(hi, to);
  const all = (a.words ?? []).filter(w => w.e > lo && w.s < hi);
  const words = all.slice(0, Math.max(1, limit)).map(w => ({ s: r3(w.s), e: r3(w.e), t: w.t }));
  return { asset: a.id, clip: c?.id, total: all.length, returned: words.length, text: words.map(w => w.t).join(' '), words };
}

export function setWords(p, asset, words) {
  const a = resolveAsset(p, asset);
  if (!Array.isArray(words)) throw new Error("words set needs 'words': [{s, e, t}] in source seconds.");
  const clean = words.map((w, i) => {
    if (typeof w?.s !== 'number' || typeof w?.e !== 'number' || w.e < w.s || typeof w.t !== 'string') {
      throw new Error(`words[${i}] must be {s, e, t} with numeric s <= e and string t.`);
    }
    return { s: w.s, e: w.e, t: w.t };
  }).sort((x, y) => x.s - y.s);
  const before = a.words?.length ?? 0;
  a.words = clean;
  return { asset: a.id, before, words: clean.length };
}
