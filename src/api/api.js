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
import { clamp, deepClone, midiName, downloadBlob } from '../core/util.js';
import { encodeWav } from '../core/wav.js';
import { chordPitches } from '../core/chords.js';
import { validateEffectParams } from '../core/arrangement.js';
import { resolvePatternTarget } from '../engine/patternmix.js';
import { getEffectDef, listEffectDefs } from '../engine/effects/index.js';
import { buildShareUrl, fragmentFromUrl, decodeFragmentToProject } from '../core/share.js';
import * as Arr from '../core/arrangement.js';
import * as Src from '../core/sources.js';
import { prefs } from '../core/prefs/index.js';
import { sidecarUrl } from '../core/sidecar.js';

export class CommandAPI {
  constructor({ store, engine, transport, bus }) {
    this.store = store;
    this.engine = engine;
    this.transport = transport;
    this.bus = bus;
    this.version = API_VERSION;
    // File + library work happens in the sidecar (node). In the browser this
    // is a same-origin POST; tests can swap in a stub.
    this.sidecar = async (route, body) => {
      if (typeof fetch !== 'function' || typeof location === 'undefined') throw new Error(`${route} needs the Oscine sidecar (open the app from it).`);
      const res = await fetch(sidecarUrl(route), { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await res.text();
      if (!res.ok) throw new Error(text || `${route}: HTTP ${res.status}`);
      return JSON.parse(text);
    };
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
    throw new Error(`Bad slot '${ref}'. Use 'A'-'${SLOT_NAMES[SLOT_NAMES.length - 1]}' or 0-${SLOT_NAMES.length - 1}.`);
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
      midi: {
        enabled: store.ui.midi.enabled,
        input: store.ui.midi.inputName,
        channel: store.ui.midi.channel,
        record: store.ui.midi.record,
        knobs: Object.keys(store.ui.midi.knobs).length,
        velocity: { floor: store.ui.midi.velFloor, curve: store.ui.midi.velCurve, fixed: store.ui.midi.velFixed },
        lastVelocity: store.ui.midi.velMonitor.last,
      },
      ledger: this.ledgerSummary(),
    };
  }

  // Compact ledger stats for cmd_status: how many live events are buffered and
  // the wall-clock span they cover. Reads the ephemeral ring directly.
  ledgerSummary() {
    const events = this.store.ui.ledger.events;
    const count = events.length;
    const spanSec = count > 1
      ? (events[count - 1].t - events[0].t) / 1000
      : 0;
    return { count, spanSec };
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
    // Chord notes expand first: {start, chord:'Fm9', octave, dur, vel} -> one note per tone.
    const flat = [];
    notes.forEach((n, i) => {
      if (n.chord !== undefined && n.chord !== null) {
        let ps;
        try { ps = chordPitches(n.chord, n.octave ?? 3); } catch (e) { throw new Error(`notes[${i}]: ${e.message}`); }
        for (const pitch of ps) flat.push({ ...n, pitch, chord: undefined });
      } else flat.push(n);
    });
    const out = flat.map((n, i) => {
      if (n.start === undefined || n.pitch === undefined) {
        throw new Error(`notes[${i}] needs 'start' and either 'pitch' or 'chord'.`);
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

  cmd_set_notes({ track, mode, notes, ids, slot, from, to, transpose, shift, velScale, velSet, durScale, quantize }) {
    const t = this.resolveTrack(track);
    this.requireKind(t, 'synth', 'set_steps');
    const slotIdx = this.resolveSlot(slot);
    const loopBeats = this.store.project.slots[slotIdx].bars * 4;
    const { store } = this;

    store.checkpoint();
    let warning;
    if (mode === 'transform') {
      const cur = store.getPattern(t.id, slotIdx).notes;
      const idset = Array.isArray(ids) && ids.length ? new Set(ids) : null;
      const hit = n => (!idset || idset.has(n.id)) && (from === undefined || n.start >= from) && (to === undefined || n.start < to);
      let changed = 0, dropped = 0;
      const next = [];
      for (const n0 of cur) {
        if (!hit(n0)) { next.push(n0); continue; }
        const n = { ...n0 };
        if (transpose) n.pitch = clamp(n.pitch + Math.round(transpose), 24, 107);
        if (shift) n.start = n.start + Number(shift);
        if (quantize) n.start = Math.round(n.start / quantize) * quantize;
        if (velScale !== undefined) n.vel = clamp(n.vel * velScale, 0.05, 1);
        if (velSet !== undefined) n.vel = clamp(velSet, 0.05, 1);
        if (durScale) n.dur = Math.max(0.02, n.dur * durScale);
        if (n.start < 0) { dropped++; continue; }
        if (n.start >= loopBeats) warning = 'Some notes now start at/after the loop end; lengthen the slot to hear them.';
        next.push(n); changed++;
      }
      store.setNotes(t.id, next, slotIdx);
      const result = this.cmd_get_notes({ track: t.id, slot: slotIdx });
      result.transformed = changed; if (dropped) result.dropped = dropped;
      if (warning) result.warning = warning;
      return result;
    }
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

  cmd_slots({ action, slot, bars, from, to, track }) {
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
        if (track !== undefined && track !== null) {
          const t = this.resolveTrack(track);
          store.checkpoint();
          const src = store.project.slots[f].patterns[t.id];
          const dst = store.project.slots[tt];
          const copy = src ? deepClone(src) : null;
          if (copy && this.kindOf(t) === 'drums' && dst.bars !== store.project.slots[f].bars) {
            for (const k of Object.keys(copy.steps || {})) { const a = copy.steps[k].slice(0, dst.bars * 16); while (a.length < dst.bars * 16) a.push(0); copy.steps[k] = a; }
          }
          if (copy) dst.patterns[t.id] = copy; else delete dst.patterns[t.id];
          store.emit(this.kindOf(t) === 'drums' ? 'steps:changed' : 'notes:changed', { trackId: t.id });
          return { copied: `${t.name}: ${SLOT_NAMES[f]} -> ${SLOT_NAMES[tt]}`, slots: store.project.slots.map((_, i) => this.slotSummary(i)) };
        }
        store.copySlot(f, tt);
        return { copied: `${SLOT_NAMES[f]} -> ${SLOT_NAMES[tt]}`, slots: store.project.slots.map((_, i) => this.slotSummary(i)) };
      }
      default:
        throw new Error(`Bad action '${action}'.`);
    }
  }

  // -- MIDI input ------------------------------------------------------------
  // Pure config surface: reads/writes store.ui.midi and returns JSON. The
  // WebMIDI hardware lives in the browser (src/ui/midi.js); this handler never
  // touches navigator/window so it stays runnable headless (tests, sidecar).

  midiState() {
    const m = this.store.ui.midi;
    const peers = m.peers ?? 1;
    return {
      available: m.available,
      enabled: m.enabled,
      input: { id: m.inputId, name: m.inputName },
      channel: m.channel,
      record: m.record,
      learn: m.learnParam,
      devices: m.devices.map(d => ({ ...d })),
      knobs: { ...m.knobs },
      velocity: { floor: m.velFloor, curve: m.velCurve, fixed: m.velFixed },
      monitor: {                                      // raw 0..127 incoming velocity
        last: m.velMonitor.last,
        min: m.velMonitor.min,
        max: m.velMonitor.max,
        count: m.velMonitor.count,
        recent: [...m.velMonitor.recent],
      },
      owner: !!m.owner,                               // this tab holds MIDI
      peers,                                          // live same-origin tabs
      ownerElsewhere: m.enabled && !m.owner && peers > 1, // a peer holds it, not us
    };
  }

  // Validate a param key as a real numeric (knob) param on the selected track's
  // instrument, returning the resolved key. Throws actionable errors otherwise.
  resolveMidiParam(param) {
    const trackId = this.store.ui.selectedTrackId;
    const track = trackId && this.store.getTrack(trackId);
    if (!track) throw new Error('No track selected. Use select_track first, then map a knob to its instrument.');
    const def = getInstrumentDef(track.instrument.type);
    const p = def.params.find(x => x.key === param);
    if (!p) {
      const keys = def.params.filter(x => x.type !== 'select').map(x => x.key).join(', ');
      throw new Error(`No param '${param}' on ${def.label}. Numeric params: ${keys}.`);
    }
    if (p.type === 'select') {
      const keys = def.params.filter(x => x.type !== 'select').map(x => x.key).join(', ');
      throw new Error(`Param '${param}' on ${def.label} is a selector, not a knob; only numeric params map to a CC. Numeric params: ${keys}.`);
    }
    return p.key;
  }

  cmd_midi({ action, device, channel, record, floor, curve, fixed, bytes, reset, cc, param }) {
    const { store } = this;
    switch (action) {
      case 'status':
        return this.midiState();
      case 'enable':
        store.configureMidi({ enabled: true });
        return this.midiState();
      case 'disable':
        store.configureMidi({ enabled: false });
        return this.midiState();
      case 'select': {
        if (!device) throw new Error("action 'select' needs a 'device' (input id or name substring).");
        const devices = store.ui.midi.devices;
        if (!devices.length) {
          store.configureMidi({ inputId: device });
          return { ...this.midiState(), note: 'No MIDI devices are enumerated in this context; the browser app will bind this input id when it connects.' };
        }
        const needle = String(device).toLowerCase();
        const match = devices.find(d => d.id === device) ||
          devices.find(d => String(d.name).toLowerCase().includes(needle));
        if (!match) {
          const names = devices.map(d => `"${d.name}"`).join(', ');
          throw new Error(`No MIDI input '${device}'. Devices: ${names}.`);
        }
        store.configureMidi({ inputId: match.id });
        store.reportMidi({ inputName: match.name });
        return this.midiState();
      }
      case 'set': {
        if (channel === undefined && record === undefined &&
            floor === undefined && curve === undefined && fixed === undefined) {
          throw new Error("action 'set' needs at least one of 'channel', 'record', 'floor', 'curve', or 'fixed'.");
        }
        const patch = {};
        if (channel !== undefined) {
          const ch = Math.round(Number(channel));
          if (Number.isNaN(ch) || ch < 0 || ch > 16) throw new Error('channel must be an integer 0..16 (0 = omni).');
          patch.channel = ch;
        }
        if (record !== undefined) patch.record = !!record;
        if (Object.keys(patch).length) store.configureMidi(patch);
        // Velocity shaping rides its own action (store clamps each field).
        const vel = {};
        if (floor !== undefined) {
          if (Number.isNaN(Number(floor))) throw new Error('floor must be a number 0..1.');
          vel.floor = Number(floor);
        }
        if (curve !== undefined) {
          if (Number.isNaN(Number(curve))) throw new Error('curve must be a number 0.2..5.');
          vel.curve = Number(curve);
        }
        if (fixed !== undefined) {
          if (Number.isNaN(Number(fixed))) throw new Error('fixed must be a number 0..1 (0 = disabled).');
          vel.fixed = Number(fixed);
        }
        if (Object.keys(vel).length) store.setMidiVelocity(vel);
        return this.midiState();
      }
      case 'input': {
        // Inject a raw MIDI message into the same pipeline WebMIDI feeds. Pure:
        // emit a bus event; the browser MidiInput manager consumes it and runs
        // onMessage so velocity shaping, the monitor, and record-arm all apply.
        if (!Array.isArray(bytes) || bytes.length < 1 || bytes.length > 3 ||
            bytes.some(b => typeof b !== 'number' || !Number.isFinite(b))) {
          throw new Error("action 'input' needs 'bytes': a 1..3 length array of MIDI numbers, e.g. [144, 60, 100].");
        }
        const msg = bytes.map(b => clamp(Math.round(b), 0, 255));
        this.bus.emit('midi:inject', { bytes: msg });
        return { ok: true, injected: msg };
      }
      case 'monitor':
        if (reset === true) store.resetMidiVelocityMonitor();
        return this.midiState().monitor;
      case 'map': {
        if (cc === undefined) throw new Error("action 'map' needs a 'cc' (controller CC number 0..127).");
        if (param === undefined) throw new Error("action 'map' needs a 'param' (a numeric param key of the selected track's instrument).");
        const key = this.resolveMidiParam(param);
        store.mapMidiKnob(cc, key);
        return this.midiState();
      }
      case 'learn': {
        if (param === undefined) throw new Error("action 'learn' needs a 'param' (a numeric param key of the selected track's instrument).");
        const key = this.resolveMidiParam(param);
        store.armMidiLearn(key);
        return { ...this.midiState(), note: 'Turn a knob/control on the device to bind it.' };
      }
      case 'clear_map':
        if (cc !== undefined) store.mapMidiKnob(cc, null);
        else store.configureMidi({ knobs: {} });
        return this.midiState();
      case 'claim':
        // Take MIDI ownership for this tab. Intent only: the browser MIDI
        // manager reacts to 'midi:claim' and steals the lock + binds. Headless
        // (no app/coordinator) this is a harmless no-op that still returns state.
        store.requestMidiClaim();
        return { ...this.midiState(), note: 'Taking MIDI ownership for this tab.' };
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

  safeName() {
    return this.store.project.name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'song';
  }

  // -- song mode + listen (2026-10-08 fitting pass) ----------------------------
  // project.song = [slotIndex, ...]; absent = no song. Stored on the project so
  // it saves, shares and undoes like any other edit.

  songSequence(required = false) {
    const seq = this.store.project.song;
    if (!Array.isArray(seq) || !seq.length) {
      if (required) throw new Error("No song sequence. Set one with song {action:'set', sequence:['A','B',...]}.");
      return null;
    }
    return seq;
  }

  songLayout(seq) {
    const p = this.store.project, spb = 60 / p.bpm;
    let at = 0;
    return seq.map((i, n) => {
      const bars = p.slots[i].bars, sec = bars * 4 * spb;
      const row = { index: n, slot: SLOT_NAMES[i], bars, startSec: Math.round(at * 1000) / 1000, seconds: Math.round(sec * 1000) / 1000 };
      at += sec; return row;
    });
  }

  cmd_song({ action, sequence }) {
    const { store } = this;
    if (action === 'get') {
      const seq = this.songSequence();
      if (!seq) return { sequence: [], note: 'No song yet; renders use one slot.' };
      const sections = this.songLayout(seq);
      const last = sections[sections.length - 1];
      return { sequence: seq.map(i => SLOT_NAMES[i]), sections, totalSec: Math.round((last.startSec + last.seconds) * 1000) / 1000 };
    }
    if (action === 'set') {
      if (!Array.isArray(sequence) || !sequence.length) throw new Error("action 'set' needs a non-empty 'sequence' of slots.");
      const seq = sequence.map(s => this.resolveSlot(s, false));
      store.checkpoint();
      store.project.song = seq;
      store.emit('song:changed', { sequence: seq });
      return this.cmd_song({ action: 'get' });
    }
    if (action === 'clear') {
      store.checkpoint();
      delete store.project.song;
      store.emit('song:changed', { sequence: [] });
      return { sequence: [] };
    }
    throw new Error(`Bad action '${action}'. Use get, set or clear.`);
  }

  // The live ear (src/engine/earlive.js): lazily built so a headless/test API that never asks costs nothing.
  async liveEarOf() {
    if (!this._liveEar) {
      const { LiveEar } = await import('../engine/earlive.js');
      this._liveEar = new LiveEar({ engine: this.engine, transport: this.transport, store: this.store, bus: this.bus });
    }
    return this._liveEar;
  }

  async cmd_ear({ action = 'snapshot', hz } = {}) {
    if (!this.engine?.ctx) throw new Error('The live ear needs the running audio engine (open the app).');
    const ear = await this.liveEarOf();
    if (action === 'start') return ear.start({ hz });
    if (action === 'stop') return ear.stop();
    if (action === 'status') return ear.status();
    if (action === 'snapshot') return await ear.snapshot();
    throw new Error(`Bad action '${action}'. Use snapshot, start, stop or status.`);
  }

  async cmd_listen({ slot, loops = 1, song = false, solo, from, to, save }) {
    const { measure } = await import('../engine/listen.js');
    const p = deepClone(this.store.project);
    if (Array.isArray(solo) && solo.length) {
      const keep = new Set(solo.map(r => this.resolveTrack(r).id));
      for (const t of p.tracks) { t.channel.solo = false; t.channel.mute = !keep.has(t.id); }
    }
    const slotIdx = this.resolveSlot(slot);
    const sequence = song ? this.songSequence(true) : null;
    const { renderProjectToBuffer } = await import('../engine/render.js');
    const { buffer } = await renderProjectToBuffer(p, {
      slotIndex: slotIdx, loops: clamp(Math.round(loops), 1, 16), sequence, tailSeconds: 0.25,
    });
    const chans = []; for (let c = 0; c < buffer.numberOfChannels; c++) chans.push(buffer.getChannelData(c));
    const sr = buffer.sampleRate;
    const out = {
      rendered: song ? 'song' : `slot ${SLOT_NAMES[slotIdx]} x${loops}`,
      solo: Array.isArray(solo) && solo.length ? solo : undefined,
      bpm: p.bpm,
      ...measure(chans, sr, { bpm: p.bpm, from, to }),
    };
    if (song) {
      out.sections = this.songLayout(sequence).map(s => {
        const m = measure(chans, sr, { from: s.startSec, to: s.startSec + s.seconds });
        return { slot: s.slot, startSec: s.startSec, peakDb: m.peakDb, rmsDb: m.rmsDb, bands: m.bands };
      });
    }
    if (save) {
      const bytes = encodeWav(chans, sr);
      const res = await fetch(sidecarUrl('/render-save'), { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Path': save }, body: bytes });
      out.saved = res.ok ? (await res.json()).path : `not saved: ${await res.text()}`;
    }
    return out;
  }

  async cmd_export_wav({ slot, loops = 2, tailSeconds, sampleRate = 44100, song = false }) {
    const slotIdx = this.resolveSlot(slot);
    const loopCount = clamp(Math.round(loops), 1, 16);
    if (![44100, 48000].includes(sampleRate)) throw new Error('sampleRate must be 44100 or 48000.');
    const sequence = song ? this.songSequence(true) : null;

    const { buffer } = await this.engine.renderToBuffer({
      slotIndex: slotIdx, loops: loopCount, tailSeconds, sampleRate, sequence,
    });

    const channels = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
    const bytes = encodeWav(channels, buffer.sampleRate);

    const filename = `${this.safeName()}.wav`;
    downloadBlob(filename, bytes, 'audio/wav');

    return {
      ok: true,
      filename,
      slot: SLOT_NAMES[slotIdx],
      loops: loopCount,
      durationSec: Math.round(buffer.duration * 1000) / 1000,
      sampleRate: buffer.sampleRate,
      channels: buffer.numberOfChannels,
      bytes: bytes.length,
    };
  }

  async cmd_share({ action = 'link', url }) {
    const { store } = this;
    if (action === 'link') {
      const link = await buildShareUrl(store.project);
      const fragment = fragmentFromUrl(link);
      return { url: link, chars: link.length, fragmentChars: fragment?.length ?? 0, project: store.project.name };
    }
    if (action === 'open') {
      if (!url) throw new Error("action 'open' needs a 'url' (an Oscine share link or its '#s=...' fragment).");
      const fragment = fragmentFromUrl(url);
      if (!fragment) throw new Error("No share data in that URL (expected a '#s=...' fragment).");
      const project = await decodeFragmentToProject(fragment); // validates; throws on bad data
      store.checkpoint();
      store.project = project;
      store.afterReplace();
      return { ok: true, project: store.project.name, hint: 'Previous project is one undo away.' };
    }
    throw new Error(`Bad action '${action}'. Use 'link' or 'open'.`);
  }

  // -- performance ledger ----------------------------------------------------
  // Pure handler: reads the ephemeral ring (store.ui.ledger) and returns JSON.
  // No DOM/audio; uses only this.store and midiName. The ledger captures user
  // play even with the transport stopped, so clock time is the backbone and
  // the musical beat is null unless the transport was running.

  cmd_ledger({ action = 'read', limit, sinceSec, track } = {}) {
    const { store } = this;
    if (action === 'clear') {
      store.clearLedger();
      return { ok: true, cleared: true };
    }
    if (action !== 'read') throw new Error(`Bad action '${action}'. Use 'read' or 'clear'.`);

    let events = store.ui.ledger.events;

    // Optional track filter (by id or exact name, case-insensitive). resolveTrack
    // throws on an unknown track, which is the actionable behavior we want.
    if (track !== undefined && track !== null) {
      const t = this.resolveTrack(track);
      events = events.filter(e => e.trackId === t.id);
    }
    // sinceSec: only events within the last N seconds (relative to now).
    if (sinceSec !== undefined && sinceSec !== null) {
      const cutoff = Date.now() - Number(sinceSec) * 1000;
      events = events.filter(e => e.t >= cutoff);
    }
    // limit: keep the most recent N events (applied last, oldest-first preserved).
    if (limit !== undefined && limit !== null) {
      const n = Math.max(1, Math.floor(Number(limit)));
      if (events.length > n) events = events.slice(events.length - n);
    }

    const count = events.length;
    const firstT = count ? events[0].t : 0;
    const lastT = count ? events[count - 1].t : 0;
    const spanSec = count > 1 ? (lastT - firstT) / 1000 : 0;

    return {
      count,
      spanSec,
      events: events.map(e => ({ ...e })),
      notes: this.ledgerNotes(events, firstT, lastT),
    };
  }

  // Derive an agent-friendly view from raw ledger events: pair each note-on with
  // the next matching note-off (same trackId+pitch) into a played note, and list
  // drum hits. startSec is relative to the first event in the window; dur is the
  // held time in seconds. Sorted by startSec.
  ledgerNotes(events, firstT, lastT) {
    const MIN_DUR = 0.02; // floor so a tapped/just-pressed note still has length
    const out = [];
    const open = new Map(); // key trackId|pitch -> the open note-on entry

    for (const e of events) {
      if (e.kind === 'hit') {
        out.push({
          trackName: e.trackName,
          lane: e.lane,
          startSec: (e.t - firstT) / 1000,
          vel: e.vel,
        });
        continue;
      }
      if (e.kind !== 'note') continue;
      const key = `${e.trackId}|${e.pitch}`;
      if (e.on) {
        // A retriggered note-on for an already-held pitch (hardware/OSC MIDI
        // does no note-on dedup) would otherwise orphan the prior entry at
        // dur:null. Close it at this on's timestamp before opening the new one.
        const prior = open.get(key);
        if (prior) prior.dur = Math.max(MIN_DUR, (e.t - prior._onT) / 1000);
        const entry = {
          trackName: e.trackName,
          pitch: e.pitch,
          noteName: midiName(e.pitch),
          startSec: (e.t - firstT) / 1000,
          dur: null,        // filled when its note-off arrives (or when held)
          vel: e.vel,
          beat: e.beat ?? null,
          _onT: e.t,
        };
        open.set(key, entry);
        out.push(entry);
      } else {
        const entry = open.get(key);
        if (entry) {
          entry.dur = Math.max(MIN_DUR, (e.t - entry._onT) / 1000);
          open.delete(key);
        }
        // a note-off with no matching on (started before the window) is ignored
      }
    }

    // Any still-held note (no matching off in the window) ends at the last event.
    for (const entry of open.values()) {
      entry.dur = Math.max(MIN_DUR, (lastT - entry._onT) / 1000);
    }

    return out
      .map(({ _onT, ...rest }) => rest)
      .sort((a, b) => a.startSec - b.startSec);
  }

  // -- arrangement (v2) -------------------------------------------------------
  // Thin dispatch: the store actions (store.js) own checkpoint + bus events;
  // the pure edits live in core/arrangement.js.

  badAction(name, action, allowed) {
    return new Error(`Bad action '${action}' for ${name}. Use one of: ${allowed.join(', ')}.`);
  }

  cmd_arrangement({ action = 'get' } = {}) {
    if (action !== 'get') throw this.badAction('arrangement', action, ['get']);
    return Arr.summary(this.store.project);
  }

  cmd_clip(args) {
    const { store } = this, p = store.project;
    const { action, index, clip, asset, lane, at, t } = args;
    const needIndex = () => { if (index === undefined) throw new Error(`clip '${action}' needs 'index' (placement index from arrangement get).`); };
    switch (action) {
      case 'get': {
        Arr.requireArrangement(p);
        if (clip == null && index === undefined) throw new Error("clip 'get' needs 'clip' (id/name) or 'index'.");
        const ref = clip ?? p.arrangement.placements[index]?.clip;
        if (ref == null) throw new Error(`No placement at index ${index}.`);
        const c = Arr.resolveClip(p, ref);
        const placements = p.arrangement.placements.map((pl, i) => pl.clip === c.id ? Arr.placementSummary(p, pl, i) : null).filter(Boolean);
        return { clip: Arr.clipSummary(c), placements };
      }
      case 'set': {
        const ref = clip ?? (index !== undefined ? Arr.requireArrangement(p).placements[index]?.clip : undefined);
        if (ref == null) throw new Error("clip 'set' needs 'clip' (id/name) or a valid placement 'index'.");
        const fields = {};
        for (const k of ['in', 'out', 'gainDb', 'fadeIn', 'fadeOut', 'stretch', 'pitch', 'name']) if (args[k] !== undefined) fields[k] = args[k];
        return { ok: true, ...store.clipSet(ref, fields) };
      }
      case 'split':
        needIndex();
        if (typeof t !== 'number') throw new Error("clip 'split' needs 't' (song seconds inside the placement).");
        return { ok: true, ...store.clipSplit(index, t) };
      case 'duplicate': needIndex(); return { ok: true, ...store.clipDuplicate(index, { at, lane }) };
      case 'move': needIndex(); return { ok: true, ...store.clipMove(index, { at, lane }) };
      case 'remove': needIndex(); return { ok: true, ...store.clipRemove(index) };
      case 'place':
        if (lane == null) throw new Error("clip 'place' needs 'lane'.");
        return { ok: true, ...store.clipPlace({ clip, asset, lane, at }) };
      default: throw this.badAction('clip', action, ['get', 'set', 'split', 'duplicate', 'move', 'remove', 'place']);
    }
  }

  cmd_lane(args) {
    const { store } = this;
    const { action, lane, name, index } = args;
    const needLane = () => { if (lane == null) throw new Error(`lane '${action}' needs 'lane' (id or name).`); };
    switch (action) {
      case 'add': return { ok: true, ...store.laneAdd({ name, color: args.color }) };
      case 'remove': needLane(); return { ok: true, ...store.laneRemove(lane) };
      case 'rename': needLane(); return { ok: true, ...store.laneRename(lane, name) };
      case 'set': {
        needLane();
        const fields = {};
        for (const k of ['gainDb', 'pan', 'mute', 'solo', 'color']) if (args[k] !== undefined) fields[k] = args[k];
        return { ok: true, ...store.laneSet(lane, fields) };
      }
      case 'reorder':
        needLane();
        if (!Number.isInteger(index)) throw new Error("lane 'reorder' needs integer 'index' (0 = top).");
        return { ok: true, ...store.laneReorder(lane, index) };
      default: throw this.badAction('lane', action, ['add', 'remove', 'rename', 'set', 'reorder']);
    }
  }

  cmd_marker({ action, marker, t, name }) {
    const { store } = this;
    const needMarker = () => { if (marker == null) throw new Error(`marker '${action}' needs 'marker' (id or name).`); };
    switch (action) {
      case 'list': return Arr.listMarkers(store.project);
      case 'add': return { ok: true, ...store.markerAdd(t, name) };
      case 'move': needMarker(); return { ok: true, ...store.markerMove(marker, t) };
      case 'rename': needMarker(); return { ok: true, ...store.markerRename(marker, name) };
      case 'remove': needMarker(); return { ok: true, ...store.markerRemove(marker) };
      default: throw this.badAction('marker', action, ['list', 'add', 'move', 'rename', 'remove']);
    }
  }

  cmd_cycle({ action, a, b, on }) {
    const { store } = this;
    switch (action) {
      case 'get': return Arr.getCycle(store.project);
      case 'set': {
        const out = store.cycleSet({ a, b, on });
        this.transport?.armLoop?.();
        return { ok: true, ...out };
      }
      case 'clear': {
        const out = store.cycleClear();
        this.transport?.armLoop?.();
        return { ok: true, ...out };
      }
      default: throw this.badAction('cycle', action, ['get', 'set', 'clear']);
    }
  }

  cmd_range({ action, a, b, lanes }) {
    const { store } = this;
    switch (action) {
      case 'cut': return { ok: true, ...store.rangeCut(a, b, lanes) };
      case 'ripple_delete': {
        const out = store.rangeRippleDelete(a, b);
        this.transport?.armLoop?.();
        return { ok: true, ...out };
      }
      default: throw this.badAction('range', action, ['cut', 'ripple_delete']);
    }
  }

  // Pattern-side insert owner: a synth/drum track ('track:<name>' or a bare
  // track name when no arrangement lane matches) or 'pattern-master'.
  patternInsertOwner(lane) {
    const p = this.store.project;
    if (lane === 'pattern-master') { p.patternMaster ??= { inserts: [] }; p.patternMaster.inserts ??= []; return { owner: p.patternMaster, label: 'pattern-master' }; }
    const ref = String(lane).replace(/^track:/, '');
    const t = this.resolveTrack(ref);
    t.channel.inserts ??= [];
    return { owner: t.channel, label: `track:${t.name}` };
  }
  isPatternOwner(lane) {
    if (lane == null) return false;
    if (lane === 'pattern-master' || String(lane).startsWith('track:')) return true;
    // A bare name: pattern track wins only when no arrangement lane has it.
    const lanes = this.store.project.arrangement?.lanes ?? [];
    if (lanes.some(l => l.id === lane || l.name === lane)) return false;
    return this.store.project.tracks.some(t => t.id === lane || t.name === lane);
  }
  patternInsert(action, { lane, type, params, index, to, bypass }) {
    const { store } = this;
    const view = (x, i) => ({ index: i, type: x.type, bypass: !!x.bypass, params: { ...x.params } });
    const { owner, label } = this.patternInsertOwner(lane);
    const at = () => { if (!Number.isInteger(index) || index < 0 || index >= owner.inserts.length) throw new Error(`Bad insert index ${index} on ${label}; it has ${owner.inserts.length}.`); return index; };
    const done = (extra) => { store.emit('patternfx:changed', {}); return { ok: true, owner: label, ...extra, chain: owner.inserts.map(view) }; };
    switch (action) {
      case 'list': return { owner: label, inserts: owner.inserts.map(view), available: listEffectDefs().map(d => d.type) };
      case 'add': {
        if (!type) throw new Error(`add needs 'type'. Available: ${listEffectDefs().map(d => d.type).join(', ')}.`);
        getEffectDef(type); const vp = validateEffectParams(type, params);
        store.checkpoint(); owner.inserts.push({ type, params: vp, bypass: false });
        return done({ added: owner.inserts.length - 1 });
      }
      case 'set': {
        const i = at(); const ins = owner.inserts[i];
        if (params === undefined && bypass === undefined) throw new Error("set needs 'params' and/or 'bypass'.");
        const vp = params ? validateEffectParams(ins.type, params) : null;
        store.checkpoint(); if (vp) ins.params = { ...ins.params, ...vp }; if (bypass !== undefined) ins.bypass = !!bypass;
        return done({ set: i });
      }
      case 'remove': { const i = at(); store.checkpoint(); owner.inserts.splice(i, 1); return done({ removed: i }); }
      case 'move': {
        const i = at(); if (!Number.isInteger(to)) throw new Error("insert 'move' needs integer 'to'.");
        store.checkpoint(); const [x] = owner.inserts.splice(i, 1); owner.inserts.splice(Math.max(0, Math.min(owner.inserts.length, to)), 0, x);
        return done({ moved: [i, to] });
      }
      default: throw this.badAction('insert', action, ['list', 'add', 'set', 'remove', 'move']);
    }
  }

  cmd_pattern_automation({ action, slot, target, points }) {
    const { store } = this;
    const si = this.resolveSlot(slot);
    const s = store.project.slots[si];
    const beats = s.bars * 4;
    const resolve = () => {
      if (!target) throw new Error("needs 'target', e.g. 'track:Reese:insert:0:cutoff'.");
      const r = resolvePatternTarget(store.project, target, ref => this.resolveTrack(ref));
      const m = /^track:([^:]+):param:(\w+)$/.exec(r.target);
      if (m) {
        const t = store.project.tracks.find(x => x.id === m[1]);
        const ps = getInstrumentDef(t.instrument.type).params.find(p => p.key === m[2]);
        if (!ps || ps.type !== 'knob') throw new Error(`'${m[2]}' is not a knob on ${t.instrument.type}.`);
        r.range = { min: ps.min, max: ps.max };
      }
      return r;
    };
    const view = () => ({ slot: SLOT_NAMES[si], beats, envelopes: (s.automation ?? []).map(e => ({ target: this.prettyTarget(e.target), points: e.points })) });
    switch (action) {
      case 'list': return view();
      case 'set_points': {
        const { target: tg, range } = resolve();
        if (!Array.isArray(points) || !points.length) throw new Error("set_points needs 'points': [{beat, v, shape?}].");
        const pts = points.map((p, i) => {
          if (typeof p.beat !== 'number' || typeof p.v !== 'number') throw new Error(`points[${i}] needs numeric beat and v.`);
          return { beat: clamp(p.beat, 0, beats), v: range ? clamp(p.v, range.min, range.max) : p.v, ...(p.shape ? { shape: p.shape } : {}) };
        }).sort((a, b) => a.beat - b.beat);
        store.checkpoint();
        s.automation = (s.automation ?? []).filter(e => e.target !== tg);
        s.automation.push({ target: tg, points: pts });
        store.emit('patternfx:changed', {});
        return view();
      }
      case 'clear': {
        store.checkpoint();
        if (target) { const { target: tg } = resolve(); s.automation = (s.automation ?? []).filter(e => e.target !== tg); }
        else delete s.automation;
        store.emit('patternfx:changed', {});
        return view();
      }
      default: throw this.badAction('pattern_automation', action, ['list', 'set_points', 'clear']);
    }
  }
  prettyTarget(t) {
    return t.replace(/^track:([^:]+)/, (_, id) => `track:${this.store.project.tracks.find(x => x.id === id)?.name ?? id}`);
  }

  cmd_insert({ action, lane, type, params, index, to, bypass }) {
    if (this.isPatternOwner(lane)) return this.patternInsert(action, { lane, type, params, index, to, bypass });
    const { store } = this;
    const needIndex = () => { if (!Number.isInteger(index)) throw new Error(`insert '${action}' needs integer 'index' (see insert list).`); };
    switch (action) {
      case 'list': return Arr.listInserts(deepClone(store.project), lane);
      case 'add': return { ok: true, ...store.insertAdd(lane, type, params) };
      case 'set': needIndex(); return { ok: true, ...store.insertSet(lane, index, { params, bypass }) };
      case 'remove': needIndex(); return { ok: true, ...store.insertRemove(lane, index) };
      case 'move':
        needIndex();
        if (!Number.isInteger(to)) throw new Error("insert 'move' needs integer 'to'.");
        return { ok: true, ...store.insertMove(lane, index, to) };
      default: throw this.badAction('insert', action, ['list', 'add', 'set', 'remove', 'move']);
    }
  }

  cmd_automation({ action, target, points, t, v, shape, index }) {
    const { store } = this;
    const needTarget = () => { if (!target) throw new Error(`automation '${action}' needs 'target', e.g. 'lane:Vocal:gainDb'.`); };
    switch (action) {
      case 'list': return Arr.listAutomation(deepClone(store.project), target);
      case 'set_points': needTarget(); return { ok: true, ...store.automationSetPoints(target, points) };
      case 'add_point': needTarget(); return { ok: true, ...store.automationAddPoint(target, { t, v, shape }) };
      case 'remove_point': needTarget(); return { ok: true, ...store.automationRemovePoint(target, { index, t }) };
      case 'clear': needTarget(); return { ok: true, ...store.automationClear(target) };
      default: throw this.badAction('automation', action, ['list', 'set_points', 'add_point', 'remove_point', 'clear']);
    }
  }

  cmd_settings({ action, key, value }) {
    switch (action) {
      case 'get': return key ? prefs.all().find(p => p.key === key) ?? (() => { prefs.get(key); })() : { settings: prefs.all() };
      case 'set':
        if (key == null) throw new Error("settings 'set' needs 'key' and 'value'.");
        return { ok: true, key, value: prefs.set(key, value) };
      case 'reset': prefs.reset(key ?? null); return { ok: true, reset: key ?? 'all' };
      default: throw this.badAction('settings', action, ['get', 'set', 'reset']);
    }
  }

  cmd_words({ action, asset, clip, from, to, limit, words }) {
    const { store } = this;
    switch (action) {
      case 'get': return Arr.getWords(store.project, { asset, clip, from, to, limit });
      case 'set':
        if (asset == null) throw new Error("words 'set' needs 'asset'.");
        return { ok: true, ...store.wordsSet(asset, words) };
      default: throw this.badAction('words', action, ['get', 'set']);
    }
  }

  // -- sources: assets, variants, the Suno library ------------------------------

  projectDir() {
    const b = this.store.project.baseUrl || '';
    return b.startsWith('/project/') ? decodeURIComponent(b.slice('/project/'.length)).replace(/\/+$/, '') : '';
  }

  async cmd_asset(args) {
    const { store } = this, p = store.project;
    const { action, asset } = args;
    const needAsset = () => { if (asset == null) throw new Error(`asset '${action}' needs 'asset' (id or name).`); };
    switch (action) {
      case 'list': return Src.listAssets(p);
      case 'get': needAsset(); return Src.describeAsset(p, asset, { raw: !!args.raw });
      case 'source': {
        needAsset();
        if (!('source' in args)) throw new Error("asset 'source' needs 'source' (an object, or null to clear).");
        return { ok: true, ...store.assetSourceSet(asset, args.source, { merge: !!args.merge }) };
      }
      case 'variant-add': {
        needAsset();
        if (!args.variant) throw new Error("variant-add needs 'variant' (a name like 'user' or 'suno-wav').");
        Arr.resolveAsset(p, asset);
        let file;
        if (args.path) {
          const got = await this.sidecar('/asset/ingest', { path: args.path, projectDir: this.projectDir() });
          file = { sha256: got.sha256, ext: got.ext, filename: got.filename, codec: got.codec, sampleRate: got.sampleRate, channels: got.channels, duration: got.duration };
          file.origin = args.origin ?? (got.source ? 'suno-download' : 'user');
        } else if (args.sha256) file = { sha256: args.sha256, ext: args.ext, origin: args.origin ?? 'user' };
        else throw new Error("variant-add needs 'path' (a file under the project root) or 'sha256' (already in assets/).");
        if (args.note) file.note = args.note;
        return { ok: true, ...store.assetVariantAdd(asset, args.variant, file, { prefer: !!args.prefer, replace: !!args.replace }) };
      }
      case 'variant-remove': needAsset(); return { ok: true, ...store.assetVariantRemove(asset, args.variant) };
      case 'prefer': needAsset(); return { ok: true, ...store.assetPrefer(asset, args.variant ?? null) };
      case 'import': {
        if (!args.path) throw new Error("asset 'import' needs 'path' (an audio file under the project root).");
        Arr.requireArrangement(p);
        const got = await this.sidecar('/asset/ingest', { path: args.path, projectDir: this.projectDir() });
        const file = { sha256: got.sha256, ext: got.ext, filename: got.filename, codec: got.codec, sampleRate: got.sampleRate, channels: got.channels, duration: got.duration, origin: args.origin ?? (got.source ? 'suno-download' : 'import') };
        const variant = args.variant ?? 'default';
        const name = args.name ?? got.source?.title ?? got.filename?.replace(/\.[^.]+$/, '');
        const out = store.assetAdd({ id: args.id, name, duration: got.duration, variant, file, source: got.source });
        return { ok: true, ...out, suno: got.source?.id ?? null, lines: got.lines?.length ?? 0 };
      }
      default: throw this.badAction('asset', action, ['list', 'get', 'source', 'variant-add', 'variant-remove', 'prefer', 'import']);
    }
  }

  async cmd_suno(args) {
    const { action } = args;
    switch (action) {
      case 'library': return this.sidecar(`/suno/library?${new URLSearchParams({ ...(args.id ? { id: args.id } : {}), ...(args.full ? { full: '1' } : {}) })}`);
      case 'scan': return this.sidecar('/suno/scan', { dirs: args.dirs ?? [] });
      case 'import': {
        if (args.clips == null) throw new Error("suno 'import' needs 'clips' (an array of Suno clip objects, or {clips:[...]}).");
        return this.sidecar('/suno/import', { clips: args.clips });
      }
      case 'fetch': return this.sidecar('/suno/fetch', { id: args.id ?? null, all: !!args.all, max: args.max, force: !!args.force });
      case 'link': {
        if (args.asset == null || !args.id) throw new Error("suno 'link' needs 'asset' and 'id'.");
        Arr.resolveAsset(this.store.project, args.asset);
        const song = await this.sidecar(`/suno/library?${new URLSearchParams({ id: args.id, full: '1' })}`);
        const { seenIn, localFiles, ...rest } = song;
        const source = { ...rest, kind: 'suno' };
        if (args.sent) { source.sent = args.sent; source.provenance = { ...(source.provenance ?? {}), sent: 'user' }; }
        return { ok: true, ...this.store.assetSourceSet(args.asset, source, { merge: true }), title: source.title ?? null };
      }
      default: throw this.badAction('suno', action, ['library', 'scan', 'import', 'fetch', 'link']);
    }
  }
}
