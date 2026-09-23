// Clip inspector: the right panel's view when a timeline placement is
// selected. Every field is the raw clip/placement value with a NumberDrag
// (drag up/down, ⇧ for fine, double-click resets) -- there is no separate
// "properties" model; this edits project.clips[id] and the placement in
// place, exactly like a timeline drag does, then emits the same events so
// the timeline repaints and the transport picks it up on next play.

import { el, NumberDrag, Btn } from './widgets.js';
import { wordsFor } from '../core/assets.js';
import { keymap } from '../core/keymap.js';
import { analyzeSpan, compareSpans, describe, describeDelta } from '../engine/ear.js';

const fmt = (d = 2) => v => Number(v).toFixed(d);
const fmtDb = v => `${v > 0 ? '+' : ''}${Number(v).toFixed(1)}`;
const fmtTime = v => { const m = Math.floor(v / 60), s = (v % 60).toFixed(2).padStart(5, '0'); return `${m}:${s}`; };

// Source (asset) inspector: rename, see every clip that references it, and
// the word-level transcript (asset.words = [{s,e,t}] in SOURCE seconds).
// Clicking a word seeks the song: the word's source time is mapped through
// the first placement whose clip window contains it. Words no placement
// covers are shown dim (they're in the file but not in the song).
export class AssetInspector {
  constructor(host, app) {
    this.app = app;
    this.store = app.store;
    this.host = host;
    app.bus.on('asset:selected', () => this.render());
    app.bus.on('arrangement:changed', () => this.refresh());
  }

  get selection() {
    const id = this.app.assetBin?.selectedAsset;
    const asset = id && this.store.project.assets[id];
    if (!asset || !this.app.timeline?.active) return null;
    const arr = this.store.project.arrangement;
    const refs = arr.placements.map((p, i) => ({ p, i, clip: this.store.project.clips[p.clip] }))
      .filter(r => r.clip?.sourceOf === asset.id);
    return { asset, refs };
  }

  // Source second -> song second via the first placement covering it, or null.
  songTimeFor(refs, s) {
    for (const { p, clip } of refs) {
      if (s >= clip.in && s < clip.out) {
        return p.at + (s - clip.in) * (clip.stretch ?? 1) / (clip.rate ?? 1);
      }
    }
    return null;
  }

  refresh() {
    const sel = this.selection;
    if (!sel) return;
    if (this.renderedFor !== sel.asset.id) return this.render();
    // Coverage may have changed (clip moved/trimmed): re-dim words cheaply.
    this.host.querySelectorAll('.asset-word').forEach(el => {
      const s = Number(el.dataset.s);
      el.classList.toggle('uncovered', this.songTimeFor(sel.refs, s) == null);
    });
  }

