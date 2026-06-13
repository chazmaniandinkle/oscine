// Common instrument plumbing. Subclasses implement noteOn/noteOff (melodic)
// or trigger (drums). All envelope automation in this codebase uses
// setTargetAtTime chains: later events supersede earlier ones from their
// start time, so releases never need cancelScheduledValues (which clicks).

export class BaseInstrument {
  constructor(ctx, params, def) {
    this.ctx = ctx;
    this.def = def;
    this.params = { ...params };
    this.output = ctx.createGain();
    this.output.gain.value = this.params.level ?? 0.8;
  }

  setParam(key, value) {
    this.params[key] = value;
    if (key === 'level') {
      this.output.gain.setTargetAtTime(value, this.ctx.currentTime, 0.02);
    }
    this.onParam?.(key, value);
  }

  setParams(obj) {
    for (const [k, v] of Object.entries(obj)) this.setParam(k, v);
  }

  // Melodic interface. durSec === null means "hold until noteOff(midi)".
  noteOn(_time, _midi, _vel, _durSec) {}
  noteOff(_midi) {}

  // Drum interface.
  trigger(_laneId, _time, _vel) {}

  allOff() {}

  dispose() {
    this.allOff();
    try { this.output.disconnect(); } catch { /* already gone */ }
  }
}

// Shared white-noise buffer (2s), cached per context.
const noiseCache = new WeakMap();
export function noiseBuffer(ctx) {
  let buf = noiseCache.get(ctx);
  if (!buf) {
    const len = ctx.sampleRate * 2;
    buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    noiseCache.set(ctx, buf);
  }
  return buf;
}
