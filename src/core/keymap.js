// Central keymap. Every keyboard shortcut and every modifier-gesture in the
// app is an ACTION name; schemes bind keys/modifiers to actions. UI code asks
// `keymap.action(e)` for a key event or `keymap.gesture(name, e)` for a
// pointer modifier and never inspects e.code / e.shiftKey itself.
//
// Schemes are plain data so a user (or another DAW's conventions) can
// override any binding: `keymap.use('ableton')`, `keymap.bind('clip.split','KeyE')`.
// The active scheme + overrides persist in localStorage.
//
// Binding syntax: "Mod+Shift+KeyS" -- tokens are Mod (⌘ on mac / Ctrl else),
// Ctrl, Alt, Shift, then a KeyboardEvent.code. Several bindings per action
// are allowed (array). Gesture bindings name a modifier set: "Shift", "Alt",
// "Mod", "Alt+Shift", or "" for plain.

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');

// Actions the app dispatches. Keep this list the single source of truth;
// the settings UI (later) renders it.
export const ACTIONS = {
  'transport.toggle':      { label: 'Play / stop', scope: 'global' },
  'transport.stop':        { label: 'Stop', scope: 'global' },
  'transport.toStart':     { label: 'Go to start', scope: 'global' },
  'transport.playRange':   { label: 'Play from range start', scope: 'timeline' },
  'project.save':          { label: 'Save project', scope: 'global' },
  'edit.undo':             { label: 'Undo', scope: 'global' },
  'edit.redo':             { label: 'Redo', scope: 'global' },
  'clip.split':            { label: 'Split at playhead / range', scope: 'timeline' },
  'clip.delete':           { label: 'Delete clip / range slice', scope: 'timeline' },
  'clip.pitchUp':          { label: 'Pitch +1 st', scope: 'timeline' },
  'clip.pitchDown':        { label: 'Pitch −1 st', scope: 'timeline' },
  'clip.gainUp':           { label: 'Clip gain +1 dB', scope: 'timeline' },
  'clip.gainDown':         { label: 'Clip gain −1 dB', scope: 'timeline' },
  'range.clear':           { label: 'Clear range', scope: 'timeline' },
  'snap.toggle':           { label: 'Toggle snap', scope: 'timeline' },
  'view.fit':              { label: 'Fit song to width', scope: 'timeline' },
  'view.zoomIn':           { label: 'Zoom in', scope: 'timeline' },
  'view.zoomOut':          { label: 'Zoom out', scope: 'timeline' },
  'view.follow':           { label: 'Follow playhead', scope: 'timeline' },
  'view.lyrics':           { label: 'Toggle lyrics bar', scope: 'timeline' },
  'slot.1': { label: 'Slot A', scope: 'pattern' }, 'slot.2': { label: 'Slot B', scope: 'pattern' },
  'slot.3': { label: 'Slot C', scope: 'pattern' }, 'slot.4': { label: 'Slot D', scope: 'pattern' },
  'keys.octaveDown':       { label: 'Keyboard octave −', scope: 'keys' },
  'keys.octaveUp':         { label: 'Keyboard octave +', scope: 'keys' },
  'notes.selectAll':       { label: 'Select all notes', scope: 'pianoroll' },
  'notes.delete':          { label: 'Delete notes', scope: 'pianoroll' },
};

// Pointer gestures: which modifier turns a plain drag into which variant.
export const GESTURES = {
  'timeline.rangeSelect':  { label: 'Ruler drag → select range' },
  'timeline.clipSlip':     { label: 'Clip drag → slip content' },
  'timeline.clipStretch':  { label: 'Right-edge drag → time-stretch' },
  'timeline.noSnap':       { label: 'Hold while dragging → bypass snap' },
  'timeline.zoom':         { label: 'Wheel → zoom' },
  'pianoroll.addToSel':    { label: 'Click note → add to selection' },
  'pianoroll.marquee':     { label: 'Drag empty → marquee select' },
  'pianoroll.velocity':    { label: 'Drag note → velocity' },
  'pianoroll.zoom':        { label: 'Wheel → zoom' },
};

