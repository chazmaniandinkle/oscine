// Instrument registry: the extension point for new sound sources.
//
// An instrument definition:
//   {
//     type:    'poly',                  unique id, stored in project files
//     label:   'Poly Synth',            shown in the Add Track menu
//     kind:    'synth' | 'drums',       picks the editor (piano roll vs step grid)
//     klass:   class extending BaseInstrument
//     params:  [ { key, label, type:'knob'|'select', min, max, default,
//                  curve?, unit?, step?, options?, group } ]
//     presets: { 'Name': { partial param overrides } }
//     lanes?:  [ { id, label } ]        drum kits only: step grid rows
//   }
//
// Register with defineInstrument(def) at module load. Anything registered
// here automatically appears in the UI: the Add menu, the inspector
// (rendered from `params`), and the preset picker.

const defs = new Map();

export function defineInstrument(def) {
  if (defs.has(def.type)) throw new Error(`instrument type '${def.type}' already registered`);
  defs.set(def.type, def);
}

export function getInstrumentDef(type) {
  const d = defs.get(type);
  if (!d) throw new Error(`unknown instrument type '${type}'`);
  return d;
}

export function listInstrumentDefs() {
  return [...defs.values()];
}

export function defaultParams(type) {
  const out = {};
  for (const p of getInstrumentDef(type).params) out[p.key] = p.default;
  return out;
}

export function presetParams(type, presetName) {
  const def = getInstrumentDef(type);
  const overrides = (presetName && def.presets?.[presetName]) || {};
  return { ...defaultParams(type), ...overrides };
}

export function createInstrument(type, ctx, params) {
  const def = getInstrumentDef(type);
  return new def.klass(ctx, { ...defaultParams(type), ...params }, def);
}
