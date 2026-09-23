// Store: single source of truth. All mutations go through action methods
// here, which mutate `this.project` and emit granular bus events. The
// engine and UI are subscribers; neither touches the project directly.
//
// Undo model: callers invoke checkpoint() once at the start of a user
// gesture (mouse down, before a structural action), then perform any
// number of mutations. Undo restores the snapshot. Continuous param/mixer
// tweaks deliberately skip history to keep the stack musical.

import { clamp, uid, deepClone } from './util.js';
import {
  createTrack, createPattern, resizeDrumPattern, validateProject,
  TRACK_COLORS, FORMAT_VERSION,
} from './schema.js';
import { getInstrumentDef, presetParams, defaultParams } from '../engine/instruments/index.js';
import * as A from './arrangement.js';
import * as S from './sources.js';

const HISTORY_LIMIT = 100;

export class Store {
  constructor(bus, project) {
    this.bus = bus;
    this.project = project;
    this.ui = {
      selectedTrackId: project.tracks[0]?.id ?? null,
      activeSlot: 0,
      queuedSlot: null,
      snap: 0.25,        // beats; 0.25 = 16th note
      metronome: false,
      mixerOpen: true,
      mobilePanel: 'editor', // which full-width view shows on phone-width shells:
                             // 'tracks'|'editor'|'inspector'|'mixer'. UI-only,
                             // same class as snap/mixerOpen: not project state,
                             // not serialized, never checkpointed. Desktop ignores it.
      midi: {
        enabled: false,     // user wants WebMIDI active
        inputId: null,      // preferred input device id; null = first available
        channel: 0,         // 0 = omni; 1..16 = listen on that channel only
        record: false,      // record-arm
        knobs: {},          // { [ccNumber:int]: paramKey:string } for selected instrument
        learnParam: null,   // when a string, the next incoming CC binds to this param
        velFloor: 0,        // 0..1 minimum OUTPUT velocity (loudness of the softest press)
        velCurve: 1,        // gamma exponent; <1 boosts soft presses (more sensitive), >1 less
        velFixed: 0,        // 0 = disabled; >0 = ignore incoming velocity, use this constant
        // raw 0..127 observations of incoming note-on velocity (for tuning the curve)
        velMonitor: { last: 0, min: 0, max: 0, count: 0, recent: [] },
        available: false,   // runtime: WebMIDI present + access granted
        inputName: null,    // runtime: bound input's display name
        devices: [],        // runtime: [{ id, name }]
        owner: false,       // runtime: this tab currently holds MIDI ownership
        peers: 1,           // runtime: count of live same-origin tabs (>=1 = self)
      },
      // Performance ledger: an always-on, bounded, time-stamped log of what the
      // user plays live (the "observer" half of the agent surface). Captured by
      // the input taps (src/ui/midi.js + src/ui/keyboard.js) via store.logInput,
      // read back over the 'ledger' command. Ephemeral runtime state: not part
      // of the project document and not serialized by persist.js.
      ledger: { events: [], cap: 800 },
    };
    this.undoStack = [];
    this.redoStack = [];
    this.colorCursor = project.tracks.length;
  }

  emit(type, payload = {}) { this.bus.emit(type, payload); }

  // -- history -------------------------------------------------------------

