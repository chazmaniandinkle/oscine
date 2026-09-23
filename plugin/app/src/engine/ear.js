// The ear: measure audio the way a listener would describe it. Pure
// functions over Float32Array samples (a decoded AudioBuffer's channel, or
// a slice of one). No DOM, no Web Audio nodes -- runs in a worker or on
// an OfflineAudioContext result identically. Every number here is one
// that has been used in a real mixing conversation about a song:
//
//   pitch    f0 track (Hz) + note names, median / range, % voiced
//   level    RMS dBFS over the span and per window; peak; crest factor
//   tone     spectral centroid (brightness) -- hushed vs open
//   pace     words/sec and syllable-ish onsets from the word timings
//   compare  the same block for two spans, differenced
//
// Pitch: McLeod Pitch Method (NSDF autocorrelation) per hop. Fine for a
// single voice; not a polyphonic transcriber. ~0.5 cent resolution at
// 44.1k with parabolic interpolation on the NSDF peak.

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function hzToMidi(hz) { return 69 + 12 * Math.log2(hz / 440); }
export function midiToHz(m) { return 440 * Math.pow(2, (m - 69) / 12); }
export function midiToName(m) {
  const r = Math.round(m);
  return `${NOTE_NAMES[((r % 12) + 12) % 12]}${Math.floor(r / 12) - 1}`;
}
export function hzToName(hz) { return midiToName(hzToMidi(hz)); }
export const dB = v => 20 * Math.log10(Math.max(1e-9, v));

// -- level ---------------------------------------------------------------------
export function rms(x, a = 0, b = x.length) {
  let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, b - a));
}
export function peak(x, a = 0, b = x.length) {
  let p = 0; for (let i = a; i < b; i++) { const v = Math.abs(x[i]); if (v > p) p = v; }
  return p;
}
// Windowed RMS envelope in dBFS. hop in samples.
export function levelTrack(x, sr, { win = 2048, hop = 1024 } = {}) {
  const out = [];
  for (let i = 0; i + win <= x.length; i += hop) out.push({ t: i / sr, db: dB(rms(x, i, i + win)) });
  return out;
}

// -- tone ----------------------------------------------------------------------
// Spectral centroid via a small radix-2 FFT on Hann-windowed frames.
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}
export function centroidTrack(x, sr, { win = 2048, hop = 1024 } = {}) {
  const out = [], re = new Float32Array(win), im = new Float32Array(win);
  for (let i = 0; i + win <= x.length; i += hop) {
    for (let k = 0; k < win; k++) { re[k] = x[i + k] * (0.5 - 0.5 * Math.cos(2 * Math.PI * k / win)); im[k] = 0; }
    fft(re, im);
    let num = 0, den = 0;
    for (let k = 1; k < win / 2; k++) { const mag = Math.hypot(re[k], im[k]); num += k * mag; den += mag; }
    out.push({ t: i / sr, hz: den > 1e-9 ? (num / den) * sr / win : 0 });
  }
  return out;
}

// -- pitch (MPM) ---------------------------------------------------------------
function mpmFrame(x, off, win, sr, { fmin = 60, fmax = 1200, threshold = 0.9 } = {}) {
  const maxLag = Math.min(win - 1, Math.floor(sr / fmin)), minLag = Math.max(2, Math.floor(sr / fmax));
  const nsdf = new Float32Array(maxLag + 1);
  for (let tau = minLag; tau <= maxLag; tau++) {
    let acf = 0, m = 0;
    for (let i = 0; i + tau < win; i++) { const a = x[off + i], b = x[off + i + tau]; acf += a * b; m += a * a + b * b; }
    nsdf[tau] = m > 0 ? 2 * acf / m : 0;
  }
  // key maxima: first positive-zero-crossing peaks; pick the first over threshold*max
  const peaks = [];
  let tau = minLag;
  while (tau < maxLag) {
    while (tau < maxLag && nsdf[tau] <= 0) tau++;
    let best = tau;
    while (tau < maxLag && nsdf[tau] > 0) { if (nsdf[tau] > nsdf[best]) best = tau; tau++; }
    if (best > minLag && best < maxLag) peaks.push(best);
  }
  if (!peaks.length) return null;
  let hi = 0; for (const p of peaks) hi = Math.max(hi, nsdf[p]);
  const pick = peaks.find(p => nsdf[p] >= threshold * hi);
  if (pick == null || nsdf[pick] < 0.5) return null;
  // parabolic interpolation
  const a = nsdf[pick - 1], b = nsdf[pick], c = nsdf[pick + 1];
  const d = (a - c) / (2 * (a - 2 * b + c) || 1);
  const lag = pick + (Number.isFinite(d) ? d : 0);
  return { hz: sr / lag, clarity: b };
}
export function pitchTrack(x, sr, { win = 2048, hop = 512, fmin = 60, fmax = 1200, minRms = 0.005 } = {}) {
  const out = [];
  for (let i = 0; i + win <= x.length; i += hop) {
    if (rms(x, i, i + win) < minRms) { out.push({ t: i / sr, hz: null, clarity: 0 }); continue; }
    const r = mpmFrame(x, i, win, sr, { fmin, fmax });
    out.push({ t: i / sr, hz: r?.hz ?? null, clarity: r?.clarity ?? 0 });
  }
  return out;
}

