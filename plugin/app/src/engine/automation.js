// Automation: breakpoint envelopes on lane / master parameters, compiled to
// Web Audio AudioParam schedules. Data lives in arrangement.automation:
//
//   { target: 'lane:vocal-r2:gainDb', points: [{t, v}, ...], curve?: 'linear' }
//
// target grammar (extensible; only lane/master gainDb + pan today):
//   lane:<laneId>:gainDb     dB, -60..+12   applied on the lane GainNode
//   lane:<laneId>:pan        -1..1          applied on the lane panner
//   master:gainDb            dB             applied on the master chain input
//
// Points are in SONG seconds, sorted by t. Between points the value is
// linear in the stored unit (dB for gain -- so a fade sounds linear), held
// flat before the first and after the last point. An envelope OVERRIDES the
// lane's static gainDb while it has points (the fader becomes a readout).
//
// Compile: for gain we sample the dB envelope at ~100 Hz over the play span
// and hand the linear-gain curve to setValueCurveAtTime, which is exact and
// cheap. Seeking mid-envelope: value at t0 is set explicitly, then the curve
// runs from t0 -- no cancelAndHold trap because each play() starts fresh.

export const AUTO_TARGETS = {
  gainDb: { min: -60, max: 12, default: 0, unit: 'dB' },
  pan:    { min: -1, max: 1, default: 0, unit: '' },
};

export function parseTarget(t) {
  const m = /^(lane|master):(?:([^:]+):)?(\w+)$/.exec(t);
  if (!m) return null;
  return { kind: m[1], lane: m[2] ?? null, param: m[3] };
}
export function targetOf(kind, lane, param) { return kind === 'master' ? `master:${param}` : `lane:${lane}:${param}`; }

export function findEnvelope(arrangement, target) {
  return arrangement?.automation?.find(a => a.target === target) ?? null;
}
export function ensureEnvelope(arrangement, target) {
  arrangement.automation = arrangement.automation ?? [];
  let e = findEnvelope(arrangement, target);
  if (!e) { e = { target, points: [] }; arrangement.automation.push(e); }
  return e;
}

// Value at time t (song seconds). Flat outside the points.
export function valueAt(env, t) {
  const p = env.points; if (!p?.length) return null;
  if (t <= p[0].t) return p[0].v;
  if (t >= p[p.length - 1].t) return p[p.length - 1].v;
  let lo = 0, hi = p.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (p[m].t <= t) lo = m; else hi = m; }
  const a = p[lo], b = p[hi], f = (t - a.t) / Math.max(1e-9, b.t - a.t);
  return a.v + (b.v - a.v) * f;
}

export function addPoint(env, t, v) {
  const { min, max } = AUTO_TARGETS[parseTarget(env.target)?.param] ?? { min: -1e9, max: 1e9 };
  v = Math.max(min, Math.min(max, v));
  const i = env.points.findIndex(p => p.t >= t);
  const pt = { t: Math.max(0, t), v };
  if (i >= 0 && Math.abs(env.points[i].t - t) < 1e-3) env.points[i] = pt;
  else if (i < 0) env.points.push(pt); else env.points.splice(i, 0, pt);
  return pt;
}
export function movePoint(env, idx, t, v) {
  const { min, max } = AUTO_TARGETS[parseTarget(env.target)?.param] ?? { min: -1e9, max: 1e9 };
  const prev = env.points[idx - 1]?.t ?? 0, next = env.points[idx + 1]?.t ?? Infinity;
  env.points[idx] = { t: Math.max(prev + 1e-3, Math.min(next - 1e-3, Math.max(0, t))), v: Math.max(min, Math.min(max, v)) };
}
export function removePoint(env, idx) { env.points.splice(idx, 1); }

const dbToGain = db => db <= -60 ? 0 : Math.pow(10, db / 20);

// Schedule `env` onto an AudioParam for a play starting at ctx time `at`
// from song second `from`, lasting `span` seconds. `toParam` maps the stored
// unit to the param's unit (dB -> linear gain).
export function scheduleEnvelope(param, env, { at, from, span, sr = 100, toParam = v => v }) {
  if (!env?.points?.length || span <= 0) return;
  const n = Math.max(2, Math.ceil(span * sr));
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) curve[i] = toParam(valueAt(env, from + (i / (n - 1)) * span));
  param.cancelScheduledValues(at);
  param.setValueAtTime(curve[0], at);
  param.setValueCurveAtTime(curve, at, span);
}

// Apply every envelope in the arrangement to a ClipPlayer's nodes for one
// play(). Gain envelopes replace the lane's static gain for the span.
export function scheduleAll(player, { at, from, span }) {
  const arr = player.project.arrangement; if (!arr?.automation?.length) return;
  for (const env of arr.automation) {
    const tg = parseTarget(env.target); if (!tg || !env.points?.length) continue;
    if (tg.kind === 'lane') {
      const s = player.strips[tg.lane]; if (!s) continue;
      if (tg.param === 'gainDb') {
        // Respect mute/solo: if the lane is inaudible the static gain is 0; keep it.
        const lanes = arr.lanes ?? [], lane = lanes.find(l => l.id === tg.lane), anySolo = lanes.some(l => l.solo);
        const audible = lane ? (anySolo ? !!lane.solo : !lane.mute) : true;
        if (!audible) continue;
        scheduleEnvelope(s.gain.gain, env, { at, from, span, toParam: dbToGain });
      } else if (tg.param === 'pan' && s.pan.pan) {
        scheduleEnvelope(s.pan.pan, env, { at, from, span });
      }
    } else if (tg.kind === 'master' && tg.param === 'gainDb') {
      scheduleEnvelope(player.masterChain.input.gain, env, { at, from, span, toParam: dbToGain });
    }
  }
}
