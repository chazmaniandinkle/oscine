// MIDI binding model (pure: node-testable, no DOM, no WebMIDI). Extends the existing knob map rather than replacing
// it: store.ui.midi.knobs is { [sourceKey]: entry }, where sourceKey is from midisrc.js ("74", "74@2", "n36", "pb"...)
// and entry is EITHER
//   a string  -> legacy: a numeric param key of the SELECTED track's instrument (every map saved before still works), OR
//   a target object { k, ...fields, rel?, pickup?, auto? }:
//     { k:'param',   key | slot, track? }   instrument param. slot = Nth numeric param of the instrument (follows the
//                                           selected track across instruments); track omitted = selected track
//     { k:'channel', key, track?|strip? }   gain|pan|sendDelay|sendReverb (continuous), mute|solo (toggle). strip = Nth
//                                           mixer strip (track, or lane on an arrangement project); neither = selected
//     { k:'master' }                        master volume
//     { k:'fx',      key }                  delayFeedback|delayReturn|verbSize|verbReturn
//     { k:'setting', key }                  bpm|swing
//     { k:'transport', op }                 toggle|play|stop|record|metronome
//     { k:'slot', n }                       pattern slot 0..7
//     { k:'drum', lane, track? }            trigger one lane of a kit (default: the selected kit)
//     { k:'select', dir }                   +1 / -1: select next / previous track
//     { k:'command', name, args? }          any catalog command, fired on press
//   rel:'twos'|'binoff'|'signmag'  the source is an endless encoder (deltas, not positions)
//   pickup:false                   jump instead of soft-takeover (default: pick up)
//   auto:true                      came from a device's default map (shown dimmer; same rules otherwise)
import { clamp, denorm, norm, roundTo } from './util.js';
import { getInstrumentDef } from '../engine/instruments/index.js';
import { decodeMessage, decodeRel, normOf, lookupKeys, srcKey, srcLabel, parseSrcKey } from './midisrc.js';
import { allControls } from './controllers/index.js';

export const SLOT_NAMES_N = 8;
const FX = {
  delayFeedback: { min: 0, max: 0.9, label: 'Delay feedback' }, delayReturn: { min: 0, max: 1, label: 'Delay return' },
  verbSize: { min: 0.4, max: 6, label: 'Reverb size' }, verbReturn: { min: 0, max: 1, label: 'Reverb return' },
};
const SETTING = { bpm: { min: 40, max: 240, step: 0.5, label: 'Tempo' }, swing: { min: 0, max: 1, label: 'Swing' } };
const CHAN = {
  gain: { min: 0, max: 1, label: 'Volume' }, pan: { min: -1, max: 1, label: 'Pan' },
  sendDelay: { min: 0, max: 1, label: 'Delay send' }, sendReverb: { min: 0, max: 1, label: 'Reverb send' },
};
const CHAN_TOGGLE = { mute: 'Mute', solo: 'Solo' };
const TRANSPORT = { toggle: 'Play / stop', play: 'Play', stop: 'Stop', record: 'Record arm', metronome: 'Click' };

export const isTargetObj = (e) => e && typeof e === 'object' && typeof e.k === 'string';
// Normalise any stored entry to a target object (legacy string -> param-of-selected).
export const asTarget = (e) => (typeof e === 'string' ? { k: 'param', key: e } : isTargetObj(e) ? e : null);

const arrLanes = (store) => (store.project.arrangement?.placements?.length ? (store.project.arrangement.lanes ?? []) : null);

// The Nth mixer strip: a track, or a lane on an arrangement project.
function stripOf(store, n) {
  const lanes = arrLanes(store);
  if (lanes) return lanes[n - 1] ? { lane: lanes[n - 1] } : null;
  return store.project.tracks[n - 1] ? { track: store.project.tracks[n - 1] } : null;
}

function findTrack(store, ref) {
  if (ref == null) return store.getTrack(store.ui.selectedTrackId);
  return store.getTrack(ref) || store.project.tracks.find((t) => String(t.name).toLowerCase() === String(ref).toLowerCase()) || null;
}

const numericParams = (def) => def.params.filter((p) => p.type !== 'select');

