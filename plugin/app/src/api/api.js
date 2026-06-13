// CommandAPI: binds the command catalog (commands.js) to the live app.
// Every UI feature routes through the same store/engine/transport calls
// these handlers use, so API and UI capability are the same set by
// construction. Consumers: the MCP bridge, window.oscine.api, tests.
//
// All handlers return JSON-serializable values and throw Error with
// actionable messages on bad input.

import { COMMANDS, getCommand, API_VERSION } from './commands.js';
import { SLOT_NAMES, BAR_CHOICES, demoProject, createProject, validateProject } from '../core/schema.js';
import { listInstrumentDefs, getInstrumentDef, presetParams } from '../engine/instruments/index.js';
import { clamp, deepClone, midiName } from '../core/util.js';

export class CommandAPI {
  constructor({ store, engine, transport, bus }) {
    this.store = store;
    this.engine = engine;
    this.transport = transport;
    this.bus = bus;
    this.version = API_VERSION;
  }

  list() {
    return COMMANDS;
  }

  async execute(name, args = {}) {
    const cmd = getCommand(name);
    if (!cmd) {
      throw new Error(`Unknown command '${name}'. Available: ${COMMANDS.map(c => c.name).join(', ')}`);
    }
    for (const key of cmd.input.required ?? []) {
      if (args[key] === undefined) throw new Error(`Missing required argument '${key}' for '${name}'.`);
    }
    const handler = this[`cmd_${name}`];
    if (!handler) throw new Error(`Command '${name}' has no handler (catalog/handler drift).`);
    return await handler.call(this, args);
  }

  // -- resolution helpers ----------------------------------------------------

  resolveTrack(ref) {
    const tracks = this.store.project.tracks;
    const t = tracks.find(x => x.id === ref) ||
      tracks.find(x => x.name.toLowerCase() === String(ref).toLowerCase());
    if (!t) {
      const names = tracks.map(x => `"${x.name}"`).join(', ') || '(no tracks)';
      throw new Error(`No track '${ref}'. Tracks: ${names}. Use add_track to create one.`);
    }
    return t;
  }

  resolveSlot(ref, fallbackActive = true) {
    if (ref === undefined || ref === null) {
      if (fallbackActive) return this.store.ui.activeSlot;
      throw new Error('Missing slot.');
    }
    if (typeof ref === 'number' && ref >= 0 && ref < SLOT_NAMES.length) return Math.floor(ref);
    const i = SLOT_NAMES.indexOf(String(ref).toUpperCase());
    if (i >= 0) return i;
    throw new Error(`Bad slot '${ref}'. Use 'A'-'D' or 0-3.`);
  }

  kindOf(track) {
    return getInstrumentDef(track.instrument.type).kind;
  }

  requireKind(track, kind, otherTool) {
    if (this.kindOf(track) !== kind) {
      throw new Error(`Track "${track.name}" is a ${this.kindOf(track)} track; use ${otherTool} instead.`);
    }
  }

  audioHint() {
    const state = this.engine?.ctx?.state;
    return state && state !== 'running'
      ? 'Audio context is suspended: the user must click or press a key once in the Oscine tab to enable sound.'
      : undefined;
  }

  trackSummary(t) {
    const def = getInstrumentDef(t.instrument.type);
    return {
      id: t.id,
      name: t.name,
      type: t.instrument.type,
      kind: def.kind,
      preset: t.instrument.preset,
      channel: { ...t.channel },
      selected: t.id === this.store.ui.selectedTrackId,
    };
  }

  slotSummary(i) {
    const { store } = this;
    const slot = store.project.slots[i];
    const content = {};
    for (const t of store.project.tracks) {
      const p = slot.patterns[t.id];
      if (!p) continue;
      const n = p.notes ? p.notes.length
        : Object.values(p.steps ?? {}).reduce((s, arr) => s + arr.filter(v => v > 0).length, 0);
      if (n > 0) content[t.name] = n;
    }
    return {
      slot: SLOT_NAMES[i],
      bars: slot.bars,
      active: i === store.ui.activeSlot,
      queued: i === store.ui.queuedSlot,
      eventCounts: content,
    };
  }

