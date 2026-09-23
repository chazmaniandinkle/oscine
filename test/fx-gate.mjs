// Node test for the Gate effect (src/engine/effects/gate.js).
// Run with `node test/fx-gate.mjs`.

import { makeFakeCtx } from './fx-fake-ctx.mjs';
import { getEffectDef, createEffect } from '../src/engine/effects/registry.js';
import '../src/engine/effects/gate.js';

let fails = 0;
const check = (name, ok, detail) => {
  console.log((ok ? '  ok  ' : 'FAIL  ') + name + (detail ? `  (${detail})` : ''));
  if (!ok) fails++;
};

// 1. registration
const def = getEffectDef('gate');
check('gate registered', !!def);
check('def.klass present', typeof def.klass === 'function');
check('def.group is dynamics', def.group === 'dynamics', def.group);

// 2. every param default within min/max
for (const p of def.params) {
  if (p.type === 'select') {
    const values = (p.options || []).map((o) => o.value);
    check(`param ${p.key} default is a valid option`, values.includes(p.default), `default=${p.default}`);
  } else {
    const inRange = p.default >= p.min && p.default <= p.max;
    check(`param ${p.key} default in [${p.min}, ${p.max}]`, inRange, `default=${p.default}`);
  }
  check(`param ${p.key} has group`, !!p.group);
}

for (const key of ['threshold', 'range', 'attack', 'hold', 'release']) {
  check(`has ${key} param`, !!def.params.find((p) => p.key === key));
}

// 3. construct on a fake ctx + applyAll doesn't throw
const ctx = makeFakeCtx();
let fx;
try {
  fx = createEffect('gate', ctx, {});
  fx.applyAll();
  check('construct + applyAll on fake ctx', true);
} catch (e) {
  check('construct + applyAll on fake ctx', false, e.message);
}

// 4. behaviour check: transfer curve is monotonic non-decreasing across
// the domain (level = |x| always increases as x moves 0 -> 1, so the
// mapped 'open amount' should never dip back down as x rises through
// the positive half of the WaveShaper domain).
try {
  const curve = fx.transferCurve.curve;
  check('transfer curve length matches spec (1024)', curve.length === 1024, String(curve.length));
  let monotonic = true;
  // Only check the positive half [0.5*N, N) since input domain maps
  // x in [-1,1] and |x| is what's meaningful post-rectifier; curve
  // should rise from the midpoint (x=0, level=0) outward.
  const mid = Math.floor(curve.length / 2);
  for (let i = mid + 1; i < curve.length; i++) {
    if (curve[i] < curve[i - 1] - 1e-9) { monotonic = false; break; }
  }
  check('transfer curve is monotonic non-decreasing (positive half)', monotonic);
} catch (e) {
  check('transfer curve monotonic check does not throw', false, e.message);
}

// 5. curve floor matches the `range` param and ceiling reaches ~1 (open)
try {
  const curve = fx.transferCurve.curve;
  const floorLin = Math.pow(10, (-60) / 20); // default range = -60dB
  check('curve floor is close to range floor (closed state)', Math.abs(curve[Math.floor(curve.length / 2)] - floorLin) < 1e-6, `${curve[Math.floor(curve.length / 2)]} vs ${floorLin}`);
  check('curve reaches fully open (~1) at extremes', Math.abs(curve[curve.length - 1] - 1) < 1e-6, String(curve[curve.length - 1]));
} catch (e) {
  check('curve floor/ceiling check does not throw', false, e.message);
}

// 6. threshold/range changes rebuild the curve without throwing, and
// rebuilding actually changes the curve content.
try {
  const before = fx.transferCurve.curve.slice();
  fx.setParam('threshold', -10);
  fx.setParam('range', -20);
  const after = fx.transferCurve.curve;
  let changed = false;
  for (let i = 0; i < after.length; i++) if (Math.abs(after[i] - before[i]) > 1e-9) { changed = true; break; }
  check('threshold/range change rebuilds the curve', changed);
} catch (e) {
  check('threshold/range rebuild does not throw', false, e.message);
}

// 7. attack maps to a higher detector cutoff than a slower attack
try {
  fx.setParam('attack', 0.1); // fastest
  const fastHz = fx.detectorLPF.frequency.value;
  fx.setParam('attack', 100); // slowest
  const slowHz = fx.detectorLPF.frequency.value;
  check('faster attack yields a higher detector cutoff', fastHz > slowHz, `${fastHz} > ${slowHz}`);
} catch (e) {
  check('attack cutoff behaviour does not throw', false, e.message);
}

// 8. release + hold both drive the release detector cutoff without throwing
try {
  fx.setParam('release', 5);
  fx.setParam('hold', 0);
  const fastHz = fx.releaseLPF.frequency.value;
  fx.setParam('release', 2000);
  fx.setParam('hold', 500);
  const slowHz = fx.releaseLPF.frequency.value;
  check('longer release+hold yields a lower release cutoff', slowHz < fastHz, `${slowHz} < ${fastHz}`);
} catch (e) {
  check('release/hold cutoff behaviour does not throw', false, e.message);
}

// 9. full-range threshold/range sweep doesn't throw
try {
  fx.setParam('threshold', -80);
  fx.setParam('threshold', 0);
  fx.setParam('range', -80);
  fx.setParam('range', 0);
  check('threshold/range full-range sweep does not throw', true);
} catch (e) {
  check('threshold/range full-range sweep does not throw', false, e.message);
}

// 10. presets only reference real param keys
const paramKeys = new Set(def.params.map((p) => p.key));
for (const [name, preset] of Object.entries(def.presets || {})) {
  const bad = Object.keys(preset).filter((k) => !paramKeys.has(k));
  check(`preset '${name}' only uses real param keys`, bad.length === 0, bad.join(','));
}
check('at least 5 presets', Object.keys(def.presets || {}).length >= 5, String(Object.keys(def.presets || {}).length));

console.log(fails ? `\n${fails} FAILED` : '\ngate: all checks passed');
process.exit(fails ? 1 : 0);
