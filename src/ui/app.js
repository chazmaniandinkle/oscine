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

    // Source link, pinned to the corner in every deployment.
    const srcLink = el('a', 'src-link');
    srcLink.href = 'https://github.com/chazmaniandinkle/oscine';
    srcLink.target = '_blank';
    srcLink.rel = 'noopener';
    srcLink.title = 'Source on GitHub';
    srcLink.innerHTML = '<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>';
    rootEl.appendChild(srcLink);

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
