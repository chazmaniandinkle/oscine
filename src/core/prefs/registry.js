// Preference registry: the extension point for app-level settings, mirroring
// engine/effects/registry.js and core/keymap.js's ACTIONS. Anything registered
// here auto-appears in the settings panel, in the `settings` catalog command
// (so MCP/OSC/console see it), and in `prefs.all()`.
//
// A pref is "how I like to work", never song data: it is not in the
// .oscine.json, not checkpointed, not undoable, and it survives reloads in
// localStorage. Project state (bpm, lanes, clips) belongs in the store.
//
// A pref definition:
//   {
//     key:     'snap.grid',              unique id, stored in localStorage
//     type:    'boolean'|'number'|'string',
//     default: 0.25,                     must itself validate
//     section: 'editing',                a defineSection() id
//     label:   'Grid',                   shown in the panel
//     help:    'one sentence…',          shown under the label
//     options?: [{value,label}] | () => [{value,label}]   (a closed set)
//     min?, max?, step?, suffix?         (numbers)
//     order?:  number                    sort within the section
//   }
//
// Register at import time from the module that owns the behaviour, then read
// with prefs.get(key) and change with prefs.set(key, value) — never write
// localStorage directly and never add a parallel persisted store.ui field.

const defs = new Map();
const sections = new Map();

export function defineSection(def) {
  if (!def?.id || !def.label) throw new Error('pref section needs id + label');
  if (sections.has(def.id)) throw new Error(`pref section '${def.id}' already registered`);
  sections.set(def.id, { order: sections.size, ...def });
  return def.id;
}

export function definePref(def) {
  if (!def?.key) throw new Error('pref needs a key');
  if (defs.has(def.key)) throw new Error(`pref '${def.key}' already registered`);
  if (!['boolean', 'number', 'string'].includes(def.type)) throw new Error(`pref '${def.key}' needs type boolean|number|string`);
  if (def.default === undefined) throw new Error(`pref '${def.key}' needs a default`);
  if (!def.label || !def.help) throw new Error(`pref '${def.key}' needs label + help`);
  if (!sections.has(def.section)) throw new Error(`pref '${def.key}' names unknown section '${def.section}'`);
  const d = { order: defs.size, ...def };
  defs.set(def.key, d);
  // A default that fails its own spec is a typo; fail loudly at import time
  // (the same contract as defineEffect requiring klass + params).
  try { coerce(d, d.default); } catch (e) { defs.delete(def.key); throw new Error(`pref '${def.key}' default is invalid: ${e.message}`); }
  return def.key;
}

export function getPrefDef(key) {
  const d = defs.get(key);
  if (!d) throw new Error(`unknown setting '${key}'. Known: ${[...defs.keys()].join(', ')}`);
  return d;
}
export function listPrefDefs() {
  return [...defs.values()].sort((a, b) => (sections.get(a.section).order - sections.get(b.section).order) || (a.order - b.order));
}
export function listSections() {
  return [...sections.values()].sort((a, b) => a.order - b.order).filter(s => [...defs.values()].some(d => d.section === s.id));
}
export function prefOptions(def) {
  const o = typeof def.options === 'function' ? def.options() : def.options;
  return o ?? null;
}

// Validate + coerce one value against a def. Throws with a message that names
// what was allowed (it is surfaced verbatim over MCP).
function coerce(d, value) {
  let v = value;
  if (d.type === 'boolean') {
    if (v === 'true' || v === 1) v = true; else if (v === 'false' || v === 0) v = false;
    if (typeof v !== 'boolean') throw new Error(`${d.key} must be true or false`);
  } else if (d.type === 'number') {
    v = Number(v);
    if (!Number.isFinite(v)) throw new Error(`${d.key} must be a number`);
    if (d.min != null && v < d.min) throw new Error(`${d.key} must be ≥ ${d.min}`);
    if (d.max != null && v > d.max) throw new Error(`${d.key} must be ≤ ${d.max}`);
  } else {
    v = String(v);
  }
  const opts = prefOptions(d);
  if (opts && !opts.some(o => o.value === v)) throw new Error(`${d.key} must be one of: ${opts.map(o => o.value).join(', ')}`);
  return v;
}

function storage() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

export const PREFS_KEY = 'oscine.prefs';

export class Prefs {
  constructor(storeKey = PREFS_KEY) {
    this.storeKey = storeKey;
    this.listeners = new Set();
    // Raw, unvalidated: a pref registered AFTER load still finds its stored
    // value (registration order must not silently drop a user's setting).
    this.raw = {};
    const ls = storage();
    if (ls) { try { Object.assign(this.raw, JSON.parse(ls.getItem(storeKey) || '{}')); } catch {} }
  }

  get values() { return this.raw; } // legacy read-only view

  get(key) {
    const d = getPrefDef(key);
    if (!(key in this.raw)) return d.default;
    try { return coerce(d, this.raw[key]); } catch { return d.default; } // stale/bad stored value
  }

  check(key, value) { return coerce(getPrefDef(key), value); }

  set(key, value) {
    const d = getPrefDef(key);
    const v = coerce(d, value);
    const old = this.get(key);
    if (v === d.default) delete this.raw[key]; else this.raw[key] = v;
    this._save();
    if (old !== v) this._emit(key, v, old);
    return v;
  }

  reset(key = null) {
    for (const d of key ? [getPrefDef(key)] : listPrefDefs()) {
      const old = this.get(d.key);
      delete this.raw[d.key];
      if (old !== d.default) this._emit(d.key, d.default, old);
    }
    this._save();
  }

  // One pref with its metadata: what the panel renders and `settings get` returns.
  describe(key) {
    const d = getPrefDef(key), opts = prefOptions(d);
    return {
      key: d.key, value: this.get(key), default: d.default, type: d.type, section: d.section,
      label: d.label, help: d.help,
      ...(opts ? { options: opts.map(o => o.value) } : {}),
      ...(d.min != null ? { min: d.min } : {}), ...(d.max != null ? { max: d.max } : {}),
    };
  }
  all() { return listPrefDefs().map(d => this.describe(d.key)); }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit(key, v, old) { for (const fn of this.listeners) { try { fn(key, v, old); } catch {} } }
  _save() { const ls = storage(); if (ls) { try { ls.setItem(this.storeKey, JSON.stringify(this.raw)); } catch {} } }
}

export const prefs = new Prefs();