  transportState() {
    const pos = this.transport.getPosition();
    return {
      playing: pos.playing,
      positionBeat: Math.round(pos.localBeat * 1000) / 1000,
      loopBeats: pos.loopBeats,
      bpm: this.store.project.bpm,
      swing: this.store.project.swing,
      metronome: this.store.ui.metronome,
      activeSlot: SLOT_NAMES[this.store.ui.activeSlot],
      queuedSlot: this.store.ui.queuedSlot === null ? null : SLOT_NAMES[this.store.ui.queuedSlot],
      audioState: this.engine?.ctx?.state ?? 'unknown',
      hint: this.audioHint(),
    };
  }

  // -- command handlers -------------------------------------------------------

  cmd_status() {
    const { store } = this;
    const p = store.project;
    return {
      app: 'oscine',
      apiVersion: API_VERSION,
      project: { name: p.name, bpm: p.bpm, swing: p.swing, masterVolume: p.masterVolume, fx: { ...p.fx } },
      transport: this.transportState(),
      tracks: p.tracks.map(t => this.trackSummary(t)),
      slots: p.slots.map((_, i) => this.slotSummary(i)),
      history: { canUndo: store.canUndo, canRedo: store.canRedo },
    };
  }

  cmd_transport({ action, bpm, swing, metronome }) {
    const { store, transport } = this;
    if (bpm !== undefined) store.setSetting('bpm', bpm);
    if (swing !== undefined) store.setSetting('swing', swing);
    if (metronome !== undefined) store.setMetronome(metronome);
    if (action === 'play') transport.play();
    else if (action === 'stop') transport.stop();
    else if (action === 'toggle') transport.toggle();
    return this.transportState();
  }

  cmd_project({ action, kind = 'blank', name, project }) {
    const { store } = this;
    switch (action) {
      case 'get':
        return deepClone(store.project);
      case 'new': {
        store.checkpoint();
        store.project = kind === 'demo' ? demoProject() : createProject(name);
        if (name) store.project.name = name;
        store.afterReplace();
        return { ok: true, project: store.project.name, hint: 'Previous project is one undo away.' };
      }
      case 'load': {
        if (!project) throw new Error("action 'load' needs a 'project' object (from action 'get').");
        const validated = validateProject(deepClone(project));
        store.checkpoint();
        store.project = validated;
        store.afterReplace();
        return { ok: true, project: store.project.name };
      }
      case 'rename': {
        if (!name) throw new Error("action 'rename' needs 'name'.");
        store.setSetting('name', name);
        return { ok: true, project: store.project.name };
      }
      case 'undo':
        if (!store.canUndo) return { ok: false, reason: 'Nothing to undo.', history: { canUndo: false, canRedo: store.canRedo } };
        store.undo();
        return { ok: true, history: { canUndo: store.canUndo, canRedo: store.canRedo } };
      case 'redo':
        if (!store.canRedo) return { ok: false, reason: 'Nothing to redo.', history: { canUndo: store.canUndo, canRedo: false } };
        store.redo();
        return { ok: true, history: { canUndo: store.canUndo, canRedo: store.canRedo } };
      default:
        throw new Error(`Bad action '${action}'.`);
    }
  }

  cmd_list_instruments() {
    return {
      instruments: listInstrumentDefs().map(def => ({
        type: def.type,
        label: def.label,
        kind: def.kind,
        lanes: def.lanes?.map(l => ({ id: l.id, label: l.label })),
        params: def.params.map(({ key, label, type, min, max, step, default: dflt, curve, unit, options, group }) => ({
          key, label, type, min, max, step, default: dflt, curve, unit, group,
          options: options?.map(o => o.value),
        })),
        presets: Object.keys(def.presets ?? {}),
      })),
    };
  }

