// Jam recorder: an OPT-IN, complete, time-stamped ledger of everything the user does while a jam is on, so an agent
// can read "all inputs since I last looked" and line them up with the audio that came out.
//
// Not the performance ledger (store.ui.ledger): that one is always-on, bounded, note/hit only and never saved. A jam
// is explicit, unbounded (it streams to disk through the sidecar), and records every bus event the app emits
// (param / mixer / notes / steps / slot / transport / tempo / selection ...) plus the live input taps (note, hit)
// and raw MIDI controller messages (cc / bend / pressure / program) when the MIDI layer emits 'midi:raw'.
//
// Pure: no DOM, no Web Audio, no fetch. The clock and the beat reader are injected, so node tests drive it with fakes.
//
// Event shape (one JSON line each in events.jsonl):
//   { seq, seg, t, ct, beat, kind, ...payload }
//     seq   0-based, monotonic across the whole jam (the cursor unit)
//     seg   segment number (a page reload mid-jam starts a new segment; same jam id)
//     t     wall clock ms (Date.now)
//     ct    AudioContext.currentTime at the event (seconds) or null when no engine; THE clock the audio is on
//     beat  transport beat inside the loop when playing, else null (free play)
//     kind  note | hit | cc | bend | pressure | program | transport | slot | action
//
// Audio alignment: meta.json carries audio_t0_ct = AudioContext.currentTime when the MediaRecorder started, so an
// event at ct lands at (ct - audio_t0_ct) seconds into the recording. audioWindow() does that arithmetic.

export const SKIP_BUS = new Set(['schedule:window', 'ear:frame', 'track:trigger', 'midi:status', 'ledger:cleared', 'transport:looped']);
const DROP_KEYS = new Set(['project', 'beatToTime', 'swingOffset', 'params']);   // large or non-data payload fields
const MAX_STR = 200, MAX_ARR = 16, MAX_KEYS = 14;

// Reduce a bus payload to small JSON: primitives, shallow arrays/objects, no functions, no project documents.
export function sanitize(v, depth = 0) {
  if (v === null || v === undefined) return null;
  const t = typeof v;
  if (t === 'number') return Number.isFinite(v) ? v : null;
  if (t === 'boolean') return v;
  if (t === 'string') return v.length > MAX_STR ? v.slice(0, MAX_STR) + '…' : v;
  if (t === 'function' || t === 'symbol') return undefined;
  if (depth >= 3) return undefined;
  if (Array.isArray(v)) return v.slice(0, MAX_ARR).map(x => sanitize(x, depth + 1)).filter(x => x !== undefined);
  if (t === 'object') {
    const out = {};
    let n = 0;
    for (const k of Object.keys(v)) {
      if (DROP_KEYS.has(k)) continue;
      const s = sanitize(v[k], depth + 1);
      if (s === undefined) continue;
      out[k] = s;
      if (++n >= MAX_KEYS) break;
    }
    return out;
  }
  return undefined;
}

// Which jam kind a bus event type belongs to.
export function kindOfBus(type, payload) {
  if (type.startsWith('transport:')) return 'transport';
  if (type === 'settings:changed' && payload && (payload.key === 'bpm' || payload.key === 'swing')) return 'transport';
  if (type.startsWith('slot:')) return 'slot';
  return 'action';
}

// Raw MIDI status byte -> kind. data = [status, d1, d2].
export function kindOfMidi(status) {
  const hi = status & 0xf0;
  if (hi === 0xb0) return 'cc';
  if (hi === 0xe0) return 'bend';
  if (hi === 0xd0 || hi === 0xa0) return 'pressure';
  if (hi === 0xc0) return 'program';
  if (hi === 0x90 || hi === 0x80) return 'note';
  return 'midi';
}

export function newJamId(now = new Date(), rand = Math.random) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `jam-${stamp}-${Math.floor(rand() * 0xffff).toString(16).padStart(4, '0')}`;
}

export class JamRecorder {
  // clock() -> { t, ct }   beat() -> number | null
  constructor({ clock = () => ({ t: Date.now(), ct: null }), beat = () => null } = {}) {
    this.clock = clock; this.beat = beat;
    this.active = false;
    this.id = null; this.meta = null;
    this.events = []; this.seq = 0; this.shipped = 0; this.seg = 0;
  }

