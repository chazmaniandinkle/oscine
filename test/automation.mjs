// Automation model + scheduling. Node-side: fake AudioParam records calls.
import { valueAt, addPoint, movePoint, removePoint, scheduleEnvelope, scheduleClipEnvelopes, parseTarget, targetOf, ensureEnvelope, rangeOf } from '../src/engine/automation.js';
import { getEffectDef, createEffect } from '../src/engine/effects/registry.js';
import '../src/engine/effects/index.js'; // registers eq3 etc. for rangeOf(insert) tests
import { makeFakeCtx } from './fx-fake-ctx.mjs';

let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? '  ok  ' : 'FAIL  ') + n + (d ? `  (${d})` : '')); if (!ok) fails++; };

check('parse lane target', JSON.stringify(parseTarget('lane:vocal-r2:gainDb')) === JSON.stringify({ kind: 'lane', lane: 'vocal-r2', clip: null, insert: null, param: 'gainDb' }));
check('parse master target', JSON.stringify(parseTarget('master:gainDb')) === JSON.stringify({ kind: 'master', lane: null, clip: null, insert: null, param: 'gainDb' }));
check('targetOf round-trips', targetOf('lane', 'x', 'pan') === 'lane:x:pan' && targetOf('master', null, 'gainDb') === 'master:gainDb');

// STEP 1: grammar round-trips for all five target forms + rangeOf.
const forms = [
  ['lane', 'v', 'gainDb', null, 'lane:v:gainDb'],
  ['lane', 'v', 'pan', null, 'lane:v:pan'],
  ['master', null, 'gainDb', null, 'master:gainDb'],
  ['lane', 'v', 'freq', 0, 'lane:v:insert:0:freq'],
  ['clip', 'c1', 'gainDb', null, 'clip:c1:gainDb'],
];
for (const [kind, id, param, insert, str] of forms) {
  const built = targetOf(kind, id, param, insert);
  check(`targetOf builds ${str}`, built === str, built);
  const parsed = parseTarget(built);
  const rebuilt = targetOf(parsed.kind, parsed.kind === 'lane' ? parsed.lane : (parsed.kind === 'clip' ? parsed.clip : null), parsed.param, parsed.insert);
  check(`parseTarget(${str}) round-trips`, rebuilt === str, JSON.stringify(parsed));
}
check('parse insert target fields', JSON.stringify(parseTarget('lane:v:insert:2:midGain')) === JSON.stringify({ kind: 'lane', lane: 'v', clip: null, insert: 2, param: 'midGain' }));

check('rangeOf lane gainDb', JSON.stringify(rangeOf('lane:v:gainDb')) === JSON.stringify({ min: -60, max: 12, default: 0, unit: 'dB' }));
check('rangeOf lane pan', JSON.stringify(rangeOf('lane:v:pan')) === JSON.stringify({ min: -1, max: 1, default: 0, unit: '' }));
check('rangeOf master gainDb', JSON.stringify(rangeOf('master:gainDb')) === JSON.stringify({ min: -60, max: 12, default: 0, unit: 'dB' }));
check('rangeOf clip gainDb', JSON.stringify(rangeOf('clip:c1:gainDb')) === JSON.stringify({ min: -60, max: 12, default: 0, unit: 'dB' }));
const fakeProject = { arrangement: { lanes: [{ id: 'v', inserts: [{ type: 'eq3', params: {} }] }] } };
const insertRange = rangeOf('lane:v:insert:0:midGain', fakeProject);
check('rangeOf insert target (eq3 midGain)', insertRange && insertRange.min === -18 && insertRange.max === 18 && insertRange.default === 0, JSON.stringify(insertRange));
check('rangeOf insert target unknown param -> null', rangeOf('lane:v:insert:0:nope', fakeProject) === null);
check('rangeOf insert target unknown lane -> null', rangeOf('lane:nope:insert:0:midGain', fakeProject) === null);

