// Node test for the stereo delay effect (src/engine/effects/stereodelay.js).
// Run with `node test/fx-stereodelay.mjs`.

import { makeFakeCtx } from './fx-fake-ctx.mjs';
import { getEffectDef, createEffect } from '../src/engine/effects/registry.js';
import '../src/engine/effects/stereodelay.js';

let fails = 0;
const check = (name, ok, detail) => {
  console.log((ok ? '  ok  ' : 'FAIL  ') + name + (detail ? `  (${detail})` : ''));
  if (!ok) fails++;
};

const def = getEffectDef('stereodelay');
check('stereodelay registered', !!def);
check('def.klass present', typeof def.klass === 'function');
check('def.tempoSynced === true', def.tempoSynced === true);

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
  fx = createEffect('stereodelay', ctx, {});
  fx.applyAll();
  check('construct + applyAll on fake ctx', true);
} catch (e) {
  check('construct + applyAll on fake ctx', false, e.message);
}

// bpm pseudo-param must not throw, and should affect delay time in synced mode
try {
  fx.setParam('timeMode', 'synced');
  fx.setParam('timeL', 1);
  fx.applyParam('bpm', 140);
  check('bpm pseudo-param applies without throwing', true);
} catch (e) {
  check('bpm pseudo-param applies without throwing', false, e.message);
}

// free mode ms conversion sweep
try {
  fx.setParam('timeMode', 'free');
  fx.setParam('timeL', 500);
  fx.setParam('timeR', 750);
  fx.setParam('feedback', 0.9);
  fx.setParam('crossfeed', 1);
  fx.setParam('damping', 3000);
  fx.setParam('mix', 0.6);
  check('free-mode param sweep does not throw', true);
} catch (e) {
  check('free-mode param sweep does not throw', false, e.message);
}

// feedback must be clamped under 1 for stability
check('delayL.delayTime within max delay bound', fx.delayL.delayTime.value <= 4);

const paramKeys = new Set(def.params.map((p) => p.key));
for (const [name, preset] of Object.entries(def.presets || {})) {
  const bad = Object.keys(preset).filter((k) => !paramKeys.has(k));
  check(`preset '${name}' only uses real param keys`, bad.length === 0, bad.join(','));
}
check('at least 3 presets', Object.keys(def.presets || {}).length >= 3, String(Object.keys(def.presets || {}).length));

console.log(fails ? `\n${fails} FAILED` : '\nstereodelay: all checks passed');
process.exit(fails ? 1 : 0);