  cmd_add_track({ type, name }) {
    const known = listInstrumentDefs().map(d => d.type);
    if (!known.includes(type)) {
      throw new Error(`Unknown instrument type '${type}'. Available: ${known.join(', ')}.`);
    }
    const track = this.store.addTrack(type);
    if (name) this.store.renameTrack(track.id, name);
    return { track: this.trackSummary(track) };
  }

  cmd_remove_track({ track }) {
    const t = this.resolveTrack(track);
    this.store.removeTrack(t.id);
    return { ok: true, removed: t.name, remainingTracks: this.store.project.tracks.map(x => x.name) };
  }

  cmd_rename_track({ track, name }) {
    const t = this.resolveTrack(track);
    this.store.renameTrack(t.id, name);
    return { track: this.trackSummary(t) };
  }

  cmd_select_track({ track }) {
    const t = this.resolveTrack(track);
    this.store.selectTrack(t.id);
    return { selected: t.name, editor: this.kindOf(t) === 'drums' ? 'step grid' : 'piano roll' };
  }

  cmd_set_mix({ track, gain, pan, mute, solo, sendDelay, sendReverb }) {
    const t = this.resolveTrack(track);
    const { store } = this;
    if (gain !== undefined) store.setChannel(t.id, 'gain', clamp(gain, 0, 1));
    if (pan !== undefined) store.setChannel(t.id, 'pan', clamp(pan, -1, 1));
    if (mute !== undefined) store.setChannel(t.id, 'mute', !!mute);
    if (solo !== undefined) store.setChannel(t.id, 'solo', !!solo);
    if (sendDelay !== undefined) store.setChannel(t.id, 'sendDelay', clamp(sendDelay, 0, 1));
    if (sendReverb !== undefined) store.setChannel(t.id, 'sendReverb', clamp(sendReverb, 0, 1));
    return { track: t.name, channel: { ...t.channel } };
  }

  cmd_set_master({ volume, delayDiv, delayFeedback, delayReturn, verbSize, verbReturn }) {
    const { store } = this;
    if (volume !== undefined) store.setSetting('masterVolume', volume);
    const fxSets = { delayDiv, delayFeedback, delayReturn, verbSize, verbReturn };
    const clamps = {
      delayDiv: v => {
        const allowed = [0.25, 0.5, 0.75, 1, 1.5, 2];
        if (!allowed.includes(v)) throw new Error(`delayDiv must be one of ${allowed.join(', ')} (beats).`);
        return v;
      },
      delayFeedback: v => clamp(v, 0, 0.9),
      delayReturn: v => clamp(v, 0, 1),
      verbSize: v => clamp(v, 0.4, 6),
      verbReturn: v => clamp(v, 0, 1),
    };
    for (const [key, value] of Object.entries(fxSets)) {
      if (value !== undefined) store.setFx(key, clamps[key](value));
    }
    return { masterVolume: store.project.masterVolume, fx: { ...store.project.fx } };
  }

  cmd_set_params({ track, preset, params }) {
    const t = this.resolveTrack(track);
    const def = getInstrumentDef(t.instrument.type);

    if (preset !== undefined) {
      const presetNames = Object.keys(def.presets ?? {});
      if (preset.toLowerCase() === 'init') {
        this.store.applyPreset(t.id, null);
      } else {
        const match = presetNames.find(p => p.toLowerCase() === preset.toLowerCase());
        if (!match) throw new Error(`No preset '${preset}' on ${def.label}. Presets: ${presetNames.join(', ') || '(none)'}, or 'init'.`);
        this.store.applyPreset(t.id, match);
      }
    }

    if (params) {
      for (const [key, raw] of Object.entries(params)) {
        const p = def.params.find(x => x.key === key);
        if (!p) {
          throw new Error(`No param '${key}' on ${def.label}. Keys: ${def.params.map(x => x.key).join(', ')}.`);
        }
        let value = raw;
        if (p.type === 'select') {
          const match = p.options.find(o => String(o.value) === String(raw));
          if (!match) throw new Error(`Param '${key}' must be one of: ${p.options.map(o => o.value).join(', ')}.`);
          value = match.value;
        } else {
          value = Number(raw);
          if (Number.isNaN(value)) throw new Error(`Param '${key}' needs a number.`);
          value = clamp(value, p.min, p.max);
          if (p.step) value = Math.round(value / p.step) * p.step;
        }
        this.store.setTrackParam(t.id, key, value);
      }
    }

    return { track: t.name, preset: t.instrument.preset, params: { ...t.instrument.params } };
  }

