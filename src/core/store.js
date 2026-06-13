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
    if (!this.project.tracks.find(t => t.id === this.ui.selectedTrackId)) {
      this.ui.selectedTrackId = this.project.tracks[0]?.id ?? null;
    }
    this.ui.queuedSlot = null;
    this.ui.activeSlot = clamp(this.ui.activeSlot, 0, this.project.slots.length - 1);
    this.emit('project:replaced');
    this.emit('ui:selection', { trackId: this.ui.selectedTrackId });
  }

  // -- settings --------------------------------------------------------------

  setSetting(key, value) {
    const p = this.project;
    if (key === 'bpm') p.bpm = clamp(Math.round(value), 40, 240);
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