const arr = { automation: [] };
const env = ensureEnvelope(arr, 'lane:v:gainDb');
addPoint(env, 10, 0); addPoint(env, 20, -12); addPoint(env, 5, 0);
check('points sorted by t', env.points.map(p => p.t).join(',') === '5,10,20');
check('flat before first', valueAt(env, 0) === 0);
check('flat after last', valueAt(env, 99) === -12);
check('linear between (15s -> -6 dB)', Math.abs(valueAt(env, 15) + 6) < 1e-9, valueAt(env, 15));
addPoint(env, 10, -3);
check('same-t replaces', env.points.length === 3 && env.points[1].v === -3);
addPoint(env, 30, 99);
check('clamped to target max (+12)', env.points[3].v === 12);
movePoint(env, 1, 25, -60);
check('move can\'t cross neighbours', env.points[1].t < env.points[2].t && env.points[1].t > env.points[0].t, env.points.map(p => p.t.toFixed(3)).join(','));
removePoint(env, 3);
check('remove', env.points.length === 3);

// schedule: curve endpoints must equal envelope values, mapped to linear gain
const calls = [];
const param = { cancelScheduledValues: t => calls.push(['cancel', t]), setValueAtTime: (v, t) => calls.push(['set', v, t]), setValueCurveAtTime: (c, t, d) => calls.push(['curve', c, t, d]) };
const e2 = { target: 'lane:v:gainDb', points: [{ t: 10, v: 0 }, { t: 20, v: -20 }] };
scheduleEnvelope(param, e2, { at: 100, from: 5, span: 20, sr: 10, toParam: db => Math.pow(10, db / 20) });
const curve = calls.find(c => c[0] === 'curve')[1];
check('curve starts at 0 dB = 1.0 (before first point)', Math.abs(curve[0] - 1) < 1e-6, curve[0]);
check('curve ends at -20 dB = 0.1 (after last point)', Math.abs(curve[curve.length - 1] - 0.1) < 1e-6, curve[curve.length - 1]);
// midpoint of the ramp (t=15 -> -10 dB -> 0.316)
const mid = curve[Math.round((15 - 5) / 20 * (curve.length - 1))];
check('curve is linear in dB (t=15 -> -10 dB)', Math.abs(mid - Math.pow(10, -10 / 20)) < 0.02, mid.toFixed(3));
check('scheduled at ctx time 100 for 20 s', calls.find(c => c[0] === 'curve')[2] === 100 && calls.find(c => c[0] === 'curve')[3] === 20);

// STEP 2: shapes.
// hold: value stays at a.v until b.t, then jumps.
const envHold = { target: 'lane:v:pan', points: [{ t: 0, v: -1, shape: 'hold' }, { t: 10, v: 1, shape: 'linear' }] };
check('hold holds mid-segment', valueAt(envHold, 5) === -1, valueAt(envHold, 5));
check('hold reaches b at b.t', valueAt(envHold, 10) === 1, valueAt(envHold, 10));

// exp: geometric interpolation. 100 -> 1000 over 1s, midpoint ~316 (sqrt(100*1000)), not 550 (linear).
const envExp = { target: 'lane:v:insert:0:freq', points: [{ t: 0, v: 100, shape: 'exp' }, { t: 1, v: 1000, shape: 'linear' }] };
const expMid = valueAt(envExp, 0.5);
check('exp midpoint of 100->1000 is ~316 not 550', Math.abs(expMid - Math.sqrt(100 * 1000)) < 1 && Math.abs(expMid - 550) > 100, expMid.toFixed(2));

