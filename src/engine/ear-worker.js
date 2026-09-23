// Ear worker: runs analyzeSpan off the main thread. Messages:
//   { id, cmd: 'analyze', x: Float32Array (transferred), sr, words? }
//     -> { id, result }  (result.pitch.track kept; it's small)
//   { id, cmd: 'profile', x, sr, words?, hop }
//     -> { id, profile }  windowed analysis every `hop` seconds for the
//        whole buffer, so a later range query can be answered from cache.
import { analyzeSpan, pitchTrack, levelTrack, centroidTrack } from './ear.js';

self.onmessage = (ev) => {
  const { id, cmd } = ev.data;
  try {
    if (cmd === 'analyze') {
      const { x, sr, words } = ev.data;
      self.postMessage({ id, result: analyzeSpan(x, sr, { words }) });
    } else if (cmd === 'profile') {
      // Whole-asset tracks at fixed hops. A range query later slices these
      // instead of re-running pitch detection (the expensive part).
      const { x, sr } = ev.data;
      const pitch = pitchTrack(x, sr, { hop: 512 });
      const level = levelTrack(x, sr, { hop: 1024 });
      const tone = centroidTrack(x, sr, { hop: 1024 });
      self.postMessage({ id, profile: { sr, duration: x.length / sr, pitch, level, tone } });
    }
  } catch (err) {
    self.postMessage({ id, error: err.message });
  }
};
