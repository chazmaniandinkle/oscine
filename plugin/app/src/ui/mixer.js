// Bottom panel: one strip per track (fader, meter, pan, sends, mute/solo)
// plus a master section with the shared FX controls. Collapsible.

import { el, Knob, Fader, Meter, Select, openMenu } from './widgets.js';
import { DELAY_DIVISIONS } from '../engine/effects/delay.js';
import { listEffectDefs, getEffectDef } from '../engine/effects/index.js';

const fmtDb = v => `${v > 0 ? '+' : ''}${Number(v).toFixed(1)} dB`;

export class Mixer {
  constructor(host, app) {
    this.app = app;
    this.store = app.store;
    this.host = host;
    host.classList.add('mixer');

    this.handle = el('button', 'mixer-handle');
    this.handle.type = 'button';
    // Click toggles; drag (when open) resizes. Distinguish by movement.
    let press = null;
    this.handle.addEventListener('pointerdown', (e) => {
      if (!this.store.ui.mixerOpen) return;
      press = { y: e.clientY, h: this.body.getBoundingClientRect().height, moved: false };
      this.handle.setPointerCapture(e.pointerId);
    });
    this.handle.addEventListener('pointermove', (e) => {
      if (!press) return;
      const dy = press.y - e.clientY; // drag up = taller
      if (Math.abs(dy) > 3) press.moved = true;
      if (press.moved) {
        const h = Math.max(120, Math.min(window.innerHeight * 0.6, press.h + dy));
        this.store.ui.mixerHeight = Math.round(h);
        this.host.style.setProperty('--mixer-h', h + 'px');
      }
    });
    this.handle.addEventListener('pointerup', (e) => {
      const wasDrag = press?.moved; press = null;
      try { this.handle.releasePointerCapture(e.pointerId); } catch {}
      if (wasDrag) { e.preventDefault(); this._suppressClick = true; }
    });
    this.handle.addEventListener('click', () => {
      if (this._suppressClick) { this._suppressClick = false; return; }
      this.store.ui.mixerOpen = !this.store.ui.mixerOpen;
      this.paintOpen();
    });
    this.body = el('div', 'mixer-body');
    host.appendChild(this.handle);
    host.appendChild(this.body);

    this.meters = new Map();   // trackId -> Meter
    this.faders = new Map();
    this.widgets = new Map();  // `${trackId}:${key}` -> widget

    const { bus } = app;
    for (const type of ['track:added', 'track:removed', 'track:changed', 'project:replaced', 'ui:selection', 'lane:selected']) {
      bus.on(type, () => this.render());
    }
    // Lane order / count changed in the timeline (reorder drag, + lane,
    // remove lane): rebuild the strips so they match the gutter.
    bus.on('arrangement:changed', () => {
      const arr = this.store.project.arrangement; if (!arr?.placements?.length) return;
      const want = (arr.lanes ?? []).map(l => l.id).join(',');
      const have = [...this.body.querySelectorAll('.lane-strip')].map(s => s.dataset.strip).join(',');
      if (want !== have) this.render();
    });
    // Lane gutter edits (gain/M/S in the timeline) reflect here without a rebuild.
    bus.on('lanes:changed', () => {
      if (!this.store.project.arrangement?.placements?.length) return;
      for (const lane of this.store.project.arrangement.lanes ?? []) {
        const strip = this.body.querySelector(`[data-strip="${lane.id}"]`); if (!strip) continue;
        this.faders.get(lane.id)?.set(Math.max(0, Math.min(1, ((lane.gainDb ?? 0) + 60) / 72)));
        strip.querySelector('.strip-db') && (strip.querySelector('.strip-db').textContent = fmtDb(lane.gainDb ?? 0));
        strip.querySelector('.ms-m')?.classList.toggle('on-warn', !!lane.mute);
        strip.querySelector('.ms-s')?.classList.toggle('on-accent', !!lane.solo);
      }
    });
    bus.on('channel:changed', ({ trackId, key }) => {
      const t = this.store.getTrack(trackId);
      if (!t) return;
      if (key === 'gain') this.faders.get(trackId)?.set(t.channel.gain);
      this.widgets.get(`${trackId}:${key}`)?.set(t.channel[key]);
      if (key === 'mute' || key === 'solo') this.paintMuteSolo(trackId);
    });
    bus.on('fx:changed', ({ key, value }) => this.widgets.get('fx:' + key)?.set(value));
    bus.on('settings:changed', ({ key }) => {
      if (key === 'masterVolume') this.widgets.get('masterVolume')?.set(this.store.project.masterVolume);
    });

    this.paintOpen();
    this.render();
  }

  paintOpen() {
    const open = this.store.ui.mixerOpen;
    this.host.classList.toggle('open', open);
    this.handle.textContent = open ? 'Mixer ▾  (drag to resize)' : 'Mixer ▴';
    if (this.store.ui.mixerHeight) this.host.style.setProperty('--mixer-h', this.store.ui.mixerHeight + 'px');
  }