// -- summaries -----------------------------------------------------------------
function median(arr) { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function quantile(arr, q) { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; }

// Everything about one span of mono samples. `words` are {start,end,word}
// already offset to the span (seconds from span start), optional.
export function analyzeSpan(x, sr, { words = null, pitch = true } = {}) {
  const dur = x.length / sr;
  const lv = levelTrack(x, sr);
  const dbs = lv.map(l => l.db).filter(d => d > -80);
  const ct = centroidTrack(x, sr).map(c => c.hz).filter(h => h > 0);
  const out = {
    duration: dur,
    level: { rmsDb: dB(rms(x)), peakDb: dB(peak(x)), medianDb: median(dbs), loudestDb: quantile(dbs, 0.95), quietestDb: quantile(dbs, 0.05) },
    tone: { centroidHz: median(ct) },
  };
  out.level.crestDb = out.level.peakDb - out.level.rmsDb;
  if (pitch) {
    const pt = pitchTrack(x, sr);
    const voiced = pt.filter(p => p.hz && p.clarity > 0.6);
    const midis = voiced.map(p => hzToMidi(p.hz));
    out.pitch = {
      voicedPct: pt.length ? Math.round(100 * voiced.length / pt.length) : 0,
      medianMidi: median(midis), lowMidi: quantile(midis, 0.05), highMidi: quantile(midis, 0.95),
      track: pt,
    };
    if (out.pitch.medianMidi != null) {
      out.pitch.median = midiToName(out.pitch.medianMidi);
      out.pitch.low = midiToName(out.pitch.lowMidi);
      out.pitch.high = midiToName(out.pitch.highMidi);
      out.pitch.rangeSemitones = Math.round(out.pitch.highMidi - out.pitch.lowMidi);
    }
  }
  if (words?.length) {
    const inSpan = words.filter(w => w.end > 0 && w.start < dur);
    const sung = inSpan.reduce((s, w) => s + Math.max(0, Math.min(w.end, dur) - Math.max(w.start, 0)), 0);
    out.pace = {
      words: inSpan.length,
      wordsPerSec: +(inSpan.length / Math.max(0.1, dur)).toFixed(2),
      wordsPerSecSung: +(inSpan.length / Math.max(0.1, sung)).toFixed(2),
      longest: inSpan.slice().sort((a, b) => (b.end - b.start) - (a.end - a.start))[0] ?? null,
      text: inSpan.map(w => w.word).join(' '),
    };
  }
  return out;
}

// A vs B: the deltas a mixer would say out loud.
export function compareSpans(a, b) {
  const d = {};
  d.levelDb = +(b.level.rmsDb - a.level.rmsDb).toFixed(1);
  d.centroidHz = Math.round((b.tone.centroidHz ?? 0) - (a.tone.centroidHz ?? 0));
  if (a.pitch?.medianMidi != null && b.pitch?.medianMidi != null) d.pitchSemitones = +(b.pitch.medianMidi - a.pitch.medianMidi).toFixed(1);
  if (a.pace && b.pace) d.wordsPerSec = +(b.pace.wordsPerSec - a.pace.wordsPerSec).toFixed(2);
  return d;
}

// Plain-English lines. This is the part that talks like the notes I'd write.
export function describe(r, label = 'span') {
  const L = [];
  L.push(`${label}: ${r.duration.toFixed(1)}s · RMS ${r.level.rmsDb.toFixed(1)} dBFS · peak ${r.level.peakDb.toFixed(1)} · crest ${r.level.crestDb.toFixed(1)} dB`);
  if (r.pitch?.median) L.push(`pitch: ${r.pitch.median} median, ${r.pitch.low}–${r.pitch.high} (${r.pitch.rangeSemitones} st), ${r.pitch.voicedPct}% voiced`);
  else if (r.pitch) L.push(`pitch: unvoiced (${r.pitch.voicedPct}% voiced)`);
  if (r.tone.centroidHz) L.push(`tone: centroid ${Math.round(r.tone.centroidHz)} Hz ${r.tone.centroidHz < 1500 ? '(dark/hushed)' : r.tone.centroidHz > 3000 ? '(bright/open)' : ''}`);
  if (r.pace) L.push(`pace: ${r.pace.words} words, ${r.pace.wordsPerSec} w/s (${r.pace.wordsPerSecSung} while singing)${r.pace.longest ? ` · longest "${r.pace.longest.word}" ${(r.pace.longest.end - r.pace.longest.start).toFixed(2)}s` : ''}`);
  return L;
}
export function describeDelta(d, la = 'A', lb = 'B') {
  const L = [];
  L.push(`${lb} vs ${la}: ${d.levelDb > 0 ? '+' : ''}${d.levelDb} dB`);
  if (d.pitchSemitones != null) L.push(`${d.pitchSemitones > 0 ? '+' : ''}${d.pitchSemitones} st median pitch`);
  L.push(`centroid ${d.centroidHz > 0 ? '+' : ''}${d.centroidHz} Hz ${d.centroidHz < -400 ? '(darker)' : d.centroidHz > 400 ? '(brighter)' : ''}`);
  if (d.wordsPerSec != null) L.push(`${d.wordsPerSec > 0 ? '+' : ''}${d.wordsPerSec} w/s`);
  return L;
}
