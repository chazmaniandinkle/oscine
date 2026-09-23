// Automation model + scheduling. Node-side: fake AudioParam records calls.
import { valueAt, addPoint, movePoint, removePoint, scheduleEnvelope, parseTarget, targetOf, ensureEnvelope } from '../src/engine/automation.js';

let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? '  ok  ' : 'FAIL  ') + n + (d ? `  (${d})` : '')); if (!ok) fails++; };

check('parse lane target', JSON.stringify(parseTarget('lane:vocal-r2:gainDb')) === JSON.stringify({ kind: 'lane', lane: 'vocal-r2', param: 'gainDb' }));
check('parse master target', JSON.stringify(parseTarget('master:gainDb')) === JSON.stringify({ kind: 'master', lane: null, param: 'gainDb' }));
check('targetOf round-trips', targetOf('lane', 'x', 'pan') === 'lane:x:pan' && targetOf('master', null, 'gainDb') === 'master:gainDb');

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

console.log(fails ? `\n${fails} FAILED` : '\nautomation: all checks passed');
process.exit(fails ? 1 : 0);