// target -> descriptor, or null when it can't resolve right now (no track selected, no such lane...).
//   { id, label, kind:'cont'|'toggle'|'trigger', get()->0..1 | bool, set(n)|toggle()|fire(vel) }
// ctx: { store, transport?, api? }.
export function describeTarget(ctx, target) {
  const t = asTarget(target);
  if (!t) return null;
  const { store } = ctx;
  switch (t.k) {
    case 'param': {
      const track = findTrack(store, t.track);
      if (!track) return null;
      const def = getInstrumentDef(track.instrument.type);
      const p = t.key != null ? def.params.find((x) => x.key === t.key) : numericParams(def)[t.slot];
      if (!p || p.type === 'select') return null;
      const get = () => norm(track.instrument.params[p.key] ?? p.default ?? p.min, p.min, p.max, p.curve || 'lin');
      return {
        id: `param:${track.id}:${p.key}`, label: `${track.name} · ${p.label || p.key}`, kind: 'cont', get,
        set(n) {
          let v = denorm(clamp(n, 0, 1), p.min, p.max, p.curve || 'lin');
          if (p.step) v = roundTo(v, p.step);
          store.setTrackParam(track.id, p.key, clamp(v, p.min, p.max));
        },
        text: () => `${(+(track.instrument.params[p.key] ?? 0)).toFixed(2)}${p.unit || ''}`,
      };
    }
    case 'channel': {
      const strip = t.strip != null ? stripOf(store, t.strip) : null;
      const key = t.key;
      if (strip?.lane) {                                      // arrangement lane: gainDb / pan / mute / solo
        const lane = strip.lane;
        if (key === 'mute' || key === 'solo') return { id: `lane:${lane.id}:${key}`, label: `${lane.name} · ${CHAN_TOGGLE[key]}`, kind: 'toggle',
          get: () => !!lane[key], toggle: () => store.laneSet(lane.id, { [key]: !lane[key] }) };
        if (key === 'gain') return { id: `lane:${lane.id}:gainDb`, label: `${lane.name} · Volume`, kind: 'cont',
          get: () => clamp(((lane.gainDb ?? 0) + 60) / 72, 0, 1), set: (n) => store.laneSet(lane.id, { gainDb: Math.round((clamp(n, 0, 1) * 72 - 60) * 10) / 10 }) };
        if (key === 'pan') return { id: `lane:${lane.id}:pan`, label: `${lane.name} · Pan`, kind: 'cont',
          get: () => clamp(((lane.pan ?? 0) + 1) / 2, 0, 1), set: (n) => store.laneSet(lane.id, { pan: Math.round((clamp(n, 0, 1) * 2 - 1) * 100) / 100 }) };
        return null;
      }
      const track = strip?.track || (t.strip != null ? null : findTrack(store, t.track));
      if (!track) return null;
      if (CHAN_TOGGLE[key]) return { id: `chan:${track.id}:${key}`, label: `${track.name} · ${CHAN_TOGGLE[key]}`, kind: 'toggle',
        get: () => !!track.channel[key], toggle: () => store.setChannel(track.id, key, !track.channel[key]) };
      const c = CHAN[key];
      if (!c) return null;
      return { id: `chan:${track.id}:${key}`, label: `${track.name} · ${c.label}`, kind: 'cont',
        get: () => norm(track.channel[key] ?? 0, c.min, c.max), set: (n) => store.setChannel(track.id, key, c.min + clamp(n, 0, 1) * (c.max - c.min)) };
    }
    case 'master': {
      const arr = store.project.arrangement?.placements?.length;
      if (arr) return { id: 'master', label: 'Master', kind: 'cont', get: () => clamp(((store.project.arrangement.master?.gainDb ?? 0) + 60) / 72, 0, 1),
        set: (n) => store.setSetting('masterVolume', clamp(n, 0, 1) * 1.2) };
      return { id: 'master', label: 'Master volume', kind: 'cont', get: () => clamp(store.project.masterVolume / 1.2, 0, 1), set: (n) => store.setSetting('masterVolume', clamp(n, 0, 1) * 1.2) };
    }
    case 'fx': {
      const f = FX[t.key];
      if (!f) return null;
      return { id: `fx:${t.key}`, label: f.label, kind: 'cont', get: () => norm(store.project.fx[t.key] ?? f.min, f.min, f.max), set: (n) => store.setFx(t.key, f.min + clamp(n, 0, 1) * (f.max - f.min)) };
    }
    case 'setting': {
      const s = SETTING[t.key];
      if (!s) return null;
      return { id: `setting:${t.key}`, label: s.label, kind: 'cont', get: () => norm(store.project[t.key] ?? s.min, s.min, s.max),
        set: (n) => store.setSetting(t.key, roundTo(s.min + clamp(n, 0, 1) * (s.max - s.min), s.step || 0.01)) };
    }
    case 'transport': {
      const tr = ctx.transport;
      if (!TRANSPORT[t.op]) return null;
      const fire = () => {
        if (t.op === 'toggle') tr?.toggle?.();
        else if (t.op === 'play') tr?.play?.();
        else if (t.op === 'stop') tr?.stop?.();
        else if (t.op === 'record') store.configureMidi({ record: !store.ui.midi.record });
        else if (t.op === 'metronome') store.setMetronome(!store.ui.metronome);
      };
      return { id: `transport:${t.op}`, label: TRANSPORT[t.op], kind: 'trigger', fire };
    }
    case 'slot': {
      const n = Number(t.n);
      if (!(n >= 0 && n < store.project.slots.length)) return null;
      return { id: `slot:${n}`, label: `Pattern ${String.fromCharCode(65 + n)}`, kind: 'trigger', fire: () => store.requestSlot(n, !!ctx.transport?.playing) };
    }
    case 'drum': {
      const track = findTrack(store, t.track);
      const kit = track && store.kindOf(track) === 'drums' ? track : store.project.tracks.find((x) => store.kindOf(x) === 'drums');
      if (!kit) return null;
      const lane = getInstrumentDef(kit.instrument.type).lanes.find((l) => l.id === t.lane);
      if (!lane) return null;
      return { id: `drum:${kit.id}:${lane.id}`, label: `${kit.name} · ${lane.label || lane.id}`, kind: 'trigger', fire: (vel = 0.9) => ctx.engine?.previewHit?.(kit.id, lane.id, vel) };
    }
    case 'select': {
      const tracks = store.project.tracks;
      if (!tracks.length) return null;
      return { id: `select:${t.dir}`, label: t.dir > 0 ? 'Next track' : 'Previous track', kind: 'trigger', fire: () => {
        const i = tracks.findIndex((x) => x.id === store.ui.selectedTrackId);
        store.selectTrack(tracks[(i + (t.dir > 0 ? 1 : -1) + tracks.length) % tracks.length].id);
      } };
    }
    case 'command': {
      if (!ctx.api || !t.name) return null;
      return { id: `cmd:${t.name}:${JSON.stringify(t.args ?? {})}`, label: `${t.name}${t.args?.action ? ' ' + t.args.action : ''}`, kind: 'trigger',
        fire: () => { Promise.resolve(ctx.api.execute(t.name, t.args ?? {})).catch(() => {}); } };
    }
    default: return null;
  }
}

