// Footer keyboard: on-screen keys plus computer-keyboard playing.
// Melodic tracks: two octaves, A/W/S/E/D... rows, Z/X shift octave.
// Drum tracks: A,S,D,F,G,H,J,K fire the eight lanes.

import { el } from './widgets.js';
import { isBlackKey, midiName, clamp } from '../core/util.js';
import { getInstrumentDef } from '../engine/instruments/index.js';

const KEY_TO_OFFSET = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6,
  KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13,
  KeyL: 14, KeyP: 15, Semicolon: 16, Quote: 17,
};
const DRUM_KEYS = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK'];

export class KeyboardBar {
  constructor(host, app) {
    this.app = app;
    this.store = app.store;
    this.host = host;
    host.classList.add('keysbar');

    this.baseOctave = 4; // C4 = midi 60 at key A... base midi = octave*12
    this.heldComputer = new Map(); // code -> midi
    this.heldPointer = new Map();  // pointerId -> midi
    this.keyEls = new Map();       // midi -> element

    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));
    window.addEventListener('blur', () => this.releaseAll());

    const { bus } = app;
    bus.on('ui:selection', () => this.render());
    bus.on('project:replaced', () => this.render());
    bus.on('track:removed', () => this.render());

    this.render();
  }

  get track() {
    return this.store.getTrack(this.store.ui.selectedTrackId);
  }

  get kind() {
    const t = this.track;
    return t ? getInstrumentDef(t.instrument.type).kind : null;
  }

  get baseMidi() { return this.baseOctave * 12 + 12; } // C of baseOctave

  // -- rendering -----------------------------------------------------------

  render() {
    this.releaseAll();
    const host = this.host;
    host.textContent = '';
    this.keyEls.clear();

    const t = this.track;
    if (!t) { host.classList.add('hidden'); return; }
    host.classList.remove('hidden');

    if (this.kind === 'drums') {
      this.renderDrumPads(t);
    } else {
      this.renderPiano(t);
    }
  }

  renderDrumPads(track) {
    const def = getInstrumentDef(track.instrument.type);
    const wrap = el('div', 'pads');
    def.lanes.forEach((lane, i) => {
      const pad = el('button', 'pad');
      pad.type = 'button';
      pad.appendChild(el('div', 'pad-key', DRUM_KEYS[i] ? DRUM_KEYS[i].replace('Key', '') : ''));
      pad.appendChild(el('div', 'pad-label', lane.label));
      pad.style.borderColor = track.color;
      pad.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.app.engine.previewHit(track.id, lane.id);
        pad.classList.add('pressed');
      });
      pad.addEventListener('pointerup', () => pad.classList.remove('pressed'));
      pad.addEventListener('pointerleave', () => pad.classList.remove('pressed'));
      this.keyEls.set('lane:' + lane.id, pad);
      wrap.appendChild(pad);
    });
    this.host.appendChild(wrap);
  }

  renderPiano(track) {
    const wrap = el('div', 'piano');

    const octDown = el('button', 'btn mini', '−');
    octDown.title = 'Octave down (Z)';
    octDown.addEventListener('click', () => this.shiftOctave(-1));
    const octLabel = el('div', 'oct-label', `C${this.baseOctave}`);
    this.octLabel = octLabel;
    const octUp = el('button', 'btn mini', '+');
    octUp.title = 'Octave up (X)';
    octUp.addEventListener('click', () => this.shiftOctave(1));
    const octCtl = el('div', 'oct-ctl');
    octCtl.appendChild(octDown);
    octCtl.appendChild(octLabel);
    octCtl.appendChild(octUp);
    wrap.appendChild(octCtl);

    const keys = el('div', 'piano-keys');
    const span = 24; // two octaves
    for (let i = 0; i <= span; i++) {
      const midi = this.baseMidi + i;
      const black = isBlackKey(midi);
      const key = el('div', 'pkey ' + (black ? 'black' : 'white'));
      key.dataset.midi = midi;
      if (midi % 12 === 0) key.appendChild(el('div', 'pkey-label', midiName(midi)));
      this.keyEls.set(midi, key);

      key.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        key.setPointerCapture?.(e.pointerId);
        this.pointerNoteOn(e.pointerId, midi);
      });
      key.addEventListener('pointerenter', (e) => {
        if (this.heldPointer.has(e.pointerId)) this.pointerNoteOn(e.pointerId, midi);
      });
      key.addEventListener('pointerup', (e) => this.pointerNoteOff(e.pointerId));
      key.addEventListener('pointercancel', (e) => this.pointerNoteOff(e.pointerId));
      keys.appendChild(key);
    }
    wrap.appendChild(keys);
    this.host.appendChild(wrap);
  }

  shiftOctave(d) {
    this.baseOctave = clamp(this.baseOctave + d, 1, 7);
    this.render();
  }

  // -- pointer playing --------------------------------------------------------

  pointerNoteOn(pointerId, midi) {
    const t = this.track;
    if (!t || this.kind !== 'synth') return;
    const prev = this.heldPointer.get(pointerId);
    if (prev === midi) return;
    if (prev != null) this.noteOff(prev);
    this.heldPointer.set(pointerId, midi);
    this.noteOn(midi);
  }

  pointerNoteOff(pointerId) {
    const midi = this.heldPointer.get(pointerId);
    if (midi == null) return;
    this.heldPointer.delete(pointerId);
    this.noteOff(midi);
  }

  // -- computer keyboard --------------------------------------------------------

  shouldIgnore(e) {
    const t = e.target;
    return e.metaKey || e.ctrlKey || e.altKey ||
      t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
  }

  onKeyDown(e) {
    if (e.repeat || this.shouldIgnore(e)) return;
    const t = this.track;
    if (!t) return;

    if (e.code === 'KeyZ') { this.shiftOctave(-1); return; }
    if (e.code === 'KeyX') { this.shiftOctave(1); return; }

    if (this.kind === 'drums') {
      const laneIdx = DRUM_KEYS.indexOf(e.code);
      if (laneIdx >= 0) {
        const def = getInstrumentDef(t.instrument.type);
        const lane = def.lanes[laneIdx];
        if (lane) {
          this.app.engine.previewHit(t.id, lane.id);
          const pad = this.keyEls.get('lane:' + lane.id);
          pad?.classList.add('pressed');
          setTimeout(() => pad?.classList.remove('pressed'), 120);
        }
      }
      return;
    }

    const offset = KEY_TO_OFFSET[e.code];
    if (offset === undefined || this.heldComputer.has(e.code)) return;
    const midi = this.baseMidi + offset;
    this.heldComputer.set(e.code, midi);
    this.noteOn(midi);
  }

  onKeyUp(e) {
    const midi = this.heldComputer.get(e.code);
    if (midi == null) return;
    this.heldComputer.delete(e.code);
    this.noteOff(midi);
  }

  // -- shared ---------------------------------------------------------------------

  noteOn(midi) {
    const t = this.track;
    if (!t) return;
    this.app.engine.previewOn(t.id, midi, 0.9);
    this.keyEls.get(midi)?.classList.add('pressed');
  }

  noteOff(midi) {
    const t = this.track;
    if (t) this.app.engine.previewOff(t.id, midi);
    this.keyEls.get(midi)?.classList.remove('pressed');
  }

  releaseAll() {
    for (const midi of this.heldComputer.values()) this.noteOff(midi);
    for (const midi of this.heldPointer.values()) this.noteOff(midi);
    this.heldComputer.clear();
    this.heldPointer.clear();
  }
}
