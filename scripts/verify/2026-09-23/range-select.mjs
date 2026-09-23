// Gesture proof for ruler range selection (2026-09-23 fixes):
//  1. ⇧-drag on the ruler with snap on: both ends land on the beat grid
//     (the press end used to be raw; the moving end used to stick to its own
//     previous position because the range's live edges were snap targets).
//  2. The drag emits range:changed on release (the inspector refreshes).
//  3. A ⇧-click (no drag) extends from the playhead to the click.
//  4. A ⇧-drag shorter than the snap distance still counts as a drag.
//  5. ⌘ held (noSnap) gives raw times.
// Never saves; no project mutation.
//   OSCINE_URL=http://127.0.0.1:7351 node scripts/verify/2026-09-23/range-select.mjs
const { chromium } = await import(new URL('../../../node_modules/playwright-core/index.mjs', import.meta.url).href);
const BASE = process.env.OSCINE_URL || 'http://127.0.0.1:7351';
const SONG = 'projects/songs/2026-09-19-housekeeping-heat/borrowed-light.oscine.json';
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto(`${BASE}/?p=${SONG}`);
await page.waitForFunction(() => window.oscine?.store?.project?.arrangement?.placements?.length > 0, null, { timeout: 30000 });
await page.waitForTimeout(1200);
let passed = 0, failed = 0;
const check = (n, c, d = '') => { if (c) { passed++; console.log(`  ok  ${n}`); } else { failed++; console.log(`  FAIL  ${n}${d ? ` -- ${d}` : ''}`); } };
const ev = (fn, a) => page.evaluate(fn, a);

await ev(() => {
  const { app, store } = window.oscine;
  store.ui.snap = 1; store.ui.snapOn = true; // 1-beat grid
  app.timeline.range = null; app.transport.songPos = 0;
  window.__rc = 0; app.bus.on('range:changed', () => window.__rc++);
  const tl = app.timeline; tl.pxPerSec = 40; tl.scrollX = 0; tl.fitted = false; tl.dirty = true;
});
await page.waitForTimeout(200);
const geo = await ev(() => {
  const tl = window.oscine.app.timeline, r = tl.canvas.getBoundingClientRect();
  return { left: r.left, top: r.top, pps: tl.pxPerSec, x0: tl.x(0) - 0, beat: 60 / (window.oscine.store.project.bpm || 120) };
});
const X = (t) => geo.left + geo.x0 + t * geo.pps; // tl.x includes gutter + scroll
const rulerY = geo.top + 12; // tick row (TICK_H=22); the band below is the marker strip
console.log(`pxPerSec ${geo.pps.toFixed(1)}, beat ${geo.beat.toFixed(3)} s`);
const onGrid = (t) => Math.abs(t / geo.beat - Math.round(t / geo.beat)) < 1e-6;
// Pick times that are clearly off-grid and away from clip edges.
const tA = 20 * geo.beat + 0.37 * geo.beat, tB = 28 * geo.beat + 0.41 * geo.beat;

async function shiftDrag(a, b, mods = ['Shift'], steps = 10) {
  for (const m of mods) await page.keyboard.down(m);
  await page.mouse.move(X(a), rulerY); await page.mouse.down();
  for (let k = 1; k <= steps; k++) await page.mouse.move(X(a) + (X(b) - X(a)) * k / steps, rulerY);
  await page.mouse.up();
  for (const m of mods.reverse()) await page.keyboard.up(m);
  await page.waitForTimeout(120);
  return ev(() => ({ r: window.oscine.app.timeline.range, rc: window.__rc }));
}

// 1 + 2
let s = await shiftDrag(tA, tB);
check('⇧-drag makes a range', !!s.r, JSON.stringify(s.r));
check('range start snapped to grid', s.r && onGrid(s.r.a), `a=${s.r?.a}`);
check('range end snapped to grid', s.r && onGrid(s.r.b), `b=${s.r?.b}`);
check('range spans the dragged beats', s.r && Math.round(s.r.a / geo.beat) === 20 && Math.round(s.r.b / geo.beat) === 28, JSON.stringify(s.r));
check('range:changed emitted on release', s.rc >= 1, `count=${s.rc}`);
// Reverse drag (right to left) snaps too.
s = await shiftDrag(tB + 4 * geo.beat, tA + 2 * geo.beat);
check('reverse ⇧-drag: both ends on grid', s.r && onGrid(s.r.a) && onGrid(s.r.b), JSON.stringify(s.r));
check('reverse ⇧-drag: correct span 22..32', s.r && Math.round(s.r.a / geo.beat) === 22 && Math.round(s.r.b / geo.beat) === 32, JSON.stringify(s.r));

// 3: click on ruler (seek) then ⇧-click → range playhead..click
await ev(() => { window.oscine.app.timeline.range = null; window.oscine.app.timeline.prevRange = null; });
await page.mouse.click(X(8 * geo.beat + 0.3 * geo.beat), rulerY);
await page.waitForTimeout(80);
const ph = await ev(() => window.oscine.app.transport.songPos);
await page.keyboard.down('Shift'); await page.mouse.click(X(16 * geo.beat + 0.3 * geo.beat), rulerY); await page.keyboard.up('Shift');
await page.waitForTimeout(100);
s = await ev(() => ({ r: window.oscine.app.timeline.range }));
check('click then ⇧-click makes playhead→click range', s.r && Math.abs(s.r.a - ph) < 1e-6 && Math.round(s.r.b / geo.beat) === 16, `ph=${ph} r=${JSON.stringify(s.r)}`);

// 4: small drag (~6 px) still a drag, not reinterpreted as a ⇧-click
await ev(() => { window.oscine.app.timeline.range = null; window.oscine.app.timeline.prevRange = null; window.oscine.app.transport.songPos = 0; });
const small = 12 / geo.pps; // 12 px
s = await shiftDrag(40 * geo.beat, 40 * geo.beat + small, ['Shift'], 4);
check('short ⇧-drag stays anchored at press (not extended from playhead 0)', !s.r || s.r.a > 30 * geo.beat, JSON.stringify(s.r));

// 5: ⌘ bypasses snap
await ev(() => { window.oscine.app.timeline.range = null; });
s = await shiftDrag(tA, tB, ['Shift', 'Meta']);
check('⌘+⇧-drag is unsnapped', s.r && !onGrid(s.r.b) && Math.abs(s.r.b - tB) < 2 / geo.pps, JSON.stringify(s.r));

await ev(() => { window.oscine.app.timeline.range = null; });
// Lyrics bar: no visible scrollbar.
const sb = await ev(() => { const st = document.querySelector('.lyrics-strip'); if (!st) return null; const cs = getComputedStyle(st); return { sw: cs.scrollbarWidth, hBar: st.offsetHeight - st.clientHeight }; });
check('lyrics strip: no scrollbar', sb && sb.sw === 'none' && sb.hBar === 0, JSON.stringify(sb));
check('no page errors', errs.length === 0, errs.join(' | '));
console.log(`\n${passed} passed, ${failed} failed`);
await browser.close();
process.exit(failed ? 1 : 0);
