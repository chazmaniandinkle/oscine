// Node test for the phaser effect (src/engine/effects/phaser.js).
// Run with `node test/fx-phaser.mjs`.

import { makeFakeCtx } from './fx-fake-ctx.mjs';
import { getEffectDef, createEffect } from '../src/engine/effects/registry.js';
import '../src/engine/effects/phaser.js';

let fails = 0;
const check = (name, ok, detail) => {
  console.log((ok ? '  ok  ' : 'FAIL  ') + name + (detail ? `  (${detail})` : ''));
  if (!ok) fails++;
};

const def = getEffectDef('phaser');
check('phaser registered', !!def);
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

// stages select must offer 4/6/8
const stagesParam = def.params.find((p) => p.key === 'stages');
const stageValues = (stagesParam.options || []).map((o) => o.value).sort((a, b) => a - b);
check('stages options are 4/6/8', JSON.stringify(stageValues) === JSON.stringify([4, 6, 8]), stageValues.join(','));

const ctx = makeFakeCtx();
let fx;
try {
  fx = createEffect('phaser', ctx, {});
  fx.applyAll();
  check('construct + applyAll on fake ctx', true);
} catch (e) {
  check('construct + applyAll on fake ctx', false, e.message);
}

check('builds 4-8 allpass stages', fx.stages.length >= 4 && fx.stages.length <= 8, String(fx.stages.length));
check('every stage is type allpass', fx.stages.every((s) => s.ap.type === 'allpass'));

// rate/depth/centerFreq/feedback/stages/mix sweeps
try {
  fx.setParam('stages', 6);
  fx.setParam('stages', 8);
  fx.setParam('rate', 0.02);
  fx.setParam('rate', 10);
  fx.setParam('depth', 0);
  fx.setParam('depth', 2000);
  fx.setParam('centerFreq', 100);
  fx.setParam('centerFreq', 4000);
  fx.setParam('feedback', 0);
  fx.setParam('feedback', 0.95);
  fx.setParam('mix', 0);
  fx.setParam('mix', 1);
  check('rate/depth/centerFreq/feedback/stages/mix sweep does not throw', true);
} catch (e) {
  check('rate/depth/centerFreq/feedback/stages/mix sweep does not throw', false, e.message);
}

const paramKeys = new Set(def.params.map((p) => p.key));
for (const [name, preset] of Object.entries(def.presets || {})) {
  const bad = Object.keys(preset).filter((k) => !paramKeys.has(k));
  check(`preset '${name}' only uses real param keys`, bad.length === 0, bad.join(','));
}
check('at least 3 presets', Object.keys(def.presets || {}).length >= 3, String(Object.keys(def.presets || {}).length));

console.log(fails ? `\n${fails} FAILED` : '\nphaser: all checks passed');
process.exit(fails ? 1 : 0);