  checkpoint() {
    this.undoStack.push(JSON.stringify(this.project));
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  undo() {
    if (!this.canUndo) return;
    this.redoStack.push(JSON.stringify(this.project));
    this.project = JSON.parse(this.undoStack.pop());
    this.afterReplace();
  }

  redo() {
    if (!this.canRedo) return;
    this.undoStack.push(JSON.stringify(this.project));
    this.project = JSON.parse(this.redoStack.pop());
    this.afterReplace();
  }

  afterReplace() {
    this._gesture = null; // an undo/redo/load mid-drag invalidates the snapshot
    const hasArrangement = !!this.project.arrangement?.placements?.length;
    if (!this.project.tracks.find(t => t.id === this.ui.selectedTrackId)) {
      // A loaded arrangement is the song; don't auto-select a pattern track
      // over it (that would route the editor away from the timeline).
      this.ui.selectedTrackId = hasArrangement ? null : (this.project.tracks[0]?.id ?? null);
    }
    this.ui.queuedSlot = null;
    this.ui.activeSlot = clamp(this.ui.activeSlot, 0, this.project.slots.length - 1);
    this.emit('project:replaced');
    this.emit('ui:selection', { trackId: this.ui.selectedTrackId });
  }

  // -- settings --------------------------------------------------------------

  setSetting(key, value) {
    const p = this.project;
    if (key === 'bpm') p.bpm = clamp(Math.round(value * 10) / 10, 40, 240); // tenths: measured tempos aren't integers
    else if (key === 'swing') p.swing = clamp(value, 0, 1);
    else if (key === 'masterVolume') p.masterVolume = clamp(value, 0, 1.2);
    else if (key === 'name') p.name = String(value).slice(0, 80) || 'Untitled';
    else return;
    this.emit('settings:changed', { key });
  }

  setFx(key, value) {
    if (!(key in this.project.fx)) return;
    this.project.fx[key] = value;
    this.emit('fx:changed', { key, value });
  }

  // -- tracks ------------------------------------------------------------------

  getTrack(id) { return this.project.tracks.find(t => t.id === id); }
  kindOf(track) { return getInstrumentDef(track.instrument.type).kind; }

  addTrack(instrumentType) {
    this.checkpoint();
    const def = getInstrumentDef(instrumentType);
    const count = this.project.tracks.filter(t => t.instrument.type === instrumentType).length;
    const name = count ? `${def.label} ${count + 1}` : def.label;
    const track = createTrack(instrumentType, name, this.colorCursor++);
    this.project.tracks.push(track);
    for (let i = 0; i < this.project.slots.length; i++) this.ensurePattern(track.id, i);
    this.ui.selectedTrackId = track.id;
    this.emit('track:added', { track });
    this.emit('ui:selection', { trackId: track.id });
    return track;
  }

  removeTrack(id) {
    const idx = this.project.tracks.findIndex(t => t.id === id);
    if (idx < 0) return;
    this.checkpoint();
    this.project.tracks.splice(idx, 1);
    for (const slot of this.project.slots) delete slot.patterns[id];
    if (this.ui.selectedTrackId === id) {
      this.ui.selectedTrackId = this.project.tracks[Math.max(0, idx - 1)]?.id ?? null;
    }
    this.emit('track:removed', { trackId: id });
    this.emit('ui:selection', { trackId: this.ui.selectedTrackId });
  }

  renameTrack(id, name) {
    const t = this.getTrack(id);
    if (!t) return;
    t.name = String(name).slice(0, 40) || t.name;
    this.emit('track:changed', { trackId: id });
  }

  selectTrack(id) {
    if (this.ui.selectedTrackId === id) return;
    this.ui.selectedTrackId = id;
    this.emit('ui:selection', { trackId: id });
  }

  setChannel(id, key, value) {
    const t = this.getTrack(id);
    if (!t || !(key in t.channel)) return;
    t.channel[key] = value;
    this.emit('channel:changed', { trackId: id, key });
  }

  setTrackParam(id, key, value) {
    const t = this.getTrack(id);
    if (!t) return;
    t.instrument.params[key] = value;
    t.instrument.preset = null; // edited away from the preset
    this.emit('param:changed', { trackId: id, key, value });
  }

  applyPreset(id, presetName) {
    const t = this.getTrack(id);
    if (!t) return;
    this.checkpoint();
    const params = presetName
      ? presetParams(t.instrument.type, presetName)
      : defaultParams(t.instrument.type);
    t.instrument.params = params;
    t.instrument.preset = presetName;
    this.emit('preset:applied', { trackId: id, params });
  }

  // -- slots & patterns ----------------------------------------------------------

  getSlot(i = this.ui.activeSlot) { return this.project.slots[i]; }

  ensurePattern(trackId, slotIndex) {
    const slot = this.project.slots[slotIndex];
    const track = this.getTrack(trackId);
    if (!slot || !track) return null;
    if (!slot.patterns[trackId]) {
      slot.patterns[trackId] = createPattern(this.kindOf(track), slot.bars, track.instrument.type);
    }
    return slot.patterns[trackId];
  }

  getPattern(trackId, slotIndex = this.ui.activeSlot) {
    return this.ensurePattern(trackId, slotIndex);
  }

  setSlotBars(bars, slotIndex = this.ui.activeSlot) {
    const slot = this.project.slots[slotIndex];
    if (!slot || slot.bars === bars) return;
    this.checkpoint();
    slot.bars = bars;
    for (const track of this.project.tracks) {
      const pattern = this.ensurePattern(track.id, slotIndex);
      if (this.kindOf(track) === 'drums') resizeDrumPattern(pattern, bars);
    }
    this.emit('slot:resized', { slot: slotIndex });
  }

  // While playing, slot changes queue and land on the next loop boundary.
  requestSlot(i, playing) {
    if (i === this.ui.activeSlot && this.ui.queuedSlot === null) return;
    if (playing) {
      this.ui.queuedSlot = (i === this.ui.activeSlot) ? null : i;
    } else {
      this.ui.activeSlot = i;
      this.ui.queuedSlot = null;
    }
    this.emit('slot:changed', { active: this.ui.activeSlot, queued: this.ui.queuedSlot });
  }

  applyQueuedSlot() {
    if (this.ui.queuedSlot === null) return;
    this.ui.activeSlot = this.ui.queuedSlot;
    this.ui.queuedSlot = null;
    this.emit('slot:changed', { active: this.ui.activeSlot, queued: null });
  }

  clearQueuedSlot() {
    if (this.ui.queuedSlot === null) return;
    this.ui.queuedSlot = null;
    this.emit('slot:changed', { active: this.ui.activeSlot, queued: null });
  }

  copySlot(from, to) {
    if (from === to) return;
    this.checkpoint();
    const src = this.project.slots[from];
    const dst = this.project.slots[to];
    dst.bars = src.bars;
    dst.patterns = deepClone(src.patterns);
    this.emit('slot:changed', { active: this.ui.activeSlot, queued: this.ui.queuedSlot });
    for (const t of this.project.tracks) {
      this.emit(this.kindOf(t) === 'drums' ? 'steps:changed' : 'notes:changed', { trackId: t.id });
    }
  }

  // -- notes (melodic patterns; gesture calls checkpoint() first) ------------------
  // All note/step actions take an optional slotIndex (default: active slot)
  // so programmatic callers (command API) can edit any pattern slot.

  addNote(trackId, { start, pitch, dur, vel }, slotIndex = this.ui.activeSlot) {
    const pattern = this.getPattern(trackId, slotIndex);
    const n = { id: uid('n'), start, pitch, dur, vel };
    pattern.notes.push(n);
    this.emit('notes:changed', { trackId });
    return n;
  }

  updateNotes(trackId, patches, slotIndex = this.ui.activeSlot) {
    const pattern = this.getPattern(trackId, slotIndex);
    const byId = new Map(pattern.notes.map(n => [n.id, n]));
    for (const patch of patches) {
      const n = byId.get(patch.id);
      if (n) Object.assign(n, patch);
    }
    this.emit('notes:changed', { trackId });
  }

  removeNotes(trackId, ids, slotIndex = this.ui.activeSlot) {
    const pattern = this.getPattern(trackId, slotIndex);
    const drop = new Set(ids);
    pattern.notes = pattern.notes.filter(n => !drop.has(n.id));
    this.emit('notes:changed', { trackId });
  }

  // Replace the entire note list of a pattern in one action.
  setNotes(trackId, notes, slotIndex = this.ui.activeSlot) {
    const pattern = this.getPattern(trackId, slotIndex);
    pattern.notes = notes.map(n => ({ id: n.id ?? uid('n'), ...n }));
    this.emit('notes:changed', { trackId });
    return pattern.notes;
  }

  // -- drum steps (gesture calls checkpoint() first) --------------------------------

  setStep(trackId, laneId, index, vel, slotIndex = this.ui.activeSlot) {
    const pattern = this.getPattern(trackId, slotIndex);
    if (!pattern.steps[laneId] || index < 0 || index >= pattern.steps[laneId].length) return;
    pattern.steps[laneId][index] = vel;
    this.emit('steps:changed', { trackId });
  }

  // Replace whole step lanes in one action. `lanes` maps laneId -> number[].
  // With replaceAll, lanes not present in the map are cleared.
  setLanes(trackId, lanes, slotIndex = this.ui.activeSlot, replaceAll = false) {
    const track = this.getTrack(trackId);
    const pattern = this.getPattern(trackId, slotIndex);
    if (!track || !pattern?.steps) return null;
    const want = this.project.slots[slotIndex].bars * 16;
    const fit = (arr) => {
      const out = (arr ?? []).slice(0, want).map(v => clamp(Number(v) || 0, 0, 1));
      while (out.length < want) out.push(0);
      return out;
    };
    for (const laneId of Object.keys(pattern.steps)) {
      if (laneId in lanes) pattern.steps[laneId] = fit(lanes[laneId]);
      else if (replaceAll) pattern.steps[laneId] = new Array(want).fill(0);
    }
    this.emit('steps:changed', { trackId });
    return pattern.steps;
  }

  // -- ephemeral ui state with events --------------------------------------------------

  setMetronome(on) {
    this.ui.metronome = !!on;
    this.emit('ui:metronome', { value: this.ui.metronome });
  }

  // -- MIDI input config (ephemeral ui state; NOT part of the project) --------
  // The WebMIDI hardware manager lives in the browser (src/ui/midi.js); these
  // actions hold the config it applies and the runtime device state it reports.
  // Config writes emit 'midi:config' (the manager reacts); runtime writes emit
  // 'midi:status' (the UI indicator reacts). Splitting the two events avoids a
  // feedback loop between the manager and the state it publishes.

  configureMidi(patch) {
    const m = this.ui.midi;
    if ('enabled' in patch) m.enabled = !!patch.enabled;
    if ('record' in patch) m.record = !!patch.record;
    if ('channel' in patch) m.channel = clamp(Math.round(patch.channel), 0, 16);
    if ('inputId' in patch) m.inputId = patch.inputId == null ? null : String(patch.inputId);
    if ('knobs' in patch) m.knobs = patch.knobs ?? {};
    this.emit('midi:config', {});
  }

  mapMidiKnob(cc, paramKey) {
    const c = clamp(Math.round(cc), 0, 127);
    if (paramKey == null) delete this.ui.midi.knobs[c];
    else this.ui.midi.knobs[c] = String(paramKey);
    if (this.ui.midi.learnParam === paramKey) this.ui.midi.learnParam = null;
    this.emit('midi:config', {});
  }

  armMidiLearn(paramKey) {
    this.ui.midi.learnParam = paramKey ? String(paramKey) : null;
    this.emit('midi:config', {});
  }

  // Velocity shaping config. The browser MIDI manager (src/ui/midi.js) applies
  // these to each incoming note-on; defaults (floor 0, curve 1, fixed 0)
  // reproduce a plain d2/127 mapping. Held here so the pure command surface can
  // read/write it headless. Emits 'midi:config' like the other config actions.
  setMidiVelocity(patch) {
    const m = this.ui.midi;
    if ('floor' in patch) { const f = Number(patch.floor); if (Number.isFinite(f)) m.velFloor = clamp(f, 0, 1); }
    if ('curve' in patch) { const c = Number(patch.curve); if (Number.isFinite(c)) m.velCurve = clamp(c, 0.2, 5); }
    if ('fixed' in patch) { const x = Number(patch.fixed); if (Number.isFinite(x)) m.velFixed = clamp(x, 0, 1); }
    this.emit('midi:config', {});
  }

  // Record one RAW (pre-shaping) note-on velocity for the live monitor. Called
  // by the browser manager on every note-on so the user can read the spread
  // their controller actually sends and tune floor/curve to it. Kept cheap;
  // emits the ephemeral 'midi:velocity' (persist.js skips autosave on it).
  observeMidiVelocity(d2) {
    const v = clamp(Math.round(d2), 0, 127);
    const mon = this.ui.midi.velMonitor;
    mon.last = v;
    mon.count++;
    mon.min = mon.count === 1 ? v : Math.min(mon.min, v);
    mon.max = mon.count === 1 ? v : Math.max(mon.max, v);
    mon.recent.push(v);
    if (mon.recent.length > 16) mon.recent.shift();
    this.emit('midi:velocity', {});
  }

  resetMidiVelocityMonitor() {
    this.ui.midi.velMonitor = { last: 0, min: 0, max: 0, count: 0, recent: [] };
    this.emit('midi:velocity', {});
  }

  // Intent only: ask this tab to take MIDI ownership away from a peer that
  // currently holds it. The browser MIDI manager (src/ui/midi.js) reacts to
  // 'midi:claim' and performs the actual Web Lock steal + device bind; this
  // store action stays pure so it runs headless (no navigator/window).
  requestMidiClaim() {
    this.emit('midi:claim', {});
  }

  // Runtime fields only (available, inputName, devices, resolved inputId).
  // Called by the UI manager to publish observed device state.
  reportMidi(patch) {
    Object.assign(this.ui.midi, patch);
    this.emit('midi:status', {});
  }

  // -- performance ledger (ephemeral; the agent's "observer" surface) ----------
  // logInput is a SILENT, high-frequency ring push: it runs per played note, so
  // it must stay cheap and must NOT emit a bus event (that would spam autosave
  // and UI re-renders). The 'ledger' command reads store.ui.ledger.events back.

  // Append one input event to the ledger, stamping wall-clock time here (never
  // trusting a caller-supplied t), and cap the ring at oldest-first.
  logInput(ev) {
    const led = this.ui.ledger;
    led.events.push({ ...ev, t: Date.now() });
    if (led.events.length > led.cap) led.events.shift();
  }

  clearLedger() {
    this.ui.ledger.events = [];
    this.emit('ledger:cleared', {});
  }

  // -- arrangement (v2) ------------------------------------------------------
  // Each action is one undo step: validate by dry-running on a clone (so a
  // bad call leaves no empty history entry), then checkpoint, mutate via the
  // pure function in core/arrangement.js, and emit the same bus events the
  // timeline/mixer UI emits for that change.

  arrangementEdit(fn, events = ['arrangement:changed']) {
    A.requireArrangement(this.project);
    fn(deepClone(this.project)); // throws on bad input before touching history
    this.checkpoint();
    const out = fn(this.project);
    for (const ev of events) this.emit(ev, ev === 'loop:changed' ? { ...(this.project.arrangement.loop ?? {}) } : {});
    return out;
  }

  // Run ops = [[name, ...args]] (exports of core/arrangement.js) in order.
  _runOps(p, ops) {
    return ops.map(([name, ...args]) => {
      if (typeof A[name] !== 'function') throw new Error(`No arrangement op '${name}'.`);
      return A[name](p, ...args);
    });
  }

  // Several arrangement ops as ONE undo step (a trim that moves clip.in and
  // placement.at, a split at both range edges, ...).
  arrangementBatch(ops, events) { return this.arrangementEdit(p => this._runOps(p, ops), events); }

  // Fold ops into the PREVIOUS undo step (no new checkpoint). For a two-part
  // edit the user sees as one: add a marker, then type its name.
  arrangementAmend(ops, events = ['arrangement:changed']) {
    A.requireArrangement(this.project);
    this._runOps(deepClone(this.project), ops);
    const out = this._runOps(this.project, ops);
    this.redoStack.length = 0;
    this._emitAll(events);
    return out;
  }

  // -- continuous gestures (drag, fader, trim, marker/automation drags) -----
  // One gesture = one store action = one undo step, and the UI never mutates
  // the project itself, not even for the live preview:
  //   gestureBegin()               first real movement: snapshot, no history
  //   gesturePreview(ops, events)  each move: apply ops to the live project,
  //                                no history. Ops carry ABSOLUTE values (at,
  //                                in, t, gainDb), so re-applying is idempotent
  //                                and object identity is kept mid-drag.
  //   gestureCommit(ops, events)   pointerup: replay the FULL op list on the
  //                                pre-gesture snapshot as ONE undo step (the
  //                                snapshot is the undo entry)
  //   gestureCancel(events)        abandon: restore the snapshot, no history
  // Ops are [[name, ...args]] naming exports of core/arrangement.js. A commit
  // with no ops (a click that never moved) restores and adds no history.
  // Only arrangement, clips and assets are restored; arrangement ops touch
  // nothing else. When the replay equals the previewed state the live
  // objects are kept, so references held during the drag stay valid.
  // See docs/ui-store-actions.md.
  gestureBegin() {
    if (this._gesture) return;
    A.requireArrangement(this.project);
    this._gesture = JSON.stringify(this.project);
  }
  get inGesture() { return !!this._gesture; }
  _gestureRestore(snap) {
    const o = JSON.parse(snap);
    for (const k of ['arrangement', 'clips', 'assets']) {
      if (k in o) this.project[k] = o[k]; else delete this.project[k];
    }
  }
  _emitAll(events) {
    for (const ev of events) this.emit(ev, ev === 'loop:changed' ? { ...(this.project.arrangement?.loop ?? {}) } : {});
  }
  gesturePreview(ops, events = []) {
    if (!this._gesture) this.gestureBegin();
    const out = this._runOps(this.project, ops);
    this._emitAll(events);
    return out;
  }
  gestureCommit(ops, events = ['arrangement:changed']) {
    const snap = this._gesture;
    if (!snap) return ops.length ? this.arrangementBatch(ops, events) : [];
    this._gesture = null;
    if (!ops.length) { this._gestureRestore(snap); this._emitAll(events); return []; }
    const clone = JSON.parse(snap);
    let out;
    try { out = this._runOps(clone, ops); } // throws before touching history
    catch (err) { this._gestureRestore(snap); this._emitAll(events); throw err; }
    const pick = o => JSON.stringify([o.arrangement, o.clips, o.assets]);
    if (pick(clone) !== pick(this.project)) {
      for (const k of ['arrangement', 'clips', 'assets']) {
        if (k in clone) this.project[k] = clone[k]; else delete this.project[k];
      }
    }
    this.undoStack.push(snap);
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack.length = 0;
    this._emitAll(events);
    return out;
  }
  gestureCancel(events = []) {
    const snap = this._gesture;
    if (!snap) return false;
    this._gesture = null;
    this._gestureRestore(snap);
    this._emitAll(events);
    return true;
  }

  clipSet(ref, fields) { return this.arrangementEdit(p => A.clipSet(p, ref, fields)); }
  clipSplit(index, t) { return this.arrangementEdit(p => A.splitPlacement(p, index, t)); }
  clipDuplicate(index, opts) { return this.arrangementEdit(p => A.duplicatePlacement(p, index, opts)); }
  clipMove(index, opts) { return this.arrangementEdit(p => A.movePlacement(p, index, opts)); }
  clipRemove(index) { return this.arrangementEdit(p => A.removePlacement(p, index)); }
  clipCopy(index) { return this.arrangementEdit(p => A.copyPlacement(p, index)); }
  clipSplitMany(indices, times) { return this.arrangementEdit(p => A.splitPlacements(p, indices, times)); }
  clipCutRange(indices, a, b) { return this.arrangementEdit(p => A.cutPlacements(p, indices, a, b)); }
  clipPlace(opts) { return this.arrangementEdit(p => A.placeClip(p, opts)); }

  laneAdd(opts) { return this.arrangementEdit(p => A.addLane(p, opts), ['lanes:changed', 'arrangement:changed']); }
  laneRemove(ref) { return this.arrangementEdit(p => A.removeLane(p, ref), ['lanes:changed', 'inserts:changed', 'arrangement:changed']); }
  laneRename(ref, name) { return this.arrangementEdit(p => A.renameLane(p, ref, name), ['lanes:changed', 'arrangement:changed']); }
  laneSet(ref, fields) { return this.arrangementEdit(p => A.setLane(p, ref, fields), ['lanes:changed', 'inserts:changed', 'arrangement:changed']); }
  laneReorder(ref, index) { return this.arrangementEdit(p => A.reorderLane(p, ref, index), ['lanes:changed', 'arrangement:changed']); }

  markerAdd(t, name) { return this.arrangementEdit(p => A.addMarker(p, t, name)); }
  markerMove(ref, t) { return this.arrangementEdit(p => A.moveMarker(p, ref, t)); }
  markerRename(ref, name) { return this.arrangementEdit(p => A.renameMarker(p, ref, name)); }
  markerRemove(ref) { return this.arrangementEdit(p => A.removeMarker(p, ref)); }

  cycleSet(opts) { return this.arrangementEdit(p => A.setCycle(p, opts), ['loop:changed', 'arrangement:changed']); }
  cycleClear() { return this.arrangementEdit(p => A.clearCycle(p), ['loop:changed', 'arrangement:changed']); }

  rangeCut(a, b, lanes) { return this.arrangementEdit(p => A.cutRange(p, a, b, lanes), ['arrangement:changed', 'range:changed']); }
  rangeRippleDelete(a, b) { return this.arrangementEdit(p => A.rippleDelete(p, a, b), ['arrangement:changed', 'loop:changed', 'range:changed']); }

  insertAdd(lane, type, params) { return this.arrangementEdit(p => A.addInsert(p, lane, type, params), ['inserts:changed', 'arrangement:changed']); }
  insertSet(lane, index, opts) { return this.arrangementEdit(p => A.setInsert(p, lane, index, opts), ['inserts:changed', 'arrangement:changed']); }
  insertRemove(lane, index) { return this.arrangementEdit(p => A.removeInsert(p, lane, index), ['inserts:changed', 'arrangement:changed']); }
  insertMove(lane, index, to) { return this.arrangementEdit(p => A.moveInsert(p, lane, index, to), ['inserts:changed', 'arrangement:changed']); }

  automationSetPoints(target, points) { return this.arrangementEdit(p => A.setAutomationPoints(p, target, points)); }
  automationAddPoint(target, pt) { return this.arrangementEdit(p => A.addAutomationPoint(p, target, pt)); }
  automationMovePoint(target, index, pt) { return this.arrangementEdit(p => A.moveAutomationPoint(p, target, index, pt)); }
  automationRemovePoint(target, which) { return this.arrangementEdit(p => A.removeAutomationPoint(p, target, which)); }
  automationClear(target) { return this.arrangementEdit(p => A.clearAutomation(p, target)); }

  assetRename(ref, name) { return this.arrangementEdit(p => A.renameAsset(p, ref, name)); }
  wordsSet(asset, words) { return this.arrangementEdit(p => A.setWords(p, asset, words)); }

  // Asset sources + variants (core/sources.js). One undo step each. The
  // 'assets:changed' event tells the engine/timeline a variant may now
  // resolve to different bytes.
  assetAdd(opts) { return this.arrangementEdit(p => S.addAsset(p, opts), ['assets:changed', 'arrangement:changed']); }
  assetSourceSet(ref, source, opts) { return this.arrangementEdit(p => S.setSource(p, ref, source, opts), ['assets:changed', 'arrangement:changed']); }
  assetVariantAdd(ref, name, variant, opts) { return this.arrangementEdit(p => S.addVariant(p, ref, name, variant, opts), ['assets:changed', 'arrangement:changed']); }
  assetVariantRemove(ref, name) { return this.arrangementEdit(p => S.removeVariant(p, ref, name), ['assets:changed', 'arrangement:changed']); }
  assetPrefer(ref, name) { return this.arrangementEdit(p => S.preferVariant(p, ref, name), ['assets:changed', 'arrangement:changed']); }

  // -- serialization -------------------------------------------------------------------

  serialize() {
    return JSON.stringify({ ...this.project, version: FORMAT_VERSION }, null, 1);
  }

  load(projectObj) {
    this.project = validateProject(projectObj);
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.colorCursor = this.project.tracks.length;
    this.afterReplace();
  }
}
