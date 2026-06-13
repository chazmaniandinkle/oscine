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
  const blob = new Blob([text], { type: mime });
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