  render() {
    const { host, store } = this;
    const sel = this.selection;
    this.renderedFor = sel?.asset.id ?? null;
    if (!sel) return false;
    host.textContent = '';
    const { asset, refs } = sel;
    const tl = this.app.timeline;

    const head = el('div', 'panel-head');
    const nameIn = el('input', 'song-name lane-name');
    nameIn.value = asset.name || asset.id;
    nameIn.spellcheck = false;
    nameIn.placeholder = asset.id;
    nameIn.addEventListener('change', () => {
      store.checkpoint();
      const v = nameIn.value.trim();
      if (v) asset.name = v; else delete asset.name;
      this.app.assetBin.render();
      this.app.bus.emit('arrangement:changed', {});
    });
    head.appendChild(nameIn);
    host.appendChild(head);

    const v = asset.variants?.default;
    const meta = el('div', 'clip-meta');
    meta.appendChild(el('div', 'clip-meta-row', `id  ${asset.id}`));
    meta.appendChild(el('div', 'clip-meta-row', `${fmtTime(asset.duration)} · ${asset.kind}${v?.ext ? ' · ' + v.ext : ''}`));
    if (v?.sha256) { const r = el('div', 'clip-meta-row', `sha256  ${v.sha256.slice(0, 16)}…`); r.title = v.sha256; meta.appendChild(r); }
    host.appendChild(meta);

    // Clips referencing this source
    const g1 = el('div', 'insp-group'); g1.appendChild(el('div', 'insp-group-title', `Used by ${refs.length} clip${refs.length === 1 ? '' : 's'}`));
    const list = el('div', 'lane-clips');
    const laneById = id => store.project.arrangement.lanes?.find(l => l.id === id);
    for (const { p, i, clip } of refs.sort((a, b) => a.p.at - b.p.at)) {
      const item = el('div', 'lane-clip', `${fmtTime(p.at)}  ${clip.name || clip.id}  [${fmtTime(clip.in)}–${fmtTime(clip.out)}]`);
      item.style.borderLeft = `3px solid ${laneById(p.track)?.color || '#7aa2ff'}`;
      item.title = laneById(p.track)?.name || p.track;
      item.addEventListener('click', () => { this.app.assetBin.selectedAsset = null; tl.selected = i; tl.dirty = true; this.app.bus.emit('asset:selected', { id: null }); this.app.bus.emit('clip:selected', { index: i }); });
      list.appendChild(item);
    }
    if (!refs.length) list.appendChild(el('div', 'clip-hint', 'Not placed anywhere yet — drag it onto a lane.'));
    g1.appendChild(list); host.appendChild(g1);

    // Transcript
    const words = asset.words || [];
    const g2 = el('div', 'insp-group');
    g2.appendChild(el('div', 'insp-group-title', words.length ? `Transcript · ${words.length} words` : 'Transcript'));
    if (!words.length) {
      g2.appendChild(el('div', 'clip-hint', asset.kind === 'audio'
        ? 'No word timings on this source. Run scripts/words_into_project.py to add a whisper transcript.'
        : 'No transcript.'));
    } else {
      const flow = el('div', 'asset-words');
      let lastEnd = 0;
      for (const w of words) {
        if (w.s - lastEnd > 1.5) flow.appendChild(el('span', 'asset-gap', ' · '));
        const span = el('span', 'asset-word', w.t);
        span.dataset.s = w.s;
        const song = this.songTimeFor(refs, w.s);
        span.title = `source ${fmtTime(w.s)}${song != null ? ` → song ${fmtTime(song)}` : ' (not in the song)'}`;
        span.classList.toggle('uncovered', song == null);
        span.addEventListener('click', () => {
          const t = this.songTimeFor(sel.refs, w.s);
          if (t == null) return;
          this.app.transport.songPos = t;
          tl.dirty = true;
          flow.querySelectorAll('.asset-word.current').forEach(x => x.classList.remove('current'));
          span.classList.add('current');
        });
        flow.appendChild(span);
        flow.appendChild(document.createTextNode(' '));
        lastEnd = w.e;
      }
      g2.appendChild(flow);
    }
    host.appendChild(g2);
    host.appendChild(el('div', 'clip-hint', 'Click a word to seek · dim words aren\'t placed in the song'));
    return true;
  }
}

