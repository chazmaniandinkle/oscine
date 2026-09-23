// Node test for the resonant filter effect (src/engine/effects/resofilter.js).
// Run with `node test/fx-resofilter.mjs`.

import { makeFakeCtx } from './fx-fake-ctx.mjs';
import { getEffectDef, createEffect } from '../src/engine/effects/registry.js';
import '../src/engine/effects/resofilter.js';

let fails = 0;
const check = (name, ok, detail) => {
  console.log((ok ? '  ok  ' : 'FAIL  ') + name + (detail ? `  (${detail})` : ''));
  if (!ok) fails++;
};

const def = getEffectDef('resofilter');
check('resofilter registered', !!def);
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

// filterType select must include LP/HP/BP/notch
const filterTypeParam = def.params.find((p) => p.key === 'filterType');
const modes = (filterTypeParam.options || []).map((o) => o.value).sort();
check('filterType has lowpass/highpass/bandpass/notch', JSON.stringify(modes) === JSON.stringify(['bandpass', 'highpass', 'lowpass', 'notch']), modes.join(','));

// cutoff uses log curve
const cutoffParam = def.params.find((p) => p.key === 'cutoff');
check('cutoff uses log curve', cutoffParam.curve === 'log');

const ctx = makeFakeCtx();
let fx;
try {
  fx = createEffect('resofilter', ctx, {});
  fx.applyAll();
  check('construct + applyAll on fake ctx', true);
} catch (e) {
  check('construct + applyAll on fake ctx', false, e.message);
}

// LFO depth = 0 by default (modulation optional, off unless dialed in)
check('lfoDepth default is 0 (off by default)', def.params.find((p) => p.key === 'lfoDepth').default === 0);

// exercise every mode + lfo params without throwing
try {
  for (const m of ['lowpass', 'highpass', 'bandpass', 'notch']) fx.setParam('filterType', m);
  fx.setParam('lfoRate', 5);
  fx.setParam('lfoDepth', 0.5);
  fx.setParam('lfoShape', 'square');
  fx.setParam('resonance', 12);
  check('mode + LFO param sweep does not throw', true);
} catch (e) {
  check('mode + LFO param sweep does not throw', false, e.message);
}

// dispose stops the LFO oscillator cleanly
try {
  fx.dispose();
  check('dispose does not throw', true);
} catch (e) {
  check('dispose does not throw', false, e.message);
}

const paramKeys = new Set(def.params.map((p) => p.key));
for (const [name, preset] of Object.entries(def.presets || {})) {
  const bad = Object.keys(preset).filter((k) => !paramKeys.has(k));
  check(`preset '${name}' only uses real param keys`, bad.length === 0, bad.join(','));
}
check('at least 3 presets', Object.keys(def.presets || {}).length >= 3, String(Object.keys(def.presets || {}).length));

console.log(fails ? `\n${fails} FAILED` : '\nresofilter: all checks passed');
process.exit(fails ? 1 : 0);