export function targetLabel(ctx, entry) {
  const t = asTarget(entry);
  if (!t) return '';
  const d = describeTarget(ctx, t);
  if (d) return t.k === 'param' && t.track == null && t.key != null ? `${d.label.split(' · ')[1] || t.key} (selected)` : d.label;
  // Unresolved right now: say what it WILL be.
  switch (t.k) {
    case 'param': return t.key != null ? `${t.key} (selected track)` : `param ${t.slot + 1} (selected track)`;
    case 'channel': return `${t.strip != null ? 'strip ' + t.strip : t.track || 'selected'} ${t.key}`;
    case 'drum': return `drum ${t.lane}`;
    default: return t.k;
  }
}

// -- running a message against a binding ---------------------------------------------------------------------
// state: per-source runtime { engaged, lastH, tid } kept by the caller (a Map keyed by sourceKey).
// Returns { handled, desc, value } for the activity display.
export function applyMessage(ctx, state, key, entry, msg) {
  const t = asTarget(entry);
  const d = t && describeTarget(ctx, t);
  if (!d) return { handled: false };
  const h = normOf(msg);
  const rt = state.get(key) || { engaged: false, lastH: null, tid: null, down: false };
  state.set(key, rt);
  if (rt.tid !== d.id) { rt.tid = d.id; rt.engaged = false; rt.lastH = null; }       // the thing we point at changed: pick up again

  if (d.kind === 'cont') {
    if (t.rel && msg.t === 'cc') {
      const step = decodeRel(t.rel, msg.v) * (t.stepSize || 0.01);
      d.set(clamp(d.get() + step, 0, 1));
      return { handled: true, desc: d, value: d.get() };
    }
    if (msg.t === 'note' && !msg.on) return { handled: true, desc: d };
    const wantPickup = t.pickup !== false && msg.t === 'cc';
    if (wantPickup && !rt.engaged) {
      const p = d.get();
      const crossed = rt.lastH != null && (rt.lastH - p) * (h - p) <= 0;
      rt.lastH = h;
      if (Math.abs(h - p) <= 0.03 || crossed) rt.engaged = true;
      else return { handled: true, desc: d, value: p, waiting: true, hw: h };
    }
    rt.engaged = true; rt.lastH = h;
    d.set(h);
    return { handled: true, desc: d, value: h };
  }
  // toggle / trigger: act on the press edge (CC >= 64 after a release, or a note-on), never on release.
  const press = msg.t === 'note' ? !!msg.on : msg.t === 'pc' ? true : msg.v >= 64;
  const wasDown = rt.down;
  rt.down = msg.t === 'note' ? !!msg.on : msg.v >= 64;
  if (!press || (msg.t === 'cc' && wasDown)) return { handled: true, desc: d };
  if (d.kind === 'toggle') d.toggle(); else d.fire(msg.t === 'note' ? clamp(msg.v / 127, 0.05, 1) : 0.9);
  return { handled: true, desc: d, value: d.kind === 'toggle' ? (d.get() ? 1 : 0) : 1 };
}