  paintMuteSolo(trackId) {
    const t = this.store.getTrack(trackId);
    const strip = this.body.querySelector(`[data-strip="${trackId}"]`);
    if (!t || !strip) return;
    strip.querySelector('.ms-m').classList.toggle('on-warn', t.channel.mute);
    strip.querySelector('.ms-s').classList.toggle('on-accent', t.channel.solo);
  }

  render() {
    const { store } = this;
    this.body.textContent = '';
    this.meters.clear();
    this.faders.clear();
    this.widgets.clear();

    if (store.project.arrangement?.placements?.length) {
      // Arrangement: one strip per lane + master, each with an insert chain.
      for (const lane of store.project.arrangement.lanes ?? []) this.body.appendChild(this.buildLaneStrip(lane));
      this.body.appendChild(this.buildArrMaster());
      return;
    }
    for (const track of store.project.tracks) {
      this.body.appendChild(this.buildStrip(track));
    }
    this.body.appendChild(this.buildMaster());
  }

  // -- arrangement strips ---------------------------------------------------

  // Insert chain UI shared by lane and master strips: one row per effect
  // (name, bypass, remove; click name -> inspector edits its params) and an
  // "+ insert" menu from the registry. Edits are one undo step each.
  // `ownerId` is the lane id or 'master'; every edit is a store action on it
  // (insertAdd/Set/Move/Remove), which emits inserts:changed itself.
  buildInserts(ownerId, ownerLabel) {
    const { store, app } = this;
    const ownerOf = () => {
      const arr = store.project.arrangement;
      return ownerId === 'master' ? (arr?.master ?? { inserts: [] }) : (arr?.lanes?.find(l => l.id === ownerId) ?? { inserts: [] });
    };
    const select = index => app.bus.emit('insert:selected', index == null ? { owner: null } : { owner: ownerOf(), ownerId, ownerLabel, index });
    const box = el('div', 'inserts');
    const paint = () => {
      box.textContent = '';
      const owner = ownerOf();
      (owner.inserts ?? []).forEach((ins, i) => {
        const row = el('div', 'insert-row' + (ins.bypass ? ' byp' : ''));
        let def = null; try { def = getEffectDef(ins.type); } catch {}
        const name = el('button', 'insert-name', def?.label ?? ins.type);
        name.type = 'button'; name.title = 'Edit parameters';
        name.addEventListener('click', () => select(i));
        const byp = el('button', 'btn mini insert-byp' + (ins.bypass ? ' on-warn' : ''), '⏻');
        byp.type = 'button'; byp.title = ins.bypass ? 'Bypassed — click to enable' : 'Enabled — click to bypass';
        byp.addEventListener('click', () => { store.insertSet(ownerId, i, { bypass: !ins.bypass }); paint(); });
        const up = el('button', 'btn mini', '↑'); up.type = 'button'; up.title = 'Move earlier'; up.disabled = i === 0;
        up.addEventListener('click', () => { store.insertMove(ownerId, i, i - 1); paint(); });
        const rm = el('button', 'btn mini insert-rm', '×'); rm.type = 'button'; rm.title = 'Remove';
        rm.addEventListener('click', () => { store.insertRemove(ownerId, i); paint(); select(null); });
        row.append(name, byp, up, rm);
        box.appendChild(row);
      });
      const add = el('button', 'btn mini insert-add', '+ insert'); add.type = 'button';
      add.addEventListener('click', () => {
        const groups = {};
        for (const d of listEffectDefs()) (groups[d.group] ||= []).push(d);
        const items = [];
        for (const [g, defs] of Object.entries(groups)) {
          items.push({ label: g.toUpperCase(), disabled: true });
          for (const d of defs) items.push({ label: '  ' + d.label, onPick: () => { const { insert } = store.insertAdd(ownerId, d.type, {}); paint(); select(insert.index); } });
        }
        openMenu(add, items);
      });
      box.appendChild(add);
    };
    paint();
    return box;
  }

