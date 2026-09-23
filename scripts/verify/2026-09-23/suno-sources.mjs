// Gesture proof for Suno sources + variants, in headless Chrome against a
// sidecar started from this worktree (OSCINE_PORT=7381, root = cog):
//   load the backfill copy -> click the render 2 source in the bin -> the
//   inspector shows the Suno section -> "+" places it on a new lane -> play
//   (engine fetches the Suno m4a) -> "Add file..." with a local path ->
//   "Prefer" on the new variant -> play again (engine fetches the NEW sha)
//   -> one Cmd+Z reverts the prefer and the clip resolves to the m4a again.
// Never saves. Screenshot of the section: suno-sources.png next to this file.
//
//   node scripts/verify/2026-09-23/suno-sources.mjs
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.OSCINE_PORT || 7381);
const COPY = 'projects/songs/2026-09-19-housekeeping-heat/borrowed-light.suno-backfill.oscine.json';
const USER_FILE = 'tmp/suno-proof/render2-my-bounce.wav'; // a WAV decoded from render2, standing in for Chaz's own file
const M4A_SHA = 'd64e4c8e8d57a9f7ed23275c4d9f159c1c6df5e867e611d0954f4769a772a0e8';

let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? '  ok  ' : 'FAIL  ') + n + (d ? `  (${d})` : '')); if (!ok) fails++; };

const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errs = []; page.on('pageerror', e => errs.push(e.message));
const assetReqs = [];
page.on('request', r => { const m = r.url().match(/assets\/([0-9a-f]{64})\.(\w+)/); if (m) assetReqs.push(m[1]); });
page.on('dialog', d => d.accept(USER_FILE));
const ui = (f, a) => page.evaluate(f, a);

try {
  await page.goto(`http://127.0.0.1:${PORT}/?p=${encodeURIComponent(COPY)}`);
  await page.waitForFunction(() => window.oscine?.store?.project?.assets?.ast_src_r2, null, { timeout: 20000 });
  await page.waitForTimeout(1200);
  check('backfill copy loaded with 8 sources', await ui(() => Object.keys(window.oscine.store.project.assets).length) === 8);

  // 1. click the render 2 source in the bin
  await page.click('.asset-row[data-asset="ast_src_r2"]');
  await page.waitForSelector('.source-panel .suno-link', { timeout: 5000 });
  const link = await page.getAttribute('.source-panel .suno-link', 'href');
  const title = await page.textContent('.source-panel .suno-link');
  check('inspector shows the Suno section with the song link', link === 'https://suno.com/song/39802a94-8c2f-49b7-bb77-79bfe022b18d', `${title} -> ${link}`);
  check('cover, model and collapsed lyrics are shown', await page.$('.source-panel .suno-cover') != null
    && /chirp/.test(await page.textContent('.source-panel .suno-info'))
    && await page.$eval('.source-panel details.suno-lyrics', d => !d.open));
  check("'Fetch from Suno' button present", await page.$('.source-panel .suno-fetch') != null);
  check('one variant listed, playing', await page.$$eval('.variant-row', r => r.length) === 1 && await page.$('.variant-row.playing[data-variant="default"]') != null);

  // 2. place it on a new lane with the bin's "+" (a real clip pointing at the asset)
  await page.click('.asset-row[data-asset="ast_src_r2"] button');
  await page.getByText('on a new lane').click();
  await page.waitForTimeout(300);
  const clipId = await ui(() => Object.values(window.oscine.store.project.clips).find(c => c.sourceOf === 'ast_src_r2')?.id);
  check('a clip now points at ast_src_r2 (unpinned)', !!clipId && await ui(id => window.oscine.store.project.clips[id].representation, clipId) == null);

  const playAndBuffer = async () => {
    await ui(() => { const t = window.oscine.transport; t.stop?.(); t.songPos = 30; t.play(); });
    await page.waitForFunction(id => window.oscine.transport.clipPlayer?.buffers?.get(id), clipId, { timeout: 60000 });
    const sha = await ui(id => { const t = window.oscine.transport, b = t.clipPlayer.buffers.get(id); for (const [k, v] of t.assetCache.buffers) if (v === b) return k; return null; }, clipId);
    await ui(() => window.oscine.transport.stop());
    return sha;
  };
  const sha0 = await playAndBuffer();
  check('play: the clip plays the Suno m4a', sha0 === M4A_SHA && assetReqs.includes(M4A_SHA), sha0?.slice(0, 12));

  // re-open the source inspector (placing selected the new clip)
  await page.click('.asset-row[data-asset="ast_src_r2"]');
  await page.waitForSelector('.source-panel .variant-add-btn');

  // 3. Add file... (prompt answered with a path under the workspace root)
  const undo0 = await ui(() => window.oscine.store.undoStack.length);
  await page.click('.source-panel .variant-add-btn');
  await page.waitForSelector('.variant-row[data-variant="user"]', { timeout: 60000 });
  const user = await ui(() => window.oscine.store.project.assets.ast_src_r2.variants.user);
  check('Add file: new variant "user" with provenance', user?.origin === 'user' && user.filename === 'render2-my-bounce.wav' && user.codec === 'pcm_s24le' && user.sampleRate === 48000 && !!user.addedAt, JSON.stringify(user));
  check('Add file: the playing variant is still the Suno download', await ui(() => window.oscine.store.project.assets.ast_src_r2.preferred) == null && await page.$('.variant-row.playing[data-variant="default"]') != null);

  // 4. Prefer it
  const before = assetReqs.length;
  await page.click('.variant-row[data-variant="user"] .variant-prefer');
  await page.waitForSelector('.variant-row.playing[data-variant="user"]', { timeout: 5000 });
  check('Prefer: asset.preferred = user, one undo step each (add, prefer)', await ui(() => window.oscine.store.project.assets.ast_src_r2.preferred) === 'user' && await ui(() => window.oscine.store.undoStack.length) === undo0 + 2);
  await page.locator('.source-panel').screenshot({ path: join(HERE, 'suno-sources.png') });

  const sha1 = await playAndBuffer();
  check('prefer -> the app requests the NEW sha, and play uses it', sha1 === user.sha256 && assetReqs.slice(before).includes(user.sha256), sha1?.slice(0, 12));

  // 5. one undo reverts the prefer
  await page.mouse.click(5, 5);
  await page.keyboard.press('Meta+z');
  await page.waitForTimeout(300);
  let pref = await ui(() => window.oscine.store.project.assets.ast_src_r2.preferred ?? null);
  if (pref === 'user') { await page.keyboard.press('Control+z'); await page.waitForTimeout(300); pref = await ui(() => window.oscine.store.project.assets.ast_src_r2.preferred ?? null); }
  check('one undo: preferred cleared, variant "user" kept', pref === null && !!(await ui(() => window.oscine.store.project.assets.ast_src_r2.variants.user)));
  const sha2 = await playAndBuffer();
  check('after undo the clip plays the Suno m4a again', sha2 === M4A_SHA, sha2?.slice(0, 12));
  check('no page errors', errs.length === 0, errs.join(' | '));
} finally {
  await browser.close();
}
console.log(fails ? `\n${fails} FAILED` : '\nsuno-sources: all checks passed');
process.exit(fails ? 1 : 0);
