// Node test for the 3-band parametric EQ effect (src/engine/effects/eq3.js).
// Run with `node test/fx-eq3.mjs`.

import { makeFakeCtx } from './fx-fake-ctx.mjs';
import { getEffectDef, createEffect } from '../src/engine/effects/registry.js';
import '../src/engine/effects/eq3.js';

let fails = 0;
const check = (name, ok, detail) => {
  console.log((ok ? '  ok  ' : 'FAIL  ') + name + (detail ? `  (${detail})` : ''));
  if (!ok) fails++;
};

// 1. registration
const def = getEffectDef('eq3');
check('eq3 registered', !!def);
check('def.klass present', typeof def.klass === 'function');
check('def.group set', typeof def.group === 'string' && def.group.length > 0);

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

// 3. construct on a fake ctx + applyAll doesn't throw
const ctx = makeFakeCtx();
let fx;
try {
  fx = createEffect('eq3', ctx, {});
  fx.applyAll();
  check('construct + applyAll on fake ctx', true);
} catch (e) {
  check('construct + applyAll on fake ctx', false, e.message);
}

// 4. slope select flips filter type without throwing
try {
  fx.setParam('hpSlope', 24);
  fx.setParam('lpSlope', 24);
  fx.setParam('hpSlope', 12);
  check('slope toggling does not throw', true);
} catch (e) {
  check('slope toggling does not throw', false, e.message);
}

// 5. gain params are within +-18 dB per the spec
const gainKeys = ['lowGain', 'midGain', 'highGain'];
for (const k of gainKeys) {
  const p = def.params.find((x) => x.key === k);
  check(`${k} range is +-18dB`, p.min === -18 && p.max === 18, `[${p.min},${p.max}]`);
}

// 6. presets only reference real param keys
const paramKeys = new Set(def.params.map((p) => p.key));
for (const [name, preset] of Object.entries(def.presets || {})) {
  const bad = Object.keys(preset).filter((k) => !paramKeys.has(k));
  check(`preset '${name}' only uses real param keys`, bad.length === 0, bad.join(','));
}
check('at least 3 presets', Object.keys(def.presets || {}).length >= 3, String(Object.keys(def.presets || {}).length));

console.log(fails ? `\n${fails} FAILED` : '\neq3: all checks passed');
process.exit(fails ? 1 : 0);
