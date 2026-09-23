// Node test for the saturator/distortion effect (src/engine/effects/saturator.js).
// Run with `node test/fx-saturator.mjs`.

import { makeFakeCtx } from './fx-fake-ctx.mjs';
import { getEffectDef, createEffect } from '../src/engine/effects/registry.js';
import '../src/engine/effects/saturator.js';

let fails = 0;
const check = (name, ok, detail) => {
  console.log((ok ? '  ok  ' : 'FAIL  ') + name + (detail ? `  (${detail})` : ''));
  if (!ok) fails++;
};

const def = getEffectDef('saturator');
check('saturator registered', !!def);
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

// curveType select must include all 4 documented curve types
const curveParam = def.params.find((p) => p.key === 'curveType');
const curves = (curveParam.options || []).map((o) => o.value).sort();
check('curveType has soft/tube/hard/fold', JSON.stringify(curves) === JSON.stringify(['fold', 'hard', 'soft', 'tube']), curves.join(','));

const ctx = makeFakeCtx();
let fx;
try {
  fx = createEffect('saturator', ctx, {});
  fx.applyAll();
  check('construct + applyAll on fake ctx', true);
} catch (e) {
  check('construct + applyAll on fake ctx', false, e.message);
}

// WaveShaper oversample must be 4x (spec requirement)
check("shaper.oversample === '4x'", fx.shaper.oversample === '4x', fx.shaper.oversample);

// A curve array was generated for the default type and is the right length
check('shaper.curve is a Float32Array of length 1024', fx.shaper.curve instanceof Float32Array && fx.shaper.curve.length === 1024, String(fx.shaper.curve && fx.shaper.curve.length));

// Switching curve types regenerates a finite, bounded curve for each of the 4 types
try {
  for (const c of ['soft', 'tube', 'hard', 'fold']) {
    fx.setParam('curveType', c);
    const curve = fx.shaper.curve;
    let allFinite = true, inBounds = true;
    for (let i = 0; i < curve.length; i++) {
      if (!Number.isFinite(curve[i])) allFinite = false;
      if (curve[i] < -1.5 || curve[i] > 1.5) inBounds = false;
    }
    check(`curve '${c}' is finite and bounded`, allFinite && inBounds);
  }
} catch (e) {
  check('curve type sweep does not throw', false, e.message);
}

// Drive, tone, mix param sweeps don't throw
try {
  fx.setParam('drive', 36);
  fx.setParam('drive', 0);
  fx.setParam('tone', -1);
  fx.setParam('tone', 1);
  fx.setParam('mix', 0);
  fx.setParam('mix', 1);
  check('drive/tone/mix sweep does not throw', true);
} catch (e) {
  check('drive/tone/mix sweep does not throw', false, e.message);
}

const paramKeys = new Set(def.params.map((p) => p.key));
for (const [name, preset] of Object.entries(def.presets || {})) {
  const bad = Object.keys(preset).filter((k) => !paramKeys.has(k));
  check(`preset '${name}' only uses real param keys`, bad.length === 0, bad.join(','));
}
check('at least 3 presets', Object.keys(def.presets || {}).length >= 3, String(Object.keys(def.presets || {}).length));

console.log(fails ? `\n${fails} FAILED` : '\nsaturator: all checks passed');
process.exit(fails ? 1 : 0);