export const SCHEMES = {
  oscine: {
    label: 'Oscine (default)',
    keys: {
      'transport.toggle': 'Space',
      'transport.stop': 'Escape',
      'transport.toStart': 'Home',
      'transport.playRange': 'Shift+Space',
      'project.save': 'Mod+KeyS',
      'edit.undo': 'Mod+KeyZ',
      'edit.redo': ['Mod+Shift+KeyZ', 'Mod+KeyY'],
      'clip.split': 'KeyS',
      'clip.delete': ['Backspace', 'Delete'],
      'clip.pitchUp': 'BracketRight',
      'clip.pitchDown': 'BracketLeft',
      'clip.gainUp': 'Shift+BracketRight',
      'clip.gainDown': 'Shift+BracketLeft',
      'range.clear': 'Escape',
      'snap.toggle': 'KeyN',
      'view.fit': 'KeyF',
      'view.zoomIn': 'Equal',
      'view.zoomOut': 'Minus',
      'view.follow': 'KeyL',
      'view.lyrics': 'Shift+KeyL',
      'slot.1': 'Digit1', 'slot.2': 'Digit2', 'slot.3': 'Digit3', 'slot.4': 'Digit4',
      'keys.octaveDown': 'KeyZ', 'keys.octaveUp': 'KeyX',
      'notes.selectAll': 'Mod+KeyA',
      'notes.delete': ['Backspace', 'Delete'],
    },
    gestures: {
      'timeline.rangeSelect': 'Shift',
      'timeline.clipSlip': 'Shift',
      'timeline.clipStretch': 'Alt',
      'timeline.noSnap': 'Mod',
      'timeline.zoom': 'Mod',
      'pianoroll.addToSel': 'Shift',
      'pianoroll.marquee': 'Shift',
      'pianoroll.velocity': 'Alt',
      'pianoroll.zoom': 'Mod',
    },
  },
  // Conventions borrowed from other DAWs. Only the bindings that differ.
  ableton: {
    label: 'Ableton Live',
    extends: 'oscine',
    keys: { 'clip.split': 'Mod+KeyE', 'transport.stop': 'Space', 'transport.toStart': 'Home' },
    gestures: { 'timeline.clipSlip': 'Mod', 'timeline.clipStretch': 'Shift' },
  },
  logic: {
    label: 'Logic Pro',
    extends: 'oscine',
    keys: { 'clip.split': 'Mod+KeyT', 'transport.toStart': 'Enter', 'transport.stop': 'Digit0' },
    gestures: { 'timeline.clipSlip': 'Mod+Alt', 'timeline.clipStretch': 'Alt' },
  },
  reaper: {
    label: 'REAPER',
    extends: 'oscine',
    keys: { 'clip.split': 'KeyS', 'transport.toStart': 'KeyW', 'transport.stop': 'Space' },
    gestures: { 'timeline.clipSlip': 'Alt', 'timeline.clipStretch': 'Alt+Shift' },
  },
};

const STORE_KEY = 'oscine.keymap';

function parseBinding(s) {
  const parts = s.split('+');
  const code = parts.pop();
  const mods = new Set(parts);
  return { code, mod: mods.has('Mod'), ctrl: mods.has('Ctrl'), alt: mods.has('Alt'), shift: mods.has('Shift') };
}
function eventMatches(e, b) {
  if (e.code !== b.code) return false;
  const modKey = IS_MAC ? e.metaKey : e.ctrlKey;
  const otherKey = IS_MAC ? e.ctrlKey : e.metaKey;
  return modKey === b.mod && (b.ctrl ? e.ctrlKey : !otherKey || b.mod) && e.altKey === b.alt && e.shiftKey === b.shift;
}
function modsMatch(e, spec) {
  const want = new Set(spec ? spec.split('+') : []);
  const modKey = IS_MAC ? e.metaKey : e.ctrlKey;
  return modKey === want.has('Mod') && e.altKey === want.has('Alt') && e.shiftKey === want.has('Shift');
}

