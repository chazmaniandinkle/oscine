// Step grid: drum pattern editor.
//   click          toggle step on/off
//   drag           paint the same value across steps
//   shift+click    cycle velocity (soft / med / hard)
//   lane label     audition the sound

import { el } from './widgets.js';
import { getInstrumentDef } from '../engine/instruments/index.js';

const VEL_LEVELS = [0.45, 0.75, 1];

function velClass(v) {
  if (v <= 0) return '';
  if (v < 0.6) return 'on v1';
  if (v < 0.9) return 'on v2';
  return 'on v3';
}

export class StepGrid {
  constructor(host, app) {
    this.app = app;
    this.store = app.store;
    this.host = host;
    host.classList.add('stepgrid');

    this.trackId = null;
    this.active = false;
    this.cells = [];        // [laneIndex][stepIndex] -> element
    this.lastPlayCol = -1;
    this.paint = null;      // active paint gesture {value}

    const { bus } = app;
    bus.on('steps:changed', ({ trackId }) => {
      if (trackId === this.trackId) this.syncCells();
    });
    bus.on('slot:changed', () => this.render());
    bus.on('slot:resized', () => this.render());
    bus.on('project:replaced', () => this.render());
    bus.on('param:changed', () => { /* kit params don't affect layout */ });

    window.addEventListener('pointerup', () => { this.paint = null; });
  }

  get track() { return this.store.getTrack(this.trackId); }
  get pattern() { return this.trackId ? this.store.getPattern(this.trackId) : null; }

  setTrack(trackId) {
    this.trackId = trackId;
    this.render();
  }

  render() {
    const host = this.host;
    host.textContent = '';
    this.cells = [];
    this.lastPlayCol = -1;
    const track = this.track;
    if (!track) return;

    const def = getInstrumentDef(track.instrument.type);
    const steps = this.store.getSlot().bars * 16;
    const pattern = this.pattern;

    const scroll = el('div', 'sg-scroll');
    const grid = el('div', 'sg-grid');
    grid.style.gridTemplateColumns = `92px repeat(${steps}, var(--step))`;
    grid.style.gridTemplateRows = `20px repeat(${def.lanes.length}, var(--step))`;

    // Header row: beat numbers.
    grid.appendChild(el('div', 'sg-corner'));
    for (let i = 0; i < steps; i++) {
      const head = el('div', 'sg-head', i % 4 === 0 ? String(Math.floor(i / 4) % 4 + 1) : '');
      if (i % 16 === 0) head.classList.add('bar');
      grid.appendChild(head);
    }

    def.lanes.forEach((lane, laneIdx) => {
      const label = el('button', 'sg-label', lane.label);
      label.type = 'button';
      label.title = 'Click to audition';
      label.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.app.engine.previewHit(this.trackId, lane.id);
      });
      grid.appendChild(label);

      this.cells[laneIdx] = [];
      for (let i = 0; i < steps; i++) {
        const cell = el('div', 'step');
        if (Math.floor(i / 4) % 2 === 1) cell.classList.add('offbeat');
        if (i % 16 === 0) cell.classList.add('bar');
        cell.dataset.lane = lane.id;
        cell.dataset.idx = i;
        const v = pattern.steps[lane.id]?.[i] ?? 0;
        this.applyCell(cell, v);

        cell.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          const cur = this.pattern.steps[lane.id][i];
          let next;
          if (e.shiftKey && cur > 0) {
            const idx = VEL_LEVELS.findIndex(l => Math.abs(l - cur) < 0.01);
            next = VEL_LEVELS[(idx + 1) % VEL_LEVELS.length];
          } else {
            next = cur > 0 ? 0 : VEL_LEVELS[2] * 0.8;
          }
          this.store.checkpoint();
          this.paint = { value: next };
          this.store.setStep(this.trackId, lane.id, i, next);
          if (next > 0) this.app.engine.previewHit(this.trackId, lane.id, next);
        });
        cell.addEventListener('pointerenter', () => {
          if (!this.paint) return;
          const cur = this.pattern.steps[lane.id][i];
          if (cur !== this.paint.value) {
            this.store.setStep(this.trackId, lane.id, i, this.paint.value);
          }
        });

        grid.appendChild(cell);
        this.cells[laneIdx][i] = cell;
      }
    });

    scroll.appendChild(grid);
    host.appendChild(scroll);
    this.syncColor();
  }

  syncColor() {
    const track = this.track;
    if (track) this.host.style.setProperty('--track-color', track.color);
  }

  applyCell(cell, v) {
    cell.className = cell.className.replace(/\bon\b|\bv[123]\b/g, '').trim();
    const vc = velClass(v);
    if (vc) cell.className += ' ' + vc;
  }

  syncCells() {
    const track = this.track;
    if (!track) return;
    const def = getInstrumentDef(track.instrument.type);
    const pattern = this.pattern;
    def.lanes.forEach((lane, laneIdx) => {
      const row = this.cells[laneIdx] || [];
      for (let i = 0; i < row.length; i++) {
        this.applyCell(row[i], pattern.steps[lane.id]?.[i] ?? 0);
      }
    });
  }

  onFrame(pos) {
    if (!this.active || !this.cells.length) return;
    const steps = this.cells[0].length;
    const col = pos.playing ? Math.floor((pos.localBeat * 4) % steps) : -1;
    if (col === this.lastPlayCol) return;
    if (this.lastPlayCol >= 0) {
      for (const row of this.cells) row[this.lastPlayCol]?.classList.remove('ph');
    }
    if (col >= 0) {
      for (const row of this.cells) row[col]?.classList.add('ph');
    }
    this.lastPlayCol = col;
  }
}
