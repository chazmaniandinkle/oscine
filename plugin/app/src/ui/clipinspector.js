// Clip inspector: the right panel's view when a timeline placement is
// selected. Every field is the raw clip/placement value with a NumberDrag
// (drag up/down, ⇧ for fine, double-click resets) -- there is no separate
// "properties" model; this edits project.clips[id] and the placement in
// place, exactly like a timeline drag does, then emits the same events so
// the timeline repaints and the transport picks it up on next play.

import { el, NumberDrag, Btn } from './widgets.js';

const fmt = (d = 2) => v => Number(v).toFixed(d);
const fmtDb = v => `${v > 0 ? '+' : ''}${Number(v).toFixed(1)}`;
const fmtTime = v => { const m = Math.floor(v / 60), s = (v % 60).toFixed(2).padStart(5, '0'); return `${m}:${s}`; };

// Lane (track) inspector: name, level, mute/solo, color, and the clips on it.
// Edits arrangement.lanes[] in place and emits lanes:changed so the running
// ClipPlayer ramps immediately.
export class LaneInspector {
  constructor(host, app) {
    this.app = app;
    this.store = app.store;
    this.host = host;
    app.bus.on('lane:selected', () => this.render());
    app.bus.on('lanes:changed', () => this.refresh());
    app.bus.on('arrangement:changed', () => this.refresh());
  }

  get selection() {
    const tl = this.app.timeline;
    const arr = this.store.project.arrangement;
    if (!tl?.active || !tl.selectedLane || !arr) return null;
    const lane = tl.laneRecord(tl.selectedLane);
    return { lane, placements: arr.placements.map((p, i) => ({ p, i })).filter(({ p }) => p.track === lane.id) };
  }

  refresh() {
    const sel = this.selection;
    if (!sel || this.renderedFor !== sel.lane.id) return this.render();
    this.gainW?.set(sel.lane.gainDb ?? 0);
    this.muteB?.classList.toggle('on', !!sel.lane.mute);
    this.soloB?.classList.toggle('on', !!sel.lane.solo);
  }

  render() {
    const { host, store } = this;
    host.textContent = '';
    const sel = this.selection;
    this.renderedFor = sel?.lane.id ?? null;
    if (!sel) return false;
    const { lane, placements } = sel;
    const tl = this.app.timeline;
    const color = tl.laneColor(lane);
    const commit = () => { this.app.bus.emit('lanes:changed', {}); tl.dirty = true; };

    const head = el('div', 'panel-head');
    const nameIn = el('input', 'song-name lane-name');
    nameIn.value = lane.name || lane.id;
    nameIn.spellcheck = false;
    nameIn.style.color = color;
    nameIn.addEventListener('change', () => { store.checkpoint(); lane.name = nameIn.value.trim() || lane.id; commit(); });
    head.appendChild(nameIn);
    host.appendChild(head);

    const meta = el('div', 'clip-meta');
    meta.appendChild(el('div', 'clip-meta-row', `id  ${lane.id}`));
    meta.appendChild(el('div', 'clip-meta-row', `${placements.length} clip${placements.length === 1 ? '' : 's'}`));
    host.appendChild(meta);

    // Level + state
    const g1 = el('div', 'insp-group'); g1.appendChild(el('div', 'insp-group-title', 'Level'));
    const grid = el('div', 'clip-grid'); g1.appendChild(grid); host.appendChild(g1);
    let armed = false;
    const row = el('div', 'clip-row'); row.appendChild(el('span', 'clip-label', 'gain'));
    this.gainW = NumberDrag({
      value: lane.gainDb ?? 0, min: -60, max: 12, step: 0.1, format: fmtDb, suffix: ' dB',
      onInput: v => { if (!armed) { store.checkpoint(); armed = true; } lane.gainDb = v; this.app.bus.emit('lanes:changed', {}); tl.dirty = true; },
      onCommit: () => { armed = false; commit(); },
    });
    this.gainW.root.classList.add('clip-value'); row.appendChild(this.gainW.root); grid.appendChild(row);

    const btns = el('div', 'clip-actions');
    this.muteB = Btn('Mute', () => { store.checkpoint(); lane.mute = !lane.mute; commit(); this.refresh(); }, lane.mute ? 'on' : '');
    this.soloB = Btn('Solo', () => { store.checkpoint(); lane.solo = !lane.solo; commit(); this.refresh(); }, lane.solo ? 'on' : '');
    btns.appendChild(this.muteB); btns.appendChild(this.soloB);
    host.appendChild(btns);

    // Color
    const g2 = el('div', 'insp-group'); g2.appendChild(el('div', 'insp-group-title', 'Color'));
    const crow = el('div', 'clip-row'); crow.appendChild(el('span', 'clip-label', 'lane color'));
    const cin = el('input'); cin.type = 'color'; cin.value = /^#[0-9a-f]{6}$/i.test(color) ? color : '#7aa2ff'; cin.className = 'lane-color';
    cin.addEventListener('input', () => { lane.color = cin.value; nameIn.style.color = cin.value; tl.dirty = true; });
    cin.addEventListener('change', () => { store.checkpoint(); lane.color = cin.value; commit(); });
    crow.appendChild(cin); g2.appendChild(crow); host.appendChild(g2);

    // Clips on this lane: click to select on the timeline.
    const g3 = el('div', 'insp-group'); g3.appendChild(el('div', 'insp-group-title', 'Clips'));
    const list = el('div', 'lane-clips');
    for (const { p, i } of placements.sort((a, b) => a.p.at - b.p.at)) {
      const c = store.project.clips[p.clip]; if (!c) continue;
      const dur = (c.out - c.in) * (c.stretch ?? 1) / (c.rate ?? 1);
      const item = el('div', 'lane-clip', `${fmtTime(p.at)}  ${c.name || c.id}  (${fmtTime(dur)})`);
      item.addEventListener('click', () => { tl.selectedLane = null; tl.selected = i; tl.dirty = true; this.app.bus.emit('lane:selected', { id: null }); this.app.bus.emit('clip:selected', { index: i }); });
      list.appendChild(item);
    }
    if (!placements.length) list.appendChild(el('div', 'clip-hint', 'Nothing on this lane.'));
    g3.appendChild(list); host.appendChild(g3);

    const danger = el('div', 'clip-actions');
    const rm = Btn(`Remove lane${placements.length ? ` (${placements.length} clip${placements.length === 1 ? '' : 's'})` : ''}`, () => {
      if (!rm.classList.contains('confirm')) { rm.classList.add('confirm'); rm.textContent = 'Really remove?'; setTimeout(() => { rm.classList.remove('confirm'); this.render(); }, 2000); return; }
      this.app.assetBin.removeLane(lane.id);
    }, 'danger');
    danger.appendChild(rm); host.appendChild(danger);

    host.appendChild(el('div', 'clip-hint', 'Rename in the header · drag gain · click a clip to edit it'));
    return true;
  }
}

