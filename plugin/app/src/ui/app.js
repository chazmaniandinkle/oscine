// App shell: builds the layout, routes the selected track to the right
// editor (piano roll vs step grid), owns the single rAF loop that feeds
// playhead + meters, and binds global keys.

import { el, Select } from './widgets.js';
import { TransportBar } from './transportbar.js';
import { TrackList } from './tracklist.js';
import { PianoRoll } from './pianoroll.js';
import { StepGrid } from './stepgrid.js';
import { Inspector } from './inspector.js';
import { Mixer } from './mixer.js';
import { KeyboardBar } from './keyboard.js';
import { getInstrumentDef } from '../engine/instruments/index.js';

const SNAP_CHOICES = [
  { value: 1, label: '1/4' },
  { value: 0.5, label: '1/8' },
  { value: 0.25, label: '1/16' },
  { value: 0.125, label: '1/32' },
];

export class App {
  constructor(rootEl, { store, bus, engine, transport }) {
    this.store = store;
    this.bus = bus;
    this.engine = engine;
    this.transport = transport;

    rootEl.textContent = '';

    const header = el('header');
    const body = el('div', 'body');
    const trackPanel = el('aside', 'panel');
    const center = el('main', 'center');
    const editorBar = el('div', 'editor-bar');
    const editorHost = el('div', 'editor-host');
    const inspectorPanel = el('aside', 'panel insp-panel');
    const mixerHost = el('div');
    const keysHost = el('footer');

    center.appendChild(editorBar);
    center.appendChild(editorHost);
    body.appendChild(trackPanel);
    body.appendChild(center);
    body.appendChild(inspectorPanel);
    rootEl.appendChild(header);
    rootEl.appendChild(body);
    rootEl.appendChild(mixerHost);
    rootEl.appendChild(keysHost);

    // Editor bar: title + snap control.
    this.editorTitle = el('div', 'editor-title', '');
    editorBar.appendChild(this.editorTitle);
    const spacer = el('div', 'spacer');
    editorBar.appendChild(spacer);
    const snapSel = Select({
      label: 'Snap',
      options: SNAP_CHOICES,
      value: store.ui.snap,
      onChange: v => { store.ui.snap = Number(v); },
    });
    snapSel.root.classList.add('snap-ctl');
    editorBar.appendChild(snapSel.root);

    // Components.
    this.transportBar = new TransportBar(header, this);
    this.trackList = new TrackList(trackPanel, this);
    this.pianoRoll = new PianoRoll(el('div'), this);
    this.stepGrid = new StepGrid(el('div'), this);
    this.inspector = new Inspector(inspectorPanel, this);
    this.mixer = new Mixer(mixerHost, this);
    this.keys = new KeyboardBar(keysHost, this);

    this.editorHost = editorHost;
    this.emptyState = el('div', 'editor-empty', 'Add a track to start composing.');

    bus.on('ui:selection', () => this.routeEditor());
    bus.on('project:replaced', () => this.routeEditor());
    bus.on('track:removed', () => this.routeEditor());

    this.bindGlobalKeys();
    this.routeEditor();
    this.startFrameLoop();
  }

  routeEditor() {
    const { store } = this;
    const track = store.getTrack(store.ui.selectedTrackId);
    this.editorHost.textContent = '';
    this.pianoRoll.active = false;
    this.stepGrid.active = false;

    if (!track) {
      this.editorHost.appendChild(this.emptyState);
      this.editorTitle.textContent = '';
      return;
    }

    const def = getInstrumentDef(track.instrument.type);
    if (def.kind === 'drums') {
      this.editorHost.appendChild(this.stepGrid.host);
      this.stepGrid.active = true;
      this.stepGrid.setTrack(track.id);
      this.editorTitle.textContent = `${track.name} — step grid`;
    } else {
      this.editorHost.appendChild(this.pianoRoll.host);
      this.pianoRoll.active = true;
      this.pianoRoll.setTrack(track.id);
      this.editorTitle.textContent = `${track.name} — piano roll`;
    }
    this.editorTitle.style.color = track.color;
  }

  bindGlobalKeys() {
    window.addEventListener('keydown', (e) => {
      const t = e.target;
      const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;

      if (e.code === 'Space' && !typing) {
        e.preventDefault();
        this.transport.toggle();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyZ' && !typing) {
        e.preventDefault();
        e.shiftKey ? this.store.redo() : this.store.undo();
        return;
      }
      // Slot switching from the number row.
      if (!typing && !e.metaKey && !e.ctrlKey && ['Digit1', 'Digit2', 'Digit3', 'Digit4'].includes(e.code)) {
        this.store.requestSlot(Number(e.code.slice(5)) - 1, this.transport.playing);
      }
    });
  }

  startFrameLoop() {
    const loop = () => {
      const pos = this.transport.getPosition();
      const masterLevel = this.engine.getLevel('master');
      this.transportBar.onFrame(pos, masterLevel);
      this.pianoRoll.onFrame(pos);
      this.stepGrid.onFrame(pos);
      this.mixer.onFrame();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}
