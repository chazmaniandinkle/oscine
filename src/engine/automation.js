// Automation: breakpoint envelopes on lane / master / clip / insert
// parameters, compiled to Web Audio AudioParam schedules. Data lives in
// arrangement.automation:
//
//   { target: 'lane:vocal-r2:gainDb', points: [{t, v}, ...], curve?: 'linear' }
//
// target grammar:
//   lane:<laneId>:gainDb              dB, -60..+12   lane GainNode
//   lane:<laneId>:pan                 -1..1          lane panner
//   master:gainDb                     dB             master chain input
//   lane:<laneId>:insert:<n>:<param>  effect-defined  nth insert's param n
//   clip:<clipId>:gainDb              dB              per-source gain of a clip
//
// Points are in SONG seconds for lane/master/insert targets, and CLIP-LOCAL
// seconds for clip targets (see scheduleClipEnvelopes). Between points the
// value follows the segment's start-point shape (see valueAt); flat before
// the first and after the last point. A gain envelope OVERRIDES the lane's
// static gainDb while it has points (the fader becomes a readout).
//
// Compile: for gain we sample the dB envelope at ~100 Hz over the play span
// and hand the linear-gain curve to setValueCurveAtTime, which is exact and
// cheap. Seeking mid-envelope: value at t0 is set explicitly, then the curve
// runs from t0 -- no cancelAndHold trap because each play() starts fresh.

import { getEffectDef } from './effects/index.js';

export const AUTO_TARGETS = {
  gainDb: { min: -60, max: 12, default: 0, unit: 'dB' },
  pan:    { min: -1, max: 1, default: 0, unit: '' },
};

// Parse a target string into its structured form. Returns null on no match.
//   lane:<id>:gainDb | lane:<id>:pan | master:gainDb
//   lane:<id>:insert:<n>:<param>      n is an integer insert index
//   clip:<id>:gainDb
export function parseTarget(t) {
  let m = /^lane:([^:]+):insert:(\d+):(\w+)$/.exec(t);
  if (m) return { kind: 'lane', lane: m[1], clip: null, insert: Number(m[2]), param: m[3] };
  m = /^(lane|master|clip):(?:([^:]+):)?(\w+)$/.exec(t);
  if (!m) return null;
  const kind = m[1];
  return {
    kind,
    lane: kind === 'lane' ? (m[2] ?? null) : null,
    clip: kind === 'clip' ? (m[2] ?? null) : null,
    insert: null,
    param: m[3],
  };
}
// Build a target string from its structured form. `id` is the lane id for
// kind 'lane' (or null for 'master'), the clip id for kind 'clip'. `insert`
// (int) makes an insert-param target: lane:<id>:insert:<insert>:<param>.
export function targetOf(kind, id, param, insert = null) {
  if (kind === 'master') return `master:${param}`;
  if (kind === 'clip') return `clip:${id}:${param}`;
  if (insert != null) return `lane:${id}:insert:${insert}:${param}`;
  return `lane:${id}:${param}`;
}

// Resolve a target's {min, max, default} for clamping/UI. `project` is
// optional: lane/master/clip gainDb+pan resolve from AUTO_TARGETS without
// it; insert-param targets need it to look up the live effect definition.
// Returns null when the range can't be determined (unknown insert/param).
export function rangeOf(target, project) {
  const tg = typeof target === 'string' ? parseTarget(target) : target;
  if (!tg) return null;
  if (tg.insert == null) return AUTO_TARGETS[tg.param] ?? null;
  const lane = project?.arrangement?.lanes?.find(l => l.id === tg.lane);
  const insertSpec = lane?.inserts?.[tg.insert];
  if (!insertSpec) return null;
  let def;
  try { def = getEffectDef(insertSpec.type); } catch { return null; }
  const p = def.params.find(p => p.key === tg.param);
  if (!p) return null;
  return { min: p.min, max: p.max, default: p.default };
}

