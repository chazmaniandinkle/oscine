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
