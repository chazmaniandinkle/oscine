// User preferences: one typed schema, persisted to localStorage, shared by
// the settings panel, the `settings` catalog command (MCP/OSC/console), and
// the code that reads them. No DOM, no audio: importable from node (tests).
//
// A pref is app-level ("how I like to work"), never project state: it isn't
// in the .oscine.json, isn't checkpointed, and survives reloads. Project
// state (bpm, lanes, clips) stays in the store.
//
// To add one: add an entry to PREFS (key, type, default, label, section,
// help, and options/min/max), then read it with prefs.get(key). The panel
// and the command pick it up automatically.

export const PREFS_KEY = 'oscine.prefs';

export const SECTIONS = [
  { id: 'editing', label: 'Editing' },
  { id: 'view', label: 'View' },
  { id: 'keys', label: 'Keyboard' },
  { id: 'transcription', label: 'Transcription' },
];

export const PREFS = {
  'snap.on': {
    type: 'boolean', default: true, section: 'editing', label: 'Snap',
    help: 'Drags and ranges snap. N toggles it; hold ⌘ while dragging to bypass it once.',
  },
  'snap.grid': {
    type: 'number', default: 0.25, section: 'editing', label: 'Grid',
    options: [{ value: 0, label: 'Off' }, { value: 0.25, label: '1/16' }, { value: 0.5, label: '1/8' }, { value: 1, label: 'Beat' }, { value: 4, label: 'Bar' }],
    help: 'With a grid picked, drags and range ends land on it; clip edges, the playhead and range edges still attract within the snap distance. Off turns snapping off entirely.',
  },
  'snap.distancePx': {
    type: 'number', default: 8, min: 2, max: 30, step: 1, section: 'editing', label: 'Snap distance', suffix: ' px',
    help: 'How close (in screen pixels) a clip edge, the playhead or a range edge must be to catch a drag. Wins over the grid.',
  },
  'view.follow': {
    type: 'boolean', default: true, section: 'view', label: 'Follow playhead',
    help: 'The timeline pages along during playback. L toggles it.',
  },
  'view.lyrics': {
    type: 'boolean', default: true, section: 'view', label: 'Lyrics bar',
    help: 'Words of one lane under the timeline; click a word to jump. ⇧L toggles it.',
  },
  'keys.scheme': {
    type: 'string', default: 'oscine', section: 'keys', label: 'Key scheme',
    options: null, // filled from the keymap at runtime (setOptions)
    help: "Shortcuts and drag modifiers from another DAW's conventions. Each binding cites the manual page it came from.",
  },
  'transcribe.model': {
    type: 'string', default: 'small', section: 'transcription', label: 'Whisper model',
    options: ['tiny', 'base', 'small', 'medium', 'large-v3', 'turbo'].map(v => ({ value: v, label: v })),
    help: 'Model the sidecar uses for Transcribe. Bigger is slower and more accurate on sung vocals. A model not yet on disk downloads on first use (medium ≈1.5 GB, large-v3 ≈3 GB). Results are cached per model.',
  },
};

function storage() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

export class Prefs {
  constructor() {
    this.values = {};
    this.listeners = new Set();
    const ls = storage();
    if (ls) { try { Object.assign(this.values, JSON.parse(ls.getItem(PREFS_KEY) || '{}')); } catch {} }
    // Drop anything that no longer validates (renamed/removed prefs, bad data).
    for (const k of Object.keys(this.values)) { try { this.values[k] = this.check(k, this.values[k]); } catch { delete this.values[k]; } }
  }

  // Runtime-only option lists (e.g. key schemes come from the keymap module).
  setOptions(key, options) { if (PREFS[key]) PREFS[key].options = options; }

  get(key) {
    if (!PREFS[key]) throw new Error(`unknown setting '${key}'. Known: ${Object.keys(PREFS).join(', ')}`);
    return key in this.values ? this.values[key] : PREFS[key].default;
  }

  // Validate and coerce; throws with a useful message (surfaced over MCP).
  check(key, value) {
    const d = PREFS[key];
    if (!d) throw new Error(`unknown setting '${key}'. Known: ${Object.keys(PREFS).join(', ')}`);
    let v = value;
    if (d.type === 'boolean') {
      if (v === 'true' || v === 1) v = true; else if (v === 'false' || v === 0) v = false;
      if (typeof v !== 'boolean') throw new Error(`${key} must be true or false`);
    } else if (d.type === 'number') {
      v = Number(v);
      if (!Number.isFinite(v)) throw new Error(`${key} must be a number`);
      if (d.min != null && v < d.min) throw new Error(`${key} must be ≥ ${d.min}`);
      if (d.max != null && v > d.max) throw new Error(`${key} must be ≤ ${d.max}`);
    } else if (d.type === 'string') {
      v = String(v);
    }
    if (d.options && !d.options.some(o => o.value === v)) {
      throw new Error(`${key} must be one of: ${d.options.map(o => o.value).join(', ')}`);
    }
    return v;
  }

  set(key, value) {
    const v = this.check(key, value);
    const old = this.get(key);
    if (v === PREFS[key].default) delete this.values[key]; else this.values[key] = v;
    this._save();
    if (old !== v) for (const fn of this.listeners) fn(key, v, old);
    return v;
  }

  reset(key = null) {
    const keys = key ? [key] : Object.keys(PREFS);
    for (const k of keys) {
      if (!PREFS[k]) throw new Error(`unknown setting '${k}'`);
      const old = this.get(k);
      delete this.values[k];
      if (old !== PREFS[k].default) for (const fn of this.listeners) fn(k, PREFS[k].default, old);
    }
    this._save();
  }

  // Everything, with metadata: what the panel and `settings get` return.
  all() {
    return Object.entries(PREFS).map(([key, d]) => ({
      key, value: this.get(key), default: d.default, type: d.type, section: d.section,
      label: d.label, help: d.help, ...(d.options ? { options: d.options.map(o => o.value) } : {}),
      ...(d.min != null ? { min: d.min, max: d.max } : {}),
    }));
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  _save() { const ls = storage(); if (ls) { try { ls.setItem(PREFS_KEY, JSON.stringify(this.values)); } catch {} } }
}

export const prefs = new Prefs();
