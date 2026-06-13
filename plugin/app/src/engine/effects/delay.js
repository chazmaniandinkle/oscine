// Tempo-synced feedback delay, used as a shared send bus.
// input -> delay -> output, with delay -> damp -> feedback -> delay.

export const DELAY_DIVISIONS = [
  { value: 0.25, label: '1/16' },
  { value: 0.5, label: '1/8' },
  { value: 0.75, label: '1/8.' },
  { value: 1, label: '1/4' },
  { value: 1.5, label: '1/4.' },
  { value: 2, label: '1/2' },
];

export class DelayFX {
  constructor(ctx, store, bus) {
    this.ctx = ctx;
    this.store = store;

    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.delay = ctx.createDelay(4);
    this.feedback = ctx.createGain();
    this.damp = ctx.createBiquadFilter();
    this.damp.type = 'lowpass';
    this.damp.frequency.value = 3800;

    this.input.connect(this.delay);
    this.delay.connect(this.output);
    this.delay.connect(this.damp);
    this.damp.connect(this.feedback);
    this.feedback.connect(this.delay);

    this.apply();
    bus.on('fx:changed', ({ key }) => {
      if (key.startsWith('delay')) this.apply();
    });
    bus.on('settings:changed', ({ key }) => {
      if (key === 'bpm') this.apply();
    });
    bus.on('project:replaced', () => this.apply());
  }

  apply() {
    const fx = this.store.project.fx;
    const t = this.ctx.currentTime;
    const beats = fx.delayDiv;
    const sec = Math.min(beats * 60 / this.store.project.bpm, 3.9);
    this.delay.delayTime.setTargetAtTime(sec, t, 0.03);
    this.feedback.gain.setTargetAtTime(Math.min(fx.delayFeedback, 0.92), t, 0.03);
    this.output.gain.setTargetAtTime(fx.delayReturn, t, 0.03);
  }
}
