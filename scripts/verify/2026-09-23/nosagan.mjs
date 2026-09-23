import { writeFileSync, statSync } from 'node:fs';
const { chromium } = await import('/Users/slowbro/workspaces/oscine/node_modules/playwright-core/index.mjs');
const OUT = '/Users/slowbro/workspaces/cog/projects/songs/2026-09-19-housekeeping-heat/renders/borrowed-light/borrowed-light_oscine-2.2_no-sagan.wav';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage();
page.on('pageerror', e => console.log('pageerror', e.message));
await page.goto('http://127.0.0.1:7351/?p=projects/songs/2026-09-19-housekeeping-heat/borrowed-light.oscine.json');
await page.waitForFunction(() => window.oscine?.store?.project?.arrangement?.placements?.length > 0, null, { timeout: 30000 });
console.log('lanes:', await page.evaluate(() => JSON.stringify(window.oscine.store.project.arrangement.lanes.map(l => [l.name, l.gainDb, !!l.mute]))));
// Render a CLONE with the Sagan lane muted; the live project is never touched or saved.
const info = await page.evaluate(async () => {
  const { renderProjectToBuffer } = await import('/src/engine/render.js');
  const { encodeWav } = await import('/src/core/wav.js');
  const P = structuredClone(window.oscine.store.project);
  for (const l of P.arrangement.lanes) if (/carl|sagan/i.test(l.id + ' ' + l.name)) l.mute = true;
  const r = await renderProjectToBuffer(P); const buf = r.buffer || r;
  const chans = [...Array(buf.numberOfChannels)].map((_, c) => buf.getChannelData(c));
  let pk = 0, ss = 0, nn = 0;
  for (const d of chans) for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > pk) pk = v; ss += d[i] * d[i]; nn++; }
  const wav = encodeWav(chans, buf.sampleRate);
  const bytes = new Uint8Array(wav instanceof Blob ? await wav.arrayBuffer() : (wav.buffer || wav));
  window.__wav = bytes;
  return { dur: buf.duration, sr: buf.sampleRate, ch: buf.numberOfChannels, peakDb: 20 * Math.log10(pk), rmsDb: 10 * Math.log10(ss / nn), bytes: bytes.length, muted: P.arrangement.lanes.filter(l => l.mute).map(l => l.name) };
});
console.log(JSON.stringify(info));
const parts = [];
for (let off = 0; off < info.bytes; off += 4e6) {
  const b64 = await page.evaluate(([o, e]) => { const b = window.__wav.subarray(o, e); let s = ''; for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode.apply(null, b.subarray(i, i + 32768)); return btoa(s); }, [off, off + 4e6]);
  parts.push(Buffer.from(b64, 'base64'));
}
writeFileSync(OUT, Buffer.concat(parts));
console.log('wrote', OUT, statSync(OUT).size);
await browser.close();
