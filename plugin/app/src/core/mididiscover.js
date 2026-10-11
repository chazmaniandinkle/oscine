// Discovery for unknown controllers ("map my controller"). Feed it every raw message while Chaz wiggles things; it
// keeps one record per distinct (type, number, channel) source, infers what each physical control is from how its
// values behave, and builds a profile he can name. Pure, no DOM: node-testable with synthetic message streams.
//
// Inference (all from the values a source sent, never from the CC number except the standard wheel/pedal ones):
//   note on/off                    -> pad (ch10, or few distinct notes) | key (>=8 distinct notes on one channel)
//   CC that only ever sent 0 / 127 -> button (momentary or toggle)
//   CC in a tight band around 64   -> encoder, 'binoff'  (63/65: 65 = +1)
//   CC of 1..16 + 112..127         -> encoder, 'twos'    (1 = +1, 127 = -1)
//   CC of 1..16 + 65..80           -> encoder, 'signmag' (65 = -1)
//   CC that swept many values      -> knob (a fader looks the same on the wire; the surface lets him flip it)
//   pitch bend / pressure / prog   -> pitchbend / aftertouch / button
//   CC1 -> modwheel, CC64/66/67/69 two-valued -> pedal button
import { decodeMessage, srcKey, parseSrcKey, srcLabel, REL_ENCODINGS } from './midisrc.js';

export class Discovery {
  constructor() { this.seen = new Map(); this.total = 0; }

  reset() { this.seen.clear(); this.total = 0; }

  // bytes: raw MIDI. Returns the decoded message (or null for ignored traffic) so callers can echo it live.
  feed(bytes, t = Date.now()) {
    const m = decodeMessage(bytes);
    if (!m) return null;
    if (m.t === 'note' && m.on === false) {          // note-off: counts toward the source but is not a "value"
      const r = this._rec(m); r.offs++; r.last = t; return m;
    }
    const r = this._rec(m);
    r.count++; r.last = t; this.total++;
    const v = m.t === 'pb' ? m.v14 >> 7 : m.v;
    r.vals.set(v, (r.vals.get(v) || 0) + 1);
    if (r.prev != null && Math.abs(v - r.prev) > 0) { r.steps++; r.maxStep = Math.max(r.maxStep, Math.abs(v - r.prev)); }
    r.prev = v;
    return m;
  }

  _rec(m) {
    const key = srcKey({ t: m.t, n: m.n, ch: m.ch });
    let r = this.seen.get(key);
    if (!r) {
      r = { key, t: m.t, n: m.n, ch: m.ch, count: 0, offs: 0, vals: new Map(), prev: null, steps: 0, maxStep: 0, first: this.seen.size, last: 0 };
      this.seen.set(key, r);
    }
    return r;
  }

  // The inferred kind of every source seen, with a confidence hint ('sure' | 'guess').
  report() {
    const notesByCh = new Map();
    for (const r of this.seen.values()) if (r.t === 'note') notesByCh.set(r.ch, (notesByCh.get(r.ch) || 0) + 1);
    return [...this.seen.values()].map((r) => ({ ...inferKind(r, notesByCh), key: r.key, src: { t: r.t, n: r.n, ch: r.ch }, count: r.count, label: srcLabel({ t: r.t, n: r.n, ch: r.ch }) }));
  }

