// Timed-text import/export for asset words ([{s,e,t}] in source seconds).
// Formats: SRT and WebVTT (one cue per word, so timing survives round-trip),
// and a word-level JSON that is just the array. Import accepts all three
// plus whisper's own JSON (segments[].words[]). Pure functions; no DOM.

const pad = (n, w = 2) => String(n).padStart(w, '0');
function tc(sec, sep) {
  const ms = Math.round(sec * 1000), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60, r = ms % 1000;
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(r, 3)}`;
}
function parseTc(str) {
  const m = /(\d+):(\d\d):(\d\d)[.,](\d{1,3})/.exec(str); if (!m) return null;
  return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4].padEnd(3, '0')) / 1000;
}

export function toSRT(words) {
  return words.map((w, i) => `${i + 1}\n${tc(w.s, ',')} --> ${tc(w.e, ',')}\n${w.t}\n`).join('\n');
}
export function toVTT(words) {
  return 'WEBVTT\n\n' + words.map(w => `${tc(w.s, '.')} --> ${tc(w.e, '.')}\n${w.t}\n`).join('\n');
}
export function toJSON(words) { return JSON.stringify(words, null, 1); }

// Parse any supported text into [{s,e,t}]. Multi-word cues (a normal SRT
// with a line per phrase) are split evenly across the cue's span so the
// lyrics bar still has a word to light; flagged with `approx: true`.
export function parseTimedText(text, { splitPhrases = true } = {}) {
  const trimmed = text.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const j = JSON.parse(trimmed);
    if (Array.isArray(j)) return j.filter(w => w && typeof w.t === 'string').map(w => ({ s: +w.s, e: +w.e, t: w.t }));
    if (j.segments) { // whisper JSON
      const out = [];
      for (const seg of j.segments) for (const w of seg.words ?? []) { const t = String(w.word ?? '').trim(); if (t) out.push({ s: +w.start, e: +w.end, t }); }
      return out;
    }
    throw new Error('Unrecognised JSON shape (want [{s,e,t}] or whisper segments)');
  }
  // SRT / VTT: blocks separated by blank lines; a timing line contains -->
  const out = [];
  for (const block of trimmed.replace(/\r/g, '').split(/\n\s*\n/)) {
    const lines = block.split('\n').filter(Boolean);
    const ti = lines.findIndex(l => l.includes('-->')); if (ti < 0) continue;
    const [a, b] = lines[ti].split('-->').map(x => parseTc(x.trim()));
    if (a == null || b == null) continue;
    const textLines = lines.slice(ti + 1).join(' ').replace(/<[^>]+>/g, '').trim();
    if (!textLines) continue;
    const toks = textLines.split(/\s+/);
    if (toks.length === 1 || !splitPhrases) { out.push({ s: a, e: b, t: textLines }); continue; }
    const step = (b - a) / toks.length;
    toks.forEach((t, i) => out.push({ s: +(a + i * step).toFixed(3), e: +(a + (i + 1) * step).toFixed(3), t, approx: true }));
  }
  return out;
}

// Shift + clip: words for a CLIP export (clip-local time) from asset words.
export function wordsForClipLocal(assetWords, clip) {
  const sp = 1; // export in source-time-relative seconds; the importer adds `in` back
  return assetWords.filter(w => w.e > clip.in && w.s < clip.out).map(w => ({ s: +((w.s - clip.in) * sp).toFixed(3), e: +((w.e - clip.in) * sp).toFixed(3), t: w.t }));
}
// Inverse: imported clip-local words -> asset words, merged over the clip's
// source span (existing words inside [in,out] are replaced).
export function mergeClipWords(assetWords, clip, localWords) {
  const shifted = localWords.map(w => ({ s: +(w.s + clip.in).toFixed(3), e: +(w.e + clip.in).toFixed(3), t: w.t }));
  const keep = (assetWords ?? []).filter(w => !(w.e > clip.in && w.s < clip.out));
  return [...keep, ...shifted].sort((a, b) => a.s - b.s);
}