  buildLaneStrip(lane) {
    const { store, app } = this;
    const strip = el('div', 'strip lane-strip');
    strip.dataset.strip = lane.id;
    strip.classList.toggle('selected', lane.id === app.timeline?.selectedLane);
    const name = el('div', 'strip-name', lane.name || lane.id);
    name.style.color = lane.color || '';
    name.title = lane.name || lane.id;
    name.addEventListener('click', () => app.timeline?.selectLane(lane.id));
    strip.appendChild(name);

    // Discrete edits are store actions; knob/fader drags preview through
    // store.gesturePreview and commit ONE undo step on release.
    const redraw = () => { app.timeline && (app.timeline.dirty = true); };
    let ops = null;
    const preview = (next, events) => { try { store.gesturePreview(next, events); ops = next; } catch {} redraw(); };
    const commitGesture = (events) => {
      if (!store.inGesture) { ops = null; return; }
      try { store.gestureCommit(ops ?? [], events); } catch (err) { console.warn('[mixer] gesture rejected:', err.message); }
      ops = null; redraw();
    };
    const knobRow = el('div', 'strip-knobs');
    const pan = Knob({
      label: 'Pan', min: -1, max: 1, value: lane.pan ?? 0, default: 0, small: true, color: lane.color,
      format: v => Math.abs(v) < 0.01 ? 'C' : (v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`),
      onInput: v => preview([['setLane', lane.id, { pan: v }]], ['inserts:changed']),
      onCommit: () => commitGesture(['lanes:changed', 'inserts:changed', 'arrangement:changed']),
    });
    this.widgets.set(`${lane.id}:pan`, pan);
    knobRow.appendChild(pan.root);
    strip.appendChild(knobRow);

    strip.appendChild(this.buildInserts(lane.id, lane.name || lane.id));

    const fadeWrap = el('div', 'strip-fade');
    // Fader in dB: 0..1 maps -60..+12 with unity at ~0.83.
    const toF = db => Math.max(0, Math.min(1, (db + 60) / 72)), toDb = f => f * 72 - 60;
    const fader = Fader({
      value: toF(lane.gainDb ?? 0), default: toF(0),
      onInput: v => { const db = Math.round(toDb(v) * 10) / 10; preview([['setLane', lane.id, { gainDb: db }]], ['lanes:changed']); dbLbl.textContent = fmtDb(db); },
      onCommit: () => commitGesture(['lanes:changed', 'arrangement:changed']),
    });
    this.faders.set(lane.id, fader);
    const meter = Meter();
    this.meters.set(lane.id, meter);
    fadeWrap.appendChild(fader.root);
    fadeWrap.appendChild(meter.root);
    strip.appendChild(fadeWrap);
    const dbLbl = el('div', 'strip-db', fmtDb(lane.gainDb ?? 0));
    strip.appendChild(dbLbl);

    const ms = el('div', 'strip-ms');
    const m = el('button', 'btn mini ms-m' + (lane.mute ? ' on-warn' : ''), 'M');
    const laneNow = () => store.project.arrangement?.lanes?.find(l => l.id === lane.id) ?? lane;
    m.addEventListener('click', () => { const on = !laneNow().mute; store.laneSet(lane.id, { mute: on }); m.classList.toggle('on-warn', on); redraw(); });
    const s = el('button', 'btn mini ms-s' + (lane.solo ? ' on-accent' : ''), 'S');
    s.addEventListener('click', () => { const on = !laneNow().solo; store.laneSet(lane.id, { solo: on }); s.classList.toggle('on-accent', on); redraw(); });
    ms.append(m, s);
    strip.appendChild(ms);
    return strip;
  }

  buildArrMaster() {
    const { store, app } = this;
    const strip = el('div', 'strip lane-strip arr-master');
    strip.appendChild(el('div', 'strip-name', 'Master'));
    strip.appendChild(this.buildInserts('master', 'Master'));
    const fadeWrap = el('div', 'strip-fade');
    const dbOut = el('div', 'strip-db', '');
    const showDb = (v) => { const g = v * 1.2; dbOut.textContent = g > 0 ? `${(20 * Math.log10(g)).toFixed(1)} dB` : '−∞ dB'; };
    const fader = Fader({
      value: store.project.masterVolume / 1.2, default: 0.85 / 1.2,
      onInput: v => { store.setSetting('masterVolume', v * 1.2); showDb(v); },
    });
    this.widgets.set('masterVolume', { set: v => { fader.set(v / 1.2); showDb(v / 1.2); } });
    const meter = Meter();
    this.meters.set('master', meter);
    fadeWrap.append(fader.root, meter.root);
    strip.appendChild(fadeWrap);
    showDb(store.project.masterVolume / 1.2);
    strip.appendChild(dbOut);
    return strip;
  }

  buildStrip(track) {
    const { store } = this;
    const strip = el('div', 'strip');
    strip.dataset.strip = track.id;
    strip.classList.toggle('selected', track.id === store.ui.selectedTrackId);

    const name = el('div', 'strip-name', track.name);
    name.style.color = track.color;
    name.title = track.name;
    name.addEventListener('click', () => store.selectTrack(track.id));
    strip.appendChild(name);

    const knobRow = el('div', 'strip-knobs');
    const mkKnob = (key, label) => {
      const w = Knob({
        label, min: key === 'pan' ? -1 : 0, max: 1,
        value: track.channel[key], default: key === 'pan' ? 0 : 0,
        small: true, color: track.color,
        format: key === 'pan'
          ? v => Math.abs(v) < 0.01 ? 'C' : (v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`)
          : undefined,
        onInput: v => store.setChannel(track.id, key, v),
      });
      this.widgets.set(`${track.id}:${key}`, w);
      knobRow.appendChild(w.root);
    };
    mkKnob('pan', 'Pan');
    mkKnob('sendDelay', 'Dly');
    mkKnob('sendReverb', 'Rev');
    strip.appendChild(knobRow);

