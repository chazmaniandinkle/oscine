// Bottom panel: one strip per track (fader, meter, pan, sends, mute/solo)
// plus a master section with the shared FX controls. Collapsible.

import { el, Knob, Fader, Meter, Select } from './widgets.js';
import { DELAY_DIVISIONS } from '../engine/effects/delay.js';

export class Mixer {
  constructor(host, app) {
    this.app = app;
    this.store = app.store;
    this.host = host;
    host.classList.add('mixer');

    this.handle = el('button', 'mixer-handle');
    this.handle.type = 'button';
    this.handle.addEventListener('click', () => {
      this.store.ui.mixerOpen = !this.store.ui.mixerOpen;
      this.paintOpen();
    });
    this.body = el('div', 'mixer-body');
    host.appendChild(this.handle);
    host.appendChild(this.body);

    this.meters = new Map();   // trackId -> Meter
    this.faders = new Map();
    this.widgets = new Map();  // `${trackId}:${key}` -> widget

    const { bus } = app;
    for (const type of ['track:added', 'track:removed', 'track:changed', 'project:replaced', 'ui:selection']) {
      bus.on(type, () => this.render());
    }
    bus.on('channel:changed', ({ trackId, key }) => {
      const t = this.store.getTrack(trackId);
      if (!t) return;
      if (key === 'gain') this.faders.get(trackId)?.set(t.channel.gain);
      this.widgets.get(`${trackId}:${key}`)?.set(t.channel[key]);
      if (key === 'mute' || key === 'solo') this.paintMuteSolo(trackId);
    });
    bus.on('fx:changed', ({ key, value }) => this.widgets.get('fx:' + key)?.set(value));
    bus.on('settings:changed', ({ key }) => {
      if (key === 'masterVolume') this.widgets.get('masterVolume')?.set(this.store.project.masterVolume);
    });

    this.paintOpen();
    this.render();
  }

  paintOpen() {
    const open = this.store.ui.mixerOpen;
    this.host.classList.toggle('open', open);
    this.handle.textContent = open ? 'Mixer ▾' : 'Mixer ▴';
  }

  paintMuteSolo(trackId) {
    const t = this.store.getTrack(trackId);
    const strip = this.body.querySelector(`[data-strip="${trackId}"]`);
    if (!t || !strip) return;
    strip.querySelector('.ms-m').classList.toggle('on-warn', t.channel.mute);
    strip.querySelector('.ms-s').classList.toggle('on-accent', t.channel.solo);
  }

  render() {
    const { store } = this;
    this.body.textContent = '';
    this.meters.clear();
    this.faders.clear();
    this.widgets.clear();

    for (const track of store.project.tracks) {
      this.body.appendChild(this.buildStrip(track));
    }
    this.body.appendChild(this.buildMaster());
  }

