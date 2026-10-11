// The control-surface manager (browser): turns the raw MIDI stream into bindings, a live "what did I just touch"
// feed, controller profile detection, discovery (the wizard), and touch-then-click / click-then-touch binding.
// src/ui/midi.js hands every message here FIRST (MidiMap.handle returns true when it consumed the message);
// everything else (notes -> instrument, record-arm) stays in midi.js. The pure logic is in core/midimap.js,
// core/mididiscover.js and core/controllers/; this file is the glue + persistence.
import { decodeMessage, srcKey, srcLabel, lookupKeys, normOf } from '../core/midisrc.js';
import { matchProfile, registerProfile, removeProfile, customProfiles, profileById, GENERIC, controlIndex, allControls } from '../core/controllers/index.js';
import { Discovery } from '../core/mididiscover.js';
import { applyMessage, findBinding, defaultMap, asTarget, targetLabel, describeTarget, cleanMap } from '../core/midimap.js';
import { sidecarUrl } from '../core/sidecar.js';

const LS_PROFILES = 'oscine.midi.profiles';
const LS_AUTOMAP = 'oscine.midi.automap';     // { [profileId]: true } once a device's default map has been applied
const FEED_MAX = 40;

export class MidiMap {
  constructor(app) {
    this.app = app; this.store = app.store; this.bus = app.bus;
    this.state = new Map();                   // per-source runtime for applyMessage (pickup)
    this.feed = [];                           // recent touches: { t, key, label, kind, value, bound, text }
    this.touched = new Map();                 // sourceKey -> { t, v } last values, for the surface's live light-up
    this.discovery = new Discovery();         // the wizard's recorder (reset when it starts)
    this.heard = new Discovery();             // always on: what this device has sent so far (draws an unknown device)
    this.armedSlot = null;                    // an unassigned layout slot waiting for the control to be touched
    this.armedSource = null;                  // bind mode: the hardware source waiting for a UI control
    this.armedTarget = null;                  // bind mode: the UI control waiting for a hardware touch
    this.profile = null;
    this.deviceName = null;
    this.ctx = () => ({ store: this.store, transport: this.app.transport, engine: this.app.engine, api: this.app.api });
    this.loadLocal();
    this.loadRemote();
    this.autoDefault = true;
  }

