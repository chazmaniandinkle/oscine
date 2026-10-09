// Render the register stream captured from Ages' own sound driver through Oscine's
// APU model, write a WAV, and measure it (does the driver's output look like music?).
import { readFileSync, writeFileSync } from 'node:fs';
import { renderRegisterStream } from '../../../src/engine/gbapu.js';
import { measure } from '../../../src/engine/listen.js';
import { encodeWav } from '../../../src/core/wav.js';
const song = process.argv[2] ?? '11', out = process.argv[3];
const writes = JSON.parse(readFileSync(`/tmp/apu-${song}.json`, 'utf8'));
const t0 = Date.now();
const r = renderRegisterStream(writes, { sampleRate: 44100 });
const ms = Date.now() - t0;
const m = measure(r.channels, r.sampleRate, {});
console.log(JSON.stringify({ song, seconds: +r.seconds.toFixed(1), renderMs: ms, peak: m.peakDb, rms: m.rmsDb, dc: m.dc, bands: m.bands, key: m.key }));
if (out) writeFileSync(out, Buffer.from(encodeWav(r.channels, r.sampleRate)));
