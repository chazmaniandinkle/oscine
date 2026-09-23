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

const RULER_H = 22;
const LANE_H = 64;
const GUTTER_W = 150;
const EDGE_PX = 6;
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
    new ResizeObserver(() => { this.dirty = true; }).observe(host);
  }

  // -- data -----------------------------------------------------------------

  get project() { return this.store.project; }
  get arrangement() { return this.project.arrangement; }

  setProject(project) {
    this.peaks.clear();
    this.buffers.clear();
    this.selected = null;
    this.fitToWidth();
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
  }
  x(sec) { return GUTTER_W + (sec * this.pxPerSec) - this.scrollX; }
  sec(x) { return (x - GUTTER_W + this.scrollX) / this.pxPerSec; }
  laneY(i) { return RULER_H + i * LANE_H; }

  // Lane under a canvas point (any x), for drops from the asset bin.
  laneAt(px, py) {
    if (py < RULER_H) return null;
    const i = Math.floor((py - RULER_H) / LANE_H);
    const lane = this.lanes()[i];
    return lane ? { lane, index: i } : null;
  }

  hit(px, py) {
    const arr = this.arrangement;
    if (!arr || py < RULER_H || px < GUTTER_W) return null;
    const laneIdx = Math.floor((py - RULER_H) / LANE_H);
    const lane = this.lanes()[laneIdx];
    if (!lane) return null;
    for (let i = arr.placements.length - 1; i >= 0; i--) {
      const p = arr.placements[i];
      if (p.track !== lane.id) continue;
      const clip = this.project.clips[p.clip];
      if (!clip) continue;
      const x0 = this.x(p.at), x1 = this.x(p.at + placedDur(clip));
      if (px >= x0 - EDGE_PX && px <= x1 + EDGE_PX) {
        const edge = px <= x0 + EDGE_PX ? 'left' : px >= x1 - EDGE_PX ? 'right' : 'body';
        return { index: i, placement: p, clip, edge };
      }
    }
    return null;
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
    if (this.selectedLane === id) return;
    this.selectedLane = id;
    this.app.bus.emit('lane:selected', { id });
    this.dirty = true;
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
    this.arrangement.placements.splice(this.selected, 1); // clip record stays; it's a reference
    this.selected = null;
    this.app.bus.emit('clip:selected', { index: null });
    this.app.bus.emit('arrangement:changed', {});
    this.dirty = true;
  }

  pos(e) { const r = this.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

  onDown(e) {
    const { x, y } = this.pos(e);
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
    const h = this.hit(x, y);
    if (!h) {
      if (this.selected != null) { this.selected = null; this.app.bus.emit('clip:selected', { index: null }); }
      if (this.selectedLane != null) { this.selectedLane = null; this.app.bus.emit('lane:selected', { id: null }); }
      if (x >= GUTTER_W) this.app.transport.songPos = Math.max(0, this.sec(x)); // seek
      this.dirty = true;
      return;
    }
    this.canvas.setPointerCapture(e.pointerId);
    this.store.checkpoint();
    if (this.selectedLane != null) { this.selectedLane = null; this.app.bus.emit('lane:selected', { id: null }); }
    if (this.selected !== h.index) { this.selected = h.index; this.app.bus.emit('clip:selected', { index: h.index }); }
    // ⌥ on the right edge = time-stretch (pitch preserved) instead of trim.
    const edge = (h.edge === 'right' && e.altKey) ? 'stretch' : h.edge;
    this.drag = { ...h, edge, startX: x, at0: h.placement.at, in0: h.clip.in, out0: h.clip.out, st0: h.clip.stretch ?? 1 };
    this.dirty = true;
  }

  onMove(e) {
    const { x, y } = this.pos(e);
    if (!this.drag) {
      const h = this.hit(x, y);
      this.canvas.style.cursor = !h ? 'default' : h.edge === 'body' ? 'grab' : (h.edge === 'right' && e.altKey) ? 'col-resize' : 'ew-resize';
      return;
    }
    const d = this.drag, ds = (x - d.startX) / this.pxPerSec;
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
    if (d.edge === 'body') {
      d.placement.at = Math.max(0, d.at0 + ds);
    } else if (d.edge === 'stretch') {
      // New placed length / source length = stretch. Clamp 0.25x..4x.
      const srcLen = d.out0 - d.in0, want = srcLen * d.st0 + ds;
      d.clip.stretch = Math.round(Math.max(0.25, Math.min(4, want / srcLen)) * 1000) / 1000;
      if (Math.abs(d.clip.stretch - 1) < 0.005) delete d.clip.stretch;
      this.peaks.clear();
    } else if (d.edge === 'left') {
      // Trim in-point; keep the right edge fixed in song time.
      const nin = Math.min(Math.max(0, d.in0 + ds), d.out0 - 0.05);
      d.clip.in = nin;
      d.placement.at = d.at0 + (nin - d.in0);
    } else {
      d.clip.out = Math.max(d.in0 + 0.05, Math.min(maxOut, d.out0 + ds));
    }
    this.dirty = true;
  }

  onUp(e) {
    if (!this.drag) return;
    try { this.canvas.releasePointerCapture(e.pointerId); } catch {}
    const wasGain = this.drag.edge === 'gain';
    this.drag = null;
    this.app.bus.emit(wasGain ? 'lanes:changed' : 'arrangement:changed', {});
    this.dirty = true;
  }

  onWheel(e) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const { x } = this.pos(e);
      const anchor = this.sec(x);
      this.pxPerSec = Math.max(0.5, Math.min(400, this.pxPerSec * (e.deltaY < 0 ? 1.1 : 0.9)));
      this.scrollX = anchor * this.pxPerSec - (x - GUTTER_W);
    } else {
      this.scrollX += (e.deltaX || e.deltaY);
    }
    this.scrollX = Math.max(0, this.scrollX);
    this.dirty = true;
  }

  // -- paint ----------------------------------------------------------------

  onFrame(pos) {
    if (!this.active) return;
    const playing = !!pos?.playing;
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
        g.strokeStyle = idx === this.selected ? '#ffffff' : col; g.lineWidth = idx === this.selected ? 2 : 1;
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
    }

    // playhead
    if (playheadSec != null) {
      const x = this.x(playheadSec);
      if (x >= GUTTER_W && x <= w) { g.fillStyle = accent; g.fillRect(x, 0, playing ? 2 : 1, h); }
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
