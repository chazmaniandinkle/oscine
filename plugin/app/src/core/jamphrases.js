// Jam phrases: turn a jam's raw events into musical phrases you can name, hear, clip and riff on.
// Pure (no DOM, no fs), so the sidecar (reads events.jsonl from disk), the app (places a clip into a slot) and the
// tests all share it.
//
//   pairEvents(events)            -> { notes: [{on, off}], hits: [event] }   note-on/off pairs + drum hits
//   segmentPhrases(events, opts)  -> phrases (per track, split by silence), oldest first
//   clipFromPhrase(phrase, opts)  -> a clip in the shape set_notes / set_steps take, re-based to beat 0
//   parseQuantize('1/16')         -> 0.25 (beats)
//
// A phrase's note starts are beats relative to its first note. When every note-on/off in the phrase carries the
// transport beat (playing, no loop wrap) those beats are exact; otherwise (free play, stopped transport) they come
// from wall time through the jam's tempo map (meta.bpm at the start, then any 'bpm' change events with a value).
//
// Audio: each phrase carries the window (seconds into that segment's audio file) covering it, using audioWindow()
// from jam.js, widened a little: the note's sound starts after the input stamp and decays after the key comes up.

import { midiName } from './util.js';
import { audioWindow } from './jam.js';

export const DEFAULTS = {
  gapSec: 1.5,        // silence that ends a phrase (wall time)
  gapBeats: 2,        // ... or this many beats, when both neighbours carry the transport beat
  maxHeldSec: 4,      // a note-on with no note-off is held at most this long
  headSec: 0.1,       // audio window starts this much before the first input
  tailSec: 0.5,       // ... and runs this much past the last (release / reverb tail)
  contourMax: 24,
};

const r3 = (v) => Math.round(v * 1000) / 1000;
const BAR_CHOICES = [1, 2, 4, 8, 16, 32];

// '1/16' -> 0.25, '1/8' -> 0.5, '1/4' -> 1, '1/8T' (triplet) -> 1/3. Falsy / 'off' / 'none' -> 0 (no grid).
export function parseQuantize(q) {
  if (q === undefined || q === null || q === false || q === '' || q === 'off' || q === 'none') return 0;
  if (typeof q === 'number') return q > 0 ? q : 0;
  const m = /^1\/(\d+)(t?)$/i.exec(String(q).trim());
  if (!m) throw new Error(`quantize '${q}': use a grid like '1/4', '1/8', '1/16', '1/32' (append T for triplets).`);
  const base = 4 / Number(m[1]);
  return m[2] ? base * 2 / 3 : base;
}

// Wall ms -> beats, piecewise at the tempo in force. Tempo changes are events { kind:'transport', key:'bpm', value }.
export function tempoMap(events, { startBpm, startT } = {}) {
  const changes = events.filter(e => e.kind === 'transport' && e.key === 'bpm' && Number.isFinite(e.value) && Number.isFinite(e.t))
    .map(e => ({ t: e.t, bpm: e.value })).sort((a, b) => a.t - b.t);
  const t0 = Number.isFinite(startT) ? startT : (events.find(e => Number.isFinite(e.t))?.t ?? 0);
  const bpm0 = Number.isFinite(startBpm) && startBpm > 0 ? startBpm : (changes[0]?.bpm ?? 120);
  const segs = [{ t: t0, bpm: bpm0, beat: 0 }];
  for (const c of changes) {
    const last = segs[segs.length - 1];
    if (c.t <= last.t) { last.bpm = c.bpm; continue; }
    segs.push({ t: c.t, bpm: c.bpm, beat: last.beat + (c.t - last.t) / 60000 * last.bpm });
  }
  const at = (t) => {
    let s = segs[0];
    for (const x of segs) { if (x.t <= t) s = x; else break; }
    return s.beat + (t - s.t) / 60000 * s.bpm;
  };
  at.bpmAt = (t) => { let s = segs[0]; for (const x of segs) { if (x.t <= t) s = x; else break; } return s.bpm; };
  return at;
}

