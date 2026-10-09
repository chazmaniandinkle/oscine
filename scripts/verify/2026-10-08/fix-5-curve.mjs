import { session } from './drive.mjs';
const s = await session(7481);
const r = await s.page.evaluate(async () => {
  const { createEffect } = await import('/src/engine/effects/index.js');
  const { measure } = await import('/src/engine/listen.js');
  const sr = 44100, dur = 8, out = {};
  for (const mode of ['static300', 'curve', 'curve-no-setvalue', 'linear-ramp']) {
    const ctx = new OfflineAudioContext(2, sr * dur, sr);
    const b = ctx.createBuffer(1, sr * dur, sr), d = b.getChannelData(0); let x = 1;
    for (let i = 0; i < d.length; i++) { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; d[i] = x / 4294967296 * 2 - 1; }
    const src = ctx.createBufferSource(); src.buffer = b;
    const fx = createEffect('resofilter', ctx, { filterType: 'lowpass', cutoff: 300, resonance: 1 }); fx.applyAll();
    src.connect(fx.input); fx.output.connect(ctx.destination); src.start(0);
    const node = fx.paramNode('cutoff');
    const curve = new Float32Array(400); for (let i = 0; i < 400; i++) curve[i] = 150 * Math.pow(14000 / 150, i / 399);
    let err = null;
    try {
      if (mode === 'curve') { node.cancelScheduledValues(0); node.setValueAtTime(curve[0], 0); node.setValueCurveAtTime(curve, 0, dur); }
      if (mode === 'curve-no-setvalue') { node.cancelScheduledValues(0); node.setValueCurveAtTime(curve, 0, dur); }
      if (mode === 'linear-ramp') { node.cancelScheduledValues(0); node.setValueAtTime(150, 0); node.exponentialRampToValueAtTime(14000, dur); }
    } catch (e) { err = String(e); }
    const buf = await ctx.startRendering();
    const ch = [buf.getChannelData(0)];
    const qs = []; for (let q = 0; q < 8; q++) { const m = measure(ch, sr, { from: q, to: q + 1 }); qs.push(+(m.bands.mid + m.bands.high).toFixed(2)); }
    out[mode] = { qs, err, valueAfter: node.value };
  }
  return out;
});
console.log(JSON.stringify(r, null, 1));
await s.close();
