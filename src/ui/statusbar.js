// Status bar: one line at the bottom that says what's true right now.
// Left: position + range + selection. Middle: hint for the thing under
// the cursor (the timeline sets it). Right: ear/profiling progress, decode
// state, save state, sidecar connection.
import { el } from './widgets.js';

const fmtTime = v => { const m = Math.floor(v / 60), s = (v % 60).toFixed(2).padStart(5, '0'); return `${m}:${s}`; };

export class StatusBar {
  constructor(host, app) {
    this.app = app; this.store = app.store; this.host = host;
    host.className = 'statusbar';
    this.posEl = el('span', 'sb-pos', '0:00.00');
    this.rangeEl = el('span', 'sb-range', '');
    this.selEl = el('span', 'sb-sel', '');
    this.hintEl = el('span', 'sb-hint', '');
    this.earEl = el('span', 'sb-ear', '');
    this.saveEl = el('span', 'sb-save', '');
    this.linkEl = el('span', 'sb-link', '');
    const left = el('div', 'sb-group'); left.append(this.posEl, this.rangeEl, this.selEl);
    const mid = el('div', 'sb-group sb-mid'); mid.append(this.hintEl);
    const right = el('div', 'sb-group'); right.append(this.earEl, this.saveEl, this.linkEl);
    host.append(left, mid, right);

    const { bus } = app;
    bus.on('clip:selected', () => this.paintSel());
    bus.on('lane:selected', () => this.paintSel());
    bus.on('asset:selected', () => this.paintSel());
    bus.on('overlap:selected', () => this.paintSel());
    bus.on('project:replaced', () => { this.dirtySince = null; this.paintSel(); this.paintSave(); this.paintEar(); });
    bus.on('arrangement:changed', () => this.paintSave());
    bus.on('lanes:changed', () => this.paintSave());
    bus.on('project:saved', () => { this.dirtySince = null; this.paintSave(); });
    bus.on('ear:profiled', () => this.paintEar());
    bus.on('bridge:status', ({ connected }) => { this.app.bridgeStatus = connected ? 'connected' : 'off'; this.paintLink(); });
    bus.on('ui:hint', ({ text }) => { this.hintEl.textContent = text || ''; });
    this.dirtySince = null;
    for (const t of ['arrangement:changed', 'lanes:changed', 'notes:changed', 'track:changed', 'settings:changed']) bus.on(t, () => { if (!this.dirtySince) this.dirtySince = Date.now(); this.paintSave(); });
    this.paintSel(); this.paintEar(); this.paintSave(); this.paintLink();
  }
  onFrame(pos) {
    const s = pos?.sec ?? this.app.transport.songPos ?? 0;
    const t = fmtTime(s);
    if (this.posEl.textContent !== t) this.posEl.textContent = t;
    const r = this.app.timeline?.range;
    const rt = r ? `⇧ ${fmtTime(r.a)} – ${fmtTime(r.b)}  (${(r.b - r.a).toFixed(2)}s)` : '';
    if (this.rangeEl.textContent !== rt) this.rangeEl.textContent = rt;
  }
  paintSel() {
    const tl = this.app.timeline, p = this.store.project;
    let s = '';
    if (tl?.selectedOverlap) s = `overlap ${fmtTime(tl.selectedOverlap.a)}–${fmtTime(tl.selectedOverlap.b)}`;
    else if (tl?.multi?.length > 1) s = `${tl.multi.length} clips`;
    else if (tl?.selected != null) { const pl = p.arrangement?.placements[tl.selected]; const c = pl && p.clips[pl.clip]; s = c ? `clip ${c.name || c.id}` : ''; }
    else if (tl?.selectedLane) { const l = p.arrangement?.lanes?.find(x => x.id === tl.selectedLane); s = `lane ${l?.name || tl.selectedLane}`; }
    else if (this.app.assetBin?.selectedAsset) s = `source ${p.assets[this.app.assetBin.selectedAsset]?.name || this.app.assetBin.selectedAsset}`;
    this.selEl.textContent = s;
  }
  paintEar() {
    const ear = this.app.ear; if (!ear) { this.earEl.textContent = ''; return; }
    const ids = Object.keys(this.store.project.assets || {});
    const done = ids.filter(id => ear.hasProfile(id)).length;
    this.earEl.textContent = ids.length ? (done === ids.length ? `ear ✓ ${done}` : `ear ${done}/${ids.length}`) : '';
    this.earEl.title = 'Sources profiled by the ear (pitch/level/tone). Range queries inside a profiled source answer instantly.';
  }
  paintSave() {
    let path = this.app.projectPath; try { path = path || localStorage.getItem('oscine.lastProjectPath'); } catch {}
    const isArr = !!this.store.project.arrangement?.placements?.length;
    const d = this.dirtySince;
    this.saveEl.textContent = (path && isArr) ? (d ? '● unsaved' : '○ saved') : '';
    this.saveEl.classList.toggle('dirty', !!d);
    this.saveEl.title = path ? `${path}${d ? ' — ⌘S to save' : ''}` : 'Not a file project';
  }
  paintLink() {
    const st = this.app.bridgeStatus || (this.app.api?.bridge?.connected ? 'connected' : null);
    this.linkEl.textContent = st === 'connected' ? '● sidecar' : '○ no sidecar';
    this.linkEl.classList.toggle('on', st === 'connected');
  }
}
