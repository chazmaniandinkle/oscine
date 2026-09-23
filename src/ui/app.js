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
import { MidiInput } from './midi.js';
import { Timeline } from './timeline.js';
import { AssetBin } from './assetbin.js';
import { Toolbar } from './toolbar.js';
import { LyricsBar } from './lyricsbar.js';
import { StatusBar } from './statusbar.js';
import { saveProjectPath } from './fileops.js';
import { keymap } from '../core/keymap.js';
import { getInstrumentDef } from '../engine/instruments/index.js';

const SNAP_CHOICES = [
  { value: 1, label: '1/4' },
  { value: 0.5, label: '1/8' },
  { value: 0.25, label: '1/16' },
  { value: 0.125, label: '1/32' },
];

// Phone-width tab bar: [data-panel value, button label], in display order.
// Drives #app[data-panel] and is the only place these four strings are listed.
const MOBILE_PANELS = [
  ['tracks', 'Tracks'],
  ['editor', 'Editor'],
  ['inspector', 'Inspector'],
  ['mixer', 'Mixer'],
];

export class App {
  constructor(rootEl, { store, bus, engine, transport, api, crosstab, assetCache, ear }) {
    this.store = store;
    this.bus = bus;
    this.ear = ear ?? null;
    this.engine = engine;
    this.transport = transport;
    this.api = api;
    this.assetCache = assetCache;
    // Cross-tab coordination substrate (presence + exclusive ownership of
    // shared hardware). Set before MidiInput so its init() can read it.
    // May be undefined in headless/test contexts; the MIDI manager guards.
    this.crosstab = crosstab;

    rootEl.textContent = '';

    const header = el('header');
    const toolbarHost = el('div');
    const body = el('div', 'body');
    const trackPanel = el('aside', 'panel');
    const center = el('main', 'center');
    const editorBar = el('div', 'editor-bar');
    const editorHost = el('div', 'editor-host');
    const lyricsHost = el('div');
    const inspectorPanel = el('aside', 'panel insp-panel');
    const mixerHost = el('div');
    const keysHost = el('footer');
    const statusHost = el('div');

    center.appendChild(editorBar);
    center.appendChild(editorHost);
    center.appendChild(lyricsHost);
    body.appendChild(trackPanel);
    body.appendChild(center);
    body.appendChild(inspectorPanel);
    rootEl.appendChild(header);
    rootEl.appendChild(toolbarHost);
    rootEl.appendChild(body);
    rootEl.appendChild(mixerHost);
    rootEl.appendChild(keysHost);
    rootEl.appendChild(statusHost);
    this.lyricsHost = lyricsHost;

    // Editor bar: just the title now; snap/tools live in the toolbar.
    this.editorTitle = el('div', 'editor-title', '');
    editorBar.appendChild(this.editorTitle);
    const spacer = el('div', 'spacer');
    editorBar.appendChild(spacer);

    // Components. The left panel is either the instrument track list (pattern
    // projects) or the asset bin (arrangement projects); routeSidebar picks.
    this.transportBar = new TransportBar(header, this);
    this.trackListHost = el('div');
    this.assetBinHost = el('div');
    this.sidebarHost = trackPanel;
    this.trackList = new TrackList(this.trackListHost, this);
    this.pianoRoll = new PianoRoll(el('div'), this);
    this.stepGrid = new StepGrid(el('div'), this);
    this.timeline = new Timeline(el('div'), this);
    this.assetBin = new AssetBin(this.assetBinHost, this);
    this.inspector = new Inspector(inspectorPanel, this);
    this.mixer = new Mixer(mixerHost, this);
    this.keys = new KeyboardBar(keysHost, this);
    this.midi = new MidiInput(this);
    this.midi.init();
    // Bars: toolbar under the transport, lyrics under the editor, status at
    // the very bottom. Built after the components they read from.
    this.toolbar = new Toolbar(toolbarHost, this);
    this.lyrics = new LyricsBar(lyricsHost, this);
    this.status = new StatusBar(statusHost, this);
    bus.on('project:replaced', () => this.routeLyrics());
    this.routeLyrics();

    this.editorHost = editorHost;
    this.emptyState = el('div', 'editor-empty', 'Add a track to start composing.');

    // Mobile shell nav: on phone width the four side regions (Tracks / Editor /
    // Inspector / Mixer) collapse into mutually-exclusive full-width views,
    // chosen by this fixed bottom tab bar. Purely presentational: each tab flips
    // #app[data-panel] and the `is-active` class; CSS (a media block) shows only
    // the matching region. The element is display:none on desktop, so it is inert
    // there. No store action, no checkpoint, no event — see setMobilePanel.
    this.rootEl = rootEl;
    this.mobileTabs = [];
    const mobileNav = el('nav', 'mobile-nav');
    for (const [key, label] of MOBILE_PANELS) {
      const b = el('button', 'mobile-tab', label);
      b.type = 'button';
      b.dataset.panel = key;
      b.addEventListener('click', () => this.setMobilePanel(key));
      this.mobileTabs.push(b);
      mobileNav.appendChild(b);
    }
    // Appended below, after srcLink, so the nav is the LAST child of #app
    // (grid row 4); srcLink is an absolutely-positioned corner overlay and
    // takes no grid row, but the contract wants the nav last verbatim.
    this.mobileNav = mobileNav;

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

    // Last child of #app, after the keysHost footer and the corner link.
    rootEl.appendChild(this.mobileNav);

    this.bindGlobalKeys();
    this.routeEditor();
    this.setMobilePanel(this.store.ui.mobilePanel);
    this.startFrameLoop();
  }

