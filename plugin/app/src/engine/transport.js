// Transport: the musical clock. Standard Web Audio lookahead scheduler --
// a coarse JS timer wakes up every 25ms and schedules everything that
// falls inside the next 120ms window at sample-accurate AudioContext time.
//
// Position is measured in beats (quarter notes). The transport walks an
// absolute beat cursor and emits 'schedule:window' events segmented at
// loop boundaries, so a window never spans two loop passes. Queued
// pattern-slot switches are applied exactly at the boundary, which is
// what makes slot changes land on the "1".
//
// DAW upgrade path: swap the setInterval for a Worker-based timer to keep
// scheduling steady in background tabs; add song-position (bar offset)
// instead of always starting at 0.

export class Transport {
  constructor(ctx, store, bus) {
    this.ctx = ctx;
    this.store = store;
    this.bus = bus;

    this.lookahead = 0.12;     // seconds scheduled ahead
    this.intervalMs = 25;      // JS timer period

    this.playing = false;
    this.timer = null;

    // Linear beat<->time mapping, rebased on bpm change.
    this.anchorTime = 0;       // ctx time of anchorBeat
    this.anchorBeat = 0;
    this.bpm = store.project.bpm;

    this.absCursor = 0;        // next unscheduled absolute beat
    this.loopStartAbs = 0;     // absolute beat where current loop pass began

    bus.on('settings:changed', ({ key }) => {
      if (key === 'bpm') this.setBpm(store.project.bpm);
    });
    bus.on('project:replaced', () => {
      // Undo/redo/load swap the whole project. Keep the transport rolling
      // (a DAW shouldn't stop on undo) and adopt the new tempo continuously;
      // the engine rebuilds its channels off the same event.
      this.setBpm(store.project.bpm);
    });
  }

  // -- beat/time math ----------------------------------------------------

  get secPerBeat() { return 60 / this.bpm; }

  beatToTime(beat) {
    return this.anchorTime + (beat - this.anchorBeat) * this.secPerBeat;
  }

  timeToBeat(time) {
    return this.anchorBeat + (time - this.anchorTime) / this.secPerBeat;
  }

  setBpm(bpm) {
    if (this.playing) {
      // Rebase the mapping at "now" so position is continuous.
      const now = this.ctx.currentTime;
      this.anchorBeat = this.timeToBeat(now);
      this.anchorTime = now;
    }
    this.bpm = bpm;
  }

  get loopBeats() {
    return this.store.getSlot().bars * 4;
  }

  // Swing: delays grid positions that land on odd 16ths. Amount 0..1 maps
  // to 0..55% of a 16th. Applied per-event by the engine.
  swingOffset(localBeat) {
    const swing = this.store.project.swing;
    if (swing <= 0.001) return 0;
    const pos16 = localBeat * 4;
    const idx = Math.round(pos16);
    if (Math.abs(pos16 - idx) > 0.02 || idx % 2 === 0) return 0;
    return swing * 0.55 * (this.secPerBeat / 4);
  }

  // -- run loop ------------------------------------------------------------

  play() {
    if (this.playing) return;
    this.playing = true;
    const startAt = this.ctx.currentTime + 0.06;
    this.anchorTime = startAt;
    this.anchorBeat = 0;
    this.absCursor = 0;
    this.loopStartAbs = 0;
    this.bpm = this.store.project.bpm;
    this.bus.emit('transport:state', { playing: true });
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.tick();
  }

  stop() {
    if (!this.playing) return;
    this.playing = false;
    clearInterval(this.timer);
    this.timer = null;
    this.store.clearQueuedSlot();
    this.bus.emit('transport:state', { playing: false });
  }

  toggle() {
    this.playing ? this.stop() : this.play();
  }

  tick() {
    const targetBeat = this.timeToBeat(this.ctx.currentTime + this.lookahead);
    let guard = 0;
    while (this.absCursor < targetBeat && guard++ < 64) {
      const boundary = this.loopStartAbs + this.loopBeats;
      const segEnd = Math.min(targetBeat, boundary);

      if (segEnd > this.absCursor + 1e-9) {
        this.bus.emit('schedule:window', {
          fromLocal: this.absCursor - this.loopStartAbs,
          toLocal: segEnd - this.loopStartAbs,
          loopStartAbs: this.loopStartAbs,
          slotIndex: this.store.ui.activeSlot,
          beatToTime: (b) => this.beatToTime(b),
          swingOffset: (lb) => this.swingOffset(lb),
        });
        this.scheduleMetronome(this.absCursor, segEnd);
        this.absCursor = segEnd;
      }

      if (this.absCursor >= boundary - 1e-9) {
        // Crossing the loop boundary: apply any queued slot switch first so
        // the next segment schedules from the new pattern (and length).
        this.store.applyQueuedSlot();
        this.loopStartAbs = boundary;
        this.bus.emit('transport:loop', {});
      }
    }
  }

  scheduleMetronome(fromAbs, toAbs) {
    if (!this.store.ui.metronome) return;
    for (let b = Math.ceil(fromAbs - 1e-9); b < toAbs - 1e-9; b++) {
      const local = b - this.loopStartAbs;
      const accent = Math.abs(local % 4) < 1e-9;
      this.click(this.beatToTime(b), accent);
    }
  }

  click(time, accent) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.frequency.value = accent ? 1568 : 1046;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, time);
    g.gain.setTargetAtTime(accent ? 0.22 : 0.13, time, 0.001);
    g.gain.setTargetAtTime(0, time + 0.003, 0.012);
    osc.connect(g).connect(ctx.destination);
    osc.start(time);
    osc.stop(time + 0.12);
  }

  // For UI painting (playhead, position readout).
  getPosition() {
    if (!this.playing) return { playing: false, localBeat: 0, loopBeats: this.loopBeats };
    const abs = this.timeToBeat(this.ctx.currentTime);
    return {
      playing: true,
      localBeat: Math.max(0, abs - this.loopStartAbs),
      loopBeats: this.loopBeats,
      absBeat: abs,
    };
  }
}
