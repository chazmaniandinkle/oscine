// Timeline: canvas arrangement view for v2 clip projects. Lanes per track,
// clip regions with cached waveform peaks, a seconds ruler, a playhead, and
// drag-to-move / edge-trim. Times are SECONDS throughout (the arrangement is
// seconds-based; only the pattern editors think in beats).
//
// Mutations are minimal and direct: a gesture calls store.checkpoint() on
// pointerdown, edits placement.at / clip.in / clip.out in place, and emits
// 'arrangement:changed' on pointerup so the transport (next play) and any
// other view pick it up. Nothing here touches audio nodes.

import { el } from './widgets.js';
import { AssetCache } from '../core/assets.js';
import { keymap } from '../core/keymap.js';

const RULER_H = 22;
const LANE_H = 64;
const GUTTER_W = 150;
const EDGE_PX = 6;
const SNAP_PX = 8;
const LANE_COLORS = { bed: '#7aa2ff', vocal: '#5ce0a8', carl: '#ff8a4c' };
// Gutter hit zones (x from left), shared by paint + hit-test.
const BTN = { m: [GUTTER_W - 60, 22], s: [GUTTER_W - 34, 22] }; // [x, w]
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
  // Lanes discovered from placements (no lanes[] entry) get one created on
  // first edit so the change has somewhere to live.
  laneRecord(id) {
    const arr = this.arrangement;
    if (!arr.lanes) arr.lanes = this.lanes().map(l => ({ ...l }));
    let l = arr.lanes.find(x => x.id === id);
    if (!l) { l = { id, name: id }; arr.lanes.push(l); }
    return l;
  }
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
  laneY(i) { return RULER_H + i * LANE_H; }

  // Lane under a canvas point (any x), for drops from the asset bin.
  laneAt(px, py) {
    if (py < RULER_H) return null;
    const i = Math.floor((py - RULER_H) / LANE_H);
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

  hit(px, py) {
    const arr = this.arrangement;
    if (!arr || py < RULER_H || px < GUTTER_W) return null;
    const laneIdx = Math.floor((py - RULER_H) / LANE_H);
    const lane = this.lanes()[laneIdx];
    if (!lane) return null;
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
    this.store.checkpoint();
    const frac = (t - p.at) / dur;
    const cut = clip.in + (clip.out - clip.in) * frac;
    const right = { ...clip, id: `${clip.id}~${Math.random().toString(36).slice(2, 7)}`, in: cut, fadeIn: 0, name: (clip.name || clip.id) + ' ·b' };
    clip.out = cut; clip.fadeOut = 0;
    this.project.clips[right.id] = right;
    arr.placements.splice(this.selected + 1, 0, { track: p.track, clip: right.id, at: t });
    this.peaks.clear();
    this.app.bus.emit('arrangement:changed', {});
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
    this.store.checkpoint();
    const v = Math.round(((clip[field] ?? 0) + delta) * 10) / 10;
    if (Math.abs(v) < 1e-6) delete clip[field]; else clip[field] = v;
    this.app.bus.emit('arrangement:changed', {});
    this.dirty = true;
  }

  deleteSelected() {
    if (this.selected == null) return;
    this.store.checkpoint();
    const idx = this.selected;
    this.arrangement.placements.splice(idx, 1); // clip record stays; it's a reference
    this.selected = null;
    this.restoreSelOnUndo = idx; // undo puts it back at the same index; reselect it
    this.app.bus.emit('clip:selected', { index: null });
    this.app.bus.emit('arrangement:changed', {});
    this.dirty = true;
  }

  pos(e) { const r = this.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

  onDown(e) {
    const { x, y } = this.pos(e);
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
    // Gutter: M / S buttons, the gain readout (vertical drag), or the lane
    // name (select the lane -> inspector shows its properties).
    if (x < GUTTER_W && y >= RULER_H) {
      const li = Math.floor((y - RULER_H) / LANE_H), lane = this.lanes()[li];
      if (!lane) return;
      const ly = y - this.laneY(li);
      const inBtn = (b) => x >= b[0] && x <= b[0] + b[1] && ly >= 8 && ly <= 26;
      if (inBtn(BTN.m) || inBtn(BTN.s)) {
        this.store.checkpoint();
        const rec = this.laneRecord(lane.id);
        if (inBtn(BTN.m)) rec.mute = !rec.mute; else rec.solo = !rec.solo;
        this.app.bus.emit('lanes:changed', {});
        this.dirty = true;
        return;
      }
      if (ly >= GAIN_Y - 10 && ly <= GAIN_Y + 12) {
        this.canvas.setPointerCapture(e.pointerId);
        this.store.checkpoint();
        const rec = this.laneRecord(lane.id);
        this.drag = { edge: 'gain', lane: rec, startY: y, g0: rec.gainDb ?? 0 };
        return;
      }
      // Name area: select the lane.
      this.selectLane(lane.id);
      return;
    }
    // Below the last lane in the gutter: "+ lane".
    if (x < GUTTER_W && y >= this.laneY(this.lanes().length) && y <= this.laneY(this.lanes().length) + 28) {
      this.app.assetBin?.newLane();
      return;
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
    this.drag = { ...h, edge, startX: x, at0: h.placement.at, in0: h.clip.in, out0: h.clip.out, st0: h.clip.stretch ?? 1 };
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
    this.store.checkpoint();
    // Split at b first so indices before it stay valid, then at a.
    for (const t of [this.range.b, this.range.a]) {
      for (const i of [...targets].sort((x, y) => y - x)) this._splitIndexAt(i, t, { checkpoint: false });
    }
    this.multi = [];
    this.selected = null;
    this.app.bus.emit('arrangement:changed', {});
    this.app.bus.emit('clip:selected', { index: null });
    this.dirty = true;
    return true;
  }

  // Remove the range's slice from every selected clip, leaving a gap.
  deleteRangeFromSelection() {
    if (!this.range) return this.deleteSelected();
    const targets = this.multi.length ? [...this.multi] : (this.selected != null ? [this.selected] : []);
    if (!targets.length) return false;
    this.store.checkpoint();
    const arr = this.arrangement, { a, b } = this.range;
    // Work from the highest index down so splices don't shift what's left to do.
    for (const i of [...targets].sort((x, y) => y - x)) {
      const p = arr.placements[i], c = this.project.clips[p.clip];
      const st = (c.stretch ?? 1) / (c.rate ?? 1);
      const end = p.at + placedDur(c);
      if (b <= p.at || a >= end) continue;
      if (a <= p.at && b >= end) { arr.placements.splice(i, 1); continue; } // fully inside: drop
      if (a > p.at && b < end) {
        // Middle cut: keep the head, add a tail clip.
        const cutIn = c.in + (a - p.at) / st, cutOut = c.in + (b - p.at) / st;
        const tail = { ...c, id: `${c.id}~${Math.random().toString(36).slice(2, 7)}`, in: cutOut, fadeIn: 0, name: (c.name || c.id) + ' ·b' };
        this.project.clips[tail.id] = tail;
        c.out = cutIn; c.fadeOut = 0;
        arr.placements.splice(i + 1, 0, { track: p.track, clip: tail.id, at: b });
        continue;
      }
      if (a <= p.at) { // cut the head off
        const cutOut = c.in + (b - p.at) / st;
        c.in = cutOut; p.at = b;
      } else {         // cut the tail off
        c.out = c.in + (a - p.at) / st;
      }
    }
    this.multi = []; this.selected = null;
    this.peaks.clear();
    this.app.bus.emit('arrangement:changed', {});
    this.app.bus.emit('clip:selected', { index: null });
    this.dirty = true;
    return true;
  }

  // Split placement `i` at song time `t` if t is strictly inside it.
  _splitIndexAt(i, t, { checkpoint = true } = {}) {
    const arr = this.arrangement;
    const p = arr.placements[i], clip = this.project.clips[p.clip];
    const dur = placedDur(clip);
    if (t <= p.at + 0.02 || t >= p.at + dur - 0.02) return false;
    if (checkpoint) this.store.checkpoint();
    const frac = (t - p.at) / dur;
    const cut = clip.in + (clip.out - clip.in) * frac;
    const right = { ...clip, id: `${clip.id}~${Math.random().toString(36).slice(2, 7)}`, in: cut, fadeIn: 0, name: (clip.name || clip.id) + ' ·b' };
    clip.out = cut; clip.fadeOut = 0;
    this.project.clips[right.id] = right;
    arr.placements.splice(i + 1, 0, { track: p.track, clip: right.id, at: t });
    this.peaks.clear();
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
        const li = Math.floor((y - RULER_H) / LANE_H), ly = y - this.laneY(li);
        const overBtn = li < this.lanes().length && ly >= 8 && ly <= 26 && ((x >= BTN.m[0] && x <= BTN.m[0] + BTN.m[1]) || (x >= BTN.s[0] && x <= BTN.s[0] + BTN.s[1]));
        const overGain = li < this.lanes().length && ly >= GAIN_Y - 10 && ly <= GAIN_Y + 12;
        const overAdd = li === this.lanes().length && ly <= 28;
        this.canvas.style.cursor = overGain ? 'ns-resize' : (overBtn || overAdd || li < this.lanes().length) ? 'pointer' : 'default';
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
    if (d.edge === 'gain') {
      // 1 px = 0.25 dB, up is louder; range -60..+12. Live-applied.
      const g = Math.max(-60, Math.min(12, d.g0 + (d.startY - y) * 0.25));
      d.lane.gainDb = Math.round(g * 10) / 10;
      this.app.bus.emit('lanes:changed', {});
      this.dirty = true;
      return;
    }
    const asset = this.project.assets[d.clip.sourceOf];
    const maxOut = asset?.duration ?? Infinity;
    if (!d.armed) {
      if (Math.abs(x - d.startX) < 3) return; // click, not a drag yet
      this.store.checkpoint(); d.armed = true;
    }
    if (d.edge === 'body') {
      const len = placedDur(d.clip);
      d.placement.at = this.snapTime(Math.max(0, d.at0 + ds), { exclude: d.index, e, extraLen: len });
    } else if (d.edge === 'slip') {
      // Move the source window under a fixed placement: in/out shift
      // together, clamped to the asset. Drag RIGHT = the waveform moves right
      // with your hand, i.e. earlier audio slides into the window (in decreases).
      const len = d.out0 - d.in0, st = (d.clip.stretch ?? 1) / (d.clip.rate ?? 1);
      const nin = Math.max(0, Math.min(maxOut - len, d.in0 - ds / st));
      d.clip.in = nin; d.clip.out = nin + len;
      this.peaks.clear();
    } else if (d.edge === 'stretch') {
      // New placed length / source length = stretch. Clamp 0.25x..4x.
      const srcLen = d.out0 - d.in0, want = srcLen * d.st0 + ds;
      d.clip.stretch = Math.round(Math.max(0.25, Math.min(4, want / srcLen)) * 1000) / 1000;
      if (Math.abs(d.clip.stretch - 1) < 0.005) delete d.clip.stretch;
      this.peaks.clear();
    } else if (d.edge === 'left') {
      // Trim in-point; keep the right edge fixed in song time. Snap the
      // new left edge in song time, then map back to source.
      const st = (d.clip.stretch ?? 1) / (d.clip.rate ?? 1);
      const wantAt = this.snapTime(d.at0 + ds, { exclude: d.index, e });
      const nin = Math.min(Math.max(0, d.in0 + (wantAt - d.at0) / st), d.out0 - 0.05);
      d.clip.in = nin;
      d.placement.at = d.at0 + (nin - d.in0) * st;
    } else {
      const st = (d.clip.stretch ?? 1) / (d.clip.rate ?? 1);
      const wantEnd = this.snapTime(d.at0 + (d.out0 - d.in0) * st + ds, { exclude: d.index, e });
      d.clip.out = Math.max(d.in0 + 0.05, Math.min(maxOut, d.in0 + (wantEnd - d.at0) / st));
    }
    this.dirty = true;
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
    const wasGain = d.edge === 'gain';
    if (!wasGain && !d.armed) { this.dirty = true; return; } // plain click: nothing changed
    this.app.bus.emit(wasGain ? 'lanes:changed' : 'arrangement:changed', {});
    this.dirty = true;
  }

  onWheel(e) {
    e.preventDefault();
    if (keymap.gesture('timeline.zoom', e) || e.ctrlKey) { // ctrl: trackpad pinch arrives as ctrl+wheel
      const { x } = this.pos(e);
      const anchor = this.sec(x);
      this.pxPerSec = Math.max(0.5, Math.min(400, this.pxPerSec * (e.deltaY < 0 ? 1.1 : 0.9)));
      this.scrollX = anchor * this.pxPerSec - (x - GUTTER_W);
    } else {
      this.scrollX += (e.deltaX || e.deltaY);
    }
    this.fitted = false;
    this.scrollX = Math.max(0, Math.min(this.maxScrollX(), this.scrollX));
    this.dirty = true;
  }

  // -- paint ----------------------------------------------------------------

  onFrame(pos) {
    if (!this.active) return;
    const playing = !!pos?.playing;
    if (playing && !this.drag) this.follow(pos.sec);
    if (playing || this.dirty) this.paint(pos?.sec ?? null, playing);
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

    // ruler
    g.fillStyle = cssVar('--bg-1', '#11141c'); g.fillRect(GUTTER_W, 0, w - GUTTER_W, RULER_H);
    g.font = '11px system-ui, sans-serif'; g.textBaseline = 'middle';
    const s0 = Math.max(0, Math.floor(this.sec(GUTTER_W) / 5) * 5), s1 = this.sec(w);
    for (let s = s0; s <= s1; s += 5) {
      const x = this.x(s);
      const major = s % 30 === 0;
      g.fillStyle = major ? faint : line; g.fillRect(x, major ? 4 : 12, 1, RULER_H - (major ? 4 : 12));
      if (major) { g.fillStyle = text; g.fillText(fmtTime(s), x + 3, 10); }
    }

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
      g.fillText(lane.name || lane.id, 10, y + 17);
      // M / S buttons
      const btn = (b, label, on, onCol) => {
        g.fillStyle = on ? onCol : cssVar('--bg-2', '#171b26'); g.fillRect(b[0], y + 8, b[1], 18);
        g.strokeStyle = on ? onCol : line; g.strokeRect(b[0] + 0.5, y + 8.5, b[1] - 1, 17);
        g.fillStyle = on ? '#0b0d12' : text; g.font = 'bold 11px system-ui, sans-serif';
        g.fillText(label, b[0] + 7, y + 17);
      };
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

    // snap guide: a bright vertical line at the target we're stuck to
    if (this.drag && this.snapHit != null) {
      const x = this.x(this.snapHit);
      if (x >= GUTTER_W && x <= w) { g.fillStyle = '#ffffff'; g.globalAlpha = 0.8; g.fillRect(x, RULER_H, 1, h - RULER_H); g.globalAlpha = 1; }
    }
    // playhead: line through the lanes, a triangle handle on the ruler, and
    // the time next to it so you don't have to read the ruler ticks.
    if (playheadSec != null) {
      const x = this.x(playheadSec);
      if (x >= GUTTER_W && x <= w) {
        g.fillStyle = accent; g.fillRect(x - (playing ? 1 : 0), RULER_H, playing ? 2 : 1, h - RULER_H);
        g.beginPath(); g.moveTo(x - 6, 2); g.lineTo(x + 6, 2); g.lineTo(x, RULER_H - 2); g.closePath(); g.fill();
        const label = fmtTime(playheadSec) + (playing ? '' : '.' + String(Math.floor((playheadSec % 1) * 100)).padStart(2, '0'));
        g.font = '10px system-ui, sans-serif'; const tw = g.measureText(label).width + 8;
        const lx = x + 8 + tw > w ? x - 8 - tw : x + 8;
        g.fillStyle = cssVar('--bg-1', '#11141c'); g.fillRect(lx - 2, 2, tw + 4, RULER_H - 4);
        g.fillStyle = accent; g.fillText(label, lx + 4, RULER_H / 2);
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