// Note-on/off pairs + drum hits. A note-on on a pitch already sounding closes the earlier one (overlap).
export function pairEvents(events) {
  const evs = events.filter(Boolean).slice().sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const open = new Map();
  const notes = [], hits = [];
  for (const e of evs) {
    if (e.kind === 'hit') { hits.push(e); continue; }
    if (e.kind !== 'note' || !Number.isFinite(e.pitch)) continue;
    const key = `${e.seg ?? 0}|${e.trackId ?? ''}|${e.pitch}`;
    if (e.on === false) {
      const o = open.get(key);
      if (o) { notes.push({ on: o, off: e }); open.delete(key); }
    } else {
      const o = open.get(key);
      if (o) notes.push({ on: o, off: e, cut: true });
      open.set(key, e);
    }
  }
  for (const o of open.values()) notes.push({ on: o, off: null });
  notes.sort((a, b) => a.on.seq - b.on.seq);
  return { notes, hits };
}

const endT = (item, lastT, maxHeldMs) => item.off ? item.off.t : Math.min(lastT, item.on.t + maxHeldMs) ;

function monotone(vals) {
  let prev = -Infinity;
  for (const v of vals) { if (!Number.isFinite(v)) return false; if (v < prev - 1e-6) return false; prev = v; }
  return true;
}

// Phrases from a jam's events. opts: gapSec, gapBeats, maxHeldSec, headSec, tailSec, track (id or name),
// window { seg, fromCt, toCt } (keep only items whose note-on / hit lies in it), meta (the jam's meta.json).
export function segmentPhrases(events, opts = {}) {
  const o = { ...DEFAULTS, ...Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined)) };
  const meta = o.meta || {};
  const evs = (events || []).filter(Boolean);
  const lastT = Math.max(0, ...evs.map(e => e.t).filter(Number.isFinite));
  const firstSegStart = (s) => meta.segments?.[s]?.started_t;
  const tmap = tempoMap(evs, { startBpm: meta.bpm, startT: meta.started_t ?? firstSegStart(0) });
  const { notes, hits } = pairEvents(evs);
  const keepTrack = (e) => !o.track || e.trackId === o.track || e.trackName === o.track;
  const inWin = (e) => !o.window || ((e.seg ?? 0) === (o.window.seg ?? 0) && e.ct >= o.window.fromCt && e.ct <= o.window.toCt);
  const maxHeldMs = o.maxHeldSec * 1000;

  const phrases = [];
  const run = (items, kind) => {
    const byTrack = new Map();
    for (const it of items) {
      const ev = it.on || it;
      if (!keepTrack(ev) || !inWin(ev)) continue;
      const k = ev.trackId ?? ev.trackName ?? '?';
      if (!byTrack.has(k)) byTrack.set(k, []);
      byTrack.get(k).push(it);
    }
    for (const list of byTrack.values()) {
      list.sort((a, b) => (a.on || a).t - (b.on || b).t);
      let cur = [], curEndT = -Infinity, curEndBeat = null, curSeg = null;
      const flush = () => { if (cur.length) phrases.push(buildPhrase(cur, kind, o, meta, tmap, lastT, maxHeldMs)); cur = []; curEndT = -Infinity; curEndBeat = null; };
      for (const it of list) {
        const ev = it.on || it;
        const gapMs = ev.t - curEndT;
        const beatGap = Number.isFinite(ev.beat) && Number.isFinite(curEndBeat) ? ev.beat - curEndBeat : null;
        const split = cur.length && ((ev.seg ?? 0) !== curSeg || gapMs / 1000 >= o.gapSec || (beatGap !== null && beatGap >= 0 && beatGap >= o.gapBeats));
        if (split) flush();
        if (!cur.length) curSeg = ev.seg ?? 0;
        cur.push(it);
        curEndT = Math.max(curEndT, kind === 'hits' ? ev.t : endT(it, lastT, maxHeldMs));
        const eb = kind === 'hits' ? ev.beat : (it.off?.beat ?? ev.beat);
        if (Number.isFinite(eb)) curEndBeat = Number.isFinite(curEndBeat) ? Math.max(curEndBeat, eb) : eb;
      }
      flush();
    }
  };
  run(notes, 'notes');
  run(hits, 'hits');
  phrases.sort((a, b) => a.start.t - b.start.t || a.firstSeq - b.firstSeq);
  return phrases;
}

