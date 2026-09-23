// Decoupled time-stretch / pitch-shift on decoded AudioBuffers. Phase vocoder
// (STFT, hop-ratio resampling of the analysis frames, phase propagation by
// instantaneous frequency), plus resample-and-stretch for pitch. Offline
// only: this produces a *derived variant* of an asset, cached by
// (sha256, stretch, semitones) -- the tier-3 cache key from the clip
// architecture doc. Playback never runs this in real time; it references
// the rendered buffer like any other asset bytes.
//
// Quality: fine for vocals and pads at 0.5x..2x; transients smear beyond
// that (no transient preservation). Good enough to audition; a later
// pass can swap in a better algorithm behind the same cache key.

const FFT = 2048;
const HOP_A = FFT / 4;

// -- tiny radix-2 FFT (in-place, split re/im) ---------------------------------
function fft(re, im, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = 2 * Math.PI / len * (inverse ? 1 : -1);
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

const HANN = new Float32Array(FFT);
for (let i = 0; i < FFT; i++) HANN[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / FFT);

// Stretch one channel by `ratio` (2 = twice as long). Phase vocoder with
// synthesis hop = HOP_A * ratio and phase propagation.
function stretchChannel(x, ratio) {
  const hopS = Math.max(1, Math.round(HOP_A * ratio));
  const frames = Math.max(1, Math.floor((x.length - FFT) / HOP_A) + 1);
  const outLen = (frames - 1) * hopS + FFT;
  const out = new Float32Array(outLen);
  const norm = new Float32Array(outLen);
  const re = new Float32Array(FFT), im = new Float32Array(FFT);
  const lastPhase = new Float32Array(FFT / 2 + 1);
  const sumPhase = new Float32Array(FFT / 2 + 1);
  const expect = 2 * Math.PI * HOP_A / FFT; // expected phase advance per bin per hop

  for (let f = 0; f < frames; f++) {
    const inOff = f * HOP_A, outOff = f * hopS;
    for (let i = 0; i < FFT; i++) { re[i] = (x[inOff + i] || 0) * HANN[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 0; k <= FFT / 2; k++) {
      const mag = Math.hypot(re[k], im[k]);
      const ph = Math.atan2(im[k], re[k]);
      // instantaneous frequency: deviation from the expected advance
      let d = ph - lastPhase[k] - k * expect;
      d = d - 2 * Math.PI * Math.round(d / (2 * Math.PI));
      const trueFreq = k * expect + d;
      lastPhase[k] = ph;
      sumPhase[k] += trueFreq * ratio;
      re[k] = mag * Math.cos(sumPhase[k]); im[k] = mag * Math.sin(sumPhase[k]);
      if (k > 0 && k < FFT / 2) { re[FFT - k] = re[k]; im[FFT - k] = -im[k]; }
    }
    fft(re, im, true);
    for (let i = 0; i < FFT; i++) { out[outOff + i] += re[i] * HANN[i]; norm[outOff + i] += HANN[i] * HANN[i]; }
  }
  for (let i = 0; i < outLen; i++) if (norm[i] > 1e-6) out[i] /= norm[i];
  return out;
}

// Linear-interp resample by `factor` (2 = half as long, an octave up).
function resample(x, factor) {
  const n = Math.max(1, Math.floor(x.length / factor));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * factor, j = Math.floor(p), t = p - j;
    out[i] = (x[j] || 0) * (1 - t) + (x[j + 1] || 0) * t;
  }
  return out;
}

// Public: derive a new AudioBuffer from `buffer`.
//   stretch    length multiplier, pitch preserved (1 = none)
//   semitones  pitch shift, length preserved (0 = none)
// Pitch shift = stretch by 2^(st/12) then resample back, so both paths share
// the vocoder. Returns a buffer in `ctx` (live or offline).
export function stretchBuffer(ctx, buffer, { stretch = 1, semitones = 0 } = {}) {
  const pitchFactor = Math.pow(2, semitones / 12);
  const totalStretch = stretch * pitchFactor; // vocoder ratio before resample
  const chans = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    let y = buffer.getChannelData(c);
    if (Math.abs(totalStretch - 1) > 1e-4) y = stretchChannel(y, totalStretch);
    if (Math.abs(pitchFactor - 1) > 1e-4) y = resample(y, pitchFactor);
    chans.push(y);
  }
  const out = ctx.createBuffer(chans.length, chans[0].length, buffer.sampleRate);
  chans.forEach((y, c) => out.copyToChannel(y, c));
  return out;
}

// Cache key per the architecture doc: content hash + the transform params.
export function derivedKey(sha256, { stretch = 1, semitones = 0 } = {}) {
  return `${sha256}:s${stretch.toFixed(4)}:p${semitones.toFixed(2)}`;
}