// exp on gainDb (range bottoms at -60 dB, treated as zero-crossing) is coerced to linear.
const arrCoerce = { automation: [] };
const envCoerce = ensureEnvelope(arrCoerce, 'lane:v:gainDb');
const coercedPt = addPoint(envCoerce, 0, -6, undefined, 'exp');
check('exp on gainDb coerced to linear', coercedPt.shape === 'linear', coercedPt.shape);
check('exp on gainDb sets shapeCoerced flag', coercedPt.shapeCoerced === true);
// pan crosses 0 too.
const envPan = ensureEnvelope(arrCoerce, 'lane:v:pan');
const panPt = addPoint(envPan, 0, 0.5, undefined, 'exp');
check('exp on pan coerced to linear (crosses 0)', panPt.shape === 'linear' && panPt.shapeCoerced === true);
// a non-zero-crossing insert param keeps exp.
const arrInsert = { automation: [] };
const envInsertFreq = ensureEnvelope(arrInsert, 'lane:v:insert:0:midFreq');
const freqPt = addPoint(envInsertFreq, 0, 500, fakeProject, 'exp');
check('exp on insert freq (no zero-cross) kept', freqPt.shape === 'exp' && !freqPt.shapeCoerced, JSON.stringify(freqPt));

// STEP 3: scheduling for clip-relative and insert-param targets.
// clip-local offset math: point at local 2s under placement at 10s -> song 12s.
{
  const arrClip = { automation: [{ target: 'clip:c1:gainDb', points: [{ t: 0, v: 0, shape: 'linear' }, { t: 2, v: -6, shape: 'linear' }, { t: 5, v: -6, shape: 'linear' }] }] };
  const player = { project: { arrangement: arrClip } };
  const placement = { at: 10, clip: 'c1', track: 'v' };
  const clip = { id: 'c1', in: 0, out: 5, stretch: 1, rate: 1 };
  const calls2 = [];
  const fakeGain = { gain: { cancelScheduledValues: t => calls2.push(['cancel', t]), setValueAtTime: (v, t) => calls2.push(['set', v, t]), setValueCurveAtTime: (c, t, d) => calls2.push(['curve', c, t, d]) } };
  // play starts at song 0 (from=0), ctx time 100 (at=100) -- placement starts mid-play at song 10.
  scheduleClipEnvelopes(player, placement, clip, fakeGain, { at: 100, from: 0 });
  const curveCall = calls2.find(c => c[0] === 'curve');
  check('clip envelope schedules a curve', !!curveCall);
  // scheduleAt = at + max(0, clipSongStart-from) = 100 + 10 = 110; span = clipSongEnd - spanStart = 15-10=5
  check('clip envelope curve starts at song 10 (ctx 110)', curveCall && curveCall[2] === 110, curveCall && curveCall[2]);
  check('clip envelope curve spans 5s (song 10..15)', curveCall && Math.abs(curveCall[3] - 5) < 1e-9, curveCall && curveCall[3]);
  if (curveCall) {
    const [, curve] = curveCall;
    // song time 12 -> local 2 -> fraction into the 5s span = (12-10)/5 = 0.4
    const idx = Math.round(0.4 * (curve.length - 1));
    const expected = Math.pow(10, -6 / 20); // value at local t=2 is -6dB, held flat to t=5
    check('song 12 (local 2) samples -6dB as linear gain', Math.abs(curve[idx] - expected) < 0.02, `${curve[idx]} vs ${expected}`);
  }
}

// eq3.paramNode fast path: returns an object with a real setValueAtTime.
{
  const def = getEffectDef('eq3');
  const ctx = makeFakeCtx();
  const fx = createEffect('eq3', ctx, {});
  fx.applyAll();
  const node = fx.paramNode('midGain');
  check('eq3.paramNode(midGain) returns a node', !!node);
  check('eq3.paramNode(midGain) has setValueAtTime', typeof node?.setValueAtTime === 'function');
  node.setValueAtTime(5, 0);
  check('eq3.paramNode(midGain) is the live mid.gain param', node.value === 5, node.value);
  check('eq3.paramNode(unknownKey) returns null', fx.paramNode('nope') === null);
}

console.log(fails ? `\n${fails} FAILED` : '\nautomation: all checks passed');
process.exit(fails ? 1 : 0);