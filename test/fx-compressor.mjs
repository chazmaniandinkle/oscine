// Node test for the Compressor effect (src/engine/effects/compressor.js).
// Run with `node test/fx-compressor.mjs`.

import { makeFakeCtx } from './fx-fake-ctx.mjs';
import { getEffectDef, createEffect } from '../src/engine/effects/registry.js';
import '../src/engine/effects/compressor.js';

let fails = 0;
const check = (name, ok, detail) => {
  console.log((ok ? '  ok  ' : 'FAIL  ') + name + (detail ? `  (${detail})` : ''));
  if (!ok) fails++;
};

// 1. registration
const def = getEffectDef('compressor');
check('compressor registered', !!def);
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

// required keys present
for (const key of ['threshold', 'knee', 'ratio', 'attack', 'release', 'makeupDb', 'lookaheadMs', 'mix']) {
  check(`has ${key} param`, !!def.params.find((p) => p.key === key));
}

// 3. construct on a fake ctx + applyAll doesn't throw
const ctx = makeFakeCtx();
let fx;
try {
  fx = createEffect('compressor', ctx, {});
  fx.applyAll();
  check('construct + applyAll on fake ctx', true);
} catch (e) {
  check('construct + applyAll on fake ctx', false, e.message);
}

// 4. getReductionDb() exposes the native .reduction readout
try {
  fx.comp.reduction = -6.5;
  check('getReductionDb() reflects comp.reduction', fx.getReductionDb() === -6.5, String(fx.getReductionDb()));
} catch (e) {
  check('getReductionDb() does not throw', false, e.message);
}

// 5. behaviour check: lookahead sets delayTime (ms -> s) and updates latencySamples
try {
  fx.setParam('lookaheadMs', 5);
  check('lookaheadMs=5 sets delayTime to 0.005s', Math.abs(fx.lookaheadDelay.delayTime.value - 0.005) < 1e-9, String(fx.lookaheadDelay.delayTime.value));
  check('lookaheadMs=5 updates def.latencySamples', def.latencySamples === Math.round(0.005 * 44100), String(def.latencySamples));
  fx.setParam('lookaheadMs', 0);
  check('lookaheadMs=0 resets delayTime to 0', fx.lookaheadDelay.delayTime.value === 0, String(fx.lookaheadDelay.delayTime.value));
  check('lookaheadMs=0 resets def.latencySamples to 0', def.latencySamples === 0, String(def.latencySamples));
} catch (e) {
  check('lookahead behaviour check does not throw', false, e.message);
}

// 6. attack/release ms -> s conversion onto native compressor AudioParams
try {
  fx.setParam('attack', 20);
  check('attack=20ms sets comp.attack to 0.02s', Math.abs(fx.comp.attack.value - 0.02) < 1e-9, String(fx.comp.attack.value));
  fx.setParam('release', 250);
  check('release=250ms sets comp.release to 0.25s', Math.abs(fx.comp.release.value - 0.25) < 1e-9, String(fx.comp.release.value));
} catch (e) {
  check('attack/release conversion check does not throw', false, e.message);
}

// 7. mix parallel crossfade doesn't throw and reaches endpoints
try {
  fx.setParam('mix', 0);
  check('mix=0 mutes wetTap', fx.wetTap.gain.value === 0, String(fx.wetTap.gain.value));
  check('mix=0 opens dryTap fully', fx.dryTap.gain.value === 1, String(fx.dryTap.gain.value));
  fx.setParam('mix', 1);
  check('mix=1 opens wetTap fully', fx.wetTap.gain.value === 1, String(fx.wetTap.gain.value));
} catch (e) {
  check('mix sweep does not throw', false, e.message);
}

// 8. threshold/knee/ratio full-range sweep doesn't throw
try {
  fx.setParam('threshold', -60);
  fx.setParam('threshold', 0);
  fx.setParam('knee', 0);
  fx.setParam('knee', 40);
  fx.setParam('ratio', 1);
  fx.setParam('ratio', 20);
  check('threshold/knee/ratio full-range sweep does not throw', true);
} catch (e) {
  check('threshold/knee/ratio full-range sweep does not throw', false, e.message);
}

// 9. presets only reference real param keys
const paramKeys = new Set(def.params.map((p) => p.key));
for (const [name, preset] of Object.entries(def.presets || {})) {
  const bad = Object.keys(preset).filter((k) => !paramKeys.has(k));
  check(`preset '${name}' only uses real param keys`, bad.length === 0, bad.join(','));
}
check('at least 5 presets', Object.keys(def.presets || {}).length >= 5, String(Object.keys(def.presets || {}).length));

console.log(fails ? `\n${fails} FAILED` : '\ncompressor: all checks passed');
process.exit(fails ? 1 : 0);