  cmd_get_notes({ track, slot }) {
    const t = this.resolveTrack(track);
    this.requireKind(t, 'synth', 'get_steps');
    const slotIdx = this.resolveSlot(slot);
    const pattern = this.store.getPattern(t.id, slotIdx);
    const bars = this.store.project.slots[slotIdx].bars;
    const notes = [...pattern.notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch)
      .map(n => ({ ...n, noteName: midiName(n.pitch) }));
    return { track: t.name, slot: SLOT_NAMES[slotIdx], bars, loopBeats: bars * 4, noteCount: notes.length, notes };
  }

  validateNotes(notes, loopBeats) {
    let beyondLoop = 0;
    const out = notes.map((n, i) => {
      if (n.start === undefined || n.pitch === undefined) {
        throw new Error(`notes[${i}] needs at least 'start' and 'pitch'.`);
      }
      const start = Math.max(0, Number(n.start));
      if (start >= loopBeats) beyondLoop++;
      return {
        start,
        pitch: clamp(Math.round(Number(n.pitch)), 24, 107),
        dur: Math.max(0.02, Number(n.dur ?? 0.25)),
        vel: clamp(Number(n.vel ?? 0.85), 0.05, 1),
      };
    });
    return { out, beyondLoop };
  }

  cmd_set_notes({ track, mode, notes, ids, slot }) {
    const t = this.resolveTrack(track);
    this.requireKind(t, 'synth', 'set_steps');
    const slotIdx = this.resolveSlot(slot);
    const loopBeats = this.store.project.slots[slotIdx].bars * 4;
    const { store } = this;

    store.checkpoint();
    let warning;
    if (mode === 'replace' || mode === 'add') {
      if (!Array.isArray(notes)) throw new Error(`mode '${mode}' needs a 'notes' array.`);
      const { out, beyondLoop } = this.validateNotes(notes, loopBeats);
      if (beyondLoop) {
        warning = `${beyondLoop} note(s) start at/after the loop end (${loopBeats} beats); they will not sound until the slot is lengthened (slots set_bars).`;
      }
      const merged = mode === 'add' ? [...store.getPattern(t.id, slotIdx).notes, ...out] : out;
      store.setNotes(t.id, merged, slotIdx);
    } else if (mode === 'remove') {
      if (!Array.isArray(ids) || !ids.length) throw new Error("mode 'remove' needs an 'ids' array (from get_notes).");
      store.removeNotes(t.id, ids, slotIdx);
    } else if (mode === 'clear') {
      store.setNotes(t.id, [], slotIdx);
    } else {
      throw new Error(`Bad mode '${mode}'.`);
    }

    const result = this.cmd_get_notes({ track: t.id, slot: slotIdx });
    if (warning) result.warning = warning;
    return result;
  }

  cmd_get_steps({ track, slot }) {
    const t = this.resolveTrack(track);
    this.requireKind(t, 'drums', 'get_notes');
    const slotIdx = this.resolveSlot(slot);
    const pattern = this.store.getPattern(t.id, slotIdx);
    const bars = this.store.project.slots[slotIdx].bars;
    return {
      track: t.name,
      slot: SLOT_NAMES[slotIdx],
      bars,
      stepsPerLane: bars * 16,
      lanes: deepClone(pattern.steps),
    };
  }

