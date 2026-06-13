// Convolution reverb on a generated impulse response (exponentially
// decaying stereo noise), used as a shared send bus. Regenerating the IR
// is debounced since it allocates a multi-second buffer.

import { debounce } from '../../core/util.js';

export class ReverbFX {
  constructor(ctx, store, bus) {
    this.ctx = ctx;
    this.store = store;

    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.damp = ctx.createBiquadFilter();
    this.damp.type = 'lowpass';
    this.damp.frequency.value = 6500;
    this.convolver = ctx.createConvolver();

    this.input.connect(this.damp);
    this.damp.connect(this.convolver);
    this.convolver.connect(this.output);

    this.lastSize = null;
    this.rebuildSoon = debounce(() => this.rebuildIR(), 250);
    this.apply(true);

    bus.on('fx:changed', ({ key }) => {
      if (key.startsWith('verb')) this.apply();
    });
    bus.on('project:replaced', () => this.apply());
  }

  apply(immediate = false) {
    const fx = this.store.project.fx;
    this.output.gain.setTargetAtTime(fx.verbReturn, this.ctx.currentTime, 0.03);
    if (fx.verbSize !== this.lastSize) {
      immediate ? this.rebuildIR() : this.rebuildSoon();
    }
  }

  rebuildIR() {
    const fx = this.store.project.fx;
    this.lastSize = fx.verbSize;
    const ctx = this.ctx;
    const seconds = fx.verbSize;
    const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.6);
      }
    }
    this.convolver.buffer = buf;
  }
}
