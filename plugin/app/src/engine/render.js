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
import { createInstrument, getInstrumentDef } from './instruments/index.js';
import { DelayFX } from './effects/delay.js';
import { ReverbFX } from './effects/reverb.js';

// Mirror of AudioEngine.applyMixState's fader taper, so levels match.
function faderGain(channel, anySolo) {
  const audible = !channel.mute && (!anySolo || channel.solo);
  return audible ? Math.pow(channel.gain, 2) * 1.4 : 0;
}

// Mirror of Transport.swingOffset: delay odd 16ths by up to 55% of a 16th.
function swingOffset(localBeat, swing, secPerBeat) {
  if (swing <= 0.001) return 0;
  const pos16 = localBeat * 4;
  const idx = Math.round(pos16);
  if (Math.abs(pos16 - idx) > 0.02 || idx % 2 === 0) return 0;
  return swing * 0.55 * (secPerBeat / 4);
}

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
} = {}) {
  const OfflineCtx = (typeof OfflineAudioContext !== 'undefined' && OfflineAudioContext) ||
    (typeof webkitOfflineAudioContext !== 'undefined' && webkitOfflineAudioContext);
  if (!OfflineCtx) throw new Error('Offline rendering needs a browser AudioContext.');

  const slot = project.slots[slotIndex];
  if (!slot) throw new Error(`No slot at index ${slotIndex}.`);

  const bpm = project.bpm;
  const secPerBeat = 60 / bpm;
  const loopBeats = slot.bars * 4;
  const loopSec = loopBeats * secPerBeat;
  const tail = tailSeconds ?? Math.max(project.fx.verbSize ?? 0, 1) + 1.5;
  const totalSec = loopSec * loops + tail;
  const length = Math.max(1, Math.ceil(totalSec * sampleRate));

  const ctx = new OfflineCtx(2, length, sampleRate);

  // A throwaway store-shim + bus: the FX classes read project.fx/bpm and
  // subscribe to a bus. We give them a private bus so nothing leaks, and a
  // minimal store exposing what they read.
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
  masterIn.connect(comp);
  comp.connect(masterGain);
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

    instrument.output.connect(chanGain);
    chanGain.connect(panner);
    panner.connect(masterIn);
    panner.connect(sendDelay);
    sendDelay.connect(delayFx.input);
    panner.connect(sendReverb);
    sendReverb.connect(reverbFx.input);

    channels.set(track.id, { track, instrument });
  }

  // -- schedule every event across all loop passes --
  for (const { track, instrument } of channels.values()) {
    const def = getInstrumentDef(track.instrument.type);
    const pattern = slot.patterns[track.id];
    if (!pattern) continue;

    for (let pass = 0; pass < loops; pass++) {
      const passStart = pass * loopSec;
      if (def.kind === 'drums') {
        const stepsPerLoop = slot.bars * 16;
        for (let idx = 0; idx < stepsPerLoop; idx++) {
          const localBeat = idx / 4;
          for (const lane of def.lanes) {
            const vel = pattern.steps?.[lane.id]?.[idx] || 0;
            if (vel > 0) {
              const time = passStart + localBeat * secPerBeat + swingOffset(localBeat, project.swing, secPerBeat);
              instrument.trigger(lane.id, time, vel);
            }
          }
        }
      } else {
        for (const note of pattern.notes ?? []) {
          if (note.start >= loopBeats - 1e-9) continue; // beyond the loop: silent
          const time = passStart + note.start * secPerBeat + swingOffset(note.start, project.swing, secPerBeat);
          instrument.noteOn(time, note.pitch, note.vel, note.dur * secPerBeat);
        }
      }
    }
  }

  const buffer = await ctx.startRendering();
  return {
    buffer,
    durationSec: buffer.duration,
    sampleRate: buffer.sampleRate,
    channels: buffer.numberOfChannels,
    loops,
    slotIndex,
  };
}
