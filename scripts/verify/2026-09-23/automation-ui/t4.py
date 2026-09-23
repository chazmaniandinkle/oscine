import sys, json, time; sys.path.insert(0, '/tmp/wt-autoui')
from cdp import *
c = C(); open_app(c)
# Two offline renders of a clone of the project: bed-r2 soloed with an eq3
# insert, (a) no automation, (b) lowGain hold envelope -18 dB over 10..30 s
# and +18 dB over 30..50 s. Compare <150 Hz band RMS per window, b minus a.
r = c.js(r'''(async () => {
  const { renderProjectToBuffer } = await import('/src/engine/render.js');
  const base = JSON.parse(JSON.stringify(window.oscine.store.project));
  base.baseUrl = window.oscine.store.project.baseUrl;
  const a = base.arrangement, id = a.lanes[0].id;
  a.lanes.forEach((l, i) => { l.solo = i === 0; l.mute = false; });
  a.lanes[0].inserts = [{ type: 'eq3', params: {}, bypass: false }];
  a.automation = [];
  // keep only placements that start before 55 s, to bound render time
  a.placements = a.placements.filter(p => p.track === id && p.at < 55);
  const withEnv = JSON.parse(JSON.stringify(base)); withEnv.baseUrl = base.baseUrl;
  withEnv.arrangement.automation = [{ target: `lane:${id}:insert:0:lowGain`, points: [
    { t: 10, v: -18, shape: 'hold' }, { t: 30, v: 18, shape: 'hold' }, { t: 50, v: 0, shape: 'linear' }] }];
  const band = (buf, t0, t1, lp) => {
    const x = buf.getChannelData(0), sr = buf.sampleRate;
    // RBJ biquad, lowpass (lp=true) at 150 Hz or highpass at 2 kHz
    const f0 = lp ? 150 : 2000, w = 2 * Math.PI * f0 / sr, al = Math.sin(w) / (2 * Math.SQRT1_2), cw = Math.cos(w);
    const b0 = lp ? (1 - cw) / 2 : (1 + cw) / 2, b1 = lp ? 1 - cw : -(1 + cw), b2 = b0, a0 = 1 + al, a1 = -2 * cw, a2 = 1 - al;
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0, s = 0, n = 0;
    const i0 = Math.floor((t0 - 1) * sr), i1 = Math.floor(t1 * sr), m0 = Math.floor(t0 * sr);
    for (let i = Math.max(0, i0); i < Math.min(x.length, i1); i++) {
      const y = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
      x2 = x1; x1 = x[i]; y2 = y1; y1 = y;
      if (i >= m0) { s += y * y; n++; }
    }
    return 10 * Math.log10(s / Math.max(1, n) + 1e-20);
  };
  const t0 = performance.now();
  const A = (await renderProjectToBuffer(base, { loops: 0 })).buffer, B = (await renderProjectToBuffer(withEnv, { loops: 0 })).buffer;
  const wins = [[2, 9], [12, 28], [32, 48]];
  return { ms: Math.round(performance.now() - t0), dur: A.duration, rows: wins.map(([u, v]) => ({ win: `${u}-${v}s`,
    lowDiff: +(band(B, u, v, true) - band(A, u, v, true)).toFixed(2), highDiff: +(band(B, u, v, false) - band(A, u, v, false)).toFixed(2),
    lowA: +band(A, u, v, true).toFixed(1) })) };
})()''')
print(json.dumps(r, indent=1))
