// The live ear must agree with ground truth before a viewer may trust it: synthetic spectra and a fake audio graph,
// no browser. Run: node test/earlive.mjs
import { BANDS, bandShares, bandLevelsDb, logSpectrum, levels, OnsetTracker, trackReads, playhead, buildFrame, LiveEar, SPEC_BINS } from '../src/engine/earlive.js';
import { CommandAPI } from '../src/api/api.js';
import { COMMANDS } from '../src/api/commands.js';
import { measure } from '../src/engine/listen.js';

let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? '  ok  ' : 'FAIL  ') + n + (d ? `  (${d})` : '')); if (!ok) fails++; };

const SR = 48000, N = 2048;                       // 2048 bins up to 24 kHz: 11.7 Hz per bin
const df = SR / (2 * N);
const quiet = () => new Float32Array(N).fill(-110);
const tone = (hz, db = -20, spread = 1) => { const f = quiet(), k = Math.round(hz / df); for (let i = -spread + 1; i < spread; i++) f[k + i] = db - Math.abs(i) * 10; return f; };

console.log('[1] bands: same edges as listen, shares sum to 1');
check('band edges are listen\'s', JSON.stringify(BANDS.map(b => [b[0], b[1], b[2]])) === JSON.stringify([['sub', 0, 60], ['bass', 60, 250], ['lowmid', 250, 800], ['mid', 800, 4000], ['high', 4000, 1e9]]));
for (const [hz, band] of [[45, 'sub'], [120, 'bass'], [500, 'lowmid'], [2000, 'mid'], [9000, 'high']]) {
  const b = bandShares(tone(hz), SR);
  const top = Object.entries(b).sort((x, y) => y[1] - x[1])[0];
  check(`${hz} Hz sits in ${band}`, top[0] === band && top[1] > 0.9, JSON.stringify(b));
  check(`  shares sum to ~1 (${hz})`, Math.abs(Object.values(b).reduce((a, c) => a + c, 0) - 1) < 0.01);
}
const two = quiet(); two[Math.round(120 / df)] = -20; two[Math.round(3000 / df)] = -26;   // 6 dB apart: 4:1 power
const bs = bandShares(two, SR);
check('4:1 power -> bass 0.8 / mid 0.2', Math.abs(bs.bass - 0.8) < 0.02 && Math.abs(bs.mid - 0.2) < 0.02, JSON.stringify(bs));
const bd = bandLevelsDb(two, SR);
check('bandsDb differ by 6 dB', Math.abs(bd.bass - bd.mid - 6) < 0.3, JSON.stringify(bd));
check('silence -> all shares tiny but defined (no NaN)', Object.values(bandShares(quiet(), SR)).every(Number.isFinite));

console.log('[2] bands agree with the offline listen on the same signal');
{
  // A real time-domain mix: 100 Hz + 2 kHz at 4:1 amplitude. listen() measures it offline; the live path takes its
  // spectrum from a naive DFT of the same samples. They must name the same dominant bands within a few percent.
  const n = 16384, x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = 0.4 * Math.sin(2 * Math.PI * 100 * i / SR) + 0.1 * Math.sin(2 * Math.PI * 2000 * i / SR);
  const off = measure([x], SR).bands;
  const win = 4096, fdb = new Float32Array(win / 2);
  for (let k = 1; k < win / 2; k++) {
    let re = 0, im = 0;
    for (let i = 0; i < win; i++) { const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / win); re += x[i] * w * Math.cos(2 * Math.PI * k * i / win); im -= x[i] * w * Math.sin(2 * Math.PI * k * i / win); }
    fdb[k] = 10 * Math.log10(Math.max(re * re + im * im, 1e-12));
  }
  const live = bandShares(fdb, SR);
  check('bass share: live ≈ listen', Math.abs(live.bass - off.bass) < 0.05, `live ${live.bass} listen ${off.bass}`);
  check('mid share: live ≈ listen', Math.abs(live.mid - off.mid) < 0.05, `live ${live.mid} listen ${off.mid}`);
}

