// Pattern-side mix model, shared by the live engine and the offline renderer
// so the two graphs can't drift (2026-10-08 fitting pass).
//
// Data (all optional; absent = the June behaviour, bit-for-bit):
//   track.channel.inserts   [{type, params, bypass}]  effect chain per pattern track,
//                           post-instrument, pre-fader (like a DAW channel strip)
//   project.patternMaster   { inserts: [...] }        chain after the glue compressor,
//                           before the master volume (EQ / limiter on the mix bus)
//   slot.automation         [{ target, points:[{beat, v, shape?}] }]
//                           envelopes in SLOT-LOCAL BEATS: they repeat every time
//                           the slot plays, the way a pattern does. Targets:
//                             track:<trackId>:gain            0..1.5 (multiplies the fader)
//                             track:<trackId>:pan             -1..1
//                             track:<trackId>:insert:<n>:<param>
//                             master:insert:<n>:<param>
//                             track:<trackId>:param:<key>     instrument param (k-rate: sampled
//                                                             every 1/16 note via setParam)
//
// Engine-agnostic: takes a ctx and returns nodes. Effects come from the same
// registry/InsertChain the arrangement lanes use.

import { InsertChain, getEffectDef } from './effects/registry.js';
import { valueAt } from './automation.js';

export function buildPatternStrip(ctx, track) {
  const chain = new InsertChain(ctx);
  chain.sync(track.channel?.inserts ?? []);
  const autoGain = ctx.createGain(); // automation lane: multiplies the fader, 1 when idle
  chain.output.connect(autoGain);
  return { chain, autoGain, input: chain.input, output: autoGain };
}

export function buildPatternMaster(ctx, project) {
  const chain = new InsertChain(ctx);
  chain.sync(project.patternMaster?.inserts ?? []);
  return chain;
}

export function parsePatternTarget(t) {
  let m = /^track:([^:]+):insert:(\d+):(\w+)$/.exec(t);
  if (m) return { scope: 'track', id: m[1], insert: Number(m[2]), param: m[3] };
  m = /^master:insert:(\d+):(\w+)$/.exec(t);
  if (m) return { scope: 'master', id: null, insert: Number(m[1]), param: m[2] };
  m = /^track:([^:]+):param:(\w+)$/.exec(t);
  if (m) return { scope: 'track', id: m[1], insert: null, param: m[2], instrument: true };
  m = /^track:([^:]+):(gain|pan)$/.exec(t);
  if (m) return { scope: 'track', id: m[1], insert: null, param: m[2] };
  return null;
}

// Beats -> the points shape valueAt() reads ({t, v, shape}). Same contract
// as arrangement automation: a point's shape governs the segment that
// STARTS at it (put shape:'exp' on the first point of an exponential sweep).
const asEnv = (env) => ({ points: env.points.map(p => ({ t: p.beat, v: p.v, shape: p.shape })) });

// Schedule one slot's automation for one pass of that slot.
//   strips: trackId -> { strip, panner, instrument }
//   master: InsertChain
//   passStart: ctx time the slot pass begins; secPerBeat; beats: slot length
//   prevSlot: the slot that played just before (song mode). Any lane IT automated that THIS slot
//     doesn't is put back to its resting value at passStart, so a section's automation can't
//     leak into the next one (bug found 2026-10-09: a breakdown's fader dip held through the
//     final drop, 1.1 LU quieter than the others).
// Returns k-rate jobs [{time, run}] for instrument params (caller schedules
// them like note events so they land in the right render window).
export function scheduleSlotAutomation(slot, { strips, master, passStart, secPerBeat, beats, prevSlot = null, project = null }) {
  const jobs = [];
  const mine = new Set((slot.automation ?? []).map(e => e.target));
  for (const env of prevSlot?.automation ?? []) {
    if (mine.has(env.target)) continue;
    const tg = parsePatternTarget(env.target); if (!tg) continue;
    const rest = restingValue(tg, { strips, master, project });
    if (rest == null) continue;
    const r = resolveNode(tg, { strips, master });
    if (r.node) { r.node.cancelScheduledValues(passStart); r.node.setValueAtTime(rest, passStart); }
    else if (r.apply) jobs.push({ time: passStart, run: () => r.apply(rest) });
  }
  for (const env of slot.automation ?? []) {
    const tg = parsePatternTarget(env.target);
    if (!tg || !env.points?.length) continue;
    const e = asEnv(env);
    const span = beats * secPerBeat;
    let node = null;
    if (tg.scope === 'master') {
      node = master?.effects[tg.insert]?.paramNode?.(tg.param) ?? null;
      if (!node) { const fx = master?.effects[tg.insert]; if (fx) pushK(jobs, e, beats, passStart, secPerBeat, v => fx.setParam(tg.param, v)); continue; }
    } else {
      const s = strips.get(tg.id); if (!s) continue;
      if (tg.instrument) { pushK(jobs, e, beats, passStart, secPerBeat, v => s.instrument.setParam(tg.param, v)); continue; }
      if (tg.param === 'gain' && tg.insert == null) node = s.strip.autoGain.gain;
      else if (tg.param === 'pan' && tg.insert == null) node = s.panner.pan;
      else {
        const fx = s.strip.chain.effects[tg.insert]; if (!fx) continue;
        node = fx.paramNode?.(tg.param) ?? null;
        if (!node) { pushK(jobs, e, beats, passStart, secPerBeat, v => fx.setParam(tg.param, v)); continue; }
      }
    }
    // Sample the envelope at ~200 Hz over the pass and hand it to a curve.
    const n = Math.max(2, Math.ceil(span * 200));
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) curve[i] = valueAt(e, (i / (n - 1)) * beats);
    node.cancelScheduledValues(passStart);
    node.setValueAtTime(curve[0], passStart);
    node.setValueCurveAtTime(curve, passStart, span);
  }
  return jobs;
}