  start(meta = {}, { id, seq = 0, seg = 0 } = {}) {
    if (this.active) throw new Error(`A jam is already recording (${this.id}). Stop it first.`);
    const c = this.clock();
    this.id = id || newJamId();
    this.events = []; this.seq = seq; this.shipped = seq; this.seg = seg;     // a resumed jam continues its seq so cursors stay valid
    this.meta = { id: this.id, started_t: c.t, started_ct: c.ct, ...meta };
    this.active = true;
    return this.meta;
  }

  stop() {
    if (!this.active) throw new Error('No jam is recording.');
    const c = this.clock();
    this.active = false;
    this.meta = { ...this.meta, stopped_t: c.t, stopped_ct: c.ct, events: this.seq };
    return this.meta;
  }

  // Add one event. No-op when not recording (so taps can stay attached cheaply).
  record(kind, payload = {}) {
    if (!this.active) return null;
    const c = this.clock();
    const ev = { ...payload, seq: this.seq++, seg: this.seg, t: c.t, ct: c.ct === undefined ? null : c.ct, beat: this.beat() ?? null, kind };
    this.events.push(ev);
    return ev;
  }

  // Events not yet handed to the uploader. Marks them shipped.
  drain() {
    const out = this.events.slice(this.shipped - this.base());
    this.shipped = this.seq;
    return out;
  }
  base() { return this.seq - this.events.length; }

  // Events with seq >= sinceSeq.
  read(sinceSeq = 0) {
    const from = Math.max(0, sinceSeq - this.base());
    return this.events.slice(from);
  }

  status() {
    return { active: this.active, id: this.id, events: this.seq, seg: this.seg, meta: this.meta };
  }
}

// Seconds into the recording that an event list spans. events need ct; t0 = meta.audio_t0_ct.
// Returns null when there's nothing to align (no ct stamps, or no audio t0).
export function audioWindow(events, audioT0Ct, { padSec = 0 } = {}) {
  if (!Array.isArray(events) || !events.length || !Number.isFinite(audioT0Ct)) return null;
  const cts = events.map(e => e.ct).filter(Number.isFinite);
  if (!cts.length) return null;
  const r3 = v => Math.round(v * 1000) / 1000;
  return {
    from_sec: r3(Math.max(0, Math.min(...cts) - audioT0Ct - padSec)),
    to_sec: r3(Math.max(0, Math.max(...cts) - audioT0Ct + padSec)),
  };
}

// A tap that feeds a recorder from the app. Installed on jam start, removed on stop; the recorder is a no-op when off.
//   store.logInput  (note / hit from the on-screen keys, computer keyboard, MIDI)  -> kinds note / hit
//   bus '*'         (every other event the app emits)                              -> kinds by kindOfBus
//   bus 'midi:raw'  ({ data:[status,d1,d2] } from the MIDI layer, when it emits it) -> cc / bend / pressure / program
// Returns an uninstall function.
export function installJamTap({ store, bus, recorder }) {
  const offs = [];
  const orig = store.logInput;
  store.logInput = function (ev) {
    const out = orig.call(this, ev);
    if (recorder.active && ev) { const { kind, ...rest } = ev; recorder.record(kind === 'hit' ? 'hit' : 'note', rest); }
    return out;
  };
  offs.push(() => { store.logInput = orig; });
  offs.push(bus.on('*', (type, payload) => {
    if (!recorder.active || SKIP_BUS.has(type) || type.startsWith('jam:') || type === 'midi:raw') return;
    const s = sanitize(payload);
    // A tempo/swing change says which setting moved; stamp the NEW value too, so a phrase can be placed in beats later.
    const val = type === 'settings:changed' && payload && (payload.key === 'bpm' || payload.key === 'swing') ? { value: store.project?.[payload.key] } : {};
    recorder.record(kindOfBus(type, payload), { ...(s && typeof s === 'object' && !Array.isArray(s) ? s : (s == null ? {} : { value: s })), ...val, name: type });
  }));
  offs.push(bus.on('midi:raw', (m) => {
    if (!recorder.active || !m || !m.data) return;
    const [status, d1 = 0, d2 = 0] = m.data;
    const kind = kindOfMidi(status);
    if (kind === 'note') return;          // notes are already taken from store.logInput (with track + beat); don't double-count
    recorder.record(kind, { status, ch: (status & 0x0f) + 1, d1, d2, ...(m.device ? { device: String(m.device).slice(0, 60) } : {}) });
  }));
  return () => { for (const off of offs.reverse()) off(); };
}
