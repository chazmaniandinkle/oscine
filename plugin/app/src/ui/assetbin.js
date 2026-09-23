// Left panel for arrangement projects: the asset bin (source files the clips
// reference) and the lane list. Replaces the instrument TrackList whenever
// the loaded project has an arrangement.
//
// Drag a source onto a lane in the timeline to place a new clip (whole file,
// at the drop point); "+ lane" gives it a lane of its own. Nothing here
// copies audio -- a placement is {track, clip, at} and a clip is a
// reference into the asset by sha256.

import { el, openMenu, toast } from './widgets.js';

const fmtTime = v => { const m = Math.floor(v / 60), s = Math.floor(v % 60); return `${m}:${String(s).padStart(2, '0')}`; };
const uid = () => Math.random().toString(36).slice(2, 8);

export class AssetBin {
  constructor(host, app) {
    this.app = app;
    this.store = app.store;
    this.host = host;
    host.classList.add('assetbin');
    this.dragging = null; // { assetId } while a source is being dragged

    const { bus } = app;
    for (const type of ['project:replaced', 'arrangement:changed', 'lanes:changed', 'lane:selected', 'clip:selected']) {
      bus.on(type, () => this.render());
    }
    // Drop target: the timeline canvas. The bin owns the gesture so the
    // timeline doesn't need to know about the sidebar.
    window.addEventListener('pointermove', e => this.onDragMove(e));
    window.addEventListener('pointerup', e => this.onDragEnd(e));
    this.render();
  }

  get project() { return this.store.project; }
  get arrangement() { return this.project.arrangement; }

  usage(assetId) {
    const arr = this.arrangement; if (!arr) return [];
    const lanes = new Set();
    for (const p of arr.placements) {
      const c = this.project.clips[p.clip];
      if (c?.sourceOf === assetId) lanes.add(p.track);
    }
    return [...lanes];
  }

  render() {
    const { host, project } = this;
    host.textContent = '';
    const arr = this.arrangement;
    if (!arr) return;

    // -- sources -------------------------------------------------------------
    const head = el('div', 'panel-head');
    head.appendChild(el('div', 'panel-title', 'Sources'));
    head.appendChild(el('div', 'panel-sub', `${Object.keys(project.assets).length}`));
    host.appendChild(head);

    const list = el('div', 'asset-rows');
    const laneById = id => arr.lanes?.find(l => l.id === id);
    for (const a of Object.values(project.assets)) {
      const row = el('div', 'asset-row');
      row.dataset.asset = a.id;
      const used = this.usage(a.id);
      const swatches = el('div', 'asset-swatches');
      for (const id of used) {
        const s = el('span', 'asset-swatch'); s.style.background = laneById(id)?.color || '#7aa2ff'; s.title = laneById(id)?.name || id;
        swatches.appendChild(s);
      }
      row.appendChild(swatches);
      const mid = el('div', 'asset-mid');
      mid.appendChild(el('div', 'asset-name', a.name || a.id.replace(/^ast_/, '')));
      mid.lastChild.title = a.name || a.id;
      const v = a.variants?.default;
      mid.appendChild(el('div', 'asset-sub', `${fmtTime(a.duration)} · ${a.kind}${v?.sha256 ? ' · ' + v.sha256.slice(0, 8) : ''}${used.length ? '' : ' · unused'}`));
      row.appendChild(mid);
      const add = el('button', 'btn mini', '+');
      add.title = 'Place on a lane…';
      add.addEventListener('click', e => { e.stopPropagation(); this.placeMenu(add, a); });
      row.appendChild(add);
      row.title = 'Click for details · drag onto a lane to place a clip';
      row.classList.toggle('selected', a.id === this.selectedAsset);
      row.addEventListener('pointerdown', e => this.onDragStart(e, a));
      row.addEventListener('click', () => { if (this.suppressClick) { this.suppressClick = false; return; } this.selectAsset(a.id); });
      list.appendChild(row);
    }
    host.appendChild(list);
  }

  // Asset selection is exclusive with clip/lane selection (one inspector target).
  selectAsset(id) {
    const tl = this.app.timeline;
    if (tl.selected != null) { tl.selected = null; this.app.bus.emit('clip:selected', { index: null }); }
    if (tl.selectedLane != null) { tl.selectedLane = null; this.app.bus.emit('lane:selected', { id: null }); }
    this.selectedAsset = id;
    tl.dirty = true;
    this.app.bus.emit('asset:selected', { id });
    this.render();
  }

