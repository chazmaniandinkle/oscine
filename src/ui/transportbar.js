// Top bar: transport, tempo/swing, pattern slots, file ops, master level.

import { el, Knob, NumberDrag, Btn, ToggleBtn, Select, Meter, openMenu, toast } from './widgets.js';
import { SLOT_NAMES, BAR_CHOICES } from '../core/schema.js';
import { exportProject, importProjectFile, demoOrBlank, exportWav, copyShareLink } from './fileops.js';

export class TransportBar {
  constructor(host, app) {
    this.app = app;
    const { store, bus, transport } = app;
    this.store = store;
    this.transport = transport;

    host.classList.add('transportbar');

    // -- left: identity + transport --
    const left = el('div', 'tb-group');
    const logo = el('div', 'logo');
    logo.appendChild(el('span', 'logo-mark'));        // themeable cardinal mark (CSS mask)
    logo.appendChild(el('span', 'logo-word', 'OSCINE'));
    left.appendChild(logo);

    this.playBtn = el('button', 'btn play-btn', '▶');
    this.playBtn.title = 'Play/Stop (Space)';
    this.playBtn.addEventListener('click', () => transport.toggle());
    left.appendChild(this.playBtn);

    this.posEl = el('div', 'pos-readout', '1.1');
    left.appendChild(this.posEl);

    this.bpmCtl = NumberDrag({
      value: store.project.bpm, min: 40, max: 240, step: 1, suffix: ' bpm',
      title: 'Tempo: drag or double-click',
      onInput: v => store.setSetting('bpm', v),
      onCommit: v => store.setSetting('bpm', v),
    });
    left.appendChild(this.bpmCtl.root);

    this.swingCtl = Knob({
      label: 'Swing', min: 0, max: 1, value: store.project.swing, default: 0, small: true,
      format: v => Math.round(v * 100) + '%',
      onInput: v => store.setSetting('swing', v),
    });
    left.appendChild(this.swingCtl.root);

    this.metroCtl = ToggleBtn({
      label: 'Click', active: store.ui.metronome, title: 'Metronome',
      onChange: v => { store.ui.metronome = v; },
    });
    left.appendChild(this.metroCtl.root);

    // -- middle: pattern slots --
    const mid = el('div', 'tb-group tb-slots');
    mid.appendChild(el('div', 'tb-label', 'Pattern'));
    this.slotBtns = SLOT_NAMES.map((name, i) => {
      const b = el('button', 'btn slot-btn', name);
      b.title = `Pattern ${name} (switches at loop end while playing)`;
      b.addEventListener('click', () => store.requestSlot(i, transport.playing));
      mid.appendChild(b);
      return b;
    });

    this.barsCtl = Select({
      options: BAR_CHOICES.map(b => ({ value: b, label: `${b} bar${b > 1 ? 's' : ''}` })),
      value: store.getSlot().bars,
      onChange: v => store.setSlotBars(Number(v)),
    });
    mid.appendChild(this.barsCtl.root);

    const copyBtn = Btn('Copy', () => {
      const from = store.ui.activeSlot;
      openMenu(copyBtn, SLOT_NAMES
        .map((n, i) => ({ n, i }))
        .filter(x => x.i !== from)
        .map(x => ({
          label: `Copy ${SLOT_NAMES[from]} → ${x.n}`,
          onPick: () => { store.copySlot(from, x.i); toast(`Copied pattern ${SLOT_NAMES[from]} to ${x.n}`); },
        })));
    }, 'mini');
    copyBtn.title = 'Copy active pattern to another slot';
    mid.appendChild(copyBtn);

    // -- right: history, file ops, master --
    const right = el('div', 'tb-group');

    this.bridgeDot = el('span', 'bridge-dot');
    this.bridgeDot.title = 'MCP bridge: not connected';
    right.appendChild(this.bridgeDot);

    // Compact MIDI control: opens a menu built live from store.ui.midi
    // (enable/disable, record-arm, device pick). The MidiInput manager owns
    // the hardware and reacts to the 'midi:config' events these emit.
    this.midiBtn = Btn('MIDI', () => this.openMidiMenu(), 'mini midi-btn');
    right.appendChild(this.midiBtn);

    const undoBtn = Btn('↶', () => store.undo(), 'icon-btn');
    undoBtn.title = 'Undo (Cmd/Ctrl+Z)';
    const redoBtn = Btn('↷', () => store.redo(), 'icon-btn');
    redoBtn.title = 'Redo (Cmd/Ctrl+Shift+Z)';
    right.appendChild(undoBtn);
    right.appendChild(redoBtn);

    this.nameInput = el('input', 'song-name');
    this.nameInput.value = store.project.name;
    this.nameInput.spellcheck = false;
    this.nameInput.addEventListener('change', () => store.setSetting('name', this.nameInput.value));
    right.appendChild(this.nameInput);

    const fileBtn = Btn('File', () => {
      openMenu(fileBtn, [
        { label: 'Copy share link', onPick: () => copyShareLink(app.api) },
        { label: 'Export audio (.wav)', onPick: () => exportWav(app.api) },
        { label: 'Export song (.json)', onPick: () => exportProject(store) },
        { label: 'Import song…', onPick: () => this.pickImport() },
        { label: 'New: blank', onPick: () => demoOrBlank(store, 'blank') },
        { label: 'New: demo song', onPick: () => demoOrBlank(store, 'demo') },
      ]);
    });
    right.appendChild(fileBtn);

    this.fileInput = el('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = '.json,application/json';
    this.fileInput.style.display = 'none';
    this.fileInput.addEventListener('change', () => {
      const f = this.fileInput.files[0];
      if (f) {
        importProjectFile(f, store)
          .then(() => toast(`Loaded "${store.project.name}"`))
          .catch(err => toast('Import failed: ' + err.message));
      }
      this.fileInput.value = '';
    });
    right.appendChild(this.fileInput);

    this.masterCtl = Knob({
      label: 'Master', min: 0, max: 1.2, value: store.project.masterVolume, default: 0.85, small: true,
      onInput: v => store.setSetting('masterVolume', v),
    });
    right.appendChild(this.masterCtl.root);

    this.masterMeter = Meter({ horizontal: false });
    this.masterMeter.root.classList.add('tb-meter');
    right.appendChild(this.masterMeter.root);

    host.appendChild(left);
    host.appendChild(mid);
    host.appendChild(right);

    // -- reactions --
    const { bus: b } = app;
    b.on('transport:state', ({ playing }) => {
      this.playBtn.textContent = playing ? '■' : '▶';
      this.playBtn.classList.toggle('playing', playing);
    });
    b.on('slot:changed', () => this.paintSlots());
    b.on('slot:resized', () => this.barsCtl.set(store.getSlot().bars));
    b.on('ui:metronome', ({ value }) => this.metroCtl.set(value));
    b.on('bridge:status', ({ connected, url }) => {
      this.bridgeDot.classList.toggle('on', connected);
      if (!connected) { this.bridgeDot.classList.remove('multi', 'inactive'); this.bridgeDot.textContent = ''; }
      this.bridgeDot.title = connected ? `MCP bridge: connected (${url})` : 'MCP bridge: not connected';
    });
    b.on('bridge:sessions', ({ active, peers }) => {
      const multi = peers > 1;
      this.bridgeDot.classList.toggle('multi', multi);
      this.bridgeDot.classList.toggle('inactive', multi && !active);
      this.bridgeDot.textContent = multi ? String(peers) : '';
      this.bridgeDot.title = !multi
        ? 'MCP bridge: connected'
        : active
          ? `MCP bridge: this tab is the active session (${peers} tabs open)`
          : `MCP bridge: background session — another tab is active (${peers} tabs open)`;
    });
    b.on('midi:status', () => this.paintMidi());
    b.on('midi:config', () => this.paintMidi());
    b.on('settings:changed', ({ key }) => {
      if (key === 'bpm') this.bpmCtl.set(store.project.bpm);
      if (key === 'swing') this.swingCtl.set(store.project.swing);
      if (key === 'masterVolume') this.masterCtl.set(store.project.masterVolume);
      if (key === 'name') this.nameInput.value = store.project.name;
    });
    b.on('project:replaced', () => {
      this.bpmCtl.set(store.project.bpm);
      this.swingCtl.set(store.project.swing);
      this.masterCtl.set(store.project.masterVolume);
      this.nameInput.value = store.project.name;
      this.barsCtl.set(store.getSlot().bars);
      this.paintSlots();
    });

    this.paintSlots();
    this.paintMidi();
  }

  pickImport() {
    this.fileInput.click();
  }

  // Live MIDI menu: enable/disable, record-arm toggle, and (when devices are
  // enumerated) a device pick list. Each item writes config via the store; the
  // MidiInput manager reacts to 'midi:config' and rebinds the hardware.
  openMidiMenu() {
    const m = this.store.ui.midi;
    const ownerElsewhere = m.enabled && !m.owner && (m.peers ?? 1) > 1;
    const items = [
      {
        label: (m.enabled ? '✓ ' : '') + (m.enabled ? 'WebMIDI on' : 'Enable WebMIDI'),
        onPick: () => {
          this.store.configureMidi({ enabled: !m.enabled });
          toast(m.enabled ? 'WebMIDI off' : 'WebMIDI on');
        },
      },
      {
        label: (m.record ? '✓ ' : '') + 'Record-arm',
        onPick: () => {
          this.store.configureMidi({ record: !m.record });
          toast(m.record ? 'Record-arm off' : 'Record-arm on');
        },
      },
    ];
    // Another tab holds the hardware: offer a one-click take-over.
    if (ownerElsewhere) {
      items.push({
        label: 'Take over MIDI (held by another tab)',
        onPick: () => { this.store.requestMidiClaim(); toast('Taking MIDI ownership for this tab'); },
      });
    }
    if (m.available && m.devices.length) {
      for (const d of m.devices) {
        items.push({
          label: (d.id === m.inputId ? '✓ ' : '   ') + d.name,
          onPick: () => this.store.configureMidi({ inputId: d.id }),
        });
      }
    } else if (m.enabled && !m.available) {
      items.push({ label: '(no WebMIDI in this browser)', onPick: () => {} });
    } else if (m.enabled) {
      items.push({ label: '(no devices found)', onPick: () => {} });
    }
    openMenu(this.midiBtn, items);
  }

  paintMidi() {
    const m = this.store.ui.midi;
    const peers = m.peers ?? 1;
    const ownerElsewhere = m.enabled && !m.owner && peers > 1;
    const bound = m.available && !!m.inputName && !ownerElsewhere;
    this.midiBtn.classList.toggle('on', bound);
    this.midiBtn.classList.toggle('armed', !!m.record && m.enabled);
    // Deferred: enabled here but another tab owns the hardware.
    this.midiBtn.classList.toggle('deferred', ownerElsewhere);
    // Show the open-tab count when more than just this tab is live.
    this.midiBtn.textContent = peers > 1 ? `MIDI ${peers}` : 'MIDI';
    const chan = m.channel ? `ch ${m.channel}` : 'omni';
    this.midiBtn.title = !m.enabled
      ? 'MIDI input: disabled (click to enable)'
      : !m.available
        ? 'MIDI input: WebMIDI not available in this browser'
        : ownerElsewhere
          ? `MIDI input: held by another tab (${peers} tabs open) — click to take over`
          : bound
            ? `MIDI input: ${m.inputName} (${chan})${m.record ? ' — record-armed' : ''}`
            : 'MIDI input: enabled, no device bound';
  }

  paintSlots() {
    const { activeSlot, queuedSlot } = this.store.ui;
    this.slotBtns.forEach((b, i) => {
      b.classList.toggle('on', i === activeSlot);
      b.classList.toggle('queued', i === queuedSlot);
    });
    this.barsCtl.set(this.store.getSlot().bars);
  }

  onFrame(pos, masterLevel) {
    this.masterMeter.set(masterLevel);
    if (pos.playing) {
      const bar = Math.floor(pos.localBeat / 4) + 1;
      const beat = Math.floor(pos.localBeat % 4) + 1;
      this.posEl.textContent = `${bar}.${beat}`;
    } else if (this.posEl.textContent !== '1.1') {
      this.posEl.textContent = '1.1';
    }
  }
}
