// MIDI sources: how a hardware message is named, so a binding can point at it.
// Pure (node-testable, no DOM). The binding map (store.ui.midi.knobs) is keyed by
// these strings and its VALUES are targets (src/core/midimap.js).
//
// Source key grammar (the legacy "CC number" key stays valid, so every map saved
// before the control-surface work still loads):
//   "74"      controller 74, any channel          (legacy form)
//   "74@2"    controller 74 on channel 2 only
//   "n36"     note 36 (pad / key / button), any channel;  "n36@10" on channel 10
//   "pb"      pitch bend      "cp" channel pressure      "pc5" program change 5
// A message looks its binding up with the channel-specific key first, then the bare one.

export const isSrcKey = (k) => typeof k === 'string' && /^(\d{1,3}|n\d{1,3}|pc\d{1,3}|pb|cp)(@\d{1,2})?$/.test(k);

// src: { t:'cc'|'note'|'pb'|'cp'|'pc', n?, ch? (1..16) }
export function srcKey(src) {
  const at = src.ch ? `@${src.ch}` : '';
  switch (src.t) {
    case 'cc': return `${src.n}${at}`;
    case 'note': return `n${src.n}${at}`;
    case 'pc': return `pc${src.n}${at}`;
    case 'pb': return `pb${at}`;
    case 'cp': return `cp${at}`;
    default: throw new Error(`unknown source type ${src.t}`);
  }
}

export function parseSrcKey(key) {
  const m = /^(?:(\d{1,3})|n(\d{1,3})|pc(\d{1,3})|(pb)|(cp))(?:@(\d{1,2}))?$/.exec(String(key));
  if (!m) return null;
  const ch = m[6] ? Number(m[6]) : undefined;
  if (m[1] != null) return { t: 'cc', n: Number(m[1]), ch };
  if (m[2] != null) return { t: 'note', n: Number(m[2]), ch };
  if (m[3] != null) return { t: 'pc', n: Number(m[3]), ch };
  return { t: m[4] ? 'pb' : 'cp', ch };
}

// The keys a message can be bound under, most specific first.
export const lookupKeys = (msg) => {
  const base = srcKey({ t: msg.t, n: msg.n });
  return [`${base}@${msg.ch}`, base];
};

// Raw bytes -> { t, n, ch, v, on?, v14? } or null for system/realtime/poly-pressure noise.
// v is the 0..127 data value (14-bit pitch bend gets v14 as well and v = v14 >> 7).
export function decodeMessage(bytes) {
  const [status, d1 = 0, d2 = 0] = bytes;
  if (status < 0x80 || status >= 0xf0) return null;
  const type = status & 0xf0;
  const ch = (status & 0x0f) + 1;
  switch (type) {
    case 0x90: return d2 > 0 ? { t: 'note', n: d1, ch, v: d2, on: true } : { t: 'note', n: d1, ch, v: 0, on: false };
    case 0x80: return { t: 'note', n: d1, ch, v: 0, on: false };
    case 0xb0: return { t: 'cc', n: d1, ch, v: d2 };
    case 0xe0: { const v14 = (d2 << 7) | d1; return { t: 'pb', n: 0, ch, v: v14 >> 7, v14 }; }
    case 0xd0: return { t: 'cp', n: 0, ch, v: d1 };
    case 0xc0: return { t: 'pc', n: d1, ch, v: 127, on: true };
    default: return null;                       // 0xA0 poly pressure: not a control surface input
  }
}

// 0..1 for any decoded message.
export const normOf = (msg) => (msg.t === 'pb' ? msg.v14 / 16383 : msg.v / 127);

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (m) => NOTE_NAMES[m % 12] + (Math.floor(m / 12) - 1);

// Short human label: "CC74", "Note C2", "Pitch bend", "Pressure", "Prog 5" (+ " ch10").
export function srcLabel(src) {
  const s = typeof src === 'string' ? parseSrcKey(src) : src;
  if (!s) return String(src);
  const ch = s.ch ? ` ch${s.ch}` : '';
  switch (s.t) {
    case 'cc': return s.n === 1 ? `Mod (CC1)${ch}` : `CC${s.n}${ch}`;
    case 'note': return `Note ${noteName(s.n)}${ch}`;
    case 'pc': return `Prog ${s.n}${ch}`;
    case 'pb': return `Pitch bend${ch}`;
    case 'cp': return `Pressure${ch}`;
    default: return String(src);
  }
}

// -- relative encoders ---------------------------------------------------------------------------------------
// An endless encoder sends a signed step per detent instead of a position. Three encodings exist in the wild:
//   twos    1..63 = +n, 127..65 = -n (127 = -1)             e.g. Mackie-ish, many Korg/Behringer
//   binoff  64 = 0, 65.. = +n, ..63 = -n (65 = +1, 63 = -1) e.g. Arturia "relative 1", Ableton relative
//   signmag 1..63 = +n, 65..127 = -(v-64) (65 = -1)         e.g. Arturia "relative 2", Mackie jog
export const REL_ENCODINGS = ['twos', 'binoff', 'signmag'];
export function decodeRel(enc, v) {
  switch (enc) {
    case 'twos': return v < 64 ? v : v - 128;
    case 'binoff': return v - 64;
    case 'signmag': return v < 64 ? v : -(v - 64);
    default: return 0;
  }
}
