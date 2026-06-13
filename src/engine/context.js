// Lazy AudioContext provider. Nothing audio-related is constructed until
// the first call, which keeps every module importable in non-browser
// environments (tests) and avoids autoplay-policy warnings.

let ctx = null;

export function getCtx() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC({ latencyHint: 'interactive' });
  }
  return ctx;
}

// Browsers suspend the context until a user gesture. Call this from any
// gesture handler before producing sound.
export function ensureRunning() {
  const c = getCtx();
  if (c.state !== 'running') return c.resume();
  return Promise.resolve();
}