  // Switch the phone-width full-width view. UI-only, like the snap onChange
  // above: it mutates store.ui directly with NO checkpoint, NO bus emit, NO
  // command — it only flips an attribute on #app and the active-tab class, and
  // CSS does the rest. The panels are plain DOM that already re-render off bus
  // events, so switching is instant with no re-render call. On desktop the
  // attribute and the (hidden) nav are inert; no desktop selector reads them.
  setMobilePanel(panel) {
    this.store.ui.mobilePanel = panel;
    this.rootEl.dataset.panel = panel;
    this.mobileTabs.forEach(b => b.classList.toggle('is-active', b.dataset.panel === panel));
  }

  // Lyrics bar shows only on arrangement projects with words, and only when
  // the user hasn't hidden it.
  routeLyrics() {
    const arr = this.store.project.arrangement;
    const want = !!arr?.placements?.length && this.store.ui.lyrics !== false && this.lyrics?.words?.length > 0;
    this.lyricsHost.classList.toggle('hidden', !want);
  }

  // Left panel: asset bin when the project is an arrangement, else the
  // instrument track list. Re-parents the pre-built hosts; no re-render.
  routeSidebar() {
    const want = this.store.project.arrangement?.placements?.length ? this.assetBinHost : this.trackListHost;
    if (this.sidebarHost.firstChild !== want) {
      this.sidebarHost.textContent = '';
      this.sidebarHost.appendChild(want);
      if (want === this.assetBinHost) this.assetBin.render();
    }
  }

