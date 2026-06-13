// Left panel: track rows + Add Track menu (populated from the instrument
// registry, so new instrument modules appear automatically).

import { el, Btn, openMenu } from './widgets.js';
import { listInstrumentDefs, getInstrumentDef } from '../engine/instruments/index.js';

export class TrackList {
  constructor(host, app) {
    this.app = app;
    this.store = app.store;
    host.classList.add('tracklist');

    const head = el('div', 'panel-head');
    head.appendChild(el('div', 'panel-title', 'Tracks'));
    const addBtn = Btn('+ Add', () => {
      openMenu(addBtn, listInstrumentDefs().map(def => ({
        label: def.label,
        onPick: () => this.app.store.addTrack(def.type),
      })));
    }, 'accent');
    head.appendChild(addBtn);
    host.appendChild(head);

    this.listEl = el('div', 'track-rows');
    host.appendChild(this.listEl);

    const { bus } = app;
    for (const type of ['track:added', 'track:removed', 'track:changed', 'ui:selection', 'project:replaced', 'channel:changed']) {
      bus.on(type, () => this.render());
    }
    bus.on('track:trigger', ({ trackId }) => this.blip(trackId));

    this.render();
  }

  blip(trackId) {
    const led = this.listEl.querySelector(`[data-track="${trackId}"] .led`);
    if (!led) return;
    led.classList.remove('hit');
    void led.offsetWidth; // restart animation
    led.classList.add('hit');
  }

  render() {
    const { store } = this;
    this.listEl.textContent = '';

    if (store.project.tracks.length === 0) {
      const empty = el('div', 'empty-hint', 'No tracks yet. Hit “+ Add” to create one.');
      this.listEl.appendChild(empty);
      return;
    }

    for (const track of store.project.tracks) {
      const def = getInstrumentDef(track.instrument.type);
      const row = el('div', 'track-row');
      row.dataset.track = track.id;
      row.classList.toggle('selected', track.id === store.ui.selectedTrackId);

      const led = el('div', 'led');
      led.style.background = track.color;
      row.appendChild(led);

      const mid = el('div', 'track-mid');
      const nameEl = el('div', 'track-name', track.name);
      nameEl.title = 'Double-click to rename';
      nameEl.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        this.editName(nameEl, track);
      });
      mid.appendChild(nameEl);
      mid.appendChild(el('div', 'track-sub', def.label + (track.instrument.preset ? ` · ${track.instrument.preset}` : '')));
      row.appendChild(mid);

      const controls = el('div', 'track-ctl');
      const muteB = el('button', 'btn mini' + (track.channel.mute ? ' on-warn' : ''), 'M');
      muteB.title = 'Mute';
      muteB.addEventListener('click', (e) => {
        e.stopPropagation();
        store.setChannel(track.id, 'mute', !track.channel.mute);
      });
      const soloB = el('button', 'btn mini' + (track.channel.solo ? ' on-accent' : ''), 'S');
      soloB.title = 'Solo';
      soloB.addEventListener('click', (e) => {
        e.stopPropagation();
        store.setChannel(track.id, 'solo', !track.channel.solo);
      });
      const delB = el('button', 'btn mini del', '✕');
      delB.title = 'Delete track';
      delB.addEventListener('click', (e) => {
        e.stopPropagation();
        if (delB.classList.contains('confirm')) {
          store.removeTrack(track.id);
        } else {
          delB.classList.add('confirm');
          delB.textContent = '?';
          setTimeout(() => { delB.classList.remove('confirm'); delB.textContent = '✕'; }, 1600);
        }
      });
      controls.appendChild(muteB);
      controls.appendChild(soloB);
      controls.appendChild(delB);
      row.appendChild(controls);

      row.addEventListener('click', () => store.selectTrack(track.id));
      this.listEl.appendChild(row);
    }
  }

  editName(nameEl, track) {
    const input = el('input', 'name-edit');
    input.value = track.name;
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    const commit = () => {
      this.store.renameTrack(track.id, input.value);
      this.render();
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') input.blur();
      if (e.key === 'Escape') { input.value = track.name; input.blur(); }
    });
  }
}