export class ClipInspector {
  constructor(host, app) {
    this.app = app;
    this.store = app.store;
    this.host = host;
    this.widgets = new Map();
    app.bus.on('arrangement:changed', () => this.refresh());
    app.bus.on('clip:selected', () => this.render());
    app.bus.on('project:replaced', () => this.render());
  }

  get selection() {
    const tl = this.app.timeline;
    const arr = this.store.project.arrangement;
    if (!tl?.active || tl.selected == null || !arr) return null;
    const placement = arr.placements[tl.selected];
    const clip = placement && this.store.project.clips[placement.clip];
    if (!clip) return null;
    return { placement, clip, asset: this.store.project.assets[clip.sourceOf], index: tl.selected };
  }

  // Cheap path: values changed under us (a timeline drag) -- update widgets
  // without rebuilding the DOM, so a drag doesn't fight the panel.
  refresh() {
    const sel = this.selection;
    if (!sel) return this.render();
    if (this.renderedFor !== sel.clip.id) return this.render();
    for (const [key, w] of this.widgets) {
      const v = key === 'at' ? sel.placement.at : sel.clip[key];
      w.set(v ?? (key === 'stretch' || key === 'rate' ? 1 : 0));
    }
    this.host.querySelector('.clip-len')?.replaceChildren(document.createTextNode(this.lengthText(sel)));
  }

  lengthText({ clip }) {
    const src = clip.out - clip.in, placed = src * (clip.stretch ?? 1) / (clip.rate ?? 1);
    return `${fmtTime(src)} source → ${fmtTime(placed)} placed`;
  }

