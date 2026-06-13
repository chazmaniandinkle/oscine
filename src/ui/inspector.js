// Right panel: instrument editor for the selected track, rendered
// entirely from the instrument's param schema (knobs/selects grouped by
// `group`), plus the channel section (pan + sends). Any instrument added
// to the registry gets a working inspector for free.

import { el, Knob, Select } from './widgets.js';
import { getInstrumentDef } from '../engine/instruments/index.js';

export class Inspector {
  constructor(host, app) {
    this.app = app;
    this.store = app.store;
    this.host = host;
    host.classList.add('inspector');
    this.controls = new Map(); // paramKey -> widget

    const { bus } = app;
    bus.on('ui:selection', () => this.render());
    bus.on('preset:applied', ({ trackId }) => {
      if (trackId === this.store.ui.selectedTrackId) this.render();
    });
    bus.on('project:replaced', () => this.render());
    bus.on('param:changed', ({ trackId, key, value }) => {
      if (trackId === this.store.ui.selectedTrackId) this.controls.get(key)?.set(value);
    });
    bus.on('channel:changed', ({ trackId, key }) => {
      const t = this.store.getTrack(trackId);
      if (t && trackId === this.store.ui.selectedTrackId) {
        this.controls.get('ch:' + key)?.set(t.channel[key]);
      }
    });

    this.render();
  }

  render() {
    const { store, host } = this;
    host.textContent = '';
    this.controls.clear();

    const track = store.getTrack(store.ui.selectedTrackId);
    if (!track) {
      host.appendChild(el('div', 'empty-hint', 'Select a track to edit its sound.'));
      return;
    }
    const def = getInstrumentDef(track.instrument.type);

    const head = el('div', 'panel-head');
    head.appendChild(el('div', 'panel-title', track.name));
    host.appendChild(head);

    // Preset picker.
    const presets = Object.keys(def.presets || {});
    if (presets.length) {
      const presetSel = Select({
        label: 'Preset',
        options: [{ value: '', label: 'Init' }, ...presets.map(p => ({ value: p, label: p }))],
        value: track.instrument.preset ?? '',
        onChange: v => store.applyPreset(track.id, v || null),
      });
      presetSel.root.classList.add('preset-row');
      host.appendChild(presetSel.root);
    }

    // Param groups.
    const groups = new Map();
    for (const p of def.params) {
      if (!groups.has(p.group)) groups.set(p.group, []);
      groups.get(p.group).push(p);
    }

    for (const [groupName, params] of groups) {
      const section = el('div', 'insp-group');
      section.appendChild(el('div', 'insp-group-title', groupName));
      const grid = el('div', 'insp-grid');
      for (const p of params) {
        grid.appendChild(this.buildControl(track, p));
      }
      section.appendChild(grid);
      host.appendChild(section);
    }

    // Channel section.
    const section = el('div', 'insp-group');
    section.appendChild(el('div', 'insp-group-title', 'Channel'));
    const grid = el('div', 'insp-grid');
    const chanKnob = (key, label, min, max, dflt, format = null) => {
      const w = Knob({
        label, min, max, value: track.channel[key], default: dflt, format,
        color: track.color,
        onInput: v => store.setChannel(track.id, key, v),
      });
      this.controls.set('ch:' + key, w);
      grid.appendChild(w.root);
    };
    chanKnob('pan', 'Pan', -1, 1, 0, v => Math.abs(v) < 0.01 ? 'C' : (v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`));
    chanKnob('sendDelay', 'Delay', 0, 1, 0);
    chanKnob('sendReverb', 'Reverb', 0, 1, 0);
    section.appendChild(grid);
    host.appendChild(section);
  }

  buildControl(track, p) {
    const { store } = this;
    const current = track.instrument.params[p.key];

    if (p.type === 'select') {
      const w = Select({
        label: p.label,
        options: p.options,
        value: current,
        onChange: v => store.setTrackParam(track.id, p.key, v),
      });
      this.controls.set(p.key, w);
      const wrap = el('div', 'insp-select');
      wrap.appendChild(w.root);
      return wrap;
    }

    const w = Knob({
      label: p.label,
      min: p.min, max: p.max, step: p.step,
      curve: p.curve, unit: p.unit,
      value: current, default: p.default,
      color: track.color,
      onInput: v => store.setTrackParam(track.id, p.key, v),
    });
    this.controls.set(p.key, w);
    return w.root;
  }
}