  routeEditor() {
    const { store } = this;
    const track = store.getTrack(store.ui.selectedTrackId);
    this.editorHost.textContent = '';
    this.pianoRoll.active = false;
    this.stepGrid.active = false;
    this.timeline.active = false;
    this.routeSidebar();

    // An arrangement (v2 clips) takes the editor over: it's the song, and
    // pattern tracks are subordinate to it. Selecting a pattern track still
    // routes to its editor below; deselect (click empty) to see the timeline.
    const arr = store.project.arrangement;
    if (arr?.placements?.length && !track) {
      this.editorHost.appendChild(this.timeline.host);
      this.timeline.active = true;
      this.timeline.setProject(store.project);
      this.editorTitle.textContent = `${store.project.name} — arrangement`;
      this.editorTitle.style.color = '';
      return;
    }

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
    // One dispatcher: the keymap turns the event into an action name given
    // the current scope order; this table says what each action does. No
    // key codes live here. Escape-while-typing is left to the input.
    const handlers = {
      'transport.toggle':    () => this.transport.toggle(),
      'transport.stop':      () => { if (this.transport.playing) this.transport.stop(); else return false; },
      'transport.toStart':   () => { this.transport.songPos = 0; this.timeline.dirty = true; },
      'transport.playRange': () => { const r = this.timeline.range; if (!r) return false; this.transport.stop(); this.transport.songPos = r.a; this.transport.play(); },
      'project.save':        () => saveProjectPath(this.store, this.api),
      'edit.undo':           () => this.store.undo(),
      'edit.redo':           () => this.store.redo(),
      'clip.split':          () => this.timeline.splitSelectionAtRange(),
      'clip.delete':         () => this.timeline.selectedMarker ? this.timeline.deleteSelectedMarker() : this.timeline.deleteRangeFromSelection(),
      'marker.add':          () => { if (!this.timeline.active) return false; this.store.checkpoint(); const m = this.timeline.addMarker(this.transport.songPos); this.timeline.selectedMarker = m.id; },
      // Cycle is its own region (arrangement.loop), independent of the edit
      // range: C toggles it (creating it from the range, or 8 s at the
      // playhead, if it doesn't exist yet); ⌘U copies the range into it.
      'loop.toggle':         () => {
        const arr = this.store.project.arrangement; if (!this.timeline.active || !arr) return false;
        this.store.checkpoint();
        if (!arr.loop) { const r = this.timeline.range, p = this.transport.songPos; arr.loop = r ? { a: r.a, b: r.b, on: true } : { a: p, b: p + 8, on: true }; }
        else arr.loop.on = !arr.loop.on;
        this.transport.armLoop?.(); this.timeline.dirty = true; this.bus.emit('loop:changed', { ...arr.loop });
      },
      'loop.fromRange':      () => {
        const arr = this.store.project.arrangement, r = this.timeline.range; if (!arr || !r) return false;
        this.store.checkpoint(); arr.loop = { a: r.a, b: r.b, on: true };
        this.transport.armLoop?.(); this.timeline.dirty = true; this.bus.emit('loop:changed', { ...arr.loop });
      },
      'marker.prev':         () => this.timeline.active ? this.timeline.markerNav(-1) : false,
      'marker.next':         () => this.timeline.active ? this.timeline.markerNav(1) : false,
      'clip.pitchUp':        () => this.timeline.nudgeSelected(1, 'semitones'),
      'clip.pitchDown':      () => this.timeline.nudgeSelected(-1, 'semitones'),
      'clip.gainUp':         () => this.timeline.nudgeSelected(1, 'gainDb'),
      'clip.gainDown':       () => this.timeline.nudgeSelected(-1, 'gainDb'),
      'range.clear':         () => { if (!this.timeline.range) return false; this.timeline.range = null; this.timeline.multi = []; this.timeline.dirty = true; this.bus.emit('range:changed', {}); },
      'snap.toggle':         () => { this.store.ui.snapOn = this.store.ui.snapOn === false; this.timeline.dirty = true; this.bus.emit('ui:snap', {}); },
      'view.fit':            () => { this.timeline.fitToWidth(); this.timeline.dirty = true; },
      'view.zoomIn':         () => { this.timeline.zoomBy(1.25); },
      'view.zoomOut':        () => { this.timeline.zoomBy(0.8); },
      'view.follow':         () => { this.store.ui.follow = this.store.ui.follow === false; this.bus.emit('ui:view', {}); },
      'view.lyrics':         () => { this.store.ui.lyrics = this.store.ui.lyrics === false; this.routeLyrics(); this.bus.emit('ui:view', {}); },
      'slot.1': () => this.store.requestSlot(0, this.transport.playing),
      'slot.2': () => this.store.requestSlot(1, this.transport.playing),
      'slot.3': () => this.store.requestSlot(2, this.transport.playing),
      'slot.4': () => this.store.requestSlot(3, this.transport.playing),
    };
    window.addEventListener('keydown', (e) => {
      const t = e.target;
      const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
      if (typing) return;
      // Scope order = what's in front of the user. Timeline actions only
      // when the arrangement view is showing; slots only on the pattern side.
      const scopes = this.timeline.active ? ['timeline', 'global'] : ['pattern', 'pianoroll', 'global'];
      const action = keymap.action(e, scopes);
      if (!action || !handlers[action]) return;
      // A handler may return false to say "not applicable right now" so the
      // event falls through (e.g. Escape with nothing to clear).
      if (handlers[action]() === false) return;
      e.preventDefault();
    });
    this._handlers = handlers;
  }
  // Run a keymap action by name (toolbar buttons, menus). Same table as keys.
  runAction(action) { const h = this._handlers?.[action]; return h ? h() : false; }

  startFrameLoop() {
    const loop = () => {
      const pos = this.transport.getPosition();
      const masterLevel = this.engine.getLevel('master');
      this.transportBar.onFrame(pos, masterLevel);
      this.pianoRoll.onFrame(pos);
      this.stepGrid.onFrame(pos);
      this.timeline.onFrame(pos);
      this.lyrics.onFrame(pos);
      this.status.onFrame(pos);
      this.mixer.onFrame();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}
