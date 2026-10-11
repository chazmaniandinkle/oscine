// Jam phrases: segmentation of synthetic jam streams, clip quantize + rebase, the slot write as ONE undo step, the
// sidecar's phrases/clip/cut over a synthetic jam dir. No browser. Run: node test/jamphrases.mjs
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { segmentPhrases, clipFromPhrase, parseQuantize, tempoMap, pairEvents, noteContour } from '../src/core/jamphrases.js';

let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? '  ok  ' : 'FAIL  ') + n + (d ? `  (${d})` : '')); if (!ok) fails++; };

// -- synthetic stream builder --------------------------------------------------------------------------------------------
// 120 bpm => 1 beat = 500 ms. wall t0 = 1_000_000 ms, ct0 = 10 s, audio t0 ct = 9.5.
const T0 = 1_000_000, CT0 = 10, BPM = 120;
let seq = 0;
const ev = (kind, tMs, extra = {}) => ({ seq: seq++, seg: 0, t: T0 + tMs, ct: CT0 + tMs / 1000, beat: null, kind, ...extra });
const on = (tMs, pitch, o = {}) => ev('note', tMs, { on: true, pitch, vel: 0.8, trackId: 'lead', trackName: 'Lead', ...o });
const off = (tMs, pitch, o = {}) => ev('note', tMs, { on: false, pitch, trackId: 'lead', trackName: 'Lead', ...o });
const hit = (tMs, lane, o = {}) => ev('hit', tMs, { lane, vel: 0.9, trackId: 'kit', trackName: 'Kit', ...o });
const meta = { id: 'jam-test', bpm: BPM, started_t: T0, segments: { 0: { started_t: T0, audio: { file: 'audio.webm', audio_t0_ct: 9.5 } } } };

console.log('[1] pairing + quantize parsing');
{
  seq = 0;
  const e = [on(0, 60), on(100, 64), off(300, 60), off(500, 64), on(600, 67), on(700, 67), off(900, 67)];
  const { notes } = pairEvents(e);
  check('four pairs (the re-struck 67 cuts the first)', notes.length === 4 && notes.filter(n => n.cut).length === 1, notes.map(n => `${n.on.pitch}:${!!n.off}${n.cut ? 'c' : ''}`).join(' '));
  check('parseQuantize 1/16 = 0.25, 1/8 = 0.5, 1/4 = 1, 1/8T = 1/3', parseQuantize('1/16') === 0.25 && parseQuantize('1/8') === 0.5 && parseQuantize('1/4') === 1 && Math.abs(parseQuantize('1/8T') - 1 / 3) < 1e-9);
  check('parseQuantize off/none/undefined = 0', parseQuantize('off') === 0 && parseQuantize() === 0);
  let threw = false; try { parseQuantize('wobble'); } catch { threw = true; }
  check('parseQuantize rejects nonsense', threw);
}

console.log('[2] segmentation: silence gaps split phrases (free play, wall time)');
{
  seq = 0;
  // phrase 1: C4 E4 G4 over ~1.2 s;  3 s silence;  phrase 2: A4 B4
  const e = [on(0, 60), off(300, 60), on(400, 64), off(700, 64), on(800, 67), off(1200, 67),
             on(4200, 69), off(4500, 69), on(4600, 71), off(5000, 71)];
  const ph = segmentPhrases(e, { meta });
  check('two phrases', ph.length === 2, ph.map(p => p.count).join(','));
  check('phrase 1: three notes, C4..G4', ph[0].count === 3 && ph[0].range.loName === 'C4' && ph[0].range.hiName === 'G4');
  check('contour text', ph[0].contour === 'C4 E4 G4' && ph[1].contour === 'A4 B4', `${ph[0].contour} | ${ph[1].contour}`);
  check('free play is timed from wall time via the tempo', ph[0].timing === 'time' && ph[0].bpm === 120);
  check('note starts are beats rel. to the first note (0, 0.8, 1.6 at 120 bpm)', ph[0].notes.map(n => n.start).join(',') === '0.8,1.6'.replace(/^/, '0,'), ph[0].notes.map(n => n.start).join(','));
  check('durations in beats (300 ms = 0.6 beat)', Math.abs(ph[0].notes[0].dur - 0.6) < 1e-6, String(ph[0].notes[0].dur));
  check('audio window: first input -> last input, widened by head/tail', ph[0].audio.aligned && Math.abs(ph[0].audio.from_sec - 0.4) < 1e-6 && Math.abs(ph[0].audio.to_sec - (0.5 + 1.2 + 0.5)) < 1e-6, JSON.stringify(ph[0].audio));
  check('audio window of phrase 2 is later', ph[1].audio.from_sec > ph[0].audio.to_sec);
  check('id is stable (from the first seq)', ph[0].id === 'ph-0' && ph[1].id === 'ph-6');
  const small = segmentPhrases(e, { meta, gapSec: 6 });
  check('a bigger gap merges them', small.length === 1 && small[0].count === 5);
  check('a smaller gap splits more', segmentPhrases(e, { meta, gapSec: 0.05 }).length === 5);
}