// Find the entry bound to a decoded message (channel-specific key first), plus the key it matched.
export function findBinding(map, msg) {
  for (const k of lookupKeys(msg)) if (map[k] != null) return { key: k, entry: map[k] };
  return null;
}

// -- default map for a known device ---------------------------------------------------------------------------
// Knobs/encoders -> the selected track's first N numeric params (follows the selection); faders -> mixer volumes by
// strip; solo/mute/arm buttons -> that strip; transport buttons -> transport. Pads/keys need no binding: notes
// already play the selected track (pads -> the kit's lanes). Entries carry auto:true.
export function defaultMap(profile) {
  const out = {};
  if (!profile) return out;
  let slot = 0;
  for (const { seg, control: c } of allControls(profile)) {
    if (!c.src) continue;
    const key = srcKey(c.src);
    const rel = c.rel ? { rel: c.rel } : {};
    if ((c.kind === 'knob' || c.kind === 'encoder') && !c.strip) out[key] = { k: 'param', slot: slot++, auto: true, ...rel };
    else if (c.kind === 'knob' && c.strip) continue;                    // pan/send rows on strip devices: left for the user
    else if (c.kind === 'fader' && c.strip) out[key] = { k: 'channel', strip: c.strip, key: 'gain', auto: true };
    else if (c.kind === 'button' && c.role) {
      if (c.role === 'strip.solo') out[key] = { k: 'channel', strip: c.strip, key: 'solo', auto: true };
      else if (c.role === 'strip.mute') out[key] = { k: 'channel', strip: c.strip, key: 'mute', auto: true };
      else if (c.role === 'strip.arm') continue;
      else if (c.role === 'transport.toggle') out[key] = { k: 'transport', op: 'toggle', auto: true };
      else if (c.role === 'transport.play') out[key] = { k: 'transport', op: 'play', auto: true };
      else if (c.role === 'transport.stop') out[key] = { k: 'transport', op: 'stop', auto: true };
      else if (c.role === 'transport.record') out[key] = { k: 'transport', op: 'record', auto: true };
    }
  }
  // Strip-numbered controls inherit their strip from the order within their segment (K1..K8 / F1..F8 / S1..S8).
  for (const sg of profile.segments || []) {
    (sg.controls || []).forEach((c, i) => {
      if (!c.src || !c.strip && !String(c.role || '').startsWith('strip.')) return;
      const e = out[srcKey(c.src)];
      if (e && e.k === 'channel' && e.strip == null) e.strip = i + 1;
    });
  }
  return out;
}

// Fix up strip numbers that kit.many() recorded as `strip:true`-> index (kit sets strip = i+1 already); kept for
// profiles written by hand with strip:true.
export const stripOfControl = (c, i) => (c.strip === true ? i + 1 : c.strip);

// Entry for a stored string key that is a valid source key (migration guard for hand-edited maps).
export const cleanMap = (m) => {
  const out = {};
  for (const [k, v] of Object.entries(m || {})) if (parseSrcKey(k) && (typeof v === 'string' || isTargetObj(v))) out[k] = v;
  return out;
};

export { srcLabel, decodeMessage };