export class Keymap {
  constructor() {
    this.scheme = 'oscine';
    this.overrides = { keys: {}, gestures: {} };
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (saved?.scheme && SCHEMES[saved.scheme]) this.scheme = saved.scheme;
      if (saved?.overrides) this.overrides = { keys: {}, gestures: {}, ...saved.overrides };
    } catch {}
    this._compile();
  }

  // Resolve scheme inheritance + overrides into flat tables.
  _compile() {
    const chain = [];
    for (let s = SCHEMES[this.scheme]; s; s = s.extends ? SCHEMES[s.extends] : null) chain.unshift(s);
    const keys = {}, gestures = {};
    for (const s of chain) { Object.assign(keys, s.keys || {}); Object.assign(gestures, s.gestures || {}); }
    Object.assign(keys, this.overrides.keys); Object.assign(gestures, this.overrides.gestures);
    this.keys = keys; this.gestures = gestures;
    // action -> [parsed bindings]
    this.parsed = new Map();
    for (const [action, b] of Object.entries(keys)) {
      this.parsed.set(action, (Array.isArray(b) ? b : [b]).map(parseBinding));
    }
  }

  use(scheme) { if (!SCHEMES[scheme]) throw new Error(`no scheme ${scheme}`); this.scheme = scheme; this._compile(); this._save(); }
  bind(action, binding) { this.overrides.keys[action] = binding; this._compile(); this._save(); }
  bindGesture(name, mods) { this.overrides.gestures[name] = mods; this._compile(); this._save(); }
  reset() { this.overrides = { keys: {}, gestures: {} }; this._compile(); this._save(); }
  _save() { try { localStorage.setItem(STORE_KEY, JSON.stringify({ scheme: this.scheme, overrides: this.overrides })); } catch {} }

  // First action (in `scopes` order, then any) whose binding matches the event.
  // Scopes let the same key mean different things by context (S = split on
  // the timeline; nothing in the piano roll).
  action(e, scopes = null) {
    const candidates = [];
    for (const [action, bindings] of this.parsed) {
      if (bindings.some(b => eventMatches(e, b))) candidates.push(action);
    }
    if (!candidates.length) return null;
    if (!scopes) return candidates[0];
    for (const scope of scopes) {
      const hit = candidates.find(a => ACTIONS[a]?.scope === scope);
      if (hit) return hit;
    }
    return candidates.find(a => ACTIONS[a]?.scope === 'global') ?? null;
  }

  // Is the pointer event carrying the modifiers this gesture wants?
  gesture(name, e) { return modsMatch(e, this.gestures[name] ?? ''); }

  // For pickers/tooltips.
  schemes() { return Object.entries(SCHEMES).map(([id, s]) => ({ id, label: s.label })); }
  actionLabel(action) { return ACTIONS[action]?.label ?? action; }

  // Human label for a binding, for tooltips/menus: "⌘S", "⇧⌫".
  label(action) {
    const b = this.keys[action]; if (!b) return '';
    const s = Array.isArray(b) ? b[0] : b;
    return s.replace('Mod+', IS_MAC ? '⌘' : 'Ctrl+').replace('Shift+', '⇧').replace('Alt+', IS_MAC ? '⌥' : 'Alt+').replace('Ctrl+', '⌃')
      .replace(/^Key/, '').replace(/Key([A-Z])$/, '$1').replace('Digit', '').replace('BracketLeft', '[').replace('BracketRight', ']').replace('Equal', '=').replace('Minus', '−')
      .replace('Backspace', '⌫').replace('Delete', '⌦').replace('Space', '␣').replace('Escape', 'esc');
  }
}

export const keymap = new Keymap();