function buildPhrase(items, kind, o, meta, tmap, lastT, maxHeldMs) {
  const evOf = (it) => it.on || it;
  const first = evOf(items[0]);
  const seg = first.seg ?? 0;
  const allEvents = [];
  for (const it of items) { allEvents.push(evOf(it)); if (it.off) allEvents.push(it.off); }
  const beatMode = monotone(allEvents.map(e => e.beat)) && allEvents.every(e => Number.isFinite(e.beat));
  const beatOf = (e) => beatMode ? e.beat : tmap(e.t);
  const b0 = beatOf(first);
  const startT = Math.min(...allEvents.map(e => e.t)), stopT = Math.max(...allEvents.map(e => e.t));
  const cts = allEvents.map(e => e.ct).filter(Number.isFinite);
  const bpm = beatMode ? (Number.isFinite(meta.bpm) ? meta.bpm : null) : tmap.bpmAt(first.t);
  const base = {
    id: `ph-${first.seq}`, firstSeq: first.seq, kind, seg,
    track: first.trackId ?? null, trackName: first.trackName ?? null,
    timing: beatMode ? 'beat' : 'time', bpm: bpm === null ? null : r3(bpm),
    start: { t: startT, ct: cts.length ? Math.min(...cts) : null, beat: Number.isFinite(first.beat) ? r3(first.beat) : null },
    end: { t: stopT, ct: cts.length ? Math.max(...cts) : null },
    durSec: r3((stopT - startT) / 1000),
  };
  const a = meta.segments?.[seg]?.audio;
  if (a && Number.isFinite(a.audio_t0_ct)) {
    const w = audioWindow(allEvents, a.audio_t0_ct);
    base.audio = w ? { seg, file: a.file || (seg > 0 ? `audio.${seg}.webm` : 'audio.webm'), from_sec: r3(Math.max(0, w.from_sec - o.headSec)), to_sec: r3(w.to_sec + o.tailSec), aligned: true } : { seg, aligned: false };
  } else base.audio = { seg, aligned: false };

  if (kind === 'hits') {
    const hits = items.map(it => ({ lane: it.lane ?? null, start: r3(beatOf(it) - b0), vel: r3(Number.isFinite(it.vel) ? it.vel : 0.85), startSec: r3((it.t - startT) / 1000) }));
    const lanes = {};
    for (const h of hits) lanes[h.lane] = (lanes[h.lane] || 0) + 1;
    const span = Math.max(...hits.map(h => h.start));
    return { ...base, count: hits.length, beats: r3(span), lanes, contour: hitContour(hits, o.contourMax), hits };
  }
  const notes = items.map(it => {
    const on = it.on, off = it.off;
    const dur = Math.max(0.02, off ? beatOf(off) - beatOf(on) : tmap(Math.min(lastT, on.t + maxHeldMs)) - tmap(on.t));
    return {
      pitch: on.pitch, name: midiName(on.pitch), start: r3(beatOf(on) - b0), dur: r3(dur),
      vel: r3(Number.isFinite(on.vel) ? on.vel : 0.85), startSec: r3((on.t - startT) / 1000),
      ...(off ? {} : { held: true }),
    };
  }).sort((x, y) => x.start - y.start || x.pitch - y.pitch);
  const pitches = notes.map(n => n.pitch);
  const lo = Math.min(...pitches), hi = Math.max(...pitches);
  return {
    ...base, count: notes.length, beats: r3(Math.max(...notes.map(n => n.start + n.dur))),
    range: { lo, hi, loName: midiName(lo), hiName: midiName(hi) },
    contour: noteContour(notes, o.contourMax), notes,
  };
}

