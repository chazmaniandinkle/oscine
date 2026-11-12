// Helpers for writing controller profiles. A profile is plain data (JSON-able except `match`):
//
//   { id, name, maker, match: RegExp, verified, source, segments: [segment] }
//   segment = { id, kind: 'keys'|'knobs'|'faders'|'pads'|'buttons'|'encoders'|'stick', label, cols?, range?:[lo,hi] (keys),
//               controls?: [control] }
//   control = { id, label, kind: 'knob'|'fader'|'pad'|'button'|'encoder'|'xy'|'pitchbend'|'modwheel'|'aftertouch'|'key',
//               src?: {t:'cc'|'note'|'pb'|'cp'|'pc', n?, ch?}, rel?: 'twos'|'binoff'|'signmag', role?: string,
//               strip?: number (1-based mixer strip this control sits on, for the default map) }
//
// A control WITHOUT `src` is a slot in the layout whose hardware number isn't known (we only claim what we are
// sure of): the controller wizard fills it from the first matching message. `verified:false` marks a profile
// whose numbers come from a published default program rather than the real device in Chaz's hands.

export const cc = (n, ch) => ({ t: 'cc', n, ...(ch ? { ch } : {}) });
export const note = (n, ch) => ({ t: 'note', n, ...(ch ? { ch } : {}) });

// `count` controls id'd `${prefix}1..`; srcOf(i) gives each one's source (omit for unassigned slots).
export function many(prefix, kind, count, srcOf, extra = {}) {
  return Array.from({ length: count }, (_, i) => {
    const s = srcOf ? srcOf(i) : undefined;
    return {
      id: `${prefix}${i + 1}`, label: `${extra.labelPrefix ?? prefix.toUpperCase()}${i + 1}`, kind,
      ...(s ? { src: s } : {}),
      ...(extra.strip ? { strip: i + 1 } : {}),
      ...(extra.rel ? { rel: extra.rel } : {}),
      ...(extra.role ? { role: extra.role } : {}),
    };
  });
}

export const keysSeg = (lo, hi, extra = {}) => ({ id: 'keys', kind: 'keys', label: 'Keys', range: [lo, hi], ...extra });
export const seg = (id, kind, label, controls, extra = {}) => ({ id, kind, label, controls, ...extra });

export const pitchMod = (extra = {}) => seg('stick', 'stick', 'Pitch / Mod', [
  { id: 'pb', label: 'Pitch', kind: 'pitchbend', src: { t: 'pb' } },
  { id: 'mod', label: 'Mod', kind: 'modwheel', src: cc(1) },
], extra);
