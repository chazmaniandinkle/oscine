// WebMIDI hardware input. This is the ONLY place navigator.requestMIDIAccess
// is used; src/core/ and src/api/ stay browser-free. The manager reacts to
// store.ui.midi config (set by the 'midi' command, the transport bar control,
// or a restored localStorage blob) and routes incoming hardware to the engine
// preview path plus store edits. It never mutates the project document
// directly and never touches audio nodes (only engine.previewOn/Off/Hit).
//
// Flow: hardware message -> store action / engine preview. Config flows the
// other way: 'midi:config' -> apply() rebinds the device. Runtime/device
// state is published back through store.reportMidi ('midi:status'); the manager
// only listens to 'midi:config', so there's no feedback loop.

import { getInstrumentDef } from '../engine/instruments/index.js';
import { clamp, denorm, roundTo } from '../core/util.js';

const LS_KEY = 'oscine.midi';

export class MidiInput {
  constructor(app) {
    this.app = app;
    this.store = app.store;
    this.bus = app.bus;
    this.engine = app.engine;
    this.transport = app.transport;

    this.access = null;          // MIDIAccess once granted
    this.take = false;           // one undo checkpoint per record take
    this.held = new Map();       // synth: midi -> { start, vel }
    this.armed = !!this.store.ui.midi.record; // track record arm for disarm edge

    // Cross-tab MIDI ownership: only one same-origin tab binds the hardware at
    // a time. app.crosstab (wired in src/ui/app.js) is the coordinator; it may
    // be absent or unsupported, in which case every method below degrades to a
    // single-tab no-op and the manager binds exactly as it did before.
    this.crosstab = app.crosstab || null;
    this.owns = false;           // this tab currently holds the 'midi' lock
    this.claiming = false;       // a take-over (steal) is in flight

    // Restore persisted config before init so apply() acts on it.
    this.restore();

    this.bus.on('midi:config', () => this.apply());
    this.bus.on('midi:config', () => this.persist());
    // 'midi:claim' is take-over intent (from the command/UI): forcibly steal the
    // lock from whichever tab holds it, then bind here.
    this.bus.on('midi:claim', () => this.takeOver());
    this.bus.on('transport:state', ({ playing }) => { if (!playing) this.endTake(); });

    this.wireCrosstab();
  }

  // -- cross-tab ownership ---------------------------------------------------
  // Subscribe to the coordinator once. onLost fires when another tab steals the
  // 'midi' lock; onPresence keeps the peer count current for the indicator.
  // All guarded so an absent/unsupported coordinator is a clean no-op.

  wireCrosstab() {
    const ct = this.crosstab;
    if (!ct) return;
    ct.onLost?.('midi', () => {
      this.owns = false;
      // Clear the roster ownership too: the steal-loss path doesn't go through
      // release()/setOwn(false), so without this the de-owned tab keeps
      // heartbeating owns:['midi'] and the presence roster reports two owners.
      this.crosstab?.setOwn?.('midi', false);
      if (this.access) this.unbindAll();
      this.store.reportMidi({ owner: false });
    });
    ct.onPresence?.(() => {
      this.store.reportMidi({ peers: ct.peers ? ct.peers.length : 1 });
    });
  }

  // -- persistence (config only; runtime/device fields are never stored) ----

  restore() {
    if (typeof localStorage === 'undefined') return;
    try {
      const saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
      if (!saved) return;
      const patch = {};
      if ('enabled' in saved) patch.enabled = saved.enabled;
      if ('inputId' in saved) patch.inputId = saved.inputId;
      if ('channel' in saved) patch.channel = saved.channel;
      if ('knobs' in saved) patch.knobs = saved.knobs;
      this.store.configureMidi(patch);
    } catch { /* corrupt blob: ignore */ }
  }

