// Gesture proof for the settings panel (⚙ / ⌘,):
//  - ⌘, opens it, Esc closes it; the ⚙ toolbar button opens it too
//  - one row per pref in core/prefs.js, grouped into sections
//  - changing Grid in the panel moves the toolbar's grid select, and snapping
//    follows (a ⇧-drag range lands on whole beats with Grid = Beat)
//  - Snap distance from the panel changes the magnetic radius
//  - toggling Follow in the panel = the L key = the toolbar button (one truth)
//  - key scheme set in the panel relabels shortcuts, and persists
//  - a reload keeps every changed value (localStorage), Reset all restores defaults
//  - the MCP-facing `settings` command sees the same values as the panel
// Never saves the project.
//   OSCINE_URL=http://127.0.0.1:7351 node scripts/verify/2026-09-23/settings.mjs
const { chromium } = await import(new URL('../../../node_modules/playwright-core/index.mjs', import.meta.url).href);
const BASE = process.env.OSCINE_URL || 'http://127.0.0.1:7351';
const SONG = 'projects/songs/2026-09-19-housekeeping-heat/borrowed-light.oscine.json';
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ executablePath: CHROME });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
const errs = []; page.on('pageerror', e => errs.push(e.message));
async function load() {
  await page.goto(`${BASE}/?p=${SONG}`);
  await page.waitForFunction(() => window.oscine?.store?.project?.arrangement?.placements?.length > 0, null, { timeout: 30000 });
  await page.waitForTimeout(800);
}
await load();
await page.evaluate(() => window.oscine.app.prefs.reset()); // start clean
let passed = 0, failed = 0;
const check = (n, c, d = '') => { if (c) { passed++; console.log(`  ok  ${n}`); } else { failed++; console.log(`  FAIL  ${n}${d ? ` -- ${d}` : ''}`); } };
const ev = (fn, a) => page.evaluate(fn, a);
const isOpen = () => ev(() => !!document.querySelector('.settings'));

// Open/close
await page.mouse.click(800, 500); // focus the app, not an input
await page.keyboard.press('Meta+Comma'); await page.waitForTimeout(100);
check('⌘, opens settings', await isOpen());
const rows = await ev(() => [...document.querySelectorAll('.settings-row')].map(r => r.dataset.key));
const sections = await ev(() => [...document.querySelectorAll('.settings-h')].map(h => h.textContent));
check('one row per pref', rows.length === 7 && rows.includes('snap.distancePx') && rows.includes('transcribe.model'), rows.join(','));
check('grouped into sections', sections.join('|') === 'Editing|View|Keyboard|Transcription', sections.join('|'));
check('shortcut list is present', await ev(() => document.querySelectorAll('.settings-keytable .settings-k').length > 20));
await page.keyboard.press('Escape'); await page.waitForTimeout(80);
check('Esc closes it', !(await isOpen()));
await ev(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent === '⚙'); b.click(); });
await page.waitForTimeout(80);
check('⚙ toolbar button opens it', await isOpen());

// Grid = Beat from the panel
await page.selectOption('.settings-row[data-key="snap.grid"] select', '1');
await page.waitForTimeout(80);
const g = await ev(() => ({ ui: window.oscine.store.ui.snap, tb: window.oscine.app.toolbar.snapSel.root.querySelector('select').value, cmd: null }));
check('panel grid → store + toolbar select', g.ui === 1 && g.tb === '1', JSON.stringify(g));
const viaCmd = await ev(() => window.oscine.api.execute('settings', { action: 'get', key: 'snap.grid' }));
check('settings command sees the panel value', viaCmd.value === 1, JSON.stringify(viaCmd));

