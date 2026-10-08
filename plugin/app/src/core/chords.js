// Chord symbols -> MIDI pitches. Pure; no DOM. Root voiced in `octave`
// (C4 = 60), chord tones stacked upward from it, slash bass placed below.
// Covers the symbols a producer types: triads, 6, 6/9, 7, maj7, m7, m7b5, dim7,
// sus2/4, add9, 9/11/13 (+ maj/m), altered b9 #9 #11 b13, and /bass.

const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function parseRoot(s) {
  const m = /^([A-Ga-g])([#b]?)/.exec(s);
  if (!m) throw new Error(`Bad chord '${s}': must start with a note letter A-G.`);
  let pc = PC[m[1].toUpperCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return { pc: (pc + 12) % 12, rest: s.slice(m[0].length) };
}

// quality -> semitone intervals above the root
function intervals(q) {
  const has = (re) => re.test(q);
  let third = 4, fifth = 7;
  const iv = new Set();
  if (/^(m(?!aj)|min|-)/.test(q)) third = 3;
  if (has(/dim|°/)) { third = 3; fifth = 6; }
  if (has(/aug|\+(?!\d)/)) fifth = 8;
  if (has(/sus2/)) third = 2;
  else if (has(/sus4?/)) third = 5;
  if (has(/m7b5|ø/)) { third = 3; fifth = 6; iv.add(10); }
  iv.add(0); iv.add(third); iv.add(fifth);
  const maj = has(/maj|Δ|M(?=\d)/);
  const ext = (q.replace(/add\d+/g, '').match(/(?:maj|m|min|dim)?(13|11|9|7|6)/) || [])[1];
  const seventh = has(/dim7/) ? 9 : maj ? 11 : 10;
  if (has(/6\/9|69/)) { iv.add(9); iv.add(14); }
  else if (ext === '6') iv.add(9);
  else if (ext === '7') iv.add(seventh);
  else if (ext === '9') { iv.add(seventh); iv.add(14); }
  else if (ext === '11') { iv.add(seventh); iv.add(14); iv.add(17); }
  else if (ext === '13') { iv.add(seventh); iv.add(14); iv.add(21); }
  if (has(/add9|add2/)) iv.add(14);
  if (has(/add11|add4/)) iv.add(17);
  if (has(/b9/)) { iv.delete(14); iv.add(13); }
  if (has(/#9/)) { iv.delete(14); iv.add(15); }
  if (has(/#11/)) { iv.delete(17); iv.add(18); }
  if (has(/b13/)) { iv.delete(21); iv.add(20); }
  if (has(/b5/) && !has(/m7b5/)) { iv.delete(7); iv.add(6); }
  if (has(/no3/)) { iv.delete(3); iv.delete(4); }
  if (has(/^5$/)) { iv.clear(); iv.add(0); iv.add(7); }
  return [...iv].sort((a, b) => a - b);
}

export function chordPitches(symbol, octave = 3) {
  const [main, bass] = String(symbol).trim().split('/').length === 2 && !/6\/9/.test(symbol)
    ? String(symbol).trim().split('/') : [String(symbol).trim(), null];
  const { pc, rest } = parseRoot(main);
  const rootMidi = 12 * (octave + 1) + pc;
  const out = intervals(rest).map(i => rootMidi + i);
  if (bass) {
    const b = parseRoot(bass).pc;
    let bm = 12 * (octave + 1) + b;
    while (bm >= out[0]) bm -= 12;
    out.unshift(bm);
  }
  return out;
}