  cmd_set_steps({ track, mode, lanes, slot }) {
    const t = this.resolveTrack(track);
    this.requireKind(t, 'drums', 'set_notes');
    const slotIdx = this.resolveSlot(slot);
    const def = getInstrumentDef(t.instrument.type);
    const valid = new Set(def.lanes.map(l => l.id));
    const { store } = this;

    store.checkpoint();
    if (mode === 'clear') {
      store.setLanes(t.id, {}, slotIdx, true);
    } else if (mode === 'merge' || mode === 'replace') {
      if (!lanes || typeof lanes !== 'object') throw new Error(`mode '${mode}' needs a 'lanes' object.`);
      for (const laneId of Object.keys(lanes)) {
        if (!valid.has(laneId)) {
          throw new Error(`No lane '${laneId}'. Lanes: ${[...valid].join(', ')}.`);
        }
      }
      store.setLanes(t.id, lanes, slotIdx, mode === 'replace');
    } else {
      throw new Error(`Bad mode '${mode}'.`);
    }
    return this.cmd_get_steps({ track: t.id, slot: slotIdx });
  }

  cmd_slots({ action, slot, bars, from, to }) {
    const { store, transport } = this;
    switch (action) {
      case 'list':
        return { slots: store.project.slots.map((_, i) => this.slotSummary(i)) };
      case 'select': {
        const i = this.resolveSlot(slot, false);
        store.requestSlot(i, transport.playing);
        const queued = store.ui.queuedSlot !== null;
        return {
          activeSlot: SLOT_NAMES[store.ui.activeSlot],
          queuedSlot: queued ? SLOT_NAMES[store.ui.queuedSlot] : null,
          note: queued ? 'Playing: switch lands at the next loop boundary.' : undefined,
        };
      }
      case 'set_bars': {
        if (!BAR_CHOICES.includes(bars)) throw new Error(`bars must be one of ${BAR_CHOICES.join(', ')}.`);
        const i = this.resolveSlot(slot);
        store.setSlotBars(bars, i);
        return { slot: SLOT_NAMES[i], bars };
      }
      case 'copy': {
        const f = this.resolveSlot(from, false);
        const tt = this.resolveSlot(to, false);
        if (f === tt) throw new Error('from and to are the same slot.');
        store.copySlot(f, tt);
        return { copied: `${SLOT_NAMES[f]} -> ${SLOT_NAMES[tt]}`, slots: store.project.slots.map((_, i) => this.slotSummary(i)) };
      }
      default:
        throw new Error(`Bad action '${action}'.`);
    }
  }

  cmd_preview({ track, pitch, lane, vel = 0.9, dur = 0.6 }) {
    const t = this.resolveTrack(track);
    const kind = this.kindOf(t);
    if (kind === 'drums') {
      if (!lane) {
        const lanes = getInstrumentDef(t.instrument.type).lanes.map(l => l.id);
        throw new Error(`Drum preview needs 'lane'. Lanes: ${lanes.join(', ')}.`);
      }
      const valid = getInstrumentDef(t.instrument.type).lanes.some(l => l.id === lane);
      if (!valid) throw new Error(`No lane '${lane}' on "${t.name}".`);
      this.engine.previewHit(t.id, lane, clamp(vel, 0, 1));
    } else {
      if (pitch === undefined) throw new Error("Synth preview needs 'pitch' (MIDI, 60 = C4).");
      this.engine.previewNote(t.id, clamp(Math.round(pitch), 24, 107), clamp(vel, 0, 1), clamp(dur, 0.05, 8));
    }
    return { ok: true, played: kind === 'drums' ? `${t.name}:${lane}` : `${t.name}:${midiName(pitch)}`, hint: this.audioHint() };
  }
}
