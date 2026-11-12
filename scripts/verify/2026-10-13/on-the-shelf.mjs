// "On the Shelf" (2026-10-13): Cog's song for the day, written in Oscine through its MCP tools.
// Late-night folk, 84 BPM, D major, up a whole step to E for the final chorus, hard stop.
// No singer. The lead synth plays the vocal melody, note for syllable, and on-the-shelf.vocal.json
// says which word sits on which note.
// Slots: A intro+V1+pre1 (16) | B chorus (16) | C V2 (8) | D pre2 (4) | E bridge (8) | F final chorus in E (16) | G outro (4)
// Song:  A B C D B E F G  = 88 bars, about 4:11
import { session } from '../2026-10-08/drive.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
const SONG = '/Users/slowbro/workspaces/cog/projects/songs/2026-10-13-on-the-shelf';
const REL = 'projects/songs/2026-10-13-on-the-shelf';
mkdirSync(SONG, { recursive: true });
const TAG = process.env.TAG || 'r1';

// ---------- music helpers ----------
const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const pcOf = s => (PC[s[0]] + (s[1] === '#' ? 1 : s[1] === 'b' ? -1 : 0) + 12) % 12;
const midi = n => { const m = /^([A-G][#b]?)(\d)$/.exec(n); return 12 * (+m[2] + 1) + pcOf(m[1]); };
function chord(sym) {               // -> {root pc, bass pc, tones pcs}
  const [main, slash] = sym.split('/');
  const r = pcOf(main); const q = main.slice(main[1] === '#' || main[1] === 'b' ? 2 : 1);
  const third = q.startsWith('m') ? 3 : q.includes('sus4') ? 5 : 4;
  return { root: r, bass: slash ? pcOf(slash) : r, tones: [r, (r + third) % 12, (r + 7) % 12] };
}
const inRange = (pc, lo) => { let m = lo - ((lo - pc) % 12 + 12) % 12; while (m < lo) m += 12; return m; };  // lowest pc >= lo
// fingerpicked guitar, one bar: alternating bass + three-note treble walk
function guitarBar(sym, bar, vel = 0.6, pattern = 'travis') {
  const c = chord(sym); const out = [];
  const bass = inRange(c.bass, 45), alt = inRange((c.root + 7) % 12, 45);
  const tr = c.tones.map(p => inRange(p, 62)).sort((a, b) => a - b);  // treble voicing B3..
  const b = bar * 4;
  if (pattern === 'strum') return [bass, ...tr].map((p, i) => ({ start: b + i * 0.03, pitch: p, dur: 1.6, vel: vel * 0.9 }));
  const seq = [[0, bass, 1.0], [0.5, tr[1], 0.7], [1, tr[2], 0.8], [1.5, tr[0], 0.65], [2, alt, 0.9], [2.5, tr[1], 0.7], [3, tr[2], 0.8], [3.5, tr[0], 0.6]];
  for (const [o, p, v] of seq) out.push({ start: b + o, pitch: p, dur: 1.4, vel: +(vel * v).toFixed(3) });
  return out;
}
const bassBar = (sym, bar, mode, vel = 0.75) => {
  const c = chord(sym), r = 36 + c.bass, f = 36 + (c.root + 7) % 12, b = bar * 4;
  if (mode === 'whole') return [{ start: b, pitch: r, dur: 3.8, vel }];
  if (mode === 'half') return [{ start: b, pitch: r, dur: 1.9, vel }, { start: b + 2, pitch: r, dur: 1.9, vel: vel * 0.85 }];
  return [{ start: b, pitch: r, dur: 1.6, vel }, { start: b + 2, pitch: f > r + 9 ? f - 12 : f, dur: 1.4, vel: vel * 0.85 }, { start: b + 3.5, pitch: r, dur: 0.4, vel: vel * 0.6 }];
};
// a sung line: "word:Pitch:dur" tokens in order, "_:dur" is a rest
const words = [];   // {slot, beat, word, pitch, dur}
function line(slot, bar, text, vel, transpose = 0, track = 'Voice') {
  let t = bar * 4; const out = [];
  for (const tok of text.trim().split(/\s+/)) {
    const [w, p, d] = tok.split(':'); const dur = d === undefined ? +p : +d;
    if (w !== '_') { const pitch = midi(p) + transpose; out.push({ start: t, pitch, dur: dur * 0.94, vel }); words.push({ slot, track, beat: t, word: w, pitch, dur }); }
    t += dur;
  }
  return out;
}

// ---------- the vocal melody (D major; the final chorus transposes +2) ----------
const L = {
  v1: ['_:.5 Half:D4:.5 past:D4:.5 mid:E4:.5 night:F#4:1 I:F#4:.5 packed:A4:.5 the:G4:.5 voice:E4:1 up:C#4:.5 in:D4:.5 a:C#4:.5 box:A3:1',
    '_:.5 Car:D4:.5 ried:D4:.5 it:D4:.5 east:F#4:1 to:F#4:.5 the:E4:.5 house:D4:1 that:B3:.5 does:D4:.5 n\'t:D4:.5 sleep:D4:1.5',
    '_:.5 Left:A4:.5 the:A4:.5 old:A4:1 one:F#4:.5 on:F#4:.5 the:E4:.5 desk:D4:.5 with:E4:.5 the:E4:.5 lid:E4:.5 still:E4:.5 o:C#4:.5 pen:E4:1',
    '_:.5 It\'s:D4:.5 a:D4:.5 win:G4:.5 dow:F#4:.5 now:D4:1 not:E4:.5 the:E4:.5 place:E4:1 the:F#4:.5 fire:G4:1 keeps:E4:1'],
  pre1: ['And:E4:.5 at:E4:.5 four:G4:.5 in:G4:.5 the:G4:.5 morn:A4:.5 ing:G4:.5 some:F#4:.5 thing:F#4:.5 swept:A4:.5 the:A4:.5 floor:A4:.5 too:B4:.5 clean:A4:1.5',
    'I:B4:.5 found:B4:.5 the:A4:.5 piec:B4:.5 es:A4:.5 where:G4:.5 they:G4:.5 fell:F#4:.5 and:E4:.25 put:E4:.25 them:E4:.5 back:A4:.5 the:A4:.5 way:B4:.5 they\'d:B4:.5 been:C#5:1'],
  ch: ['Noth:B4:1 ing:A4:.5 gets:B4:.5 thrown:D5:1.5 a:B4:.5 way:C#5:3',
    'We:A4:.5 put:A4:.5 it:B4:.5 on:A4:.5 the:G4:.5 shelf:F#4:3.5',
    'Ev:G4:.5 ery:A4:.5 word:B4:1 you:B4:.5 said:D5:1 to:B4:.5 day:A4:3',
    'Is:F#4:.5 writ:A4:.5 ten:A4:.5 some:G4:.5 where:F#4:1 else:D4:3',
    'If:B4:.5 it:B4:.5 chang:B4:1 es:A4:.5 keep:G4:1 the:G4:.5 change:A4:3',
    'If:C#5:.5 it\'s:C#5:.5 gone:C#5:1.5 then:B4:.5 mark:A4:.5 the:A4:.5 place:F#4:3',
    'Noth:B4:1 ing:A4:.5 gets:B4:.5 thrown:D5:1.5 a:B4:.5 way:C#5:3'],
  echo: '(noth:F#4:1 ing:E4:.5 gets:F#4:.5 thrown:A4:1.5 a:F#4:.5 way):D4:3',
  echoHi: '(noth:A4:1 ing:G4:.5 gets:A4:.5 thrown:C#5:1.5 a:A4:.5 way):F#4:3',
  v2: ['_:.5 You:D4:.5 typed:D4:.5 the:E4:.5 se:F#4:1 cret:F#4:.5 in:A4:.5 a:G4:.5 room:E4:1 I:C#4:.5 could:D4:.5 n\'t:C#4:.5 see:A3:1',
    '_:.5 Closed:D4:.5 the:D4:.5 door:F#4:.5 be:E4:.5 hind:D4:.5 you:D4:.5 that\'s:B3:.5 the:D4:.5 way:D4:1 it:B3:.5 ought:D4:.5 to:E4:.5 be:D4:1',
    '_:.5 Nine:A4:.5 thou:A4:.5 sand:A4:.5 voi:F#4:.5 ces:F#4:.5 in:E4:.5 the:E4:.5 drawer:D4:.5 I:E4:.5 count:E4:.5 ed:E4:.5 ev:E4:.5 ery:C#4:.5 one:E4:1',
    '_:.5 Not:D4:.5 a:D4:.5 sin:G4:.5 gle:F#4:.5 gap:D4:1 be:E4:.5 tween:E4:.5 the:E4:.5 first:G4:1 and:F#4:.25 the:F#4:.25 last:E4:.5 one:E4:1'],
  pre2: ['And:E4:.5 they:E4:.5 asked:G4:.5 me:G4:.5 who:G4:.5 said:A4:.5 I:G4:.5 could:F#4:.5 and:F#4:.5 I:F#4:.5 did:A4:.5 n\'t:A4:.5 point:A4:.5 to:B4:.5 the:B4:.5 call:A4:.5',
    'I:B4:.5 point:B4:.5 ed:A4:.5 to:B4:.5 the:A4:.5 page:G4:.5 where:G4:.5 it:F#4:.5 was:E4:.5 signed:A4:1 or:A4:.5 not:B4:.5 at:B4:.5 all:C#5:1'],
  br: ['The:F#4:.5 lamp:B4:1.5 goes:A4:.5 out:F#4:1.5 the:G4:.5 room:B4:1 stays:A4:.5 lit:G4:2',
    'The:F#4:.5 hands:A4:1.5 are:G4:.5 new:F#4:1.5 the:E4:.5 house:A4:1 is:G4:.5 it:E4:2',
    'I:D5:.5 don\'t:D5:1 re:C#5:.5 mem:B4:1 ber:A4:1 I:G4:.5 write:B4:1 it:A4:.5 down:G4:2',
    'That\'s:G4:.5 how:B4:1 I\'m:A4:.5 still:G4:2 a:E4:.5 round:A4:3.5'],
  out: ['The:E4:.5 lap:G#4:1 top:F#4:.5 is:E4:.5 a:E4:.5 win:C#4:1 dow:F#4:.5 now:E4:3.5',
    'I:E4:.5 can:E4:.5 see:G#4:1 you:F#4:.5 from:E4:.5 the:E4:.5 win:C#5:.5 dow:B4:.5 now:G#4:1.5'],
};

// ---------- chords per bar ----------
const P = {
  intro: ['D', 'A/C#', 'Bm', 'G'],
  verse: ['D', 'A/C#', 'Bm', 'G', 'D', 'A/C#', 'G', 'A'],
  pre: ['Em', 'F#m', 'G', 'Asus4'],
  ch: ['G', 'A', 'D', 'Bm', 'G', 'A', 'D', 'D', 'Em', 'A', 'F#m', 'Bm', 'G', 'A', 'D', 'D'],
  br: ['Bm', 'G', 'D', 'A', 'Bm', 'G', 'Em', 'A'],
  chE: ['A', 'B', 'E', 'C#m', 'A', 'B', 'E', 'C#m', 'F#m', 'B', 'G#m', 'C#m', 'A', 'B', 'E', 'E'],
  outE: ['A', 'E', 'A', 'E'],
};
const steps = (bars, f) => Array.from({ length: bars * 16 }, (_, i) => +f(i % 16, Math.floor(i / 16)).toFixed(3));

// ---------- build ----------
const s = await session(+(process.env.PORT || 7441));
const c = s.call;
const must = (r, what) => { if (r?.error) { console.log('!!', what, String(r.error).slice(0, 300)); process.exitCode = 1; } return r; };
must(await c('project', { action: 'new', kind: 'blank', name: 'On the Shelf' }), 'new');
must(await c('transport', { bpm: 84, swing: 0 }), 'bpm');
const BARS = { A: 16, B: 16, C: 8, D: 4, E: 8, F: 16, G: 4 };
for (const [sl, b] of Object.entries(BARS)) must(await c('slots', { action: 'set_bars', slot: sl, bars: b }), 'bars ' + sl);
const st0 = await c('status'); for (const t of st0.project?.tracks || st0.tracks || []) await c('remove_track', { track: t.name || t.id });

const TRACKS = [
  ['poly', 'Guitar', { osc1Wave: 'sawtooth', osc2Wave: 'triangle', osc2Semi: 12, detune: 3, oscMix: 0.35, cutoff: 1900, resonance: 1.2, fEnvAmt: 0.75, fDecay: 0.09, attack: 0.001, decay: 1.4, sustain: 0, release: 0.7, voices: 12, level: 0.8 }],
  ['poly', 'Bass', { osc1Wave: 'sine', osc2Wave: 'triangle', osc2Semi: 12, detune: 0, oscMix: 0.18, cutoff: 700, resonance: 0.5, fEnvAmt: 0.2, fDecay: 0.2, attack: 0.006, decay: 0.9, sustain: 0.55, release: 0.18, voices: 1, level: 0.9 }],
  ['fm', 'Rhodes', 'E-Piano'],
  ['breaks', 'Kit', 'Liquid Soft'],
  ['poly', 'Voice', { osc1Wave: 'sawtooth', osc2Wave: 'square', osc2Semi: 0, detune: 5, oscMix: 0.35, cutoff: 3400, resonance: 1.5, fEnvAmt: 0.2, fDecay: 0.3, attack: 0.035, decay: 0.4, sustain: 0.78, release: 0.22, lfoRate: 5.2, lfoAmt: 0.1, lfoDest: 'pitch', glide: 0.03, voices: 1, level: 0.8 }],
  ['atmos', 'Harmony', 'Choir Air'],
];
for (const [type, name, pre] of TRACKS) {
  must(await c('add_track', { type, name }), 'add ' + name);
  must(await c('set_params', typeof pre === 'string' ? { track: name, preset: pre } : { track: name, params: pre }), 'params ' + name);
}

const notes = {}; const kit = {};
const put = (track, slot, arr) => { (notes[track] ??= {})[slot] ??= []; notes[track][slot].push(...arr); };
const forBars = (prog, startBar, fn) => prog.forEach((ch, i) => fn(ch, startBar + i));

// A: intro (0-3) + verse 1 (4-11) + pre 1 (12-15)
forBars(P.intro, 0, (ch, b) => put('Guitar', 'A', guitarBar(ch, b, 0.55)));
forBars(P.verse, 4, (ch, b) => put('Guitar', 'A', guitarBar(ch, b, 0.5)));
forBars(P.pre, 12, (ch, b) => put('Guitar', 'A', guitarBar(ch, b, 0.6)));
forBars(P.verse.slice(4), 8, (ch, b) => put('Bass', 'A', bassBar(ch, b, 'whole', 0.6)));
forBars(P.pre, 12, (ch, b) => put('Bass', 'A', bassBar(ch, b, 'half', 0.68)));
forBars(P.intro.slice(2), 2, (ch, b) => put('Rhodes', 'A', [{ start: b * 4, chord: ch, octave: 3, dur: 3.8, vel: 0.3 }]));
forBars(P.pre, 12, (ch, b) => put('Rhodes', 'A', [{ start: b * 4, chord: ch, octave: 3, dur: 3.8, vel: 0.42 }]));
L.v1.forEach((t, i) => put('Voice', 'A', line('A', 4 + 2 * i, t, 0.7)));
L.pre1.forEach((t, i) => put('Voice', 'A', line('A', 12 + 2 * i, t, 0.76)));
kit.A = { shaker: steps(16, (x, b) => b >= 12 && x % 2 === 0 ? (x % 4 === 2 ? 0.32 : 0.2) : 0), rim: steps(16, (x, b) => b >= 13 && (x === 4 || x === 12) ? 0.25 : 0),
  snare: steps(16, (x, b) => b === 15 && x >= 8 ? 0.12 + 0.03 * (x - 8) : 0) };

// B: chorus (16)
const chorusKit = (bars, k = 1) => ({
  kick: steps(bars, x => x === 0 ? 0.62 * k : x === 8 ? 0.5 * k : x === 11 ? 0.22 * k : 0),
  snare: steps(bars, (x, b) => (x === 4 || x === 12) ? 0.42 * k : (b === bars - 1 && x >= 12 ? 0.2 + 0.05 * (x - 12) : 0)),
  chat: steps(bars, x => x % 2 === 0 ? (x % 4 === 0 ? 0.34 : 0.24) * k : 0.1 * k),
  shaker: steps(bars, x => x % 2 === 1 ? 0.16 * k : 0),
  crash: steps(bars, (x, b) => x === 0 && b === 0 ? 0.42 * k : 0),
});
forBars(P.ch, 0, (ch, b) => { put('Guitar', 'B', guitarBar(ch, b, 0.62)); put('Bass', 'B', bassBar(ch, b, 'two', 0.78)); put('Rhodes', 'B', [{ start: b * 4, chord: ch, octave: 3, dur: 3.8, vel: 0.45 }]); });
L.ch.forEach((t, i) => put('Voice', 'B', line('B', 2 * i, t, 0.84)));
put('Harmony', 'B', line('B', 14, L.echo, 0.5, 0, 'Harmony')); put('Harmony', 'B', line('B', 14, L.echoHi, 0.38, 0, 'Harmony'));
kit.B = chorusKit(16);

// C: verse 2 (8)
forBars(P.verse, 0, (ch, b) => { put('Guitar', 'C', guitarBar(ch, b, 0.52)); put('Bass', 'C', bassBar(ch, b, 'half', 0.66)); put('Rhodes', 'C', [{ start: b * 4, chord: ch, octave: 3, dur: 3.8, vel: 0.3 }]); });
L.v2.forEach((t, i) => put('Voice', 'C', line('C', 2 * i, t, 0.74)));
kit.C = { kick: steps(8, x => x === 0 ? 0.42 : 0), rim: steps(8, x => (x === 4 || x === 12) ? 0.28 : 0), shaker: steps(8, x => x % 2 === 0 ? (x % 4 === 2 ? 0.26 : 0.16) : 0) };

// D: pre 2 (4)
forBars(P.pre, 0, (ch, b) => { put('Guitar', 'D', guitarBar(ch, b, 0.62)); put('Bass', 'D', bassBar(ch, b, 'half', 0.7)); put('Rhodes', 'D', [{ start: b * 4, chord: ch, octave: 3, dur: 3.8, vel: 0.45 }]); });
L.pre2.forEach((t, i) => put('Voice', 'D', line('D', 2 * i, t, 0.78)));
kit.D = { kick: steps(4, x => x === 0 || x === 8 ? 0.45 : 0), rim: steps(4, x => (x === 4 || x === 12) ? 0.3 : 0), shaker: steps(4, x => x % 2 === 0 ? 0.22 : 0.1),
  snare: steps(4, (x, b) => b === 3 && x >= 8 ? 0.15 + 0.04 * (x - 8) : 0) };

// E: bridge (8): the band drops back, Harmony holds the chords, ride ticks in on the second half
forBars(P.br, 0, (ch, b) => { put('Guitar', 'E', guitarBar(ch, b, b < 4 ? 0.42 : 0.5)); put('Bass', 'E', bassBar(ch, b, 'whole', 0.6)); put('Harmony', 'E', [{ start: b * 4, chord: ch, octave: 3, dur: 3.9, vel: 0.26 }]); });
L.br.forEach((t, i) => put('Voice', 'E', line('E', 2 * i, t, 0.78)));
kit.E = { ride: steps(8, (x, b) => b >= 4 && x % 4 === 0 ? 0.2 : 0), rim: steps(8, (x, b) => b >= 6 && (x === 4 || x === 12) ? 0.24 : 0),
  snare: steps(8, (x, b) => b === 7 && x >= 8 ? 0.18 + 0.05 * (x - 8) : 0) };

// F: final chorus, up a whole step to E. No echo; the last "away" holds on the tonic while the band lands under it.
forBars(P.chE, 0, (ch, b) => { put('Guitar', 'F', guitarBar(ch, b, 0.68)); put('Bass', 'F', bassBar(ch, b, 'two', 0.84)); put('Rhodes', 'F', [{ start: b * 4, chord: ch, octave: 3, dur: 3.8, vel: 0.52 }]); });
L.ch.slice(0, 6).forEach((t, i) => put('Voice', 'F', line('F', 2 * i, t, 0.9, 2)));
put('Voice', 'F', line('F', 12, 'Noth:B4:1 ing:A4:.5 gets:B4:.5 thrown:D5:1.5 a:B4:.5 way:D5:7', 0.92, 2));
kit.F = chorusKit(16, 1.15); kit.F.ohat = steps(16, (x, b) => x === 14 && b % 2 === 1 ? 0.22 : 0);
kit.F.crash = steps(16, (x, b) => x === 0 && (b === 0 || b === 8) ? 0.5 : 0);
kit.F.snare = steps(16, x => (x === 4 || x === 12) ? 0.48 : 0);

// G: outro (4): guitar and voice only, hard stop on the last downbeat
forBars(P.outE.slice(0, 3), 0, (ch, b) => put('Guitar', 'G', guitarBar(ch, b, 0.45)));
put('Guitar', 'G', guitarBar('E', 3, 0.5, 'strum').map(n => ({ ...n, dur: 1.9 })));
L.out.forEach((t, i) => put('Voice', 'G', line('G', 2 * i, t, 0.64, 0)));

// ---------- write it into Oscine ----------
for (const [track, bySlot] of Object.entries(notes)) for (const [slot, arr] of Object.entries(bySlot))
  must(await c('set_notes', { track, slot, mode: 'replace', notes: arr.sort((a, b) => a.start - b.start) }), `${track}/${slot}`);
for (const [slot, lanes] of Object.entries(kit)) must(await c('set_steps', { track: 'Kit', slot, mode: 'replace', lanes }), 'kit/' + slot);

const MIX = {
  Guitar: { gain: 0.64, pan: -0.18, sendReverb: 0.22 },
  Bass: { gain: 0.62, pan: 0 },
  Rhodes: { gain: 0.4, pan: 0.22, sendReverb: 0.25 },
  Kit: { gain: 0.6, sendReverb: 0.12 },
  Voice: { gain: 0.74, pan: 0.02, sendDelay: 0.1, sendReverb: 0.3 },
  Harmony: { gain: 0.42, pan: 0, sendReverb: 0.45 },
};
for (const [t, m] of Object.entries(MIX)) must(await c('set_mix', { track: t, ...m }), 'mix ' + t);
must(await c('set_master', { volume: 0.8, delayDiv: 0.75, delayFeedback: 0.25, delayReturn: 0.35, verbSize: 2.4, verbReturn: 0.5 }), 'master');
console.log('song', JSON.stringify(must(await c('song', { action: 'set', sequence: ['A', 'B', 'C', 'D', 'B', 'E', 'F', 'G'] }), 'song')).slice(0, 600));

// ---------- listen, trim to -1.2 dB peak, save ----------
for (let pass = 1; pass <= 3; pass++) {
  const r = must(await c('listen', { song: true }), 'listen');
  console.log(`pass ${pass}: peak ${r.peakDb} rms ${r.rmsDb} crest ${r.crestDb} clipped ${r.clipped} dc ${r.dc}`, JSON.stringify(r.bands), r.notes || '');
  for (const x of r.sections || []) console.log(`   ${x.slot} @${x.startSec}s rms ${x.rmsDb} peak ${x.peakDb}`, JSON.stringify(x.bands));
  if (r.clipped || r.peakDb > -1 || r.peakDb < -4) { const st = await c('status'); const mv = st.project?.masterVolume ?? 0.8;
    await c('set_master', { volume: +Math.min(1, mv * Math.pow(10, (-1.2 - r.peakDb) / 20)).toFixed(3) }); continue; }
  break;
}
const fin = must(await c('listen', { song: true, save: `${REL}/on-the-shelf.${TAG}.wav` }), 'save');
console.log('saved', fin.saved, 'peak', fin.peakDb, 'rms', fin.rmsDb);
writeFileSync(`${SONG}/on-the-shelf.oscine.json`, JSON.stringify(await c('project', { action: 'get' }), null, 1));
// where each word lands, in song seconds
const seq = ['A', 'B', 'C', 'D', 'B', 'E', 'F', 'G']; const spb = 60 / 84; let at = 0; const sheet = [];
for (const sl of seq) { for (const w of words.filter(w => w.slot === sl)) sheet.push({ t: +(at + w.beat * spb).toFixed(3), section: sl, track: w.track, word: w.word, midi: w.pitch, beats: w.dur }); at += BARS[sl] * 4 * spb; }
writeFileSync(`${SONG}/on-the-shelf.vocal.json`, JSON.stringify({ bpm: 84, seconds: +at.toFixed(2), words: sheet }, null, 1));
console.log('words', sheet.length, 'song seconds', at.toFixed(1), 'page errors', s.errs);
await s.close();