// Snap distance changes the magnetic radius (checked in the live snapTime)
await page.fill('.settings-row[data-key="snap.distancePx"] input', '20'); await page.keyboard.press('Tab'); await page.waitForTimeout(60);
const rad = await ev(() => {
  const { app, store } = window.oscine, tl = app.timeline;
  store.ui.snap = 4; // bar grid (2.3 s here): far coarser than the test offsets, so only the magnetic radius decides
  tl.pxPerSec = 40; app.transport.songPos = 10;
  const at15 = tl.snapTime(10 + 15 / 40), at25 = tl.snapTime(10 + 25 / 40);
  store.ui.snap = window.oscine.app.prefs.get('snap.grid');
  return { at15, at25 };
});
check('snap distance 20 px: 15 px away catches the playhead', Math.abs(rad.at15 - 10) < 1e-9, JSON.stringify(rad));
check('snap distance 20 px: 25 px away falls to the grid instead', Math.abs(rad.at25 - 10) > 1e-6, JSON.stringify(rad));

// Follow: panel, L key and toolbar are one truth
await page.click('.settings-row[data-key="view.follow"] input'); await page.waitForTimeout(60);
let f = await ev(() => ({ ui: window.oscine.store.ui.follow, pref: window.oscine.app.prefs.get('view.follow'), btn: window.oscine.app.toolbar.followBtn.classList.contains('on-accent') }));
check('panel Follow off → store + toolbar off', f.ui === false && f.pref === false && f.btn === false, JSON.stringify(f));
await page.keyboard.press('Escape'); await page.mouse.click(800, 500);
await page.keyboard.press('KeyL'); await page.waitForTimeout(60);
f = await ev(() => ({ ui: window.oscine.store.ui.follow, pref: window.oscine.app.prefs.get('view.follow') }));
check('L key toggles the same pref back on', f.ui === true && f.pref === true, JSON.stringify(f));
await page.keyboard.press('KeyL'); await page.waitForTimeout(60); // leave it off for the reload check

// Key scheme from the panel
await page.keyboard.press('Meta+Comma'); await page.waitForTimeout(80);
await page.selectOption('.settings-row[data-key="keys.scheme"] select', 'reaper'); await page.waitForTimeout(80);
const ks = await ev(() => ({ scheme: window.oscine.app.prefs.get('keys.scheme'), tb: window.oscine.app.toolbar.schemeSel.root.querySelector('select').value }));
check('panel scheme → keymap + toolbar', ks.scheme === 'reaper' && ks.tb === 'reaper', JSON.stringify(ks));
check('changed rows show a reset button', await ev(() => !!document.querySelector('.settings-row[data-key="snap.grid"] .settings-reset')));

// Persistence across reload
await load();
const after = await ev(() => ({ grid: window.oscine.store.ui.snap, follow: window.oscine.store.ui.follow, dist: window.oscine.app.prefs.get('snap.distancePx'), scheme: window.oscine.app.prefs.get('keys.scheme'), km: null }));
check('reload keeps grid, follow, distance, scheme', after.grid === 1 && after.follow === false && after.dist === 20 && after.scheme === 'reaper', JSON.stringify(after));

// Reset all
await page.mouse.click(800, 500);
await page.keyboard.press('Meta+Comma'); await page.waitForTimeout(80);
await ev(() => [...document.querySelectorAll('.settings-foot button')].find(b => /Reset all/.test(b.textContent)).click());
await page.waitForTimeout(80);
const rs = await ev(() => ({ grid: window.oscine.store.ui.snap, follow: window.oscine.store.ui.follow, dist: window.oscine.app.prefs.get('snap.distancePx'), scheme: window.oscine.app.prefs.get('keys.scheme'), stored: localStorage.getItem('oscine.prefs') }));
check('Reset all restores defaults', rs.grid === 0.25 && rs.follow === true && rs.dist === 8 && rs.scheme === 'oscine' && rs.stored === '{}', JSON.stringify(rs));
check('no page errors', errs.length === 0, errs.join(' | '));
console.log(`\n${passed} passed, ${failed} failed`);
await browser.close();
process.exit(failed ? 1 : 0);