  // Build a saveable profile from what was seen. Layout: stick, knobs, encoders, faders (none: we cannot tell),
  // buttons, pads (per channel), keys (range per channel). Controls are numbered in the order Chaz touched them
  // within a kind, so K1 is the first knob he wiggled; sorting by number would scramble a surface labelled by hand.
  buildProfile({ name, deviceName, maker = '' }) {
    const rep = this.report();
    const by = (k) => rep.filter((r) => r.kind === k);
    const ctl = (r, prefix, i) => ({ id: `${prefix}${i + 1}`, label: `${prefix.toUpperCase()}${i + 1}`, kind: r.kind, src: r.src, ...(r.rel ? { rel: r.rel } : {}) });
    const segments = [];
    const stick = [...by('pitchbend'), ...by('modwheel'), ...by('aftertouch')].map((r) => ({
      id: r.kind === 'pitchbend' ? 'pb' : r.kind === 'modwheel' ? 'mod' : 'at',
      label: r.kind === 'pitchbend' ? 'Pitch' : r.kind === 'modwheel' ? 'Mod' : 'Pressure', kind: r.kind, src: r.src }));
    if (stick.length) segments.push({ id: 'stick', kind: 'stick', label: 'Pitch / Mod', controls: stick });
    const group = (rows, id, kind, label, prefix, extra = {}) => {
      if (!rows.length) return;
      segments.push({ id, kind, label, controls: rows.map((r, i) => ctl(r, prefix, i)), cols: Math.min(8, Math.max(2, Math.ceil(rows.length / (rows.length > 8 ? 2 : 1)))), ...extra });
    };
    group(by('knob'), 'knobs', 'knobs', 'Knobs', 'k');
    group(by('fader'), 'faders', 'faders', 'Faders', 'f');
    group(by('encoder'), 'encoders', 'encoders', 'Encoders', 'e');
    group(by('button'), 'buttons', 'buttons', 'Buttons', 'b');
    const pads = by('pad').sort((a, b) => a.ch - b.ch || a.src.n - b.src.n);
    group(pads, 'pads', 'pads', 'Pads', 'p', { order: 'mpc' });
    const keys = by('key');
    if (keys.length) {
      const ns = keys.map((r) => r.src.n);
      segments.push({ id: 'keys', kind: 'keys', label: 'Keys', range: [Math.min(...ns), Math.max(...ns)] });
    }
    const id = `custom-${String(name || deviceName).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
    return { id, name: name || deviceName, maker, matchName: deviceName, verified: true, custom: true, source: 'wizard', segments };
  }
}

function inferKind(r, notesByCh) {
  const vals = [...r.vals.keys()];
  const has = (lo, hi) => vals.some((v) => v >= lo && v <= hi);
  const only = (lo, hi) => vals.length > 0 && vals.every((v) => v >= lo && v <= hi);
  if (r.t === 'note') {
    const keyish = (notesByCh.get(r.ch) || 0) >= 8 && r.ch !== 10;
    return { kind: keyish ? 'key' : 'pad', sure: true };
  }
  if (r.t === 'pb') return { kind: 'pitchbend', sure: true };
  if (r.t === 'cp') return { kind: 'aftertouch', sure: true };
  if (r.t === 'pc') return { kind: 'button', sure: true };
  // CC
  const twoState = vals.length > 0 && vals.every((v) => v === 0 || v === 127);
  if (twoState) return { kind: 'button', sure: r.count >= 2 };
  if (r.n === 1) return { kind: 'modwheel', sure: true };
  if (vals.length <= 2 && vals.every((v) => v === 0 || v >= 100) && [64, 66, 67, 69].includes(r.n)) return { kind: 'button', sure: true };
  const lowBand = has(1, 16), highBand = has(112, 127), midBand = has(48, 80);
  const absoluteEvidence = has(20, 47) || has(81, 111) || vals.length >= 12;
  if (!absoluteEvidence) {
    if (only(48, 80) && vals.length <= 8) return { kind: 'encoder', rel: 'binoff', sure: vals.some((v) => v < 64) && vals.some((v) => v > 64) };
    if (has(65, 80) && lowBand && !has(48, 64)) return { kind: 'encoder', rel: 'signmag', sure: true };
    if (lowBand && highBand && vals.every((v) => v <= 16 || v >= 112)) return { kind: 'encoder', rel: 'twos', sure: true };
    // One-sided small values repeated: an encoder turned one way. Two directions needed to tell the encodings apart.
    const repeated = r.count >= 4 && vals.length <= 3;
    if (repeated && vals.every((v) => v <= 16)) return { kind: 'encoder', rel: 'twos', sure: false };
    if (repeated && vals.every((v) => v >= 112)) return { kind: 'encoder', rel: 'twos', sure: false };
    if (repeated && only(63, 65) && !midBand) return { kind: 'encoder', rel: 'binoff', sure: false };
  }
  return { kind: 'knob', sure: vals.length >= 6 };
}

export { REL_ENCODINGS, parseSrcKey };
