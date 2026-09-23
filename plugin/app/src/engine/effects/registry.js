// Effect registry: the extension point for audio processors, mirroring
// instruments/registry.js so anything registered here auto-appears in the
// UI (insert menu, inspector rendered from `params`, presets).
//
// An effect definition:
//   {
//     type:    'eq3',                    unique id, stored in project files
//     label:   'EQ (3-band)',            shown in the insert menu
//     group:   'dynamics'|'eq'|'time'|'modulation'|'distortion'|'utility',
//     klass:   class extending BaseEffect
//     params:  [ { key, label, type:'knob'|'select', min, max, default,
//                  curve?, unit?, step?, options?, group } ]
//     presets: { 'Name': { partial param overrides } }
//     latencySamples?: number             for PDC later; 0 if unset
//   }
//
// Instances are stateless with respect to the project: the host owns the
// param values (in the project file) and pushes them in with setParam.
// Effects must be safe to construct on an OfflineAudioContext (renders).

const defs = new Map();

export function defineEffect(def) {
  if (defs.has(def.type)) throw new Error(`effect type '${def.type}' already registered`);
  if (!def.klass || !Array.isArray(def.params)) throw new Error(`effect '${def.type}' needs klass + params`);
  defs.set(def.type, def);
}
export function getEffectDef(type) {
  const d = defs.get(type);
  if (!d) throw new Error(`unknown effect type '${type}'`);
  return d;
}
export function listEffectDefs() { return [...defs.values()]; }
export function defaultEffectParams(type) {
  const out = {};
  for (const p of getEffectDef(type).params) out[p.key] = p.default;
  return out;
}
export function createEffect(type, ctx, params = {}) {
  const def = getEffectDef(type);
  return new def.klass(ctx, { ...defaultEffectParams(type), ...params }, def);
}

// Base class. Subclasses build their graph between this.input and
// this.output in the constructor and implement applyParam(key, value).
// `bypass` is handled here: a dry path around the graph, crossfaded so
// toggling is click-free.
export class BaseEffect {
  constructor(ctx, params, def) {
    this.ctx = ctx;
    this.def = def;
    this.params = { ...params };
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.wetIn = ctx.createGain();   // subclasses connect: this.wetIn -> graph -> this.wetOut
    this.wetOut = ctx.createGain();
    this.dryGain = ctx.createGain();
    this.dryGain.gain.value = 0;
    this.input.connect(this.wetIn);
    this.wetOut.connect(this.output);
    this.input.connect(this.dryGain);
    this.dryGain.connect(this.output);
    this._bypassed = false;
  }
  // Called once after the constructor has built the graph.
  applyAll() { for (const [k, v] of Object.entries(this.params)) this.applyParam(k, v); }
  setParam(key, value) {
    this.params[key] = value;
    this.applyParam(key, value);
  }
  applyParam(_key, _value) { /* subclass */ }
  // Optional: return a live AudioParam for a param key, letting automation
  // schedule directly onto it (sample-accurate, no polling). Subclasses
  // that back a param with a native AudioParam (e.g. eq3's BiquadFilterNode
  // frequency/gain/Q) should override this; default is "no fast path".
  paramNode(_key) { return null; }
  get bypassed() { return this._bypassed; }
  set bypassed(b) {
    b = !!b;
    if (b === this._bypassed) return;
    this._bypassed = b;
    const t = this.ctx.currentTime, r = 0.02;
    this.wetOut.gain.cancelScheduledValues(t);
    this.dryGain.gain.cancelScheduledValues(t);
    this.wetOut.gain.setTargetAtTime(b ? 0 : 1, t, r / 4);
    this.dryGain.gain.setTargetAtTime(b ? 1 : 0, t, r / 4);
  }
  dispose() {
    for (const n of [this.input, this.output, this.wetIn, this.wetOut, this.dryGain]) { try { n.disconnect(); } catch {} }
  }
}

// An insert chain: an ordered list of effect instances wired in series
// between `input` and `output`. Rewires on any change; safe to call
// repeatedly. Project-side representation is [{type, params, bypass}].
export class InsertChain {
  constructor(ctx) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.effects = []; // BaseEffect[]
    this._wire();
  }
  _wire() {
    try { this.input.disconnect(); } catch {}
    for (const fx of this.effects) { try { fx.output.disconnect(); } catch {} }
    let prev = this.input;
    for (const fx of this.effects) { prev.connect(fx.input); prev = fx.output; }
    prev.connect(this.output);
  }
  // Replace the chain from a project-side description. Reuses instances
  // whose type matches at the same index (so knob tweaks don't rebuild).
  sync(specs = []) {
    const next = [];
    for (let i = 0; i < specs.length; i++) {
      const s = specs[i];
      let fx = this.effects[i];
      if (!fx || fx.def.type !== s.type) {
        if (fx) fx.dispose();
        fx = createEffect(s.type, this.ctx, s.params);
        fx.applyAll();
      } else {
        for (const [k, v] of Object.entries(s.params || {})) if (fx.params[k] !== v) fx.setParam(k, v);
      }
      fx.bypassed = !!s.bypass;
      next.push(fx);
    }
    for (let i = specs.length; i < this.effects.length; i++) this.effects[i].dispose();
    this.effects = next;
    this._wire();
  }
  dispose() { for (const fx of this.effects) fx.dispose(); try { this.input.disconnect(); this.output.disconnect(); } catch {} }
}