  buildStrip(track) {
    const { store } = this;
    const strip = el('div', 'strip');
    strip.dataset.strip = track.id;
    strip.classList.toggle('selected', track.id === store.ui.selectedTrackId);

    const name = el('div', 'strip-name', track.name);
    name.style.color = track.color;
    name.title = track.name;
    name.addEventListener('click', () => store.selectTrack(track.id));
    strip.appendChild(name);

    const knobRow = el('div', 'strip-knobs');
    const mkKnob = (key, label) => {
      const w = Knob({
        label, min: key === 'pan' ? -1 : 0, max: 1,
        value: track.channel[key], default: key === 'pan' ? 0 : 0,
        small: true, color: track.color,
        format: key === 'pan'
          ? v => Math.abs(v) < 0.01 ? 'C' : (v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`)
          : undefined,
        onInput: v => store.setChannel(track.id, key, v),
      });
      this.widgets.set(`${track.id}:${key}`, w);
      knobRow.appendChild(w.root);
    };
    mkKnob('pan', 'Pan');
    mkKnob('sendDelay', 'Dly');
    mkKnob('sendReverb', 'Rev');
    strip.appendChild(knobRow);

    const fadeWrap = el('div', 'strip-fade');
    const fader = Fader({
      value: track.channel.gain, default: 0.8,
      onInput: v => store.setChannel(track.id, 'gain', v),
    });
    this.faders.set(track.id, fader);
    const meter = Meter();
    this.meters.set(track.id, meter);
    fadeWrap.appendChild(fader.root);
    fadeWrap.appendChild(meter.root);
    strip.appendChild(fadeWrap);

    const ms = el('div', 'strip-ms');
    const m = el('button', 'btn mini ms-m' + (track.channel.mute ? ' on-warn' : ''), 'M');
    m.addEventListener('click', () => store.setChannel(track.id, 'mute', !track.channel.mute));
    const s = el('button', 'btn mini ms-s' + (track.channel.solo ? ' on-accent' : ''), 'S');
    s.addEventListener('click', () => store.setChannel(track.id, 'solo', !track.channel.solo));
    ms.appendChild(m);
    ms.appendChild(s);
    strip.appendChild(ms);

    return strip;
  }

  buildMaster() {
    const { store } = this;
    const strip = el('div', 'strip master-strip');
    strip.appendChild(el('div', 'strip-name', 'Master'));

    const fxRow = el('div', 'master-fx');

    const dlyCol = el('div', 'fx-col');
    dlyCol.appendChild(el('div', 'insp-group-title', 'Delay'));
    const divSel = Select({
      options: DELAY_DIVISIONS,
      value: store.project.fx.delayDiv,
      onChange: v => store.setFx('delayDiv', Number(v)),
    });
    this.widgets.set('fx:delayDiv', divSel);
    dlyCol.appendChild(divSel.root);
    const fb = Knob({
      label: 'Fdbk', min: 0, max: 0.9, value: store.project.fx.delayFeedback, default: 0.38, small: true,
      onInput: v => store.setFx('delayFeedback', v),
    });
    this.widgets.set('fx:delayFeedback', fb);
    const dret = Knob({
      label: 'Return', min: 0, max: 1, value: store.project.fx.delayReturn, default: 0.7, small: true,
      onInput: v => store.setFx('delayReturn', v),
    });
    this.widgets.set('fx:delayReturn', dret);
    const dlyKnobs = el('div', 'strip-knobs');
    dlyKnobs.appendChild(fb.root);
    dlyKnobs.appendChild(dret.root);
    dlyCol.appendChild(dlyKnobs);
    fxRow.appendChild(dlyCol);

    const verbCol = el('div', 'fx-col');
    verbCol.appendChild(el('div', 'insp-group-title', 'Reverb'));
    const size = Knob({
      label: 'Size', min: 0.4, max: 6, value: store.project.fx.verbSize, default: 2.2, small: true, unit: 's',
      onInput: v => store.setFx('verbSize', v),
    });
    this.widgets.set('fx:verbSize', size);
    const vret = Knob({
      label: 'Return', min: 0, max: 1, value: store.project.fx.verbReturn, default: 0.8, small: true,
      onInput: v => store.setFx('verbReturn', v),
    });
    this.widgets.set('fx:verbReturn', vret);
    const verbKnobs = el('div', 'strip-knobs');
    verbKnobs.appendChild(size.root);
    verbKnobs.appendChild(vret.root);
    verbCol.appendChild(verbKnobs);
    fxRow.appendChild(verbCol);

    strip.appendChild(fxRow);

    const fadeWrap = el('div', 'strip-fade');
    const fader = Fader({
      value: store.project.masterVolume / 1.2, default: 0.85 / 1.2,
      onInput: v => store.setSetting('masterVolume', v * 1.2),
    });
    this.widgets.set('masterVolume', { set: v => fader.set(v / 1.2) });
    const meter = Meter();
    this.meters.set('master', meter);
    fadeWrap.appendChild(fader.root);
    fadeWrap.appendChild(meter.root);
    strip.appendChild(fadeWrap);

    return strip;
  }

  onFrame() {
    if (!this.store.ui.mixerOpen) return;
    const { engine } = this.app;
    for (const [id, meter] of this.meters) {
      meter.set(engine.getLevel(id));
    }
  }
}
