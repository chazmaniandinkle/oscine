// Node test for the Utility effect (src/engine/effects/utility.js).
// Run with `node test/fx-utility.mjs`.

import { makeFakeCtx } from './fx-fake-ctx.mjs';
import { getEffectDef, createEffect } from '../src/engine/effects/registry.js';
import '../src/engine/effects/utility.js';

let fails = 0;
const check = (name, ok, detail) => {
  console.log((ok ? '  ok  ' : 'FAIL  ') + name + (detail ? `  (${detail})` : ''));
  if (!ok) fails++;
};

// 1. registration
const def = getEffectDef('utility');
check('utility registered', !!def);
check('def.klass present', typeof def.klass === 'function');
check('def.group is utility', def.group === 'utility', def.group);

// 2. every param default within min/max (or a valid select option)
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

// gain trim range must be +-24dB per spec
const gainParam = def.params.find((p) => p.key === 'gainDb');
check('gainDb range is +-24dB', gainParam.min === -24 && gainParam.max === 24, `[${gainParam.min},${gainParam.max}]`);

// width range must be 0-200%
const widthParam = def.params.find((p) => p.key === 'width');
check('width range is 0-200%', widthParam.min === 0 && widthParam.max === 200, `[${widthParam.min},${widthParam.max}]`);

// 3. construct on a fake ctx + applyAll doesn't throw
const ctx = makeFakeCtx();
let fx;
try {
  fx = createEffect('utility', ctx, {});
  fx.applyAll();
  check('construct + applyAll on fake ctx', true);
} catch (e) {
  check('construct + applyAll on fake ctx', false, e.message);
}

// 4. behaviour check: width=0 -> S-gain 0, width=200 -> S-gain 2
try {
  fx.setParam('width', 0);
  check('width=0 leaves widthGain at 0', fx.widthGain.gain.value === 0, String(fx.widthGain.gain.value));
  fx.setParam('width', 200);
  check('width=200 sets widthGain to 2', fx.widthGain.gain.value === 2, String(fx.widthGain.gain.value));
  fx.setParam('width', 100);
  check('width=100 sets widthGain to 1 (unity)', fx.widthGain.gain.value === 1, String(fx.widthGain.gain.value));
} catch (e) {
  check('width behaviour check does not throw', false, e.message);
}

// 5. polarity, swap, mono selects don't throw and set expected targets
try {
  fx.setParam('polarity', 'inverted');
  check('polarity inverted sets polarityGain to -1', fx.polarityGain.gain.value === -1, String(fx.polarityGain.gain.value));
  fx.setParam('polarity', 'normal');
  check('polarity normal sets polarityGain to 1', fx.polarityGain.gain.value === 1, String(fx.polarityGain.gain.value));

  fx.setParam('swap', 'swapped');
  check('swap=swapped flips swapLL to 0', fx.swapLL.gain.value === 0, String(fx.swapLL.gain.value));
  fx.setParam('swap', 'normal');
  check('swap=normal restores swapLL to 1', fx.swapLL.gain.value === 1, String(fx.swapLL.gain.value));

  fx.setParam('mono', 'mono');
  check('mono=mono sets outLMono to 1', fx.outLMono.gain.value === 1, String(fx.outLMono.gain.value));
  fx.setParam('mono', 'stereo');
  check('mono=stereo restores outLDirect to 1', fx.outLDirect.gain.value === 1, String(fx.outLDirect.gain.value));
} catch (e) {
  check('polarity/swap/mono sweep does not throw', false, e.message);
}

// 6. presets only reference real param keys
const paramKeys = new Set(def.params.map((p) => p.key));
for (const [name, preset] of Object.entries(def.presets || {})) {
  const bad = Object.keys(preset).filter((k) => !paramKeys.has(k));
  check(`preset '${name}' only uses real param keys`, bad.length === 0, bad.join(','));
}
check('at least 5 presets', Object.keys(def.presets || {}).length >= 5, String(Object.keys(def.presets || {}).length));

console.log(fails ? `\n${fails} FAILED` : '\nutility: all checks passed');
process.exit(fails ? 1 : 0);
