// Piano roll: canvas note editor for melodic tracks.
//
//   click empty      add note (drag right to set length)
//   drag note        move (snapped); drag its right edge to resize
//   alt+drag note    velocity (note brightness = velocity)
//   shift+drag       marquee select; shift+click adds to selection
//   right-click/dbl  delete note
//   delete key       delete selection; cmd/ctrl+A select all
//   wheel            scroll; ctrl/cmd+wheel zooms time
//   key gutter       audition pitches

import { clamp, midiName, isBlackKey } from '../core/util.js';
import { MIDI_MIN, MIDI_MAX } from '../core/schema.js';

const KEY_W = 56;
const RULER_H = 26;
const EDGE_PX = 7;

export class PianoRoll {
  constructor(host, app) {
    this.app = app;
    this.store = app.store;
    this.host = host;
    host.classList.add('pianoroll');

    this.canvas = document.createElement('canvas');
    this.g = this.canvas.getContext('2d');
    host.appendChild(this.canvas);

    this.trackId = null;
    this.active = false;       // is this editor currently shown
    this.scrollX = 0;
    this.scrollY = 0;
    this.pxPer16 = 26;
    this.rowH = 14;
    this.selection = new Set();
    this.drag = null;
    this.lastDur = 0.25;
    this.lastPaintedPlayhead = -1;

    this.ro = new ResizeObserver(() => this.paint());
    this.ro.observe(host);

    const { bus } = app;
    bus.on('notes:changed', ({ trackId }) => {
      if (trackId === this.trackId) this.paint();
    });
    bus.on('slot:changed', () => { this.pruneSelection(); this.paint(); });
    bus.on('slot:resized', () => this.paint());
    bus.on('project:replaced', () => { this.pruneSelection(); this.paint(); });

    this.canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.onMove(e));
    this.canvas.addEventListener('pointerup', (e) => this.onUp(e));
    this.canvas.addEventListener('pointercancel', (e) => this.onUp(e));
    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const hit = this.hitNote(this.evtPos(e));
      if (hit) {
        this.store.checkpoint();
        this.selection.delete(hit.id);
        this.store.removeNotes(this.trackId, [hit.id]);
      }
    });
    this.canvas.addEventListener('dblclick', (e) => {
      const hit = this.hitNote(this.evtPos(e));
      if (hit) {
        this.store.checkpoint();
        this.selection.delete(hit.id);
        this.store.removeNotes(this.trackId, [hit.id]);
      }
    });
    this.canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  // -- data access ------------------------------------------------------------

  get track() { return this.store.getTrack(this.trackId); }
  get pattern() { return this.trackId ? this.store.getPattern(this.trackId) : null; }
  get loopBeats() { return this.store.getSlot().bars * 4; }
  get pxPerBeat() { return this.pxPer16 * 4; }

  setTrack(trackId) {
    this.trackId = trackId;
    this.selection.clear();
    this.drag = null;
    this.centerOnContent();
    this.paint();
  }

  centerOnContent() {
    const notes = this.pattern?.notes ?? [];
    const viewH = this.host.clientHeight - RULER_H;
    let centerMidi = 60;
    if (notes.length) {
      centerMidi = notes.reduce((s, n) => s + n.pitch, 0) / notes.length;
    }
    this.scrollY = clamp(
      (MIDI_MAX - centerMidi) * this.rowH - viewH / 2,
      0, this.maxScrollY()
    );
    this.scrollX = 0;
  }

  maxScrollX() {
    const contentW = this.loopBeats * this.pxPerBeat;
    return Math.max(0, contentW - (this.host.clientWidth - KEY_W) + 60);
  }

  maxScrollY() {
    const contentH = (MIDI_MAX - MIDI_MIN + 1) * this.rowH;
    return Math.max(0, contentH - (this.host.clientHeight - RULER_H));
  }

  pruneSelection() {
    const ids = new Set((this.pattern?.notes ?? []).map(n => n.id));
    for (const id of [...this.selection]) if (!ids.has(id)) this.selection.delete(id);
  }

  // -- coordinates --------------------------------------------------------------

  beatToX(b) { return KEY_W + b * this.pxPerBeat - this.scrollX; }
  xToBeat(x) { return (x - KEY_W + this.scrollX) / this.pxPerBeat; }
  midiToY(m) { return RULER_H + (MIDI_MAX - m) * this.rowH - this.scrollY; }
  yToMidi(y) { return MIDI_MAX - Math.floor((y - RULER_H + this.scrollY) / this.rowH); }

  evtPos(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  hitNote(pos) {
    const notes = this.pattern?.notes ?? [];
    for (let i = notes.length - 1; i >= 0; i--) {
      const n = notes[i];
      const x0 = this.beatToX(n.start);
      const x1 = this.beatToX(n.start + n.dur);
      const y0 = this.midiToY(n.pitch);
      if (pos.x >= x0 - 1 && pos.x <= x1 + 1 && pos.y >= y0 && pos.y <= y0 + this.rowH) return n;
    }
    return null;
  }

  snapBeat(b) {
    const s = this.store.ui.snap;
    return Math.round(b / s) * s;
  }
  snapFloor(b) {
    const s = this.store.ui.snap;
    return Math.floor(b / s) * s;
  }

  // -- pointer interactions --------------------------------------------------------

  onDown(e) {
    if (!this.trackId || e.button === 2) return;
    const pos = this.evtPos(e);
    this.canvas.setPointerCapture(e.pointerId);

    // Key gutter: audition.
    if (pos.x < KEY_W && pos.y > RULER_H) {
      const midi = this.yToMidi(pos.y);
      if (midi >= MIDI_MIN && midi <= MIDI_MAX) {
        this.app.engine.previewNote(this.trackId, midi, 0.9, 0.35);
      }
      return;
    }
    if (pos.y < RULER_H) return;

    const startBeat = this.xToBeat(pos.x);
    const startMidi = this.yToMidi(pos.y);
    const hit = this.hitNote(pos);

    if (hit) {
      const x1 = this.beatToX(hit.start + hit.dur);
      const wide = (x1 - this.beatToX(hit.start)) > EDGE_PX + 4;

      if (!this.selection.has(hit.id)) {
        if (e.shiftKey) this.selection.add(hit.id);
        else { this.selection.clear(); this.selection.add(hit.id); }
      }

      this.store.checkpoint();
      const originals = (this.pattern.notes)
        .filter(n => this.selection.has(n.id))
        .map(n => ({ id: n.id, start: n.start, pitch: n.pitch, dur: n.dur, vel: n.vel }));

      if (e.altKey) {
        this.drag = { mode: 'velocity', originals, startY: pos.y };
      } else if (pos.x > x1 - EDGE_PX && wide) {
        this.drag = { mode: 'resize', originals, anchor: hit };
      } else {
        this.drag = { mode: 'move', originals, startBeat, startMidi, lastDPitch: 0 };
        this.app.engine.previewNote(this.trackId, hit.pitch, hit.vel, 0.2);
      }
      this.paint();
      return;
    }

    if (e.shiftKey) {
      this.drag = { mode: 'marquee', x0: pos.x, y0: pos.y, x1: pos.x, y1: pos.y, base: new Set(this.selection) };
      return;
    }

    // Create a note.
    const beat = this.snapFloor(clamp(startBeat, 0, this.loopBeats - 0.01));
    const midi = clamp(startMidi, MIDI_MIN, MIDI_MAX);
    this.store.checkpoint();
    const note = this.store.addNote(this.trackId, {
      start: beat, pitch: midi, dur: this.lastDur, vel: 0.85,
    });
    this.selection.clear();
    this.selection.add(note.id);
    this.drag = { mode: 'resize', originals: [{ ...note }], anchor: note, created: true };
    this.app.engine.previewNote(this.trackId, midi, 0.85, 0.25);
    this.paint();
  }

  onMove(e) {
    if (!this.drag) {
      // Hover cursor feedback.
      const pos = this.evtPos(e);
      const hit = pos.x > KEY_W ? this.hitNote(pos) : null;
      if (hit) {
        const x1 = this.beatToX(hit.start + hit.dur);
        this.canvas.style.cursor = (pos.x > x1 - EDGE_PX) ? 'ew-resize' : 'move';
      } else {
        this.canvas.style.cursor = 'default';
      }
      return;
    }

    const pos = this.evtPos(e);
    const d = this.drag;

    if (d.mode === 'move') {
      const rawD = this.xToBeat(pos.x) - d.startBeat;
      const dBeat = this.snapBeat(rawD);
      const dPitch = this.yToMidi(pos.y) - d.startMidi;
      const patches = d.originals.map(o => ({
        id: o.id,
        start: clamp(o.start + dBeat, 0, Math.max(0, this.loopBeats - 0.05)),
        pitch: clamp(o.pitch + dPitch, MIDI_MIN, MIDI_MAX),
      }));
      this.store.updateNotes(this.trackId, patches);
      if (dPitch !== d.lastDPitch && d.originals.length === 1) {
        d.lastDPitch = dPitch;
        const o = d.originals[0];
        this.app.engine.previewNote(this.trackId, clamp(o.pitch + dPitch, MIDI_MIN, MIDI_MAX), o.vel, 0.15);
      }
    } else if (d.mode === 'resize') {
      const beat = this.xToBeat(pos.x);
      const anchor = d.originals.find(o => o.id === d.anchor.id) ?? d.originals[0];
      let dur = this.snapBeat(beat - anchor.start);
      dur = Math.max(dur, this.store.ui.snap);
      const scale = dur / Math.max(anchor.dur, 0.001);
      const patches = d.originals.map(o => ({
        id: o.id,
        dur: d.originals.length > 1 ? Math.max(o.dur * scale, 0.05) : dur,
      }));
      this.store.updateNotes(this.trackId, patches);
      this.lastDur = dur;
    } else if (d.mode === 'velocity') {
      const dv = (d.startY - pos.y) / 150;
      const patches = d.originals.map(o => ({
        id: o.id,
        vel: clamp(o.vel + dv, 0.05, 1),
      }));
      this.store.updateNotes(this.trackId, patches);
    } else if (d.mode === 'marquee') {
      d.x1 = pos.x; d.y1 = pos.y;
      const bx0 = Math.min(d.x0, d.x1), bx1 = Math.max(d.x0, d.x1);
      const by0 = Math.min(d.y0, d.y1), by1 = Math.max(d.y0, d.y1);
      this.selection = new Set(d.base);
      for (const n of this.pattern.notes) {
        const nx0 = this.beatToX(n.start);
        const nx1 = this.beatToX(n.start + n.dur);
        const ny0 = this.midiToY(n.pitch);
        if (nx1 >= bx0 && nx0 <= bx1 && ny0 + this.rowH >= by0 && ny0 <= by1) {
          this.selection.add(n.id);
        }
      }
      this.paint();
    }
  }

  onUp() {
    if (this.drag?.mode === 'marquee') this.paint();
    this.drag = null;
  }

  onWheel(e) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const before = this.xToBeat(this.evtPos(e).x);
      this.pxPer16 = clamp(this.pxPer16 * (e.deltaY < 0 ? 1.12 : 0.89), 10, 56);
      // Keep the beat under the cursor stationary.
      const after = this.xToBeat(this.evtPos(e).x);
      this.scrollX = clamp(this.scrollX + (before - after) * this.pxPerBeat, 0, this.maxScrollX());
    } else {
      this.scrollX = clamp(this.scrollX + (e.shiftKey ? e.deltaY : e.deltaX), 0, this.maxScrollX());
      this.scrollY = clamp(this.scrollY + (e.shiftKey ? 0 : e.deltaY), 0, this.maxScrollY());
    }
    this.paint();
  }

  onKey(e) {
    if (!this.active || !this.trackId) return;
    const t = e.target;
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return;

    if ((e.key === 'Delete' || e.key === 'Backspace') && this.selection.size) {
      e.preventDefault();
      this.store.checkpoint();
      this.store.removeNotes(this.trackId, [...this.selection]);
      this.selection.clear();
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      this.selection = new Set((this.pattern?.notes ?? []).map(n => n.id));
      this.paint();
    }
  }

  // -- painting -----------------------------------------------------------------

  onFrame(pos) {
    if (!this.active) return;
    if (pos.playing) {
      // Follow the playhead if it leaves the view.
      const x = this.beatToX(pos.localBeat % this.loopBeats);
      const w = this.host.clientWidth;
      if (x > w - 40 || x < KEY_W) {
        this.scrollX = clamp((pos.localBeat % this.loopBeats) * this.pxPerBeat - (w - KEY_W) * 0.25, 0, this.maxScrollX());
      }
      this.paint(pos.localBeat % this.loopBeats);
      this.lastPaintedPlayhead = pos.localBeat;
    } else if (this.lastPaintedPlayhead >= 0) {
      this.lastPaintedPlayhead = -1;
      this.paint();
    }
  }

  paint(playheadBeat = null) {
    const host = this.host;
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    const dpr = window.devicePixelRatio || 1;
    if (this.canvas.width !== w * dpr || this.canvas.height !== h * dpr) {
      this.canvas.width = w * dpr;
      this.canvas.height = h * dpr;
      this.canvas.style.width = w + 'px';
      this.canvas.style.height = h + 'px';
    }
    const g = this.g;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);

    const css = getComputedStyle(document.documentElement);
    const C = {
      bg: css.getPropertyValue('--roll-bg').trim() || '#0e1118',
      rowAlt: css.getPropertyValue('--roll-row-alt').trim() || '#121521',
      line: css.getPropertyValue('--roll-line').trim() || '#1a1f30',
      beat: css.getPropertyValue('--roll-beat').trim() || '#222842',
      bar: css.getPropertyValue('--roll-bar').trim() || '#2e3554',
      text: css.getPropertyValue('--dim').trim() || '#76809a',
      accent: css.getPropertyValue('--accent').trim() || '#7aa2ff',
      keyWhite: '#222737',
      keyBlack: '#161a27',
    };

    g.fillStyle = C.bg;
    g.fillRect(0, 0, w, h);

    if (!this.trackId || !this.pattern) return;
    const loopBeats = this.loopBeats;
    const color = this.track?.color || C.accent;

    // Row shading + horizontal lines.
    const mTop = clamp(this.yToMidi(RULER_H), MIDI_MIN, MIDI_MAX);
    const mBot = clamp(this.yToMidi(h), MIDI_MIN, MIDI_MAX);
    for (let m = mBot; m <= mTop; m++) {
      const y = this.midiToY(m);
      if (isBlackKey(m)) {
        g.fillStyle = C.rowAlt;
        g.fillRect(KEY_W, y, w - KEY_W, this.rowH);
      }
      g.strokeStyle = C.line;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(KEY_W, y + 0.5);
      g.lineTo(w, y + 0.5);
      g.stroke();
    }

    // Vertical grid (16ths / beats / bars).
    const first16 = Math.max(0, Math.floor(this.xToBeat(KEY_W) * 4));
    const last16 = Math.ceil(this.xToBeat(w) * 4);
    for (let i = first16; i <= last16; i++) {
      const b = i / 4;
      if (b > loopBeats) break;
      const x = Math.round(this.beatToX(b)) + 0.5;
      g.strokeStyle = i % 16 === 0 ? C.bar : (i % 4 === 0 ? C.beat : C.line);
      g.beginPath();
      g.moveTo(x, RULER_H);
      g.lineTo(x, h);
      g.stroke();
    }

    // Dim everything past the loop end.
    const loopX = this.beatToX(loopBeats);
    if (loopX < w) {
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.fillRect(loopX, RULER_H, w - loopX, h - RULER_H);
    }

    // Notes.
    for (const n of this.pattern.notes) {
      const x0 = this.beatToX(n.start);
      const x1 = this.beatToX(n.start + n.dur);
      const y = this.midiToY(n.pitch);
      if (x1 < KEY_W || x0 > w || y + this.rowH < RULER_H || y > h) continue;
      const selected = this.selection.has(n.id);
      g.globalAlpha = 0.35 + 0.6 * n.vel;
      g.fillStyle = color;
      this.rrect(g, Math.max(x0, KEY_W), y + 1.5, Math.max(x1 - x0 - 1, 3), this.rowH - 3, 3);
      g.fill();
      g.globalAlpha = 1;
      if (selected) {
        g.strokeStyle = '#fff';
        g.lineWidth = 1.4;
        this.rrect(g, Math.max(x0, KEY_W), y + 1.5, Math.max(x1 - x0 - 1, 3), this.rowH - 3, 3);
        g.stroke();
      }
    }

    // Marquee.
    if (this.drag?.mode === 'marquee') {
      const d = this.drag;
      g.strokeStyle = C.accent;
      g.setLineDash([4, 3]);
      g.strokeRect(Math.min(d.x0, d.x1), Math.min(d.y0, d.y1), Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
      g.setLineDash([]);
    }

    // Playhead.
    if (playheadBeat !== null && playheadBeat <= loopBeats) {
      const x = this.beatToX(playheadBeat);
      if (x >= KEY_W) {
        g.strokeStyle = C.accent;
        g.lineWidth = 1.6;
        g.beginPath();
        g.moveTo(x, RULER_H);
        g.lineTo(x, h);
        g.stroke();
      }
    }

    // Ruler.
    g.fillStyle = C.bg;
    g.fillRect(0, 0, w, RULER_H);
    g.strokeStyle = C.bar;
    g.beginPath();
    g.moveTo(0, RULER_H + 0.5);
    g.lineTo(w, RULER_H + 0.5);
    g.stroke();
    g.fillStyle = C.text;
    g.font = '10px ui-monospace, monospace';
    const bars = Math.ceil(loopBeats / 4);
    for (let bar = 0; bar <= bars; bar++) {
      const x = this.beatToX(bar * 4);
      if (x < KEY_W - 4 || x > w) continue;
      g.fillText(String(bar + 1), x + 4, 17);
    }

    // Key gutter (drawn last, fixed at left).
    g.fillStyle = C.bg;
    g.fillRect(0, RULER_H, KEY_W, h - RULER_H);
    for (let m = mBot; m <= mTop; m++) {
      const y = this.midiToY(m);
      g.fillStyle = isBlackKey(m) ? C.keyBlack : C.keyWhite;
      g.fillRect(0, y + 1, KEY_W - 6, this.rowH - 2);
      if (m % 12 === 0) {
        g.fillStyle = C.text;
        g.font = '9px ui-monospace, monospace';
        g.fillText(midiName(m), 4, y + this.rowH - 4);
      }
    }
    g.strokeStyle = C.bar;
    g.beginPath();
    g.moveTo(KEY_W - 5.5, RULER_H);
    g.lineTo(KEY_W - 5.5, h);
    g.stroke();
  }

  rrect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
}