// "C4 E4 G4 ~ A4": chords in brackets, '~' for a rest of a beat or more.
export function noteContour(notes, max = DEFAULTS.contourMax) {
  const groups = [];
  for (const n of notes) {
    const g = groups[groups.length - 1];
    if (g && Math.abs(n.start - g.start) < 0.06) g.names.push(n.name); else groups.push({ start: n.start, end: n.start + n.dur, names: [n.name] });
    const cur = groups[groups.length - 1]; cur.end = Math.max(cur.end, n.start + n.dur);
  }
  const out = [];
  groups.forEach((g, i) => {
    if (i && g.start - groups[i - 1].end >= 1) out.push('~');
    out.push(g.names.length > 1 ? `[${g.names.join(' ')}]` : g.names[0]);
  });
  return out.length > max ? out.slice(0, max).join(' ') + ' …' : out.join(' ');
}

function hitContour(hits, max) {
  const out = [];
  hits.forEach((h, i) => {
    if (i && h.start - hits[i - 1].start > 1.5) out.push('.');      // a skipped beat or more reads as a rest
    out.push(h.lane ?? '?');
  });
  return out.length > max ? out.slice(0, max).join(' ') + ' …' : out.join(' ');
}

const barsFor = (beats) => BAR_CHOICES.find(b => b * 4 >= beats - 1e-6) ?? BAR_CHOICES[BAR_CHOICES.length - 1];

// A phrase -> a clip: quantized, re-based to beat 0, in the shape set_notes / set_steps take.
//   quantize: '1/16' (default none for notes); drums always sit on the 1/16 step grid.
//   rebase: 'first' (default: the first note is beat 0) | 'bar' (keep its place in the bar: beat 0 = the bar line before it;
//           only meaningful for beat-stamped phrases).
export function clipFromPhrase(phrase, { quantize, rebase = 'first' } = {}) {
  const grid = parseQuantize(quantize);
  const offset = rebase === 'bar' && phrase.timing === 'beat' && Number.isFinite(phrase.start.beat) ? ((phrase.start.beat % 4) + 4) % 4 : 0;
  const q = (v, g) => (g ? Math.round(v / g) * g : Math.round(v * 96) / 96);
  const clip = { phraseId: phrase.id, track: phrase.track, trackName: phrase.trackName, kind: phrase.kind === 'hits' ? 'drums' : 'synth', timing: phrase.timing, bpm: phrase.bpm };
  if (phrase.kind === 'hits') {
    const steps = phrase.hits.map(h => ({ lane: h.lane, step: Math.max(0, Math.round((h.start + offset) / 0.25)), vel: h.vel }));
    const nSteps = Math.max(1, ...steps.map(s => s.step + 1));
    const bars = barsFor(Math.ceil(nSteps / 4));
    const lanes = {};
    for (const s of steps) {
      if (!lanes[s.lane]) lanes[s.lane] = new Array(bars * 16).fill(0);
      lanes[s.lane][s.step] = Math.max(lanes[s.lane][s.step] || 0, s.vel);
    }
    return { ...clip, quantize: '1/16 (step grid)', bars, beats: bars * 4, lanes };
  }
  const notes = phrase.notes.map(n => {
    const start = Math.max(0, q(n.start + offset, grid));
    const dur = Math.max(grid || 0.02, q(n.dur, grid));
    return { start: r3(start), pitch: n.pitch, dur: r3(dur), vel: n.vel };
  });
  const beats = Math.max(...notes.map(n => n.start + n.dur));
  return { ...clip, quantize: grid ? String(quantize) : 'none', bars: barsFor(beats), beats: r3(beats), notes };
}