// Range inspector -- "the ear". When a time range is set and a lane is
// clicked inside it, this measures exactly the audio that lane plays across
// the range (through every placement's in/out/stretch/gain) and says what a
// listener would say: pitch, level, tone, pace. Pin a measurement as A and
// the next becomes B with the deltas. Nothing here is a guess; every number
// comes from the decoded samples.
export class RangeInspector {
  constructor(host, app) {
    this.app = app; this.store = app.store; this.host = host;
    this.pinned = null; // { label, result }
    app.bus.on('clip:selected', () => this.render());
    app.bus.on('range:changed', () => this.render());
  }
  get selection() {
    const tl = this.app.timeline;
    if (!tl?.active || !tl.range || !tl.multi?.length) return null;
    const laneId = this.store.project.arrangement.placements[tl.multi[0]]?.track;
    return { range: tl.range, laneId, indices: tl.multi };
  }
  // Render the lane's audio across the range into one mono Float32Array by
  // pulling from decoded buffers -- same arithmetic as ClipPlayer.start.
  async bounceSpan({ range, indices }) {
    const arr = this.store.project.arrangement, proj = this.store.project;
    const cache = this.app.assetCache;
    const sr = 44100, n = Math.max(1, Math.round((range.b - range.a) * sr));
    const out = new Float32Array(n);
    const words = [];
    for (const i of indices) {
      const p = arr.placements[i], c = proj.clips[p.clip]; if (!c) continue;
      let buf = await cache.getBuffer(proj, c.sourceOf, c.representation);
      const st = c.stretch ?? 1, rate = c.rate ?? 1, sp = st / rate;
      const gain = Math.pow(10, (c.gainDb || 0) / 20);
      const bsr = buf.sampleRate, chans = buf.numberOfChannels;
      const data = []; for (let ch = 0; ch < chans; ch++) data.push(buf.getChannelData(ch));
      for (let k = 0; k < n; k++) {
        const t = range.a + k / sr;              // song time
        const rel = t - p.at; if (rel < 0) continue;
        const srcT = c.in + rel / sp; if (srcT >= c.out) break;
        const j = Math.floor(srcT * bsr); if (j >= data[0].length) break;
        let s = 0; for (let ch = 0; ch < chans; ch++) s += data[ch][j];
        out[k] += (s / chans) * gain;
      }
      for (const w of wordsFor(proj, c)) {
        const s = p.at + w.start * sp - range.a, e = p.at + w.end * sp - range.a;
        if (e > 0 && s < range.b - range.a) words.push({ start: s, end: e, word: w.word });
      }
    }
    return { x: out, sr, words: words.sort((a, b) => a.start - b.start) };
  }
  render() {
    const { host } = this;
    const sel = this.selection;
    if (!sel) return false;
    host.textContent = '';
    const lane = this.store.project.arrangement.lanes?.find(l => l.id === sel.laneId);
    const head = el('div', 'panel-head');
    const title = el('div', 'panel-title', `${lane?.name || sel.laneId} · ${fmtTime(sel.range.a)}–${fmtTime(sel.range.b)}`);
    title.style.color = lane?.color || '';
    head.appendChild(title); host.appendChild(head);
    const body = el('div', 'ear-body');
    body.appendChild(el('div', 'clip-hint', 'listening…'));
    host.appendChild(body);
    const key = `${sel.laneId}:${sel.range.a.toFixed(3)}:${sel.range.b.toFixed(3)}`;
    this.pending = key;
    this.bounceSpan(sel).then(({ x, sr, words }) => {
      if (this.pending !== key) return;
      const r = analyzeSpan(x, sr, { words });
      body.textContent = '';
      const lines = el('div', 'ear-lines');
      for (const l of describe(r, 'range')) lines.appendChild(el('div', 'ear-line', l));
      body.appendChild(lines);
      if (r.pace?.text) { const t = el('div', 'ear-text', r.pace.text); t.title = 'words the source transcript places in this range'; body.appendChild(t); }
      // pitch contour sparkline
      if (r.pitch?.track?.length) {
        const cv = el('canvas', 'ear-spark'); cv.width = 300; cv.height = 48; body.appendChild(cv);
        const g = cv.getContext('2d'); g.fillStyle = '#11141c'; g.fillRect(0, 0, 300, 48);
        const v = r.pitch.track.filter(p => p.hz && p.clarity > 0.6);
        if (v.length) {
          const lo = r.pitch.lowMidi - 2, hi = r.pitch.highMidi + 2;
          g.fillStyle = lane?.color || '#5ce0a8';
          for (const p of r.pitch.track) {
            if (!p.hz || p.clarity <= 0.6) continue;
            const m = 69 + 12 * Math.log2(p.hz / 440);
            g.fillRect(p.t / r.duration * 300, 48 - (m - lo) / (hi - lo) * 48, 2, 2);
          }
          g.fillStyle = '#8891a5'; g.font = '9px system-ui'; g.fillText(r.pitch.high, 2, 9); g.fillText(r.pitch.low, 2, 46);
        }
      }
      const acts = el('div', 'clip-actions');
      acts.appendChild(Btn(this.pinned ? 'Pin as A (replace)' : 'Pin as A', () => { this.pinned = { label: title.textContent, result: r }; this.render(); }));
      if (this.pinned) acts.appendChild(Btn('Clear A', () => { this.pinned = null; this.render(); }));
      body.appendChild(acts);
      if (this.pinned && this.pinned.label !== title.textContent) {
        const d = compareSpans(this.pinned.result, r);
        const cmp = el('div', 'insp-group'); cmp.appendChild(el('div', 'insp-group-title', `vs A · ${this.pinned.label}`));
        for (const l of describeDelta(d, 'A', 'this')) cmp.appendChild(el('div', 'ear-line', l));
        body.appendChild(cmp);
      }
    }).catch(err => { body.textContent = ''; body.appendChild(el('div', 'clip-hint', 'ear: ' + err.message)); });
    return true;
  }
}

