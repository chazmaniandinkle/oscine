// Node test for the algorithmic reverb effect (src/engine/effects/algoreverb.js).
// Run with `node test/fx-algoreverb.mjs`.

import { makeFakeCtx } from './fx-fake-ctx.mjs';
import { getEffectDef, createEffect } from '../src/engine/effects/registry.js';
import '../src/engine/effects/algoreverb.js';

let fails = 0;
const check = (name, ok, detail) => {
  console.log((ok ? '  ok  ' : 'FAIL  ') + name + (detail ? `  (${detail})` : ''));
  if (!ok) fails++;
};

const def = getEffectDef('algoreverb');
check('algoreverb registered', !!def);
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
  fx = createEffect('algoreverb', ctx, {});
  fx.applyAll();
  check('construct + applyAll on fake ctx', true);
} catch (e) {
  check('construct + applyAll on fake ctx', false, e.message);
}

// Impulse buffer must be generated immediately at construction (no async
// wait needed), non-null, correct channel count.
check('convolver.buffer generated at construction', !!fx.convolver.buffer);
check('convolver.buffer has 2 channels', fx.convolver.buffer && fx.convolver.buffer.numberOfChannels === 2);

// Debounce: rapid-fire size changes (simulating a knob drag) must not
// throw and must not synchronously rebuild on every call (the debounce
// wrapper schedules via setTimeout, so back-to-back setParam calls in the
// same tick should only touch the *pending* timer, not run the rebuild
// N times synchronously).
try {
  const bufBefore = fx.convolver.buffer;
  for (let i = 0; i < 60; i++) fx.setParam('size', 1 + i * 0.01);
  check('60x rapid size changes do not throw', true);
  check('debounced rebuild has NOT run synchronously mid-drag', fx.convolver.buffer === bufBefore);
} catch (e) {
  check('60x rapid size changes do not throw', false, e.message);
}

// decay/damping/predelay/mix sweeps
try {
  fx.setParam('decay', 0.1);
  fx.setParam('decay', 0.9);
  fx.setParam('damping', 500);
  fx.setParam('damping', 17000);
  fx.setParam('preDelay', 0);
  fx.setParam('preDelay', 250);
  fx.setParam('mix', 0);
  fx.setParam('mix', 1);
  check('decay/damping/preDelay/mix sweep does not throw', true);
} catch (e) {
  check('decay/damping/preDelay/mix sweep does not throw', false, e.message);
}

const paramKeys = new Set(def.params.map((p) => p.key));
for (const [name, preset] of Object.entries(def.presets || {})) {
  const bad = Object.keys(preset).filter((k) => !paramKeys.has(k));
  check(`preset '${name}' only uses real param keys`, bad.length === 0, bad.join(','));
}
check('at least 3 presets', Object.keys(def.presets || {}).length >= 3, String(Object.keys(def.presets || {}).length));

console.log(fails ? `\n${fails} FAILED` : '\nalgoreverb: all checks passed');
process.exit(fails ? 1 : 0);