  // -- profiles: local cache + the sidecar's saved copies ------------------------------------------------------------
  loadLocal() {
    try { for (const p of JSON.parse(localStorage.getItem(LS_PROFILES) || '[]')) registerProfile(p); } catch { /* corrupt blob */ }
  }
  saveLocal() {
    try { localStorage.setItem(LS_PROFILES, JSON.stringify(customProfiles())); } catch { /* quota */ }
  }
  async loadRemote() {
    if (typeof fetch !== 'function') return;
    try {
      const res = await fetch(sidecarUrl('/controllers'));
      if (!res.ok) return;
      const { profiles } = await res.json();
      for (const p of profiles || []) registerProfile(p);
      this.saveLocal();
      this.detect(this.deviceName, this.maker);          // a saved profile may now match the bound device
    } catch { /* no sidecar (hosted copy): the local cache still works */ }
  }
  async saveProfile(p) {
    registerProfile(p); this.saveLocal();
    try {
      await fetch(sidecarUrl('/controllers/' + encodeURIComponent(p.id)), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
    } catch { /* offline: stays in this browser */ }
    this.bus.emit('midi:profiles', {});
  }
  async deleteProfile(id) {
    removeProfile(id); this.saveLocal();
    try { await fetch(sidecarUrl('/controllers/' + encodeURIComponent(id)), { method: 'DELETE' }); } catch { /* ignore */ }
    this.detect(this.deviceName, this.maker);
    this.bus.emit('midi:profiles', {});
  }

  // -- detection -------------------------------------------------------------------------------------------------
  // Called by midi.js whenever the bound input changes (and when profiles load). Applies the device's default map
  // ONCE per profile per browser, and only into an empty map slot, so it never overwrites something Chaz bound.
  detect(name, maker = '') {
    this.deviceName = name || null; this.maker = maker || '';
    const p = name ? (matchProfile(name, maker) || { ...GENERIC, name: name }) : null;
    this.profile = p;
    this.store.reportMidi({ profile: p ? { id: p.id, name: p.name, maker: p.maker || maker || '', verified: !!p.verified, generic: !!p.generic, custom: !!p.custom } : null });
    if (p && !p.generic && this.autoDefault) this.applyDefaults(p, false);
    this.bus.emit('midi:surface', {});
  }

  // force=false: first time this profile is seen on this browser, fill only unbound sources. force=true: "reset to
  // the device's default map" from the surface panel.
  applyDefaults(p, force) {
    let done = {}; try { done = JSON.parse(localStorage.getItem(LS_AUTOMAP) || '{}'); } catch { /* */ }
    if (!force && done[p.id]) return 0;
    const map = defaultMap(p), cur = this.store.ui.midi.knobs;
    let n = 0;
    for (const [k, v] of Object.entries(map)) if (force || cur[k] == null) { cur[k] = v; n++; }
    if (n) this.store.configureMidi({ knobs: cur });
    done[p.id] = true; try { localStorage.setItem(LS_AUTOMAP, JSON.stringify(done)); } catch { /* */ }
    return n;
  }

  // -- the message path ------------------------------------------------------------------------------------------
  // Returns true when the message was fully consumed (a bound control, or discovery/bind-mode capture) so midi.js
  // doesn't also play it as a note. Notes that have no binding return false: they play the instrument as before.
  handle(bytes) {
    const msg = decodeMessage(bytes);
    if (!msg) return false;
    const key = srcKey({ t: msg.t, n: msg.n, ch: msg.ch });
    const bare = srcKey({ t: msg.t, n: msg.n });
    if (!(msg.t === 'note' && msg.on === false)) this.touched.set(bare, { t: performance.now(), v: normOf(msg), ch: msg.ch });
    if (this.profile?.generic) { const had = this.heard.seen.size; this.heard.feed(bytes); if (this.heard.seen.size !== had) this.bus.emit('midi:surface', {}); }
    if (this.armedSlot && !(msg.t === 'note' && !msg.on)) { this.fillSlot(msg); return true; }
    if (this.store.ui.midi.wizard?.on) { this.discovery.feed(bytes); this.syncWizard(); }
    if (this.store.ui.midi.learnParam && msg.t === 'cc') return false;   // legacy "learn this param": midi.js control() rebinds it

    // bind mode: touching hardware with no UI target picked yet arms the hardware source; with a UI target waiting
    // it completes the binding. Notes only arm on a deliberate press (note-on), and only count as a "control" when
    // the user is in bind mode (otherwise notes keep playing the instrument).
    if (this.store.ui.midi.bindMode && !(msg.t === 'note' && !msg.on)) {
      const src = this.bindKeyFor(msg);
      if (this.armedTarget) { this.completeBind(src, this.armedTarget); this.armedTarget = null; this.paintBind(); return true; }
      if (!this.armedSource || this.armedSource.key !== src.key) { this.armedSource = src; this.paintBind(); }
      this.noteFeed(src.key, msg, null);
      return true;
    }

    const b = findBinding(this.store.ui.midi.knobs, msg);
    if (!b) {
      if (msg.t === 'note') return false;                          // unbound note: plays the instrument as before
      this.noteFeed(key, msg, null);                               // unbound CC / bend / pressure: shown, nothing else to do
      return false;
    }
    const r = applyMessage(this.ctx(), this.state, b.key, b.entry, msg);
    if (!(msg.t === 'note' && !msg.on)) this.noteFeed(b.key, msg, r);
    return r.handled;                                              // a bound pad is a control now, not a note
  }

  // The source key to bind for a message: channel-specific for notes on a non-omni device so two pads with the same
  // number on different channels stay distinct; bare for everything else (channel-agnostic like the legacy map).
  bindKeyFor(msg) {
    const key = srcKey({ t: msg.t, n: msg.n, ch: msg.t === 'note' && msg.ch !== 1 ? msg.ch : undefined });
    return { key, t: msg.t, n: msg.n, ch: msg.ch, label: srcLabel({ t: msg.t, n: msg.n }), kind: msg.t };
  }

  noteFeed(key, msg, r) {
    // Name it the way the controller's own layout does ("K3", "P5") when the profile knows the source.
    const known = this.profile && !this.profile.generic ? (controlIndex(this.profile).get(key) || controlIndex(this.profile).get(key.split('@')[0])) : null;
    const e = { t: Date.now(), key, label: known ? known.control.label : srcLabel(key), v: normOf(msg), bound: r ? (r.desc ? r.desc.label : null) : null, waiting: !!r?.waiting };
    this.feed.push(e); if (this.feed.length > FEED_MAX) this.feed.shift();
    this.bus.emit('midi:touch', e);
  }

  // -- bind mode: any element carrying data-midi='<target json>' is a bindable UI control ---------------------------
  attachBindTargets() {
    if (this._bindAttached || typeof document === 'undefined') return;
    this._bindAttached = true;
    const find = (e) => e.target?.closest?.('[data-midi]');
    document.addEventListener('pointerdown', (e) => {
      if (!this.store.ui.midi.bindMode) return;
      if (e.target.closest?.('.msurf, .menu')) return;                    // the panel itself keeps working
      const hit = find(e); if (!hit) return;
      let target; try { target = JSON.parse(hit.dataset.midi); } catch { return; }
      e.preventDefault(); e.stopImmediatePropagation(); this._swallow = true;
      this.pickTarget(target, hit.dataset.midiLabel || hit.title || '');
    }, true);
    const swallow = (e) => { if (this._swallow) { e.preventDefault(); e.stopImmediatePropagation(); if (e.type === 'click') this._swallow = false; } };
    document.addEventListener('click', swallow, true);
    document.addEventListener('dblclick', (e) => { if (this.store.ui.midi.bindMode && find(e)) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
    this.bus.on('midi:config', () => this.paintBound());
    this.bus.on('midi:bound', (b) => { this.paintBound(); try { import('./widgets.js').then((w) => w.toast(b.text)); } catch { /* */ } });
    this.bus.on('project:replaced', () => setTimeout(() => this.paintBound(), 50));
    setTimeout(() => this.paintBound(), 300);
  }
  // Mark every bindable element that already has a binding (so you can see what's taken while binding).
  paintBound() {
    if (typeof document === 'undefined') return;
    const bound = new Set(Object.values(this.store.ui.midi.knobs).map((v) => { const t = asTarget(v); return t ? stableTarget(t) : null; }).filter(Boolean));
    for (const n of document.querySelectorAll('[data-midi]')) {
      let t = null; try { t = JSON.parse(n.dataset.midi); } catch { /* */ }
      n.classList.toggle('midi-bound', !!t && bound.has(stableTarget(t)));
    }
  }

  // -- bind mode -----------------------------------------------------------------------------------------------------
  // Touch hardware then click a UI control, or click a UI control then touch hardware. UI controls announce
  // themselves through app.midiMap.bindTargetFor(el, target) (see attachBindTargets): a click in bind mode on any
  // element that carries a data-bind attribute picks it.
  setBindMode(on) {
    this.armedSource = null; this.armedTarget = null;
    this.store.reportMidi({ bindMode: !!on });
    this.paintBind();
    this.bus.emit('midi:config', {});
  }
  paintBind() {
    const on = this.store.ui.midi.bindMode;
    document.body.classList.toggle('midi-binding', !!on);
    document.body.classList.toggle('midi-bind-armed', !!(on && this.armedSource));
    this.bus.emit('midi:bind', { armedSource: this.armedSource, armedTarget: this.armedTarget });
  }
  // A UI control was clicked while binding. target = a target object (core/midimap.js).
  pickTarget(target, label) {
    if (!this.store.ui.midi.bindMode) return false;
    if (this.armedSource) { this.completeBind(this.armedSource, target); this.armedSource = null; this.paintBind(); return true; }
    this.armedTarget = target; this.armedTargetLabel = label || ''; this.paintBind();
    return true;
  }
  completeBind(src, target) {
    const entry = { ...target };
    if (src.t === 'cc' && this.isRelative(src.key)) entry.rel = this.isRelative(src.key);
    this.store.bindMidi(src.key, entry);
    this.state.delete(src.key);
    const text = `${src.label} → ${targetLabel(this.ctx(), entry)}`;
    this.bus.emit('midi:bound', { key: src.key, entry, text });
  }
  // Known relative encoder in the detected profile (so binding it doesn't treat 65/63 as positions).
  isRelative(key) {
    if (!this.profile) return null;
    return controlIndex(this.profile).get(key)?.control.rel || controlIndex(this.profile).get(key.split('@')[0])?.control.rel || null;
  }

  // -- layout slots (a profile control whose message number isn't known yet) -----------------------------------
  armSlot(segId, ctlId) { this.armedSlot = { segId, ctlId }; }
  armSource(src) { this.armedSource = src; this.armedTarget = null; this.paintBind(); }
  // The next message after armSlot() defines that control. Built-in profiles are read-only, so the first fill copies
  // the profile into a custom one (matched by this device's exact name) and fills the copy.
  async fillSlot(msg) {
    const { segId, ctlId } = this.armedSlot; this.armedSlot = null;
    const base = this.profile;
    let p = base.custom ? base : JSON.parse(JSON.stringify({ ...base, match: undefined }));
    if (!base.custom) { p.id = `custom-${String(this.deviceName).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`; p.custom = true; p.matchName = this.deviceName; p.verified = true; p.source = 'built-in layout, filled from your device'; }
    const c = p.segments.find((x) => x.id === segId)?.controls?.find((x) => x.id === ctlId);
    if (!c) return;
    c.src = { t: msg.t, n: msg.n, ...(msg.t === 'note' ? { ch: msg.ch } : {}) };
    await this.saveProfile(p);
    this.detect(this.deviceName, this.maker);
  }

  // -- the wizard ----------------------------------------------------------------------------------------------------
  startWizard() {
    this.discovery.reset(); this.armedSource = null; this.armedTarget = null;
    this.store.reportMidi({ wizard: { on: true, name: this.deviceName || '', sources: [] } });
    this.bus.emit('midi:wizard', {});
  }
  syncWizard() {
    const w = this.store.ui.midi.wizard; if (!w) return;
    w.sources = this.discovery.report();
    this.bus.emit('midi:wizard', {});
  }
  cancelWizard() { this.store.reportMidi({ wizard: null }); this.bus.emit('midi:wizard', {}); }
  async finishWizard(name) {
    const w = this.store.ui.midi.wizard;
    if (!w || !this.discovery.total) { this.cancelWizard(); return null; }
    const p = this.discovery.buildProfile({ name: name || w.name || this.deviceName, deviceName: this.deviceName, maker: this.maker });
    await this.saveProfile(p);
    this.store.reportMidi({ wizard: null });
    this.detect(this.deviceName, this.maker);
    this.applyDefaults(p, true);
    this.bus.emit('midi:wizard', {});
    return p;
  }

  // -- commands (the 'midi' command's map/profile actions call these through the store) -------------------------
  // The UI-less part lives in api.js; this is for the browser-only pieces.
  surface() {
    const p = this.profile;
    if (!p) return null;
    const idx = controlIndex(p);
    return { profile: p, bound: (key) => this.store.ui.midi.knobs[key] ?? this.store.ui.midi.knobs[key.split('@')[0]] ?? null, idx };
  }
}

// Identity of a target for "is this UI control already bound": the fields that decide WHAT it drives (not rel/pickup/auto).
function stableTarget(t) {
  const { rel, pickup, auto, stepSize, ...rest } = t;
  return JSON.stringify(Object.keys(rest).sort().reduce((o, k) => (o[k] = rest[k], o), {}));
}

export { cleanMap, describeTarget, asTarget, targetLabel, allControls, profileById, lookupKeys };