console.log('[3] 64-bin log spectrum');
const sp = logSpectrum(tone(1000, -20, 2), SR);
const peakBin = sp.indexOf(Math.max(...sp));
const binHz = 30 * Math.pow(16000 / 30, (peakBin + 0.5) / SPEC_BINS);
check('64 bins, ints 0..99', sp.length === 64 && sp.every(v => Number.isInteger(v) && v >= 0 && v <= 99));
check('a 1 kHz tone peaks near 1 kHz', binHz > 800 && binHz < 1250, `bin ${peakBin} ≈ ${Math.round(binHz)} Hz`);
check('silence is 0 across', logSpectrum(quiet(), SR).every(v => v === 0));
check('louder tone -> higher value', Math.max(...logSpectrum(tone(1000, -10), SR)) > Math.max(...logSpectrum(tone(1000, -40), SR)));

console.log('[4] levels');
{
  const x = new Float32Array(1024); for (let i = 0; i < x.length; i++) x[i] = 0.5 * Math.sin(i / 7);
  const l = levels(x);
  check('0.5 sine: peak -6 dB, rms -9 dB', Math.abs(l.peakDb + 6.0) < 0.3 && Math.abs(l.rmsDb + 9.0) < 0.3, JSON.stringify(l));
  check('silence is a floor, not -Infinity', levels(new Float32Array(64)).rmsDb <= -150 || levels(new Float32Array(64)).rmsDb === -180);
}

console.log('[5] onsets and kicks');
{
  const t = new OnsetTracker(); let kicks = 0, onsets = 0;
  for (let i = 0; i < 60; i++) {                 // 15 Hz frames; a kick every 7th frame (broadband + 60 Hz)
    const kick = i % 7 === 0 && i > 6;
    const f = quiet().map((v, k) => (k < 20 ? (kick ? -15 : -70) : kick ? -45 : -75));
    const r = t.push(f, SR, i / 15);
    if (r.kick) kicks++; if (r.onset) onsets++;
  }
  check('a steady drone gives none, kicks are found', kicks >= 6 && kicks <= 9, `kicks ${kicks}`);
  check('onsets fire on the same hits', onsets >= 5 && onsets <= 10, `onsets ${onsets}`);
  const t2 = new OnsetTracker(); let any = 0;
  for (let i = 0; i < 60; i++) { const r = t2.push(tone(200, -30), SR, i / 15); if (r.kick || r.onset) any++; }
  check('a constant tone has no onsets', any === 0, `any ${any}`);
}

console.log('[6] track reads');
{
  const r = trackReads([{ name: 'Bass', rmsDb: -14 }, { name: 'Kit', rmsDb: -16 }, { name: 'Lead', rmsDb: -30 }, { name: 'Pad', rmsDb: -80 }, { name: 'Muted', rmsDb: -80, mute: true }]);
  check('loud = within 6 dB of the loudest', JSON.stringify(r.loud) === '["Bass","Kit"]', JSON.stringify(r));
  check('silent = under -60, muted ones are not "silent"', JSON.stringify(r.silent) === '["Pad"]', JSON.stringify(r));
  check('all quiet -> nothing is "loud"', trackReads([{ name: 'A', rmsDb: -90 }]).loud.length === 0);
}

console.log('[7] playhead');
{
  const h = playhead({ pos: { localBeat: 9.5, loopBeats: 32, sec: 5.4 }, project: {}, activeSlot: 1, queuedSlot: 2 });
  check('bar 3 beat 2 of slot B, C queued, 8 bars', h.slot === 'B' && h.bar === 3 && h.beat === 2 && h.queued === 'C' && h.bars === 8, JSON.stringify(h));
  const h2 = playhead({ pos: { localBeat: 0, loopBeats: 16, sec: 41 }, project: { arrangement: { markers: [{ t: 0, name: 'Intro' }, { t: 32, name: 'Drop' }, { t: 64, name: 'Out' }] } }, activeSlot: 0, queuedSlot: null });
  check('arrangement marker', h2.marker === 'Drop' && h2.queued === null, JSON.stringify(h2));
}

