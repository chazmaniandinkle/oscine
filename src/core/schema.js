// Project document schema + factories. This is the on-disk format
// (exported JSON) and the in-memory shape, identical by design.
//
// Time units: melodic notes use beats (quarter notes, floats), so finer
// grids and triplets are a UI change, not a format change. Drum patterns
// use 16th-step arrays. Patterns live in 4 slots (A-D) per project;
// a slot stores one pattern per track plus its own bar length.

import { uid, clamp } from './util.js';
import { defaultParams, presetParams, getInstrumentDef } from '../engine/instruments/index.js';

export const FORMAT_VERSION = 1;
export const SLOT_NAMES = ['A', 'B', 'C', 'D'];
export const BAR_CHOICES = [1, 2, 4, 8];
export const MIDI_MIN = 24;   // C1
export const MIDI_MAX = 107;  // B7

export const TRACK_COLORS = [
  '#ff8a5c', '#5ce0a8', '#7aa2ff', '#e87bff',
  '#ffd166', '#5cc8ff', '#ff5c7a', '#a8e05c',
];

export function createPattern(kind, bars, instrumentType = null) {
  if (kind === 'drums') {
    const lanes = getInstrumentDef(instrumentType ?? 'drums').lanes;
    const steps = {};
    for (const lane of lanes) steps[lane.id] = new Array(bars * 16).fill(0);
    return { steps };
  }
  return { notes: [] };
}

export function resizeDrumPattern(pattern, bars) {
  const want = bars * 16;
  for (const laneId of Object.keys(pattern.steps)) {
    const arr = pattern.steps[laneId];
    if (arr.length > want) pattern.steps[laneId] = arr.slice(0, want);
    else while (arr.length < want) arr.push(0);
  }
}

export function createTrack(instrumentType, name, colorIndex = 0) {
  return {
    id: uid('trk'),
    name,
    color: TRACK_COLORS[colorIndex % TRACK_COLORS.length],
    instrument: {
      type: instrumentType,
      preset: null,
      params: defaultParams(instrumentType),
    },
    channel: {
      gain: 0.8, pan: 0,
      mute: false, solo: false,
      sendDelay: 0, sendReverb: 0,
    },
  };
}

export function createProject(name = 'Untitled') {
  return {
    version: FORMAT_VERSION,
    name,
    bpm: 110,
    swing: 0,
    masterVolume: 0.85,
    fx: {
      delayDiv: 0.75,        // beats (dotted 8th)
      delayFeedback: 0.38,
      delayReturn: 0.7,
      verbSize: 2.2,         // seconds
      verbReturn: 0.8,
    },
    slots: SLOT_NAMES.map(n => ({ name: n, bars: 2, patterns: {} })),
    tracks: [],
  };
}

export function validateProject(p) {
  if (!p || typeof p !== 'object') throw new Error('not a project file');
  if (p.version !== FORMAT_VERSION) throw new Error(`unsupported format version ${p.version}`);
  if (!Array.isArray(p.tracks) || !Array.isArray(p.slots)) throw new Error('malformed project');
  p.bpm = clamp(p.bpm ?? 110, 40, 240);
  return p;
}

// ---------------------------------------------------------------------------
// Demo song: a small house groove so first open makes sound worth keeping.

function note(start, pitch, dur, vel) {
  return { id: uid('n'), start, pitch, dur, vel };
}