  persist() {
    if (typeof localStorage === 'undefined') return;
    const m = this.store.ui.midi;
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        enabled: m.enabled, inputId: m.inputId, channel: m.channel, knobs: m.knobs,
      }));
    } catch { /* quota/private mode: ignore */ }
  }

  // -- lifecycle ------------------------------------------------------------

  init() {
    // Seed the peer count even before any device is bound, so the indicator is
    // right from the first paint (degrades to 1 when there is no coordinator).
    this.store.reportMidi({ peers: this.crosstab?.peers ? this.crosstab.peers.length : 1 });
    if (typeof navigator === 'undefined' || !navigator.requestMIDIAccess) {
      this.store.reportMidi({ available: false });
      return;
    }
    if (this.store.ui.midi.enabled) this.enable();
  }

  apply() {
    // End the current take when record is disarmed while the transport keeps
    // playing, so the next take opens its own undo checkpoint and no key
    // released after disarm is tied to the stale start of the prior take.
    const armed = !!this.store.ui.midi.record;
    if (this.armed && !armed) this.endTake();
    this.armed = armed;
    const enabled = this.store.ui.midi.enabled;
    if (enabled) {
      if (this.access) this.refresh();   // already bound: just re-evaluate inputs
      else this.enable();                // not bound yet: claim ownership, then bind
    } else if (this.access || this.owns) {
      this.unbindAll();
      this.releaseOwnership();
    }
    this.persist();
  }

  // Claim MIDI ownership (cooperatively: do not steal a lock another tab holds),
  // and bind the hardware only if we got it. With no coordinator the claim
  // resolves "degraded true" and we bind exactly as before. A second tab that
  // auto-enables a persisted config naturally defers here instead of double-
  // binding, because the lock is already held by the first tab.
  enable() {
    this.acquire(false).then((got) => {
      if (!this.store.ui.midi.enabled) return; // disabled while we awaited
      if (got) {
        this.bindOwned();
      } else if (!this.owns && !this.claiming) {
        // Another tab owns MIDI: stay deferred (unbound) and advertise it. Skip
        // if a take-over (steal) is in flight, so its result is not clobbered.
        this.store.reportMidi({ owner: false });
      }
    });
  }

  // Take-over intent ('midi:claim'): forcibly steal the lock, then bind here.
  // Enabling MIDI first if it was off, so a take-over from a fresh tab works.
  takeOver() {
    // Already the owner: don't re-request with steal:true. A self-steal
    // releases this tab's own lock first, rejecting the prior claim()'s promise
    // and firing onLost, which can leave MIDI in an inconsistent owned/bound
    // state. Just (re)bind here.
    if (this.owns) { this.bindOwned(); return; }
    this.claiming = true;
    if (!this.store.ui.midi.enabled) this.store.configureMidi({ enabled: true });
    this.acquire(true).then(() => {
      this.claiming = false;
      if (!this.store.ui.midi.enabled) return;
      this.bindOwned();
    });
  }

  // Become the owner: mark the roster, bind the device, publish owner:true.
  bindOwned() {
    this.owns = true;
    this.crosstab?.setOwn?.('midi', true);
    if (this.access) this.refresh();
    else this.requestAccess();
    this.store.reportMidi({ owner: true });
  }

  // Resolve the coordinator's claim to a boolean. No coordinator -> always true
  // (degraded: single-tab, no real exclusivity, bind as today).
  acquire(steal) {
    const ct = this.crosstab;
    if (!ct?.claim) return Promise.resolve(true);
    try {
      return Promise.resolve(ct.claim('midi', { steal })).catch(() => true);
    } catch {
      return Promise.resolve(true);
    }
  }

  releaseOwnership() {
    this.owns = false;
    this.crosstab?.release?.('midi');
    this.store.reportMidi({ owner: false });
  }

  requestAccess() {
    // Guard here too (not just in init): a take-over/claim can reach this path
    // in a browser without WebMIDI (older Safari) where it must be a no-op.
    if (typeof navigator === 'undefined' || !navigator.requestMIDIAccess) {
      this.store.reportMidi({ available: false });
      return;
    }
    navigator.requestMIDIAccess({ sysex: false }).then((acc) => {
      this.access = acc;
      acc.onstatechange = () => this.refresh();
      this.refresh();
    }).catch(() => this.store.reportMidi({ available: false }));
  }

  // Enumerate inputs, bind message handler to the preferred (or first) one,
  // and publish the observed device state back to the store. When a coordinator
  // is present and another tab owns MIDI, this tab stays deferred: it still
  // enumerates devices (so the menu is informative) but binds nothing.
  refresh() {
    if (!this.access) return;
    const midi = this.store.ui.midi;
    const inputs = [...this.access.inputs.values()];
    const devices = inputs.map(i => ({ id: i.id, name: i.name }));
    // No coordinator -> bind as today; coordinator present -> bind only if owner.
    const mayBind = !this.crosstab || this.owns;
    const bound = mayBind ? (inputs.find(i => i.id === midi.inputId) || inputs[0] || null) : null;
    for (const input of inputs) {
      input.onmidimessage = (input === bound) ? (e) => this.onMessage(e) : null;
    }
    this.store.reportMidi({
      available: true,
      devices,
      inputName: bound ? bound.name : null,
      inputId: bound ? bound.id : midi.inputId,
    });
  }

  unbindAll() {
    if (this.access) {
      for (const input of this.access.inputs.values()) input.onmidimessage = null;
      this.access.onstatechange = null;
      this.access = null; // drop the binding so a re-enable re-claims ownership
    }
    this.endTake();
  }

  // -- message parsing ------------------------------------------------------

  onMessage(e) {
    const [status, d1, d2] = e.data;
    const type = status & 0xf0;
    const chan = (status & 0x0f) + 1;
    const midi = this.store.ui.midi;
    if (midi.channel && chan !== midi.channel) return; // 0 = omni
    if (type === 0x90 && d2 > 0) this.noteOn(d1, d2 / 127);
    else if (type === 0x80 || (type === 0x90 && d2 === 0)) this.noteOff(d1);
    else if (type === 0xB0) this.control(d1, d2);
    // pitch bend, aftertouch, program change ignored for v1.
  }

  // -- selected track helpers -----------------------------------------------

  get track() {
    return this.store.getTrack(this.store.ui.selectedTrackId);
  }

  defOf(track) {
    return getInstrumentDef(track.instrument.type);
  }

  // -- note routing (engine preview + optional record) ----------------------

  noteOn(midi, vel) {
    const track = this.track;
    if (!track) return;
    const def = this.defOf(track);
    if (def.kind === 'drums') {
      const lanes = def.lanes;
      const laneIndex = ((midi - 36) % lanes.length + lanes.length) % lanes.length;
      const lane = lanes[laneIndex];
      this.engine.previewHit(track.id, lane.id, vel);
      this.recordStep(track, lane.id, vel);
    } else {
      this.engine.previewOn(track.id, midi, vel);
      this.recordNoteOn(track, midi, vel);
    }
  }

  noteOff(midi) {
    const track = this.track;
    if (!track) return;
    if (this.defOf(track).kind !== 'drums') {
      this.engine.previewOff(track.id, midi);
      this.recordNoteOff(track, midi);
    }
  }

  // -- recording ------------------------------------------------------------
  // Active only while record-armed AND the transport is playing. One
  // checkpoint per take groups all notes/steps; addNote/setStep deliberately
  // don't checkpoint on their own.

  get recording() {
    return this.store.ui.midi.record && this.transport.getPosition().playing;
  }

  quant(beat) {
    const s = this.store.ui.snap || 0.25;
    return Math.round(beat / s) * s;
  }

  recordNoteOn(track, midi, vel) {
    if (!this.recording) return;
    const pos = this.transport.getPosition();
    if (!this.take) { this.store.checkpoint(); this.take = true; }
    const start = this.quant(pos.localBeat) % pos.loopBeats;
    // Hold the monotonic absolute beat so the duration survives any number of
    // loop wraps between note-on and note-off; `start` is the loop-local slot
    // position the note is written at. Appended on note-off for the duration.
    this.held.set(midi, { start, absStart: pos.absBeat, vel });
  }

  recordNoteOff(track, midi) {
    const h = this.held.get(midi);
    if (!h) return;
    this.held.delete(midi);
    const pos = this.transport.getPosition();
    // Difference the quantized monotonic beats so a note sustained across one
    // or more full loops keeps its true length instead of undercounting.
    let dur = this.quant(pos.absBeat) - this.quant(h.absStart);
    dur = Math.max(this.store.ui.snap || 0.25, dur);
    this.store.addNote(track.id, { start: h.start, pitch: midi, dur, vel: h.vel });
  }

  recordStep(track, laneId, vel) {
    if (!this.recording) return;
    const pos = this.transport.getPosition();
    if (!this.take) { this.store.checkpoint(); this.take = true; }
    const bars = this.store.project.slots[this.store.ui.activeSlot].bars;
    const idx = Math.round(pos.localBeat / 0.25) % (bars * 16);
    this.store.setStep(track.id, laneId, idx, Math.max(0.05, vel));
  }

  endTake() {
    this.take = false;
    this.held.clear();
  }

  // -- CC -> param (knob mapping / learn) -----------------------------------

  control(cc, val) {
    const midi = this.store.ui.midi;
    if (midi.learnParam) { this.store.mapMidiKnob(cc, midi.learnParam); return; }
    const key = midi.knobs[cc];
    if (!key) return;
    const track = this.track;
    if (!track) return;
    const def = this.defOf(track);
    const p = def.params.find(x => x.key === key);
    if (!p || p.type === 'select') return;
    let value = denorm(val / 127, p.min, p.max, p.curve || 'lin');
    if (p.step) value = roundTo(value, p.step);
    value = clamp(value, p.min, p.max);
    this.store.setTrackParam(track.id, key, value); // continuous: non-undoable by design
  }
}
