// Timeline: canvas arrangement view for v2 clip projects. Lanes per track,
// clip regions with cached waveform peaks, a seconds ruler, a playhead, and
// drag-to-move / edge-trim. Times are SECONDS throughout (the arrangement is
// seconds-based; only the pattern editors think in beats).
//
// Every project edit goes through a store action (core/store.js), which
// runs the pure edit in core/arrangement.js as one undo step and emits the
// bus events. Discrete edits (split, delete, marker add/rename, M/S) call the
// action directly. Drags (move, trim, slip, stretch, gain, marker, cycle,
// automation point) preview through store.gesturePreview() and end in ONE
// store.gestureCommit() on pointerup; a click that never moved commits
// nothing. See docs/ui-store-actions.md. Nothing here touches audio nodes.

import { el, openMenu } from './widgets.js';
import { AssetCache } from '../core/assets.js';
import { keymap } from '../core/keymap.js';
import { findEnvelope, targetOf, parseTarget, rangeOf, addPoint, valueAt } from '../engine/automation.js';
import { getEffectDef } from '../engine/effects/index.js';

const TICK_H = 22;   // time ticks + playhead handle
const MARKER_H = 16; // marker / section strip under the ticks
const RULER_H = TICK_H + MARKER_H;
const SECTION_COLORS = ['#5b8def', '#e3a13a', '#5ce0a8', '#c678dd', '#e06c75', '#56b6c2'];
const LANE_H = 64;
const GUTTER_W = 150;
const EDGE_PX = 6;
const SNAP_PX = 8;
const AUTO_H = 44;   // automation sub-lane height
const PT_R = 4;      // automation point radius
const LANE_COLORS = { bed: '#7aa2ff', vocal: '#5ce0a8', carl: '#ff8a4c' };
// Gutter hit zones (x from left), shared by paint + hit-test.
const BTN_Y = 31, BTN_H = 16; // A/M/S sit on the second row, right of the dB readout
const BTN = { a: [GUTTER_W - 72, 20], m: [GUTTER_W - 50, 20], s: [GUTTER_W - 28, 20] }; // [x, w]
const GAIN_Y = 40; // baseline of the dB readout; vertical drag over it sets gain

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}
function fmtTime(s) {
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}
// Seconds a clip occupies on the timeline (mirrors ClipPlayer.placedDuration).
function placedDur(clip) { return (clip.out - clip.in) * (clip.stretch ?? 1) / (clip.rate ?? 1); }

export class Timeline {
  constructor(host, app) {
    this.host = host;
    this.app = app;
    this.store = app.store;
    this.assetCache = app.assetCache ?? new AssetCache(app.engine?.ctx);
    this.active = false;
    this.dirty = true;

    this.pxPerSec = 4;
    this.scrollX = 0;
    this.selected = null;      // placement index
    this.drag = null;
    this.peaks = new Map();    // `${clipId}:${w}` -> Float32Array
    this.buffers = new Map();  // assetId:variant -> AudioBuffer

    host.className = 'timeline';
    host.style.cssText = 'position:relative;width:100%;height:100%;overflow:hidden;';
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;';
    this.g = this.canvas.getContext('2d');
    host.appendChild(this.canvas);

    this.canvas.addEventListener('pointerdown', e => this.onDown(e));
    // Double-click in the marker strip: rename the marker under the pointer,
    // or add one there. (pointerdown's e.detail is 0 in Chrome; use dblclick.)
    this.canvas.addEventListener('dblclick', e => {
      const { x, y } = this.pos(e);
      if (!(y >= TICK_H && y < RULER_H && x >= GUTTER_W)) return;
      const m = this.markerAt(x);
      if (m) { this.selectedMarker = m.id; this.renameMarker(m); }
      else { const nm = this.addMarker(this.snapTime(this.sec(x), { e })); this.selectedMarker = nm.id; this.renameMarker(nm, { amend: true }); }
      this.dirty = true;
    });
    // Right-click on an automation point: Linear / Hold / Exponential.
    this.canvas.addEventListener('contextmenu', e => {
      const { x, y } = this.pos(e);
      if (x < GUTTER_W || y < RULER_H) return;
      const li = this.laneIndexAt(y), sub = this.autoAt(li, y);
      if (!sub) return;
      e.preventDefault();
      const idx = this.autoPointAt(sub.target, sub.y0, x, y);
      if (idx >= 0) this.pointMenu(sub.target, idx, x, y);
    });
    this.canvas.addEventListener('pointermove', e => this.onMove(e));
    this.canvas.addEventListener('pointerup', e => this.onUp(e));
    this.canvas.addEventListener('pointercancel', e => this.onUp(e));
    this.canvas.addEventListener('wheel', e => this.onWheel(e), { passive: false });
    // Undo/redo swaps the project object under us. If the last action was a
    // delete, re-select the restored placement so ⌫ → ⌘Z leaves you where you were.
    app.bus.on('project:replaced', () => {
      this.peaks.clear();
      if (this.restoreSelOnUndo != null && this.arrangement?.placements[this.restoreSelOnUndo]) {
        this.selected = this.restoreSelOnUndo;
        this.app.bus.emit('clip:selected', { index: this.selected });
      } else if (this.selected != null && !this.arrangement?.placements[this.selected]) {
        this.selected = null;
      }
      this.restoreSelOnUndo = null;
      this.multi = [];
      this.dirty = true;
    });
    new ResizeObserver(() => {
      // Keep the song filling the width when the panel grows/shrinks, unless
      // the user has zoomed in on purpose (then just repaint).
      if (this.fitted) this.fitToWidth();
      // Panel got taller (mixer closed): don't leave lanes scrolled off the top.
      this.scrollY = Math.min(this.scrollY || 0, this.maxScrollY());
      this.dirty = true;
    }).observe(host);
  }

  // -- data -----------------------------------------------------------------

  get project() { return this.store.project; }
  get arrangement() { return this.project.arrangement; }

  setProject(project) {
    // Called on every editor route (undo, selection changes, loads). Only a
    // genuinely different document should reset view state; an undo of the
    // same song keeps zoom/scroll/selection (audit: ⌫ → ⌘Z lost selection,
    // and follow-mode was defeated by refit on every route).
    const key = project?.name + ':' + Object.keys(project?.assets || {}).join(',');
    const same = this.projectKey === key;
    this.projectKey = key;
    this.peaks.clear();
    if (!same) {
      this.buffers.clear();
      this.selected = null; this.multi = []; this.range = null;
      this.fitToWidth();
    } else if (this.selected != null && !this.arrangement?.placements[this.selected]) {
      this.selected = null;
    }
    this.decodeAll();
    this.dirty = true;
  }

  lanes() {
    const arr = this.arrangement;
    if (!arr) return [];
    if (arr.lanes?.length) return arr.lanes;
    const seen = [];
    for (const p of arr.placements) if (!seen.find(l => l.id === p.track)) seen.push({ id: p.track, name: p.track });
    return seen;
  }

  laneColor(lane) {
    if (typeof lane === 'string') lane = this.lanes().find(l => l.id === lane) || { id: lane };
    return lane.color || LANE_COLORS[lane.id] || cssVar('--accent', '#e33a41');
  }

  // Lane mix state lives on arrangement.lanes[] (persisted with the doc).
  // Lanes discovered from placements (legacy docs, no lanes[] entry) are
  // materialised by the store action on their first edit (resolveLane).
  laneAudible(lane) {
    const anySolo = this.lanes().some(l => l.solo);
    return anySolo ? !!lane.solo : !lane.mute;
  }

  bufferKey(clip) { return `${clip.sourceOf}:${clip.representation ?? ''}`; }

  decodeAll() {
    const arr = this.arrangement;
    if (!arr) return;
    for (const p of arr.placements) {
      const clip = this.project.clips[p.clip];
      if (!clip) continue;
      const key = this.bufferKey(clip);
      if (this.buffers.has(key)) continue;
      this.buffers.set(key, null); // in flight
      this.assetCache.getBuffer(this.project, clip.sourceOf, clip.representation)
        .then(buf => { this.buffers.set(key, buf); this.dirty = true; })
        .catch(err => { console.warn('timeline decode failed', clip.id, err); this.buffers.delete(key); });
    }
  }