export function findEnvelope(arrangement, target) {
  return arrangement?.automation?.find(a => a.target === target) ?? null;
}
export function ensureEnvelope(arrangement, target) {
  arrangement.automation = arrangement.automation ?? [];
  let e = findEnvelope(arrangement, target);
  if (!e) { e = { target, points: [] }; arrangement.automation.push(e); }
  return e;
}

// Value at time t (song seconds). Flat outside the points. Each segment's
// interpolation is governed by the shape of its START point:
//   'linear' (default) -- straight line in the stored unit
//   'hold'              -- stays at a.v until b.t (step change)
//   'exp'                -- geometric interpolation (equal ratio per unit
//                           time); falls back to linear if either endpoint
//                           is <= 0, since a geometric mean through/at zero
//                           is undefined
export function valueAt(env, t) {
  const p = env.points; if (!p?.length) return null;
  if (t <= p[0].t) return p[0].v;
  if (t >= p[p.length - 1].t) return p[p.length - 1].v;
  let lo = 0, hi = p.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (p[m].t <= t) lo = m; else hi = m; }
  const a = p[lo], b = p[hi], f = (t - a.t) / Math.max(1e-9, b.t - a.t);
  const shape = a.shape ?? 'linear';
  if (shape === 'hold') return a.v;
  if (shape === 'exp' && a.v > 0 && b.v > 0) return a.v * Math.pow(b.v / a.v, f);
  return a.v + (b.v - a.v) * f;
}

// True when `target`'s value range maps to (or crosses) zero in the actual
// param domain -- the case where an 'exp' shape must be rejected, because
// Web Audio's exponentialRampToValueAtTime treats a ramp to/through 0 as a
// no-op per spec (it throws or silently fails depending on engine; either
// way it is not the smooth fade the shape implies). gainDb's range bottoms
// out at -60 dB, which dbToGain() maps to ~0 linear gain -- effectively
// zero. pan's range straddles 0 by construction. Anything else (unknown
// units, insert params) is assumed safe unless min <= 0 <= max.
function rangeCrossesZero(range) {
  if (!range) return false;
  if (range.min <= 0 && range.max >= 0) return true; // literal zero in range (pan, etc.)
  if (range.unit === 'dB' && range.min <= -60) return true; // maps to ~0 linear gain
  return false;
}

// `project` optional, as with addPoint/movePoint -- see there.
export function addPoint(env, t, v, project, shape = 'linear') {
  const range = rangeOf(env.target, project) ?? { min: -1e9, max: 1e9 };
  v = Math.max(range.min, Math.min(range.max, v));
  let shapeCoerced = false;
  if (shape === 'exp' && rangeCrossesZero(range)) { shape = 'linear'; shapeCoerced = true; }
  const i = env.points.findIndex(p => p.t >= t);
  const pt = { t: Math.max(0, t), v, shape };
  if (shapeCoerced) pt.shapeCoerced = true;
  if (i >= 0 && Math.abs(env.points[i].t - t) < 1e-3) env.points[i] = pt;
  else if (i < 0) env.points.push(pt); else env.points.splice(i, 0, pt);
  return pt;
}
export function movePoint(env, idx, t, v, project, shape) {
  const range = rangeOf(env.target, project) ?? { min: -1e9, max: 1e9 };
  const prev = env.points[idx - 1]?.t ?? 0, next = env.points[idx + 1]?.t ?? Infinity;
  const existing = env.points[idx];
  let nextShape = shape ?? existing?.shape ?? 'linear';
  let shapeCoerced = false;
  if (nextShape === 'exp' && rangeCrossesZero(range)) { nextShape = 'linear'; shapeCoerced = true; }
  const pt = { t: Math.max(prev + 1e-3, Math.min(next - 1e-3, Math.max(0, t))), v: Math.max(range.min, Math.min(range.max, v)), shape: nextShape };
  if (shapeCoerced) pt.shapeCoerced = true;
  env.points[idx] = pt;
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
    if (tg.kind === 'lane' && tg.insert == null) {
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
    } else if (tg.kind === 'lane' && tg.insert != null) {
      scheduleInsertEnvelope(player, tg, env, { at, from, span });
    }
    // tg.kind === 'clip' targets are scheduled per-placement by
    // scheduleClipEnvelopes (called from ClipPlayer.start(), src/engine/clips.js),
    // not here -- each placement needs its own clip-local -> song-time offset.
  }
}