// Overlap (crossfade) inspector: the shared span of two clips on one lane.
// Edits the lower clip's fadeOut and the upper clip's fadeIn, plus a
// one-click "equal-power crossfade across the whole overlap".
export class OverlapInspector {
  constructor(host, app) {
    this.app = app; this.store = app.store; this.host = host;
    app.bus.on('overlap:selected', () => this.render());
    app.bus.on('arrangement:changed', () => { if (this.app.timeline?.selectedOverlap) this.render(); });
  }
  get selection() {
    const tl = this.app.timeline, o = tl?.selectedOverlap;
    if (!o || !tl.active) return null;
    const arr = this.store.project.arrangement;
    const lower = arr.placements[o.lower], upper = arr.placements[o.upper];
    const lo = lower && this.store.project.clips[lower.clip], up = upper && this.store.project.clips[upper.clip];
    if (!lo || !up) return null;
    return { o, lower, upper, lo, up, len: o.b - o.a };
  }
  render() {
    const { host, store } = this;
    const sel = this.selection;
    if (!sel) return false;
    host.textContent = '';
    const { o, lo, up, len } = sel;
    const tl = this.app.timeline;
    const commit = () => { this.app.bus.emit('arrangement:changed', {}); tl.peaks.clear(); tl.dirty = true; };

    const head = el('div', 'panel-head');
    head.appendChild(el('div', 'panel-title', 'Overlap'));
    host.appendChild(head);
    const meta = el('div', 'clip-meta');
    meta.appendChild(el('div', 'clip-meta-row', `${fmtTime(o.a)} – ${fmtTime(o.b)}  (${len.toFixed(2)} s)`));
    meta.appendChild(el('div', 'clip-meta-row', `under  ${lo.name || lo.id}`));
    meta.appendChild(el('div', 'clip-meta-row', `over   ${up.name || up.id}`));
    host.appendChild(meta);

    const g = el('div', 'insp-group'); g.appendChild(el('div', 'insp-group-title', 'Crossfade'));
    const grid = el('div', 'clip-grid'); g.appendChild(grid); host.appendChild(g);
    let armed = false;
    const field = (label, clip, key, title) => {
      const row = el('div', 'clip-row'); row.appendChild(el('span', 'clip-label', label));
      const w = NumberDrag({
        value: clip[key] || 0, min: 0, max: len, step: 0.01, format: v => Number(v).toFixed(2), suffix: ' s', title,
        onInput: v => { if (!armed) { store.checkpoint(); armed = true; } clip[key] = Math.min(len, Math.max(0, v)); tl.dirty = true; },
        onCommit: () => { armed = false; commit(); },
      });
      w.root.classList.add('clip-value'); row.appendChild(w.root); grid.appendChild(row);
    };
    field('fade out (under)', lo, 'fadeOut', 'The earlier clip fades out over this many seconds before the overlap ends');
    field('fade in (over)', up, 'fadeIn', 'The later clip fades in over this many seconds from the overlap start');

    const actions = el('div', 'clip-actions');
    actions.appendChild(Btn('Crossfade whole overlap', () => { store.checkpoint(); lo.fadeOut = len; up.fadeIn = len; commit(); this.render(); }));
    actions.appendChild(Btn('No fades', () => { store.checkpoint(); delete lo.fadeOut; delete up.fadeIn; lo.fadeOut = 0; up.fadeIn = 0; commit(); this.render(); }));
    host.appendChild(actions);
    const resolve = el('div', 'clip-actions');
    resolve.appendChild(Btn('Trim under to overlap start', () => { store.checkpoint(); const st = (lo.stretch ?? 1) / (lo.rate ?? 1); lo.out = lo.in + (o.a - sel.lower.at) / st; tl.selectedOverlap = null; commit(); this.app.bus.emit('overlap:selected', { overlap: null }); }));
    resolve.appendChild(Btn('Trim over to overlap end', () => { store.checkpoint(); const st = (up.stretch ?? 1) / (up.rate ?? 1); const cut = up.in + (o.b - sel.upper.at) / st; up.in = cut; sel.upper.at = o.b; tl.selectedOverlap = null; commit(); this.app.bus.emit('overlap:selected', { overlap: null }); }));
    host.appendChild(resolve);
    host.appendChild(el('div', 'clip-hint', 'Both clips play through the overlap; fades shape the blend. Trim buttons remove the overlap instead.'));
    return true;
  }
}

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
    if (!sel) return; // not ours to draw; the parent Inspector owns the host
    if (this.renderedFor !== sel.lane.id) return this.render();
    this.gainW?.set(sel.lane.gainDb ?? 0);
    this.muteB?.classList.toggle('on', !!sel.lane.mute);
    this.soloB?.classList.toggle('on', !!sel.lane.solo);
  }

  render() {
    const { host, store } = this;
    const sel = this.selection;
    this.renderedFor = sel?.lane.id ?? null;
    if (!sel) return false;
    host.textContent = '';
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
    if (!sel) return; // not ours to draw; the parent Inspector owns the host
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
    const sel = this.selection;
    this.renderedFor = sel?.clip.id ?? null;
    if (!sel) return false;
    host.textContent = '';
    this.widgets.clear();
    const { placement, clip, asset } = sel;
    const { store } = this;

    const lane = store.project.arrangement.lanes?.find(l => l.id === placement.track);
    const color = lane?.color || '#7aa2ff';

    const head = el('div', 'panel-head');
    const title = el('input', 'song-name lane-name');
    title.value = clip.name || clip.id;
    title.placeholder = clip.id;
    title.spellcheck = false;
    title.style.color = color;
    title.title = 'Clip name — edit and press Enter';
    title.addEventListener('change', () => {
      store.checkpoint();
      const v = title.value.trim();
      if (v && v !== clip.id) clip.name = v; else delete clip.name;
      this.app.timeline.dirty = true;
      this.app.bus.emit('arrangement:changed', {});
    });
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
        if (o.clampTo) { const [lo, hi] = o.clampTo(); v = Math.max(lo, Math.min(hi, v)); w.set(v); }
        if (key === 'at') placement.at = v;
        else if (o.default !== undefined && Math.abs(v - o.default) < 1e-9) delete clip[key];
        else clip[key] = v;
      };
      const row = el('div', 'clip-row');
      row.appendChild(el('span', 'clip-label', label));
      let w;
      w = NumberDrag({
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
    field(g1, 'in', 'in', { min: 0, max: asset?.duration ?? 36000, step: 0.01, format: fmtTime, title: 'Source in-point', clampTo: () => [0, clip.out - 0.05] });
    field(g1, 'out', 'out', { min: 0, max: asset?.duration ?? 36000, step: 0.01, format: fmtTime, title: 'Source out-point', clampTo: () => [clip.in + 0.05, asset?.duration ?? 36000] });

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

    // Words inside this clip's window (from the source's transcript), in
    // song time. Click = seek. This is the seek-by-lyric the words exist for.
    const words = wordsFor(store.project, clip);
    if (words.length) {
      const g4 = section(`Words · ${words.length}`);
      const flow = el('div', 'asset-words');
      const st = (clip.stretch ?? 1) / (clip.rate ?? 1);
      let lastEnd = 0;
      for (const w of words) {
        if (w.start - lastEnd > 1.5) flow.appendChild(el('span', 'asset-gap', ' · '));
        const span = el('span', 'asset-word', w.word);
        const t = placement.at + w.start * st;
        span.title = fmtTime(t);
        span.addEventListener('click', () => {
          this.app.transport.songPos = t; this.app.timeline.dirty = true;
          flow.querySelectorAll('.asset-word.current').forEach(x => x.classList.remove('current'));
          span.classList.add('current');
        });
        flow.appendChild(span); flow.appendChild(document.createTextNode(' '));
        lastEnd = w.end;
      }
      g4.appendChild(flow);
    }

    host.appendChild(el('div', 'clip-hint', `Drag values · ⇧ fine · double-click to type · ${keymap.label('clip.split')} split · ${keymap.label('clip.delete')} remove · ${keymap.gestures['timeline.clipSlip']}-drag slips · ${keymap.gestures['timeline.clipStretch']}-drag edge stretches`));
    return true;
  }
}