  render() {
    const { host } = this;
    host.textContent = '';
    this.widgets.clear();
    const sel = this.selection;
    this.renderedFor = sel?.clip.id ?? null;
    if (!sel) return false;
    const { placement, clip, asset } = sel;
    const { store } = this;

    const lane = store.project.arrangement.lanes?.find(l => l.id === placement.track);
    const color = lane?.color || '#7aa2ff';

    const head = el('div', 'panel-head');
    const title = el('div', 'panel-title', clip.name || clip.id);
    title.style.color = color;
    head.appendChild(title);
    host.appendChild(head);

    const meta = el('div', 'clip-meta');
    meta.appendChild(el('div', 'clip-meta-row', `lane  ${lane?.name || placement.track}`));
    meta.appendChild(el('div', 'clip-meta-row', `source  ${asset?.id ?? clip.sourceOf}${asset ? `  (${fmtTime(asset.duration)})` : ''}`));
    meta.appendChild(el('div', 'clip-meta-row clip-len', this.lengthText(sel)));
    host.appendChild(meta);

    // One row per field: label + NumberDrag. `apply` mutates in place;
    // checkpoint on first input of a gesture, emit on commit.
    const section = (name) => {
      const s = el('div', 'insp-group');
      s.appendChild(el('div', 'insp-group-title', name));
      const grid = el('div', 'clip-grid');
      s.appendChild(grid);
      host.appendChild(s);
      return grid;
    };
    let armed = false;
    const field = (grid, key, label, o) => {
      const get = () => key === 'at' ? placement.at : (clip[key] ?? o.default ?? 0);
      const set = v => {
        if (key === 'at') placement.at = v;
        else if (o.default !== undefined && Math.abs(v - o.default) < 1e-9) delete clip[key];
        else clip[key] = v;
      };
      const row = el('div', 'clip-row');
      row.appendChild(el('span', 'clip-label', label));
      const w = NumberDrag({
        value: get(), min: o.min, max: o.max, step: o.step ?? 0.01, format: o.format ?? fmt(2), suffix: o.suffix ?? '',
        title: o.title,
        onInput: v => {
          if (!armed) { store.checkpoint(); armed = true; }
          set(v); o.after?.();
          this.app.timeline.peaks.clear(); this.app.timeline.dirty = true;
          this.host.querySelector('.clip-len')?.replaceChildren(document.createTextNode(this.lengthText(sel)));
        },
        onCommit: () => { armed = false; this.app.bus.emit('arrangement:changed', {}); },
      });
      w.root.classList.add('clip-value');
      this.widgets.set(key, w);
      row.appendChild(w.root);
      grid.appendChild(row);
    };

    const g1 = section('Position');
    field(g1, 'at', 'at', { min: 0, max: 36000, step: 0.01, format: fmtTime, title: 'Where the clip starts on the timeline (drag; ⇧ fine)' });
    field(g1, 'in', 'in', { min: 0, max: asset?.duration ?? 36000, step: 0.01, format: fmtTime, title: 'Source in-point' });
    field(g1, 'out', 'out', { min: 0, max: asset?.duration ?? 36000, step: 0.01, format: fmtTime, title: 'Source out-point' });

    const g2 = section('Time & pitch');
    field(g2, 'stretch', 'stretch', { min: 0.25, max: 4, step: 0.01, default: 1, format: v => `×${Number(v).toFixed(2)}`, title: 'Time-stretch, pitch preserved (phase vocoder)' });
    field(g2, 'semitones', 'pitch', { min: -24, max: 24, step: 0.5, default: 0, format: v => `${v > 0 ? '+' : ''}${Number(v).toFixed(1)}`, suffix: ' st', title: 'Pitch shift, length preserved' });
    field(g2, 'rate', 'rate', { min: 0.25, max: 4, step: 0.01, default: 1, format: fmt(2), title: 'Tape-style speed (pitch and length move together)' });
    field(g2, 'detune', 'detune', { min: -1200, max: 1200, step: 1, default: 0, format: v => `${v > 0 ? '+' : ''}${Math.round(v)}`, suffix: ' ¢', title: 'Fine pitch, cents (node-level)' });

    const g3 = section('Level');
    field(g3, 'gainDb', 'gain', { min: -60, max: 12, step: 0.1, default: 0, format: fmtDb, suffix: ' dB' });
    field(g3, 'fadeIn', 'fade in', { min: 0, max: 30, step: 0.01, default: 0, format: fmt(2), suffix: ' s' });
    field(g3, 'fadeOut', 'fade out', { min: 0, max: 30, step: 0.01, default: 0, format: fmt(2), suffix: ' s' });

    const actions = el('div', 'clip-actions');
    actions.appendChild(Btn('Split at playhead', () => this.app.timeline.splitAtPlayhead()));
    actions.appendChild(Btn('Remove', () => this.app.timeline.deleteSelected(), 'danger'));
    host.appendChild(actions);

    host.appendChild(el('div', 'clip-hint', 'Drag values · ⇧ fine · double-click resets · S split · ⌫ remove'));
    return true;
  }
}