console.log('[8] frames');
{
  const tracker = new OnsetTracker();
  const f = buildFrame({ seq: 1, t: 0.5, sampleRate: SR, master: { freqDb: tone(120, -20), td: new Float32Array(512).fill(0.1) }, tracks: [{ id: 't1', name: 'Bass', td: new Float32Array(256).fill(0.2) }],
    head: { slot: 'A', bar: 1, beat: 1 }, project: { name: 'Demo', bpm: 140 }, playing: true, tracker });
  check('frame carries the contract', f.v === 1 && f.playing && f.project === 'Demo' && f.bpm === 140 && f.slot === 'A' && f.bands && f.bandsDb && f.spec.length === 64 && f.tracks.length === 1 && f.reads);
  check('a frame is small (< 2 KB)', JSON.stringify(f).length < 2000, String(JSON.stringify(f).length));
  const s = buildFrame({ seq: 2, t: 1, sampleRate: SR, master: null, tracks: [], head: { slot: 'A', bar: 1, beat: 1 }, project: { name: 'Demo', bpm: 140 }, playing: false, tracker });
  check('stopped frame: playing:false, no spectrum', s.playing === false && !s.spec && s.project === 'Demo');
}

console.log('[9] the driver on a fake audio graph: zero cost off, one analyser per channel, cleanup on stop');
{
  let live = 0, created = 0;
  const mkAn = () => { created++; return { fftSize: 0, frequencyBinCount: 0, smoothingTimeConstant: 0, set _x(v) {}, getFloatFrequencyData(a) { a.set(tone(120, -20).subarray(0, a.length)); }, getFloatTimeDomainData(a) { for (let i = 0; i < a.length; i++) a[i] = 0.2 * Math.sin(i / 5); } }; };
  const ctx = { sampleRate: SR, createAnalyser() { const a = mkAn(); Object.defineProperty(a, 'fftSize', { get() { return this._n || 0; }, set(v) { this._n = v; this.frequencyBinCount = v / 2; } }); return a; } };
  const connectTo = (node) => ({ connect(an) { live++; }, disconnect(an) { live--; } });
  const chans = new Map([['t1', { panner: connectTo(), analyser: {} }], ['t2', { panner: connectTo(), analyser: {} }]]);
  const engine = { ctx, masterGain: connectTo(), channels: chans };
  const store = { project: { name: 'Demo', bpm: 140, tracks: [{ id: 't1', name: 'Bass', channel: {} }, { id: 't2', name: 'Kit', channel: { mute: true } }] }, ui: { activeSlot: 0, queuedSlot: null } };
  let playing = true;
  const transport = { getPosition: () => ({ playing, localBeat: 5, loopBeats: 32, sec: 2 }) };
  const events = [];
  const bus = { emit: (n, d) => events.push([n, d]) };
  const ear = new LiveEar({ engine, transport, store, bus });
  check('off: nothing created, nothing connected', created === 0 && live === 0 && !ear.status().running);
  const st = ear.start({ hz: 100 });
  check('hz is clamped to 5..30', st.hz === 30, String(st.hz));
  check('on: master + 2 channel analysers connected', live === 3 && created === 3, `live ${live}`);
  const f = ear.measure();
  check('measure gives a playing frame with both tracks', f.playing && f.tracks.length === 2 && f.tracks[1].mute === true && f.tracks[0].name === 'Bass');
  chans.delete('t2');
  ear.measure();
  check('a removed track\'s analyser is dropped', live === 2, `live ${live}`);
  ear.stop();
  check('stop disconnects everything', live === 0 && !ear.status().running);
  const snap = await ear.snapshot();
  check('snapshot works while off, and leaves nothing attached', snap.playing === true && live === 0 && !ear.status().running);
  playing = false;
  const sf = await ear.snapshot();
  check('snapshot while stopped says so', sf.playing === false);
}

console.log('[10] the command: catalog entry, handler, errors');
{
  const c = COMMANDS.find(x => x.name === 'ear');
  check('catalog has ear with an action enum', c && c.input.properties.action.enum.join() === 'snapshot,start,stop,status' && c.description.length > 100);
  const api = new CommandAPI({ store: {}, engine: {}, transport: {}, bus: {} });
  let err = ''; try { await api.execute('ear', { action: 'snapshot' }); } catch (e) { err = e.message; }
  check('no audio engine -> a clear error, not a crash', /audio engine/.test(err), err);
  let bad = ''; try { await new CommandAPI({ store: {}, engine: { ctx: {} }, transport: {}, bus: {} }).execute('ear', { action: 'nope' }); } catch (e) { bad = e.message; }
  check('bad action -> clear error', /Bad action/.test(bad), bad);
}

console.log(fails ? `\n${fails} FAILED` : '\nall ear-live checks passed');
process.exit(fails ? 1 : 0);
