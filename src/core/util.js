// Small shared helpers. No dependencies, no DOM/audio assumptions
// (safe to import from node for tests).

let uidCounter = 0;
export function uid(prefix = 'id') {
  uidCounter = (uidCounter + 1) % 0xffff;
  return `${prefix}_${Date.now().toString(36)}${uidCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;

export const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export function midiName(m) {
  return NOTE_NAMES[m % 12] + (Math.floor(m / 12) - 1);
}
export const isBlackKey = (m) => [1, 3, 6, 8, 10].includes(m % 12);

export function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function throttle(fn, ms) {
  let last = 0;
  return (...args) => {
    const now = performance.now();
    if (now - last >= ms) { last = now; fn(...args); }
  };
}

export function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// Trigger a file download in the browser.
export function downloadText(filename, text, mime = 'application/json') {
  downloadBlob(filename, new Blob([text], { type: mime }));
}

// Download arbitrary bytes (Uint8Array/ArrayBuffer/Blob) as a file. No-op
// outside a browser so the command layer stays importable in node tests.
export function downloadBlob(filename, data, mime = 'application/octet-stream') {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return;
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Map a 0..1 normalized position to a value, linearly or exponentially.
export function denorm(n, min, max, curve = 'lin') {
  n = clamp(n, 0, 1);
  if (curve === 'log') return min * Math.pow(max / min, n);
  return min + (max - min) * n;
}
export function norm(v, min, max, curve = 'lin') {
  if (curve === 'log') return clamp(Math.log(v / min) / Math.log(max / min), 0, 1);
  return clamp((v - min) / (max - min), 0, 1);
}

export function roundTo(v, step) {
  if (!step) return v;
  return Math.round(v / step) * step;
}

// -- shared audio math (no audio nodes; just numbers) ----------------------
// These live here so the live path and the offline renderer compute identical
// values from one definition. Pure functions, safe to import anywhere.

// Audio-tapered channel fader gain, accounting for solo. Used by the live
// engine's mixer and the offline WAV render, so an export matches playback.
export function faderGain(channel, anySolo) {
  const audible = !channel.mute && (!anySolo || channel.solo);
  return audible ? Math.pow(channel.gain, 2) * 1.4 : 0;
}

// Swing offset in seconds for a grid position: delays odd 16ths by up to 55%
// of a 16th, leaving even positions untouched. Used by the transport (live
// scheduling) and the offline render.
export function swingOffsetSec(localBeat, swing, secPerBeat) {
  if (swing <= 0.001) return 0;
  const pos16 = localBeat * 4;
  const idx = Math.round(pos16);
  if (Math.abs(pos16 - idx) > 0.02 || idx % 2 === 0) return 0;
  return swing * 0.55 * (secPerBeat / 4);
}