console.log('[3] segmentation: beat-stamped (playing), beat gap, overlap, held note, tracks');
{
  seq = 0;
  const b = (beat, f) => f({ beat });
  const e = [
    b(0, o => on(0, 60, o)), b(0.5, o => off(250, 60, o)),
    b(1, o => on(500, 62, o)), b(1.5, o => off(750, 62, o)),
    // 2 beats of silence by the transport beat (but only 1 s wall: under the 1.5 s gap) => split by beats
    b(4, o => on(2000, 64, o)), b(4.5, o => off(2250, 64, o)),
  ];
  const ph = segmentPhrases(e, { meta });
  check('beat gap >= 2 splits even under the wall-time gap', ph.length === 2, ph.map(p => p.count).join(','));
  check('beat-stamped phrases use the transport beat', ph[0].timing === 'beat' && ph[0].start.beat === 0 && ph[1].start.beat === 4);
  check('beat-stamped starts are exact (0, 1)', ph[0].notes[1].start === 1 && ph[0].notes[0].dur === 0.5);

  seq = 0;
  const ov = [on(0, 60), on(100, 64), off(900, 60), off(1000, 64)];     // overlapping chord-ish
  const p2 = segmentPhrases(ov, { meta });
  check('overlapping notes stay in one phrase', p2.length === 1 && p2[0].count === 2);
  check('simultaneous-ish starts read as a chord in the contour', noteContour([{ name: 'C4', start: 0, dur: 1 }, { name: 'E4', start: 0.02, dur: 1 }, { name: 'G4', start: 1, dur: 1 }]) === '[C4 E4] G4');

  seq = 0;
  const held = [on(0, 60), on(300, 62), off(500, 62)];                  // C4 never released
  const p3 = segmentPhrases(held, { meta });
  check('a note-on without an off is flagged held and bounded', p3[0].notes.find(n => n.pitch === 60).held === true && p3[0].notes.find(n => n.pitch === 60).dur <= 4 * 2 + 1e-6);

  seq = 0;
  const two = [on(0, 60), off(200, 60), on(100, 48, { trackId: 'bass', trackName: 'Bass' }), off(300, 48, { trackId: 'bass', trackName: 'Bass' })];
  const p4 = segmentPhrases(two, { meta });
  check('each track gets its own phrases', p4.length === 2 && new Set(p4.map(p => p.track)).size === 2);
  check('track filter by name', segmentPhrases(two, { meta, track: 'Bass' }).length === 1);
}

console.log('[4] segmentation: drums, tempo change, segments');
{
  seq = 0;
  const d = [hit(0, 'kick'), hit(500, 'snare'), hit(1000, 'kick'), hit(1500, 'hat'), hit(6000, 'kick')];
  const ph = segmentPhrases(d, { meta });
  check('drum hits form their own phrases, split by silence', ph.length === 2 && ph[0].kind === 'hits' && ph[0].count === 4 && ph[1].count === 1);
  check('drum lanes counted + contour', ph[0].lanes.kick === 2 && ph[0].contour === 'kick snare kick hat', ph[0].contour);
  check('drum starts in beats (500 ms = 1 beat at 120)', ph[0].hits.map(h => h.start).join(',') === '0,1,2,3');

  seq = 0;
  // 120 bpm for 1 s (2 beats), then a change to 60 bpm (1 beat = 1 s): a note 2 s later sits 2 beats after the change
  const tc = [on(0, 60), off(100, 60), ev('transport', 1000, { key: 'bpm', value: 60, name: 'settings:changed' }), on(1400, 62), off(1900, 62)];
  const ph2 = segmentPhrases(tc, { meta, gapSec: 10 });
  const tm = tempoMap(tc, { startBpm: 120, startT: T0 });
  check('tempoMap: 1.0 s at 120 = 2 beats; +1 s at 60 = +1 beat', Math.abs(tm(T0 + 1000) - 2) < 1e-9 && Math.abs(tm(T0 + 2000) - 3) < 1e-9);
  const n1 = ph2[0].notes[1];
  check('a phrase across a tempo change is placed with the tempo map (0.4 s at 60 bpm = 0.4 beat after 2 beats)', Math.abs(n1.start - 2.4) < 1e-6, String(n1.start));

  seq = 0;
  const sg = [on(0, 60), off(200, 60), { ...on(400, 62), seg: 1 }, { ...off(600, 62), seg: 1 }];
  const m2 = { ...meta, segments: { ...meta.segments, 1: { started_t: T0 + 300, audio: { file: 'audio.1.webm', audio_t0_ct: 10.3 } } } };
  const ph3 = segmentPhrases(sg, { meta: m2 });
  check('a reload (new segment) always starts a new phrase, with its own audio file', ph3.length === 2 && ph3[1].audio.file === 'audio.1.webm' && Math.abs(ph3[1].audio.from_sec - (0.1 - 0.1)) < 1e-6, JSON.stringify(ph3[1].audio));
  const noAudio = segmentPhrases([on(0, 60), off(100, 60)], { meta: { bpm: 120, started_t: T0 } });
  check('no audio t0 => aligned:false, still a phrase', noAudio.length === 1 && noAudio[0].audio.aligned === false);
  check('window filter keeps only phrases in a ct window', segmentPhrases([on(0, 60), off(100, 60), on(5000, 62), off(5100, 62)], { meta, window: { seg: 0, fromCt: 14, toCt: 16 } }).length === 1);
}

