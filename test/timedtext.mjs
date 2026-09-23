// Timed-text round-trips: SRT / VTT / JSON / whisper JSON, clip-local shifting.
import { toSRT, toVTT, toJSON, parseTimedText, wordsForClipLocal, mergeClipWords } from '../src/core/timedtext.js';

let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? '  ok  ' : 'FAIL  ') + n + (d ? `  (${d})` : '')); if (!ok) fails++; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const words = [{ s: 1.5, e: 1.9, t: 'We' }, { s: 1.9, e: 2.4, t: 'are' }, { s: 2.4, e: 3.25, t: 'home' }, { s: 61.01, e: 61.5, t: 'again' }];

const srt = toSRT(words);
check('SRT has 4 cues with comma ms', srt.split('\n\n').length === 4 && srt.includes('00:00:01,500 --> 00:00:01,900'));
check('SRT round-trips exactly', same(parseTimedText(srt), words));
const vtt = toVTT(words);
check('VTT header + dot ms', vtt.startsWith('WEBVTT') && vtt.includes('00:01:01.010 --> 00:01:01.500'));
check('VTT round-trips exactly', same(parseTimedText(vtt), words));
check('JSON round-trips exactly', same(parseTimedText(toJSON(words)), words));

// whisper JSON shape
const wh = JSON.stringify({ segments: [{ words: [{ word: ' We', start: 1.5, end: 1.9 }, { word: ' are', start: 1.9, end: 2.4 }] }] });
check('whisper JSON parses + trims', same(parseTimedText(wh), [{ s: 1.5, e: 1.9, t: 'We' }, { s: 1.9, e: 2.4, t: 'are' }]));

// phrase SRT (normal subtitles) gets split evenly, flagged approx
const phrase = '1\n00:00:10,000 --> 00:00:12,000\nfrom this distant vantage\n';
const p = parseTimedText(phrase);
check('phrase cue split into 4 words', p.length === 4 && p.every(w => w.approx));
check('split spans the cue evenly', p[0].s === 10 && Math.abs(p[3].e - 12) < 1e-9 && Math.abs(p[1].s - 10.5) < 1e-9, p.map(w => w.s).join(','));
check('splitPhrases:false keeps the phrase', parseTimedText(phrase, { splitPhrases: false }).length === 1);

// clip-local export / import
const clip = { in: 1.7, out: 3.0 };
const local = wordsForClipLocal(words, clip);
check('clip export keeps overlapping words, shifts by in', local.length === 3 && Math.abs(local[0].s - (-0.2)) < 1e-9 && Math.abs(local[2].s - 0.7) < 1e-9, JSON.stringify(local));
const merged = mergeClipWords(words, clip, [{ s: 0.2, e: 0.6, t: 'WE' }, { s: 0.7, e: 1.2, t: 'ARE' }]);
check('clip import replaces words inside [in,out], keeps others', merged.map(w => w.t).join(' ') === 'WE ARE again', merged.map(w => w.t).join(' '));
check('imported words are shifted back to source time', Math.abs(merged[0].s - 1.9) < 1e-9 && Math.abs(merged[1].s - 2.4) < 1e-9);
check('merged result is sorted', merged.every((w, i) => i === 0 || w.s >= merged[i - 1].s));

// malformed
let threw = false; try { parseTimedText('{"foo":1}'); } catch { threw = true; }
check('unknown JSON shape throws', threw);
check('garbage text yields []', parseTimedText('hello\nworld').length === 0);

console.log(fails ? `\n${fails} FAILED` : '\ntimedtext: all checks passed');
process.exit(fails ? 1 : 0);