  // -- placing ---------------------------------------------------------------

  placeMenu(anchor, asset) {
    const tl = this.app.timeline;
    const at = this.app.transport.getPosition().sec ?? this.app.transport.songPos;
    openMenu(anchor, [
      ...tl.lanes().map(l => ({ label: `on ${l.name || l.id} at ${fmtTime(at)}`, onPick: () => this.place(asset, l.id, at) })),
      { label: 'on a new lane', onPick: () => this.place(asset, this.newLane(asset.name || asset.id.replace(/^ast_/, ''), { quiet: true }), 0) },
    ]);
  }

  removeLane(id) {
    const arr = this.arrangement, tl = this.app.timeline;
    this.store.checkpoint();
    arr.placements = arr.placements.filter(p => p.track !== id);
    if (arr.lanes) arr.lanes = arr.lanes.filter(l => l.id !== id);
    if (tl.selectedLane === id) tl.selectedLane = null;
    tl.selected = null;
    this.app.bus.emit('arrangement:changed', {}); this.app.bus.emit('lanes:changed', {}); this.app.bus.emit('lane:selected', { id: null });
    tl.dirty = true;
  }

  newLane(name = null, { quiet = false } = {}) {
    const arr = this.arrangement;
    const tl = this.app.timeline;
    this.store.checkpoint();
    if (!arr.lanes) arr.lanes = tl.lanes().map(l => ({ ...l }));
    const id = `lane-${uid()}`;
    arr.lanes.push({ id, name: name || `Lane ${arr.lanes.length + 1}`, gainDb: 0, mute: false, color: ['#7aa2ff', '#5ce0a8', '#ff8a4c', '#e3a13a', '#c47aff', '#4fd6d6'][arr.lanes.length % 6] });
    this.app.bus.emit('lanes:changed', {});
    tl.dirty = true;
    if (!quiet) toast('Lane added');
    return id;
  }

  place(asset, laneId, at) {
    const arr = this.arrangement;
    this.store.checkpoint();
    const id = `seg_${asset.id.replace(/^ast_/, '')}_${uid()}`;
    this.project.clips[id] = {
      id, sourceOf: asset.id, in: 0, out: asset.duration, representation: null,
      fadeIn: 0, fadeOut: 0, materializedAs: null, supersededBy: null, verified: false,
      name: asset.name || asset.id.replace(/^ast_/, ''),
    };
    arr.placements.push({ track: laneId, clip: id, at: Math.max(0, at) });
    const tl = this.app.timeline;
    tl.selectedLane = null; tl.selected = arr.placements.length - 1; tl.dirty = true;
    this.app.bus.emit('arrangement:changed', {});
    this.app.bus.emit('lane:selected', { id: null });
    this.app.bus.emit('clip:selected', { index: tl.selected });
    toast(`Placed ${this.project.clips[id].name}`);
  }

  // -- drag from bin to timeline -----------------------------------------------

  onDragStart(e, asset) {
    if (e.button !== 0) return;
    this.dragging = { asset, startX: e.clientX, startY: e.clientY, live: false };
  }
  onDragMove(e) {
    const d = this.dragging; if (!d) return;
    if (!d.live) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 6) return;
      d.live = true;
      d.ghost = el('div', 'asset-ghost', d.asset.name || d.asset.id.replace(/^ast_/, ''));
      document.body.appendChild(d.ghost);
      document.body.style.cursor = 'copying';
    }
    d.ghost.style.left = (e.clientX + 12) + 'px';
    d.ghost.style.top = (e.clientY + 12) + 'px';
    const tl = this.app.timeline;
    const r = tl.canvas.getBoundingClientRect();
    const over = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    tl.dropHint = over ? { x: e.clientX - r.left, y: e.clientY - r.top } : null;
    tl.dirty = true;
  }
  onDragEnd(e) {
    const d = this.dragging; this.dragging = null;
    if (!d?.live) return;
    d.ghost?.remove(); document.body.style.cursor = '';
    this.suppressClick = true; // the row's click fires after a drop; don't re-select the asset
    const tl = this.app.timeline;
    const hint = tl.dropHint; tl.dropHint = null; tl.dirty = true;
    if (!hint) return;
    const target = tl.laneAt(hint.x, hint.y);
    if (!target) return;
    this.place(d.asset, target.lane.id, Math.max(0, tl.sec(hint.x)));
  }
}