console.log('[5] clip: quantize + rebase to beat 0');
{
  seq = 0;
  // a slightly loose phrase at 120 bpm (beats: 0, 0.52, 1.03, 1.49)
  const e = [on(0, 60), off(240, 60), on(260, 62), off(500, 62), on(515, 64), off(740, 64), on(745, 65), off(1000, 65)];
  const ph = segmentPhrases(e, { meta })[0];
  const raw = clipFromPhrase(ph);
  check('no quantize: starts kept (to the 1/96 beat)', raw.quantize === 'none' && raw.notes.length === 4 && raw.notes[1].start !== 0.5);
  const c = clipFromPhrase(ph, { quantize: '1/8' });
  check('quantize 1/8: starts snap to 0, 0.5, 1, 1.5', c.notes.map(n => n.start).join(',') === '0,0.5,1,1.5', c.notes.map(n => n.start).join(','));
  check('quantize: every duration is a multiple of the grid, never zero', c.notes.every(n => n.dur >= 0.5 && Math.abs(n.dur / 0.5 - Math.round(n.dur / 0.5)) < 1e-9));
  check('clip shape is what set_notes takes (start, pitch, dur, vel)', c.notes.every(n => ['start', 'pitch', 'dur', 'vel'].every(k => Number.isFinite(n[k]))) && c.kind === 'synth');
  check('clip says how many bars it needs (2 beats => 1 bar)', c.bars === 1 && c.beats <= 4);
  const long = clipFromPhrase({ ...ph, notes: [{ ...ph.notes[0], start: 0 }, { ...ph.notes[1], start: 9, dur: 1 }] }, { quantize: '1/4' });
  check('a phrase longer than a bar asks for a longer slot (10 beats => 4 bars)', long.bars === 4, String(long.bars));

  // beat-stamped: rebase 'bar' keeps the place in the bar (beat 5.5 -> offset 1.5)
  seq = 0;
  const bs = [{ ...on(0, 60), beat: 5.5 }, { ...off(250, 60), beat: 6 }, { ...on(500, 62), beat: 6.5 }, { ...off(750, 62), beat: 7 }];
  const pb = segmentPhrases(bs, { meta })[0];
  const first = clipFromPhrase(pb, { quantize: '1/4' }), bar = clipFromPhrase(pb, { quantize: '1/4', rebase: 'bar' });
  check("rebase 'first' puts the first note at 0; 'bar' keeps its place in the bar (1.5 -> 1.5)", first.notes[0].start === 0 && Math.abs(bar.notes[0].start - 1.5) < 0.51, `${first.notes[0].start} / ${bar.notes[0].start}`);

  // drums
  seq = 0;
  const d = [hit(0, 'kick'), hit(520, 'snare'), hit(1000, 'kick'), hit(1490, 'hat')];
  const dc = clipFromPhrase(segmentPhrases(d, { meta })[0]);
  check('drum clip: lanes of 16ths for set_steps, vel in the hit step', dc.kind === 'drums' && dc.bars === 1 && dc.lanes.kick.length === 16 && dc.lanes.kick[0] > 0 && dc.lanes.kick[8] > 0 && dc.lanes.snare[4] > 0 && dc.lanes.hat[12] > 0, JSON.stringify(Object.fromEntries(Object.entries(dc.lanes).map(([k, v]) => [k, v.map(x => x ? 1 : 0).join('')]))));
}

console.log(fails ? `\n${fails} FAILED` : '\nall jamphrases checks passed');
process.exit(fails ? 1 : 0);