// Schedule the envelopes for one clip placement's per-source gain node.
// `clip` is the clip definition (clip.id used to find its envelope);
// `gain` is the placement's per-source GainNode from ClipPlayer.start().
// Envelope points are stored in CLIP-LOCAL seconds; song time = p.at + t.
// `from`/`at` mirror scheduleAll: `from` is the song-second the play began
// at, `at` is the matching ctx time, so a play starting mid-clip lines up.
export function scheduleClipEnvelopes(player, placement, clip, gain, { at, from }) {
  const arr = player.project.arrangement;
  const env = findEnvelope(arr, targetOf('clip', clip.id, 'gainDb'));
  if (!env?.points?.length) return;
  // Convert clip-local points to a temporary song-time envelope so the
  // existing sample-and-curve path in scheduleEnvelope can be reused as-is.
  const songEnv = { target: env.target, points: env.points.map(p => ({ ...p, t: placement.at + p.t })) };
  const clipSongStart = placement.at;
  const clipSongEnd = placement.at + ClipPlayer_placedDuration(clip);
  const spanStart = Math.max(from, clipSongStart);
  const span = clipSongEnd - spanStart;
  if (span <= 0) return;
  const scheduleAt = at + Math.max(0, spanStart - from);
  // The envelope is RELATIVE to the clip's own gainDb (they stack, as in
  // every major DAW), so a clip at -1 dB with a -20 dB envelope plays at -21.
  const base = clip.gainDb ?? 0;
  scheduleEnvelope(gain.gain, songEnv, { at: scheduleAt, from: spanStart, span, toParam: v => dbToGain(v + base) });
}
// Local mirror of ClipPlayer.placedDuration to avoid an import cycle
// (clips.js imports this module); duplicated math is one line.
function ClipPlayer_placedDuration(clip) {
  return (clip.out - clip.in) * (clip.stretch ?? 1) / (clip.rate ?? 1);
}

// Schedule (or timer-poll) an insert-param envelope. Fast path: if the live
// effect instance exposes a real AudioParam for this key (BaseEffect.paramNode,
// implemented per-effect -- e.g. eq3's filter freq/gain/Q), schedule onto it
// directly via scheduleEnvelope, sample-accurate and free-running. Fallback:
// no native param (custom DSP, k-rate control read in the process callback) --
// poll at ~30 Hz with setTimeout, writing through applyParam(), until stop().
const AUTO_POLL_HZ = 30;
function scheduleInsertEnvelope(player, tg, env, { at, from, span }) {
  const strip = player.strips[tg.lane]; if (!strip) return;
  const fx = strip.chain.effects[tg.insert]; if (!fx) return;
  const node = fx.paramNode?.(tg.param);
  if (node) {
    scheduleEnvelope(node, env, { at, from, span });
    return;
  }
  // Timer fallback. `player._autoTimers` is cleared by ClipPlayer.stop().
  player._autoTimers = player._autoTimers ?? [];
  const ctx = player.ctx;
  const stepMs = 1000 / AUTO_POLL_HZ;
  const startedAt = Date.now();
  const ctxAtStart = ctx.currentTime;
  const tick = () => {
    // songNow: ctx time has advanced by (Date.now() - startedAt)/1000 since
    // scheduling began (`at` may be in the future for a scheduled play).
    const elapsedCtx = ctxAtStart + (Date.now() - startedAt) / 1000;
    const songNow = from + (elapsedCtx - at);
    if (songNow >= from && songNow <= from + span) {
      const v = valueAt(env, songNow);
      if (v != null) fx.applyParam(tg.param, v);
    }
    const timer = setTimeout(tick, stepMs);
    player._autoTimers.push(timer);
  };
  const timer = setTimeout(tick, stepMs);
  player._autoTimers.push(timer);
}
