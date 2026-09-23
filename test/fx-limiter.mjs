// Node test for the Limiter effect (src/engine/effects/limiter.js).
// Run with `node test/fx-limiter.mjs`.

import { makeFakeCtx } from './fx-fake-ctx.mjs';
import { getEffectDef, createEffect } from '../src/engine/effects/registry.js';
import '../src/engine/effects/limiter.js';

let fails = 0;
const check = (name, ok, detail) => {
  console.log((ok ? '  ok  ' : 'FAIL  ') + name + (detail ? `  (${detail})` : ''));
  if (!ok) fails++;
};

// 1. registration
const def = getEffectDef('limiter');
check('limiter registered', !!def);
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

for (const key of ['inputDb', 'ceiling', 'release']) {
  check(`has ${key} param`, !!def.params.find((p) => p.key === key));
}

// 3. construct on a fake ctx + applyAll doesn't throw
const ctx = makeFakeCtx();
let fx;
try {
  fx = createEffect('limiter', ctx, {});
  fx.applyAll();
  check('construct + applyAll on fake ctx', true);
} catch (e) {
  check('construct + applyAll on fake ctx', false, e.message);
}

// 4. behaviour check: curve length is 4096, and max |value| <= ceiling linear
try {
  const ceilingDb = -0.3;
  fx.setParam('ceiling', ceilingDb);
  const curve = fx.shaper.curve;
  check('curve length is 4096', curve.length === 4096, String(curve.length));
  const ceilingLin = Math.pow(10, ceilingDb / 20);
  let maxAbs = 0;
  for (let i = 0; i < curve.length; i++) maxAbs = Math.max(maxAbs, Math.abs(curve[i]));
  check('max |curve value| <= ceiling linear', maxAbs <= ceilingLin + 1e-9, `${maxAbs} <= ${ceilingLin}`);
  // the curve should actually reach the ceiling at the extremes (clamped, not just below it)
  check('curve reaches ceiling near the extremes', Math.abs(maxAbs - ceilingLin) < 1e-6, `${maxAbs} vs ${ceilingLin}`);
} catch (e) {
  check('ceiling curve behaviour check does not throw', false, e.message);
}

// 5. ceiling sweep across full range regenerates a finite, bounded curve
try {
  for (const c of [-12, -6, -0.3, 0]) {
    fx.setParam('ceiling', c);
    const curve = fx.shaper.curve;
    let allFinite = true;
    for (let i = 0; i < curve.length; i++) if (!Number.isFinite(curve[i])) allFinite = false;
    check(`ceiling=${c} produces a finite curve`, allFinite);
  }
} catch (e) {
  check('ceiling sweep does not throw', false, e.message);
}

// 6. hard-set compressor params match the "hard limiter" spec
check('comp.knee is 0 (hard knee)', fx.comp.knee.value === 0, String(fx.comp.knee.value));
check('comp.ratio is 20 (brickwall-ish)', fx.comp.ratio.value === 20, String(fx.comp.ratio.value));
check('comp.attack is ~1ms', Math.abs(fx.comp.attack.value - 0.001) < 1e-6, String(fx.comp.attack.value));

// 7. release + inputDb sweeps don't throw
try {
  fx.setParam('release', 10);
  fx.setParam('release', 500);
  fx.setParam('inputDb', 0);
  fx.setParam('inputDb', 24);
  check('release/inputDb sweep does not throw', true);
} catch (e) {
  check('release/inputDb sweep does not throw', false, e.message);
}

// getReductionDb() exposes native readout
try {
  fx.comp.reduction = -3.2;
  check('getReductionDb() reflects comp.reduction', fx.getReductionDb() === -3.2, String(fx.getReductionDb()));
} catch (e) {
  check('getReductionDb() does not throw', false, e.message);
}

// 8. presets only reference real param keys
const paramKeys = new Set(def.params.map((p) => p.key));
for (const [name, preset] of Object.entries(def.presets || {})) {
  const bad = Object.keys(preset).filter((k) => !paramKeys.has(k));
  check(`preset '${name}' only uses real param keys`, bad.length === 0, bad.join(','));
}
check('at least 5 presets', Object.keys(def.presets || {}).length >= 5, String(Object.keys(def.presets || {}).length));

console.log(fails ? `\n${fails} FAILED` : '\nlimiter: all checks passed');
process.exit(fails ? 1 : 0);
