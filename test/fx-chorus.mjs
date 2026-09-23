// Node test for the chorus effect (src/engine/effects/chorus.js).
// Run with `node test/fx-chorus.mjs`.

import { makeFakeCtx } from './fx-fake-ctx.mjs';
import { getEffectDef, createEffect } from '../src/engine/effects/registry.js';
import '../src/engine/effects/chorus.js';

let fails = 0;
const check = (name, ok, detail) => {
  console.log((ok ? '  ok  ' : 'FAIL  ') + name + (detail ? `  (${detail})` : ''));
  if (!ok) fails++;
};

const def = getEffectDef('chorus');
check('chorus registered', !!def);
check('def.klass present', typeof def.klass === 'function');

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

const ctx = makeFakeCtx();
let fx;
try {
  fx = createEffect('chorus', ctx, {});
  fx.applyAll();
  check('construct + applyAll on fake ctx', true);
} catch (e) {
  check('construct + applyAll on fake ctx', false, e.message);
}

check('builds 2-3 voices', fx.voices.length >= 2 && fx.voices.length <= 3, String(fx.voices.length));

// rate/depth/spread/voices/mix sweeps
try {
  fx.setParam('voices', 2);
  fx.setParam('voices', 3);
  fx.setParam('rate', 0.05);
  fx.setParam('rate', 8);
  fx.setParam('depth', 0);
  fx.setParam('depth', 10);
  fx.setParam('spread', 0);
  fx.setParam('spread', 1);
  fx.setParam('mix', 0);
  fx.setParam('mix', 1);
  check('rate/depth/spread/voices/mix sweep does not throw', true);
} catch (e) {
  check('rate/depth/spread/voices/mix sweep does not throw', false, e.message);
}

const paramKeys = new Set(def.params.map((p) => p.key));
for (const [name, preset] of Object.entries(def.presets || {})) {
  const bad = Object.keys(preset).filter((k) => !paramKeys.has(k));
  check(`preset '${name}' only uses real param keys`, bad.length === 0, bad.join(','));
}
check('at least 3 presets', Object.keys(def.presets || {}).length >= 3, String(Object.keys(def.presets || {}).length));

console.log(fails ? `\n${fails} FAILED` : '\nchorus: all checks passed');
process.exit(fails ? 1 : 0);