export function demoProject() {
  const p = createProject('First Light');
  p.bpm = 112;
  p.swing = 0.12;

  const drums = createTrack('drums', 'Drums', 0);
  const bass = createTrack('poly', 'Bass', 1);
  bass.instrument.preset = 'Acid Bass';
  bass.instrument.params = presetParams('poly', 'Acid Bass');
  bass.channel.gain = 0.78;
  const keys = createTrack('poly', 'Keys', 2);
  keys.instrument.preset = 'Velvet Pad';
  keys.instrument.params = presetParams('poly', 'Velvet Pad');
  keys.channel.gain = 0.6;
  keys.channel.sendReverb = 0.5;
  keys.channel.sendDelay = 0.12;
  const lead = createTrack('fm', 'Lead', 3);
  lead.instrument.preset = 'E-Piano';
  lead.instrument.params = presetParams('fm', 'E-Piano');
  lead.channel.gain = 0.7;
  lead.channel.sendDelay = 0.38;
  lead.channel.sendReverb = 0.3;

  p.tracks = [drums, bass, keys, lead];

  // --- Slot A: the groove (2 bars) ---
  const A = p.slots[0];

  const dp = createPattern('drums', 2);
  const put = (lane, idx, vel) => { dp.steps[lane][idx] = vel; };
  for (const i of [0, 4, 8, 12, 16, 20, 24, 28]) put('kick', i, 0.95);
  for (const i of [4, 12, 20, 28]) { put('snare', i, 0.9); put('clap', i, 0.55); }
  for (const i of [2, 6, 10, 14, 18, 22, 26, 30]) put('chat', i, i % 8 === 6 ? 0.45 : 0.7);
  put('ohat', 14, 0.55); put('ohat', 30, 0.6);
  A.patterns[drums.id] = dp;

  // Bass follows roots: Am / F / C / G (offbeat eighths).
  const bp = { notes: [] };
  const roots = [[0, 33], [2, 29], [4, 36], [6, 31]]; // beat offset, midi
  for (const [off, root] of roots) {
    bp.notes.push(note(off + 0.5, root, 0.32, 0.92));
    bp.notes.push(note(off + 1.5, root, 0.32, 0.85));
  }
  bp.notes.push(note(7.75, 31, 0.2, 0.6)); // pickup
  A.patterns[bass.id] = bp;

  // Pad chords: Am7, Fmaj7, Cmaj7 (voice-led), G.
  const kp = { notes: [] };
  const chords = [
    [0, [57, 60, 64, 67]],
    [2, [53, 57, 60, 64]],
    [4, [55, 59, 60, 64]],
    [6, [50, 55, 59, 62]],
  ];
  for (const [start, pitches] of chords) {
    for (const pitch of pitches) kp.notes.push(note(start, pitch, 1.92, 0.62));
  }
  A.patterns[keys.id] = kp;

  // Lead phrase, pentatonic over the changes.
  const lp = { notes: [] };
  for (const [s, m, d, v] of [
    [0.5, 76, 0.45, 0.8], [1.0, 74, 0.45, 0.7], [1.5, 72, 0.9, 0.75], [3.0, 69, 0.75, 0.7],
    [4.5, 72, 0.45, 0.7], [5.0, 74, 0.45, 0.75], [5.5, 76, 0.9, 0.8], [6.75, 79, 1.1, 0.85],
  ]) lp.notes.push(note(s, m, d, v));
  A.patterns[lead.id] = lp;

  // --- Slot B: breakdown (2 bars) ---
  const B = p.slots[1];
  const dp2 = createPattern('drums', 2);
  const put2 = (lane, idx, vel) => { dp2.steps[lane][idx] = vel; };
  put2('kick', 0, 1);
  for (const i of [4, 12, 20, 28]) put2('clap', i, 0.6);
  for (let i = 0; i < 32; i++) put2('chat', i, i % 4 === 2 ? 0.6 : 0.3);
  put2('ohat', 30, 0.7);
  B.patterns[drums.id] = dp2;

  const bp2 = { notes: [] };
  bp2.notes.push(note(4.5, 33, 0.32, 0.8));
  bp2.notes.push(note(5.5, 33, 0.32, 0.85));
  bp2.notes.push(note(6.5, 31, 0.32, 0.85));
  bp2.notes.push(note(7.5, 29, 0.4, 0.9));
  B.patterns[bass.id] = bp2;

  B.patterns[keys.id] = JSON.parse(JSON.stringify(kp));
  B.patterns[lead.id] = { notes: [note(0.5, 81, 2.5, 0.7), note(4.5, 79, 2.0, 0.65)] };

  return p;
}
