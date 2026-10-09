// Offline render: bounce a project to an AudioBuffer with an
// OfflineAudioContext. This lives in the engine layer because it is pure
// audio (it reads project data, never mutates it) and it mirrors the live
// engine's signal path so an export sounds like what you heard: per-track
// fader/pan/sends, the shared tempo-synced delay and reverb buses, and the
// master glue compressor.
//
// It deliberately rebuilds the graph from scratch against the offline
// context rather than reusing the live nodes -- Web Audio nodes belong to
// one context. The instrument and effect classes are context-agnostic
// (they take a ctx), so they're reused directly; the scheduling mirrors
// transport.js (beats -> time, swing on odd 16ths).

import { EventBus } from '../core/bus.js';
import { faderGain, swingOffsetSec } from '../core/util.js';
import { createInstrument, getInstrumentDef } from './instruments/index.js';
import { DelayFX } from './effects/delay.js';
import { ReverbFX } from './effects/reverb.js';
import { buildPatternStrip, buildPatternMaster, scheduleSlotAutomation } from './patternmix.js';

// The mixer taper (faderGain) and swing math (swingOffsetSec) are shared with
// the live engine and transport via core/util, so an export matches playback
// by construction rather than by keeping two copies in step.

// Render `project` to an AudioBuffer.
//   slotIndex   which pattern slot to bounce (default 0 / A)
//   loops       how many times to repeat the loop (default 2)
//   tailSeconds extra time after the last note for FX/release decay
//   sampleRate  output rate (default 44100)
// Returns { buffer, durationSec, sampleRate, channels, loops, slotIndex }.
export async function renderProjectToBuffer(project, {
  slotIndex = 0,
  loops = 2,
  tailSeconds,
  sampleRate = 44100,
  sequence = null,   // song mode: slot indexes played in order, e.g. [0,1,2,2,3]
} = {}) {
  const OfflineCtx = (typeof OfflineAudioContext !== 'undefined' && OfflineAudioContext) ||
    (typeof webkitOfflineAudioContext !== 'undefined' && webkitOfflineAudioContext);
  if (!OfflineCtx) throw new Error('Offline rendering needs a browser AudioContext.');

  const slot = project.slots[slotIndex];
  if (!slot) throw new Error(`No slot at index ${slotIndex}.`);
  const seq = Array.isArray(sequence) && sequence.length ? sequence : null;
  if (seq) for (const i of seq) if (!project.slots[i]) throw new Error(`No slot at index ${i} in sequence.`);

  const bpm = project.bpm;
  const secPerBeat = 60 / bpm;
  const loopBeats = slot.bars * 4;
  const loopSec = loopBeats * secPerBeat;
  const seqSec = seq ? seq.reduce((a, i) => a + project.slots[i].bars * 4 * secPerBeat, 0) : 0;
  const tail = tailSeconds ?? Math.max(project.fx.verbSize ?? 0, 1) + 1.5;
  // An arrangement (v2 clips) defines the song length in seconds; the
  // pattern loop then plays under it only if a caller asks (loops > 0 and
  // there are patterns). Without an arrangement, the loop is the song.
  const hasArrangement = !!project.arrangement?.placements?.length;
  const { ClipPlayer } = hasArrangement ? await import('./clips.js') : {};
  const arrSec = hasArrangement ? ClipPlayer.duration(project) : 0;
  const patSec = seq ? seqSec : loopSec * (hasArrangement ? 0 : loops);
  const totalSec = Math.max(patSec, arrSec) + tail;
  const length = Math.max(1, Math.ceil(totalSec * sampleRate));

  const ctx = new OfflineCtx(2, length, sampleRate);

  // A throwaway store-shim + bus: the FX classes read project.fx/bpm and
  // subscribe to a bus. We give them a private bus so nothing leaks, and a
  // minimal store exposing what they read. Note: this bus never emits after
  // construction, so DelayFX/ReverbFX must derive every parameter (including
  // the BPM-synced delay time and the reverb IR) from project at init -- which
  // they do today. If an FX class ever starts depending on a later bus event,
  // that value would be missing here and exports would drift from playback.
  const bus = new EventBus();
  const storeShim = { project };

  // -- master chain (mirror of AudioEngine) --
  const masterIn = ctx.createGain();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -12;
  comp.knee.value = 18;
  comp.ratio.value = 3;
  comp.attack.value = 0.004;
  comp.release.value = 0.22;
  const masterGain = ctx.createGain();
  masterGain.gain.value = project.masterVolume;
  // Pattern master chain sits after the glue comp, before the volume (live engine mirrors this).
  const masterChain = buildPatternMaster(ctx, project);
  masterIn.connect(comp);
  comp.connect(masterChain.input);
  masterChain.output.connect(masterGain);
  masterGain.connect(ctx.destination);

  // -- shared FX buses --
  const delayFx = new DelayFX(ctx, storeShim, bus);
  const reverbFx = new ReverbFX(ctx, storeShim, bus);
  delayFx.output.connect(masterIn);
  reverbFx.output.connect(masterIn);

  // -- per-track channels --
  const anySolo = project.tracks.some(t => t.channel.solo);
  const channels = new Map();
  for (const track of project.tracks) {
    const instrument = createInstrument(track.instrument.type, ctx, track.instrument.params);
    const chanGain = ctx.createGain();
    const panner = ctx.createStereoPanner();
    const sendDelay = ctx.createGain();
    const sendReverb = ctx.createGain();
    chanGain.gain.value = faderGain(track.channel, anySolo);
    panner.pan.value = track.channel.pan;
    sendDelay.gain.value = track.channel.sendDelay;
    sendReverb.gain.value = track.channel.sendReverb;

    // instrument -> inserts -> automation gain -> fader -> pan -> master + sends
    const strip = buildPatternStrip(ctx, track);
    instrument.output.connect(strip.input);
    strip.output.connect(chanGain);
    chanGain.connect(panner);
    panner.connect(masterIn);
    panner.connect(sendDelay);
    sendDelay.connect(delayFx.input);
    panner.connect(sendReverb);
    sendReverb.connect(reverbFx.input);

    channels.set(track.id, { track, instrument, strip, panner });
  }

  // -- schedule every event across all loop passes --
  // With an arrangement present the pattern loop is not part of the bounce
  // (loops is treated as 0) -- the clips ARE the song. Pattern tracks still
  // build their channels above so the graph matches playback if a later
  // version mixes both.
  const passes = hasArrangement ? 0 : loops;
  // Song mode: one pass per sequence entry, each at its own slot's length.
  // Otherwise: `passes` repeats of the chosen slot.
  const plan = [];
  if (seq) { let at = 0; for (const i of seq) { plan.push({ s: project.slots[i], at }); at += project.slots[i].bars * 4 * secPerBeat; } }
  else for (let pass = 0; pass < passes; pass++) plan.push({ s: slot, at: pass * loopSec });
  // Notes are collected first and scheduled just in time: every 2 s of song
  // the offline render suspends and builds only the next window's voices.
  // Building all voices up front made render time grow faster than song
  // length (a 22 s section took 13 s; the 110 s song didn't finish in 7 min),
  // because every future node sits in the graph from frame 0.
  const events = [];
  for (const { track, instrument } of channels.values()) {
    const def = getInstrumentDef(track.instrument.type);
    for (const { s, at: passStart } of plan) {
      const pattern = s.patterns[track.id];
      if (!pattern) continue;
      const lb = s.bars * 4;
      if (def.kind === 'drums') {
        const stepsPerLoop = s.bars * 16;
        for (let idx = 0; idx < stepsPerLoop; idx++) {
          const localBeat = idx / 4;
          for (const lane of def.lanes) {
            const vel = pattern.steps?.[lane.id]?.[idx] || 0;
            if (vel > 0) {
              const time = passStart + localBeat * secPerBeat + swingOffsetSec(localBeat, project.swing, secPerBeat);
              events.push({ time, run: () => instrument.trigger(lane.id, time, vel) });
            }
          }
        }
      } else {
        for (const note of pattern.notes ?? []) {
          if (note.start >= lb - 1e-9) continue; // beyond the loop: silent
          const time = passStart + note.start * secPerBeat + swingOffsetSec(note.start, project.swing, secPerBeat);
          events.push({ time, run: () => instrument.noteOn(time, note.pitch, note.vel, note.dur * secPerBeat) });
        }
      }
    }
  }
  // Slot automation: audio-rate params are scheduled now (curves); instrument
  // params come back as k-rate jobs and ride the event queue.
  for (let pi = 0; pi < plan.length; pi++) {
    const { s, at: passStart } = plan[pi];
    const prevSlot = pi > 0 && plan[pi - 1].s !== s ? plan[pi - 1].s : null;
    if (!s.automation?.length && !prevSlot?.automation?.length) continue;
    events.push(...scheduleSlotAutomation(s, { strips: channels, master: masterChain, passStart, secPerBeat, beats: s.bars * 4, prevSlot, project }));
  }
  events.sort((a, b) => a.time - b.time);
  const WINDOW = 2, LEAD = 0.25;
  let ei = 0;
  const scheduleUntil = (end) => { while (ei < events.length && events[ei].time < end) events[ei++].run(); };
  scheduleUntil(WINDOW);
  for (let k = 1; k * WINDOW - LEAD < totalSec && ei < events.length; k++) {
    const end = (k + 1) * WINDOW;
    // suspend() needs a render-quantum boundary (128 frames)
    const at = Math.floor((k * WINDOW - LEAD) * sampleRate / 128) * 128 / sampleRate;
    ctx.suspend(at).then(() => { scheduleUntil(end); ctx.resume(); });
  }

  // -- arrangement clips: decode into THIS context and schedule from 0 --
  // Clips go straight to masterIn (no per-track FX sends yet), same as the
  // live path in transport.startClips.
  if (hasArrangement) {
    const player = new ClipPlayer(ctx, project, { destination: masterIn });
    await player.prepare();
    player.start(0, 0);
  }

  const buffer = await ctx.startRendering();
  return {
    buffer,
    durationSec: buffer.duration,
    sampleRate: buffer.sampleRate,
    channels: buffer.numberOfChannels,
    loops: passes,
    slotIndex,
    arrangement: hasArrangement,
  };
}