  // Waveform peaks for [clip.in, clip.out) at `w` px, computed on the decoded
  // buffer directly (mono-summed max-abs per bin) and memoised per clip+width.
  peaksFor(clip, w) {
    const key = `${clip.id}:${w}:${clip.in.toFixed(3)}:${clip.out.toFixed(3)}`;
    if (this.peaks.has(key)) return this.peaks.get(key);
    const buf = this.buffers.get(this.bufferKey(clip));
    if (!buf) return null;
    const sr = buf.sampleRate;
    const a = Math.floor(clip.in * sr), b = Math.min(buf.length, Math.floor(clip.out * sr));
    const n = Math.max(1, b - a), bins = Math.max(1, Math.floor(w));
    const out = new Float32Array(bins);
    const chans = [];
    for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c));
    for (let i = 0; i < bins; i++) {
      const s0 = a + Math.floor(i * n / bins), s1 = a + Math.floor((i + 1) * n / bins);
      let m = 0;
      for (let s = s0; s < s1; s += 4) { // stride: peaks, not accuracy
        let v = 0;
        for (const ch of chans) v += ch[s];
        v = Math.abs(v / chans.length);
        if (v > m) m = v;
      }
      out[i] = m;
    }
    this.peaks.set(key, out);
    return out;
  }

  // -- geometry -------------------------------------------------------------

  fitToWidth() {
    const w = Math.max(200, this.host.clientWidth - GUTTER_W - 8);
    const len = this.arrangement?.length || 60;
    this.pxPerSec = w / len;
    this.scrollX = 0;
    this.fitted = true; // cleared by any manual zoom/scroll
  }
  // Farthest scrollX that still shows the song's end plus a little runout.
  maxScrollX() {
    const len = this.arrangement?.length || 60;
    const view = this.host.clientWidth - GUTTER_W;
    return Math.max(0, len * this.pxPerSec + 40 - view);
  }
  // Keep `sec` visible: page the view when the playhead runs off the right
  // edge (DAW follow mode), or nudge it back in when it's off the left.
  follow(sec) {
    const view = this.host.clientWidth - GUTTER_W;
    const x = sec * this.pxPerSec - this.scrollX;
    if (x > view - 20) this.scrollX = Math.min(this.maxScrollX(), sec * this.pxPerSec - view * 0.15);
    else if (x < 0) this.scrollX = Math.max(0, sec * this.pxPerSec - view * 0.15);
  }
  x(sec) { return GUTTER_W + (sec * this.pxPerSec) - this.scrollX; }
  sec(x) { return (x - GUTTER_W + this.scrollX) / this.pxPerSec; }

  // -- snap -------------------------------------------------------------------
  // Sticky by default: a candidate time within SNAP_PX of a target pulls to
  // it. Targets: other placements' edges (any lane), playhead, range edges,
  // and the grid (beats at project bpm when snapGrid='beat', or whole
  // seconds). `exclude` is the placement index being dragged. Held
  // timeline.noSnap gesture or snap off => identity.
  get snapOn() { return this.store.ui.snap !== 0 && this.store.ui.snapOn !== false; }
  snapTargets(exclude = null) {
    const t = [];
    const arr = this.arrangement; if (!arr) return t;
    arr.placements.forEach((p, i) => {
      if (i === exclude) return;
      const c = this.project.clips[p.clip]; if (!c) return;
      t.push(p.at, p.at + placedDur(c));
    });
    t.push(this.app.transport.songPos);
    if (this.range) t.push(this.range.a, this.range.b);
    return t;
  }
  snapTime(sec, { exclude = null, e = null, extraLen = 0 } = {}) {
    if (!this.snapOn || (e && keymap.gesture('timeline.noSnap', e))) return sec;
    const tol = SNAP_PX / this.pxPerSec;
    let best = sec, bestD = tol;
    // Object targets: snap the dragged clip's START or END to them.
    for (const tgt of this.snapTargets(exclude)) {
      for (const cand of [tgt, tgt - extraLen]) {
        const d = Math.abs(cand - sec);
        if (d < bestD) { bestD = d; best = cand; }
      }
    }
    // Grid: beats at bpm (snap value in beats from store.ui.snap), else seconds.
    const div = this.store.ui.snap; // beats; 0 = off
    if (div > 0) {
      const beat = 60 / (this.project.bpm || 120) * div;
      const g = Math.round(sec / beat) * beat;
      if (Math.abs(g - sec) < bestD) { bestD = Math.abs(g - sec); best = g; }
    }
    this.snapHit = bestD < tol ? best : null;
    return Math.max(0, best);
  }
  // -- layout: lanes are LANE_H tall, plus AUTO_H per open automation
  // sub-lane. this.autoOpen is a Set of TARGET strings (lane:<id>:gainDb,
  // lane:<id>:pan, lane:<id>:insert:<n>:<param>); each open target of a lane
  // stacks one sub-lane under it, in the order it was opened. laneY /
  // laneIndexAt / autoAt are the only geometry anyone should use.
  autoTargets(lane) {
    if (!this.autoOpen?.size) return [];
    const out = [];
    for (const t of this.autoOpen) {
      const tg = parseTarget(t);
      if (!tg || tg.kind !== 'lane' || tg.lane !== lane.id) continue;
      if (!rangeOf(t, this.project)) continue; // insert removed / unknown param
      out.push(t);
    }
    return out;
  }
  laneY(i) {
    let y = RULER_H - (this.scrollY || 0);
    const ls = this.lanes();
    for (let k = 0; k < i && k < ls.length; k++) y += this.laneH(ls[k]);
    return y;
  }
  laneH(lane) { return LANE_H + this.autoTargets(lane).length * AUTO_H; }
  // Total height of all lane rows + the "+ lane" row, for vertical scroll bounds.
  contentH() { return this.lanes().reduce((h, l) => h + this.laneH(l), 0) + 28; }
  maxScrollY() { return Math.max(0, this.contentH() - (this.host.clientHeight - RULER_H)); }
  // Index of the lane whose ROW (clip part + automation part) contains py.
  laneIndexAt(py) {
    if (py < RULER_H) return -1;
    let y = RULER_H - (this.scrollY || 0);
    const ls = this.lanes();
    for (let i = 0; i < ls.length; i++) { const h = this.laneH(ls[i]); if (py < y + h) return i; y += h; }
    return ls.length; // below the last lane
  }
  // The automation sub-lane of lane i under py: {target, y0, k} or null.
  autoAt(i, py) {
    const l = this.lanes()[i]; if (!l) return null;
    const ts = this.autoTargets(l); if (!ts.length) return null;
    const k = Math.floor((py - this.laneY(i) - LANE_H) / AUTO_H);
    if (k < 0 || k >= ts.length) return null;
    return { target: ts[k], y0: this.laneY(i) + LANE_H + k * AUTO_H, k };
  }
  // Is py inside one of lane i's automation sub-lanes?
  inAutoPart(i, py) { return !!this.autoAt(i, py); }

  // Display info for an automation target: range (from the engine's
  // rangeOf), log mapping for log-curve effect params, gutter label, unit.
  autoInfo(target) {
    const r = rangeOf(target, this.project) ?? { min: -60, max: 12, default: 0 };
    const tg = parseTarget(target);
    const info = { min: r.min, max: r.max, default: r.default, log: false, unit: r.unit ?? '', label: tg?.param ?? target };
    if (tg?.insert != null) {
      const spec = this.arrangement?.lanes?.find(l => l.id === tg.lane)?.inserts?.[tg.insert];
      try {
        const def = getEffectDef(spec.type), p = def.params.find(q => q.key === tg.param);
        info.log = p?.curve === 'log' && r.min > 0; info.unit = p?.unit ?? '';
        // Short gutter label: 'EQ · Low Gain', 'EQ · HP Freq', 'EQ · Mid Q'.
        const fx = def.label.replace(/\s*\(.*?\)\s*/g, '').trim(), pl = p?.label ?? tg.param;
        info.label = `${fx} · ${p?.group && !/\s/.test(pl) ? p.group.split(/[\s-]/)[0] + ' ' : ''}${pl}`;
        info.full = `${def.label} · ${p?.group ? p.group + ' ' : ''}${pl}`;
      } catch { /* keep defaults */ }
    } else if (tg?.param === 'gainDb') info.label = 'gain';
    else if (tg?.param === 'pan') info.label = 'pan';
    return info;
  }
  // value <-> 0..1 (bottom..top) on a target's axis.
  autoFrac(info, v) {
    const f = info.log ? Math.log(v / info.min) / Math.log(info.max / info.min) : (v - info.min) / (info.max - info.min);
    return Math.max(0, Math.min(1, f));
  }
  autoVal(info, f) {
    f = Math.max(0, Math.min(1, f));
    const v = info.log ? info.min * Math.pow(info.max / info.min, f) : info.min + f * (info.max - info.min);
    const span = info.max - info.min;
    const q = info.log ? Math.pow(10, Math.floor(Math.log10(Math.max(1e-9, v))) - 2) : span >= 20 ? 0.1 : span >= 2 ? 0.01 : 0.001;
    return Number((Math.round(v / q) * q).toFixed(Math.max(0, -Math.floor(Math.log10(q)))));
  }
  fmtAuto(info, v) {
    const a = Math.abs(v);
    const s = a >= 1000 ? (v / 1000).toFixed(a >= 10000 ? 0 : 1) + 'k' : a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2).replace(/\.?0+$/, '');
    return (v > 0 && info.min < 0 ? '+' : '') + s;
  }

  // Lane under a canvas point (any x), for drops from the asset bin.
  laneAt(px, py) {
    if (py < RULER_H) return null;
    const i = this.laneIndexAt(py);
    const lane = this.lanes()[i];
    return lane ? { lane, index: i } : null;
  }

  // Overlaps on a lane: [{lane, a, b, lower, upper}] where lower/upper are
  // placement indices (earlier-start / later-start). Derived every call;
  // cheap at these sizes. An overlap is selectable like a clip.
  overlaps(laneId = null) {
    const out = [], arr = this.arrangement; if (!arr) return out;
    for (const lane of this.lanes()) {
      if (laneId && lane.id !== laneId) continue;
      const ps = [];
      arr.placements.forEach((p, i) => { if (p.track !== lane.id) return; const c = this.project.clips[p.clip]; if (c) ps.push({ i, at: p.at, end: p.at + placedDur(c) }); });
      ps.sort((x, y) => x.at - y.at);
      for (let k = 1; k < ps.length; k++) {
        const a = Math.max(ps[k].at, ps[k - 1].at), b = Math.min(ps[k].end, ps[k - 1].end);
        if (b > a + 1e-6) out.push({ lane: lane.id, a, b, lower: ps[k - 1].i, upper: ps[k].i });
      }
    }
    return out;
  }
  overlapAt(px, py) {
    const lh = this.laneAt(px, py); if (!lh || px < GUTTER_W) return null;
    const t = this.sec(px);
    return this.overlaps(lh.lane.id).find(o => t >= o.a && t <= o.b) ?? null;
  }
  selectOverlap(o) {
    this.clearAssetSel();
    if (this.selectedLane != null) { this.selectedLane = null; this.app.bus.emit('lane:selected', { id: null }); }
    if (this.selected != null) { this.selected = null; this.app.bus.emit('clip:selected', { index: null }); }
    this.multi = [];
    this.selectedOverlap = o;
    this.app.bus.emit('overlap:selected', { overlap: o });
    this.dirty = true;
  }

  // y of an automation value inside a sub-lane starting at y0, on the
  // target's own axis (dB for gain, -1..1 for pan, the effect param's range).
  autoY(y0, v, info = this.autoInfo('lane:_:gainDb')) { return y0 + 4 + (1 - this.autoFrac(info, v)) * (AUTO_H - 8); }
  // value at py inside a sub-lane starting at y0 (inverse of autoY).
  autoV(y0, py, info) { return this.autoVal(info, 1 - (py - y0 - 4) / (AUTO_H - 8)); }
  // Index of the envelope point of `target` near (x, y) in sub-lane y0, or -1.
  autoPointAt(target, y0, x, y) {
    const env = findEnvelope(this.arrangement, target); if (!env) return -1;
    const info = this.autoInfo(target);
    return env.points.findIndex(p => Math.hypot(this.x(p.t) - x, this.autoY(y0, p.v, info) - y) <= PT_R + 3);
  }
  // A-button menu: Gain, Pan, then every param of every insert on the lane.
  autoMenuItems(lane) {
    const items = [], add = (label, target) => items.push({
      label, checked: !!this.autoOpen?.has(target),
      onPick: () => { this.autoOpen ??= new Set(); this.autoOpen.has(target) ? this.autoOpen.delete(target) : this.autoOpen.add(target); this.dirty = true; },
    });
    add('Gain', targetOf('lane', lane.id, 'gainDb'));
    add('Pan', targetOf('lane', lane.id, 'pan'));
    (this.arrangement?.lanes?.find(l => l.id === lane.id)?.inserts ?? []).forEach((spec, n) => {
      let def; try { def = getEffectDef(spec.type); } catch { return; }
      const knobs = def.params.filter(p => typeof p.min === 'number' && typeof p.max === 'number' && p.type !== 'select');
      if (knobs.length) items.push({ label: `${def.label}${spec.bypass ? ' (bypassed)' : ''}`.toUpperCase(), disabled: true });
      for (const p of knobs) add(`${def.label} · ${p.group ? p.group + ' ' : ''}${p.label}`, targetOf('lane', lane.id, p.key, n));
    });
    return items;
  }
  // Does lane have envelopes with points that are not currently shown?
  hasHiddenAuto(lane) {
    return (this.arrangement?.automation ?? []).some(a => {
      if (!a.points?.length || this.autoOpen?.has(a.target)) return false;
      const tg = parseTarget(a.target); return tg?.kind === 'lane' && tg.lane === lane.id;
    });
  }
  // Right-click on an automation point: shape menu.
  pointMenu(target, idx, cx, cy) {
    const env = findEnvelope(this.arrangement, target); const p = env?.points?.[idx]; if (!p) return;
    const cur = p.shape ?? 'linear';
    const probe = addPoint({ target, points: [] }, 0, p.v, this.project, 'exp');
    const expOk = !probe.shapeCoerced;
    const set = (shape) => {
      if (cur === shape) return;
      this.store.automationMovePoint(target, idx, { shape });
      this.dirty = true;
    };
    const r = this.canvas.getBoundingClientRect();
    const anchor = { getBoundingClientRect: () => ({ left: r.left + cx, right: r.left + cx, top: r.top + cy, bottom: r.top + cy }) };
    openMenu(anchor, [
      { label: 'Linear', checked: cur === 'linear', onPick: () => set('linear') },
      { label: 'Hold', checked: cur === 'hold', onPick: () => set('hold') },
      { label: 'Exponential', checked: cur === 'exp', disabled: !expOk, title: expOk ? '' : 'Exponential needs a range that stays above zero; this parameter reaches 0 (or silence), so the engine would play it as linear.', onPick: () => set('exp') },
    ]);
  }

  hit(px, py) {
    const arr = this.arrangement;
    if (!arr || py < RULER_H || px < GUTTER_W) return null;
    const laneIdx = this.laneIndexAt(py);
    const lane = this.lanes()[laneIdx];
    if (!lane || this.inAutoPart(laneIdx, py)) return null;
    // Two passes: bodies first (the clip the pointer is actually over), then
    // edges. Without this, the EDGE_PX halo of clip B stole the right edge
    // of an adjacent clip A when the two were < 2*EDGE_PX apart and B was
    // later in the array -- a stretch on A silently trimmed B (audit blocker).
    let best = null;
    for (let i = arr.placements.length - 1; i >= 0; i--) {
      const p = arr.placements[i];
      if (p.track !== lane.id) continue;
      const clip = this.project.clips[p.clip];
      if (!clip) continue;
      const x0 = this.x(p.at), x1 = this.x(p.at + placedDur(clip));
      if (px < x0 - EDGE_PX || px > x1 + EDGE_PX) continue;
      const inside = px >= x0 && px <= x1;
      const w = x1 - x0;
      // Tiny clips (< 3*EDGE_PX): the middle third is body so they can still be moved.
      const eL = Math.min(EDGE_PX, w / 3), eR = Math.min(EDGE_PX, w / 3);
      const edge = px <= x0 + eL ? 'left' : px >= x1 - eR ? 'right' : 'body';
      const cand = { index: i, placement: p, clip, edge, inside };
      if (inside) return cand;          // pointer is over this clip: it wins
      if (!best) best = cand;           // else remember the first halo hit
    }
    return best;
  }

  // Split the selected clip at the playhead into two virtual clips that
  // reference the same source. Nothing is copied; both halves keep their
  // stretch/pitch. Registered on the S key by app.js.
  splitAtPlayhead() {
    const arr = this.arrangement;
    if (!arr || this.selected == null) return false;
    const p = arr.placements[this.selected];
    const clip = this.project.clips[p.clip];
    const t = this.app.transport.getPosition().sec ?? this.app.transport.songPos;
    const dur = placedDur(clip);
    if (t <= p.at + 0.02 || t >= p.at + dur - 0.02) return false;
    this.store.clipSplit(this.selected, t);
    this.peaks.clear();
    this.app.bus.emit('clip:selected', { index: this.selected });
    this.dirty = true;
    return true;
  }

  // -- interaction ----------------------------------------------------------

  // Lane selection is exclusive with clip selection (one inspector target).
  selectLane(id) {
    if (this.selected != null) { this.selected = null; this.app.bus.emit('clip:selected', { index: null }); }
    this.clearAssetSel();
    if (this.selectedLane === id) return;
    this.selectedLane = id;
    this.app.bus.emit('lane:selected', { id });
    this.dirty = true;
  }
  clearAssetSel() {
    const bin = this.app.assetBin;
    if (bin?.selectedAsset) { bin.selectedAsset = null; bin.render(); this.app.bus.emit('asset:selected', { id: null }); }
  }

  // Keyboard edits on the selected clip. `semitones` is a decoupled pitch
  // shift (vocoder, length unchanged); `gainDb` is per-clip trim.
  nudgeSelected(delta, field) {
    if (this.selected == null) return;
    const clip = this.project.clips[this.arrangement.placements[this.selected].clip];
    if (!clip) return;
    const v = Math.round(((clip[field] ?? 0) + delta) * 10) / 10;
    this.store.clipSet(clip.id, { [field]: Math.abs(v) < 1e-6 ? null : v });
    this.dirty = true;
  }

  deleteSelected() {
    if (this.selected == null) return;
    const idx = this.selected;
    this.selected = null;
    this.store.clipRemove(idx); // clip record stays; it's a reference
    this.restoreSelOnUndo = idx; // undo puts it back at the same index; reselect it
    this.app.bus.emit('clip:selected', { index: null });
    this.dirty = true;
  }

  pos(e) { const r = this.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

  onDown(e) {
    const { x, y } = this.pos(e);
    // Marker strip (under the ticks): markers are flags, the band between
    // two markers is a section.
    const hadMarker = this.selectedMarker; this.selectedMarker = null;
    if (y >= TICK_H && y < RULER_H && x >= GUTTER_W) {
      const m = this.markerAt(x);
      if (m) { // select + (maybe) drag to move
        this.canvas.setPointerCapture(e.pointerId);
        this.selectedMarker = m.id;
        this.drag = { edge: 'marker', markerId: m.id, t0: m.t, startX: x, armed: false };
      } else { // click in a section band: jump to its start
        const ms = this.markers(), t = this.sec(x);
        const sec = [...ms].reverse().find(k => k.t <= t);
        if (sec) this.app.transport.songPos = sec.t;
        if (sec && keymap.gesture('timeline.rangeSelect', e)) { // ⇧-click: select the whole section as the range
          const nx = ms[ms.indexOf(sec) + 1]?.t ?? this.app.transport.arrangementEnd();
          this.range = { a: sec.t, b: nx }; this.app.bus.emit('range:changed', {});
        }
      }
      if (hadMarker !== this.selectedMarker) this.app.bus.emit('marker:selected', { id: this.selectedMarker });
      this.dirty = true; return;
    }
    if (hadMarker) this.app.bus.emit('marker:selected', { id: null });
    // Cycle bar (top 7 px of the tick row): drag an edge to resize, drag the
    // middle to move, click toggles on/off.
    const loop = this.arrangement?.loop;
    if (loop && y < 8 && x >= GUTTER_W) {
      const xa = this.x(loop.a), xb = this.x(loop.b);
      if (x >= xa - EDGE_PX && x <= xb + EDGE_PX) {
        this.canvas.setPointerCapture(e.pointerId);
        const part = Math.abs(x - xa) <= EDGE_PX ? 'a' : Math.abs(x - xb) <= EDGE_PX ? 'b' : 'mid';
        this.drag = { edge: 'loop', part, a0: loop.a, b0: loop.b, startX: x, armed: false };
        return;
      }
    }
    // Ruler: press-and-drag scrubs the playhead. ⇧-drag sets a time range
    // instead. If playing, stop, scrub, and resume from the release point.
    if (y < RULER_H && x >= GUTTER_W) {
      this.canvas.setPointerCapture(e.pointerId);
      const px = this.x(this.app.transport.songPos);
      // Range edges on the ruler are grab handles: drag either to resize --
      // unless the playhead is there, in which case the playhead wins.
      if (this.range && !keymap.gesture('timeline.rangeSelect', e) && Math.abs(x - px) > EDGE_PX) {
        const xa = this.x(this.range.a), xb = this.x(this.range.b);
        if (Math.abs(x - xa) <= EDGE_PX) { this.drag = { edge: 'range', anchor: this.range.b }; return; }
        if (Math.abs(x - xb) <= EDGE_PX) { this.drag = { edge: 'range', anchor: this.range.a }; return; }
      }
      if (keymap.gesture('timeline.rangeSelect', e)) {
        this.prevRange = this.range; // what a no-drag ⇧-click extends from
        // ⇧-press anchors HERE. If it turns into a drag, the range is
        // press→cursor. If it's released without moving (a ⇧-click), onUp
        // reinterprets it as "extend from the playhead / nearest range edge
        // to here" so click-then-⇧-click works without a drag.
        const t = Math.max(0, this.sec(x));
        this.range = { a: t, b: t };
        this.drag = { edge: 'range', anchor: t, pressT: t, moved: false };
        this.dirty = true;
        return;
      }
      // Plain ruler press: scrub. The range stays (Esc clears it) so you can
      // audition inside a selection without losing it.
      const wasPlaying = this.app.transport.playing;
      if (wasPlaying) this.app.transport.stop();
      this.app.transport.songPos = Math.max(0, this.sec(x));
      this.drag = { edge: 'scrub', wasPlaying };
      this.dirty = true;
      return;
    }
    // The playhead line itself (through the lanes) is grabbable too, and so
    // are the range's edges down through the lanes -- same drags as the ruler.
    // Playhead wins over range edges: it usually sits ON one right after a
    // range is set, and grabbing it must always scrub.
    if (x >= GUTTER_W && y >= RULER_H) {
      const px = this.x(this.app.transport.songPos);
      if (Math.abs(x - px) <= 4 && !keymap.gesture('timeline.rangeSelect', e)) {
        this.canvas.setPointerCapture(e.pointerId);
        const wasPlaying = this.app.transport.playing;
        if (wasPlaying) this.app.transport.stop();
        this.drag = { edge: 'scrub', wasPlaying };
        return;
      }
      if (this.range) {
        const xa = this.x(this.range.a), xb = this.x(this.range.b);
        if (Math.abs(x - xa) <= 4) { this.canvas.setPointerCapture(e.pointerId); this.drag = { edge: 'range', anchor: this.range.b }; return; }
        if (Math.abs(x - xb) <= 4) { this.canvas.setPointerCapture(e.pointerId); this.drag = { edge: 'range', anchor: this.range.a }; return; }
      }
    }
    // Checked before the lane gutter, which returns early when no lane is hit.
    // Below the last lane in the gutter: "+ lane".
    if (x < GUTTER_W && y >= this.laneY(this.lanes().length) && y <= this.laneY(this.lanes().length) + 28) {
      this.app.assetBin?.newLane();
      return;
    }
    // Gutter: M / S buttons, the gain readout (vertical drag), or the lane
    // name (select the lane -> inspector shows its properties).
    if (x < GUTTER_W && y >= RULER_H) {
      const li = this.laneIndexAt(y), lane = this.lanes()[li];
      if (!lane) return;
      const ly = y - this.laneY(li);
      const inBtn = (b) => x >= b[0] && x <= b[0] + b[1] && ly >= BTN_Y - 2 && ly <= BTN_Y + BTN_H + 2;
      if (inBtn(BTN.a)) {
        // Parameter picker: each pick toggles one automation sub-lane.
        const r = this.canvas.getBoundingClientRect(), by = this.laneY(li) + BTN_Y + BTN_H;
        const anchor = { getBoundingClientRect: () => ({ left: r.left + BTN.a[0], right: r.left + BTN.a[0] + BTN.a[1], top: r.top + by - BTN_H, bottom: r.top + by }) };
        openMenu(anchor, this.autoMenuItems(lane));
        return;
      }
      // Sub-lane gutter: the small x closes that sub-lane.
      const sub = this.autoAt(li, y);
      if (sub) {
        if (x >= GUTTER_W - 22 && y >= sub.y0 + 2 && y <= sub.y0 + 18) { this.autoOpen.delete(sub.target); this.dirty = true; }
        return;
      }
      if (inBtn(BTN.m) || inBtn(BTN.s)) {
        this.store.laneSet(lane.id, inBtn(BTN.m) ? { mute: !lane.mute } : { solo: !lane.solo });
        this.dirty = true;
        return;
      }
      if (ly >= GAIN_Y - 10 && ly <= GAIN_Y + 12) {
        this.canvas.setPointerCapture(e.pointerId);
        this.drag = { edge: 'gain', laneId: lane.id, startY: y, g0: lane.gainDb ?? 0, armed: false };
        return;
      }
      // Name area: click selects the lane; a vertical drag REORDERS it.
      // (The dB bar below is the gain drag; the two zones don't overlap.)
      this.canvas.setPointerCapture(e.pointerId);
      this.drag = { edge: 'reorder', laneId: lane.id, from: li, startY: y, to: li, armed: false };
      return;
    }
    // Automation sub-lane: click adds a point (snapped), drag moves one,
    // ⌥-click removes. Values are dB on a -60..+12 vertical scale.
    if (x >= GUTTER_W) {
      const li = this.laneIndexAt(y), lane = this.lanes()[li];
      const sub = lane ? this.autoAt(li, y) : null;
      if (sub) {
        if (e.button === 2) return; // right-click: the contextmenu handler owns it
        this.canvas.setPointerCapture(e.pointerId);
        const y0 = sub.y0, info = this.autoInfo(sub.target);
        const vOf = (py) => this.autoV(y0, py, info);
        const hitIdx = this.autoPointAt(sub.target, y0, x, y);
        if (hitIdx >= 0 && e.altKey) { this.store.automationRemovePoint(sub.target, { index: hitIdx }); this.dirty = true; return; }
        // Click on empty sub-lane = add a point (committed on pointerup, with
        // any drag of it, as one undo step); click on a point = drag it.
        let idx = hitIdx, baseOps = [];
        this.store.gestureBegin();
        if (idx < 0) {
          baseOps = [['addAutomationPoint', sub.target, { t: this.snapTime(this.sec(x), { e }), v: vOf(y) }]];
          idx = this.store.gesturePreview(baseOps)[0].index;
        }
        this.drag = { edge: 'auto', target: sub.target, idx, li, y0, vOf, baseOps, ops: [], armed: true };
        this.dirty = true;
        return;
      }
    }
    const h = this.hit(x, y);
    // An overlap region is its own target: clicking inside the shared span
    // of two clips selects the *overlap* (crossfade editing), not either clip.
    // Drag from an overlap does nothing; grab a clip outside the span to move it.
    if (!this.range) {
      const o = this.overlapAt(x, y);
      if (o && h && h.inside) { this.selectOverlap(o); return; }
    }
    if (this.selectedOverlap) { this.selectedOverlap = null; this.app.bus.emit('overlap:selected', { overlap: null }); }
    // With a range set, clicking inside it on a lane selects that lane's
    // slice (every clip overlapping the range) -- even if the click lands on
    // a clip body. Drag from here is a no-op; edit the range via S / ⌫.
    if (this.range && x >= GUTTER_W) {
      const laneHit = this.laneAt(x, y), t = this.sec(x);
      if (laneHit && t >= this.range.a && t <= this.range.b) {
        this.clearAssetSel();
        if (this.selectedLane != null) { this.selectedLane = null; this.app.bus.emit('lane:selected', { id: null }); }
        this.multi = this.clipsInRange(laneHit.lane.id);
        this.selected = this.multi[0] ?? null;
        this.app.bus.emit('clip:selected', { index: this.selected });
        this.dirty = true;
        return;
      }
    }
    if (!h) {
      this.multi = [];
      if (this.selected != null) { this.selected = null; this.app.bus.emit('clip:selected', { index: null }); }
      if (this.selectedLane != null) { this.selectedLane = null; this.app.bus.emit('lane:selected', { id: null }); }
      if (x >= GUTTER_W) this.app.transport.songPos = Math.max(0, this.sec(x)); // seek
      this.dirty = true;
      return;
    }
    this.canvas.setPointerCapture(e.pointerId);
    // Checkpoint lazily: only once the drag actually changes something.
    // A plain click-to-select must not burn an undo slot (audit).
    this.clearAssetSel();
    this.multi = [];
    if (this.selectedLane != null) { this.selectedLane = null; this.app.bus.emit('lane:selected', { id: null }); }
    if (this.selected !== h.index) { this.selected = h.index; this.app.bus.emit('clip:selected', { index: h.index }); }
    // ⌥ on the right edge = time-stretch (pitch preserved) instead of trim.
    // ⇧ on the body = slip: move the audio inside the clip, edges stay put.
    const edge = (h.edge === 'right' && keymap.gesture('timeline.clipStretch', e)) ? 'stretch' : (h.edge === 'body' && keymap.gesture('timeline.clipSlip', e)) ? 'slip' : h.edge;
    // ⌥ on the body = duplicate: the copy is made on the first real movement
    // (so ⌥-click alone doesn't clone), then the drag moves the COPY.
    const dup = h.edge === 'body' && edge === 'body' && keymap.gesture('timeline.clipDuplicate', e);
    this.drag = { ...h, edge, dup, startX: x, startY: this.pos(e).y, lane0: h.placement.track, at0: h.placement.at, in0: h.clip.in, out0: h.clip.out, st0: h.clip.stretch ?? 1 };
    this.dirty = true;
  }

  // Placement indices on a lane overlapping the current range.
  clipsInRange(laneId) {
    const r = this.range, arr = this.arrangement;
    if (!r || !arr) return [];
    const out = [];
    arr.placements.forEach((p, i) => {
      if (p.track !== laneId) return;
      const c = this.project.clips[p.clip]; if (!c) return;
      const end = p.at + placedDur(c);
      if (end > r.a && p.at < r.b) out.push(i);
    });
    return out;
  }

  // Split every selected clip at the range edges (or the playhead if no range).
  // Range edges that fall inside a clip cut it; edges outside are ignored.
  splitSelectionAtRange() {
    if (!this.range) return this.splitAtPlayhead();
    const targets = this.multi.length ? [...this.multi] : (this.selected != null ? [this.selected] : []);
    if (!targets.length) return false;
    this.multi = [];
    this.selected = null;
    this.store.clipSplitMany(targets, [this.range.b, this.range.a]);
    this.peaks.clear();
    this.app.bus.emit('clip:selected', { index: null });
    this.dirty = true;
    return true;
  }

  // Remove the range's slice from every selected clip, leaving a gap.
  deleteRangeFromSelection() {
    if (!this.range) return this.deleteSelected();
    const targets = this.multi.length ? [...this.multi] : (this.selected != null ? [this.selected] : []);
    if (!targets.length) return false;
    const { a, b } = this.range;
    this.multi = []; this.selected = null;
    this.store.clipCutRange(targets, a, b);
    this.peaks.clear();
    this.app.bus.emit('clip:selected', { index: null });
    this.dirty = true;
    return true;
  }

  // Ripple delete: cut [a,b] out of EVERY lane and close the gap — everything
  // after b moves left by (b-a): placements, markers, the cycle, and
  // automation points. Logic "Cut Section Between Locators", REAPER "ripple
  // edit all tracks" ("Ripple edit all affects envelopes on all tracks"
  // [reaper_userguide.txt:6108]). One undo step.
  rippleDeleteRange() {
    if (!this.range || this.range.b - this.range.a < 0.01) return false;
    if (!this.arrangement) return false;
    const { a, b } = this.range;
    this.range = null; this.multi = []; this.selected = null;
    this.store.rangeRippleDelete(a, b); // emits arrangement, loop and range changes
    this.app.transport.songPos = a;
    this.peaks.clear();
    this.app.bus.emit('clip:selected', { index: null });
    this.dirty = true;
    return true;
  }

  onMove(e) {
    const { x, y } = this.pos(e);
    if (!this.drag) {
      const h = this.hit(x, y);
      this.hoverLane = this.range && x >= GUTTER_W && y >= RULER_H ? this.laneAt(x, y)?.lane.id ?? null : null;
      if (this.range) this.dirty = true;
      // Gutter: pointer over M/S/+lane, ns-resize over the gain bar.
      if (x < GUTTER_W && y >= RULER_H) {
        const li = this.laneIndexAt(y), ly = y - this.laneY(li);
        const overBtn = li < this.lanes().length && ly >= BTN_Y - 2 && ly <= BTN_Y + BTN_H + 2 && [BTN.a, BTN.m, BTN.s].some(b => x >= b[0] && x <= b[0] + b[1]);
        const overGain = li < this.lanes().length && ly >= GAIN_Y - 10 && ly <= GAIN_Y + 12;
        const overAdd = li === this.lanes().length && ly <= 28;
        this.canvas.style.cursor = overGain ? 'ns-resize' : (overBtn || overAdd) ? 'pointer' : li < this.lanes().length ? 'grab' : 'default';
        return;
      }
      // Playhead line / range edges through the lanes: resize cursors.
      if (x >= GUTTER_W && y >= RULER_H) {
        const near = (t) => Math.abs(x - this.x(t)) <= 4;
        if ((this.range && (near(this.range.a) || near(this.range.b))) || near(this.app.transport.songPos)) { this.canvas.style.cursor = 'ew-resize'; return; }
      }
      this.canvas.style.cursor = (y < RULER_H && x >= GUTTER_W) ? 'ew-resize' : !h ? 'default' : h.edge === 'body' ? (keymap.gesture('timeline.clipSlip', e) ? 'move' : 'grab') : (h.edge === 'right' && keymap.gesture('timeline.clipStretch', e)) ? 'col-resize' : 'ew-resize';
      return;
    }
    const d = this.drag, ds = (x - d.startX) / this.pxPerSec;
    if (d.edge === 'range') {
      const t = this.snapTime(Math.max(0, this.sec(x)), { e });
      if (Math.abs(t - d.pressT) > 0.5 / this.pxPerSec) d.moved = true;
      this.range = { a: Math.min(d.anchor, t), b: Math.max(d.anchor, t) };
      this.dirty = true;
      return;
    }
    if (d.edge === 'scrub') {
      this.app.transport.songPos = this.snapTime(Math.max(0, this.sec(x)), { e });
      this.dirty = true;
      return;
    }
    if (d.edge === 'auto') {
      d.ops = [['moveAutomationPoint', d.target, d.idx, { t: this.snapTime(this.sec(x), { e }), v: d.vOf(y) }]];
      this.preview(d.ops);
      this.dirty = true;
      return;
    }
    if (d.edge === 'loop') {
      if (!d.armed && Math.abs(x - d.startX) < 3) return;
      if (!d.armed) { this.store.gestureBegin(); d.armed = true; }
      const L = this.arrangement.loop, ds = (x - d.startX) / this.pxPerSec;
      let a = L.a, b = L.b;
      if (d.part === 'a') a = Math.min(this.snapTime(Math.max(0, d.a0 + ds), { e }), L.b - 0.1);
      else if (d.part === 'b') b = Math.max(this.snapTime(d.b0 + ds, { e }), L.a + 0.1);
      else { const len = d.b0 - d.a0; a = this.snapTime(Math.max(0, d.a0 + ds), { e }); b = a + len; }
      d.ops = [['setCycle', { a, b }]];
      this.preview(d.ops);
      this.dirty = true;
      return;
    }
    if (d.edge === 'marker') {
      if (!d.armed && Math.abs(x - d.startX) < 3) return;
      if (!d.armed) { this.store.gestureBegin(); d.armed = true; }
      d.ops = [['moveMarker', d.markerId, this.snapTime(Math.max(0, d.t0 + (x - d.startX) / this.pxPerSec), { e })]];
      this.preview(d.ops);
      this.dirty = true;
      return;
    }
    if (d.edge === 'reorder') {
      if (!d.armed && Math.abs(y - d.startY) < 4) return; // still a click
      d.armed = true;
      this._reorderY = y;
      // Drop slot = the row boundary nearest the pointer.
      const ls = this.lanes(); let best = 0, bestD = Infinity;
      for (let i = 0; i <= ls.length; i++) { const by = this.laneY(i); const dd = Math.abs(y - by); if (dd < bestD) { bestD = dd; best = i; } }
      d.to = best;
      this.dirty = true;
      return;
    }
    if (d.edge === 'gain') {
      // 1 px = 0.25 dB, up is louder; range -60..+12. Live-previewed.
      if (!d.armed && Math.abs(y - d.startY) < 1) return;
      if (!d.armed) { this.store.gestureBegin(); d.armed = true; }
      const g = Math.max(-60, Math.min(12, d.g0 + (d.startY - y) * 0.25));
      d.ops = [['setLane', d.laneId, { gainDb: Math.round(g * 10) / 10 }]];
      this.preview(d.ops, ['lanes:changed']);
      this.dirty = true;
      return;
    }
    const asset = this.project.assets[d.clip.sourceOf];
    const maxOut = asset?.duration ?? Infinity;
    if (!d.armed) {
      // Arm on horizontal OR vertical movement (a straight-down lane move is a drag too).
      if (Math.abs(x - d.startX) < 3 && Math.abs(y - (d.startY ?? y)) < 3) return; // click, not a drag yet
      this.store.gestureBegin(); d.armed = true;
      if (d.dup) {
        // Copy clip + placement (store op, replayed on commit); the drag
        // continues on the copy. The original stays exactly where it was.
        d.baseOps = [['copyPlacement', d.index]];
        d.index = this.store.gesturePreview(d.baseOps)[0].index;
        d.placement = this.arrangement.placements[d.index]; d.clip = this.project.clips[d.placement.clip];
        this.selected = d.index; this.app.bus.emit('clip:selected', { index: d.index });
      }
    }
    const cid = d.clip.id;
    if (d.edge === 'body') {
      const len = placedDur(d.clip);
      const at = this.snapTime(Math.max(0, d.at0 + ds), { exclude: d.index, e, extraLen: len });
      // Vertical: move to the lane under the pointer (clip part only; the
      // gutter / automation sub-lanes / "+ lane" row don't capture it).
      const li = this.laneIndexAt(y), lane = this.lanes()[li];
      // Name the lane only when it differs from the start (or a preview moved
      // it and the pointer came back), so a plain move never touches lanes[].
      const laneTo = lane && (lane.id !== d.lane0 || d.placement.track !== d.lane0) ? lane.id : null;
      d.ops = [['movePlacement', d.index, laneTo ? { at, lane: laneTo } : { at }]];
    } else if (d.edge === 'slip') {
      // Move the source window under a fixed placement: in/out shift
      // together, clamped to the asset. Drag RIGHT = the waveform moves right
      // with your hand, i.e. earlier audio slides into the window (in decreases).
      const len = d.out0 - d.in0, st = (d.clip.stretch ?? 1) / (d.clip.rate ?? 1);
      const nin = Math.max(0, Math.min(maxOut - len, d.in0 - ds / st));
      d.ops = [['clipSet', cid, { in: nin, out: nin + len }]];
      this.peaks.clear();
    } else if (d.edge === 'stretch') {
      // New placed length / source length = stretch. Clamp 0.25x..4x.
      const srcLen = d.out0 - d.in0, want = srcLen * d.st0 + ds;
      const stv = Math.round(Math.max(0.25, Math.min(4, want / srcLen)) * 1000) / 1000;
      d.ops = [['clipSet', cid, { stretch: Math.abs(stv - 1) < 0.005 ? null : stv }]];
      this.peaks.clear();
    } else if (d.edge === 'left') {
      // Trim in-point; keep the right edge fixed in song time. Snap the
      // new left edge in song time, then map back to source. The left edge
      // stops at song time 0 (a placement can't start before the song).
      const st = (d.clip.stretch ?? 1) / (d.clip.rate ?? 1);
      const wantAt = this.snapTime(d.at0 + ds, { exclude: d.index, e });
      const nin = Math.min(Math.max(0, d.in0 - d.at0 / st, d.in0 + (wantAt - d.at0) / st), d.out0 - 0.05);
      d.ops = [['clipSet', cid, { in: nin }], ['movePlacement', d.index, { at: d.at0 + (nin - d.in0) * st }]];
    } else {
      const st = (d.clip.stretch ?? 1) / (d.clip.rate ?? 1);
      const wantEnd = this.snapTime(d.at0 + (d.out0 - d.in0) * st + ds, { exclude: d.index, e });
      d.ops = [['clipSet', cid, { out: Math.max(d.in0 + 0.05, Math.min(maxOut, d.in0 + (wantEnd - d.at0) / st)) }]];
    }
    this.preview(d.ops);
    this.dirty = true;
  }

  // Live drag preview through the store (no history). A frame the pure
  // function rejects is skipped; the last good preview stays on screen.
  // Only a preview that applied is remembered as what pointerup commits.
  preview(ops, events) {
    try { this.store.gesturePreview(ops, events); if (this.drag) this.drag.good = ops; return true; } catch { return false; }
  }
  // End a drag: the whole gesture becomes ONE store action / undo step.
  commitGesture(d, events) {
    if (!this.store.inGesture) return; // an undo/load mid-drag ended it
    try { this.store.gestureCommit([...(d.baseOps ?? []), ...(d.good ?? [])], events); }
    catch (err) { console.warn('[timeline] gesture rejected:', err.message); }
  }

  onUp(e) {
    if (!this.drag) return;
    // Honour the release position (a fast flick can release past the last
    // move event).
    if (this.drag.edge === 'range' || this.drag.edge === 'scrub') this.onMove(e);
    try { this.canvas.releasePointerCapture(e.pointerId); } catch {}
    const d = this.drag;
    this.drag = null;
    this.snapHit = null;
    if (d.edge === 'range') {
      if (d.pressT != null && !d.moved) {
        // ⇧-click without a drag: extend from the previous range's far edge
        // (if the click was outside it) or from the playhead to the click.
        const t = d.pressT, prev = this.prevRange;
        const anchor = prev
          ? (Math.abs(t - prev.a) > Math.abs(t - prev.b) ? prev.a : prev.b)
          : this.app.transport.songPos;
        this.range = Math.abs(anchor - t) < 0.02 ? null : { a: Math.min(anchor, t), b: Math.max(anchor, t) };
      } else if (this.range && this.range.b - this.range.a < 0.02) this.range = null;
      if (this.range) this.app.transport.songPos = this.range.a;
      this.prevRange = this.range;
      this.dirty = true;
      return;
    }
    if (d.edge === 'scrub') {
      if (d.wasPlaying) this.app.transport.play();
      this.dirty = true;
      return;
    }
    if (d.edge === 'loop') {
      if (!d.armed) this.store.cycleSet({ on: !this.arrangement.loop.on }); // a click toggles
      else this.commitGesture(d, ['loop:changed', 'arrangement:changed']);
      this.app.transport.armLoop?.();
      this.dirty = true;
      return;
    }
    if (d.edge === 'marker') {
      if (d.armed) this.commitGesture(d, ['arrangement:changed']);
      this.dirty = true;
      return;
    }
    if (d.edge === 'auto') {
      this.commitGesture(d, ['arrangement:changed']); // a click on a point: no ops, no history
      this.dirty = true;
      return;
    }
    if (d.edge === 'reorder') {
      if (!d.armed) { this.selectLane(d.laneId); this.dirty = true; return; } // it was a click
      // Move lanes[from] to slot `to` (slot indexes count boundaries, so a
      // drop below the source shifts by one after removal).
      let to = d.to > d.from ? d.to - 1 : d.to;
      if (to !== d.from) this.store.laneReorder(d.laneId, to);
      this.dirty = true;
      return;
    }
    if (!d.armed) { this.dirty = true; return; } // plain click: nothing changed
    this.commitGesture(d, d.edge === 'gain' ? ['lanes:changed', 'arrangement:changed'] : ['arrangement:changed']);
    this.dirty = true;
  }

  onWheel(e) {
    e.preventDefault();
    if (keymap.gesture('timeline.zoom', e) || e.ctrlKey) { // ctrl: trackpad pinch arrives as ctrl+wheel
      const { x } = this.pos(e);
      const anchor = this.sec(x);
      this.pxPerSec = Math.max(0.5, Math.min(400, this.pxPerSec * (e.deltaY < 0 ? 1.1 : 0.9)));
      this.scrollX = anchor * this.pxPerSec - (x - GUTTER_W);
      this.fitted = false;
    } else if (e.shiftKey || (Math.abs(e.deltaX) > Math.abs(e.deltaY))) {
      // Horizontal: trackpad sideways, or ⇧-wheel on a mouse.
      this.scrollX += (e.deltaX || e.deltaY);
      this.fitted = false;
    } else {
      // Vertical: scroll the lanes when they don't fit (mixer open, many
      // lanes, automation sub-lanes). Ruler stays pinned.
      this.scrollY = Math.max(0, Math.min(this.maxScrollY(), (this.scrollY || 0) + e.deltaY));
    }
    this.scrollX = Math.max(0, Math.min(this.maxScrollX(), this.scrollX));
    this.dirty = true;
  }

  // -- paint ----------------------------------------------------------------

  onFrame(pos) {
    if (!this.active) return;
    const playing = !!pos?.playing;
    if (playing && !this.drag && this.store.ui.follow !== false) this.follow(pos.sec);
    if (playing || this.dirty) this.paint(pos?.sec ?? null, playing);
  }
  // Zoom about the playhead (toolbar / keys); wheel zoom is about the cursor.
  zoomBy(f) {
    const anchor = this.app.transport.songPos;
    const view = this.host.clientWidth - GUTTER_W;
    const ax = anchor * this.pxPerSec - this.scrollX;
    this.pxPerSec = Math.max(0.5, Math.min(400, this.pxPerSec * f));
    this.scrollX = anchor * this.pxPerSec - ax;
    this.fitted = false;
    this.scrollX = Math.max(0, Math.min(this.maxScrollX(), this.scrollX));
    void view;
    this.dirty = true;
  }

  paint(playheadSec = null, playing = false) {
    const dpr = window.devicePixelRatio || 1;
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    if (this.canvas.width !== w * dpr || this.canvas.height !== h * dpr) {
      this.canvas.width = w * dpr; this.canvas.height = h * dpr;
    }
    const g = this.g;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = cssVar('--bg-0', '#0b0d12');
    g.fillRect(0, 0, w, h);

    const arr = this.arrangement;
    const lanes = this.lanes();
    const text = cssVar('--text', '#dbe1f0'), faint = cssVar('--text-faint', '#3a4154');
    const line = cssVar('--line-soft', '#1b2030'), accent = cssVar('--accent', '#e33a41');

    // lanes (clipped below the ruler so a scrolled-up lane never paints over it)
    g.save(); g.beginPath(); g.rect(0, RULER_H, w, h - RULER_H); g.clip();
    this.paintLanes(g, w, h, lanes, arr, { text, faint, line, accent });
    g.restore();

    // ruler (painted after the lanes so it stays on top)
    g.fillStyle = cssVar('--bg-1', '#11141c'); g.fillRect(GUTTER_W, 0, w - GUTTER_W, RULER_H);
    g.fillStyle = cssVar('--bg-1', '#11141c'); g.fillRect(0, 0, GUTTER_W, RULER_H);
    g.font = '11px system-ui, sans-serif'; g.textBaseline = 'middle';
    const s0 = Math.max(0, Math.floor(this.sec(GUTTER_W) / 5) * 5), s1 = this.sec(w);
    for (let s = s0; s <= s1; s += 5) {
      const x = this.x(s);
      const major = s % 30 === 0;
      g.fillStyle = major ? faint : line; g.fillRect(x, major ? 4 : 12, 1, TICK_H - (major ? 4 : 12));
      if (major) { g.fillStyle = text; g.fillText(fmtTime(s), x + 3, 10); }
    }
    g.fillStyle = line; g.fillRect(GUTTER_W, TICK_H - 1, w - GUTTER_W, 1);
    // Cycle region: a bar across the top of the tick row (yellow when on,
    // grey when off), like Logic's cycle area. Drag its edges to resize.
    const loop = this.arrangement?.loop;
    if (loop) {
      const xa = Math.max(GUTTER_W, this.x(loop.a)), xb = Math.min(w, this.x(loop.b));
      if (xb > xa) {
        g.fillStyle = loop.on ? '#e3c13a' : faint; g.globalAlpha = loop.on ? 0.85 : 0.6;
        g.fillRect(xa, 0, xb - xa, 5); g.globalAlpha = 1;
        g.fillRect(xa, 0, 2, 9); g.fillRect(xb - 2, 0, 2, 9);
      }
    }
    this.paintMarkers(g, w, { text, faint, line, accent });
    g.fillStyle = line; g.fillRect(0, RULER_H - 1, w, 1);
    // vertical scroll hint: a thin thumb on the right edge when content overflows
    const maxSY = this.maxScrollY();
    if (maxSY > 0) {
      const trackH = h - RULER_H, viewH = this.host.clientHeight - RULER_H;
      const thumbH = Math.max(24, trackH * viewH / this.contentH()), thumbY = RULER_H + (trackH - thumbH) * ((this.scrollY || 0) / maxSY);
      g.fillStyle = 'rgba(255,255,255,0.14)'; g.fillRect(w - 5, thumbY, 3, thumbH);
    }
    this.paintOverlays(g, w, h, playheadSec, playing, { accent });
  }

  // -- markers / sections --------------------------------------------------
  // arrangement.markers = [{id, t, name, color?}], sorted by t. A marker's
  // SECTION runs to the next marker (or the song end). Stored in seconds,
  // like everything else in v2; v3 may add a tempo map above it.
  markers() { return this.arrangement?.markers ?? []; }
  // Add a marker (one undo step) and return the live record.
  addMarker(t, name) {
    const { marker } = this.store.markerAdd(t, name);
    this.dirty = true;
    return this.markers().find(m => m.id === marker.id);
  }
  markerAt(x) {
    let best = null, bd = 7;
    for (const m of this.markers()) { const d = Math.abs(this.x(m.t) - x); if (d < bd) { bd = d; best = m; } }
    return best;
  }
  deleteSelectedMarker() {
    const ms = this.markers(), i = ms.findIndex(m => m.id === this.selectedMarker);
    if (i < 0) return false;
    const id = this.selectedMarker; this.selectedMarker = null;
    this.store.markerRemove(id);
    this.app.bus.emit('marker:selected', { id: null }); this.dirty = true;
  }
  markerNav(dir) {
    const ms = this.markers(), t = this.app.transport.songPos;
    const m = dir > 0 ? ms.find(k => k.t > t + 0.01) : [...ms].reverse().find(k => k.t < t - 0.01);
    if (!m) return false;
    this.app.transport.songPos = m.t; this.follow?.(m.t); this.dirty = true;
  }
  // Inline rename: an <input> over the marker strip at the marker's x.
  // Enter / blur commit (one undo step; none if unchanged), Esc cancels.
  // `amend`: the marker was just added (double-click-to-add), so the name is
  // folded into that add's undo step: add + name is a single undo step.
  renameMarker(m, { amend = false } = {}) {
    this.markerEdit?.cancel();
    const inp = document.createElement('input');
    inp.type = 'text'; inp.className = 'marker-edit'; inp.value = m.name ?? ''; inp.spellcheck = false;
    inp.setAttribute('aria-label', 'Marker name');
    const x = Math.max(GUTTER_W, this.x(m.t) + 3);
    inp.style.left = x + 'px'; inp.style.top = TICK_H + 'px';
    inp.style.width = Math.max(80, Math.min(220, this.canvas.clientWidth - x - 4)) + 'px';
    let done = false;
    const finish = (commit) => {
      if (done) return; done = true;
      this.markerEdit = null;
      const name = inp.value.trim();
      inp.remove();
      if (commit && name && name !== m.name) {
        if (amend) this.store.arrangementAmend([['renameMarker', m.id, name]]);
        else this.store.markerRename(m.id, name);
      }
      this.dirty = true;
      this.canvas.focus?.();
    };
    inp.addEventListener('keydown', e => {
      e.stopPropagation(); // typing a name must not fire transport shortcuts
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    inp.addEventListener('blur', () => finish(true));
    this.host.appendChild(inp);
    this.markerEdit = { input: inp, marker: m, cancel: () => finish(false) };
    inp.focus(); inp.select();
  }
  paintMarkers(g, w, { text, faint, accent }) {
    const ms = this.markers(), y0 = TICK_H, end = this.app.transport?.arrangementEnd?.() ?? 0;
    g.fillStyle = cssVar('--bg-0', '#0b0d12'); g.fillRect(GUTTER_W, y0, w - GUTTER_W, MARKER_H);
    g.save(); g.beginPath(); g.rect(GUTTER_W, y0, w - GUTTER_W, MARKER_H); g.clip();
    g.font = '10px system-ui, sans-serif'; g.textBaseline = 'middle';
    ms.forEach((m, i) => {
      const x = this.x(m.t), x2 = this.x(ms[i + 1]?.t ?? Math.max(end, m.t));
      const col = m.color || SECTION_COLORS[i % SECTION_COLORS.length];
      // section band (alternating tint) + flag
      g.fillStyle = col; g.globalAlpha = 0.16; g.fillRect(x, y0, Math.max(0, x2 - x), MARKER_H); g.globalAlpha = 1;
      g.fillStyle = col; g.fillRect(x, y0, 2, MARKER_H);
      const sel = this.selectedMarker === m.id;
      g.fillStyle = sel ? '#fff' : text;
      g.fillText(m.name, x + 5, y0 + MARKER_H / 2, Math.max(20, x2 - x - 8));
    });
    if (!ms.length) { g.fillStyle = faint; g.fillText('double-click or M to add a marker', GUTTER_W + 6, y0 + MARKER_H / 2); }
    g.restore();
    // gutter label
    g.fillStyle = cssVar('--bg-1', '#11141c'); g.fillRect(0, y0, GUTTER_W, MARKER_H);
    g.fillStyle = faint; g.font = '10px system-ui, sans-serif'; g.fillText('MARKERS', 8, y0 + MARKER_H / 2);
  }

  paintLanes(g, w, h, lanes, arr, { text, faint, line, accent }) {
    // lanes
    lanes.forEach((lane, i) => {
      const y = this.laneY(i);
      const audible = this.laneAudible(lane);
      const col = this.laneColor(lane);
      g.fillStyle = line; g.fillRect(0, y + LANE_H - 1, w, 1);
      g.fillStyle = lane.id === this.selectedLane ? cssVar('--bg-2', '#171b26') : cssVar('--bg-1', '#11141c'); g.fillRect(0, y, GUTTER_W, LANE_H - 1);
      if (lane.id === this.selectedLane) { g.strokeStyle = col; g.lineWidth = 1; g.strokeRect(0.5, y + 0.5, GUTTER_W - 1, LANE_H - 2); }
      g.fillStyle = col; g.globalAlpha = audible ? 1 : 0.35; g.fillRect(0, y, 3, LANE_H - 1); g.globalAlpha = 1;
      g.fillStyle = audible ? text : faint; g.font = '12px system-ui, sans-serif';
      // Name: row 1, the full gutter width (ellipsized only if it truly won't fit).
      {
        const maxW = GUTTER_W - 10 - 8, full = lane.name || lane.id;
        let s = full;
        if (g.measureText(s).width > maxW) { while (s.length > 1 && g.measureText(s + '…').width > maxW) s = s.slice(0, -1); s += '…'; }
        g.fillText(s, 10, y + 17);
      }
      // A / M / S buttons: row 2, right of the dB readout
      const btn = (b, label, on, onCol) => {
        g.fillStyle = on ? onCol : cssVar('--bg-2', '#171b26'); g.fillRect(b[0], y + BTN_Y, b[1], BTN_H);
        g.strokeStyle = on ? onCol : line; g.strokeRect(b[0] + 0.5, y + BTN_Y + 0.5, b[1] - 1, BTN_H - 1);
        g.fillStyle = on ? '#0b0d12' : text; g.font = 'bold 10px system-ui, sans-serif';
        g.textAlign = 'center'; g.fillText(label, b[0] + b[1] / 2, y + BTN_Y + BTN_H / 2 + 0.5); g.textAlign = 'left';
      };
      btn(BTN.a, 'A', this.autoTargets(lane).length > 0, col);
      if (this.hasHiddenAuto(lane)) { g.fillStyle = '#e3a13a'; g.beginPath(); g.arc(BTN.a[0] + BTN.a[1] - 3, y + BTN_Y + 3, 2.5, 0, Math.PI * 2); g.fill(); }
      btn(BTN.m, 'M', !!lane.mute, '#e3a13a');
      btn(BTN.s, 'S', !!lane.solo, '#5ce0a8');
      // gain readout (drag vertically)
      const db = lane.gainDb ?? 0;
      g.fillStyle = faint; g.font = '11px system-ui, sans-serif';
      g.fillText(`${db > 0 ? '+' : ''}${db.toFixed(1)} dB`, 10, y + GAIN_Y + 4);
      const meterW = GUTTER_W - 20, frac = Math.max(0, Math.min(1, (db + 60) / 72));
      g.fillStyle = line; g.fillRect(10, y + GAIN_Y + 12, meterW, 3);
      g.fillStyle = col; g.fillRect(10, y + GAIN_Y + 12, meterW * frac, 3);
      // dim the whole lane's clip area when inaudible
      if (!audible) { g.fillStyle = 'rgba(11,13,18,0.55)'; g.fillRect(GUTTER_W, y, w - GUTTER_W, LANE_H - 1); }
      // automation sub-lanes: one per open target, stacked under the lane.
      this.autoTargets(lane).forEach((target, k) => {
        const y0 = y + LANE_H + k * AUTO_H, info = this.autoInfo(target);
        g.fillStyle = cssVar('--bg-0', '#0b0d12'); g.fillRect(0, y0, w, AUTO_H);
        g.fillStyle = cssVar('--bg-1', '#11141c'); g.fillRect(0, y0, GUTTER_W, AUTO_H);
        g.fillStyle = col; g.globalAlpha = 0.5; g.fillRect(0, y0, 3, AUTO_H - 1); g.globalAlpha = 1;
        g.fillStyle = text; g.font = '10px system-ui, sans-serif';
        {
          const maxW = GUTTER_W - 10 - 26; let s = info.label;
          if (g.measureText(s).width > maxW) { while (s.length > 1 && g.measureText(s + '…').width > maxW) s = s.slice(0, -1); s += '…'; }
          g.fillText(s, 10, y0 + 13);
        }
        // close x
        g.fillStyle = faint; g.textAlign = 'center'; g.font = '12px system-ui, sans-serif'; g.fillText('×', GUTTER_W - 13, y0 + 13); g.textAlign = 'left';
        g.fillStyle = faint; g.font = '9px system-ui, sans-serif';
        g.fillText(this.fmtAuto(info, info.max) + (info.unit ? ' ' + info.unit : ''), 10, y0 + 26);
        g.fillText(this.fmtAuto(info, info.min), 10, y0 + AUTO_H - 4);
        g.fillStyle = line; g.fillRect(0, y0 + AUTO_H - 1, w, 1);
        const refV = info.min < 0 && info.max > 0 ? 0 : info.default;
        if (refV != null) {
          const zeroY = this.autoY(y0, refV, info);
          g.strokeStyle = 'rgba(255,255,255,0.12)'; g.setLineDash([3, 4]); g.beginPath(); g.moveTo(GUTTER_W, zeroY); g.lineTo(w, zeroY); g.stroke(); g.setLineDash([]);
        }
        const env = findEnvelope(arr, target);
        g.save(); g.beginPath(); g.rect(GUTTER_W, y0, w - GUTTER_W, AUTO_H); g.clip();
        if (env?.points?.length) {
          const Y = v => this.autoY(y0, v, info), P = env.points;
          g.strokeStyle = col; g.lineWidth = 1.5; g.beginPath();
          g.moveTo(GUTTER_W, Y(P[0].v)); g.lineTo(this.x(P[0].t), Y(P[0].v));
          // Each segment follows its START point's shape (engine valueAt).
          for (let j = 0; j + 1 < P.length; j++) {
            const a = P[j], b = P[j + 1], xa = this.x(a.t), xb = this.x(b.t), shape = a.shape ?? 'linear';
            if (xb < GUTTER_W || xa > w) { g.moveTo(xb, Y(b.v)); continue; }
            if (shape === 'hold') { g.lineTo(xb, Y(a.v)); g.lineTo(xb, Y(b.v)); }
            else if (shape === 'exp') {
              const n = Math.max(2, Math.min(200, Math.ceil((xb - xa) / 3)));
              for (let q = 1; q <= n; q++) { const t = a.t + (b.t - a.t) * q / n; g.lineTo(this.x(t), Y(valueAt(env, Math.min(t, b.t - 1e-6)))); }
              g.lineTo(xb, Y(b.v));
            } else g.lineTo(xb, Y(b.v));
          }
          g.lineTo(w, Y(P[P.length - 1].v));
          g.stroke();
          for (const p of P) {
            const px = this.x(p.t), py = Y(p.v);
            g.fillStyle = cssVar('--bg-0', '#0b0d12'); g.beginPath(); g.arc(px, py, PT_R + 1, 0, Math.PI * 2); g.fill();
            g.fillStyle = col; g.beginPath();
            if ((p.shape ?? 'linear') === 'hold') g.rect(px - PT_R, py - PT_R, PT_R * 2, PT_R * 2);
            else g.arc(px, py, PT_R, 0, Math.PI * 2);
            g.fill();
          }
        } else {
          g.fillStyle = faint; g.font = '10px system-ui, sans-serif'; g.fillText('click to add a point · drag to move · ⌥-click removes · right-click a point for its shape', GUTTER_W + 8, y0 + 14);
        }
        g.restore();
      });
    });
    // "+ lane" affordance under the last lane
    {
      const y = this.laneY(lanes.length);
      g.fillStyle = cssVar('--bg-1', '#11141c'); g.fillRect(0, y, GUTTER_W, 28);
      g.fillStyle = faint; g.font = '11px system-ui, sans-serif'; g.fillText('+ lane', 10, y + 14);
    }

    // time range: band across all lanes; the hovered lane's slice brighter
    if (this.range) {
      const xa = Math.max(GUTTER_W, this.x(this.range.a)), xb = Math.min(w, this.x(this.range.b));
      if (xb > xa) {
        g.fillStyle = 'rgba(255,255,255,0.07)'; g.fillRect(xa, RULER_H, xb - xa, h - RULER_H);
        g.fillStyle = accent; g.globalAlpha = 0.5; g.fillRect(xa, 0, xb - xa, RULER_H); g.globalAlpha = 1;
        const hi = lanes.findIndex(l => l.id === this.hoverLane);
        if (hi >= 0) { g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(xa, this.laneY(hi), xb - xa, LANE_H - 1); }
        g.fillStyle = accent; g.fillRect(xa, RULER_H, 1, h - RULER_H); g.fillRect(xb - 1, RULER_H, 1, h - RULER_H);
      }
    }

    // clips
    if (arr) {
      g.save(); g.beginPath(); g.rect(GUTTER_W, RULER_H, w - GUTTER_W, h - RULER_H); g.clip();
      arr.placements.forEach((p, idx) => {
        const li = lanes.findIndex(l => l.id === p.track);
        const clip = this.project.clips[p.clip];
        if (li < 0 || !clip) return;
        const y = this.laneY(li) + 4, ch = LANE_H - 9;
        const x0 = this.x(p.at), x1 = this.x(p.at + placedDur(clip));
        if (x1 < GUTTER_W || x0 > w) return;
        const col = this.laneColor(lanes[li]);
        const audible = this.laneAudible(lanes[li]);
        g.fillStyle = col; g.globalAlpha = audible ? 0.28 : 0.12; g.fillRect(x0, y, x1 - x0, ch);
        g.globalAlpha = 1;
        const pk = this.peaksFor(clip, Math.max(1, Math.round(x1 - x0)));
        if (pk) {
          g.fillStyle = col; g.globalAlpha = audible ? 1 : 0.4; const mid = y + ch / 2, amp = ch / 2 - 2;
          for (let i = 0; i < pk.length; i++) { const v = pk[i] * amp; g.fillRect(x0 + i, mid - v, 1, Math.max(1, v * 2)); }
          g.globalAlpha = 1;
        }
        const isSel = idx === this.selected || (this.multi && this.multi.includes(idx));
        g.strokeStyle = isSel ? '#ffffff' : col; g.lineWidth = isSel ? 2 : 1;
        g.strokeRect(x0 + 0.5, y + 0.5, x1 - x0 - 1, ch - 1);
        g.fillStyle = text; g.font = '11px system-ui, sans-serif';
        g.save(); g.beginPath(); g.rect(x0, y, Math.max(0, x1 - x0), ch); g.clip();
        const tags = [];
        if (clip.stretch && Math.abs(clip.stretch - 1) > 0.005) tags.push(`×${clip.stretch.toFixed(2)}`);
        if (clip.semitones) tags.push(`${clip.semitones > 0 ? '+' : ''}${clip.semitones}st`);
        if (clip.rate && clip.rate !== 1) tags.push(`rate ${clip.rate.toFixed(2)}`);
        if (clip.gainDb) tags.push(`${clip.gainDb > 0 ? '+' : ''}${clip.gainDb}dB`);
        g.fillText((clip.name || clip.id) + (tags.length ? '  ' + tags.join(' ') : ''), x0 + 5, y + 9); g.restore();
      });
      g.restore();
      // Overlaps: where two placements on one lane cover the same time, hatch
      // the shared span so it's visible. It's also a selectable region (the
      // crossfade); the selected one gets a solid outline.
      g.save(); g.beginPath(); g.rect(GUTTER_W, RULER_H, w - GUTTER_W, h - RULER_H); g.clip();
      for (const o of this.overlaps()) {
        const li = lanes.findIndex(l => l.id === o.lane); if (li < 0) continue;
        const x0 = this.x(o.a), x1 = this.x(o.b), y = this.laneY(li) + 4, ch = LANE_H - 9;
        const sel = this.selectedOverlap && this.selectedOverlap.lane === o.lane && Math.abs(this.selectedOverlap.a - o.a) < 1e-6;
        g.fillStyle = sel ? 'rgba(255,255,255,0.16)' : 'rgba(227,58,65,0.18)'; g.fillRect(x0, y, x1 - x0, ch);
        g.strokeStyle = sel ? 'rgba(255,255,255,0.9)' : 'rgba(227,58,65,0.7)'; g.lineWidth = 1; g.beginPath();
        for (let hx = x0 - ch; hx < x1; hx += 6) { g.moveTo(hx, y + ch); g.lineTo(hx + ch, y); }
        g.stroke();
        if (sel) { g.lineWidth = 2; g.strokeRect(x0 + 1, y + 1, x1 - x0 - 2, ch - 2); }
        // crossfade curves: fadeOut of lower, fadeIn of upper, drawn over the span
        const lo = this.project.clips[arr.placements[o.lower]?.clip], up = this.project.clips[arr.placements[o.upper]?.clip];
        if (lo && up) {
          g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 1;
          const fo = Math.min(o.b - o.a, lo.fadeOut || 0), fi = Math.min(o.b - o.a, up.fadeIn || 0);
          if (fo > 0) { g.beginPath(); g.moveTo(this.x(o.b - fo), y + 2); g.lineTo(this.x(o.b), y + ch - 2); g.stroke(); }
          if (fi > 0) { g.beginPath(); g.moveTo(this.x(o.a), y + ch - 2); g.lineTo(this.x(o.a + fi), y + 2); g.stroke(); }
        }
      }
      g.restore();
    }
  }

  // Overlays drawn after the ruler: snap guide, playhead (+ its ruler
  // handle), drop hint. Separate so the ruler can't cover the handle.
  paintOverlays(g, w, h, playheadSec, playing, { accent }) {
    // snap guide: a bright vertical line at the target we're stuck to
    if (this.drag && this.snapHit != null) {
      const x = this.x(this.snapHit);
      if (x >= GUTTER_W && x <= w) { g.fillStyle = '#ffffff'; g.globalAlpha = 0.8; g.fillRect(x, RULER_H, 1, h - RULER_H); g.globalAlpha = 1; }
    }
    // lane reorder: the dragged lane's name follows the pointer as a tag,
    // and a bright line marks the drop slot.
    if (this.drag?.edge === 'reorder' && this.drag.armed) {
      const d = this.drag, ls = this.lanes(), lane = ls[d.from];
      const sy = Math.max(RULER_H, Math.min(h, this.laneY(d.to)));
      g.fillStyle = accent; g.fillRect(0, sy - 1, w, 2);
      const label = lane?.name || d.laneId;
      g.font = 'bold 11px system-ui, sans-serif'; const tw = g.measureText(label).width + 12;
      g.fillStyle = cssVar('--bg-2', '#171b26'); g.fillRect(6, this._reorderY - 10, tw, 20);
      g.strokeStyle = accent; g.strokeRect(6.5, this._reorderY - 9.5, tw - 1, 19);
      g.fillStyle = cssVar('--text', '#dbe1f0'); g.textBaseline = 'middle'; g.fillText(label, 12, this._reorderY);
      // dim the source row
      g.fillStyle = 'rgba(11,13,18,0.5)'; g.fillRect(0, this.laneY(d.from), w, this.laneH(lane));
    }
    // playhead: line through the lanes, a triangle handle on the ruler, and
    // the time next to it so you don't have to read the ruler ticks.
    if (playheadSec != null) {
      const x = this.x(playheadSec);
      if (x >= GUTTER_W && x <= w) {
        g.fillStyle = accent; g.fillRect(x - (playing ? 1 : 0), RULER_H, playing ? 2 : 1, h - RULER_H);
        g.beginPath(); g.moveTo(x - 6, 2); g.lineTo(x + 6, 2); g.lineTo(x, TICK_H - 2); g.closePath(); g.fill();
        const label = fmtTime(playheadSec) + (playing ? '' : '.' + String(Math.floor((playheadSec % 1) * 100)).padStart(2, '0'));
        g.font = '10px system-ui, sans-serif'; const tw = g.measureText(label).width + 8;
        const lx = x + 8 + tw > w ? x - 8 - tw : x + 8;
        g.fillStyle = cssVar('--bg-1', '#11141c'); g.fillRect(lx - 2, 2, tw + 4, TICK_H - 4);
        g.fillStyle = accent; g.fillText(label, lx + 4, TICK_H / 2);
      }
    }
    // drop hint from the asset bin: highlight the target lane + insertion x
    if (this.dropHint) {
      const t = this.laneAt(this.dropHint.x, this.dropHint.y);
      if (t) {
        const y = this.laneY(t.index);
        g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(GUTTER_W, y, w - GUTTER_W, LANE_H - 1);
        const x = Math.max(GUTTER_W, this.dropHint.x);
        g.fillStyle = '#ffffff'; g.fillRect(x, y, 2, LANE_H - 1);
      }
    }
    this.dirty = false;
  }
}