    const fadeWrap = el('div', 'strip-fade');
    const fader = Fader({
      value: track.channel.gain, default: 0.8,
      onInput: v => store.setChannel(track.id, 'gain', v),
    });
    this.faders.set(track.id, fader);
    const meter = Meter();
    this.meters.set(track.id, meter);
    fadeWrap.appendChild(fader.root);
    fadeWrap.appendChild(meter.root);
    strip.appendChild(fadeWrap);

    const ms = el('div', 'strip-ms');
    const m = el('button', 'btn mini ms-m' + (track.channel.mute ? ' on-warn' : ''), 'M');
    m.addEventListener('click', () => store.setChannel(track.id, 'mute', !track.channel.mute));
    const s = el('button', 'btn mini ms-s' + (track.channel.solo ? ' on-accent' : ''), 'S');
    s.addEventListener('click', () => store.setChannel(track.id, 'solo', !track.channel.solo));
    ms.appendChild(m);
    ms.appendChild(s);
    strip.appendChild(ms);

    return strip;
  }

  buildMaster() {
    const { store } = this;
    const strip = el('div', 'strip master-strip');
    strip.appendChild(el('div', 'strip-name', 'Master'));

    const fxRow = el('div', 'master-fx');

    const dlyCol = el('div', 'fx-col');
    dlyCol.appendChild(el('div', 'insp-group-title', 'Delay'));
    const divSel = Select({
      options: DELAY_DIVISIONS,
      value: store.project.fx.delayDiv,
      onChange: v => store.setFx('delayDiv', Number(v)),
    });
    this.widgets.set('fx:delayDiv', divSel);
    dlyCol.appendChild(divSel.root);
    const fb = Knob({
      label: 'Fdbk', min: 0, max: 0.9, value: store.project.fx.delayFeedback, default: 0.38, small: true,
      onInput: v => store.setFx('delayFeedback', v),
    });
    this.widgets.set('fx:delayFeedback', fb);
    const dret = Knob({
      label: 'Return', min: 0, max: 1, value: store.project.fx.delayReturn, default: 0.7, small: true,
      onInput: v => store.setFx('delayReturn', v),
    });
    this.widgets.set('fx:delayReturn', dret);
    const dlyKnobs = el('div', 'strip-knobs');
    dlyKnobs.appendChild(fb.root);
    dlyKnobs.appendChild(dret.root);
    dlyCol.appendChild(dlyKnobs);
    fxRow.appendChild(dlyCol);

    const verbCol = el('div', 'fx-col');
    verbCol.appendChild(el('div', 'insp-group-title', 'Reverb'));
    const size = Knob({
      label: 'Size', min: 0.4, max: 6, value: store.project.fx.verbSize, default: 2.2, small: true, unit: 's',
      onInput: v => store.setFx('verbSize', v),
    });
    this.widgets.set('fx:verbSize', size);
    const vret = Knob({
      label: 'Return', min: 0, max: 1, value: store.project.fx.verbReturn, default: 0.8, small: true,
      onInput: v => store.setFx('verbReturn', v),
    });
    this.widgets.set('fx:verbReturn', vret);
    const verbKnobs = el('div', 'strip-knobs');
    verbKnobs.appendChild(size.root);
    verbKnobs.appendChild(vret.root);
    verbCol.appendChild(verbKnobs);
    fxRow.appendChild(verbCol);

    strip.appendChild(fxRow);

    const fadeWrap = el('div', 'strip-fade');
    const fader = Fader({
      value: store.project.masterVolume / 1.2, default: 0.85 / 1.2,
      onInput: v => store.setSetting('masterVolume', v * 1.2),
    });
    this.widgets.set('masterVolume', { set: v => fader.set(v / 1.2) });
    const meter = Meter();
    this.meters.set('master', meter);
    fadeWrap.appendChild(fader.root);
    fadeWrap.appendChild(meter.root);
    strip.appendChild(fadeWrap);

    return strip;
  }

  onFrame() {
    if (!this.store.ui.mixerOpen) return;
    const { engine, transport } = this.app;
    const player = transport.clipPlayer;
    for (const [id, meter] of this.meters) {
      if (player?.strips?.[id]) { this.meterBuf ||= new Float32Array(512); meter.set(player.laneLevel(id, this.meterBuf)); }
      else meter.set(engine.getLevel(id));
    }
  }
}