// Resting value of an automation lane: what it holds with no automation running.
//   gain -> 1 (the automation gain multiplies the fader); pan -> the track's pan;
//   insert / instrument param -> the value saved in the project.
function restingValue(tg, { strips, master, project }) {
  if (tg.scope === 'master') {
    const fx = master?.effects[tg.insert]; return fx?.params?.[tg.param] ?? null;
  }
  const s = strips.get(tg.id); if (!s) return null;
  if (tg.instrument) return project?.tracks.find(t => t.id === tg.id)?.instrument?.params?.[tg.param] ?? s.instrument?.params?.[tg.param] ?? null;
  if (tg.param === 'gain' && tg.insert == null) return 1;
  if (tg.param === 'pan' && tg.insert == null) return s.track?.channel?.pan ?? project?.tracks.find(t => t.id === tg.id)?.channel?.pan ?? 0;
  const fx = s.strip.chain.effects[tg.insert]; return fx?.params?.[tg.param] ?? null;
}
// Where a lane writes: an AudioParam (node) or a setter (apply) for k-rate params.
function resolveNode(tg, { strips, master }) {
  if (tg.scope === 'master') {
    const fx = master?.effects[tg.insert]; if (!fx) return {};
    const node = fx.paramNode?.(tg.param) ?? null; return node ? { node } : { apply: v => fx.setParam(tg.param, v) };
  }
  const s = strips.get(tg.id); if (!s) return {};
  if (tg.instrument) return { apply: v => s.instrument.setParam(tg.param, v) };
  if (tg.param === 'gain' && tg.insert == null) return { node: s.strip.autoGain.gain };
  if (tg.param === 'pan' && tg.insert == null) return { node: s.panner.pan };
  const fx = s.strip.chain.effects[tg.insert]; if (!fx) return {};
  const node = fx.paramNode?.(tg.param) ?? null; return node ? { node } : { apply: v => fx.setParam(tg.param, v) };
}

function pushK(jobs, e, beats, passStart, secPerBeat, apply) {
  let last;
  for (let b = 0; b < beats; b += 0.25) {
    const v = valueAt(e, b);
    if (v === last) continue; last = v;
    const time = passStart + b * secPerBeat;
    jobs.push({ time, run: () => apply(v) });
  }
}

// Validate a pattern-automation target against the project (ids or names).
export function resolvePatternTarget(project, target, resolveTrack) {
  const raw = String(target ?? '');
  const m = /^track:([^:]+):(.*)$/.exec(raw);
  const norm = m ? `track:${resolveTrack(m[1]).id}:${m[2]}` : raw;
  const tg = parsePatternTarget(norm);
  if (!tg) throw new Error(`Bad target '${target}'. Use track:<track>:gain | track:<track>:pan | track:<track>:insert:<n>:<param> | track:<track>:param:<key> | master:insert:<n>:<param>.`);
  if (tg.insert != null) {
    const list = tg.scope === 'master' ? (project.patternMaster?.inserts ?? []) : (project.tracks.find(t => t.id === tg.id).channel.inserts ?? []);
    const ins = list[tg.insert];
    if (!ins) throw new Error(`No insert ${tg.insert} on ${tg.scope === 'master' ? 'the pattern master' : 'that track'} (it has ${list.length}).`);
    const ps = getEffectDef(ins.type).params.find(p => p.key === tg.param);
    if (!ps || ps.options) throw new Error(`'${tg.param}' is not an automatable knob on ${ins.type}. Knobs: ${getEffectDef(ins.type).params.filter(p => !p.options).map(p => p.key).join(', ')}.`);
    return { target: norm, range: { min: ps.min, max: ps.max } };
  }
  if (tg.param === 'gain') return { target: norm, range: { min: 0, max: 1.5 } };
  if (tg.param === 'pan') return { target: norm, range: { min: -1, max: 1 } };
  return { target: norm, range: null }; // instrument param: caller validates
}
